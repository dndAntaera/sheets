// Who may do what, in one place.
//
// Every permission rule in the server is a pure function here, given facts the
// feature has already looked up. Features ask; they never decide. That keeps
// the rules readable in one sitting, testable without a database, and the same
// everywhere a question is asked - "can this person edit that character" has one
// answer whether it is asked by the character routes or the campaign routes.
//
// Adding a feature that needs permissions means adding its rules here.

import { atLeast } from './roles.js';

/* -------------------------------------------------------------------------
   Campaigns

   A role within one campaign, separate from the site-wide role:

     owner   made the campaign; everything below, and deleting it, changing
             its ruleset, and deciding who else is a GM
     gm      runs it alongside the owner: settings, invitations for players,
             removing players, every character in it
     player  joined by invitation; their own characters in it
   ------------------------------------------------------------------------- */

export const CAMPAIGN_ROLES = ['player', 'gm', 'owner'];
const campaignRank = (role) => CAMPAIGN_ROLES.indexOf(role);
const runs = (role) => role === 'gm' || role === 'owner';

/** A person's role in a campaign, from the campaign row and their membership. */
export function campaignRole(campaign, membership, userId) {
  if (!campaign) return null;
  if (campaign.owner === userId) return 'owner';
  return membership?.role === 'gm' || membership?.role === 'player' ? membership.role : null;
}

export const campaignCan = {
  /** Anyone may start a campaign who holds the site role of GM or above. */
  create: (user) => atLeast(user, 'gm'),

  view: (role) => role !== null,
  edit: (role) => runs(role),
  delete: (role) => role === 'owner',
  changeRuleset: (role) => role === 'owner',

  /** GMs invite players; only the owner invites GMs. */
  invite: (role, inviteRole) => (inviteRole === 'gm' ? role === 'owner' : runs(role)),
  seeInvites: (role) => runs(role),

  /** Only the owner makes or unmakes GMs, and nobody changes the owner. */
  setMemberRole: (actorRole, targetRole) => actorRole === 'owner' && targetRole !== 'owner',

  /**
   * Leaving is always allowed, except for the owner, who must delete the
   * campaign instead. A GM removes players; the owner removes anyone else.
   */
  removeMember: (actorRole, targetRole, isSelf) => {
    if (targetRole === 'owner') return false;
    if (isSelf) return true;
    if (targetRole === 'player') return runs(actorRole);
    return actorRole === 'owner';
  },

  /** A player adds their own characters; a GM may add their own too. */
  addCharacter: (role, ownsCharacter) => role !== null && ownsCharacter,

  /** The character's owner takes it out; so may anyone running the campaign. */
  removeCharacter: (role, ownsCharacter) => ownsCharacter || runs(role),

  /** Changes to its characters' held choices are for the people running it. */
  seeChanges: (role) => runs(role),

  /** The campaign's homebrew: every member reads it, since their characters use it; GMs write it. */
  seeHomebrew: (role) => role !== null,
  writeHomebrew: (role) => runs(role),
};

/** Whether one role in a campaign outranks another. */
export const outranks = (a, b) => campaignRank(a) > campaignRank(b);

/* -------------------------------------------------------------------------
   Characters

   A character belongs to its owner. If it is in a campaign, the people running
   that campaign may also read and edit it, and - when the campaign allows it -
   the other players may read it.
   ------------------------------------------------------------------------- */

/**
 * @param userId        who is asking
 * @param character     { owner, campaign_id }
 * @param roleInCampaign the asker's role in the character's campaign, or null
 * @param partyVisible  that campaign's setting
 * @returns 'owner' | 'gm' | 'party' | null
 */
export function characterAccess(userId, character, roleInCampaign, partyVisible = false) {
  if (!character) return null;
  if (character.owner === userId) return 'owner';
  if (!character.campaign_id) return null;
  if (runs(roleInCampaign)) return 'gm';
  if (roleInCampaign === 'player' && partyVisible) return 'party';
  return null;
}

export const characterCan = {
  view: (access) => access !== null,
  edit: (access) => access === 'owner' || access === 'gm',
  /** Only the owner deletes a sheet. A GM takes it out of the campaign instead. */
  delete: (access) => access === 'owner',
};

/* -------------------------------------------------------------------------
   Accounts
   ------------------------------------------------------------------------- */

export const accountCan = {
  manage: (user) => atLeast(user, 'admin'),

  /**
   * A profile is seen by its owner, by admins, and by anyone who shares a
   * campaign with its owner - the people who already see their name at the table.
   */
  viewProfile: (viewer, targetId, sharesCampaign) => viewer.id === targetId || atLeast(viewer, 'admin') || Boolean(sharesCampaign),

  /** Messages from the Contact Me page, with whatever contact details they carry, are for admins only. */
  readFeedback: (user) => atLeast(user, 'admin'),
};
