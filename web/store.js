// Storing sheets and homebrew.
//
// Two backends behind one interface. The browser always works, and is what a
// player gets before anyone has deployed anything or signed in. The server takes
// over the moment a player signs in with Google or Discord: their characters and
// their homebrew library are then kept under their account and follow them to
// any device. The browser keeps a working copy either way, so nothing is lost to
// a failed request, and work done offline is sent up when the connection returns.

import { config } from './config.js';
import { blankLibrary, CONTENT_TYPES, CONTENT_KINDS } from './engine/library.js';
import { mergeLibraries, flattenLibrary, groupLibrary } from './engine/sync.js';

const KEY = 'antaera-sheets/v1';
const indexKey = `${KEY}/index`;
const sheetKey = (id) => `${KEY}/sheet/${id}`;
const libraryKey = `${KEY}/library`;
const syncedKey = `${KEY}/library-synced`;
const tokenKey = `${KEY}/session`;
const nonceKey = `${KEY}/sign-in-nonce`;

const read = (key, fallback, store = localStorage) => {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value, store = localStorage) => {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   // a private window, or a full quota
  }
};

const forget = (key, store = localStorage) => {
  try { store.removeItem(key); } catch { /* nothing to do */ }
};

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/* -------------------------------------------------------------------------
   Characters, in this browser
   ------------------------------------------------------------------------- */

export const local = {
  name: 'this browser',

  list() {
    return read(indexKey, []);
  },

  load(id) {
    return read(sheetKey(id), null);
  },

  save(character) {
    const now = new Date().toISOString();
    character.meta = { ...character.meta, updated: now, created: character.meta?.created || now };
    // The roll snapshot is for the Discord bot, which reads it from the
    // account server. This browser writes it afresh on every save, so keeping
    // it here would be the largest thing in the file for no purpose.
    const { rolls, ...kept } = character;
    write(sheetKey(character.id), kept);
    const index = this.list().filter((row) => row.id !== character.id);
    index.push(summarise(character));
    write(indexKey, index.sort(byName));
    return character;
  },

  remove(id) {
    forget(sheetKey(id));
    write(indexKey, this.list().filter((row) => row.id !== id));
  },

  campaign() {
    return read(`${KEY}/campaign`, null);
  },

  setCampaign(settings) {
    write(`${KEY}/campaign`, settings);
    return settings;
  },
};

/* -------------------------------------------------------------------------
   The content library

   A player's shelf of homebrew, shared by every character made here - and, once
   they sign in, kept under their account. Every entry has an id, so the same
   entry can be recognised on another device even after it has been renamed.
   Sheets carry their own copies of what they use (see engine/library.js), so an
   empty library never breaks a character.
   ------------------------------------------------------------------------- */

/**
 * A shelf of homebrew, over somewhere to keep it. The player's own library and
 * a campaign's are both shelves; they differ only in where the entries live.
 *
 * @param readShelf   () => the stored shelf, or null
 * @param writeShelf  (shelf) => keep it; returns whether it was kept
 */
