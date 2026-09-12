// Storing sheets.
//
// Two backends behind one interface. The browser one always works and is what
// a player gets before anyone has deployed anything; the API one takes over
// when config.apiBase is set and the player has signed in. The local copy is
// kept either way, so a sheet is never lost to a failed request - and a sheet
// edited offline is still there when the connection comes back.

import { config } from './config.js';

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

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

export function summarise(character) {
  return {
    id: character.id,
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
