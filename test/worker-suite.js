// Tests for the sheets server, run in a browser against real SQLite.
//
// The Worker is imported as it is deployed. Its database is the dev server's
// D1 stand-in - an in-memory SQLite built from worker/migrations, so the SQL
// under test is the SQL that ships. Google and Discord are faked at the
// network: every request to them is answered from `people` below, so each test
// decides who is signing in.
//
// Each case starts from an empty database. Run with scripts/serve.py and open
// test/worker.html.

import worker from '../worker/src/index.js';

const realFetch = globalThis.fetch.bind(globalThis);
const SITE = 'https://sheets.test/sheets/';
const API = 'https://api.test';

/* -------------------------------------------------------------------------
   The D1 stand-in
   ------------------------------------------------------------------------- */

export async function d1(path, body = {}) {
  const res = await realFetch(`/__test/d1${path}`, { method: 'POST', body: JSON.stringify(body) });
  const out = await res.json();
  if (!out.ok) throw new Error(`SQL: ${out.error}`);
  return out.result;
}

class Statement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }

  bind(...params) { return new Statement(this.sql, params); }
  first() { return d1('', { sql: this.sql, params: this.params, mode: 'first' }); }
  all() { return d1('', { sql: this.sql, params: this.params, mode: 'all' }); }
  run() { return d1('', { sql: this.sql, params: this.params, mode: 'run' }); }
}

const DB = {
  prepare: (sql) => new Statement(sql),
  batch: (statements) => d1('/batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params })) }),
};

export const env = {
  DB,
  SITE_ORIGIN: 'https://sheets.test',
  SITE_PATH: '/sheets/',
  DISCORD_CLIENT_ID: 'discord-app',
  DISCORD_CLIENT_SECRET: 'discord-secret',
  GOOGLE_CLIENT_ID: 'google-app',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GM_DISCORD_IDS: 'dm-on-discord',
  GM_GOOGLE_EMAILS: 'dm@example.com',
  ADMIN_DISCORD_IDS: 'admin-on-discord',
  ADMIN_GOOGLE_EMAILS: 'admin@example.com',
};

/* -------------------------------------------------------------------------
   The fake providers
   ------------------------------------------------------------------------- */

/** Who each provider says is signing in. Tests set these before signIn(). */
export const people = { google: null, discord: null };

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'google-access' });
  if (url === 'https://discord.com/api/oauth2/token') return reply({ access_token: 'discord-access' });
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return people.google ? reply(people.google) : reply({}, 401);
  if (url === 'https://discord.com/api/users/@me') return people.discord ? reply(people.discord) : reply({}, 401);
  return realFetch(input, init);
};

/* -------------------------------------------------------------------------
   Talking to the Worker
   ------------------------------------------------------------------------- */

export async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await worker.fetch(new Request(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  }), env);
  const text = res.status === 204 || res.status === 302 ? '' : await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, location: res.headers.get('location'), data };
}

const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Walk the whole sign-in: start, the provider's redirect back, and the
 * exchange. Returns what each step produced, so a test can stop anywhere.
 */
