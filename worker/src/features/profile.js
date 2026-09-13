// Profiles and preferences.
//
//   /api/profile               your own profile: read, change username or picture
//   /api/profile/preferences   how you like the site to look
//   /api/profile/:id           someone's profile: yours, or someone you share a
//                              campaign with; an admin's, anyone's
//
// Usernames, pictures and preferences are checked against
// web/engine/preferences.js, the same description the Settings page is drawn from.

import { fail, json } from '../http.js';
import { accountCan, campaignRole } from '../policy.js';
import { checkUsername, isPictureData, normalizePreferences, PICTURE_MAX_CHARS } from '../../../web/engine/preferences.js';

/** The campaigns two accounts are both in, with the second account's role in each. */
async function sharedCampaigns(env, viewerId, targetId) {
  const rows = await env.DB.prepare(
    `SELECT k.id, k.name, k.owner, t.role
       FROM campaigns k
       JOIN campaign_members t ON t.campaign_id = k.id AND t.user_id = ?2
       JOIN campaign_members v ON v.campaign_id = k.id AND v.user_id = ?1
      ORDER BY k.name COLLATE NOCASE`
  ).bind(viewerId, targetId).all();
  return (rows.results || []).map((k) => ({ id: k.id, name: k.name, role: campaignRole(k, { role: k.role }, targetId) }));
}

async function profileOf(env, id) {
  return env.DB.prepare('SELECT id, name, avatar, role, created, picture, name_custom, preferences FROM users WHERE id = ?').bind(id).first();
}

/** Everything about your own account that the Profile and Settings pages show. */
async function ownProfile(env, user) {
  const row = await profileOf(env, user.id);
  const [identities, counts, campaigns] = await Promise.all([
    env.DB.prepare('SELECT provider, name, avatar, created, last_seen FROM identities WHERE user_id = ? ORDER BY provider').bind(user.id).all(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM characters WHERE owner = ?1) AS characters,
              (SELECT COUNT(*) FROM content WHERE owner = ?1) AS homebrew,
              (SELECT COUNT(*) FROM campaign_members WHERE user_id = ?1) AS campaigns`
    ).bind(user.id).first(),
    sharedCampaigns(env, user.id, user.id),
  ]);
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    role: user.role,
    created: row.created,
    self: true,
    nameChosen: Boolean(row.name_custom),
    picture: row.picture || 'auto',
    signIns: (identities.results || []).map((i) => ({ provider: i.provider, name: i.name, avatar: i.avatar, since: i.created, lastSeen: i.last_seen })),
    counts: { characters: counts?.characters || 0, homebrew: counts?.homebrew || 0, campaigns: counts?.campaigns || 0 },
    campaigns,
    preferences: normalizePreferences(JSON.parse(row.preferences || '{}')),
  };
}

async function getOwnProfile({ env, user }) {
  return json(await ownProfile(env, user));
}

async function getProfile({ env, user, params }) {
  if (params.id === user.id) return json(await ownProfile(env, user));
  const row = await profileOf(env, params.id);
  const shared = row ? await sharedCampaigns(env, user.id, params.id) : [];
  if (!row || !accountCan.viewProfile(user, params.id, shared.length > 0)) throw fail(404, 'no profile with that address');
  return json({
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
    created: row.created,
    self: false,
    campaigns: shared,
  });
}

/**
 * Change your username, your picture, or both.
 *
 *   { name }                                 a username of your choosing
 *   { picture: 'upload', data }              a picture you send, as a data URL
 *   { picture: 'provider', provider }        the picture Google or Discord has
 *   { picture: 'none' }                      no picture
 */
async function updateProfile({ env, user, body }) {
  const input = await body(PICTURE_MAX_CHARS + 4096);
  const writes = [];

  if (input.name !== undefined) {
    const checked = checkUsername(input.name);
    if (!checked.ok) throw fail(400, checked.error);
    const taken = await env.DB.prepare('SELECT id FROM users WHERE lower(name) = lower(?) AND id != ?').bind(checked.name, user.id).first();
    if (taken) throw fail(409, 'that username is taken');
    writes.push(env.DB.prepare('UPDATE users SET name = ?, name_custom = 1 WHERE id = ?').bind(checked.name, user.id));
  }

  if (input.picture !== undefined) {
    if (input.picture === 'upload') {
      if (!isPictureData(input.data)) throw fail(400, 'a picture must be a PNG, JPEG or WebP image, small enough to send');
      writes.push(env.DB.prepare("UPDATE users SET avatar = ?, picture = 'upload' WHERE id = ?").bind(input.data, user.id));
    } else if (input.picture === 'provider') {
      const identity = await env.DB.prepare('SELECT avatar FROM identities WHERE user_id = ? AND provider = ?').bind(user.id, input.provider).first();
      if (!identity) throw fail(400, 'you do not sign in with that');
      writes.push(env.DB.prepare('UPDATE users SET avatar = ?, picture = ? WHERE id = ?').bind(identity.avatar, `provider:${input.provider}`, user.id));
    } else if (input.picture === 'none') {
      writes.push(env.DB.prepare("UPDATE users SET avatar = NULL, picture = 'none' WHERE id = ?").bind(user.id));
    } else {
      throw fail(400, 'that is not a kind of picture');
    }
  }

  if (writes.length) await env.DB.batch(writes);
  return json(await ownProfile(env, user));
}

async function updatePreferences({ env, user, body }) {
  const preferences = normalizePreferences(await body(4096));
  await env.DB.prepare('UPDATE users SET preferences = ? WHERE id = ?').bind(JSON.stringify(preferences), user.id).run();
  return json(preferences);
}

export const routes = [
  { method: 'GET', path: '/api/profile', handler: getOwnProfile },
  { method: 'PUT', path: '/api/profile', handler: updateProfile },
  { method: 'PUT', path: '/api/profile/preferences', handler: updatePreferences },
  { method: 'GET', path: '/api/profile/:id', handler: getProfile },
];
