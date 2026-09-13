// A campaign's homebrew: the library its GMs write for the table.
//
//   /api/campaigns/:id/content              every entry: members read
//   /api/campaigns/:id/content/:entryId     one entry: GMs write and delete
//
// Characters in the campaign count these entries - and their players' own
// homebrew only if the campaign allows it. That rule is the engine's
// (web/engine/library.js usableContent), so a GM and a player see the same
// numbers on the same sheet.

import { fail, json, noContent, now } from '../http.js';
import { campaignCan } from '../policy.js';
import { loadCampaign, roleIn } from './campaigns.js';
import { MAX_ENTRY_BYTES, checkedEntry } from './content.js';

const MAX_ENTRIES_PER_CAMPAIGN = 2000;

async function campaignFor(env, id, userId, allowed) {
  const campaign = await loadCampaign(env, id);
  const role = await roleIn(env, campaign, userId);
  if (!campaign || !campaignCan.view(role)) throw fail(404, 'no campaign with that address');
  if (!allowed(role)) throw fail(403, 'only the GMs of this campaign write its homebrew');
  return campaign;
}

async function listCampaignContent({ env, user, params }) {
  await campaignFor(env, params.id, user.id, campaignCan.seeHomebrew);
  const rows = await env.DB.prepare('SELECT data FROM campaign_content WHERE campaign_id = ? ORDER BY kind, name')
    .bind(params.id).all();
  return json((rows.results || []).map((r) => JSON.parse(r.data)));
}

/** Store one entry. As with a player's library, the newer `updated` wins. */
async function putCampaignContent({ env, user, params, body }) {
  await campaignFor(env, params.id, user.id, campaignCan.writeHomebrew);
  const entry = checkedEntry(await body(MAX_ENTRY_BYTES), params.entryId);
  // The sheet's copy says where it came from, which is how the engine tells a
  // campaign's entry from a player's when the campaign's library is not to hand.
  entry.campaign = params.id;

  const existing = await env.DB.prepare('SELECT updated FROM campaign_content WHERE campaign_id = ? AND id = ?')
    .bind(params.id, params.entryId).first();
  if (existing && existing.updated > entry.updated) {
    return json({ ok: true, id: params.entryId, updated: existing.updated, stale: true });
  }
  if (!existing) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_content WHERE campaign_id = ?').bind(params.id).first();
    if ((count?.n || 0) >= MAX_ENTRIES_PER_CAMPAIGN) throw fail(413, 'that campaign library is full');
  }

  await env.DB.prepare(
    `INSERT INTO campaign_content (campaign_id, id, kind, name, data, author, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
       data = excluded.data, author = excluded.author, updated = excluded.updated`
  ).bind(params.id, params.entryId, entry.kind, String(entry.name || '').slice(0, 200), JSON.stringify(entry), user.id, now(), entry.updated).run();

  return json({ ok: true, id: params.entryId, updated: entry.updated });
}

async function deleteCampaignContent({ env, user, params }) {
  await campaignFor(env, params.id, user.id, campaignCan.writeHomebrew);
  await env.DB.prepare('DELETE FROM campaign_content WHERE campaign_id = ? AND id = ?').bind(params.id, params.entryId).run();
  return noContent();
}

export const routes = [
  { method: 'GET', path: '/api/campaigns/:id/content', handler: listCampaignContent },
  { method: 'PUT', path: '/api/campaigns/:id/content/:entryId', handler: putCampaignContent },
  { method: 'DELETE', path: '/api/campaigns/:id/content/:entryId', handler: deleteCampaignContent },
];
