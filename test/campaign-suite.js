// Tests for campaigns: the permission rules on their own, then the whole thing -
// making a campaign, inviting, joining, bringing characters, settings, leaving -
// against the real Worker on the dev server's SQLite stand-in.
//
// Uses the plumbing from worker-suite.js. Run through test/worker.html.

import { call, signIn, people, googler, discorder, d1 } from './worker-suite.js';
import { campaignCan, campaignRole, characterAccess, characterCan } from '../worker/src/policy.js';
import { normalizeSettings, settableModules, applyCampaign } from '../web/engine/campaign.js';
import { VARIANT_MODULES } from '../web/engine/modules.js';
import srd from '../web/data/rulesets/srd.json' with { type: 'json' };
import antaera from '../web/data/rulesets/antaera.json' with { type: 'json' };

const account = async (profile, provider = 'google') => {
  people[provider] = profile;
  const s = await signIn(provider);
  const me = (await call('GET', '/api/me', { token: s.token })).data;
  return { token: s.token, id: me.id, name: me.name };
};

const gmAccount = () => account(discorder('dm-on-discord', 'The GM'), 'discord');
const player = (n) => account(googler(`g-${n}`, n, `${n.toLowerCase()}@example.com`));

async function campaignWith(gm, body = {}) {
  const r = await call('POST', '/api/campaigns', { token: gm.token, body: { name: 'The Sunless Road', ruleset: 'srd', ...body } });
  return r.data;
}

async function invite(by, campaignId, body = {}) {
  return (await call('POST', `/api/campaigns/${campaignId}/invites`, { token: by.token, body })).data;
}

async function join(who, code) {
  return call('POST', `/api/invites/${code}/accept`, { token: who.token });
}

async function sheet(who, id, body = {}) {
  await call('PUT', `/api/characters/${id}`, { token: who.token, body: { name: id, ruleset: 'srd', levels: [{}], ...body } });
  return id;
}

