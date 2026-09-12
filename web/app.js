// The application: the roster, the sheet, and the wiring between a keystroke
// and a recomputed number.
//
// The shape of it is deliberately small. There is one character in memory, one
// derived sheet beside it, and one rule: an edit writes to the character, the
// derived sheet is rebuilt from scratch, and the derived outputs are repainted.
// No partial updates, no dependency graph. Recomputing a whole sheet is a few
// hundred arithmetic operations, which is nothing, and the alternative - working
// out which numbers a change affects - is where sheets get their wrong totals.

import { loadRules, derive, blankCharacter, migrate } from './engine/index.js';
import { h, paint, setPath, refill, button } from './ui/dom.js';
import {
  identityPanel, levelsPanel, abilitiesPanel, combatPanel, skillsPanel,
  featsPanel, houserulesPanel, wealthPanel, textPanel, castingPanel,
} from './ui/sheet.js';
import { config } from './config.js';
import { local, remote, save as saveEverywhere, newId } from './store.js';

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
  text: textPanel,
};

const app = {
  rules: null,
  character: null,
  derived: null,
  campaign: { gestalt: false, gm: false },
  panels: {},
  status: null,
  user: null,
};

/* =========================================================================
   Start
   ========================================================================= */

async function start() {
  app.rules = await loadRules('./data/');

  // The campaign settings: the server's if there is one, otherwise whatever
  // this browser was last told. Gestalt is a GM switch, so a player never
  // decides it for themselves.
  const stored = local.campaign();
  app.campaign = {
    gestalt: app.rules.rules.campaign.gestaltDefault,
    gm: false,
    ...(stored || {}),
  };

  if (remote.enabled()) {
    try {
      app.user = await remote.me();
      const server = await remote.campaign();
      app.campaign = { ...app.campaign, ...server, gm: Boolean(app.user?.gm) };
      local.setCampaign(app.campaign);
    } catch {
      // Signed out, or the server is unreachable. The app carries on locally.
      app.user = null;
    }
  }

  document.body.append(header(), h('main#main'), datalists());
  window.addEventListener('hashchange', route);
  route();
}

/* =========================================================================
   Header
   ========================================================================= */

function header() {
  app.status = h('span.status', { text: '' });

  const account = () => {
    if (!remote.enabled()) return h('span.hint', { text: 'local to this browser' });
    if (app.user) {
      return h('span.account',
        h('span', { text: app.user.name }),
        button('Sign out', async () => {
          await remote.signOut().catch(() => {});
          location.reload();
        }, { subtle: true }));
    }
    return h('a.btn', { href: remote.signInUrl(), text: 'Sign in' });
  };

  return h('header.top',
    h('a.brand', { href: '#/', title: 'Every sheet in the campaign' },
      h('span.brand-name', { text: config.title })),
    h('nav.top-nav',
      h('a', { href: config.wikiUrl, target: '_blank', rel: 'noopener', text: 'The wiki' }),
      h('a', { href: '#/', text: 'Characters' })),
    h('div.top-right',
      app.status,
      gestaltSwitch(),
      themeSwitch(),
      account()));
}

/**
 * The gestalt switch. Visible to everyone so a player can see which way the
 * campaign is playing, but only the GM can move it - and when there is a
 * server, moving it writes to the campaign rather than to this browser.
 */
function gestaltSwitch() {
  const input = h('input', {
    type: 'checkbox',
    checked: app.campaign.gestalt,
    disabled: remote.enabled() && !app.campaign.gm,
    onchange: async (ev) => {
      app.campaign.gestalt = ev.target.checked;
      local.setCampaign(app.campaign);
      if (remote.enabled() && app.campaign.gm) {
        await remote.setCampaign({ gestalt: app.campaign.gestalt }).catch(() => {});
      }
      // Gestalt changes the shape of the levels table, so the sheet is rebuilt.
      if (app.character) openSheet(app.character.id, { keepScroll: true });
    },
  });
  return h('label.check.gestalt', {
    title: remote.enabled() && !app.campaign.gm
      ? 'Gestalt is set by the DM for the whole campaign.'
      : 'Gestalt: every level takes two classes and the better of each is kept.',
  }, input, h('span', { text: 'Gestalt' }));
}

function themeSwitch() {
  const stored = localStorage.getItem('antaera-sheets/theme');
  if (stored) document.documentElement.dataset.theme = stored;
  return button(stored === 'dark' ? 'Day' : 'Night', (ev) => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('antaera-sheets/theme', next);
    ev.target.textContent = next === 'dark' ? 'Day' : 'Night';
  }, { subtle: true, title: 'Parchment or slate' });
}

