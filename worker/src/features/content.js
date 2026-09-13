// Homebrew: each account's library, entry by entry.
//
// Strictly the account's own. Nobody - GMs and admins included - reads another
// player's library. Homebrew a GM needs to see arrives inside the sheet using it.

import { fail, json, noContent, now } from '../http.js';

const MAX_ENTRY_BYTES = 128 * 1024;
const MAX_ENTRIES_PER_ACCOUNT = 2000;
const CONTENT_KINDS = new Set(['race', 'class', 'feat', 'skill', 'item', 'template', 'feature']);

async function listContent({ env, user }) {
  const rows = await env.DB.prepare('SELECT data FROM content WHERE owner = ? ORDER BY kind, name').bind(user.id).all();
  return json((rows.results || []).map((r) => JSON.parse(r.data)));
}

/**
 * Store one entry. The browser chooses the id and the `updated` timestamp; the
 * newer timestamp wins, so an older copy arriving late does not undo a newer edit.
 */
async function putContent({ env, user, params, body }) {
  const entry = await body(MAX_ENTRY_BYTES);
  if (!CONTENT_KINDS.has(entry.kind)) throw fail(400, 'that is not a kind of content');
  const updated = typeof entry.updated === 'string' && !Number.isNaN(Date.parse(entry.updated)) ? entry.updated : now();
  entry.id = params.id;
  entry.updated = updated;

  const existing = await env.DB.prepare('SELECT updated FROM content WHERE owner = ? AND id = ?').bind(user.id, params.id).first();
  if (existing && existing.updated > updated) {
    return json({ ok: true, id: params.id, updated: existing.updated, stale: true });
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
  ).bind(user.id, params.id, entry.kind, String(entry.name || '').slice(0, 200), JSON.stringify(entry), now(), updated).run();

  return json({ ok: true, id: params.id, updated });
}

async function deleteContent({ env, user, params }) {
  await env.DB.prepare('DELETE FROM content WHERE owner = ? AND id = ?').bind(user.id, params.id).run();
  return noContent();
}

export const routes = [
  { method: 'GET', path: '/api/content', handler: listContent },
  { method: 'PUT', path: '/api/content/:id', handler: putContent },
  { method: 'DELETE', path: '/api/content/:id', handler: deleteContent },
];
