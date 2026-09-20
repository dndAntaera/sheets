// Campaigns in the app: the list, one campaign, and joining by invitation.
//
// Nothing here decides who may do what. The server does, by worker/src/policy.js,
// and the page only offers what the campaign's role suggests will be allowed and
// shows the server's answer when it is not. The settings form is drawn from
// web/engine/campaign.js - the same description the server checks settings
// against - so a setting added there appears here without a change to this file.

import { h, field, select, checkbox, textarea, labelled, button, refill, bindForm } from './dom.js';
import { settingsSchema } from '../engine/campaign.js';
import { VARIANT_MODULES } from '../engine/modules.js';
import { CONTENT_TYPES } from '../engine/library.js';
import { flattenLibrary } from '../engine/sync.js';
import { remote, campaignLibrary } from '../store.js';
import { avatarFor, CAMPAIGN_ROLE_LABELS as ROLE_LABELS, keepPendingInvite, takePendingInvite } from './people.js';

export { takePendingInvite };

const inviteLink = (code) => `${location.origin}${location.pathname}#/join/${code}`;

/**
 * A banner for the outcome of an action. Most actions redraw the page, which
 * would take the banner with it, so an outcome can be left for the next page
 * drawn (`flash`) as well as shown on this one (`say`).
 */
let pending = null;

function messenger() {
  const el = h('p.banner', { hidden: true });
  const say = (level, text) => {
    el.className = `banner ${level}`;
    el.textContent = text;
    el.hidden = false;
  };
  if (pending) {
    say(pending.level, pending.text);
    pending = null;
  }
  return { el, say, flash: (level, text) => { pending = { level, text }; } };
}

const signInFirst = (main, text) => refill(main, h('div.roster',
  h('h1', { text: 'Campaigns' }),
  h('p.empty', { text })));

/* ==========================================================================
   The list
   ========================================================================== */

export async function showCampaigns(main, app) {
  if (!app.user) return signInFirst(main, 'Sign in to start a campaign, or to join one you have been invited to.');
  const { el: message, say } = messenger();

  try {
    app.campaigns = await remote.campaigns.list();
  } catch (err) {
    say('fail', `Could not load campaigns: ${err.message}`);
  }

  const joinField = h('input.field', { placeholder: 'Invitation code', 'aria-label': 'Invitation code', maxLength: 64 });
  const join = h('form.row.campaign-join', {
    onsubmit: (ev) => {
      ev.preventDefault();
      const code = joinField.value.trim().replace(/.*#\/join\//, '');
      if (code) location.hash = `#/join/${code}`;
    },
  }, labelled('Join with a code or link', joinField), button('Join', null, { title: 'Look at the invitation first' }));
  join.querySelector('button').type = 'submit';

  refill(main, h('div.roster.campaigns-page',
    h('div.roster-intro',
      h('h1', { text: 'Campaigns' }),
      h('p.hint', { text: 'A campaign is a table: a GM, the players they invite, one ruleset, and the choices the GM makes for everyone.' })),
    message,
    app.user.gm ? newCampaignForm(app, say) : h('p.hint', { text: 'Starting a campaign needs the GM role; an admin can give it. Anyone can join one they are invited to.' }),
    join,
    app.campaigns.length
      ? h('ul.roster-list', app.campaigns.map((c) => h('li.roster-row',
        h('a.roster-link', { href: `#/campaign/${c.id}` },
          h('span.roster-name', { text: c.name }),
          h('span.roster-meta', { text: [
            c.role === 'owner' ? 'yours' : `run by ${c.ownerName}`,
            `${c.memberCount} member${c.memberCount === 1 ? '' : 's'}`,
            `${c.characterCount} character${c.characterCount === 1 ? '' : 's'}`,
          ].join(' - ') })),
        c.unseenChanges ? h('span.badge.unseen', { text: `${c.unseenChanges} change${c.unseenChanges === 1 ? '' : 's'}`, title: 'Changes to characters here you have not seen.' }) : null,
        h(`span.badge.campaign-role-${c.role}`, { text: ROLE_LABELS[c.role] }),
        h(`span.badge.ruleset-${c.ruleset}`, { text: app.baseRules.rulesets[c.ruleset]?.shortName || c.ruleset }))))
      : h('p.empty', { text: 'You are not in any campaigns yet.' })));
}

function newCampaignForm(app, say) {
  const draft = { name: '', ruleset: 'srd', description: '' };
  const rulesetChoice = select('ruleset', draft.ruleset,
    Object.values(app.baseRules.rulesets).map((r) => [r.id, r.name]), { className: 'narrow' });

  const form = h('form.campaign-new',
    h('h2', { text: 'Start a campaign' }),
    h('div.row',
      labelled('Name', field('name', '', { placeholder: 'The Sunless Road', className: 'grow' })),
      labelled('Ruleset', rulesetChoice)),
    labelled('Description', textarea('description', '', { rows: 2, placeholder: 'What the players should know before they join.' }), { wide: true }),
    h('div.row', h('button.btn', { type: 'submit' }, 'Start it')));

  bindForm(form, () => draft, () => {});
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!draft.name.trim()) return say('fail', 'A campaign needs a name.');
    try {
      const made = await remote.campaigns.create(draft);
      location.hash = `#/campaign/${made.id}`;
    } catch (err) {
      say('fail', `The campaign was not started: ${err.message}.`);
    }
  });
  return form;
}

