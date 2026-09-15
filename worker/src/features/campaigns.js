// Campaigns: a GM, the players they invite, and the characters brought to the table.
//
//   /api/campaigns                          mine, and making a new one
//   /api/campaigns/:id                      one campaign: read, change, delete
//   /api/campaigns/:id/invites              invitations: make, withdraw
//   /api/invites/:code                      an invitation: look at it, accept it
//   /api/campaigns/:id/members/:userId      a member: make GM or player, remove
//   /api/campaigns/:id/characters           bring a character in, take one out
//   /api/campaigns/:id/changes              for its GMs: changes to its characters' held choices
//
// Who may do each is decided in policy.js; this file looks up the facts and
// asks. Settings are checked against web/engine/campaign.js, the same schema the
// app draws its settings form from.

import { fail, friendlyCode, json, noContent, now, randomToken } from '../http.js';
import { campaignCan, campaignRole } from '../policy.js';
import { normalizeSettings } from '../../../web/engine/campaign.js';
import { RULESETS, isRuleset } from '../rulesets.js';

const MAX_CAMPAIGNS_PER_ACCOUNT = 50;
const INVITE_DEFAULT_DAYS = 7;

/* -------------------------------------------------------------------------
   Lookups other features use
   ------------------------------------------------------------------------- */

const parse = (row) => (row ? { ...row, settings: JSON.parse(row.settings || '{}') } : null);

export async function loadCampaign(env, id) {
  return parse(await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first());
}

/** The asker's role in a campaign - owner, gm, player - or null. */
export async function roleIn(env, campaign, userId) {
  if (!campaign) return null;
  const membership = await env.DB.prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .bind(campaign.id, userId).first();
  return campaignRole(campaign, membership, userId);
}

/** The campaign, and the asker's role in it, or a 404 for anyone not in it. */
async function campaignFor(env, id, userId, allowed = campaignCan.view) {
  const campaign = await loadCampaign(env, id);
  const role = await roleIn(env, campaign, userId);
  if (!campaign || !campaignCan.view(role)) throw fail(404, 'no campaign with that address');
  if (!allowed(role)) throw fail(403, 'your role in this campaign does not allow that');
  return { campaign, role };
}

const releaseCharacters = (env, campaignId, ownerId) => env.DB.prepare(
  `UPDATE characters SET campaign_id = NULL, data = json_remove(data, '$.campaignId')
    WHERE campaign_id = ? AND owner = ?`
).bind(campaignId, ownerId).run();

/* -------------------------------------------------------------------------
   Campaigns
   ------------------------------------------------------------------------- */

async function myCampaigns({ env, user }) {
  const rows = await env.DB.prepare(
    `SELECT k.*, o.name AS ownerName, m.role AS memberRole,
            (SELECT COUNT(*) FROM campaign_members x WHERE x.campaign_id = k.id) AS memberCount,
            (SELECT COUNT(*) FROM characters c WHERE c.campaign_id = k.id) AS characterCount,
            (SELECT COUNT(*) FROM character_changes h
              WHERE h.campaign_id = k.id AND (h.user_id IS NULL OR h.user_id != ?1)
                AND h.created > COALESCE((SELECT r.seen FROM campaign_change_reads r WHERE r.campaign_id = k.id AND r.user_id = ?1), '')) AS unseenChanges
       FROM campaign_members m
       JOIN campaigns k ON k.id = m.campaign_id
       JOIN users o ON o.id = k.owner
      WHERE m.user_id = ?1
      ORDER BY k.name COLLATE NOCASE`
  ).bind(user.id).all();
  return json((rows.results || []).map((row) => {
    const campaign = parse(row);
    const role = campaignRole(campaign, { role: row.memberRole }, user.id);
    return { ...shape(campaign), role, ...(campaignCan.seeChanges(role) ? { unseenChanges: row.unseenChanges || 0 } : {}) };
  }));
}

/** A campaign as the app receives it. */
function shape(c) {
  return {
    id: c.id,
    name: c.name,
    ruleset: c.ruleset,
    description: c.description,
    settings: c.settings,
    owner: c.owner,
    ownerName: c.ownerName,
    memberCount: c.memberCount,
    characterCount: c.characterCount,
    created: c.created,
    updated: c.updated,
  };
}

