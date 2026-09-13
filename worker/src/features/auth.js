// Signing in with Google or Discord, onto one account either way.
//
//   app     makes a random nonce, keeps it in sessionStorage, and navigates to
//           /auth/start?provider=google&nonce=N
//   worker  records the request under a random `state`, redirects to Google
//   google  sends the player back to /auth/callback/google?code&state
//   worker  checks the state, asks Google who this is, finds or creates the
//           account, and redirects to the app with a one-time code in the URL
//           fragment - never the session token itself
//   app     POSTs the code AND its nonce to /auth/exchange, and gets the token
//
// The nonce is what stops someone else's finished sign-in being slipped to a
// player: a code only exchanges alongside the nonce of the browser that began it.

import { fail, json, list, noContent, now, randomToken, redirect, siteUrl } from '../http.js';
import { createSession, endSession } from '../sessions.js';
import { higher } from '../roles.js';

const CODE_TTL_SECONDS = { state: 600, code: 120, link: 300 };

/* -------------------------------------------------------------------------
   One-time codes
   ------------------------------------------------------------------------- */

async function issueCode(env, purpose, data) {
  const code = randomToken(24);
  await env.DB.prepare('INSERT INTO auth_codes (code, purpose, data, created) VALUES (?, ?, ?, ?)')
    .bind(code, purpose, JSON.stringify(data), now()).run();
  return code;
}

/** Take a code: it is deleted as it is read, so it can never be used twice. */
async function takeCode(env, purpose, code) {
  if (!code || !/^[a-f0-9]{16,128}$/.test(code)) return null;
  const row = await env.DB.prepare('SELECT data, created FROM auth_codes WHERE code = ? AND purpose = ?')
    .bind(code, purpose).first();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM auth_codes WHERE code = ?').bind(code).run();
  const age = (Date.now() - new Date(row.created).getTime()) / 1000;
  if (age > CODE_TTL_SECONDS[purpose]) return null;
  return JSON.parse(row.data);
}

async function sweepCodes(env) {
  const cutoff = new Date(Date.now() - Math.max(...Object.values(CODE_TTL_SECONDS)) * 1000).toISOString();
  await env.DB.prepare('DELETE FROM auth_codes WHERE created < ?').bind(cutoff).run();
}

/* -------------------------------------------------------------------------
   Providers
   ------------------------------------------------------------------------- */

/**
 * Each provider is three URLs and a way to read a profile into the same shape:
 * { subject, name, avatar, floor }. `floor` - the lowest site role the server's
 * settings grant this sign-in - is decided here, so an email is never stored.
 */