/* ==========================================================================
   One campaign
   ========================================================================== */

export async function showCampaign(main, app, id) {
  if (!app.user) return signInFirst(main, 'Sign in to see your campaigns.');
  const { el: message, say, flash } = messenger();

  let campaign;
  try {
    campaign = await remote.campaigns.get(id);
  } catch (err) {
    refill(main, h('div.roster', h('h1', { text: 'Campaign' }), h('p.empty', { text: err.message })));
    return;
  }

  const runs = campaign.role === 'owner' || campaign.role === 'gm';
  const ruleset = app.baseRules.rulesets[campaign.ruleset];
  const redraw = () => showCampaign(main, app, id);
  /** Do something, then redraw with its outcome. `work` may return the message. */
  const attempt = async (work, success) => {
    try {
      const said = await work();
      // Only a string returned by the work is a message; API replies are not.
      const text = typeof said === 'string' ? said : success;
      if (text) flash('pass', text);
      app.campaigns = await remote.campaigns.list().catch(() => app.campaigns);
      await redraw();
    } catch (err) {
      say('fail', `${err.message}.`);
    }
  };

  document.title = `${campaign.name} - Campaigns`;
  refill(main, h('div.roster.campaign-page',
    h('a.back.hint', { href: '#/campaigns', text: 'All campaigns' }),
    h('div.campaign-head',
      h('div',
        h('h1', { text: campaign.name }),
        h('p.hint', { text: [
          `${ruleset?.name || campaign.ruleset}`,
          campaign.role === 'owner' ? 'you run it' : `run by ${campaign.ownerName}`,
          `you are ${campaign.role === 'owner' ? 'its owner' : `a ${ROLE_LABELS[campaign.role]}`}`,
        ].join(' - ') })),
      h(`span.badge.campaign-role-${campaign.role}`, { text: ROLE_LABELS[campaign.role] })),
    campaign.description ? h('p.campaign-description', { text: campaign.description }) : null,
    message,
    runs ? changesBlock(app, campaign) : null,
    tableSettings(campaign, ruleset),
    homebrewBlock(campaign, runs),
    myCharacters(app, campaign, attempt),
    membersBlock(app, campaign, attempt),
    runs ? settingsForm(app, campaign, ruleset, attempt) : null,
    runs ? invitesBlock(campaign, attempt, say) : null,
    leaveOrDelete(app, campaign, attempt)));
}

/**
 * For the GMs: changes to what the campaign's characters are built of, newest
 * first, the ones they have not seen marked. Marking them read clears the count
 * beside Campaigns in the header.
 */
