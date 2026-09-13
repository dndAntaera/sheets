// Sessions: bearer tokens, stored only as hashes.
//
// Not cookies: the app and this Worker are on different sites, so a cookie would
// be third-party, and Safari refuses those.

import { now, randomToken, sha256 } from './http.js';
import { describe } from './roles.js';

export const SESSION_DAYS = 30;

export function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return match ? match[1] : null;
}

export async function createSession(env, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now(), expires).run();
  return token;
}

/** The signed-in account, or null. Expired sessions are removed as they are met. */
export async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.expires, u.id, u.name, u.avatar, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (new Date(row.expires) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(hash).run();
    return null;
  }
  return describe(row);
}

export async function endSession(env, request) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(token)).run();
}