export function buildCampaignSuite() {
  const cases = [];
  const test = (name, run, opts = {}) => cases.push({ name, run, opts });

  /* --- the rules, on their own ------------------------------------------- */

  test('policy: roles within a campaign', async (t) => {
    const campaign = { id: 'c', owner: 'o' };
    t.eq(campaignRole(campaign, { role: 'gm' }, 'o'), 'owner', 'the owner is the owner, whatever the membership says');
    t.eq(campaignRole(campaign, { role: 'gm' }, 'x'), 'gm');
    t.eq(campaignRole(campaign, { role: 'player' }, 'x'), 'player');
    t.eq(campaignRole(campaign, null, 'x'), null);

    t.ok(campaignCan.invite('gm', 'player') && !campaignCan.invite('gm', 'gm') && campaignCan.invite('owner', 'gm'));
    t.ok(!campaignCan.invite('player', 'player'));
    t.ok(campaignCan.removeMember('gm', 'player', false), 'a GM removes a player');
    t.ok(!campaignCan.removeMember('gm', 'gm', false), 'but not another GM');
    t.ok(campaignCan.removeMember('owner', 'gm', false));
    t.ok(!campaignCan.removeMember('owner', 'owner', true), 'the owner cannot leave');
    t.ok(campaignCan.removeMember('player', 'player', true), 'anyone else can');
    t.ok(!campaignCan.setMemberRole('gm', 'player') && campaignCan.setMemberRole('owner', 'player'));
  });

  test('policy: who reaches a character', async (t) => {
    const loose = { owner: 'o', campaign_id: null };
    const seated = { owner: 'o', campaign_id: 'c' };
    t.eq(characterAccess('o', loose, null), 'owner');
    t.eq(characterAccess('x', loose, 'gm'), null, 'a GM of nothing in particular sees nothing');
    t.eq(characterAccess('x', seated, 'gm'), 'gm');
    t.eq(characterAccess('x', seated, 'owner'), 'gm');
    t.eq(characterAccess('x', seated, 'player', false), null);
    t.eq(characterAccess('x', seated, 'player', true), 'party');
    t.ok(characterCan.edit('gm') && !characterCan.edit('party') && !characterCan.delete('gm'));
  });

  test('settings: only what exists for the ruleset, coerced', async (t) => {
    t.eq(settableModules(srd), ['gestalt', 'actionPoints', 'traitsFlaws', ...VARIANT_MODULES], 'the SRD hands every variant to the GM');
    t.eq(settableModules(antaera), ['gestalt'], 'Antaera only hands over gestalt');

    const { settings, dropped } = normalizeSettings({
      modules: { gestalt: 'true', taint: false },
      startingLevel: 99,
      partyVisible: 1,
      link: 'javascript:alert(1)',
      favouriteColour: 'blue',
    }, srd);
    t.eq(settings.modules, { gestalt: true });
    t.eq(settings.startingLevel, 20, 'clamped');
    t.eq(settings.partyVisible, true);
    t.eq(settings.link, undefined, 'only http and https links');
    t.ok(dropped.includes('modules.taint') && dropped.includes('favouriteColour') && dropped.includes('link'));
  });

  test('settings: a campaign’s choices become the character’s rules', async (t) => {
    const rules = { ruleset: srd };
    const { rules: applied, overrides } = applyCampaign(rules, { settings: { modules: { gestalt: true }, startingLevel: 5 } });
    t.eq(overrides, { gestalt: true, actionPoints: false, traitsFlaws: false, ...Object.fromEntries(VARIANT_MODULES.map((m) => [m, false])) }, 'unset variants take the ruleset default');
    t.eq(applied.ruleset.startingLevel, 5);
    t.eq(srd.startingLevel, 1, 'the ruleset itself is untouched');
  });

  /* --- making one --------------------------------------------------------- */

  test('a GM starts a campaign and is its owner; a player cannot', async (t) => {
    const ada = await player('Ada');
    t.eq((await call('POST', '/api/campaigns', { token: ada.token, body: { name: 'Nope' } })).status, 403);

    const gm = await gmAccount();
    const made = await call('POST', '/api/campaigns', {
      token: gm.token,
      body: { name: 'The Sunless Road', ruleset: 'antaera', description: 'Below the ice.', settings: { modules: { gestalt: true, taint: false } } },
    });
    t.eq(made.status, 201);
    t.eq([made.data.role, made.data.ruleset, made.data.settings.modules], ['owner', 'antaera', { gestalt: true }]);
    t.eq(made.data.dropped, ['modules.taint'], 'says what it would not accept');

    const mine = (await call('GET', '/api/campaigns', { token: gm.token })).data;
    t.eq(mine.map((c) => [c.name, c.role, c.memberCount]), [['The Sunless Road', 'owner', 1]]);
  });

  test('a campaign needs a name and a ruleset the server knows', async (t) => {
    const gm = await gmAccount();
    t.eq((await call('POST', '/api/campaigns', { token: gm.token, body: { name: '  ' } })).status, 400);
    t.eq((await call('POST', '/api/campaigns', { token: gm.token, body: { name: 'X', ruleset: 'pathfinder' } })).status, 400);
  });

  /* --- inviting and joining -------------------------------------------- */

  test('a player joins with an invitation, and sees the campaign', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const inv = await invite(gm, c.id);
    t.ok(/^[A-HJ-NP-Z2-9]{10}$/.test(inv.code), 'a short code a person can type');

    const ada = await player('Ada');
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: ada.token })).status, 404, 'not before joining');

    const preview = await call('GET', `/api/invites/${inv.code.toLowerCase()}`, { token: ada.token });
    t.eq([preview.data.campaign.name, preview.data.ownerName, preview.data.role, preview.data.currentRole],
      ['The Sunless Road', 'The GM', 'player', null], 'codes are not case-sensitive');

    const joined = await join(ada, inv.code);
    t.eq([joined.data.joined, joined.data.role], [true, 'player']);
    const view = (await call('GET', `/api/campaigns/${c.id}`, { token: ada.token })).data;
    t.eq(view.role, 'player');
    t.eq(view.members.map((m) => [m.name, m.role]), [['The GM', 'owner'], ['Ada', 'player']]);
    t.eq(view.invites, undefined, 'players do not see the invitations');
  });

  test('invitations run out, expire, and can be withdrawn', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const once = await invite(gm, c.id, { maxUses: 1 });
    t.eq((await join(await player('Ada'), once.code)).status, 200);
    t.eq((await join(await player('Cai'), once.code)).status, 410, 'used up');

    const stale = await invite(gm, c.id);
    await d1('', { sql: "UPDATE campaign_invites SET expires = '2000-01-01T00:00:00.000Z' WHERE code = ?", params: [stale.code] });
    t.eq((await join(await player('Bo'), stale.code)).status, 410, 'expired');

    const withdrawn = await invite(gm, c.id);
    await call('DELETE', `/api/campaigns/${c.id}/invites/${withdrawn.code}`, { token: gm.token });
    t.eq((await join(await player('Di'), withdrawn.code)).status, 404);

    const listed = (await call('GET', `/api/campaigns/${c.id}`, { token: gm.token })).data.invites;
    t.eq(listed.map((i) => i.active).sort(), [false, false]);
  });

  test('joining twice changes nothing and uses no place', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const inv = await invite(gm, c.id, { maxUses: 2 });
    const ada = await player('Ada');
    await join(ada, inv.code);
    const again = await join(ada, inv.code);
    t.eq(again.data.joined, false);
    const listed = (await call('GET', `/api/campaigns/${c.id}`, { token: gm.token })).data.invites;
    t.eq(listed[0].uses, 1);
    t.eq((await join(gm, inv.code)).data.role, 'owner', 'the owner is not made a player by their own link');
  });

  test('only the people running a campaign invite, and only its owner invites GMs', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    t.eq((await call('POST', `/api/campaigns/${c.id}/invites`, { token: ada.token, body: {} })).status, 403);

    const cai = await player('Cai');
    await join(cai, (await invite(gm, c.id, { role: 'gm' })).code);
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: cai.token })).data.role, 'gm', 'a GM invitation makes a co-GM');
    t.eq((await call('POST', `/api/campaigns/${c.id}/invites`, { token: cai.token, body: {} })).status, 201, 'who invites players');
    t.eq((await call('POST', `/api/campaigns/${c.id}/invites`, { token: cai.token, body: { role: 'gm' } })).status, 403, 'but not GMs');
  });

  /* --- characters at the table ------------------------------------------ */

  test('a player brings a character, and the campaign’s GM can read and edit it', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm, { ruleset: 'antaera' });
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti', { ruleset: 'srd' });

    const added = await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });
    t.eq(added.data.ruleset, 'antaera', 'it takes the campaign’s ruleset');

    const asGm = await call('GET', '/api/characters/vashti', { token: gm.token });
    t.eq([asGm.status, asGm.data.campaignId, asGm.data.ruleset, asGm.data.access], [200, c.id, 'antaera', 'gm']);
    t.eq((await call('PUT', '/api/characters/vashti', { token: gm.token, body: { ...asGm.data, name: 'Vashti, edited by the GM', ruleset: 'srd' } })).status, 200);
    const after = (await call('GET', '/api/characters/vashti', { token: ada.token })).data;
    t.eq([after.name, after.ruleset, after.campaignId], ['Vashti, edited by the GM', 'antaera', c.id], 'a save cannot change its ruleset or campaign');

    t.eq((await call('GET', '/api/characters', { token: gm.token })).data.map((r) => [r.name, r.campaignName]), [['Vashti, edited by the GM', 'The Sunless Road']]);
    t.eq((await call('DELETE', '/api/characters/vashti', { token: gm.token })).status, 403, 'a GM takes it out; only the owner deletes it');
  });

  test('a GM of a different campaign sees none of it', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    const other = await account(discorder('admin-on-discord', 'Another GM'), 'discord');
    await campaignWith(other, { name: 'Elsewhere' });
    t.eq((await call('GET', '/api/characters', { token: other.token })).data, []);
    t.eq((await call('GET', '/api/characters/vashti', { token: other.token })).status, 404, 'not even an admin, by being one');
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: other.token })).status, 404);
  });

  test('only a character’s owner brings it, and only to a campaign they are in', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    const cai = await player('Cai');
    await sheet(ada, 'vashti');
    t.eq((await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } })).status, 404, 'not a member');
    await join(cai, (await invite(gm, c.id)).code);
    t.eq((await call('POST', `/api/campaigns/${c.id}/characters`, { token: cai.token, body: { characterId: 'vashti' } })).status, 403, 'not their character');

    const second = await campaignWith(gm, { name: 'Second' });
    await join(ada, (await invite(gm, c.id)).code);
    await join(ada, (await invite(gm, second.id)).code);
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });
    t.eq((await call('POST', `/api/campaigns/${second.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } })).status, 409, 'one campaign at a time');
  });

  test('players see each other’s characters only if the campaign allows, and never edit them', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const code = (await invite(gm, c.id)).code;
    const ada = await player('Ada');
    const cai = await player('Cai');
    await join(ada, code);
    await join(cai, code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('GET', '/api/characters/vashti', { token: cai.token })).status, 404);
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: cai.token })).data.members.find((m) => m.name === 'Ada').characters, undefined);

    await call('PUT', `/api/campaigns/${c.id}`, { token: gm.token, body: { settings: { partyVisible: true } } });
    const seen = await call('GET', '/api/characters/vashti', { token: cai.token });
    t.eq([seen.status, seen.data.access], [200, 'party']);
    t.eq((await call('GET', '/api/characters', { token: cai.token })).data.map((r) => r.name), ['vashti']);
    t.eq((await call('PUT', '/api/characters/vashti', { token: cai.token, body: { name: 'Mischief' } })).status, 403);
  });

  test('taking a character out of a campaign returns it to its owner alone', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('DELETE', `/api/campaigns/${c.id}/characters/vashti`, { token: gm.token })).status, 204, 'the GM can take it out');
    t.eq((await call('GET', '/api/characters/vashti', { token: gm.token })).status, 404);
    const mine = (await call('GET', '/api/characters/vashti', { token: ada.token })).data;
    t.eq(mine.campaignId, null);
  });

  /* --- running it ------------------------------------------------------- */

  test('the GMs change settings; players cannot', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);

    t.eq((await call('PUT', `/api/campaigns/${c.id}`, { token: ada.token, body: { settings: { startingLevel: 5 } } })).status, 403);
    const changed = await call('PUT', `/api/campaigns/${c.id}`, {
      token: gm.token,
      body: { name: 'The Sunlit Road', settings: { startingLevel: 5, modules: { actionPoints: true }, houseRules: 'Max HP.' } },
    });
    t.eq([changed.data.name, changed.data.settings.startingLevel, changed.data.settings.modules.actionPoints, changed.data.settings.houseRules],
      ['The Sunlit Road', 5, true, 'Max HP.']);
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: ada.token })).data.settings.startingLevel, 5, 'players read them');
  });

  test('only the owner changes the ruleset, and the characters move with it', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    const cai = await player('Cai');
    await join(cai, (await invite(gm, c.id, { role: 'gm' })).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('PUT', `/api/campaigns/${c.id}`, { token: cai.token, body: { ruleset: 'antaera' } })).status, 403, 'a co-GM cannot');
    t.eq((await call('PUT', `/api/campaigns/${c.id}`, { token: gm.token, body: { ruleset: 'antaera' } })).data.ruleset, 'antaera');
    t.eq((await call('GET', '/api/characters/vashti', { token: ada.token })).data.ruleset, 'antaera');
  });

  test('a GM removes a player, whose characters leave with them', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('DELETE', `/api/campaigns/${c.id}/members/${ada.id}`, { token: gm.token })).status, 204);
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: ada.token })).status, 404);
    t.eq((await call('GET', '/api/characters/vashti', { token: gm.token })).status, 404);
    t.eq((await call('GET', '/api/characters/vashti', { token: ada.token })).data.campaignId, null, 'the character is still theirs');
  });

  test('co-GMs, leaving, and what the owner alone can do', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const code = (await invite(gm, c.id)).code;
    const ada = await player('Ada');
    const cai = await player('Cai');
    await join(ada, code);
    await join(cai, code);

    t.eq((await call('PUT', `/api/campaigns/${c.id}/members/${cai.id}`, { token: gm.token, body: { role: 'gm' } })).data.role, 'gm');
    t.eq((await call('DELETE', `/api/campaigns/${c.id}/members/${ada.id}`, { token: cai.token })).status, 204, 'a co-GM removes a player');
    t.eq((await call('DELETE', `/api/campaigns/${c.id}/members/${gm.id}`, { token: cai.token })).status, 403, 'not the owner');
    t.eq((await call('DELETE', `/api/campaigns/${c.id}`, { token: cai.token })).status, 403, 'and cannot delete the campaign');
    t.eq((await call('PUT', `/api/campaigns/${c.id}/members/${gm.id}`, { token: cai.token, body: { role: 'player' } })).status, 403);

    t.eq((await call('DELETE', `/api/campaigns/${c.id}/members/${cai.id}`, { token: cai.token })).status, 204, 'anyone but the owner can leave');
    t.eq((await call('DELETE', `/api/campaigns/${c.id}/members/${gm.id}`, { token: gm.token })).status, 403, 'the owner deletes instead');
  });

  test('deleting a campaign releases its characters and its members', async (t) => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('DELETE', `/api/campaigns/${c.id}`, { token: gm.token })).status, 204);
    t.eq((await call('GET', '/api/campaigns', { token: ada.token })).data, []);
    const theirs = (await call('GET', '/api/characters/vashti', { token: ada.token })).data;
    t.eq([theirs.name, theirs.campaignId], ['vashti', null]);
    const left = await d1('', { sql: 'SELECT COUNT(*) AS n FROM campaign_members', mode: 'first' });
    t.eq(left.n, 0);
  });

  test('removing the owner’s account deletes their campaigns and frees the characters in them', async (t) => {
    const gm = await account(googler('g-gm', 'Temporary GM', 'temp@example.com'));
    const boss = await account(discorder('admin-on-discord', 'Boss'), 'discord');
    await call('PUT', `/api/admin/users/${gm.id}`, { token: boss.token, body: { role: 'gm' } });
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    await sheet(ada, 'vashti');
    await call('POST', `/api/campaigns/${c.id}/characters`, { token: ada.token, body: { characterId: 'vashti' } });

    t.eq((await call('DELETE', `/api/admin/users/${gm.id}`, { token: boss.token })).status, 204);
    t.eq((await call('GET', '/api/characters/vashti', { token: ada.token })).data.campaignId, null);
    t.eq((await call('GET', '/api/campaigns', { token: ada.token })).data, []);
  });

  /* --- the migration --------------------------------------------------- */

  test('the old Antaera arrangement becomes a campaign, and nobody loses access', async (t) => {
    // 0003's world: a site GM, a player with an Antaera and an SRD character,
    // and the single gestalt switch turned on.
    const at = '2026-01-01T00:00:00.000Z';
    await d1('', { sql: "INSERT INTO users (id, name, role, created, last_seen) VALUES ('the-gm', 'The GM', 'gm', ?, ?)", params: [at, at] });
    await d1('', { sql: "INSERT INTO users (id, name, role, created, last_seen) VALUES ('ada', 'Ada', 'player', ?, ?)", params: [at, at] });
    await d1('', { sql: "INSERT INTO identities (provider, subject, user_id, floor, created, last_seen) VALUES ('discord', 'dm-on-discord', 'the-gm', 'gm', ?, ?)", params: [at, at] });
    await d1('', { sql: "INSERT INTO characters (id, owner, name, ruleset, data, created, updated) VALUES ('vashti', 'ada', 'Vashti', 'antaera', '{\"name\":\"Vashti\"}', ?, ?)", params: [at, at] });
    await d1('', { sql: "INSERT INTO characters (id, owner, name, ruleset, data, created, updated) VALUES ('pally', 'ada', 'Pally', 'srd', '{\"name\":\"Pally\"}', ?, ?)", params: [at, at] });
    await d1('', { sql: "UPDATE campaign SET value = 'true' WHERE key = 'gestalt'" });
    await d1('/migrate');

    people.discord = discorder('dm-on-discord', 'The GM');
    const gm = await signIn('discord');
    const campaigns = (await call('GET', '/api/campaigns', { token: gm.token })).data;
    t.eq(campaigns.map((c) => [c.id, c.name, c.ruleset, c.role, c.settings.modules.gestalt]), [['antaera', 'Antæra', 'antaera', 'owner', true]]);
    const roster = (await call('GET', '/api/characters', { token: gm.token })).data;
    t.eq(roster.map((r) => [r.name, r.campaignId]), [['Vashti', 'antaera']], 'the Antaera character, still visible; the SRD one, still not');
    const members = (await call('GET', '/api/campaigns/antaera', { token: gm.token })).data.members;
    t.eq(members.map((m) => [m.name, m.role]), [['The GM', 'owner'], ['Ada', 'player']]);
  }, { upTo: '0003' });

  test('a database with no GM gains no campaign', async (t) => {
    const at = '2026-01-01T00:00:00.000Z';
    await d1('', { sql: "INSERT INTO users (id, name, role, created, last_seen) VALUES ('ada', 'Ada', 'player', ?, ?)", params: [at, at] });
    await d1('', { sql: "INSERT INTO characters (id, owner, name, ruleset, data, created, updated) VALUES ('vashti', 'ada', 'Vashti', 'antaera', '{}', ?, ?)", params: [at, at] });
    await d1('/migrate');
    const n = await d1('', { sql: 'SELECT COUNT(*) AS n FROM campaigns', mode: 'first' });
    t.eq(n.n, 0);
    const v = await d1('', { sql: "SELECT campaign_id FROM characters WHERE id = 'vashti'", mode: 'first' });
    t.eq(v.campaign_id, null);
  }, { upTo: '0003' });

  /** A GM's campaign, a player who has joined it, and someone who has not. */
  const tableOfThree = async () => {
    const gm = await gmAccount();
    const c = await campaignWith(gm);
    const ada = await player('Ada');
    await join(ada, (await invite(gm, c.id)).code);
    const cai = await player('Cai');
    return { gm, ada, cai, c };
  };

  /* --- the campaign's homebrew -------------------------------------------- */

  test('the GMs write a campaign’s homebrew; its players read it; nobody else sees it', async (t) => {
    const { gm, ada, cai, c } = await tableOfThree();
    const feat = { kind: 'feat', name: 'Table Blessing', updated: '2026-09-13T00:00:00.000Z', effects: [{ target: 'save.fort', value: 1 }] };

    t.eq((await call('PUT', `/api/campaigns/${c.id}/content/tb`, { token: gm.token, body: feat })).status, 200);
    t.eq((await call('PUT', `/api/campaigns/${c.id}/content/x`, { token: ada.token, body: feat })).status, 403, 'a player cannot write it');
    t.eq((await call('PUT', `/api/campaigns/${c.id}/content/x`, { token: gm.token, body: { kind: 'spaceship' } })).status, 400);

    const read = await call('GET', `/api/campaigns/${c.id}/content`, { token: ada.token });
    t.eq(read.data.map((e) => [e.id, e.name, e.campaign]), [['tb', 'Table Blessing', c.id]], 'a player reads it, marked as the campaign’s');
    t.eq((await call('GET', `/api/campaigns/${c.id}/content`, { token: cai.token })).status, 404, 'someone not in the campaign does not');

    const older = await call('PUT', `/api/campaigns/${c.id}/content/tb`, { token: gm.token, body: { ...feat, name: 'Old', updated: '2026-01-01T00:00:00.000Z' } });
    t.eq(older.data.stale, true, 'an older edit does not undo a newer one');

    t.eq((await call('DELETE', `/api/campaigns/${c.id}/content/tb`, { token: ada.token })).status, 403);
    t.eq((await call('DELETE', `/api/campaigns/${c.id}/content/tb`, { token: gm.token })).status, 204);
    t.eq((await call('GET', `/api/campaigns/${c.id}/content`, { token: gm.token })).data, []);
  });

  test('a campaign’s homebrew goes with the campaign, and never into a player’s library', async (t) => {
    const { gm, ada, c } = await tableOfThree();
    await call('PUT', `/api/campaigns/${c.id}/content/tb`, { token: gm.token, body: { kind: 'feat', name: 'Table Blessing' } });
    // A player saving their sheet's copy to their own library gets a copy of their own.
    await call('PUT', '/api/content/tb', { token: ada.token, body: { kind: 'feat', name: 'Table Blessing', campaign: c.id } });
    t.eq((await call('GET', '/api/content', { token: ada.token })).data[0].campaign, undefined);

    t.eq((await call('DELETE', `/api/campaigns/${c.id}`, { token: gm.token })).status, 204);
    const left = await d1('', { sql: 'SELECT COUNT(*) AS n FROM campaign_content WHERE campaign_id = ?', params: [c.id], mode: 'first' });
    t.eq(left.n, 0);
  });

  test('allowing homebrew is a campaign setting, off unless a GM turns it on', async (t) => {
    const { gm, c } = await tableOfThree();
    t.eq((await call('GET', `/api/campaigns/${c.id}`, { token: gm.token })).data.settings.allowHomebrew, undefined, 'unset: the default, off');
    const on = await call('PUT', `/api/campaigns/${c.id}`, { token: gm.token, body: { settings: { allowHomebrew: true } } });
    t.eq(on.data.settings.allowHomebrew, true);
  });

  return cases;
}
