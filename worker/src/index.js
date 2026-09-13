// The sheets server.
//
// A single Cloudflare Worker in front of a D1 database. It does four things and
// deliberately nothing else:
//
//   1. signs players in with Google or Discord, onto one account either way;
//   2. stores each account's characters;
//   3. stores each account's homebrew library, entry by entry;
//   4. holds the Antaera campaign's gestalt switch, which only its DM can move.
//
// It does no arithmetic. The engine in web/engine is the only thing that computes
// a sheet, and it runs in the browser, so a sheet works with the server switched
// off and there is no second implementation to disagree with the first.
//
// SESSIONS ARE BEARER TOKENS, NOT COOKIES. The app is served from github.io and
// this Worker from workers.dev, so a session cookie would be a third-party cookie,
// and Safari - every iPhone at the table - refuses those. A token held by the app
// and sent in an Authorization header works in every browser. Only a hash of it
// is stored here.
//
// SIGN-IN, step by step:
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
//
// Secrets and settings - see wrangler.toml:
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GM_DISCORD_IDS, GM_GOOGLE_EMAILS, SITE_ORIGIN, SITE_PATH

const SESSION_DAYS = 30;
const CODE_TTL_SECONDS = { state: 600, code: 120, link: 300 };
const MAX_SHEET_BYTES = 512 * 1024;
const MAX_ENTRY_BYTES = 128 * 1024;
const MAX_ENTRIES_PER_ACCOUNT = 2000;
const CONTENT_KINDS = new Set(['race', 'class', 'feat', 'skill', 'item', 'template', 'feature']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight(request, env);
    try {
      return withCors(await route(request, env, new URL(request.url)), request, env);
    } catch (err) {
      const status = err.status || 500;
      return withCors(json({ error: status === 500 ? 'server error' : err.message }, status), request, env);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/auth/providers') return json(configuredProviders(env));
  if (pathname === '/auth/start') return authStart(env, url);
  if (pathname === '/auth/callback') return authCallback(env, url, 'discord');   // the original Discord redirect
  const callback = pathname.match(/^\/auth\/callback\/(discord|google)$/);
  if (callback) return authCallback(env, url, callback[1]);
  if (pathname === '/auth/exchange' && method === 'POST') return authExchange(request, env);
  if (pathname === '/auth/link' && method === 'POST') return authLink(request, env);
  if (pathname === '/auth/signout' && method === 'POST') return authSignOut(request, env);

  if (pathname === '/api/me') return apiMe(request, env);

  if (pathname === '/api/campaign') {
    if (method === 'GET') return apiCampaignGet(env);
    if (method === 'PUT') return apiCampaignPut(request, env);
  }

  if (pathname === '/api/characters' && method === 'GET') return apiList(request, env);
  const sheet = pathname.match(/^\/api\/characters\/([A-Za-z0-9_-]{1,64})$/);
  if (sheet) {
    if (method === 'GET') return apiLoad(request, env, sheet[1]);
    if (method === 'PUT') return apiSave(request, env, sheet[1]);
    if (method === 'DELETE') return apiDelete(request, env, sheet[1]);
  }

  if (pathname === '/api/content' && method === 'GET') return apiContentList(request, env);
  const entry = pathname.match(/^\/api\/content\/([A-Za-z0-9_-]{1,64})$/);
  if (entry) {
    if (method === 'PUT') return apiContentPut(request, env, entry[1]);
    if (method === 'DELETE') return apiContentDelete(request, env, entry[1]);
  }

  if (pathname === '/' || pathname === '/health') {
    return json({ ok: true, service: 'sheets', now: now() });
  }

  throw fail(404, 'no such endpoint');
}

/* =========================================================================
   Plumbing
   ========================================================================= */

const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const redirect = (location) => new Response(null, { status: 302, headers: { location } });

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return list(env.SITE_ORIGIN).includes(origin) || isLocal ? origin : null;
}

function withCors(response, request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'origin');
  return new Response(response.body, { status: response.status, headers });
}

function preflight(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    },
  });
}

function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const siteUrl = (env) => `${list(env.SITE_ORIGIN)[0] || ''}${env.SITE_PATH || '/'}`;

async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > limit) throw fail(413, 'that is too large');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw fail(400, 'the body was not a JSON object');
  }
}

/* =========================================================================
   One-time codes: sign-in state, exchange codes, link permissions
   ========================================================================= */

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

/** Old codes are swept on each sign-in, so the table never grows. */
async function sweepCodes(env) {
  const cutoff = new Date(Date.now() - Math.max(...Object.values(CODE_TTL_SECONDS)) * 1000).toISOString();
  await env.DB.prepare('DELETE FROM auth_codes WHERE created < ?').bind(cutoff).run();
}

/* =========================================================================
   Sessions
   ========================================================================= */

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return match ? match[1] : null;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now(), expires).run();
  return token;
}

