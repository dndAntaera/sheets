// Tests for the Contact Me page's messages: the rules on their own, then the
// routes - sending signed in or not, the bot trap, the hourly limit, and that
// only admins read, mark and delete - against the real Worker.
//
// Uses the plumbing from worker-suite.js. Run through test/worker.html.

import { call, signIn, people, googler, discorder } from './worker-suite.js';
import { accountCan } from '../worker/src/policy.js';
import { checkFeedback, FEEDBACK_LIMITS } from '../web/engine/feedback.js';

const account = async (profile, provider = 'google') => {
  people[provider] = profile;
  const s = await signIn(provider);
  const me = (await call('GET', '/api/me', { token: s.token })).data;
  return { token: s.token, id: me.id, name: me.name };
};

export function buildFeedbackSuite() {
  const cases = [];
  const test = (name, run, opts = {}) => cases.push({ name, run, opts });

  /* --- the rules, on their own ------------------------------------------- */

  test('a message: contact details optional, a real message required, each within its limit', (t) => {
    t.ok(checkFeedback({ message: 'The sheet is great, thank you.' }).ok, 'anonymous is fine');
    t.eq(checkFeedback({ name: '  Ada   Lovelace ', discord: '@ada.l', email: 'Ada@Example.com', message: 'Hello there, sheets!' }).value,
      { name: 'Ada Lovelace', discord: 'ada.l', email: 'ada@example.com', message: 'Hello there, sheets!' }, 'tidied');
    t.ok(checkFeedback({ message: 'too short' }).errors.message, 'at least ten characters');
    t.ok(checkFeedback({ message: 'x'.repeat(FEEDBACK_LIMITS.messageMax + 1) }).errors.message, 'and not too long');
    t.ok(checkFeedback({ email: 'not-an-email', message: 'A perfectly fine message.' }).errors.email);
    t.ok(checkFeedback({ discord: 'has spaces in it', message: 'A perfectly fine message.' }).errors.discord);
    t.eq(checkFeedback({ message: 'Line one\r\n\r\n\r\n\r\nLine two' }).value.message, 'Line one\n\nLine two', 'line breaks kept, blank runs trimmed');
  });

  test('only admins read feedback', (t) => {
    t.ok(accountCan.readFeedback({ id: 'a', role: 'admin' }));
    t.ok(!accountCan.readFeedback({ id: 'g', role: 'gm' }));
    t.ok(!accountCan.readFeedback({ id: 'p', role: 'player' }));
  });

  /* --- the routes ---------------------------------------------------------- */

  test('anyone sends a message, and an admin reads, marks and deletes it', async (t) => {
    const sent = await call('POST', '/api/feedback', { body: { name: 'Visitor', email: 'visitor@example.com', message: 'The shop needs a search box.' } });
    t.eq(sent.status, 201, 'sent without signing in');
    const player = await account(googler('g-player', 'Player One', 'player@example.com'));
    t.eq((await call('POST', '/api/feedback', { token: player.token, body: { discord: 'playerone', message: 'Traits are brilliant.' } })).status, 201, 'and signed in');

    t.eq((await call('GET', '/api/feedback')).status, 401, 'not signed in: no');
    t.eq((await call('GET', '/api/feedback', { token: player.token })).status, 403, 'a player: no');

    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    let list = await call('GET', '/api/feedback', { token: boss.token });
    t.eq([list.status, list.data.counts], [200, { new: 2, total: 2 }]);
    const mine = list.data.messages.find((m) => m.discord === 'playerone');
    t.eq([mine.account?.id, mine.account?.name], [player.id, 'Player One'], 'a signed-in message names its account');
    const visitor = list.data.messages.find((m) => m.name === 'Visitor');
    t.eq([visitor.email, visitor.account], ['visitor@example.com', null]);
    t.ok(!('sender' in visitor), 'the sender hash is never shown');

    t.eq((await call('PUT', `/api/feedback/${visitor.id}`, { token: player.token, body: { status: 'read' } })).status, 403, 'a player cannot mark one');
    t.eq((await call('PUT', `/api/feedback/${visitor.id}`, { token: boss.token, body: { status: 'read' } })).status, 200);
    list = await call('GET', '/api/feedback?status=new', { token: boss.token });
    t.eq([list.data.messages.length, list.data.counts.new], [1, 1], 'read ones leave New');
    t.eq((await call('PUT', `/api/feedback/${visitor.id}`, { token: boss.token, body: { status: 'shouted' } })).status, 400);

    t.eq((await call('DELETE', `/api/feedback/${visitor.id}`, { token: player.token })).status, 403, 'a player cannot delete one');
    t.eq((await call('DELETE', `/api/feedback/${visitor.id}`, { token: boss.token })).status, 204);
    t.eq((await call('GET', '/api/feedback?status=all', { token: boss.token })).data.counts.total, 1);
  });

  test('a message the rules refuse is not stored; the bot trap stores nothing and says nothing', async (t) => {
    const bad = await call('POST', '/api/feedback', { body: { email: 'nope', message: 'A perfectly fine message.' } });
    t.eq(bad.status, 400);
    const bot = await call('POST', '/api/feedback', { body: { message: 'Buy cheap potions now!!!', website: 'http://spam.example' } });
    t.eq(bot.status, 204, 'looks accepted');
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    t.eq((await call('GET', '/api/feedback', { token: boss.token })).data.counts.total, 0, 'but nothing was kept');
  });

  test('a sender is held to a few messages an hour', async (t) => {
    for (let i = 0; i < FEEDBACK_LIMITS.perHour; i++) {
      t.eq((await call('POST', '/api/feedback', { body: { message: `Message number ${i + 1}, sent.` } })).status, 201);
    }
    t.eq((await call('POST', '/api/feedback', { body: { message: 'One message too many.' } })).status, 429);
  });

  test('deleting an account keeps its messages, without the account', async (t) => {
    const player = await account(googler('g-leaving', 'Leaving Soon', 'leaving@example.com'));
    await call('POST', '/api/feedback', { token: player.token, body: { message: 'Goodbye, and thanks for the sheets.' } });
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    t.eq((await call('DELETE', `/api/admin/users/${player.id}`, { token: boss.token })).status, 204);
    const list = await call('GET', '/api/feedback', { token: boss.token });
    t.eq([list.data.counts.total, list.data.messages[0].account], [1, null]);
  });

  return cases;
}
