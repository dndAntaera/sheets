// The campaign server.
//
// A single Cloudflare Worker in front of a D1 database. It does three things
// and deliberately nothing else:
//
//   1. signs players in with Discord, because the campaign already runs there
//      and a Discord id is the same name their character thread is under;
//   2. stores and serves sheets, a player seeing their own and the DM seeing
//      every one;
//   3. holds the campaign settings the DM controls - at present, gestalt.
//
// It does no arithmetic. The engine in web/engine is the only thing that
// computes a sheet, and it runs in the browser, so a sheet works with the
// server switched off and there is no second implementation to disagree with
// the first.
//
// Secrets and settings, set with `wrangler secret put` or in wrangler.toml:
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET   the Discord application
//   GM_DISCORD_IDS                             comma-separated, who is the DM
//   SITE_ORIGIN                                https://dndantaera.github.io
//   SITE_PATH                                  /sheets/  (where the app lives)

const SESSION_COOKIE = 'antaera_session';
const SESSION_DAYS = 30;
const MAX_SHEET_BYTES = 512 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The browser sends a preflight for every cross-site request carrying
    // credentials, so it has to be answered before anything else happens.
    if (request.method === 'OPTIONS') return preflight(request, env);

    try {
      const response = await route(request, env, url);
      return withCors(response, request, env);
    } catch (err) {
      const status = err.status || 500;
      return withCors(json({ error: err.message }, status), request, env);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/auth/start') return authStart(request, env, url);
  if (pathname === '/auth/callback') return authCallback(request, env, url);
  if (pathname === '/auth/signout' && method === 'POST') return authSignOut(request, env);

  if (pathname === '/api/me') return apiMe(request, env);

  if (pathname === '/api/campaign') {
    if (method === 'GET') return apiCampaignGet(env);
    if (method === 'PUT') return apiCampaignPut(request, env);
  }

  if (pathname === '/api/characters' && method === 'GET') return apiList(request, env);

  const sheet = pathname.match(/^\/api\/characters\/([A-Za-z0-9_-]{1,64})$/);
  if (sheet) {
    const id = sheet[1];
    if (method === 'GET') return apiLoad(request, env, id);
    if (method === 'PUT') return apiSave(request, env, id);
    if (method === 'DELETE') return apiDelete(request, env, id);
  }

  if (pathname === '/' || pathname === '/health') {
    return json({ ok: true, service: 'antaera-sheets', now: new Date().toISOString() });
  }

  throw fail(404, 'no such endpoint');
}

/* =========================================================================
   Plumbing
   ========================================================================= */

const fail = (status, message) => Object.assign(new Error(message), { status });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

const now = () => new Date().toISOString();

/**
 * Cross-origin headers.
 *
 * The app is served from GitHub Pages and the API from workers.dev, so every
 * request is cross-site and needs both an explicit origin (never "*", which
 * cannot carry credentials) and Allow-Credentials.
 */
function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = (env.SITE_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Local development is allowed too, so the sheet can be run against the real
  // server before it is deployed.
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed.includes(origin) || isLocal ? origin : null;
}

function withCors(response, request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
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
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    },
  });
}

/* =========================================================================
   Sessions
   ========================================================================= */