function changesBlock(app, campaign) {
  const body = h('div', h('p.hint', { text: 'Loading\u2026' }));
  const section = h('section.campaign-section.campaign-changes', h('h2', { text: 'Changes to characters' }), body);
  const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const draw = async () => {
    let feed;
    try {
      feed = await remote.campaigns.changes(campaign.id);
    } catch (err) {
      refill(body, h('p.hint', { text: `${err.message}.` }));
      return;
    }
    refill(body,
      h('p.hint', { text: feed.changes.length
        ? 'When a finished character leaves the creator with its race, classes, scores, skills, feats, spells or languages changed, it is listed here.'
        : 'No finished character here has been changed.' }),
      feed.unseen ? h('div.row',
        h('span.badge.unseen', { text: `${feed.unseen} new` }),
        button('Mark all read', async () => {
          await remote.campaigns.changesSeen(campaign.id).catch(() => {});
          app.campaigns = await remote.campaigns.list().catch(() => app.campaigns);
          app.refreshHeader?.();
          draw();
        }, { subtle: true })) : null,
      feed.changes.length ? h('ol.history-list', feed.changes.slice(0, 30).map((c) => h(`li.history-entry${c.unseen ? '.is-unseen' : ''}`,
        h('div.history-head',
          h('a', { href: `#/sheet/${c.characterId}/history`, text: c.characterName }),
          h('time.hint', { dateTime: c.created, text: when(c.created) }),
          h('span.hint', { text: c.by?.name ? `by ${c.by.name}` : '' }),
          c.unseen ? h('span.badge.unseen', { text: 'new' }) : null),
        h('ul.history-changes', c.changes.map((ch) => h('li', h('span.label', { text: ch.label }), ' ', h('span', { text: ch.text })))))))
        : null);
  };
  draw();
  return section;
}

/**
 * The campaign's homebrew: what its GMs have written, and whether players'
 * own counts here. GMs get the way to write it; everyone sees what there is.
 */
function homebrewBlock(campaign, runs) {
  const list = h('p.hint', { text: 'Loading\u2026' });
  campaignLibrary(campaign.id).fetch().then((shelf) => {
    const entries = flattenLibrary(shelf.load(), CONTENT_TYPES);
    list.textContent = entries.length
      ? entries.map((e) => `${e.name || 'Unnamed'} (${CONTENT_TYPES[e.kind].label.toLowerCase()})`).join(', ')
      : 'None yet.';
  }).catch((err) => { list.textContent = err.message; });

  return h('section.campaign-section',
    h('h2', { text: 'Homebrew' }),
    h('p.hint', { text: campaign.settings?.allowHomebrew
      ? 'Characters here can use the campaign\u2019s homebrew, and their players\u2019 own.'
      : 'Characters here can use only the campaign\u2019s homebrew. Players\u2019 own homebrew does not count here.' }),
    list,
    runs ? h('a.btn', { href: `#/campaign/${campaign.id}/homebrew` }, 'Write campaign homebrew') : null);
}

/** What the table plays by, for everyone to read. */
function tableSettings(campaign, ruleset) {
  const schema = settingsSchema(ruleset);
  const valueOf = (f) => {
    const set = f.key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), campaign.settings);
    return set === undefined ? f.default : set;
  };
  const rules = schema.filter((f) => f.group === 'rules');
  const houseRules = valueOf(schema.find((f) => f.key === 'houseRules'));
  const link = valueOf(schema.find((f) => f.key === 'link'));

  return h('section.campaign-section',
    h('h2', { text: 'At this table' }),
    h('dl.table-facts',
      h('dt', { text: 'Ruleset' }), h('dd', { text: ruleset?.name || campaign.ruleset }),
      h('dt', { text: 'Starting level' }), h('dd', { text: String(valueOf(schema.find((f) => f.key === 'startingLevel'))) }),
      rules.map((f) => [h('dt', { text: f.label }), h('dd', { text: valueOf(f) ? 'on' : 'off' })]),
      h('dt', { text: 'Party' }), h('dd', { text: valueOf(schema.find((f) => f.key === 'partyVisible')) ? 'players can see each other’s characters' : 'each player sees their own' }),
      link ? [h('dt', { text: 'Link' }), h('dd', h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: link }))] : null),
    houseRules ? h('div.house-rules', h('h3', { text: 'House rules' }), h('p', { text: houseRules })) : null);
}

