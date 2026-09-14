// Feedback: the Contact Me page's messages, and the admins' view of them.
//
//   POST   /api/feedback        anyone sends one, signed in or not
//   GET    /api/feedback        admins: every message, newest first (?status=new|read)
//   PUT    /api/feedback/:id    admins: mark one read or new
//   DELETE /api/feedback/:id    admins: remove one
//
// A message is checked against web/engine/feedback.js, the same rules the page
// uses. A sender is held to a few messages an hour, by a hash of their network
// address (or their account); the address itself is never stored. A form field
// people cannot see catches the bots that fill in every field: their message is
// quietly dropped.

import { fail, json, noContent, now, randomToken, sha256 } from '../http.js';
import { currentUser } from '../sessions.js';
import { accountCan } from '../policy.js';
import { checkFeedback, FEEDBACK_LIMITS } from '../../../web/engine/feedback.js';

async function sendFeedback({ request, env, body }) {
  const input = await body(16 * 1024);
  // The trap: a field hidden from people. Only a bot fills it in.
  if (String(input.website || '').trim()) return noContent();

  const check = checkFeedback(input);
  if (!check.ok) throw fail(400, Object.values(check.errors)[0]);

  const user = await currentUser(request, env);
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const sender = await sha256(user ? `user:${user.id}` : `ip:${address}|${env.FEEDBACK_SALT || 'sheets-feedback'}`);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE sender = ? AND created > ?').bind(sender, hourAgo).first();
  if ((recent?.n || 0) >= FEEDBACK_LIMITS.perHour) throw fail(429, 'that is a lot of messages at once; please try again in an hour');

  const { name, discord, email, message } = check.value;
  const id = randomToken(12);
  await env.DB.prepare(
    'INSERT INTO feedback (id, created, name, discord, email, message, user_id, status, sender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, now(), name, discord, email, message, user?.id || null, 'new', sender).run();
  return json({ ok: true, id }, 201);
}

async function listFeedback({ env, user, url }) {
  if (!accountCan.readFeedback(user)) throw fail(403, 'only an admin can do that');
  const status = url.searchParams.get('status');
  const where = status === 'new' || status === 'read' ? 'WHERE f.status = ?' : '';
  const statement = env.DB.prepare(
    `SELECT f.id, f.created, f.name, f.discord, f.email, f.message, f.status, f.user_id, u.name AS account_name
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       ${where}
      ORDER BY f.created DESC
      LIMIT 500`
  );
  const rows = await (where ? statement.bind(status) : statement).all();
  const counts = await env.DB.prepare("SELECT SUM(status = 'new') AS fresh, COUNT(*) AS total FROM feedback").first();
  return json({
    messages: (rows.results || []).map((r) => ({
      id: r.id,
      created: r.created,
      name: r.name,
      discord: r.discord,
      email: r.email,
      message: r.message,
      status: r.status,
      account: r.user_id ? { id: r.user_id, name: r.account_name } : null,
    })),
    counts: { new: counts?.fresh || 0, total: counts?.total || 0 },
  });
}

async function markFeedback({ env, user, params, body }) {
  if (!accountCan.readFeedback(user)) throw fail(403, 'only an admin can do that');
  const { status } = await body(256);
  if (status !== 'new' && status !== 'read') throw fail(400, 'status is new or read');
  const result = await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, params.id).run();
  if (!result.meta?.changes) throw fail(404, 'no message with that address');
  return json({ id: params.id, status });
}

async function removeFeedback({ env, user, params }) {
  if (!accountCan.readFeedback(user)) throw fail(403, 'only an admin can do that');
  await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(params.id).run();
  return noContent();
}

export const routes = [
  { method: 'POST', path: '/api/feedback', auth: 'none', handler: sendFeedback },
  { method: 'GET', path: '/api/feedback', auth: 'admin', handler: listFeedback },
  { method: 'PUT', path: '/api/feedback/:id', auth: 'admin', handler: markFeedback },
  { method: 'DELETE', path: '/api/feedback/:id', auth: 'admin', handler: removeFeedback },
];