async function createCampaign({ env, user, body }) {
  if (!campaignCan.create(user)) throw fail(403, 'only a GM can start a campaign');
  const input = await body(16 * 1024);
  const name = String(input.name || '').trim().slice(0, 100);
  if (!name) throw fail(400, 'a campaign needs a name');
  const ruleset = input.ruleset || 'srd';
  if (!isRuleset(ruleset)) throw fail(400, 'that is not a ruleset this server knows');

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE owner = ?').bind(user.id).first();
  if ((count?.n || 0) >= MAX_CAMPAIGNS_PER_ACCOUNT) throw fail(413, 'that is as many campaigns as one account may run');

  const { settings, dropped } = normalizeSettings(input.settings, RULESETS[ruleset]);
  const id = randomToken(8);
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO campaigns (id, name, ruleset, description, settings, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, ruleset, String(input.description || '').slice(0, 2000), JSON.stringify(settings), user.id, stamp, stamp),
    env.DB.prepare("INSERT INTO campaign_members (campaign_id, user_id, role, joined) VALUES (?, ?, 'gm', ?)")
      .bind(id, user.id, stamp),
  ]);
  return json({ ...shape({ ...(await loadCampaign(env, id)), ownerName: user.name, memberCount: 1, characterCount: 0 }), role: 'owner', dropped }, 201);
}

/**
 * One campaign in full. Everyone in it sees the members and their own
 * characters; the people running it see every character and the invitations;
 * players see the others' characters only when the campaign allows it.
 */
async function getCampaign({ env, user, params }) {
  const { campaign, role } = await campaignFor(env, params.id, user.id);
  const runs = campaignCan.edit(role);
  const party = Boolean(campaign.settings?.partyVisible);

  const owner = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(campaign.owner).first();
  const members = await env.DB.prepare(
    `SELECT m.user_id AS id, m.role, m.joined, u.name, u.avatar
       FROM campaign_members m JOIN users u ON u.id = m.user_id
      WHERE m.campaign_id = ?
      ORDER BY CASE m.role WHEN 'gm' THEN 0 ELSE 1 END, u.name COLLATE NOCASE`
  ).bind(campaign.id).all();
  const characters = await env.DB.prepare(
    `SELECT id, owner, name, player, build, level, ruleset, updated
       FROM characters WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`
  ).bind(campaign.id).all();

  const byOwner = new Map();
  for (const c of characters.results || []) {
    if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
    byOwner.get(c.owner).push(c);
  }

  const result = {
    ...shape({ ...campaign, ownerName: owner?.name, memberCount: (members.results || []).length, characterCount: (characters.results || []).length }),
    role,
    members: (members.results || []).map((m) => {
      const theirs = byOwner.get(m.id) || [];
      const visible = runs || party || m.id === user.id;
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        role: campaignRole(campaign, { role: m.role }, m.id),
        joined: m.joined,
        characterCount: theirs.length,
        characters: visible ? theirs.map(({ owner: _o, ...c }) => c) : undefined,
      };
    }),
  };

  if (campaignCan.seeInvites(role)) {
    const invites = await env.DB.prepare(
      `SELECT i.code, i.role, i.uses, i.max_uses AS maxUses, i.expires, i.created, u.name AS createdBy
         FROM campaign_invites i JOIN users u ON u.id = i.created_by
        WHERE i.campaign_id = ? ORDER BY i.created DESC`
    ).bind(campaign.id).all();
    result.invites = (invites.results || []).map((i) => ({ ...i, active: inviteProblem(i) === null }));
  }
  return json(result);
}