/** The asker's own characters: the ones in this campaign, and bringing another. */
function myCharacters(app, campaign, attempt) {
  const me = campaign.members.find((m) => m.id === app.user.id);
  const mine = me?.characters || [];
  const picker = h('select.field.grow', h('option', { value: '', text: 'Loading your characters…' }));

  remote.list().then((rows) => {
    const free = rows.filter((r) => r.owner === app.user.id && !r.campaignId);
    refill(picker,
      h('option', { value: '', text: free.length ? '- a character of yours -' : 'No free characters: every one is in a campaign, or not yet saved to your account' }),
      free.map((r) => h('option', { value: r.id, text: `${r.name || 'Unnamed'}${r.build ? ` - ${r.build}` : ''}` })));
  }).catch(() => refill(picker, h('option', { value: '', text: 'Could not load your characters' })));

  return h('section.campaign-section',
    h('h2', { text: 'Your characters here' }),
    mine.length
      ? h('ul.plain-list', mine.map((c) => h('li',
        h('a', { href: `#/sheet/${c.id}`, text: c.name || 'Unnamed' }),
        h('span.hint', { text: ` ${c.build || `level ${c.level}`}` }),
        button('Take out', () => attempt(() => remote.campaigns.removeCharacter(campaign.id, c.id), `${c.name} left the campaign; it is still yours.`), { subtle: true }))))
      : h('p.hint', { text: 'None yet.' }),
    h('form.row', {
      onsubmit: (ev) => {
        ev.preventDefault();
        if (!picker.value) return;
        attempt(() => remote.campaigns.addCharacter(campaign.id, picker.value), 'Character brought to the campaign. It now plays by the campaign’s rules.');
      },
    }, labelled('Bring a character', picker), h('button.btn', { type: 'submit' }, 'Bring it')),
    h('p.hint', { text: `A character in a campaign plays by its ruleset and settings. ${campaign.role === 'player' ? 'The GMs can see and edit it.' : ''}` }));
}

function membersBlock(app, campaign, attempt) {
  const isOwner = campaign.role === 'owner';
  const runs = isOwner || campaign.role === 'gm';

  return h('section.campaign-section',
    h('h2', { text: `Members (${campaign.members.length})` }),
    h('div.table-scroll', h('table.admin-table',
      h('thead', h('tr', ['Member', 'Role', 'Characters', ''].map((c) => h('th', { text: c })))),
      h('tbody', campaign.members.map((m) => {
        const self = m.id === app.user.id;
        const actions = [];
        if (isOwner && m.role !== 'owner') {
          actions.push(button(m.role === 'gm' ? 'Make player' : 'Make GM', () => attempt(
            () => remote.campaigns.setMemberRole(campaign.id, m.id, m.role === 'gm' ? 'player' : 'gm'),
            `${m.name} is now ${m.role === 'gm' ? 'a player' : 'a GM'}.`,
          ), { subtle: true }));
        }
        const canRemove = !self && m.role !== 'owner' && (m.role === 'player' ? runs : isOwner);
        if (canRemove) {
          actions.push(button('Remove', () => {
            if (!confirm(`Remove ${m.name} from ${campaign.name}? Their characters leave the campaign with them, but stay theirs.`)) return;
            attempt(() => remote.campaigns.removeMember(campaign.id, m.id), `${m.name} was removed.`);
          }, { subtle: true, danger: true }));
        }
        return h('tr', { class: self ? 'is-me' : '' },
          h('th', { scope: 'row' },
            h('a.member-link', { href: `#/profile/${m.id}` }, avatarFor(m, 'sm'), h('span', { text: m.name })),
            self ? h('span.badge', { text: 'you' }) : null),
          h('td', h(`span.badge.campaign-role-${m.role}`, { text: ROLE_LABELS[m.role] })),
          h('td', m.characters
            ? (m.characters.length
              ? m.characters.map((c, i) => [i ? ', ' : '', h('a', { href: `#/sheet/${c.id}`, text: c.name || 'Unnamed' })])
              : h('span.hint', { text: 'none' }))
            : h('span.hint', { text: `${m.characterCount}` })),
          h('td', actions));
      })))));
}

/** The SRD's variant rules in the settings form: a folding list, by category. */
function variantSettings(app, fields, control) {
  if (!fields.length) return null;
  const catalog = app.baseRules.variants;
  const byId = new Map((catalog?.variants || []).map((v) => [v.id, v]));
  return h('details.variant-settings',
    h('summary', { text: `SRD variant rules (${fields.length})` }),
    h('p.hint', { text: 'Whatever is set here is what every character in the campaign plays by. Each rule\u2019s full text is in the Reference.' }),
    (catalog?.categories || []).map(([key, label]) => {
      const here = fields.filter((f) => byId.get(f.module)?.category === key);
      return here.length ? [h('h4', { text: label }), h('div.settings-grid', here.map((f) => control({ ...f, hint: byId.get(f.module)?.summary || f.hint })))] : null;
    }));
}