const readCookie = (request, name) => {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function sessionCookie(token, maxAgeSeconds) {
  // SameSite=None is required because the app and the API are on different
  // sites; None requires Secure, which both of them are.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSeconds}`;
}

/** The signed-in user, or null. Expired sessions are cleaned up as they are met. */
async function currentUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.expires, u.id, u.name, u.avatar, u.gm
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(token).first();

  if (!row) return null;
  if (new Date(row.expires) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
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
   Discord sign-in
   ========================================================================= */

const siteUrl = (env) => `${(env.SITE_ORIGIN || '').split(',')[0]}${env.SITE_PATH || '/'}`;

function authStart(request, env, url) {
  if (!env.DISCORD_CLIENT_ID) throw fail(500, 'the server has no Discord application configured');

  const state = randomToken().slice(0, 24);
  const redirect = new URL('/auth/callback', url.origin).toString();
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirect);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'identify');
  authorize.searchParams.set('state', state);

  // The state is held in a short-lived cookie and checked on the way back,
  // so a callback that nobody here started is rejected.
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': `antaera_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function authCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, 'antaera_state');
  if (!code) throw fail(400, 'no code returned from Discord');
  if (!state || state !== expected) throw fail(400, 'the sign-in state did not match');

  const redirect = new URL('/auth/callback', url.origin).toString();
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
    }),
  });
  if (!tokenRes.ok) throw fail(502, 'Discord would not exchange the code');
  const { access_token: accessToken } = await tokenRes.json();

  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) throw fail(502, 'Discord would not say who signed in');
  const me = await meRes.json();

  const gmIds = (env.GM_DISCORD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isGm = gmIds.includes(me.id) ? 1 : 0;
  const name = me.global_name || me.username || 'Someone';

  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar, gm, created, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar,
                                   gm = excluded.gm, last_seen = excluded.last_seen`
  ).bind(me.id, name, me.avatar || null, isGm, now(), now()).run();

  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)'
  ).bind(token, me.id, now(), expires).run();

  const headers = new Headers({ location: siteUrl(env) });
  headers.append('set-cookie', sessionCookie(token, SESSION_DAYS * 86400));
  headers.append('set-cookie', 'antaera_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return new Response(null, { status: 302, headers });
}

async function authSignOut(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': sessionCookie('', 0) },
  });
}

async function apiMe(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw fail(401, 'not signed in');
  return json(user);
}

/* =========================================================================
   Campaign settings
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

/** Only the DM may move a campaign setting. */
async function apiCampaignPut(request, env) {
  const user = await requireUser(request, env);
  if (!user.gm) throw fail(403, 'only the DM can change the campaign settings');

  const body = await request.json();
  const allowed = ['gestalt'];
  const statements = [];
  for (const key of allowed) {
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
   ========================================================================= */

async function apiList(request, env) {
  const user = await requireUser(request, env);
  const sql = `SELECT c.id, c.name, c.player, c.build, c.level, c.updated, c.owner, u.name AS ownerName
                 FROM characters c JOIN users u ON u.id = c.owner`;
  const rows = user.gm
    ? await env.DB.prepare(`${sql} ORDER BY c.name`).all()
    : await env.DB.prepare(`${sql} WHERE c.owner = ? ORDER BY c.name`).bind(user.id).all();
  return json(rows.results || []);
}

async function apiLoad(request, env, id) {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT owner, data FROM characters WHERE id = ?').bind(id).first();
  if (!row) throw fail(404, 'no character with that address');
  if (row.owner !== user.id && !user.gm) throw fail(403, 'that character belongs to someone else');
  return json(JSON.parse(row.data));
}

/**
 * Store a sheet.
 *
 * The server does not judge whether the character is legal - the engine does
 * that in the browser, and a half-built character has to be savable or players
 * lose work. What it does enforce is whose sheet it is, and that the body is a
 * sheet at all rather than something enormous.
 */
async function apiSave(request, env, id) {
  const user = await requireUser(request, env);

  const text = await request.text();
  if (text.length > MAX_SHEET_BYTES) throw fail(413, 'that sheet is too large');
  let character;
  try {
    character = JSON.parse(text);
  } catch {
    throw fail(400, 'the body was not JSON');
  }
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    throw fail(400, 'the body was not a character');
  }

  const existing = await env.DB.prepare('SELECT owner, created FROM characters WHERE id = ?')
    .bind(id).first();
  if (existing && existing.owner !== user.id && !user.gm) {
    throw fail(403, 'that character belongs to someone else');
  }

  const owner = existing ? existing.owner : user.id;
  character.id = id;
  character.meta = { ...(character.meta || {}), owner, updated: now() };

  await env.DB.prepare(
    `INSERT INTO characters (id, owner, name, player, build, level, data, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, player = excluded.player,
       build = excluded.build, level = excluded.level, data = excluded.data,
       updated = excluded.updated`
  ).bind(
    id,
    owner,
    String(character.name || ''),
    String(character.player || ''),
    String(character.meta?.build || ''),
    Array.isArray(character.levels) ? character.levels.length : 0,
    JSON.stringify(character),
    existing ? existing.created : now(),
    now()
  ).run();

  return json({ ok: true, id, updated: character.meta.updated });
}

async function apiDelete(request, env, id) {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT owner FROM characters WHERE id = ?').bind(id).first();
  if (!row) return new Response(null, { status: 204 });
  if (row.owner !== user.id && !user.gm) throw fail(403, 'that character belongs to someone else');
  await env.DB.prepare('DELETE FROM characters WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204 });
}