const PROVIDERS = {
  discord: {
    ready: (env) => Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    clientId: (env) => env.DISCORD_CLIENT_ID,
    clientSecret: (env) => env.DISCORD_CLIENT_SECRET,
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify',
    extra: {},
    async profile(accessToken, env) {
      const res = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw fail(502, 'Discord would not say who signed in');
      const me = await res.json();
      return {
        subject: String(me.id),
        name: me.global_name || me.username || 'Adventurer',
        avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : null,
        floor: floorFor(env, 'DISCORD_IDS', String(me.id)),
      };
    },
  },

  google: {
    ready: (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    async profile(accessToken, env) {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw fail(502, 'Google would not say who signed in');
      const me = await res.json();
      const email = String(me.email || '').toLowerCase();
      return {
        subject: String(me.sub),
        name: me.given_name || me.name || 'Adventurer',
        avatar: me.picture || null,
        // Only a verified address can raise anyone above a player.
        floor: me.email_verified ? floorFor(env, 'GOOGLE_EMAILS', email) : null,
      };
    },
  },
};

/** The site role the server's settings guarantee a sign-in: 'admin', 'gm', or null. */
function floorFor(env, setting, value) {
  const named = (key) => list(env[key]).map((v) => v.toLowerCase()).includes(String(value).toLowerCase());
  if (named(`ADMIN_${setting}`)) return 'admin';
  if (named(`GM_${setting}`)) return 'gm';
  return null;
}

/**
 * Whether a provider is switched on in the server's settings. SIGN_IN_WITH
 * lists the providers to offer ("google", or "google,discord"); left unset,
 * every provider with secrets is offered. A provider switched off cannot be
 * started, and a sign-in already under way with it cannot be finished.
 */
const switchedOn = (env, name) => env.SIGN_IN_WITH === undefined || list(env.SIGN_IN_WITH).includes(name);

/** A provider that is switched on and has its secrets, or null. */
const offered = (env, name) => {
  const provider = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  return provider && switchedOn(env, name) && provider.ready(env) ? provider : null;
};

export function configuredProviders(env) {
  return Object.fromEntries(Object.keys(PROVIDERS).map((name) => [name, Boolean(offered(env, name))]));
}

const callbackUrl = (url, provider) => new URL(`/auth/callback/${provider}`, url.origin).toString();

/** Send the player back to the app with a reason, instead of a bare error page. */
const failBack = (env, reason) => redirect(`${siteUrl(env)}#/sign-in-failed/${encodeURIComponent(reason)}`);

/* -------------------------------------------------------------------------
   Accounts and identities
   ------------------------------------------------------------------------- */

/** The highest floor any of an account's sign-ins carries, or null. */
export async function accountFloor(env, userId) {
  const rows = await env.DB.prepare('SELECT floor FROM identities WHERE user_id = ? AND floor IS NOT NULL').bind(userId).all();
  return (rows.results || []).map((r) => r.floor).reduce((best, f) => (best ? higher(best, f) : f), null);
}

/**
 * Find the account an identity belongs to, making one if it is new. When
 * `linkUserId` is set, a signed-in player is adding this provider; that refuses
 * if the identity already belongs to a different account.
 */
async function attachIdentity(env, provider, profile, linkUserId) {
  const existing = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(provider, profile.subject).first();

  let userId;
  if (linkUserId) {
    if (existing && existing.user_id !== linkUserId) {
      throw Object.assign(new Error('identity belongs to another account'), { reason: 'already-linked' });
    }
    const account = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(linkUserId).first();
    if (!account) throw Object.assign(new Error('no such account'), { reason: 'expired' });
    userId = linkUserId;
  } else if (existing) {
    userId = existing.user_id;
  } else {
    userId = randomToken(16);
    await env.DB.prepare(
      "INSERT INTO users (id, name, avatar, role, created, last_seen) VALUES (?, ?, ?, 'player', ?, ?)"
    ).bind(userId, profile.name, profile.avatar, now(), now()).run();
  }

  await env.DB.prepare(
    `INSERT INTO identities (provider, subject, user_id, floor, created, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET floor = excluded.floor, last_seen = excluded.last_seen`
  ).bind(provider, profile.subject, userId, profile.floor, now(), now()).run();

  // Raised to the highest floor, never lowered here: a role an admin gave stays
  // until an admin takes it away. Linking does not rename the account.
  const current = (await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first())?.role || 'player';
  const role = higher(current, await accountFloor(env, userId) || 'player');
  if (linkUserId) {
    await env.DB.prepare('UPDATE users SET role = ?, last_seen = ? WHERE id = ?').bind(role, now(), userId).run();
  } else {
    await env.DB.prepare('UPDATE users SET name = ?, avatar = ?, role = ?, last_seen = ? WHERE id = ?')
      .bind(profile.name, profile.avatar, role, now(), userId).run();
  }
  return userId;
}

/* -------------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------------- */

async function start({ env, url }) {
  const providerName = url.searchParams.get('provider') || 'discord';
  const provider = offered(env, providerName);
  if (!provider) return failBack(env, 'provider-unavailable');

  const nonce = url.searchParams.get('nonce') || '';
  if (!/^[a-f0-9]{32,128}$/.test(nonce)) return failBack(env, 'bad-request');

  let linkUserId = null;
  const linkCode = url.searchParams.get('link');
  if (linkCode) {
    const link = await takeCode(env, 'link', linkCode);
    if (!link) return failBack(env, 'link-expired');
    linkUserId = link.userId;
  }

  await sweepCodes(env);
  const state = await issueCode(env, 'state', { provider: providerName, nonce, linkUserId });

  const authorize = new URL(provider.authorize);
  authorize.searchParams.set('client_id', provider.clientId(env));
  authorize.searchParams.set('redirect_uri', callbackUrl(url, providerName));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', provider.scope);
  authorize.searchParams.set('state', state);
  for (const [key, value] of Object.entries(provider.extra)) authorize.searchParams.set(key, value);
  return redirect(authorize.toString());
}

async function callback({ env, url, params }) {
  const providerName = params.provider || 'discord';
  const provider = offered(env, providerName);
  if (!provider) return failBack(env, 'provider-unavailable');
  if (url.searchParams.get('error')) return failBack(env, 'cancelled');

  const request = await takeCode(env, 'state', url.searchParams.get('state'));
  if (!request || request.provider !== providerName) return failBack(env, 'expired');

  const code = url.searchParams.get('code');
  if (!code) return failBack(env, 'cancelled');

  const tokenRes = await fetch(provider.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: provider.clientId(env),
      client_secret: provider.clientSecret(env),
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(url, providerName),
    }),
  });
  if (!tokenRes.ok) return failBack(env, 'provider-refused');
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) return failBack(env, 'provider-refused');

  const profile = await provider.profile(accessToken, env);

  let userId;
  try {
    userId = await attachIdentity(env, providerName, profile, request.linkUserId);
  } catch (err) {
    if (err.reason) return failBack(env, err.reason);
    throw err;
  }

  const token = await createSession(env, userId);
  const exchange = await issueCode(env, 'code', { token, nonce: request.nonce, linked: Boolean(request.linkUserId) });
  return redirect(`${siteUrl(env)}#/signed-in/${exchange}`);
}

async function exchange({ env, body }) {
  const input = await body(4096);
  const grant = await takeCode(env, 'code', input.code);
  if (!grant || !input.nonce || grant.nonce !== input.nonce) throw fail(400, 'that sign-in could not be completed');
  return json({ token: grant.token, linked: grant.linked });
}

async function link({ env, user }) {
  return json({ link: await issueCode(env, 'link', { userId: user.id }) });
}

async function signOut({ env, request }) {
  await endSession(env, request);
  return noContent();
}

async function me({ env, user }) {
  const rows = await env.DB.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').bind(user.id).all();
  return json({ ...user, providers: (rows.results || []).map((r) => r.provider), available: configuredProviders(env) });
}

export const routes = [
  { method: 'GET', path: '/auth/providers', auth: 'none', handler: ({ env }) => json(configuredProviders(env)) },
  { method: 'GET', path: '/auth/start', auth: 'none', handler: start },
  { method: 'GET', path: '/auth/callback', auth: 'none', handler: callback },   // the original Discord redirect
  { method: 'GET', path: '/auth/callback/:provider', auth: 'none', handler: callback },
  { method: 'POST', path: '/auth/exchange', auth: 'none', handler: exchange },
  { method: 'POST', path: '/auth/link', auth: 'user', handler: link },
  { method: 'POST', path: '/auth/signout', auth: 'none', handler: signOut },
  { method: 'GET', path: '/api/me', auth: 'user', handler: me },
];