function shelfOf(readShelf, writeShelf) {
  return {
    load() {
      const stored = readShelf();
      const shelf = blankLibrary();
      let repaired = false;
      const seen = new Set();
      for (const kind of CONTENT_KINDS) {
        const plural = CONTENT_TYPES[kind].plural;
        shelf[plural] = (stored?.[plural] || []).map((entry) => {
          const e = { ...entry };
          // An entry with no id, or one a duplicate copied from another, gets its
          // own - otherwise two entries would overwrite each other on the server.
          if (!e.id || seen.has(e.id)) { e.id = newId(); repaired = true; }
          if (e.kind !== kind) { e.kind = kind; repaired = true; }
          if (!e.updated) { e.updated = e.created || new Date().toISOString(); repaired = true; }
          seen.add(e.id);
          return e;
        });
      }
      if (repaired) writeShelf(shelf);
      return shelf;
    },

    /** Keep the shelf - here and, for the player's, on their account when signed in. */
    save(shelf) {
      return writeShelf(shelf);
    },

    /** One kind's list, by its singular name: library.list('race'). */
    list(kind) {
      return this.load()[CONTENT_TYPES[kind].plural];
    },

    find(kind, name) {
      return this.list(kind).find((entry) => entry.name === name) || null;
    },

    /** Everything, as a file a player can hand to somebody else. */
    exportFile() {
      const shelf = this.load();
      // Ids and timestamps belong to this account; a recipient's copies are theirs.
      for (const list of Object.values(shelf)) {
        for (const entry of list) { delete entry.id; delete entry.updated; }
      }
      return { format: 'antaera-sheets-content', version: 1, exported: new Date().toISOString(), ...shelf };
    },

    /**
     * Merge a shared file into the shelf. An entry whose name is already on the
     * shelf replaces it, keeping the shelf's id - importing a newer copy of a
     * table's homebrew should update it, not sit beside it as a duplicate.
     *
     * Accepts a library export, a single entry, or an exported character, whose
     * embedded content is exactly the homebrew it was built with.
     */
    importFile(data) {
      const shelf = this.load();
      let added = 0;
      const stamp = new Date().toISOString();
      const take = (kind, entry) => {
        if (!entry?.name || !CONTENT_TYPES[kind]) return;
        const list = shelf[CONTENT_TYPES[kind].plural];
        const at = list.findIndex((e) => e.name === entry.name);
        const copy = { ...entry, kind, id: at >= 0 ? list[at].id : newId(), updated: stamp };
        if (at >= 0) list[at] = copy;
        else list.push({ ...copy, created: stamp });
        added++;
      };

      const source = data?.content && data?.levels ? data.content : data;
      if (source?.kind && source?.name) {
        take(source.kind, source);
      } else {
        for (const kind of CONTENT_KINDS) {
          for (const entry of source?.[CONTENT_TYPES[kind].plural] || []) take(kind, entry);
        }
      }
      this.save(shelf);
      return added;
    },

  };
}

/** The player's own library: kept in this browser, and on their account once signed in. */
export const library = {
  ...shelfOf(
    () => read(libraryKey, null),
    (shelf) => { const ok = write(libraryKey, shelf); scheduleLibrarySync(); return ok; },
  ),

  /** Remove the account's copy from this browser, on signing out. */
  clear() {
    forget(libraryKey);
    forget(syncedKey);
  },
};

/* -------------------------------------------------------------------------
   A campaign's homebrew library

   Written by the campaign's GMs, read by everyone in it. It lives on the server
   only: fetched when first needed, held in memory, and every change sent up as
   it is saved - an entry whose `updated` has changed is put, one that has gone
   is deleted. A failed request fires `campaign-library-failed` on window.
   ------------------------------------------------------------------------- */

const campaignShelves = new Map();

export function campaignLibrary(campaignId) {
  if (campaignShelves.has(campaignId)) return campaignShelves.get(campaignId);

  let stored = null;
  let loaded = false;
  const known = new Map();   // id -> updated, as the server has it
  let sending = Promise.resolve();

  const send = () => {
    sending = sending.then(async () => {
      const entries = flattenLibrary(stored || blankLibrary(), CONTENT_TYPES);
      const present = new Set();
      for (const entry of entries) {
        present.add(entry.id);
        if (known.get(entry.id) === entry.updated) continue;
        try {
          await remote.campaigns.content.put(campaignId, entry);
          known.set(entry.id, entry.updated);
        } catch (err) {
          window.dispatchEvent(new CustomEvent('campaign-library-failed', { detail: { campaignId, message: err.message } }));
        }
      }
      for (const id of [...known.keys()]) {
        if (present.has(id)) continue;
        try {
          await remote.campaigns.content.remove(campaignId, id);
          known.delete(id);
        } catch (err) {
          window.dispatchEvent(new CustomEvent('campaign-library-failed', { detail: { campaignId, message: err.message } }));
        }
      }
    });
    return sending;
  };

  const shelf = {
    ...shelfOf(
      () => (stored ? structuredClone(stored) : null),
      (next) => { stored = structuredClone(next); send(); return true; },
    ),
    campaignId,
    loaded: () => loaded,
    /** Fetch the campaign's entries from the server, replacing what is held. */
    async fetch() {
      await sending;   // edits made here reach the server before it is asked again
      const entries = await remote.campaigns.content.list(campaignId);
      stored = groupLibrary(entries, CONTENT_TYPES);
      known.clear();
      for (const e of entries) known.set(e.id, e.updated);
      loaded = true;
      return shelf;
    },
    /** Wait for changes already saved to reach the server. */
    flush: () => send(),
  };
  campaignShelves.set(campaignId, shelf);
  return shelf;
}

