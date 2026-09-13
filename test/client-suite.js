// Tests for the app's side of accounts: signing in through the real store, and
// keeping a homebrew library in step across two devices.
//
// Nothing is faked on this side. web/store.js runs as it does in the app, its
// requests go to the real Worker (imported, not deployed), and the Worker's
// database is the dev server's SQLite stand-in. Only Google and Discord are
// pretend - see test/worker-suite.js.
//
// A "device" is a snapshot of this page's storage: switching devices swaps the
// snapshot in. Run with scripts/serve.py and open test/client.html.

import worker from '../worker/src/index.js';
import { env, people, googler, d1 } from './worker-suite.js';
import { config } from '../web/config.js';
import { remote, account, library, syncLibrary, flushLibrarySync } from '../web/store.js';

const API = 'https://api.test';
config.apiBase = API;

// Requests to the API go to the Worker in this page; everything else - the fake
// providers, the database stand-in - goes wherever worker-suite.js sends it.
const underlying = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(API)) return worker.fetch(new Request(url, { ...init, redirect: 'manual' }), env);
  return underlying(input, init);
};

/* -------------------------------------------------------------------------
   Devices
   ------------------------------------------------------------------------- */

const OURS = 'antaera-sheets/';

function snapshot() {
  const grab = (store) => Object.fromEntries(Object.keys(store).filter((k) => k.startsWith(OURS)).map((k) => [k, store.getItem(k)]));
  return { local: grab(localStorage), session: grab(sessionStorage) };
}

function restore(snap) {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of Object.keys(store)) if (key.startsWith(OURS)) store.removeItem(key);
  }
  for (const [k, v] of Object.entries(snap.local)) localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(snap.session)) sessionStorage.setItem(k, v);
}

const blankDevice = () => restore({ local: {}, session: {} });

/* -------------------------------------------------------------------------
   Signing in through the store, as the app does
   ------------------------------------------------------------------------- */

/**
 * remote.signIn navigates away; here the "navigation" is captured and walked
 * through the Worker by hand - start, the provider's redirect back - and the
 * app's own remote.completeSignIn finishes it, exactly as on return to the app.
 */
async function signInAs(profile, provider = 'google') {
  people[provider] = profile;
  let startUrl = null;
  remote.signIn(provider, { navigate: (url) => { startUrl = url; } });
  const start = await worker.fetch(new Request(startUrl), env);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await worker.fetch(new Request(`${API}/auth/callback/${provider}?code=ok&state=${state}`), env);
  const code = back.headers.get('location').match(/signed-in\/([a-f0-9]+)$/)[1];
  await remote.completeSignIn(code);
  return code;
}

const stamp = (offsetMinutes = 0) => new Date(Date.UTC(2026, 8, 1, 12, offsetMinutes)).toISOString();

function addClass(name, updated, extra = {}) {
  const shelf = library.load();
  shelf.classes.push({ kind: 'class', name, hd: 12, bab: 'good', created: updated, updated, ...extra });
  library.save(shelf);
}

/* -------------------------------------------------------------------------
   The cases
   ------------------------------------------------------------------------- */

export function buildClientSuite() {
  const cases = [];
  const test = (name, run) => cases.push({ name, run });

  test('the store signs in with Google and holds the session', async (t) => {
    t.ok(!account.signedIn());
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    t.ok(account.signedIn());
    const me = await remote.me();
    t.eq(me.name, 'Ada');
    t.eq(me.providers, ['google']);
  });

  test('a sign-in cannot be finished by a tab that did not start it', async (t) => {
    people.google = googler('g-1', 'Ada', 'ada@example.com');
    let startUrl = null;
    remote.signIn('google', { navigate: (url) => { startUrl = url; } });
    const start = await worker.fetch(new Request(startUrl), env);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const back = await worker.fetch(new Request(`${API}/auth/callback/google?code=ok&state=${state}`), env);
    const code = back.headers.get('location').match(/signed-in\/([a-f0-9]+)$/)[1];

    sessionStorage.clear();   // another tab: no nonce
    let error = null;
    try { await remote.completeSignIn(code); } catch (err) { error = err; }
    t.ok(error, 'refused');
    t.ok(!account.signedIn());
  });

  test('homebrew written before signing in is saved to the account on sign-in', async (t) => {
    addClass('Warblade', stamp(0));
    addClass('Crusader', stamp(1));
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    const result = await flushLibrarySync();
    t.eq(result.uploaded, 2);
    const onServer = await remote.content.list();
    t.eq(onServer.map((e) => e.name).sort(), ['Crusader', 'Warblade']);
    t.ok(onServer.every((e) => e.kind === 'class' && e.id));
  });

  test('a second device receives the homebrew, and edits travel both ways', async (t) => {
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    addClass('Warblade', stamp(0), { hd: 10 });
    await flushLibrarySync();
    const deviceA = snapshot();

    // Device B: nothing in storage; the same player signs in.
    blankDevice();
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    const pulled = await syncLibrary();
    t.ok(pulled.changed, 'entries arrived');
    t.eq(library.list('class').map((c) => [c.name, c.hd]), [['Warblade', 10]]);

    // B fixes the hit die.
    const shelf = library.load();
    shelf.classes[0] = { ...shelf.classes[0], hd: 12, updated: stamp(30) };
    library.save(shelf);
    await flushLibrarySync();

    // Back on A, which still has the old copy.
    restore(deviceA);
    t.eq(library.list('class')[0].hd, 10);
    await syncLibrary();
    t.eq(library.list('class')[0].hd, 12, 'the newer edit from B arrives');
  });

  test('a deletion on one device removes the entry on the other', async (t) => {
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    addClass('Warblade', stamp(0));
    addClass('Swordsage', stamp(1));
    await flushLibrarySync();
    const deviceA = snapshot();

    blankDevice();
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    await syncLibrary();
    const deviceB = snapshot();

    restore(deviceA);
    const shelf = library.load();
    shelf.classes = shelf.classes.filter((c) => c.name !== 'Swordsage');
    library.save(shelf);
    const sent = await flushLibrarySync();
    t.eq(sent.removed, 1);
    t.eq((await remote.content.list()).map((e) => e.name), ['Warblade']);

    restore(deviceB);
    t.eq(library.list('class').length, 2);
    await syncLibrary();
    t.eq(library.list('class').map((c) => c.name), ['Warblade']);
  });

  test('signing out takes the library off this browser but not off the account', async (t) => {
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    addClass('Warblade', stamp(0));
    await remote.signOut();   // flushes the pending edit first
    t.ok(!account.signedIn());
    t.eq(library.list('class'), [], 'gone from this browser');

    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    await syncLibrary();
    t.eq(library.list('class').map((c) => c.name), ['Warblade'], 'back from the account');
  });

  test('another account never receives this library', async (t) => {
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    addClass('Warblade', stamp(0));
    await remote.signOut();

    await signInAs(googler('g-2', 'Cai', 'cai@example.com'));
    await syncLibrary();
    t.eq(library.list('class'), []);
  });

  test('an ended session is forgotten, so sign-in is offered again', async (t) => {
    await signInAs(googler('g-1', 'Ada', 'ada@example.com'));
    await d1('', { sql: 'DELETE FROM sessions' });
    let error = null;
    try { await remote.me(); } catch (err) { error = err; }
    t.eq(error?.code, 401);
    t.ok(!account.signedIn());
  });

  return cases;
}

export { snapshot, restore, blankDevice, signInAs };
