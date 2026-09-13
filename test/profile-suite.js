// Tests for profiles and preferences: the rules on their own, then the routes -
// usernames, pictures, preferences, and who may see whose profile - against the
// real Worker on the dev server's SQLite stand-in.
//
// Uses the plumbing from worker-suite.js. Run through test/worker.html.

import { call, signIn, people, googler, discorder } from './worker-suite.js';
import { accountCan } from '../worker/src/policy.js';
import { checkUsername, normalizePreferences, isPictureData } from '../web/engine/preferences.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const account = async (profile, provider = 'google') => {
  people[provider] = profile;
  const s = await signIn(provider);
  const me = (await call('GET', '/api/me', { token: s.token })).data;
  return { token: s.token, id: me.id, name: me.name };
};

const withPicture = (who, url) => ({ ...who, picture: url });

export function buildProfileSuite() {
  const cases = [];
  const test = (name, run, opts = {}) => cases.push({ name, run, opts });

  /* --- the rules, on their own ------------------------------------------- */

  test('usernames: tidied, and held to letters, numbers and a little punctuation', (t) => {
    t.eq(checkUsername('  Ada   the  Bold ').name, 'Ada the Bold');
    t.eq(checkUsername('Æthelred Ōkami').ok, true, 'any script');
    t.eq(checkUsername("D'Artagnan-3").ok, true);
    t.eq(checkUsername('A').ok, false, 'too short');
    t.eq(checkUsername('x'.repeat(33)).ok, false, 'too long');
    t.eq(checkUsername('<script>').ok, false);
    t.eq(checkUsername('trailing-').ok, false, 'punctuation only between letters');
  });

  test('preferences: only settings that exist, with values they allow', (t) => {
    t.eq(normalizePreferences({ theme: 'dark', accent: 'gold', textSize: 'huge', font: 'Comic Sans' }), { theme: 'dark', accent: 'gold' });
    t.eq(normalizePreferences(null), {});
  });

  test('pictures: small PNG, JPEG or WebP data only', (t) => {
    t.ok(isPictureData(PNG));
    t.ok(!isPictureData('https://example.com/me.png'), 'not a link');
    t.ok(!isPictureData('data:image/svg+xml;base64,PHN2Zz4='), 'not SVG, which can carry script');
    t.ok(!isPictureData(`data:image/png;base64,${'A'.repeat(200_001)}`), 'not too big');
  });

  test('a profile is seen by its owner, an admin, or someone at the same table', (t) => {
    const player = { id: 'p', role: 'player' };
    t.ok(accountCan.viewProfile(player, 'p', false), 'your own');
    t.ok(!accountCan.viewProfile(player, 'q', false), 'not a stranger’s');
    t.ok(accountCan.viewProfile(player, 'q', true), 'someone you share a campaign with');
    t.ok(accountCan.viewProfile({ id: 'a', role: 'admin' }, 'q', false), 'an admin, anyone’s');
  });

  /* --- the routes ----------------------------------------------------------- */

  test('your profile starts from your sign-in, and counts what you keep', async (t) => {
    const ada = await account(withPicture(googler('g-1', 'Ada', 'ada@example.com'), 'https://pics.test/ada.png'));
    await call('PUT', '/api/characters/c1', { token: ada.token, body: { name: 'One', ruleset: 'srd', levels: [{}] } });
    const p = (await call('GET', '/api/profile', { token: ada.token })).data;
    t.eq([p.name, p.avatar, p.role, p.self, p.nameChosen, p.picture], ['Ada', 'https://pics.test/ada.png', 'player', true, false, 'auto']);
    t.eq(p.signIns.map((s) => [s.provider, s.name, s.avatar]), [['google', 'Ada', 'https://pics.test/ada.png']]);
    t.eq(p.counts, { characters: 1, homebrew: 0, campaigns: 0 });
    t.ok(p.created, 'with the day the account was made');
  });

  test('a chosen username is kept through sign-in, and shows wherever the name does', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    const changed = await call('PUT', '/api/profile', { token: ada.token, body: { name: '  Ada   Lovelace ' } });
    t.eq([changed.status, changed.data.name, changed.data.nameChosen], [200, 'Ada Lovelace', true]);

    people.google = googler('g-1', 'Ada From Google', 'ada@example.com');
    const again = await signIn('google');
    t.eq((await call('GET', '/api/me', { token: again.token })).data.name, 'Ada Lovelace', 'sign-in does not overwrite it');

    const gm = await account(discorder('dm-on-discord', 'The GM'), 'discord');
    const c = (await call('POST', '/api/campaigns', { token: gm.token, body: { name: 'The Table', ruleset: 'srd' } })).data;
    const { code } = (await call('POST', `/api/campaigns/${c.id}/invites`, { token: gm.token, body: {} })).data;
    await call('POST', `/api/invites/${code}/accept`, { token: again.token });
    const members = (await call('GET', `/api/campaigns/${c.id}`, { token: gm.token })).data.members;
    t.ok(members.some((m) => m.name === 'Ada Lovelace'), 'the campaign’s members list uses it');
  });

  test('a username must be valid, and not another account’s', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    await account(googler('g-2', 'Cai', 'cai@example.com'));
    t.eq((await call('PUT', '/api/profile', { token: ada.token, body: { name: 'A' } })).status, 400);
    t.eq((await call('PUT', '/api/profile', { token: ada.token, body: { name: '<b>Ada</b>' } })).status, 400);
    const taken = await call('PUT', '/api/profile', { token: ada.token, body: { name: 'CAI' } });
    t.eq([taken.status, taken.data.error], [409, 'that username is taken'], 'whatever its capitals');
    t.eq((await call('PUT', '/api/profile', { token: ada.token, body: { name: 'ADA' } })).status, 200, 'your own name, recapitalised, is yours');
  });

  test('a picture: uploaded, a sign-in’s, or none - and sign-in respects the choice', async (t) => {
    const ada = await account(withPicture(googler('g-1', 'Ada', 'ada@example.com'), 'https://pics.test/google.png'));
    const signBackIn = async (picture) => {
      people.google = withPicture(googler('g-1', 'Ada', 'ada@example.com'), picture);
      const s = await signIn('google');
      return (await call('GET', '/api/profile', { token: s.token })).data;
    };

    const uploaded = await call('PUT', '/api/profile', { token: ada.token, body: { picture: 'upload', data: PNG } });
    t.eq([uploaded.status, uploaded.data.avatar, uploaded.data.picture], [200, PNG, 'upload']);
    t.eq((await signBackIn('https://pics.test/google-2.png')).avatar, PNG, 'an upload stays through sign-in');

    t.eq((await call('PUT', '/api/profile', { token: ada.token, body: { picture: 'upload', data: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400);
    t.eq((await call('PUT', '/api/profile', { token: ada.token, body: { picture: 'provider', provider: 'discord' } })).status, 400, 'not a sign-in you have');

    const none = await call('PUT', '/api/profile', { token: ada.token, body: { picture: 'none' } });
    t.eq([none.data.avatar, none.data.picture], [null, 'none']);
    t.eq((await signBackIn('https://pics.test/google-3.png')).avatar, null, 'no picture stays no picture');

    const theirs = await call('PUT', '/api/profile', { token: ada.token, body: { picture: 'provider', provider: 'google' } });
    t.eq([theirs.data.avatar, theirs.data.picture], ['https://pics.test/google-3.png', 'provider:google']);
    t.eq((await signBackIn('https://pics.test/google-4.png')).avatar, 'https://pics.test/google-4.png', 'a sign-in’s picture follows that sign-in');
  });

  test('preferences are kept with the account, and arrive with /api/me', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    const saved = await call('PUT', '/api/profile/preferences', { token: ada.token, body: { theme: 'dark', accent: 'green', textSize: 'large', motion: 'reduced', extra: 'no' } });
    t.eq(saved.data, { theme: 'dark', accent: 'green', textSize: 'large', motion: 'reduced' });
    t.eq((await call('GET', '/api/me', { token: ada.token })).data.preferences, saved.data);
    t.eq((await call('PUT', '/api/profile/preferences', { token: ada.token, body: {} })).data, {}, 'and cleared back to the defaults');
  });

  test('someone else’s profile: at the same table, or as an admin, and never a stranger', async (t) => {
    const ada = await account(googler('g-1', 'Ada', 'ada@example.com'));
    const cai = await account(googler('g-2', 'Cai', 'cai@example.com'));
    const gm = await account(discorder('dm-on-discord', 'The GM'), 'discord');
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');

    t.eq((await call('GET', `/api/profile/${ada.id}`, { token: cai.token })).status, 404, 'a stranger sees nothing');
    t.eq((await call('GET', '/api/profile/nobody', { token: cai.token })).status, 404);

    const c = (await call('POST', '/api/campaigns', { token: gm.token, body: { name: 'The Table', ruleset: 'srd' } })).data;
    const { code } = (await call('POST', `/api/campaigns/${c.id}/invites`, { token: gm.token, body: {} })).data;
    await call('POST', `/api/invites/${code}/accept`, { token: ada.token });

    const seen = await call('GET', `/api/profile/${ada.id}`, { token: gm.token });
    t.eq([seen.status, seen.data.name, seen.data.self], [200, 'Ada', false]);
    t.eq(seen.data.campaigns, [{ id: c.id, name: 'The Table', role: 'player' }], 'with the campaigns they share');
    t.eq([seen.data.counts, seen.data.signIns, seen.data.preferences], [undefined, undefined, undefined], 'and nothing private');
    t.eq((await call('GET', `/api/profile/${gm.id}`, { token: ada.token })).data.campaigns[0].role, 'owner');

    t.eq((await call('GET', `/api/profile/${cai.id}`, { token: boss.token })).status, 200, 'an admin sees anyone’s');
  });

  return cases;
}
