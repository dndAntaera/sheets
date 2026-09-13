// The application: the roster, the sheet, the content library, and the wiring
// between a keystroke and a recomputed number.
//
// The shape of it is deliberately small. There is one character in memory, one
// derived sheet beside it, and one rule: an edit writes to the character, the
// derived sheet is rebuilt from scratch, and the derived outputs are repainted.
// No partial updates, no dependency graph. Recomputing a whole sheet is a few
// hundred arithmetic operations, which is nothing, and the alternative - working
// out which numbers a change affects - is where sheets get their wrong totals.

import {
  loadRules, withRuleset, derive, blankCharacter, migrate, RULESET_IDS,
  moduleState, MODULES, MODULE_LABELS, CONTENT_TYPES, embed, applyCampaign, fillMissing, flattenLibrary,
} from './engine/index.js';
import { h, paint, refill, button, bindForm, setPath } from './ui/dom.js';
import { wizardPage, paintWizard, WIZARD_STEPS, stepForNotice } from './ui/wizard.js';
import {
  identityPanel, levelsPanel, abilitiesPanel, combatPanel, skillsPanel,
  featsPanel, houserulesPanel, wealthPanel, textPanel, castingPanel,
  effectsPanel, contentPanel, paintEffects, paintConditions, paintContent,
} from './ui/sheet.js';
import { showContent } from './ui/content.js';
import { showAdmin, ROLE_LABELS } from './ui/admin.js';
import { showCampaigns, showCampaign, showJoin, takePendingInvite } from './ui/campaigns.js';
import { showLanding } from './ui/landing.js';
import { showProfile, showSettings, avatarFor } from './ui/profile.js';
import { applyAppearance, adoptAccountAppearance, setAppearance, isDark } from './ui/appearance.js';
import { config } from './config.js';
import {
  local, remote, library, campaignLibrary, preferences, account, syncLibrary, save as saveEverywhere, newId,
} from './store.js';

const PANELS = {
  identity: identityPanel,
  levels: levelsPanel,
  abilities: abilitiesPanel,
  combat: combatPanel,
  skills: skillsPanel,
  feats: featsPanel,
  houserules: houserulesPanel,
  casting: castingPanel,
  wealth: wealthPanel,
  effects: effectsPanel,
  content: contentPanel,
  text: textPanel,
};

/** Where a notice about a field sends the reader. */
const NOTICE_PANEL = { hp: 'combat' };

const app = {
  baseRules: null,   // every ruleset loaded; `rules` is the one in force
  rules: null,
  character: null,
  derived: null,
  campaigns: [],     // the campaigns the signed-in account is in, with settings
  overrides: {},     // what the open sheet's campaign decides for it
  panels: {},
  status: null,
  user: null,
  unbind: null,
};

/* =========================================================================
   Start
   ========================================================================= */

