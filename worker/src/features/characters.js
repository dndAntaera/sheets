// Characters.
//
// A character belongs to its owner. In a campaign, the people running it may
// also read and edit it, and the other players may read it if the campaign
// allows. Nobody else sees it - a site-wide role grants nothing here on its own.
// The rules are characterAccess and characterCan in policy.js.

import { fail, json, noContent, now } from '../http.js';
import { campaignRole, characterAccess, characterCan } from '../policy.js';
import { DEFAULT_PUBLIC_RULESET, isPublicRuleset } from '../rulesets.js';

const MAX_SHEET_BYTES = 512 * 1024;

/** The asker's access to a stored character: owner, gm, party, or null. */
async function accessFor(env, userId, row) {
  if (!row) return null;
  if (row.owner === userId || !row.campaign_id) return characterAccess(userId, row, null);
  const k = await env.DB.prepare(
    `SELECT k.id, k.owner, k.settings, m.role
       FROM campaigns k LEFT JOIN campaign_members m ON m.campaign_id = k.id AND m.user_id = ?
      WHERE k.id = ?`
  ).bind(userId, row.campaign_id).first();
  if (!k) return null;
  const role = campaignRole({ id: k.id, owner: k.owner }, { role: k.role }, userId);
  const partyVisible = Boolean(JSON.parse(k.settings || '{}').partyVisible);
  return characterAccess(userId, row, role, partyVisible);
}

/** Every character the asker may see: their own, and those in campaigns that let them. */
async function listCharacters({ env, user }) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.player, c.build, c.level, c.ruleset, c.updated, c.owner,
            c.campaign_id AS campaignId, k.name AS campaignName, u.name AS ownerName
       FROM characters c
       JOIN users u ON u.id = c.owner
       LEFT JOIN campaigns k ON k.id = c.campaign_id
      WHERE c.owner = ?1
         OR c.campaign_id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?1 AND role = 'gm')
         OR c.campaign_id IN (SELECT g.id FROM campaigns g WHERE g.owner = ?1)
         OR c.campaign_id IN (
              SELECT m.campaign_id FROM campaign_members m JOIN campaigns g ON g.id = m.campaign_id
               WHERE m.user_id = ?1 AND json_extract(g.settings, '$.partyVisible') = 1)
      ORDER BY c.name COLLATE NOCASE`
  ).bind(user.id).all();
  return json(rows.results || []);
}

async function loadCharacter({ env, user, params }) {
  const row = await env.DB.prepare('SELECT owner, campaign_id, data FROM characters WHERE id = ?').bind(params.id).first();
  const access = await accessFor(env, user.id, row);
  if (!characterCan.view(access)) throw fail(404, 'no character with that address');
  const character = JSON.parse(row.data);
  // The database, not the sheet, says which campaign a character is in.
  character.campaignId = row.campaign_id || null;
  return json({ ...character, access });
}

/**
 * Store a sheet. The server does not judge whether a character is legal - a
 * half-built one must be savable - only who may write it. A sheet cannot move
 * itself into or out of a campaign by saving; that is the campaign routes' job.
 * In a campaign, it keeps the campaign's ruleset. Out of one, it may use a
 * public ruleset, or keep the one it already has; it cannot move itself onto a
 * ruleset that is only for campaigns.
 */
async function saveCharacter({ env, user, params, body }) {
  const character = await body(MAX_SHEET_BYTES);
  const existing = await env.DB.prepare(
    `SELECT c.owner, c.campaign_id, c.created, c.ruleset, k.ruleset AS campaignRuleset
       FROM characters c LEFT JOIN campaigns k ON k.id = c.campaign_id WHERE c.id = ?`
  ).bind(params.id).first();

  if (existing) {
    const access = await accessFor(env, user.id, existing);
    if (!characterCan.edit(access)) {
      throw fail(access ? 403 : 404, access ? 'you may read this character, not change it' : 'no character with that address');
    }
  }

  const owner = existing ? existing.owner : user.id;
  const campaignId = existing?.campaign_id || null;
  const keeps = isPublicRuleset(character.ruleset) || (existing && character.ruleset === existing.ruleset);
  const ruleset = existing?.campaignRuleset || (keeps ? character.ruleset : DEFAULT_PUBLIC_RULESET);
  const stamp = now();

  character.id = params.id;
  character.ruleset = ruleset;
  character.campaignId = campaignId;
  delete character.access;
  character.meta = { ...(character.meta || {}), owner, updated: stamp };

  await env.DB.prepare(
    `INSERT INTO characters (id, owner, name, player, build, level, ruleset, campaign_id, data, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, player = excluded.player,
       build = excluded.build, level = excluded.level, ruleset = excluded.ruleset,
       data = excluded.data, updated = excluded.updated`
  ).bind(
    params.id, owner,
    String(character.name || '').slice(0, 200),
    String(character.player || '').slice(0, 200),
    String(character.meta?.build || '').slice(0, 200),
    Array.isArray(character.levels) ? character.levels.length : 0,
    ruleset,
    campaignId,
    JSON.stringify(character),
    existing ? existing.created : stamp,
    stamp
  ).run();

  return json({ ok: true, id: params.id, updated: stamp, ruleset, campaignId });
}

async function deleteCharacter({ env, user, params }) {
  const row = await env.DB.prepare('SELECT owner, campaign_id FROM characters WHERE id = ?').bind(params.id).first();
  if (!row) return noContent();
  const access = await accessFor(env, user.id, row);
  if (!characterCan.view(access)) throw fail(404, 'no character with that address');
  if (!characterCan.delete(access)) throw fail(403, 'only its owner can delete a character; take it out of the campaign instead');
  await env.DB.prepare('DELETE FROM characters WHERE id = ?').bind(params.id).run();
  return noContent();
}

export const routes = [
  { method: 'GET', path: '/api/characters', handler: listCharacters },
  { method: 'GET', path: '/api/characters/:id', handler: loadCharacter },
  { method: 'PUT', path: '/api/characters/:id', handler: saveCharacter },
  { method: 'DELETE', path: '/api/characters/:id', handler: deleteCharacter },
];