/** The signed-in account, or null. Expired sessions are removed as they are met. */
async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.expires, u.id, u.name, u.avatar, u.gm
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (new Date(row.expires) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(hash).run();
    return null;
  }
  return { id: row.id, name: row.name, avatar: row.avatar, gm: Boolean(row.gm) };
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw fail(401, 'not signed in');
  return user;
}

/* =========================================================================
   Providers
   ========================================================================= */

/**
 * Each provider is three URLs and a way to read a profile into the same shape:
 * { subject, name, avatar, gm }. `gm` is decided here, from the provider's own
 * answer, so an email address is looked at and never stored.
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
        gm: list(env.GM_DISCORD_IDS).includes(String(me.id)),
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
        // Only a verified address can make someone the DM.
        gm: Boolean(me.email_verified) && list(env.GM_GOOGLE_EMAILS).map((e) => e.toLowerCase()).includes(email),
      };
    },
  },
};

function configuredProviders(env) {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [name, p.ready(env)]));
}

const callbackUrl = (url, provider) => new URL(`/auth/callback/${provider}`, url.origin).toString();

/* =========================================================================
   Sign-in
   ========================================================================= */

/**
 * Begin a sign-in. `nonce` comes from the app and is required; `link` is a code
 * from /auth/link, present when a signed-in player is adding a second provider.
 */
async function authStart(env, url) {
  const providerName = url.searchParams.get('provider') || 'discord';
  const provider = PROVIDERS[providerName];
  if (!provider || !provider.ready(env)) return failBack(env, 'provider-unavailable');

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

/** Send the player back to the app with a reason, instead of a bare error page. */
const failBack = (env, reason) => redirect(`${siteUrl(env)}#/sign-in-failed/${encodeURIComponent(reason)}`);

async function authCallback(env, url, providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider?.ready(env)) return failBack(env, 'provider-unavailable');
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

/**
 * Find the account an identity belongs to, making one if it is new.
 *
 * When `linkUserId` is set, a signed-in player is adding this provider to their
 * account. That succeeds if the identity is new, or already theirs; it refuses if
 * the identity belongs to a different account, because silently moving it would
 * orphan that account's characters.
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
      'INSERT INTO users (id, name, avatar, gm, created, last_seen) VALUES (?, ?, ?, 0, ?, ?)'
    ).bind(userId, profile.name, profile.avatar, now(), now()).run();
  }

  await env.DB.prepare(
    `INSERT INTO identities (provider, subject, user_id, gm, created, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET gm = excluded.gm, last_seen = excluded.last_seen`
  ).bind(provider, profile.subject, userId, profile.gm ? 1 : 0, now(), now()).run();

  // An account is the DM if any of its sign-ins says so. The name and picture
  // follow whichever provider was used most recently, unless linking - adding
  // Discord to a Google account should not rename it.
  const anyGm = await env.DB.prepare('SELECT MAX(gm) AS gm FROM identities WHERE user_id = ?').bind(userId).first();
  if (linkUserId) {
    await env.DB.prepare('UPDATE users SET gm = ?, last_seen = ? WHERE id = ?')
      .bind(anyGm?.gm ? 1 : 0, now(), userId).run();
  } else {
    await env.DB.prepare('UPDATE users SET name = ?, avatar = ?, gm = ?, last_seen = ? WHERE id = ?')
      .bind(profile.name, profile.avatar, anyGm?.gm ? 1 : 0, now(), userId).run();
  }
  return userId;
}

/** Trade the one-time code, with the nonce of the browser that asked, for a token. */
async function authExchange(request, env) {
  const body = await readJson(request, 4096);
  const grant = await takeCode(env, 'code', body.code);
  if (!grant || !body.nonce || grant.nonce !== body.nonce) throw fail(400, 'that sign-in could not be completed');
  return json({ token: grant.token, linked: grant.linked });
}

/** A short-lived permission for the signed-in account to add another provider. */
async function authLink(request, env) {
  const user = await requireUser(request, env);
  return json({ link: await issueCode(env, 'link', { userId: user.id }) });
}

async function authSignOut(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(token)).run();
  return new Response(null, { status: 204 });
}

async function apiMe(request, env) {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider')
    .bind(user.id).all();
  return json({
    ...user,
    providers: (rows.results || []).map((r) => r.provider),
    available: configuredProviders(env),
  });
}

/* =========================================================================
   Campaign settings - Antaera's only
   ========================================================================= */

async function apiCampaignGet(env) {
  const rows = await env.DB.prepare('SELECT key, value FROM campaign').all();
  const settings = {};
  for (const row of rows.results || []) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return json({ gestalt: false, ...settings });
}

async function apiCampaignPut(request, env) {
  const user = await requireUser(request, env);
  if (!user.gm) throw fail(403, 'only the DM can change the campaign settings');
  const body = await readJson(request, 4096);
  const statements = [];
  for (const key of ['gestalt']) {
    if (!(key in body)) continue;
    statements.push(env.DB.prepare(
      `INSERT INTO campaign (key, value, updated) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated`
    ).bind(key, JSON.stringify(body[key]), now()));
  }
  if (statements.length) await env.DB.batch(statements);
  return apiCampaignGet(env);
}