/* -------------------------------------------------------------------------
   Preferences
   ------------------------------------------------------------------------- */

export const preferences = {
  get(key, fallback = null) {
    return read(`${KEY}/pref/${key}`, fallback);
  },
  set(key, value) {
    write(`${KEY}/pref/${key}`, value);
    return value;
  },
};

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

export function summarise(character) {
  return {
    id: character.id,
    ruleset: character.ruleset || 'srd',
    name: character.name || 'Unnamed',
    player: character.player || '',
    build: character.meta?.build || '',
    level: (character.levels || []).length,
    updated: character.meta?.updated || null,
    owner: character.meta?.owner || null,
    draftStep: character.meta?.wizard?.step || null,
    revising: Boolean(character.meta?.wizard?.revision),
  };
}

/* -------------------------------------------------------------------------
   The account

   A session is a token the server issued, held here and sent as a bearer
   header. See worker/src/index.js for why it is not a cookie.
   ------------------------------------------------------------------------- */

export const account = {
  token: () => read(tokenKey, null),
  signedIn: () => Boolean(read(tokenKey, null)),
  setToken: (token) => write(tokenKey, token),
  clear: () => forget(tokenKey),
};

async function api(path, options = {}) {
  const token = account.token();
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${config.apiBase}${path}`, { ...options, headers });
  if (res.status === 401) {
    // The session has ended - expired, or signed out elsewhere. Forget it, so
    // the header offers sign-in again instead of failing quietly on every save.
    if (token) account.clear();
    throw Object.assign(new Error('not signed in'), { code: 401 });
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.error || `${path} returned ${res.status}`), { code: res.status });
  }
  return res.status === 204 ? null : res.json();
}

const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The characters this visit has loaded from, or saved to, the account server. */
const onServer = new Set();

export const remote = {
  name: 'your account',
  enabled: () => Boolean(config.apiBase),

  /** Which sign-in providers the server has been set up with. */
  providers: () => api('/auth/providers'),

  me: () => api('/api/me'),

  /**
   * Leave for Google or Discord. The nonce stays behind in this tab's
   * sessionStorage, and only this tab can complete the sign-in with it.
   */
  signIn(provider, { link, navigate = (url) => location.assign(url) } = {}) {
    const nonce = hex(24);
    write(nonceKey, nonce, sessionStorage);
    const params = new URLSearchParams({ provider, nonce });
    if (link) params.set('link', link);
    // The app wrapped for a phone asks to be sent back to itself (config.appReturnUrl).
    if (config.appReturnUrl) params.set('return', config.appReturnUrl);
    navigate(`${config.apiBase}/auth/start?${params}`);
  },

  /** Back from the provider with a one-time code: trade it for a session. */
  async completeSignIn(code) {
    const nonce = read(nonceKey, null, sessionStorage);
    forget(nonceKey, sessionStorage);
    if (!nonce) throw new Error('this sign-in was not started in this tab');
    const result = await api('/auth/exchange', { method: 'POST', body: JSON.stringify({ code, nonce }) });
    account.setToken(result.token);
    return result;
  },

  /**
   * Add a provider to the signed-in account - or, with `replace`, move the
   * account's sign-in at that provider to a different account there.
   */
  async link(provider, opts = {}) {
    const { link } = await api('/auth/link', { method: 'POST', body: JSON.stringify(opts.replace ? { replace: provider } : {}) });
    this.signIn(provider, { ...opts, link });
  },

  /** Stop signing in with a provider. The server keeps at least one. */
  unlink: (provider) => api(`/auth/identities/${encodeURIComponent(provider)}`, { method: 'DELETE' }),

  async signOut() {
    await flushLibrarySync().catch(() => {});
    await api('/auth/signout', { method: 'POST' }).catch(() => {});
    account.clear();
    library.clear();
    campaignShelves.clear();
  },

  list: () => api('/api/characters'),
  load: (id) => api(`/api/characters/${id}`).then((character) => { onServer.add(id); return character; }),
  // The server keeps the history of held choices itself, so a character it
  // already has is sent without it. Only one arriving for the first time - an
  // import, say - brings the history it carries.
  save: (character) => api(`/api/characters/${character.id}`, {
    method: 'PUT',
    body: JSON.stringify(onServer.has(character.id) ? { ...character, history: undefined } : character),
  }).then((saved) => { onServer.add(character.id); return saved; }),
  remove: (id) => api(`/api/characters/${id}`, { method: 'DELETE' }),

  /**
   * Campaigns. The server decides who may do each of these, by the rules in
   * worker/src/policy.js; a refusal arrives as an error with a readable message.
   */
  campaigns: {
    list: () => api('/api/campaigns'),
    create: (campaign) => api('/api/campaigns', { method: 'POST', body: JSON.stringify(campaign) }),
    get: (id) => api(`/api/campaigns/${id}`),
    update: (id, changes) => api(`/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(changes) }),
    remove: (id) => api(`/api/campaigns/${id}`, { method: 'DELETE' }),

    invite: (id, options = {}) => api(`/api/campaigns/${id}/invites`, { method: 'POST', body: JSON.stringify(options) }),
    withdrawInvite: (id, code) => api(`/api/campaigns/${id}/invites/${code}`, { method: 'DELETE' }),
    previewInvite: (code) => api(`/api/invites/${encodeURIComponent(code)}`),
    acceptInvite: (code) => api(`/api/invites/${encodeURIComponent(code)}/accept`, { method: 'POST' }),

    setMemberRole: (id, userId, role) => api(`/api/campaigns/${id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
    removeMember: (id, userId) => api(`/api/campaigns/${id}/members/${userId}`, { method: 'DELETE' }),

    /** The campaign's homebrew: members read it, its GMs write it. */
    content: {
      list: (id) => api(`/api/campaigns/${id}/content`),
      put: (id, entry) => api(`/api/campaigns/${id}/content/${entry.id}`, { method: 'PUT', body: JSON.stringify(entry) }),
      remove: (id, entryId) => api(`/api/campaigns/${id}/content/${entryId}`, { method: 'DELETE' }),
    },

    /** For its GMs: changes to the held choices of the campaign's characters, and marking them read. */
    changes: (id) => api(`/api/campaigns/${id}/changes`),
    changesSeen: (id) => api(`/api/campaigns/${id}/changes/seen`, { method: 'POST' }),

    addCharacter: (id, characterId) => api(`/api/campaigns/${id}/characters`, { method: 'POST', body: JSON.stringify({ characterId }) }),
    removeCharacter: (id, characterId) => api(`/api/campaigns/${id}/characters/${characterId}`, { method: 'DELETE' }),
  },

  /** Your profile and preferences, and the profiles of people you share a campaign with. */
  /** Messages from the Contact Me page: anyone sends one; only admins read them. */
  feedback: {
    send: (message) => api('/api/feedback', { method: 'POST', body: JSON.stringify(message) }),
    list: (status = null) => api(`/api/feedback${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    mark: (id, status) => api(`/api/feedback/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    remove: (id) => api(`/api/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  profile: {
    mine: () => api('/api/profile'),
    get: (id) => api(`/api/profile/${encodeURIComponent(id)}`),
    update: (changes) => api('/api/profile', { method: 'PUT', body: JSON.stringify(changes) }),
    setPreferences: (prefs) => api('/api/profile/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),
  },

  /** Accounts and roles. The server refuses all of these to anyone but an admin. */
  admin: {
    users: () => api('/api/admin/users'),
    setRole: (id, role) => api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ role }) }),
    removeUser: (id) => api(`/api/admin/users/${id}`, { method: 'DELETE' }),
  },

  content: {
    list: () => api('/api/content'),
    put: (entry) => api(`/api/content/${entry.id}`, { method: 'PUT', body: JSON.stringify(entry) }),
    remove: (id) => api(`/api/content/${id}`, { method: 'DELETE' }),
  },
};