async function start() {
  // How this player likes the site to look, before anything is drawn.
  applyAppearance();
  app.baseRules = await loadRules('./data/');
  app.rules = app.baseRules;

  // Back from Google or Discord: finish signing in before drawing anything, so
  // the header is right the first time.
  const returning = location.hash.match(/^#\/signed-in\/([a-f0-9]+)$/);
  if (returning && remote.enabled()) {
    let next = '#/characters';
    try {
      await remote.completeSignIn(returning[1]);
      app.notice = { level: 'pass', text: 'Signed in. Your characters and homebrew are kept with your account.' };
      // Signed in to accept an invitation: go back to it.
      const invite = takePendingInvite();
      if (invite) next = `#/join/${invite}`;
    } catch (err) {
      app.notice = { level: 'fail', text: `Sign-in did not complete: ${err.message}` };
    }
    history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  }
  const failed = location.hash.match(/^#\/sign-in-failed\/([\w-]+)$/);
  if (failed) {
    app.notice = { level: 'fail', text: SIGN_IN_FAILURES[failed[1]] || 'Sign-in did not complete.' };
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  }

  await connect();

  document.body.append(header(), h('main#main'), footer(), h('div#datalists.hidden'));
  window.addEventListener('hashchange', route);
  window.addEventListener('library-synced', (ev) => {
    refreshDatalists();
    // Entries that arrived from another device appear in an open library view.
    if (ev.detail?.changed && location.hash.startsWith('#/content')) route();
  });
  route();
}

const SIGN_IN_FAILURES = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long. Please try again.',
  'already-linked': 'That account is already signed in to a different set of characters, so it cannot be added to this one.',
  'link-expired': 'Linking took too long. Please try again.',
  'provider-unavailable': 'That way of signing in is not set up on this server.',
  'provider-refused': 'The sign-in provider would not confirm who you are. Please try again.',
  'bad-request': 'Sign-in could not start. Please try again.',
};

/**
 * Who is signed in, what the server offers, and the Antaera campaign settings.
 * Nothing here is allowed to stop the app: a server that is down just means a
 * local session, and the header says so.
 */
async function connect() {
  app.user = null;
  app.providers = {};
  app.serverDown = false;
  if (!remote.enabled()) return;

  try {
    app.providers = await remote.providers();
  } catch {
    app.serverDown = true;
    return;
  }

  if (account.signedIn()) {
    try {
      app.user = await remote.me();
      syncLibrary().catch(() => {});
    } catch {
      app.user = null;
    }
  }

  if (app.user) {
    adoptAccountAppearance(app.user.preferences);
    app.campaigns = await remote.campaigns.list().catch(() => []);
  }
}

/**
 * Rulesets anyone may build under, outside a campaign (`"public": true` in the
 * ruleset's file). The others are reached only by being invited to a campaign
 * that uses them.
 */
const publicRulesets = () => RULESET_IDS.filter((id) => app.baseRules.rulesets[id]?.public);

/**
 * Whether this visitor has signed in, which the Characters and Content pages
 * and making a character all take. A build with no server (apiBase empty) has
 * no one to sign in to, and counts everyone as signed in.
 */
const signedIn = () => !remote.enabled() || Boolean(app.user);
const canCreate = signedIn;

const CHARACTERS_NEED_SIGN_IN = 'Sign in to see your characters and create new ones. They are kept with your account, on any device.';

/** In place of a page that needs signing in: why, and the buttons to do it. */
function signInPage(heading, reason) {
  app.character = null;
  document.title = `${heading} - ${config.title}`;
  refill(main(), h('div.roster',
    h('h1', { text: heading }),
    h('div.roster-new', app.serverDown
      ? h('p.ruleset-blurb', { text: 'The server cannot be reached right now, so signing in is not possible. Please try again shortly.' })
      : [h('p.ruleset-blurb', { text: reason }), h('div.roster-actions', signInButtons())])));
}

/**
 * A character about to be saved as new - imported, or a copy - made this
 * visitor's: out of any campaign, and on a public ruleset.
 */
function claimAsNew(character) {
  character.id = newId();
  delete character.campaignId;
  delete character.access;
  if (!publicRulesets().includes(character.ruleset)) character.ruleset = publicRulesets()[0];
  character.meta = { ...character.meta, created: new Date().toISOString(), updated: null, owner: app.user?.id || null };
  return character;
}

/** The campaign a character is in, if this account can see it. */
function campaignOf(character) {
  return character?.campaignId ? app.campaigns.find((c) => c.id === character.campaignId) || null : null;
}

/**
 * The rules a character plays by: its campaign's ruleset and settings if it is
 * in one, its own ruleset and choices if not.
 */
function rulesFor(character) {
  const campaign = campaignOf(character);
  const base = withRuleset(app.baseRules, campaign ? campaign.ruleset : character.ruleset);
  // The campaign's homebrew, when it has been fetched; the engine falls back on
  // the sheet's own copies of it when it has not.
  const shelf = campaign ? campaignLibrary(campaign.id) : null;
  const content = shelf?.loaded() ? flattenLibrary(shelf.load(), CONTENT_TYPES) : undefined;
  return { campaign, ...applyCampaign(base, campaign && { ...campaign, content }) };
}

/**
 * The libraries a character may take homebrew from, in the order they are
 * searched. Its player's own, if it is independent. In a campaign, the
 * campaign's - and the player's own as well, only if the campaign allows it.
 */
function shelvesFor(character) {
  const campaign = campaignOf(character);
  if (!campaign) return [{ shelf: library }];
  const shelves = [{ shelf: campaignLibrary(campaign.id), campaign: campaign.id }];
  if (app.rules.campaign?.allowHomebrew) shelves.push({ shelf: library });
  return shelves;
}

/* =========================================================================
   Header
   ========================================================================= */

/** Draw the header again - after a change to the account it shows, say. */
function refreshHeader() {
  const old = document.querySelector('header.top');
  if (!old) return;
  old.replaceWith(header());
  const view = VIEWS.find((v) => v.match.test(location.hash.replace(/^#\/?/, '')));
  if (view) markNav(view.nav);
}

function header() {
  app.status = h('span.status', { text: '' });

  return h('header.top',
    h('a.brand', { href: '#/', title: config.tagline },
      h('span.brand-name', { text: config.title })),
    h('nav.top-nav',
      NAV.filter((item) => item.visible()).map((item) => h('a', { href: item.href, text: item.label, dataset: { nav: item.key } })),
      h('a', { href: config.wikiUrl, target: '_blank', rel: 'noopener', text: 'Wiki' })),
    h('div.top-right',
      app.status,
      themeSwitch(),
      accountMenu()),
    app.notice ? h(`p.banner.${app.notice.level}`, { text: app.notice.text }) : null);
}

const PROVIDER_LABELS = { google: 'Google', discord: 'Discord' };

// Google's "G", as its sign-in branding guidelines give it.
const GOOGLE_G = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

/**
 * A button for each sign-in the server offers, or word that there are none.
 * Google's follows Google's own button design - white, its "G", "Sign in with
 * Google" - because a sign-in button that looks unlike Google's is one people
 * rightly hesitate over.
 */
function signInButtons() {
  const ORDER = ['google', 'discord'];
  const offered = Object.entries(app.providers || {}).filter(([, ready]) => ready).map(([name]) => name)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!offered.length) return h('p.hint', { text: 'Sign-in is not available right now. Please try again later.' });
  return offered.map((name) => {
    if (name === 'google') {
      const logo = h('span.gsi-logo');
      logo.innerHTML = GOOGLE_G;
      return h('button.gsi-button', { type: 'button', onclick: () => remote.signIn('google') },
        logo, h('span.gsi-label', { text: 'Sign in with Google' }));
    }
    return button(`Continue with ${PROVIDER_LABELS[name]}`, () => remote.signIn(name), {
      className: `provider provider-${name}`,
    });
  });
}

/**
 * Sign in, or who is signed in.
 *
 * Signed out, it offers each provider the server has been set up with. Signed
 * in, it offers the provider not yet linked, so a player who began with Google
 * can add Discord and reach the same account from either.
 */
function accountMenu() {
  if (!remote.enabled()) return null;
  if (app.serverDown) return h('span.hint.account', { text: 'server unreachable - saving here' });

  const ORDER = ['google', 'discord'];
  const offered = Object.entries(app.providers || {}).filter(([, ready]) => ready).map(([name]) => name)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  if (!app.user) {
    return h('details.account-menu',
      h('summary.btn', 'Sign in'),
      h('div.account-pop',
        h('p.hint', { text: 'Sign in to create characters, and keep them and your homebrew on any device.' }),
        signInButtons()));
  }

  const unlinked = offered.filter((name) => !(app.user.providers || []).includes(name));
  return h('details.account-menu',
    h('summary.account-name', { title: 'Your account' }, avatarFor(app.user, 'sm'), h('span', { text: app.user.name })),
    h('div.account-pop',
      h('div.account-links',
        h('a', { href: '#/profile', text: 'Your profile' }),
        h('a', { href: '#/settings', text: 'Settings' })),
      h('p.hint', { text: `Signed in with ${(app.user.providers || []).map((p) => PROVIDER_LABELS[p]).join(' and ')}.` }),
      h('p.account-role', h('span.badge', { text: ROLE_LABELS[app.user.role] || 'Player' }),
        h('span.hint', { text: app.user.admin
          ? ' You manage accounts, and can start campaigns.'
          : app.user.gm ? ' You can start campaigns and invite players to them.' : '' })),
      unlinked.map((name) => button(`Also sign in with ${PROVIDER_LABELS[name]}`, () => {
        remote.link(name).catch((err) => alert(`Could not start linking: ${err.message}`));
      }, { subtle: true, title: `Reach this same account by signing in with ${PROVIDER_LABELS[name]} too.` })),
      button('Sign out', async () => {
        await remote.signOut();
        location.hash = '#/';
        location.reload();
      }, { subtle: true, title: 'Your homebrew stays with your account and leaves this browser.' })));
}

/**
 * The legal footer, on every page. The notices themselves - the Open Game
 * License, the SRD's copyright notice, the Fan Content Policy - are kept on the
 * wiki's legal page, which this site shares; the footer states which material
 * here is Open Game Content and points there.
 */
function footer() {
  return h('footer.legal',
    h('p', { text: 'Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.' }),
    h('p',
      'Class, skill and race rules are Open Game Content from the System Reference Document, used under the Open Game License v1.0a. ',
      h('a', { href: config.legalUrl, target: '_blank', rel: 'noopener', text: 'License and legal information' }),
      '.'),
    h('p',
      h('a', { href: config.privacyUrl, text: 'Privacy Policy' }),
      ' · ',
      h('a', { href: config.termsUrl, text: 'Terms of Service' })));
}

/** The header's Day / Night switch: a shortcut to the Theme setting. */
function themeSwitch() {
  const label = () => (isDark() ? 'Day' : 'Night');
  const btn = button(label(), async () => {
    await setAppearance({ theme: isDark() ? 'light' : 'dark' }, { signedIn: Boolean(app.user) });
    btn.textContent = label();
  }, { subtle: true, title: 'Parchment or slate. More in Settings.' });
  return btn;
}

function markNav(which) {
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('is-active', a.dataset.nav === which);
}

/**
 * The name lists that let a field complete as it is typed: the SRD's own, the
 * character's embedded content, and the player's whole library.
 */
function refreshDatalists() {
  const host = document.getElementById('datalists');
  if (!host) return;
  // Suggest only what this character may use: see shelvesFor.
  const shelves = app.character ? shelvesFor(app.character).map((s) => s.shelf.load()) : [];
  const from = (plural) => shelves.flatMap((shelf) => shelf[plural].map((e) => e.name));
  const idx = app.derived?.index;
  const names = (...lists) => [...new Set(lists.flat().filter(Boolean))].sort();

  const lists = {
    'class-names': names(app.rules.classes.classes.map((c) => c.name), idx ? [...idx.classByName.keys()] : [], from('classes')),
    'race-names': names((app.rules.races?.races || []).map((r) => r.name), idx ? [...idx.raceByName.keys()] : [], from('races')),
    'feat-names': names(idx ? [...idx.featByName.keys()] : [], from('feats')),
    'item-names': names(idx ? [...idx.itemByName.keys()] : [], from('items')),
    'template-names': names(idx ? [...idx.templateByName.keys()] : [], from('templates')),
    'feature-names': names(idx ? [...idx.featureByName.keys()] : [], from('features')),
  };
  const signature = JSON.stringify(lists);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  refill(host, Object.entries(lists).map(([id, values]) =>
    h(`datalist#${id}`, values.map((value) => h('option', { value })))));
}

/* =========================================================================
   Views and navigation

   Every page is an entry in VIEWS: a pattern for the address after "#/", and a
   function to show it. Every header link is an entry in NAV, with a test for
   whether this person sees it. A new page is one entry in each - nothing else
   in the app needs to know about it.
   ========================================================================= */

const main = () => document.getElementById('main');

const VIEWS = [
  { match: /^sheet\/([^/]+)$/, nav: 'roster', show: ([id]) => (signedIn() ? openSheet(id) : signInPage('Characters', CHARACTERS_NEED_SIGN_IN)) },
  {
    match: /^create\/([^/]+)(?:\/([^/]+))?$/,
    nav: 'roster',
    title: 'Create a character',
    show: ([id, step]) => (signedIn() ? openSheet(id, { wizard: step || 'resume' }) : signInPage('Characters', CHARACTERS_NEED_SIGN_IN)),
  },
  { match: /^campaigns$/, nav: 'campaigns', title: 'Campaigns', show: () => showCampaigns(main(), app) },
  { match: /^campaign\/([^/]+)$/, nav: 'campaigns', title: 'Campaign', show: ([id]) => showCampaign(main(), app, id) },
  { match: /^join\/([^/]+)$/, nav: 'campaigns', title: 'Invitation', show: ([code]) => showJoin(main(), app, code) },
  { match: /^admin$/, nav: 'admin', title: 'Accounts', show: () => showAdmin(main(), app) },
  {
    match: /^profile(?:\/([^/]+))?$/,
    nav: 'profile',
    title: 'Profile',
    show: ([id]) => (app.user ? showProfile(main(), app, id) : signInPage('Profile', 'Sign in to see your profile.')),
  },
  { match: /^settings$/, nav: 'settings', title: 'Settings', show: () => (app.user ? showSettings(main(), app, settingsWays()) : signInPage('Settings', 'Sign in to change your username, picture and how the site looks.')) },
  { match: /^content(?:\/([^/]+))?(?:\/([^/]+))?$/, nav: 'content', title: 'Homebrew', show: ([kind, index]) => showLibrary(null, kind, index) },
  {
    match: /^campaign\/([^/]+)\/homebrew(?:\/([^/]+))?(?:\/([^/]+))?$/,
    nav: 'content',
    title: 'Campaign homebrew',
    show: ([id, kind, index]) => showLibrary(id, kind, index),
  },
  { match: /^characters$/, nav: 'roster', title: 'Characters', show: () => (signedIn() ? showRoster() : signInPage('Characters', CHARACTERS_NEED_SIGN_IN)) },
  { match: /^$/, nav: 'home', show: () => showHome() },
];

const NAV = [
  { key: 'roster', label: 'Characters', href: '#/characters', visible: () => signedIn() },
  { key: 'campaigns', label: 'Campaigns', href: '#/campaigns', visible: () => Boolean(app.user) },
  { key: 'content', label: 'Content', href: '#/content', visible: () => signedIn() },
  { key: 'admin', label: 'Accounts', href: '#/admin', visible: () => Boolean(app.user?.admin) },
];

function route() {
  const address = location.hash.replace(/^#\/?/, '');
  app.unbind?.();
  app.unbind = null;
  app.wizard = null;
  const view = VIEWS.find((v) => v.match.test(address)) || VIEWS[VIEWS.length - 1];
  const params = address.match(view.match)?.slice(1) || [];
  markNav(view.nav);
  if (view.nav !== 'roster' || !address.startsWith('sheet/')) app.character = null;
  if (view.title) document.title = `${view.title} - ${config.title}`;
  view.show(params);
}

/* =========================================================================
   Settings
   ========================================================================= */

/** What the Settings page needs from the app. */
function settingsWays() {
  return {
    linkable: Object.entries(app.providers || {}).filter(([, ready]) => ready).map(([name]) => name),
    link: (name) => remote.link(name).catch((err) => alert(`Could not start linking: ${err.message}`)),
    onAccountChanged: (profile) => {
      app.user = { ...app.user, name: profile.name, avatar: profile.avatar };
      refreshHeader();
    },
    signOut: async () => {
      await remote.signOut();
      location.hash = '#/';
      location.reload();
    },
  };
}

/* =========================================================================
   Homebrew libraries
   ========================================================================= */

/**
 * A homebrew library: the player's own (campaignId null), or a campaign's,
 * which only its GMs open. Both take signing in.
 */
async function showLibrary(campaignId, kind, index) {
  app.rules = app.baseRules;
  app.character = null;
  if (!signedIn()) {
    signInPage('Content', 'Sign in to write homebrew: races, classes, feats and items that count on your sheets. It is kept in a library of your own.');
    return;
  }

  const running = (app.campaigns || []).filter((c) => c.role === 'owner' || c.role === 'gm');
  const switcher = [
    { label: 'Your homebrew', href: '#/content', active: !campaignId },
    ...running.map((c) => ({ label: c.name, href: `#/campaign/${c.id}/homebrew`, active: c.id === campaignId })),
  ];

  if (!campaignId) {
    showContent(main(), app, kind || 'race', index ?? null, { switcher });
    return;
  }

  const campaign = running.find((c) => c.id === campaignId);
  if (!campaign) {
    refill(main(), h('div.roster', h('h1', { text: 'Campaign homebrew' }),
      h('p.empty', { text: 'Only the GMs of a campaign write its homebrew.' })));
    return;
  }
  const shelf = campaignLibrary(campaignId);
  if (!shelf.loaded()) {
    refill(main(), h('div.roster', h('p.empty', { text: 'Opening the campaign\u2019s homebrew\u2026' })));
    try {
      await shelf.fetch();
    } catch (err) {
      refill(main(), h('div.roster', h('h1', { text: 'Campaign homebrew' }), h('p.empty', { text: err.message })));
      return;
    }
  }
  showContent(main(), app, kind || 'race', index ?? null, {
    shelf,
    base: `#/campaign/${campaignId}/homebrew`,
    heading: `${campaign.name} homebrew`,
    intro: `Homebrew for everyone in ${campaign.name}. Characters in the campaign can use it, and it always counts for them. ${campaign.settings?.allowHomebrew ? 'Players may also use their own homebrew here.' : 'Players\u2019 own homebrew does not count here unless you allow it in the campaign\u2019s settings.'}`,
    where: 'Saved to the campaign. Its GMs can change it; its players can use it.',
    switcher,
  });
}

/* =========================================================================
   The landing page
   ========================================================================= */

function showHome() {
  app.character = null;
  document.title = `${config.title} - ${config.tagline}`;
  const ruleset = publicRulesets()[0];
  showLanding(main(), app, {
    signedIn: Boolean(app.user),
    needsSignIn: remote.enabled(),
    signInButtons,
    newCharacter: () => createCharacter(ruleset),
    rulesetName: app.baseRules.rulesets[ruleset].shortName,
  });
}

/* =========================================================================
   The roster
   ========================================================================= */

async function showRoster() {
  app.character = null;
  document.title = `Characters - ${config.title}`;
  const main = document.getElementById('main');

  let rows = local.list();
  let source = 'Kept in this browser.';
  if (remote.enabled() && app.user) {
    try {
      const server = await remote.list();
      // A character made here before signing in is not on the account until it
      // is next saved. It is listed anyway, marked, rather than vanishing from
      // the roster the moment its player signs in.
      const onServer = new Set(server.map((r) => r.id));
      const hereOnly = local.list().filter((r) => !onServer.has(r.id)).map((r) => ({ ...r, hereOnly: true }));
      rows = [...server, ...hereOnly];
      source = 'Your characters, and the characters in campaigns you run.';
    } catch { /* the local list stands */ }
  }

  refill(main, h('div.roster',
    h('div.roster-intro',
      h('h1', { text: 'Characters' }),
      h('p.hint', { text: config.tagline })),
    newCharacterPanel(),
    h('p.hint', { text: source }),
    rows.length
      ? h('ul.roster-list', rows.map(rosterRow))
      : h('p.empty', { text: 'No characters yet.' })));
}

/**
 * Making a character: under a public ruleset, chosen with a switch only when
 * there is more than one. Campaign-only rulesets are not offered here - a
 * character reaches one by being brought into a campaign its player was
 * invited to.
 */
function newCharacterPanel() {
  const offered = publicRulesets();
  const stored = preferences.get('newRuleset', config.defaultRuleset);
  const chosen = offered.includes(stored) ? stored : offered[0];
  const rs = app.baseRules.rulesets[chosen];

  return h('div.roster-new',
    h('div.roster-new-rules',
      offered.length > 1
        ? [h('span.label', { text: 'Build under' }),
          rulesetToggle(chosen, (id) => { preferences.set('newRuleset', id); showRoster(); }, { ids: offered })]
        : null,
      h('p.ruleset-blurb', { text: rs.description })),
    h('div.roster-actions',
      button(`New ${rs.shortName} character`, () => createCharacter(chosen)),
      importButton()));
}

/**
 * The ruleset switch: SRD first, and the default. It is a row of buttons
 * rather than a dropdown so every choice is visible at once. `opts.ids` limits
 * it to some rulesets.
 */
function rulesetToggle(current, onPick, opts = {}) {
  return h('div.segmented', { role: 'radiogroup', 'aria-label': 'Ruleset' },
    (opts.ids || RULESET_IDS).map((id) => {
      const rs = app.baseRules.rulesets[id];
      return h('button.segment', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(id === current),
        class: id === current ? 'is-on' : '',
        title: rs.tagline,
        disabled: opts.disabled,
        onclick: () => { if (id !== current) onPick(id); },
      }, rs.shortName);
    }));
}

function rosterRow(row) {
  const rs = app.baseRules.rulesets[row.ruleset || 'srd'];
  return h('li.roster-row',
    h('a.roster-link', { href: row.draftStep ? `#/create/${row.id}/${row.draftStep}` : `#/sheet/${row.id}` },
      h('span.roster-name', { text: row.name || 'Unnamed' }),
      h('span.roster-meta', { text: [row.player, row.build || `level ${row.level || '?'}`].filter(Boolean).join(' - ') })),
    row.draftStep ? h('span.badge.draft', { text: 'draft', title: 'Still in the character creator. Open it to carry on where you left off.' }) : null,
    row.hereOnly ? h('span.badge.here-only', { text: 'this browser', title: 'Not on your account yet. Open it and it is saved there.' }) : null,
    row.ownerName && app.user && row.owner !== app.user.id ? h('span.badge', { text: row.ownerName, title: 'Another player\u2019s character, in a campaign you run.' }) : null,
    row.campaignName ? h('a.badge.campaign-badge', { href: `#/campaign/${row.campaignId}`, text: row.campaignName, title: 'The campaign this character is in.' }) : null,
    h(`span.badge.ruleset-${rs?.id || 'srd'}`, { text: rs?.shortName || 'SRD' }),
    h('span.roster-updated', { text: row.updated ? new Date(row.updated).toLocaleDateString() : '' }),
    button('Delete', async () => {
      if (!confirm(`Delete ${row.name || 'this character'}? This cannot be undone.`)) return;
      local.remove(row.id);
      if (remote.enabled() && app.user) await remote.remove(row.id).catch(() => {});
      showRoster();
    }, { subtle: true, danger: true }));
}

function createCharacter(rulesetId) {
  if (!canCreate() || !publicRulesets().includes(rulesetId)) return;
  const rules = withRuleset(app.baseRules, rulesetId);
  const character = blankCharacter(rules);
  character.id = newId();
  character.meta = { ...character.meta, created: new Date().toISOString(), owner: app.user?.id || null, wizard: { step: WIZARD_STEPS[0].key } };
  local.save(character);
  location.hash = `#/create/${character.id}/${WIZARD_STEPS[0].key}`;
}

function importButton() {
  const input = h('input', {
    type: 'file', accept: 'application/json', class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        if (!canCreate()) return;
        const parsed = migrate(JSON.parse(await file.text()));
        if (!Array.isArray(parsed.levels)) throw new Error('it has no levels, so it is not a character');
        const from = parsed.ruleset;
        claimAsNew(parsed);
        if (parsed.ruleset !== from) {
          alert(`That character was built under ${app.baseRules.rulesets[from]?.name || 'another ruleset'}, which is only available in campaigns. It has been imported under ${app.baseRules.rulesets[parsed.ruleset].name}.`);
        }
        local.save(parsed);
        location.hash = `#/sheet/${parsed.id}`;
      } catch (err) {
        alert(`That file could not be read as a character: ${err.message}`);
      }
    },
  });
  return h('span', input, button('Import a character', () => input.click(), { subtle: true }));
}

/* =========================================================================
   One sheet
   ========================================================================= */

async function openSheet(id, opts = {}) {
  const scroll = opts.keepScroll ? window.scrollY : 0;
  // A sheet reopened in place - after a variant switch - must not leave the
  // old listeners on <main>, or every edit would be applied twice.
  app.unbind?.();
  app.unbind = null;

  // This browser's copy, and the account's. The server is the authority on which
  // campaign a character is in and so which ruleset it plays by - that can change
  // from the campaign page, or a GM's hand, without this copy knowing. The words
  // on the sheet come from whichever copy was edited last, so work done offline
  // is not thrown away.
  const here = local.load(id);
  const there = remote.enabled() && app.user ? await remote.load(id).catch(() => null) : null;
  let character = here || there;
  if (here && there) {
    const newer = String(here.meta?.updated || '') > String(there.meta?.updated || '') ? here : there;
    character = { ...newer, campaignId: there.campaignId ?? null, ruleset: there.ruleset, access: there.access };
  }
  if (there) local.save(character);
  const main = document.getElementById('main');
  if (!character) {
    refill(main, h('p.empty', { text: 'No character with that address.' }));
    return;
  }

  app.character = migrate(character);
  app.character.id = app.character.id || id;
  // In a campaign, its homebrew is what counts; have it to hand before the rules
  // are made. Fetched afresh each time, since its GMs may have changed it since;
  // if that fails, the copy already held (or the sheet's own copies) stand in.
  const joined = campaignOf(app.character);
  if (joined) await campaignLibrary(joined.id).fetch().catch(() => {});
  const { rules, overrides, campaign } = rulesFor(app.character);
  app.rules = rules;
  app.overrides = overrides;
  app.character = fillMissing(app.character, rules);
  // In a campaign, the campaign's ruleset is the character's, whatever it said.
  if (campaign) app.character.ruleset = campaign.ruleset;

  // Panels are drawn from a derived sheet, so it is computed before any of them.
  app.derived = derive(app.character, app.rules, { overrides });
  refreshDatalists();

  // The character creator: one step of the wizard, drawing only that step's panels.
  if (opts.wizard) {
    const saved = app.character.meta?.wizard?.step;
    const step = WIZARD_STEPS.some((s) => s.key === opts.wizard) ? opts.wizard
      : WIZARD_STEPS.some((s) => s.key === saved) ? saved : WIZARD_STEPS[0].key;
    if (opts.wizard !== step) history.replaceState(null, '', `${location.pathname}${location.search}#/create/${app.character.id}/${step}`);
    app.wizard = { step };
    if (app.character.meta?.wizard?.step !== step) {
      app.character.meta = { ...app.character.meta, wizard: { step } };
      scheduleSave();
    }
    const page = wizardPage(app, step, wizardWays());
    app.panels = page.panels;
    refill(main, page.root);
    app.unbind = bindForm(main, () => app.character, onEdit);
    recompute();
    window.scrollTo(0, scroll);
    return;
  }
  app.wizard = null;

  app.panels = {};
  const sheet = h('div.sheet');
  for (const [key, build] of Object.entries(PANELS)) {
    const panelEl = build(app);
    if (!panelEl) continue;
    app.panels[key] = panelEl;
    sheet.append(panelEl);
  }

  refill(main,
    h('div.sheet-layout',
      h('div.sheet-main', sheetToolbar(), variantsStrip(), sheet),
      h('aside#notices.notices')));

  app.unbind = bindForm(main, () => app.character, onEdit);
  recompute();
  window.scrollTo(0, scroll);
}

/** Draw the open character again, in the sheet or the wizard step it is in, once its changes are saved. */
async function reopen() {
  if (!app.character) return;
  await flush();
  openSheet(app.character.id, { keepScroll: true, wizard: app.wizard?.step });
}

/** What the wizard needs from the app. See ui/wizard.js. */
function wizardWays() {
  const id = app.character.id;
  const byName = (lists) => [...new Map(lists.flat().filter((e) => e?.name).map((e) => [e.name, e])).values()];
  return {
    panels: PANELS,
    hrefFor: (step) => `#/create/${id}/${step}`,
    fullSheetHref: `#/sheet/${id}`,
    go: async (step) => {
      await flush();
      location.hash = `#/create/${id}/${step}`;
    },
    finish: async () => {
      if (app.character.meta) delete app.character.meta.wizard;
      await flush();
      location.hash = `#/sheet/${id}`;
    },
    /** A choice made by clicking a card: set as though it were typed, then drawn again. */
    choose: async (path, value) => {
      setPath(app.character, path, value);
      onEdit(path, value, null, { type: 'change' });
      await reopen();
    },
    variants: () => variantsStrip(),
    raceChoices: () => byName([
      app.rules.races?.races || [],
      shelvesFor(app.character).map((s) => s.shelf.list('race').map((r) => ({ ...r, custom: true }))),
    ]),
    classChoices: () => byName([
      app.rules.classes.classes,
      shelvesFor(app.character).map((s) => s.shelf.list('class').map((k) => ({ ...k, custom: true }))),
    ]),
  };
}

function sheetToolbar() {
  const rs = app.rules.ruleset;
  const draft = app.character.meta?.wizard?.step;
  return h('div.toolbar',
    h('a.back', { href: '#/characters', text: 'All characters' }),
    draft ? h('a.btn.primary', { href: `#/create/${app.character.id}/${draft}` }, 'Continue in the creator') : null,
    rs.wiki ? h('a.back', { href: rs.wiki, target: '_blank', rel: 'noopener', text: rs.wikiName || `${rs.shortName} Wiki` }) : null,
    h('span.grow'),
    button('Export', exportCharacter, { subtle: true, title: 'Download this sheet as a file. Any homebrew it uses goes with it.' }),
    canCreate() ? button('Duplicate', () => {
      const copy = claimAsNew(structuredClone(app.character));
      copy.name = `${copy.name || 'Unnamed'} (copy)`;
      local.save(copy);
      location.hash = `#/sheet/${copy.id}`;
    }, { subtle: true, title: 'A copy of your own, outside any campaign.' }) : null,
    button('Print', () => window.print(), { subtle: true }));
}

/**
 * The rules this sheet is built under, and the optional systems within them.
 *
 * In a campaign, the campaign decides both, and the strip says so and links to
 * it. Out of one, the ruleset decides: under the SRD each variant is the
 * player's to tick, and under Antaera only gestalt is.
 */
function variantsStrip() {
  const c = app.character;
  const rs = app.rules.ruleset;
  const campaign = campaignOf(c);

  const switchRuleset = (id) => {
    const target = app.baseRules.rulesets[id];
    const note = target.startingLevel > (c.levels?.length || 0)
      ? ` ${target.name} characters start at level ${target.startingLevel}; this one has ${c.levels.length}, and no levels will be added for you.`
      : '';
    if (!confirm(`Rebuild ${c.name || 'this character'} under ${target.name}?${note} Nothing you have typed is lost, and you can switch back.`)) return;
    c.ruleset = id;
    reopen();
  };

  const modules = MODULES.map((name) => {
    const state = moduleState(app.rules, c, name, app.overrides);
    if (!state.available) return null;
    if (state.choosable) {
      return h('label.check.variant', { title: rs.variantNotes?.[name] || '' },
        h('input', {
          type: 'checkbox',
          checked: state.on,
          onchange: (ev) => {
            c.options = { ...c.options, [name]: ev.target.checked };
            reopen();
          },
        }),
        h('span', { text: MODULE_LABELS[name] }));
    }
    return h(`span.variant-locked${state.on ? '.is-on' : ''}`, {
      title: campaign && name in app.overrides ? `Set by ${campaign.name}.` : `Set by the ${rs.name} rules.`,
    }, `${MODULE_LABELS[name]}: ${state.on ? 'on' : 'off'}`);
  }).filter(Boolean);

  // Out of a campaign, the choices are the public rulesets, and the one this
  // character already has if it is not among them. One choice is no choice.
  const choices = campaign ? [c.ruleset] : [...new Set([...publicRulesets(), c.ruleset])];

  return h('div.variants',
    h('div.variants-rules',
      h('span.label', { text: 'Rules' }),
      choices.length > 1 && !campaign
        ? rulesetToggle(c.ruleset, switchRuleset, { ids: RULESET_IDS.filter((id) => choices.includes(id)) })
        : h('span.ruleset-name', { text: rs.name }),
      campaign
        ? h('span.hint', {}, 'Set by ', h('a', { href: `#/campaign/${campaign.id}`, text: campaign.name }), '.')
        : h('span.hint', { text: rs.tagline })),
    modules.length
      ? h('div.variants-modules',
        h('span.label', { text: campaign ? 'At this table' : rs.variantsChosenBy === 'player' ? 'Variants' : 'In play' }),
        modules)
      : null);
}

function exportCharacter() {
  const name = (app.character.name || 'character').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const blob = new Blob([JSON.stringify(app.character, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `${name}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* =========================================================================
   Editing
   ========================================================================= */

/**
 * Fields whose value can name a piece of content, and the kind they name.
 * When a player types or picks a name that is on their library shelf, the
 * entry is copied onto the sheet - so choosing "Warblade" from the list is all
 * it takes for a homebrew class to count.
 */
const NAMES_CONTENT = [
  [/^race\.name$/, 'race'],
  [/^levels\.\d+\.[ab]$/, 'class'],
  [/^nextLevel\.[ab]$/, 'class'],
  [/^feats\.\d+\.name$/, 'feat'],
  [/^features\.\d+\.name$/, 'feature'],
  [/^templates\.\d+\.name$/, 'template'],
  [/^wealth\.items\.\d+\.name$/, 'item'],
];

/**
 * A few fields change the shape of a panel, not just a number in it. Those
 * panels are rebuilt - but only on `change`, which fires when a field is left
 * or a list option is picked, never on each keystroke, so nobody loses their
 * caret halfway through typing a race.
 */
const RESHAPES = [
  [/^hp\.method$/, ['levels']],
  [/^race\.name$/, ['identity']],
  [/^race\.racialHD$/, ['levels', 'abilities']],
  [/^abilities\.method$/, ['abilities']],
  [/^feats\.\d+\.name$/, ['feats']],
  [/^features\.\d+\.name$/, ['feats']],
  [/^wealth\.items\.\d+\.name$/, ['wealth']],
  [/^levels\.\d+\.[ab]$/, ['casting']],
];

function onEdit(path, value, el, ev) {
  // Adopt library content the name points at, before recomputing.
  let embedded = false;
  for (const [pattern, kind] of NAMES_CONTENT) {
    if (!pattern.test(path) || !value) continue;
    const carried = (app.character.content?.[CONTENT_TYPES[kind].plural] || []).find((e) => e.name === value);
    if (carried) continue;
    for (const { shelf, campaign } of shelvesFor(app.character)) {
      const entry = shelf.find(kind, value);
      if (!entry) continue;
      // A campaign's entry is marked as the campaign's on the sheet.
      embed(app.character, kind, campaign ? { ...entry, campaign } : entry);
      embedded = true;
      break;
    }
  }

  recompute();
  if (ev.type === 'change' || embedded) {
    const rebuild = new Set();
    for (const [pattern, keys] of RESHAPES) if (pattern.test(path)) keys.forEach((k) => rebuild.add(k));
    // Only on change: rebuilding the panel holding a focused field mid-typing
    // would move the caret.
    if (ev.type === 'change') for (const key of rebuild) app.rebuildPanel(key);
  }
  scheduleSave();
}

function recompute() {
  app.derived = derive(app.character, app.rules, { overrides: app.overrides });
  const root = document.getElementById('main');
  paint(root, app.derived);
  paintNotices();
  paintCasting();
  paintEffects(root, app.derived);
  paintConditions(root, app.derived);
  paintContent(root, app, library);
  paintWizard(root, app);
  refreshDatalists();
  document.title = `${app.character.name || 'Unnamed'} - ${config.title}`;
}

/**
 * The notices rail: what the sheet thinks is wrong, in severity order, each
 * one a link to the panel it is about.
 */
function paintNotices() {
  const rail = document.getElementById('notices');
  if (!rail) return;
  const order = { error: 0, warn: 1, info: 2 };
  const all = [...app.derived.notices].sort((a, b) => order[a.level] - order[b.level]);
  // In the wizard, the rail speaks for the step on screen; the review, for every step.
  const stepFields = app.wizard ? WIZARD_STEPS.find((s) => s.key === app.wizard.step)?.notices : null;
  const notices = stepFields ? all.filter((n) => stepFields.includes(n.field)) : all;
  const elsewhere = stepFields ? all.length - notices.length : 0;
  const counts = notices.reduce((acc, n) => ({ ...acc, [n.level]: (acc[n.level] || 0) + 1 }), {});

  refill(rail,
    h('h2.notices-title', { text: app.wizard ? (stepFields ? 'This step' : 'Still to do') : 'The sheet says' }),
    h('p.notices-tally', { text: notices.length
      ? [
        counts.error ? `${counts.error} to fix` : null,
        counts.warn ? `${counts.warn} to check` : null,
        counts.info ? `${counts.info} to finish` : null,
      ].filter(Boolean).join(', ')
      : 'Nothing outstanding.' }),
    elsewhere ? h('p.hint', { text: `${elsewhere} more for other steps; the review lists them all.` }) : null,
    h('ul.notice-list', notices.map((n) => h(`li.notice.${n.level}`,
      h('a', {
        href: `#panel-${n.field}`,
        text: n.text,
        onclick: (ev) => {
          ev.preventDefault();
          const target = app.panels[NOTICE_PANEL[n.field] || n.field];
          if (!target && app.wizard) {
            location.hash = `#/create/${app.character.id}/${stepForNotice(n.field)}`;
            return;
          }
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.add('flash');
          setTimeout(() => target.classList.remove('flash'), 1200);
        },
      })))));
}