/* =========================================================================
   Characters

   A player sees their own. The Antaera DM also sees every ANTAERA character -
   and nothing else, because anyone can sign in now, and a stranger's SRD
   character built for some other table is none of the campaign's business.
   ========================================================================= */

const canSee = (user, row) => row.owner === user.id || (user.gm && row.ruleset === 'antaera');

async function apiList(request, env) {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.player, c.build, c.level, c.ruleset, c.updated, c.owner, u.name AS ownerName
       FROM characters c JOIN users u ON u.id = c.owner
      WHERE c.owner = ? OR (? = 1 AND c.ruleset = 'antaera')
      ORDER BY c.name`
  ).bind(user.id, user.gm ? 1 : 0).all();
  return json(rows.results || []);
}

async function apiLoad(request, env, id) {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT owner, ruleset, data FROM characters WHERE id = ?').bind(id).first();
  if (!row || !canSee(user, row)) throw fail(404, 'no character with that address');
  return json(JSON.parse(row.data));
}

/**
 * Store a sheet. The server does not judge whether the character is legal - a
 * half-built character must be savable - only whose sheet it is.
 */
async function apiSave(request, env, id) {
  const user = await requireUser(request, env);
  const character = await readJson(request, MAX_SHEET_BYTES);

  const existing = await env.DB.prepare('SELECT owner, ruleset, created FROM characters WHERE id = ?').bind(id).first();
  if (existing && !canSee(user, existing)) throw fail(404, 'no character with that address');

  const owner = existing ? existing.owner : user.id;
  const ruleset = ['srd', 'antaera'].includes(character.ruleset) ? character.ruleset : 'srd';
  character.id = id;
  character.meta = { ...(character.meta || {}), owner, updated: now() };

  await env.DB.prepare(
    `INSERT INTO characters (id, owner, name, player, build, level, ruleset, data, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, player = excluded.player,
       build = excluded.build, level = excluded.level, ruleset = excluded.ruleset,
       data = excluded.data, updated = excluded.updated`
  ).bind(
    id, owner,
    String(character.name || '').slice(0, 200),
    String(character.player || '').slice(0, 200),
    String(character.meta?.build || '').slice(0, 200),
    Array.isArray(character.levels) ? character.levels.length : 0,
    ruleset,
    JSON.stringify(character),
    existing ? existing.created : now(),
    now()
  ).run();

  return json({ ok: true, id, updated: character.meta.updated });
}

async function apiDelete(request, env, id) {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT owner, ruleset FROM characters WHERE id = ?').bind(id).first();
  if (!row) return new Response(null, { status: 204 });
  if (!canSee(user, row)) throw fail(404, 'no character with that address');
  await env.DB.prepare('DELETE FROM characters WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204 });
}

/* =========================================================================
   Homebrew

   Strictly the account's own: nobody, the DM included, reads another player's
   library. Content a DM needs to see arrives inside the sheet that uses it.
   ========================================================================= */

async function apiContentList(request, env) {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare('SELECT data FROM content WHERE owner = ? ORDER BY kind, name')
    .bind(user.id).all();
  return json((rows.results || []).map((r) => JSON.parse(r.data)));
}

/**
 * Store one entry. The browser chooses the id and the `updated` timestamp; the
 * newer timestamp wins, so an older copy arriving late from a second device does
 * not undo a newer edit.
 */
async function apiContentPut(request, env, id) {
  const user = await requireUser(request, env);
  const entry = await readJson(request, MAX_ENTRY_BYTES);
  if (!CONTENT_KINDS.has(entry.kind)) throw fail(400, 'that is not a kind of content');
  if (!ID.test(id)) throw fail(400, 'bad id');
  const updated = typeof entry.updated === 'string' && !Number.isNaN(Date.parse(entry.updated)) ? entry.updated : now();
  entry.id = id;
  entry.updated = updated;

  const existing = await env.DB.prepare('SELECT updated FROM content WHERE owner = ? AND id = ?').bind(user.id, id).first();
  if (existing && existing.updated > updated) {
    return json({ ok: true, id, updated: existing.updated, stale: true });
  }
  if (!existing) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM content WHERE owner = ?').bind(user.id).first();
    if ((count?.n || 0) >= MAX_ENTRIES_PER_ACCOUNT) throw fail(413, 'that library is full');
  }

  await env.DB.prepare(
    `INSERT INTO content (owner, id, kind, name, data, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
       data = excluded.data, updated = excluded.updated`
  ).bind(user.id, id, entry.kind, String(entry.name || '').slice(0, 200), JSON.stringify(entry), now(), updated).run();

  return json({ ok: true, id, updated });
}

async function apiContentDelete(request, env, id) {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM content WHERE owner = ? AND id = ?').bind(user.id, id).run();
  return new Response(null, { status: 204 });
}