async function updateCampaign({ env, user, params, body }) {
  const { campaign, role } = await campaignFor(env, params.id, user.id, campaignCan.edit);
  const input = await body(32 * 1024);
  const changes = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim().slice(0, 100);
    if (!name) throw fail(400, 'a campaign needs a name');
    changes.name = name;
  }
  if (input.description !== undefined) changes.description = String(input.description).slice(0, 2000);

  let ruleset = campaign.ruleset;
  if (input.ruleset !== undefined && input.ruleset !== campaign.ruleset) {
    if (!campaignCan.changeRuleset(role)) throw fail(403, 'only the campaign’s owner can change its ruleset');
    if (!isRuleset(input.ruleset)) throw fail(400, 'that is not a ruleset this server knows');
    ruleset = input.ruleset;
    changes.ruleset = ruleset;
  }

  let dropped = [];
  if (input.settings !== undefined || changes.ruleset) {
    const normal = normalizeSettings(input.settings ?? campaign.settings, RULESETS[ruleset]);
    changes.settings = JSON.stringify(normal.settings);
    dropped = normal.dropped;
  }

  const keys = Object.keys(changes);
  if (keys.length) {
    const statements = [env.DB.prepare(
      `UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated = ? WHERE id = ?`
    ).bind(...keys.map((k) => changes[k]), now(), campaign.id)];
    // Every character in the campaign moves to its new ruleset with it.
    if (changes.ruleset) {
      statements.push(env.DB.prepare(
        "UPDATE characters SET ruleset = ?, data = json_set(data, '$.ruleset', ?) WHERE campaign_id = ?"
      ).bind(ruleset, ruleset, campaign.id));
    }
    await env.DB.batch(statements);
  }

  const updated = await loadCampaign(env, campaign.id);
  return json({ ...shape(updated), role, dropped });
}

async function deleteCampaign({ env, user, params }) {
  const { campaign } = await campaignFor(env, params.id, user.id, campaignCan.delete);
  // Members and invitations go by cascade; characters are released, not deleted.
  await env.DB.batch([
    env.DB.prepare("UPDATE characters SET data = json_remove(data, '$.campaignId') WHERE campaign_id = ?").bind(campaign.id),
    env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(campaign.id),
  ]);
  return noContent();
}

/* -------------------------------------------------------------------------
   Invitations
   ------------------------------------------------------------------------- */

/** Why an invitation cannot be used, or null if it can. */
function inviteProblem(invite) {
  if (invite.expires && new Date(invite.expires) < new Date()) return 'that invitation has expired';
  if (invite.maxUses !== null && invite.maxUses !== undefined && invite.uses >= invite.maxUses) return 'that invitation has been used up';
  return null;
}

async function createInvite({ env, user, params, body }) {
  const input = await body(2048);
  const inviteRole = input.role === 'gm' ? 'gm' : 'player';
  const { campaign } = await campaignFor(env, params.id, user.id, (r) => campaignCan.invite(r, inviteRole));

  const intOrNull = (v, min, max, name) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw fail(400, `${name} must be between ${min} and ${max}`);
    return n;
  };
  const maxUses = intOrNull(input.maxUses, 1, 1000, 'uses');
  const days = input.expiresInDays === null ? null : intOrNull(input.expiresInDays ?? INVITE_DEFAULT_DAYS, 1, 365, 'days');
  const expires = days === null ? null : new Date(Date.now() + days * 86400_000).toISOString();

  const code = friendlyCode(10);
  await env.DB.prepare(
    'INSERT INTO campaign_invites (code, campaign_id, created_by, role, max_uses, uses, expires, created) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
  ).bind(code, campaign.id, user.id, inviteRole, maxUses, expires, now()).run();

  return json({ code, role: inviteRole, maxUses, uses: 0, expires, active: true }, 201);
}

async function withdrawInvite({ env, user, params }) {
  const { campaign } = await campaignFor(env, params.id, user.id, campaignCan.seeInvites);
  await env.DB.prepare('DELETE FROM campaign_invites WHERE code = ? AND campaign_id = ?')
    .bind(String(params.code).toUpperCase(), campaign.id).run();
  return noContent();
}

async function findInvite(env, code) {
  const row = await env.DB.prepare(
    `SELECT i.code, i.role, i.uses, i.max_uses AS maxUses, i.expires, i.campaign_id AS campaignId,
            k.name, k.ruleset, k.description, k.owner, o.name AS ownerName
       FROM campaign_invites i
       JOIN campaigns k ON k.id = i.campaign_id
       JOIN users o ON o.id = k.owner
      WHERE i.code = ?`
  ).bind(String(code).toUpperCase()).first();
  if (!row) throw fail(404, 'there is no invitation with that code');
  const problem = inviteProblem(row);
  if (problem) throw fail(410, problem);
  return row;
}