/**
 * Save a character to the browser first, then to the account if signed in.
 *
 * The local write cannot fail in a way that loses work, and a server that is
 * down or a session that has expired must not stop a player from carrying on.
 */
export async function save(character) {
  local.save(character);
  if (!remote.enabled()) return { synced: false, reason: 'local build' };
  if (!account.signedIn()) return { synced: false, reason: 'not signed in' };
  try {
    const saved = await remote.save(character);
    // The server keeps the history; the sheet takes its copy back.
    if (Array.isArray(saved?.history)) character.history = saved.history;
    return { synced: true, recorded: Boolean(saved?.recorded) };
  } catch (err) {
    return { synced: false, reason: err.code === 401 ? 'not signed in' : err.message };
  }
}

/* -------------------------------------------------------------------------
   Keeping the library in step with the account
   ------------------------------------------------------------------------- */

let syncTimer = null;
let syncing = null;

/** Edits are gathered for a moment and sent together, not one per keystroke. */
function scheduleLibrarySync() {
  if (!remote.enabled() || !account.signedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncLibrary().catch(() => {}); }, 1500);
}

/** Run any pending sync now, instead of when the timer fires - before signing out, say. */
export function flushLibrarySync() {
  clearTimeout(syncTimer);
  syncTimer = null;
  return syncLibrary();
}