/** The GMs' settings form, drawn from the schema. */
function settingsForm(app, campaign, ruleset, attempt) {
  const isOwner = campaign.role === 'owner';
  const draft = {
    name: campaign.name,
    description: campaign.description,
    ruleset: campaign.ruleset,
    settings: structuredClone(campaign.settings || {}),
  };
  const schema = settingsSchema(ruleset);
  const current = (f) => {
    const set = f.key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), draft.settings);
    return set === undefined ? f.default : set;
  };

  const control = (f) => {
    const path = `settings.${f.key}`;
    switch (f.type) {
      case 'bool': return h('div.cell.cell-check', checkbox(path, current(f), f.label, { title: f.hint }), f.hint ? h('span.hint', { text: f.hint }) : null);
      case 'int': return h('div.cell', labelled(f.label, field(path, current(f), { type: 'int', min: f.min, max: f.max, width: f.max > 9999 ? '8rem' : '5rem', title: f.hint, placeholder: f.default === null ? 'by level' : undefined })), f.default === null && f.hint ? h('span.hint', { text: f.hint }) : null);
      case 'textarea': return labelled(f.label, textarea(path, current(f), { rows: 4, placeholder: f.hint }), { wide: true });
      default: return labelled(f.label, field(path, current(f), { placeholder: f.hint, className: 'grow' }), { wide: true });
    }
  };

  const form = h('form.campaign-section.campaign-settings',
    h('h2', { text: 'Settings' }),
    h('div.row',
      labelled('Name', field('name', draft.name, { className: 'grow' })),
      labelled('Ruleset', select('ruleset', draft.ruleset,
        Object.values(app.baseRules.rulesets).map((r) => [r.id, r.name]), {
          className: 'narrow',
          title: isOwner ? 'Changing it moves every character in the campaign to the new ruleset.' : 'Only the owner changes the ruleset.',
        }))),
    labelled('Description', textarea('description', draft.description, { rows: 2 }), { wide: true }),
    h('h3', { text: 'Rules for the table' }),
    schema.filter((f) => f.group === 'rules').length
      ? [
        h('div.settings-grid', schema.filter((f) => f.group === 'rules' && !VARIANT_MODULES.includes(f.module)).map(control)),
        variantSettings(app, schema.filter((f) => f.group === 'rules' && VARIANT_MODULES.includes(f.module)), control),
      ]
      : h('p.hint', { text: `${ruleset.name} leaves nothing more for the GM to decide.` }),
    h('h3', { text: 'The table' }),
    h('div.settings-grid', schema.filter((f) => f.group === 'table').map(control)),
    h('div.row', h('button.btn', { type: 'submit' }, 'Save settings')));

  if (!isOwner) form.querySelector('[data-field="ruleset"]').disabled = true;
  bindForm(form, () => draft, () => {});
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const changing = draft.ruleset !== campaign.ruleset;
    if (changing && !confirm(`Move ${campaign.name} and every character in it to ${app.baseRules.rulesets[draft.ruleset].name}? Settings that do not exist there are dropped.`)) return;
    attempt(async () => {
      const saved = await remote.campaigns.update(campaign.id, draft);
      return saved.dropped?.length ? `Settings saved, except: ${saved.dropped.join(', ')}.` : 'Settings saved.';
    });
  });
  return form;
}

function invitesBlock(campaign, attempt, say) {
  const isOwner = campaign.role === 'owner';
  const draft = { role: 'player', maxUses: null, expiresInDays: 7 };

  const create = h('form.row',
    labelled('Invite as', select('role', 'player', isOwner ? [['player', 'player'], ['gm', 'GM']] : [['player', 'player']], { className: 'narrow' })),
    labelled('Uses', field('maxUses', null, { type: 'int', min: 1, max: 1000, placeholder: 'any', width: '5rem', title: 'How many people can join with it. Empty for any number.' })),
    labelled('Days', field('expiresInDays', 7, { type: 'int', min: 1, max: 365, width: '5rem', title: 'How long it works.' })),
    h('button.btn', { type: 'submit' }, 'Make an invitation'));
  bindForm(create, () => draft, () => {});
  create.addEventListener('submit', (ev) => {
    ev.preventDefault();
    attempt(async () => {
      const made = await remote.campaigns.invite(campaign.id, draft);
      const copied = await navigator.clipboard?.writeText(inviteLink(made.code)).then(() => true).catch(() => false);
      return `Invitation ${made.code} made${copied ? ', and its link copied' : ''}: ${inviteLink(made.code)}`;
    });
  });

  const active = (campaign.invites || []).filter((i) => i.active);
  const spent = (campaign.invites || []).filter((i) => !i.active);

  return h('section.campaign-section',
    h('h2', { text: 'Invitations' }),
    h('p.hint', { text: 'Send the link, or the code. Whoever opens it signs in and joins.' }),
    create,
    active.length
      ? h('ul.plain-list.invites', active.map((i) => h('li',
        h('code.invite-code', { text: i.code }),
        h('span.hint', { text: ` ${ROLE_LABELS[i.role]} - used ${i.uses}${i.maxUses ? ` of ${i.maxUses}` : ''} - ${i.expires ? `until ${new Date(i.expires).toLocaleDateString()}` : 'no expiry'}` }),
        button('Copy link', async () => {
          try {
            await navigator.clipboard.writeText(inviteLink(i.code));
            say('pass', 'Link copied.');
          } catch {
            say('pass', inviteLink(i.code));
          }
        }, { subtle: true }),
        button('Withdraw', () => attempt(() => remote.campaigns.withdrawInvite(campaign.id, i.code), 'Invitation withdrawn.'), { subtle: true, danger: true }))))
      : h('p.hint', { text: 'No invitations open.' }),
    spent.length ? h('p.hint', { text: `${spent.length} used up or expired.` }) : null);
}

