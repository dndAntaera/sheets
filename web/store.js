// Storing sheets.
//
// Two backends behind one interface. The browser one always works and is what
// a player gets before anyone has deployed anything; the API one takes over
// when config.apiBase is set and the player has signed in. The local copy is
// kept either way, so a sheet is never lost to a failed request - and a sheet
// edited offline is still there when the connection comes back.

import { config } from './config.js';
import { blankLibrary, CONTENT_TYPES, CONTENT_KINDS } from './engine/library.js';

const KEY = 'antaera-sheets/v1';
const indexKey = `${KEY}/index`;
const sheetKey = (id) => `${KEY}/sheet/${id}`;

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   // a private window, or a full quota
  }
};

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* -------------------------------------------------------------------------
   The browser
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
    write(sheetKey(character.id), character);
    const index = this.list().filter((row) => row.id !== character.id);
    index.push(summarise(character));
    write(indexKey, index.sort(byName));
    return character;
  },

  remove(id) {
    try {
      localStorage.removeItem(sheetKey(id));
    } catch { /* nothing to do */ }
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

   A player's shelf of homebrew, kept in this browser and shared by every
   character made here. Sheets carry their own copies of what they use (see
   engine/library.js), so clearing the library never breaks a character - it
   only means the next character has to be given the Warblade again.
   ------------------------------------------------------------------------- */

const libraryKey = `${KEY}/library`;

export const library = {
  load() {
    const stored = read(libraryKey, null);
    const shelf = blankLibrary();
    if (stored) for (const plural of Object.keys(shelf)) shelf[plural] = stored[plural] || [];
    return shelf;
  },

  save(shelf) {
    return write(libraryKey, shelf);
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
    return {
      format: 'antaera-sheets-content',
      version: 1,
      exported: new Date().toISOString(),
      ...this.load(),
    };
  },

  /**
   * Merge a shared file into the shelf. An entry with a name already on the
   * shelf replaces it - importing a newer copy of your group's homebrew should
   * update it, not sit beside it as a duplicate.
   *
   * Accepts a library export, a single entry, or an exported character, whose
   * embedded content is exactly the homebrew it was built with.
   */
  importFile(data) {
    const shelf = this.load();
    let added = 0;
    const take = (kind, entry) => {
      if (!entry?.name || !CONTENT_TYPES[kind]) return;
      const list = shelf[CONTENT_TYPES[kind].plural];
      const at = list.findIndex((e) => e.name === entry.name);
      const copy = { ...entry, kind, updated: new Date().toISOString() };
      if (at >= 0) list[at] = copy;
      else list.push(copy);
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
  };
}

/* -------------------------------------------------------------------------
   The server
   ------------------------------------------------------------------------- */

async function api(path, options = {}) {
  const res = await fetch(`${config.apiBase}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401) throw Object.assign(new Error('not signed in'), { code: 401 });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const remote = {
  name: 'the campaign server',
  enabled: () => Boolean(config.apiBase),

  me: () => api('/api/me'),
  signInUrl: () => `${config.apiBase}/auth/start`,
  signOut: () => api('/auth/signout', { method: 'POST' }),

  list: () => api('/api/characters'),
  load: (id) => api(`/api/characters/${id}`),
  save: (character) => api(`/api/characters/${character.id}`, {
    method: 'PUT',
    body: JSON.stringify(character),
  }),
  remove: (id) => api(`/api/characters/${id}`, { method: 'DELETE' }),

  campaign: () => api('/api/campaign'),
  setCampaign: (settings) => api('/api/campaign', {
    method: 'PUT',
    body: JSON.stringify(settings),
  }),
};

/**
 * Save to the browser first, then to the server if there is one.
 *
 * The order matters: the local write cannot fail in a way that loses work, and
 * a server that is down or a session that has expired must not stop a player
 * from carrying on. `synced` says which happened, and the header shows it.
 */
export async function save(character) {
  local.save(character);
  if (!remote.enabled()) return { synced: false, reason: 'local build' };
  try {
    await remote.save(character);
    return { synced: true };
  } catch (err) {
    return { synced: false, reason: err.code === 401 ? 'not signed in' : err.message };
  }
}