/** Datalists, so class names complete as they are typed. */
function datalists() {
  return h('div.hidden',
    h('datalist#class-names',
      app.rules.classes.classes.map((c) => h('option', { value: c.name }))),
    h('datalist#skill-names',
      app.rules.skills.skills.map((s) => h('option', { value: s.name }))));
}

/* =========================================================================
   Routing: the roster, or one sheet
   ========================================================================= */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [view, id] = hash.split('/');
  if (view === 'sheet' && id) openSheet(id);
  else showRoster();
}

async function showRoster() {
  app.character = null;
  const main = document.getElementById('main');

  let rows = local.list();
  let source = local.name;
  if (remote.enabled() && app.user) {
    try {
      rows = await remote.list();
      source = app.user.gm ? 'every character in the campaign' : 'your characters';
    } catch { /* the local list stands */ }
  }

  refill(main, h('div.roster',
    h('div.roster-head',
      h('h1', { text: 'Characters' }),
      h('div.roster-actions',
        button('New character', createCharacter),
        importButton())),
    h('p.hint', { text: `Showing ${source}.` }),
    rows.length
      ? h('ul.roster-list', rows.map(rosterRow))
      : h('p.empty', { text: 'No characters yet. The campaign starts at level 3.' })));
}

function rosterRow(row) {
  return h('li.roster-row',
    h('a.roster-link', { href: `#/sheet/${row.id}` },
      h('span.roster-name', { text: row.name || 'Unnamed' }),
      h('span.roster-meta', { text: [row.player, row.build || `level ${row.level || '?'}`].filter(Boolean).join(' - ') })),
    h('span.roster-updated', { text: row.updated ? new Date(row.updated).toLocaleDateString() : '' }),
    button('Delete', async () => {
      if (!confirm(`Delete ${row.name || 'this character'}? This cannot be undone.`)) return;
      local.remove(row.id);
      if (remote.enabled() && app.user) await remote.remove(row.id).catch(() => {});
      showRoster();
    }, { subtle: true, danger: true }));
}

function createCharacter() {
  const character = blankCharacter(app.rules);
  character.id = newId();
  character.meta = { ...character.meta, created: new Date().toISOString(), owner: app.user?.id || null };
  local.save(character);
  location.hash = `#/sheet/${character.id}`;
}

function importButton() {
  const input = h('input', {
    type: 'file', accept: 'application/json', class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const parsed = migrate(JSON.parse(await file.text()));
        parsed.id = parsed.id || newId();
        local.save(parsed);
        location.hash = `#/sheet/${parsed.id}`;
      } catch (err) {
        alert(`That file could not be read as a character: ${err.message}`);
      }
    },
  });
  return h('span', input, button('Import a file', () => input.click(), { subtle: true }));
}

/* =========================================================================
   One sheet
   ========================================================================= */

async function openSheet(id, opts = {}) {
  const scroll = opts.keepScroll ? window.scrollY : 0;

  let character = local.load(id);
  if (!character && remote.enabled() && app.user) {
    character = await remote.load(id).catch(() => null);
    if (character) local.save(character);
  }
  if (!character) {
    refill(document.getElementById('main'), h('p.empty', { text: 'No character with that address.' }));
    return;
  }

  app.character = migrate(character);
  app.character.id = app.character.id || id;
  app.panels = {};

  const noticeRail = h('aside.notices', { id: 'notices' });
  const sheet = h('div.sheet');
  for (const [key, build] of Object.entries(PANELS)) {
    const panel = build(app);
    app.panels[key] = panel;
    sheet.append(panel);
  }

  refill(document.getElementById('main'),
    h('div.sheet-layout',
      h('div.sheet-main',
        sheetToolbar(),
        sheet),
      noticeRail));

  const root = document.getElementById('main');
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  recompute();
  window.scrollTo(0, scroll);
}