function leaveOrDelete(app, campaign, attempt) {
  if (campaign.role === 'owner') {
    return h('section.campaign-section.danger-zone',
      button('Delete this campaign', () => {
        if (!confirm(`Delete ${campaign.name}? Every member leaves it and every character in it is released. The characters are not deleted.`)) return;
        attempt(async () => {
          await remote.campaigns.remove(campaign.id);
          location.hash = '#/campaigns';
        });
      }, { subtle: true, danger: true }));
  }
  return h('section.campaign-section.danger-zone',
    button('Leave this campaign', () => {
      if (!confirm(`Leave ${campaign.name}? Your characters in it leave with you.`)) return;
      attempt(async () => {
        await remote.campaigns.removeMember(campaign.id, app.user.id);
        location.hash = '#/campaigns';
      });
    }, { subtle: true, danger: true }));
}

/* ==========================================================================
   Joining by invitation
   ========================================================================== */

/** An invitation opened while signed out is remembered until sign-in finishes. */
export async function showJoin(main, app, code) {
  const { el: message, say } = messenger();

  if (!app.user) {
    keepPendingInvite(code);
    const offered = Object.entries(app.providers || {}).filter(([, ready]) => ready).map(([name]) => name);
    refill(main, h('div.roster.join-page',
      h('h1', { text: 'You have been invited to a campaign' }),
      h('p', { text: 'Sign in to see the invitation and join. You come straight back here afterwards.' }),
      offered.length
        ? h('div.row', offered.sort().reverse().map((name) => button(`Continue with ${name === 'google' ? 'Google' : 'Discord'}`, () => remote.signIn(name))))
        : h('p.hint', { text: remote.enabled() ? 'Sign-in is not available right now.' : 'This copy of the app has no server, so it cannot join campaigns.' })));
    return;
  }

  let invite;
  try {
    invite = await remote.campaigns.previewInvite(code);
  } catch (err) {
    refill(main, h('div.roster.join-page', h('h1', { text: 'Invitation' }), h('p.empty', { text: `${err.message}.` })));
    return;
  }

  const rulesetName = app.baseRules.rulesets[invite.campaign.ruleset]?.name || invite.campaign.ruleset;
  const already = invite.currentRole && (invite.currentRole !== 'player' || invite.role === 'player');

  refill(main, h('div.roster.join-page',
    h('h1', { text: invite.campaign.name }),
    h('p.hint', { text: `${rulesetName} - run by ${invite.ownerName}` }),
    invite.campaign.description ? h('p.campaign-description', { text: invite.campaign.description }) : null,
    message,
    already
      ? h('p', {}, 'You are already in this campaign. ', h('a', { href: `#/campaign/${invite.campaign.id}`, text: 'Go to it' }), '.')
      : h('div.row',
        h('p', { text: `You are invited to join as ${invite.role === 'gm' ? 'a GM' : 'a player'}.` }),
        button('Join', async () => {
          try {
            const result = await remote.campaigns.acceptInvite(code);
            app.campaigns = await remote.campaigns.list().catch(() => app.campaigns);
            location.hash = `#/campaign/${result.campaignId}`;
          } catch (err) {
            say('fail', `${err.message}.`);
          }
        }))));
}