/**
 * Reconcile this browser's library with the account's: fetch the account's,
 * merge by id and timestamp (engine/sync.js decides), send what the server is
 * missing, delete what was deleted here, and keep what arrived from elsewhere.
 *
 * Fires `library-synced` on window with `{ changed }`, so a page showing the
 * library can redraw when entries have arrived from another device.
 */
export async function syncLibrary() {
  if (!remote.enabled() || !account.signedIn()) return { skipped: true };
  if (syncing) return syncing;

  syncing = (async () => {
    const server = await remote.content.list();
    const localEntries = flattenLibrary(library.load(), CONTENT_TYPES);
    const plan = mergeLibraries(localEntries, server, read(syncedKey, {}));

    if (plan.changed) write(libraryKey, groupLibrary(plan.entries, CONTENT_TYPES));

    // What the server has confirmed. An entry whose request fails stays out of
    // this map, so the next sync tries it again.
    const agreed = { ...plan.synced };
    const failures = [];
    for (const entry of plan.upload) {
      try {
        const reply = await remote.content.put(entry);
        if (reply?.stale) delete agreed[entry.id];   // a newer copy is already there; next sync takes it
      } catch (err) {
        failures.push(err);
        delete agreed[entry.id];
      }
    }
    for (const id of plan.remove) {
      try {
        await remote.content.remove(id);
      } catch (err) {
        failures.push(err);
        agreed[id] = read(syncedKey, {})[id];
      }
    }
    write(syncedKey, agreed);

    const result = { changed: plan.changed, uploaded: plan.upload.length, removed: plan.remove.length, failed: failures.length };
    window.dispatchEvent(new CustomEvent('library-synced', { detail: result }));
    return result;
  })();

  try {
    return await syncing;
  } finally {
    syncing = null;
  }
}