export async function signIn(provider, { link, useNonce, tamperState } = {}) {
  const mine = nonce();
  const start = await call('GET', `/auth/start?provider=${provider}&nonce=${mine}${link ? `&link=${link}` : ''}`);
  if (start.status !== 302 || !start.location.startsWith('https://')) return { start };
  const authorize = new URL(start.location);
  const state = tamperState || authorize.searchParams.get('state');

  const back = await call('GET', `/auth/callback/${provider}?code=from-provider&state=${state}`);
  const done = back.location?.match(/#\/signed-in\/([a-f0-9]+)$/);
  if (!done) return { start, authorize, back, failed: back.location?.split('#/sign-in-failed/')[1] };

  const exchange = await call('POST', '/auth/exchange', { body: { code: done[1], nonce: useNonce || mine } });
  return { start, authorize, back, code: done[1], nonce: mine, exchange, token: exchange.data?.token };
}

export const googler = (sub, name, email, verified = true) => ({ sub, name, given_name: name, email, email_verified: verified, picture: null });
export const discorder = (id, name) => ({ id, username: name, global_name: name, avatar: null });

/* -------------------------------------------------------------------------
   The cases
   ------------------------------------------------------------------------- */

export function buildWorkerSuite() {
  const cases = [];
  const test = (name, run, opts = {}) => cases.push({ name, run, opts });

  test('both providers are offered when both are configured', async (t) => {
    const r = await call('GET', '/auth/providers');
    t.eq(r.data, { discord: true, google: true });
  });

  test('a provider with no secrets is not offered, and cannot be started', async (t) => {
    const saved = env.GOOGLE_CLIENT_SECRET;
    env.GOOGLE_CLIENT_SECRET = '';
    try {
      t.eq((await call('GET', '/auth/providers')).data.google, false);
      const start = await call('GET', `/auth/start?provider=google&nonce=${nonce()}`);
      t.ok(start.location.endsWith('#/sign-in-failed/provider-unavailable'));
    } finally {
      env.GOOGLE_CLIENT_SECRET = saved;
    }
  });

  test('signing in with Google sends the player to Google with the right request', async (t) => {
    const start = await call('GET', `/auth/start?provider=google&nonce=${nonce()}`);
    t.eq(start.status, 302);
    const url = new URL(start.location);
    t.eq(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    t.eq(url.searchParams.get('client_id'), 'google-app');
    t.eq(url.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/google');
    t.eq(url.searchParams.get('scope'), 'openid email profile');
    t.ok(url.searchParams.get('state'), 'a state is sent');
  });

  test('a first Google sign-in creates an account and returns to the app', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    t.ok(s.back.location.startsWith(`${SITE}#/signed-in/`), 'back to the app, with a code');
    t.ok(!s.back.location.includes(s.token), 'the session token itself is never in the URL');
    t.eq(s.exchange.status, 200);
    const me = await call('GET', '/api/me', { token: s.token });
    t.eq(me.data.name, 'Ada');
    t.eq(me.data.providers, ['google']);
    t.eq(me.data.gm, false);
  });

  test('signing in again with the same identity reaches the same account', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const first = await signIn('google');
    const second = await signIn('google');
    const a = await call('GET', '/api/me', { token: first.token });
    const b = await call('GET', '/api/me', { token: second.token });
    t.eq(a.data.id, b.data.id);
    const users = await d1('', { sql: 'SELECT COUNT(*) AS n FROM users', mode: 'first' });
    t.eq(users.n, 1);
  });

  test('Discord sign-in works through its original callback address too', async (t) => {
    people.discord = discorder('d-7', 'Bram');
    const mine = nonce();
    const start = await call('GET', `/auth/start?provider=discord&nonce=${mine}`);
    const state = new URL(start.location).searchParams.get('state');
    const back = await call('GET', `/auth/callback?code=x&state=${state}`);
    const code = back.location.match(/signed-in\/([a-f0-9]+)/)[1];
    const ex = await call('POST', '/auth/exchange', { body: { code, nonce: mine } });
    const me = await call('GET', '/api/me', { token: ex.data.token });
    t.eq(me.data.name, 'Bram');
    t.eq(me.data.providers, ['discord']);
  });

  test('a GM is recognised by Discord id, or by a verified Google address only', async (t) => {
    people.discord = discorder('dm-on-discord', 'The DM');
    const byDiscord = await signIn('discord');
    t.eq((await call('GET', '/api/me', { token: byDiscord.token })).data.gm, true);

    people.google = googler('g-dm', 'DM', 'DM@Example.com', true);
    const byGoogle = await signIn('google');
    t.eq((await call('GET', '/api/me', { token: byGoogle.token })).data.gm, true, 'matched regardless of case');

    people.google = googler('g-imposter', 'Not the DM', 'dm@example.com', false);
    const unverified = await signIn('google');
    t.eq((await call('GET', '/api/me', { token: unverified.token })).data.gm, false, 'an unverified address proves nothing');
  });

  test('no email address is stored', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    await signIn('google');
    const dump = JSON.stringify([
      await d1('', { sql: 'SELECT * FROM users', mode: 'all' }),
      await d1('', { sql: 'SELECT * FROM identities', mode: 'all' }),
    ]);
    t.ok(!dump.includes('ada@example.com'));
  });

  test('a one-time code works once, and only with the nonce that began it', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    const again = await call('POST', '/auth/exchange', { body: { code: s.code, nonce: s.nonce } });
    t.eq(again.status, 400, 'a second exchange fails');

    const stolen = await signIn('google', { useNonce: nonce() });
    t.eq(stolen.exchange.status, 400, 'a finished sign-in cannot be completed by another browser');
    t.eq(stolen.token, undefined);
  });

  test('an unknown or reused state is refused', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const forged = await signIn('google', { tamperState: 'a'.repeat(48) });
    t.eq(forged.failed, 'expired');

    const mine = nonce();
    const start = await call('GET', `/auth/start?provider=google&nonce=${mine}`);
    const state = new URL(start.location).searchParams.get('state');
    await call('GET', `/auth/callback/google?code=x&state=${state}`);
    const replay = await call('GET', `/auth/callback/google?code=x&state=${state}`);
    t.ok(replay.location.endsWith('sign-in-failed/expired'), 'a state is used up by its callback');
  });

  test('a start without a nonce is refused', async (t) => {
    const r = await call('GET', '/auth/start?provider=google');
    t.ok(r.location.endsWith('#/sign-in-failed/bad-request'));
  });

  test('a signed-in player can link Discord to their Google account', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const g = await signIn('google');
    const link = await call('POST', '/auth/link', { token: g.token });
    t.eq(link.status, 200);

    people.discord = discorder('d-100', 'ada_on_discord');
    const d = await signIn('discord', { link: link.data.link });
    t.eq(d.exchange.data.linked, true);

    const viaGoogle = await call('GET', '/api/me', { token: g.token });
    const viaDiscord = await call('GET', '/api/me', { token: d.token });
    t.eq(viaDiscord.data.id, viaGoogle.data.id, 'one account');
    t.eq(viaDiscord.data.providers, ['discord', 'google']);
    t.eq(viaDiscord.data.name, 'Ada', 'linking does not rename the account');

    people.discord = discorder('d-100', 'ada_on_discord');
    const later = await signIn('discord');
    t.eq((await call('GET', '/api/me', { token: later.token })).data.id, viaGoogle.data.id, 'and Discord alone reaches it later');
  });

  test('an identity already on another account cannot be linked away from it', async (t) => {
    people.discord = discorder('d-200', 'Bram');
    const bram = await signIn('discord');
    await call('PUT', '/api/characters/bram1', { token: bram.token, body: { name: 'Bram the Bold', ruleset: 'srd', levels: [] } });

    people.google = googler('g-300', 'Cai', 'cai@example.com');
    const cai = await signIn('google');
    const link = await call('POST', '/auth/link', { token: cai.token });
    people.discord = discorder('d-200', 'Bram');
    const attempt = await signIn('discord', { link: link.data.link });
    t.eq(attempt.failed, 'already-linked');

    const bramStill = await call('GET', '/api/characters', { token: bram.token });
    t.eq(bramStill.data.map((c) => c.name), ['Bram the Bold'], 'the other account keeps its identity and characters');
  });

  test('linking needs a signed-in account, and a link code expires with use', async (t) => {
    t.eq((await call('POST', '/auth/link')).status, 401);
    const bogus = await call('GET', `/auth/start?provider=discord&nonce=${nonce()}&link=${'b'.repeat(48)}`);
    t.ok(bogus.location.endsWith('sign-in-failed/link-expired'));
  });

  test('signing out ends the session', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    t.eq((await call('POST', '/auth/signout', { token: s.token })).status, 204);
    t.eq((await call('GET', '/api/me', { token: s.token })).status, 401);
  });

  test('only a hash of the session token is stored', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    const rows = await d1('', { sql: 'SELECT token FROM sessions', mode: 'all' });
    t.eq(rows.results.length, 1);
    t.ok(rows.results[0].token !== s.token);
  });

  /* --- homebrew ---------------------------------------------------------- */

  test('homebrew is saved under the account and read back', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    const warblade = { kind: 'class', name: 'Warblade', hd: 12, bab: 'good', updated: '2026-09-01T00:00:00.000Z' };
    t.eq((await call('PUT', '/api/content/wb1', { token: s.token, body: warblade })).status, 200);
    const listed = await call('GET', '/api/content', { token: s.token });
    t.eq(listed.data.length, 1);
    t.eq(listed.data[0].name, 'Warblade');
    t.eq(listed.data[0].id, 'wb1');
    t.eq(listed.data[0].hd, 12);
  });

  test('the same homebrew is there after signing in with the other provider', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const g = await signIn('google');
    await call('PUT', '/api/content/wb1', { token: g.token, body: { kind: 'class', name: 'Warblade', updated: '2026-09-01T00:00:00.000Z' } });
    const link = await call('POST', '/auth/link', { token: g.token });
    people.discord = discorder('d-100', 'ada');
    await signIn('discord', { link: link.data.link });
    const d = await signIn('discord');
    t.eq((await call('GET', '/api/content', { token: d.token })).data.map((e) => e.name), ['Warblade']);
  });

  test('nobody reads another account’s homebrew, the DM included', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const ada = await signIn('google');
    await call('PUT', '/api/content/secret', { token: ada.token, body: { kind: 'feat', name: 'Secret Technique', updated: '2026-09-01T00:00:00.000Z' } });

    people.discord = discorder('dm-on-discord', 'The DM');
    const dm = await signIn('discord');
    t.eq((await call('GET', '/api/content', { token: dm.token })).data, []);
    await call('DELETE', '/api/content/secret', { token: dm.token });
    t.eq((await call('GET', '/api/content', { token: ada.token })).data.length, 1, 'and cannot delete it either');
  });

  test('an older copy arriving late does not undo a newer edit', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    await call('PUT', '/api/content/wb1', { token: s.token, body: { kind: 'class', name: 'Warblade v2', updated: '2026-09-02T00:00:00.000Z' } });
    const late = await call('PUT', '/api/content/wb1', { token: s.token, body: { kind: 'class', name: 'Warblade v1', updated: '2026-09-01T00:00:00.000Z' } });
    t.eq(late.data.stale, true);
    t.eq((await call('GET', '/api/content', { token: s.token })).data[0].name, 'Warblade v2');
  });

  test('homebrew is deleted, refused without sign-in, and checked for kind', async (t) => {
    t.eq((await call('GET', '/api/content')).status, 401);
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const s = await signIn('google');
    t.eq((await call('PUT', '/api/content/x1', { token: s.token, body: { kind: 'spaceship', name: 'Nope' } })).status, 400);
    await call('PUT', '/api/content/x2', { token: s.token, body: { kind: 'item', name: 'Ring', updated: '2026-09-01T00:00:00.000Z' } });
    t.eq((await call('DELETE', '/api/content/x2', { token: s.token })).status, 204);
    t.eq((await call('GET', '/api/content', { token: s.token })).data, []);
  });

  /* --- characters and the DM's view ------------------------------------ */

  test('a site role alone shows nobody else’s characters', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const ada = await signIn('google');
    await call('PUT', '/api/characters/ada-srd', { token: ada.token, body: { name: 'Public Paladin', ruleset: 'srd', levels: [{}] } });
    await call('PUT', '/api/characters/ada-ant', { token: ada.token, body: { name: 'Campaign Rogue', ruleset: 'antaera', levels: [{}, {}, {}] } });

    people.discord = discorder('dm-on-discord', 'The GM');
    const gm = await signIn('discord');
    t.eq((await call('GET', '/api/characters', { token: gm.token })).data, [], 'being a GM is not being this player’s GM');
    t.eq((await call('GET', '/api/characters/ada-ant', { token: gm.token })).status, 404);
    t.eq((await call('PUT', '/api/characters/ada-ant', { token: gm.token, body: { name: 'Hijack' } })).status, 404);
  });

  test('a player sees only their own characters', async (t) => {
    people.google = googler('g-100', 'Ada', 'ada@example.com');
    const ada = await signIn('google');
    await call('PUT', '/api/characters/ada-ant', { token: ada.token, body: { name: 'Campaign Rogue', ruleset: 'antaera', levels: [] } });
    people.google = googler('g-200', 'Cai', 'cai@example.com');
    const cai = await signIn('google');
    t.eq((await call('GET', '/api/characters', { token: cai.token })).data, []);
    t.eq((await call('GET', '/api/characters/ada-ant', { token: cai.token })).status, 404);
  });

  /* --- the migration ----------------------------------------------------- */

  test('a Discord-only database upgrades without losing anyone', async (t) => {
    // Old shape: the user id WAS the Discord id; sheets had no ruleset column.
    await d1('', { sql: "INSERT INTO users (id, name, gm, created, last_seen) VALUES ('old-discord', 'Veteran', 0, '2026-01-01', '2026-01-01')" });
    await d1('', { sql: "INSERT INTO characters (id, owner, name, data, created, updated) VALUES ('vash', 'old-discord', 'Vashti', '{\"name\":\"Vashti\"}', '2026-01-01', '2026-01-01')" });
    await d1('', { sql: "INSERT INTO sessions (token, user_id, created, expires) VALUES ('rawcookie', 'old-discord', '2026-01-01', '2099-01-01')" });
    await d1('/migrate');

    people.discord = discorder('old-discord', 'Veteran');
    const s = await signIn('discord');
    const me = await call('GET', '/api/me', { token: s.token });
    t.eq(me.data.id, 'old-discord', 'the same account, not a new one');
    const roster = await call('GET', '/api/characters', { token: s.token });
    t.eq(roster.data.map((c) => [c.name, c.ruleset]), [['Vashti', 'antaera']]);
    const sessions = await d1('', { sql: "SELECT COUNT(*) AS n FROM sessions WHERE token = 'rawcookie'", mode: 'first' });
    t.eq(sessions.n, 0, 'old cookie sessions are void');
  }, { upTo: '0001' });

  /* --- roles --------------------------------------------------------------- */

  const account = async (profile, provider = 'google') => {
    people[provider] = profile;
    const s = await signIn(provider);
    const me = (await call('GET', '/api/me', { token: s.token })).data;
    return { token: s.token, id: me.id, me };
  };
  const setRole = (admin, id, role) => call('PUT', `/api/admin/users/${id}`, { token: admin.token, body: { role } });

  test('everyone starts as a player; the server settings name the first admin', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    t.eq([ada.me.role, ada.me.gm, ada.me.admin], ['player', false, false]);

    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    t.eq([boss.me.role, boss.me.gm, boss.me.admin], ['admin', true, true], 'an admin is also a GM');

    const bossByGoogle = await account(googler('g-boss', 'Boss', 'Admin@Example.com'));
    t.eq(bossByGoogle.me.role, 'admin', 'by verified Google address too');

    const fake = await account(googler('g-fake', 'Fake', 'admin@example.com', false));
    t.eq(fake.me.role, 'player', 'an unverified address is not enough');
  });

  test('an admin has every GM power: starting campaigns', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    t.eq((await call('POST', '/api/campaigns', { token: ada.token, body: { name: 'Mine' } })).status, 403, 'a player cannot');
    t.eq((await call('POST', '/api/campaigns', { token: boss.token, body: { name: 'Mine' } })).status, 201, 'an admin can');
  });

  test('only an admin can see or change accounts', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    const gm = await account(discorder('dm-on-discord', 'The GM'), 'discord');
    t.eq((await call('GET', '/api/admin/users', { token: ada.token })).status, 403);
    t.eq((await call('GET', '/api/admin/users', { token: gm.token })).status, 403, 'a GM is not an admin');
    t.eq((await setRole(gm, ada.id, 'gm')).status, 403);
    t.eq((await call('GET', '/api/admin/users')).status, 401);
  });

  test('an admin lists accounts with their role, sign-ins and how much they hold', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    await call('PUT', '/api/characters/c1', { token: ada.token, body: { name: 'One', ruleset: 'srd', levels: [] } });
    await call('PUT', '/api/content/k1', { token: ada.token, body: { kind: 'feat', name: 'Secret', updated: '2026-09-01T00:00:00.000Z' } });
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');

    const list = (await call('GET', '/api/admin/users', { token: boss.token })).data;
    t.eq(list.map((u) => [u.name, u.role]), [['Boss', 'admin'], ['Ada', 'player']], 'admins first');
    const adaRow = list.find((u) => u.name === 'Ada');
    t.eq([adaRow.characters, adaRow.content, adaRow.providers, adaRow.floor], [1, 1, ['google'], null]);
    t.eq(list.find((u) => u.name === 'Boss').floor, 'admin');
    t.ok(!JSON.stringify(list).includes('Secret'), 'how much, never what');
  });

  test('an admin makes a player a GM, and takes it away again', async (t) => {
    const cai = await account(googler('g-2', 'Cai', 'cai@example.com'));
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    const start = () => call('POST', '/api/campaigns', { token: cai.token, body: { name: 'Cai’s table' } });

    t.eq((await start()).status, 403);
    const promoted = await setRole(boss, cai.id, 'gm');
    t.eq(promoted.data.role, 'gm');
    t.eq((await start()).status, 201, 'at once, on the session already open');

    await setRole(boss, cai.id, 'player');
    t.eq((await start()).status, 403);
  });

  test('a role an admin gave survives signing in again', async (t) => {
    const cai = await account(googler('g-2', 'Cai', 'cai@example.com'));
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    await setRole(boss, cai.id, 'admin');
    const again = await account(googler('g-2', 'Cai', 'cai@example.com'));
    t.eq(again.me.role, 'admin', 'not being on the server lists does not demote');
  });

  test('the server settings are a floor the app cannot lower', async (t) => {
    const gm = await account(discorder('dm-on-discord', 'The GM'), 'discord');
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');

    const up = await setRole(boss, gm.id, 'admin');
    t.eq(up.data.role, 'admin', 'raising above the floor is fine');
    t.eq((await setRole(boss, gm.id, 'gm')).status, 200, 'and back down to it');
    const below = await setRole(boss, gm.id, 'player');
    t.eq(below.status, 409);
    t.ok(/server's settings/.test(below.data.error));
  });

  test('the site can never be left without an admin', async (t) => {
    const cai = await account(googler('g-2', 'Cai', 'cai@example.com'));
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    await setRole(boss, cai.id, 'admin');
    await setRole(cai, cai.id, 'player');   // Cai steps down; Boss remains
    t.eq((await call('GET', '/api/me', { token: cai.token })).data.role, 'player');

    // Now make an admin with no floor the only admin, and try to demote them.
    await setRole(boss, cai.id, 'admin');
    await d1('', { sql: "UPDATE identities SET floor = NULL" });
    await d1('', { sql: `UPDATE users SET role = 'player' WHERE id = '${boss.id}'` });
    const alone = await setRole(cai, cai.id, 'player');
    t.eq(alone.status, 409);
    t.ok(/only admin/.test(alone.data.error));
  });

  test('an admin removes an account and everything in it', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    await call('PUT', '/api/characters/c1', { token: ada.token, body: { name: 'One', ruleset: 'antaera', levels: [] } });
    await call('PUT', '/api/content/k1', { token: ada.token, body: { kind: 'feat', name: 'Secret', updated: '2026-09-01T00:00:00.000Z' } });
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');

    t.eq((await call('DELETE', `/api/admin/users/${ada.id}`, { token: boss.token })).status, 204);
    t.eq((await call('GET', '/api/me', { token: ada.token })).status, 401, 'their session ends');
    for (const table of ['users', 'identities', 'sessions', 'characters', 'content']) {
      const column = { users: 'id', identities: 'user_id', sessions: 'user_id', characters: 'owner', content: 'owner' }[table];
      const left = await d1('', { sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, params: [ada.id], mode: 'first' });
      t.eq(left.n, 0, `nothing left in ${table}`);
    }

    const again = await account(googler('g-1', 'Ada', 'ada@example.com'));
    t.ok(again.id !== ada.id, 'signing in afterwards starts a new, empty account');
  });

  test('removals that would lock the site or an admin out are refused', async (t) => {
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    t.eq((await call('DELETE', `/api/admin/users/${boss.id}`, { token: boss.token })).status, 409, 'not yourself');
    const cai = await account(googler('g-2', 'Cai', 'cai@example.com'));
    await setRole(boss, cai.id, 'admin');
    t.eq((await call('DELETE', `/api/admin/users/${boss.id}`, { token: cai.token })).status, 409, 'not an account the server settings name');
    t.eq((await setRole(boss, cai.id, 'wizard')).status, 400, 'and roles are only the three');
  });

  test('a GM from before roles existed is still a GM', async (t) => {
    // 0002's shape: gm was a flag on users and identities.
    await d1('', { sql: "INSERT INTO users (id, name, gm, created, last_seen) VALUES ('old-gm', 'Veteran GM', 1, '2026-01-01', '2026-01-01')" });
    await d1('', { sql: "INSERT INTO users (id, name, gm, created, last_seen) VALUES ('old-player', 'Veteran', 0, '2026-01-01', '2026-01-01')" });
    await d1('', { sql: "INSERT INTO identities (provider, subject, user_id, gm, created, last_seen) VALUES ('discord', 'old-gm', 'old-gm', 1, '2026-01-01', '2026-01-01')" });
    await d1('/migrate');
    const roles = await d1('', { sql: 'SELECT id, role FROM users ORDER BY id', mode: 'all' });
    t.eq(roles.results.map((r) => [r.id, r.role]), [['old-gm', 'gm'], ['old-player', 'player']]);
    const floor = await d1('', { sql: "SELECT floor FROM identities WHERE subject = 'old-gm'", mode: 'first' });
    t.eq(floor.floor, 'gm');
  }, { upTo: '0002' });

  return cases;
}

/** Reset the database before a case: fully migrated, or only partway. */
export const resetFor = (testCase) => d1('/reset', testCase.opts.upTo ? { upTo: testCase.opts.upTo } : {});