async function previewInvite({ env, user, params }) {
  const invite = await findInvite(env, params.code);
  const current = await roleIn(env, { id: invite.campaignId, owner: invite.owner }, user.id);
  return json({
    campaign: { id: invite.campaignId, name: invite.name, ruleset: invite.ruleset, description: invite.description },
    ownerName: invite.ownerName,
    role: invite.role,
    currentRole: current,
  });
}

/**
 * Join by invitation. Someone already in the campaign is not moved down, and
 * does not use up a place; a player accepting a GM invitation becomes a GM.
 */
async function acceptInvite({ env, user, params }) {
  const invite = await findInvite(env, params.code);
  const current = await roleIn(env, { id: invite.campaignId, owner: invite.owner }, user.id);

  if (current === 'owner' || current === 'gm' || (current === 'player' && invite.role === 'player')) {
    return json({ campaignId: invite.campaignId, role: current, joined: false });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaign_members (campaign_id, user_id, role, joined) VALUES (?, ?, ?, ?)
       ON CONFLICT(campaign_id, user_id) DO UPDATE SET role = excluded.role`
    ).bind(invite.campaignId, user.id, invite.role, now()),
    env.DB.prepare('UPDATE campaign_invites SET uses = uses + 1 WHERE code = ?').bind(invite.code),
  ]);
  return json({ campaignId: invite.campaignId, role: invite.role, joined: true });
}

/* -------------------------------------------------------------------------
   Members
   ------------------------------------------------------------------------- */

async function targetMember(env, campaign, userId) {
  const role = await roleIn(env, campaign, userId);
  if (!role) throw fail(404, 'that account is not in this campaign');
  return role;
}

async function setMemberRole({ env, user, params, body }) {
  const { role: newRole } = await body(512);
  if (newRole !== 'gm' && newRole !== 'player') throw fail(400, 'a member is a gm or a player');
  const { campaign, role } = await campaignFor(env, params.id, user.id);
  const targetRole = await targetMember(env, campaign, params.userId);
  if (!campaignCan.setMemberRole(role, targetRole)) throw fail(403, 'only the campaign’s owner decides who is a GM');

  await env.DB.prepare('UPDATE campaign_members SET role = ? WHERE campaign_id = ? AND user_id = ?')
    .bind(newRole, campaign.id, params.userId).run();
  return json({ id: params.userId, role: newRole });
}

async function removeMember({ env, user, params }) {
  const { campaign, role } = await campaignFor(env, params.id, user.id);
  const targetRole = await targetMember(env, campaign, params.userId);
  const isSelf = params.userId === user.id;
  if (!campaignCan.removeMember(role, targetRole, isSelf)) {
    throw fail(403, targetRole === 'owner'
      ? 'the owner cannot leave; delete the campaign instead'
      : 'your role in this campaign does not allow removing them');
  }
  await releaseCharacters(env, campaign.id, params.userId);
  await env.DB.prepare('DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .bind(campaign.id, params.userId).run();
  return noContent();
}

/* -------------------------------------------------------------------------
   Characters in a campaign
   ------------------------------------------------------------------------- */

async function addCharacter({ env, user, params, body }) {
  const { characterId } = await body(512);
  const { campaign, role } = await campaignFor(env, params.id, user.id);
  const character = await env.DB.prepare('SELECT id, owner, campaign_id FROM characters WHERE id = ?').bind(String(characterId || '')).first();
  if (!character) throw fail(404, 'no character with that id');
  if (!campaignCan.addCharacter(role, character.owner === user.id)) throw fail(403, 'only a character’s owner can bring it to a campaign');
  if (character.campaign_id && character.campaign_id !== campaign.id) {
    throw fail(409, 'that character is already in another campaign; take it out of that one first');
  }

  // The character takes on the campaign's ruleset while it is in the campaign.
  await env.DB.prepare(
    `UPDATE characters SET campaign_id = ?, ruleset = ?,
            data = json_set(data, '$.campaignId', ?, '$.ruleset', ?)
      WHERE id = ?`
  ).bind(campaign.id, campaign.ruleset, campaign.id, campaign.ruleset, character.id).run();
  return json({ characterId: character.id, campaignId: campaign.id, ruleset: campaign.ruleset });
}

async function removeCharacter({ env, user, params }) {
  const { campaign, role } = await campaignFor(env, params.id, user.id);
  const character = await env.DB.prepare('SELECT id, owner, campaign_id FROM characters WHERE id = ?').bind(params.characterId).first();
  if (!character || character.campaign_id !== campaign.id) throw fail(404, 'that character is not in this campaign');
  if (!campaignCan.removeCharacter(role, character.owner === user.id)) throw fail(403, 'your role in this campaign does not allow that');

  await env.DB.prepare(
    "UPDATE characters SET campaign_id = NULL, data = json_remove(data, '$.campaignId') WHERE id = ?"
  ).bind(character.id).run();
  return noContent();
}

/* -------------------------------------------------------------------------
   Changes to characters, for the GMs
   ------------------------------------------------------------------------- */

/**
 * The latest changes to the held choices of this campaign's characters - newest
 * first, each marked unseen if it came after this GM last looked and was not
 * their own.
 */
async function campaignChanges({ env, user, params }) {
  const { campaign } = await campaignFor(env, params.id, user.id, campaignCan.seeChanges);
  const read = await env.DB.prepare('SELECT seen FROM campaign_change_reads WHERE campaign_id = ? AND user_id = ?').bind(campaign.id, user.id).first();
  const seen = read?.seen || '';
  const rows = await env.DB.prepare(
    `SELECT h.id, h.character_id AS characterId, c.name AS characterName, h.user_id AS byId, u.name AS byName, h.created, h.changes
       FROM character_changes h
       LEFT JOIN characters c ON c.id = h.character_id
       LEFT JOIN users u ON u.id = h.user_id
      WHERE h.campaign_id = ?
      ORDER BY h.created DESC LIMIT 100`
  ).bind(campaign.id).all();
  const changes = (rows.results || []).map((r) => ({
    id: r.id,
    characterId: r.characterId,
    characterName: r.characterName || 'A character no longer here',
    by: r.byId ? { id: r.byId, name: r.byName } : null,
    created: r.created,
    changes: JSON.parse(r.changes || '[]'),
    unseen: r.created > seen && r.byId !== user.id,
  }));
  return json({ changes, unseen: changes.filter((c) => c.unseen).length, seen: seen || null });
}

/** Everything in the list, marked read by this GM. */
async function markChangesSeen({ env, user, params }) {
  const { campaign } = await campaignFor(env, params.id, user.id, campaignCan.seeChanges);
  await env.DB.prepare(
    `INSERT INTO campaign_change_reads (campaign_id, user_id, seen) VALUES (?, ?, ?)
     ON CONFLICT(campaign_id, user_id) DO UPDATE SET seen = excluded.seen`
  ).bind(campaign.id, user.id, now()).run();
  return noContent();
}

export const routes = [
  { method: 'GET', path: '/api/campaigns', handler: myCampaigns },
  { method: 'GET', path: '/api/campaigns/:id/changes', handler: campaignChanges },
  { method: 'POST', path: '/api/campaigns/:id/changes/seen', handler: markChangesSeen },
  { method: 'POST', path: '/api/campaigns', auth: 'gm', handler: createCampaign },
  { method: 'GET', path: '/api/campaigns/:id', handler: getCampaign },
  { method: 'PUT', path: '/api/campaigns/:id', handler: updateCampaign },
  { method: 'DELETE', path: '/api/campaigns/:id', handler: deleteCampaign },

  { method: 'POST', path: '/api/campaigns/:id/invites', handler: createInvite },
  { method: 'DELETE', path: '/api/campaigns/:id/invites/:code', handler: withdrawInvite },
  { method: 'GET', path: '/api/invites/:code', handler: previewInvite },
  { method: 'POST', path: '/api/invites/:code/accept', handler: acceptInvite },

  { method: 'PUT', path: '/api/campaigns/:id/members/:userId', handler: setMemberRole },
  { method: 'DELETE', path: '/api/campaigns/:id/members/:userId', handler: removeMember },

  { method: 'POST', path: '/api/campaigns/:id/characters', handler: addCharacter },
  { method: 'DELETE', path: '/api/campaigns/:id/characters/:characterId', handler: removeCharacter },
];
