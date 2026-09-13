// Accounts - admins only.
//
// Admins see who has an account, change site roles, and remove an account with
// everything in it. They see how much an account holds, never what. Refused,
// whoever asks: lowering an account below its floor from the server's settings;
// leaving the site with no admin; an admin removing their own account here.

import { fail, json, noContent } from '../http.js';
import { ROLES, describe, higher, rank } from '../roles.js';
import { accountFloor } from './auth.js';

const adminCount = async (env) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first())?.n || 0;

async function listUsers({ env }) {
  const users = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar, u.role, u.created, u.last_seen,
            (SELECT COUNT(*) FROM characters c WHERE c.owner = u.id) AS characters,
            (SELECT COUNT(*) FROM content k WHERE k.owner = u.id) AS content,
            (SELECT COUNT(*) FROM campaigns g WHERE g.owner = u.id) AS campaigns
       FROM users u
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'gm' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`
  ).all();
  const identities = await env.DB.prepare('SELECT user_id, provider, floor FROM identities').all();

  const byUser = new Map();
  for (const row of identities.results || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, { providers: [], floor: null });
    const entry = byUser.get(row.user_id);
    entry.providers.push(row.provider);
    if (row.floor) entry.floor = entry.floor ? higher(entry.floor, row.floor) : row.floor;
  }

  return json((users.results || []).map((u) => ({
    ...describe(u),
    created: u.created,
    lastSeen: u.last_seen,
    characters: u.characters,
    content: u.content,
    campaigns: u.campaigns,
    providers: (byUser.get(u.id)?.providers || []).sort(),
    floor: byUser.get(u.id)?.floor || null,
  })));
}

async function setRole({ env, user, params, body }) {
  const { role } = await body(1024);
  if (!ROLES.includes(role)) throw fail(400, 'a role is player, gm or admin');

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(params.id).first();
  if (!target) throw fail(404, 'no such account');

  const floor = await accountFloor(env, params.id);
  if (floor && rank(role) < rank(floor)) {
    throw fail(409, `the server's settings make this account at least ${floor}; change them there`);
  }
  if (target.role === 'admin' && role !== 'admin' && await adminCount(env) <= 1) {
    throw fail(409, 'this is the only admin; make someone else an admin first');
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, params.id).run();
  const updated = await env.DB.prepare('SELECT id, name, avatar, role FROM users WHERE id = ?').bind(params.id).first();
  return json({ ...describe(updated), changedBy: user.id });
}

/**
 * Remove an account. Its sign-ins, sessions, characters, homebrew and campaign
 * memberships go by the database's cascades; campaigns it owned are deleted,
 * and characters other players had in them are released from them.
 */
async function removeUser({ env, user, params }) {
  if (params.id === user.id) throw fail(409, 'an admin cannot remove their own account from here');

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(params.id).first();
  if (!target) return noContent();

  if (await accountFloor(env, params.id)) {
    throw fail(409, "the server's settings name this account; remove it from them first");
  }
  if (target.role === 'admin' && await adminCount(env) <= 1) {
    throw fail(409, 'this is the only admin');
  }

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(params.id).run();
  return noContent();
}

export const routes = [
  { method: 'GET', path: '/api/admin/users', auth: 'admin', handler: listUsers },
  { method: 'PUT', path: '/api/admin/users/:id', auth: 'admin', handler: setRole },
  { method: 'DELETE', path: '/api/admin/users/:id', auth: 'admin', handler: removeUser },
];