function sheetToolbar() {
  return h('div.toolbar',
    h('a.back', { href: '#/', text: 'All characters' }),
    h('span.grow'),
    button('Export', exportCharacter, { subtle: true, title: 'Download this sheet as a file, to post in your character thread.' }),
    button('Duplicate', () => {
      const copy = structuredClone(app.character);
      copy.id = newId();
      copy.name = `${copy.name || 'Unnamed'} (copy)`;
      copy.meta = { ...copy.meta, created: new Date().toISOString(), updated: null };
      local.save(copy);
      location.hash = `#/sheet/${copy.id}`;
    }, { subtle: true }),
    button('Print', () => window.print(), { subtle: true }));
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
 * A few fields do not just change a number - they change the shape of another
 * panel. Choosing rolled hit points means every level after the first needs a
 * box to type the roll into; adding a racial hit die can be what earns the
 * ability increase at 4th level, which needs a selector that was not there
 * before. Those panels are rebuilt, and only those.
 */
const RESHAPES = {
  'hp.method': ['levels'],
  'race.racialHD': ['levels', 'abilities'],
};

function onEdit(ev) {
  const el = ev.target;
  const path = el.dataset?.field;
  if (!path) return;

  setValue(path, el);
  recompute();
  for (const key of RESHAPES[path] || []) app.rebuildPanel(key);
  scheduleSave();
}

/**
 * Write one field into the character, coercing it to the type the engine
 * expects. An empty number field becomes null rather than "" or 0: null means
 * "not entered", which the engine already treats as nothing, while 0 would be
 * a real zero and "" would poison every sum it joined.
 */
function setValue(path, el) {
  const kind = el.dataset.kind;
  let value;

  if (kind === 'bool') value = el.checked;
  else if (kind === 'int' || kind === 'number') value = el.value === '' ? null : Number(el.value);
  else value = el.value;

  // Two fields are stored differently from the way they are typed.
  if (path.endsWith('classSkills')) {
    value = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (path.startsWith('abilities.levelUps.') && value === '') {
    const level = path.split('.').pop();
    delete app.character.abilities.levelUps[level];
    return;
  }

  setPath(app.character, path, value);
}

function recompute() {
  app.derived = derive(app.character, app.rules, { gestalt: app.campaign.gestalt });
  const root = document.getElementById('main');
  paint(root, app.derived);
  paintNotices();
  paintCasting();
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
  const notices = [...app.derived.notices].sort((a, b) => order[a.level] - order[b.level]);
  const counts = notices.reduce((acc, n) => ({ ...acc, [n.level]: (acc[n.level] || 0) + 1 }), {});

  refill(rail,
    h('h2.notices-title', { text: 'The sheet says' }),
    h('p.notices-tally', { text: notices.length
      ? [
        counts.error ? `${counts.error} to fix` : null,
        counts.warn ? `${counts.warn} to check` : null,
        counts.info ? `${counts.info} to finish` : null,
      ].filter(Boolean).join(', ')
      : 'Nothing outstanding.' }),
    h('ul.notice-list', notices.map((n) => h(`li.notice.${n.level}`,
      h('a', {
        href: `#panel-${n.field}`,
        text: n.text,
        onclick: (ev) => {
          ev.preventDefault();
          app.panels[n.field]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          app.panels[n.field]?.classList.add('flash');
          setTimeout(() => app.panels[n.field]?.classList.remove('flash'), 1200);
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
  refill(host, classes.map((c) => h('div.casting-row',
    h('span.casting-name', { text: `${c.name} ${c.levels}` }),
    h('span.hint', { text: `${c.kind === 'casting' ? 'Caster' : 'Manifester'} - ${c.ability.toUpperCase()} ${c.mod >= 0 ? '+' : ''}${c.mod}` }),
    h('span.hint', { text: `Save DC 10 + spell level ${c.mod >= 0 ? '+' : ''}${c.mod}` }),
    h('div.slots',
      h('span.label', { text: 'Bonus slots' }),
      Object.entries(c.bonusSlots)
        .filter(([, n]) => n > 0)
        .map(([level, n]) => h('span.slot', { text: `${level}: +${n}` })),
      Object.values(c.bonusSlots).every((n) => n === 0) ? h('span.hint', { text: 'none' }) : null),
    c.note ? h('p.hint', { text: c.note }) : null)));
}

/** Rebuild one panel in place - used when a list of rows changes shape. */
app.rebuildPanel = (key) => {
  const old = app.panels[key];
  if (!old) return;
  const fresh = PANELS[key](app);
  app.panels[key] = fresh;
  old.replaceWith(fresh);
  paint(document.getElementById('main'), app.derived);
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
  app.status.textContent = 'editing';
  app.status.dataset.state = 'editing';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

async function flush() {
  if (!app.character) return;
  app.character.meta = {
    ...app.character.meta,
    build: app.derived?.summary.label || '',
  };
  const result = await saveEverywhere(app.character);
  app.status.textContent = result.synced ? 'saved' : `saved here (${result.reason})`;
  app.status.dataset.state = result.synced ? 'saved' : 'local';
}

// A sheet being edited when the tab closes should still be on disk.
window.addEventListener('beforeunload', () => {
  if (app.character) local.save(app.character);
});

start().catch((err) => {
  document.body.append(h('p.empty', { text: `The sheet could not start: ${err.message}` }));
  throw err;
});