/** The casting block is a list, so it is rebuilt rather than painted. */
function paintCasting() {
  const host = document.querySelector('[data-casting-host]');
  if (!host) return;
  const classes = app.derived.casting;
  if (!classes.length) {
    refill(host, h('p.empty', { text: 'No casting or manifesting class taken.' }));
    return;
  }
  const sign = (n) => (n >= 0 ? `+${n}` : String(n));
  refill(host, classes.map((c) => h('div.casting-row',
    h('span.casting-name', { text: `${c.name} ${c.levels}` }),
    h('span.hint', { text: `${c.kind === 'casting' ? 'Caster' : 'Manifester'} - ${c.ability.toUpperCase()} ${sign(c.mod)}` }),
    h('span.hint', { text: `Save DC 10 + level ${sign(c.mod)}` }),
    h('div.slots',
      h('span.label', { text: 'Bonus slots' }),
      Object.entries(c.bonusSlots).filter(([, n]) => n > 0).map(([level, n]) => h('span.slot', { text: `${level}: +${n}` })),
      Object.values(c.bonusSlots).every((n) => n === 0) ? h('span.hint', { text: 'none' }) : null),
    c.note ? h('p.hint', { text: c.note }) : null)));
}

/** Rebuild one panel in place - used when a list or a field changes its shape. */
app.rebuildPanel = (key) => {
  const old = app.panels[key];
  if (!old || !PANELS[key]) return;
  const fresh = PANELS[key](app);
  if (!fresh) {
    old.remove();
    delete app.panels[key];
    return;
  }
  app.panels[key] = fresh;
  old.replaceWith(fresh);
  recompute();
};

app.recompute = () => {
  recompute();
  scheduleSave();
};

/* =========================================================================
   Saving
   ========================================================================= */

let saveTimer = null;

function scheduleSave() {
  if (!app.status) return;
  app.status.textContent = 'editing';
  app.status.dataset.state = 'editing';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!app.character) return;
  app.character.meta = { ...app.character.meta, build: app.derived?.summary.label || '' };
  const result = await saveEverywhere(app.character);
  if (!app.status) return;
  // Signed out is a normal way to use the app, not a failure: "saved" either
  // way, and the warning color only for a signed-in save that did not arrive.
  const trouble = !result.synced && remote.enabled() && app.user;
  app.status.textContent = trouble ? `saved here (${result.reason})` : 'saved';
  app.status.dataset.state = trouble ? 'local' : 'saved';
}

// A sheet being edited when the tab closes should still be on disk.
window.addEventListener('beforeunload', () => {
  if (app.character) local.save(app.character);
});

start().catch((err) => {
  document.body.append(h('p.empty', { text: `The sheet could not start: ${err.message}` }));
  throw err;
});
