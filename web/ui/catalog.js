// The catalog: what a character may be built from, beside the step that
// builds it.
//
// On the SRD there is nothing to browse - every race and class is in the
// picker already. In a campaign there is: the GM's library, the player's own
// homebrew, the variant races and classes, and whatever the ruleset brings.
// The catalog lists all of it for the step in hand - races on the Race step,
// classes on the Class step, feats on the Feats step - shows what each one is,
// the way the library shows it, and puts it on the character.
//
//   catalogPanel(app, { kind, pick })   the panel, or null when there is
//                                         nothing beyond the SRD to show
//
// Sorted by name or gathered under the source it comes from, and searchable,
// because a campaign's library grows.
//
// On a phone it is one line - "Browse 24 races" - that opens a sheet from the
// bottom of the screen: the list, then the entry, with the buttons where a
// thumb is. Nothing is drawn twice: the same list and the same preview go
// inline on a wide screen and into the sheet on a narrow one.

import { h, button, refill } from './dom.js';
import { CONTENT_TYPES } from '../engine/library.js';
import { loadReference, referenceNow, lookUp } from '../reference.js';

/** Where the SRD's own words about a kind of content are kept (reference.js). */
const REFERENCE_FOR = { feat: 'feats', item: 'equipment', class: 'classes', skill: 'skills' };

/** Which content a creator step is about. */
export const CATALOGUE_KINDS = {
  race: 'race',
  class: 'class',
  skills: 'skill',
  feats: 'feat',
  gear: 'item',
};

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();
const narrow = () => window.matchMedia?.('(max-width: 48rem)').matches;

/* ==========================================================================
   What there is
   ========================================================================== */

/** The campaign's name, for the shelf it stands for. */
const campaignName = (app, id) => (app.campaigns || []).find((c) => c.id === id)?.name || 'The campaign';

/**
 * Everything of one kind this character could use, each with where it came
 * from. A name met twice keeps the first, which is the nearest to the
 * character: its own copy, then the campaign's, then the player's, then the
 * rules.
 */
export function catalogEntries(app, kind) {
  const type = CONTENT_TYPES[kind];
  if (!type) return [];
  const rules = app.rules;
  const found = new Map();
  const add = (source, entry, written = false) => {
    const name = clean(entry?.name);
    if (!name || found.has(lower(name))) return;
    // `written` marks content somebody wrote for this table, as against what
    // the rules bring: it is what makes a catalog worth opening at all.
    found.set(lower(name), { name, source, entry, kind, written });
  };

  for (const entry of app.character?.content?.[type.plural] || []) add('On this character', entry, true);
  for (const { shelf, campaign } of app.shelves?.() || []) {
    for (const entry of shelf.list(kind)) add(campaign ? campaignName(app, campaign) : 'Your homebrew', entry, true);
  }

  const ruleset = rules.ruleset.shortName || 'SRD';
  const variants = rules.variantContent || {};
  if (kind === 'race') {
    for (const race of variants.races || []) add('Unearthed Arcana', race);
    for (const race of rules.races?.races || []) add(ruleset, race);
  }
  if (kind === 'class') {
    for (const klass of variants.classes || []) add('Unearthed Arcana', klass);
    for (const klass of rules.classes?.classes || []) add(klass.npcClass ? `${ruleset} (NPC)` : ruleset, klass);
  }
  if (kind === 'feat') {
    for (const feat of variants.feats || []) add('Unearthed Arcana', feat);
    for (const feat of rules.featRules || []) add(ruleset, feat);
  }
  if (kind === 'skill') for (const skill of rules.skills?.skills || []) add(ruleset, skill);
  return [...found.values()];
}

/**
 * Whether this character is built from more than the plain SRD: a ruleset of
 * its own, a campaign, or content somebody at the table wrote. On the SRD
 * alone the pickers already list everything, and the catalog stays away.
 */
export function hasContentOfItsOwn(app) {
  if (app.rules.rulesetId !== 'srd') return true;
  if (app.character?.campaignId) return true;
  const own = app.character?.content || {};
  if (Object.values(own).some((list) => (list || []).length)) return true;
  return (app.shelves?.() || []).some(({ shelf }) => Object.keys(CONTENT_TYPES).some((k) => shelf.list(k).length));
}

/** The sources in the order they are gathered under: the character's own first. */
const SOURCE_ORDER = ['On this character', 'Your homebrew', 'Unearthed Arcana'];
const sourceRank = (app, source) => {
  const at = SOURCE_ORDER.indexOf(source);
  if (at >= 0) return at;
  return source === (app.rules.ruleset.shortName || 'SRD') ? 9 : 5;
};

/* ==========================================================================
   What one entry is
   ========================================================================== */

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** A field's value in words, or null when there is nothing to say. */
function valueOf(field, entry) {
  const raw = field.key.split('.').reduce((at, key) => (at == null ? undefined : at[key]), entry);
  if (raw === undefined || raw === null || raw === '' || raw === false) return null;
  if (field.type === 'abilities') {
    const parts = ABILITY_KEYS.filter((k) => Number(raw?.[k])).map((k) => `${k.toUpperCase()} ${Number(raw[k]) > 0 ? '+' : ''}${raw[k]}`);
    return parts.length ? parts.join(', ') : null;
  }
  if (field.type === 'bool') return raw ? 'yes' : null;
  if (Array.isArray(raw)) return raw.length ? raw.join(', ') : null;
  if (field.type === 'int' && Number(raw) === 0) return null;
  return String(raw);
}

/** Anything worth reading that the fields above did not cover. */
const EXTRA_KEYS = [
  ['prerequisites', 'Prerequisites'], ['prerequisite', 'Prerequisite'], ['benefit', 'Benefit'],
  ['normal', 'Normal'], ['special', 'Special'], ['note', 'Note'], ['description', 'Description'],
  ['types', 'Type'], ['type', 'Type'], ['requires', 'Requires'],
];

const HAS_TAGS = /<[a-z][^>]*>/i;

/** "<p><b>Benefit:</b> ..." - the label is already beside it, so it goes. */
const withoutItsOwnLabel = (markup) => String(markup).replace(/^\s*<p>\s*<b>[^<]{0,24}:\s*<\/b>\s*/i, '<p>');

/**
 * One entry as the library shows it: its fields, what it does, and where it
 * came from.
 */
export function catalogPreview(app, row, pick) {
  const type = CONTENT_TYPES[row.kind];
  // What the SRD says about it, under what the entry itself says: a feat's
  // benefit and an item's description live in the reference (reference.js).
  const kind = REFERENCE_FOR[row.kind];
  const printed = kind && referenceNow(kind) ? lookUp(kind, row.name) : null;
  const entry = printed ? { ...printed, ...row.entry } : (row.entry || {});
  // The rules' own words are written as markup and are shown as such. What
  // somebody at the table wrote is shown as the words they typed, tags and
  // all: a campaign's library is written by another person, and nothing from
  // it is ever handed to the page as markup.
  const asLine = (label, value) => {
    const markup = !row.written && HAS_TAGS.test(value);
    return [label, markup ? withoutItsOwnLabel(value) : value, markup];
  };
  const lines = (type.fields || [])
    .filter((f) => f.key !== 'name')
    .map((f) => [f.label, valueOf(f, entry)])
    .filter(([, value]) => value)
    .map(([label, value]) => asLine(label, value));
  const covered = new Set((type.fields || []).map((f) => f.key.split('.')[0]));
  for (const [key, label] of EXTRA_KEYS) {
    if (covered.has(key) || entry[key] === undefined) continue;
    const value = Array.isArray(entry[key]) ? entry[key].join(', ') : clean(entry[key]);
    if (value) lines.push(asLine(label, value));
  }
  const effects = entry.effects || [];

  return h('div.catalog-preview',
    h('div.catalog-preview-head',
      h('h3', { text: row.name }),
      h('span.badge', { text: row.source })),
    lines.length
      ? h('dl.catalog-facts', lines.map(([label, value, markup]) =>
        [h('dt', { text: label }), markup ? h('dd', { html: value }) : h('dd', { text: value })]).flat())
      : h('p.hint', { text: 'Nothing beyond its name is written down.' }),
    effects.length
      ? h('div.catalog-effects',
        h('h4', { text: `What it does on the sheet (${effects.length})` }),
        h('ul', effects.map((e) => h('li', { text: `${e.target}${e.type ? ` (${e.type})` : ''}: ${e.value > 0 ? '+' : ''}${e.value}${e.condition ? ` while ${e.condition}` : ''}` }))))
      : null,
    pick ? h('div.catalog-actions', pick(row)) : null);
}

/* ==========================================================================
   The catalog itself
   ========================================================================== */

// What is chosen and how it is sorted survives a redraw of the step.
const state = { sort: 'name', search: '', chosen: {} };

/** How many entries are drawn before the list asks to be narrowed. */
const SHOWN = 120;

/**
 * The catalog for one kind of content, or null when this character has
 * nothing but the SRD to choose from.
 *
 * `pick(kind, entry)` puts an entry on the character; the app decides what
 * that means for each kind.
 */
export function catalogPanel(app, { kind, pick = null }) {
  const type = CONTENT_TYPES[kind];
  if (!type || !hasContentOfItsOwn(app)) return null;
  const rows = catalogEntries(app, kind);
  if (!rows.length) return null;
  const written = rows.filter((r) => r.written);

  const plural = type.plural;
  const panel = h('section.panel.catalog', { id: 'panel-catalog', dataset: { panel: 'catalog' } });
  const body = h('div.panel-body');
  panel.append(
    h('h2.panel-title',
      h('span', { text: `The ${plural} you may choose from` }),
      h('span.hint', { text: written.length ? `${rows.length}, ${written.length} written for your table` : `${rows.length} to choose from` })),
    body);

  const draw = () => refill(body, narrow() ? sheetOpener(app, { kind, rows, pick, draw }) : inline(app, { kind, rows, pick, draw }));
  draw();
  // A phone turned on its side is a wide screen, and gets the wide layout.
  const media = window.matchMedia?.('(max-width: 48rem)');
  const onResize = () => {
    if (panel.isConnected) draw();
    else media.removeEventListener('change', onResize);
  };
  media?.addEventListener?.('change', onResize);

  // The SRD's own words arrive once, and the entry then reads in full.
  const reference = REFERENCE_FOR[kind];
  if (reference && !referenceNow(reference)) {
    loadReference(reference).then(() => { if (panel.isConnected) draw(); }).catch(() => {});
  }
  return panel;
}

/** The list and the entry side by side: a wide screen. */
function inline(app, ways) {
  const list = listOf(app, ways);
  const chosen = chosenRow(ways.rows, ways.kind);
  return h('div.catalog-body',
    controls(app, ways),
    h('div.catalog-columns',
      list,
      chosen
        ? catalogPreview(app, chosen, (row) => useButtons(app, row, ways))
        : h('p.empty', { text: `Choose one to see what it is. Nothing is added to your character until you say so.` })));
}

/** One line that opens the sheet: a phone. */
function sheetOpener(app, ways) {
  const chosen = chosenRow(ways.rows, ways.kind);
  return h('div.catalog-compact',
    button(`Browse ${ways.rows.length} ${CONTENT_TYPES[ways.kind].plural}`, () => openSheetView(app, ways), { title: 'The full list, with what each one is.' }),
    chosen ? h('p.hint', { text: `Last looked at: ${chosen.name} (${chosen.source})` }) : h('p.hint', { text: `From the campaign, your homebrew and the variant rules.` }));
}

/**
 * The same list and preview in a sheet that rises from the foot of the
 * screen: the list first, the entry second with a way back, and the buttons
 * at the bottom where a thumb already is.
 */
function openSheetView(app, ways) {
  const dialog = h('dialog.catalog-dialog', { 'aria-label': `The ${CONTENT_TYPES[ways.kind].plural} you may choose from` });
  const inner = h('div.catalog-sheet');
  dialog.append(inner);

  const close = () => { dialog.close(); ways.draw(); };
  const show = (row) => {
    if (!row) {
      refill(inner,
        h('div.catalog-sheet-head',
          h('h2', { text: `Choose a ${CONTENT_TYPES[ways.kind].label.toLowerCase()}` }),
          button('Close', close, { subtle: true })),
        controls(app, { ...ways, draw: () => show(null) }),
        listOf(app, { ...ways, draw: () => show(null), onChoose: (chosen) => show(chosen) }));
      return;
    }
    refill(inner,
      h('div.catalog-sheet-head',
        button('← All', () => show(null), { subtle: true }),
        h('h2', { text: row.name })),
      h('div.catalog-sheet-body', catalogPreview(app, row, () => null)),
      // Taking it closes the sheet: the step behind is about to be drawn again.
      h('div.catalog-sheet-foot',
        useButtons(app, row, { ...ways, pick: (kind, taken) => { dialog.close(); ways.pick(kind, taken); } }),
        button('Close', close, { subtle: true })));
  };

  show(chosenRow(ways.rows, ways.kind));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

const chosenRow = (rows, kind) => rows.find((r) => r.name === state.chosen[kind]) || null;

/** Search, and how the list is ordered. */
function controls(app, ways) {
  const search = h('input.field.catalog-search', {
    type: 'search',
    value: state.search,
    placeholder: `Search ${CONTENT_TYPES[ways.kind].plural}`,
    'aria-label': `Search ${CONTENT_TYPES[ways.kind].plural}`,
    oninput: (ev) => { state.search = ev.target.value; ways.draw(); },
  });
  const sort = h('select.field.catalog-sort', {
    'aria-label': 'Order',
    onchange: (ev) => { state.sort = ev.target.value; ways.draw(); },
  }, [['name', 'A to Z'], ['source', 'By source']].map(([value, label]) =>
    h('option', { value, text: label, selected: state.sort === value })));
  return h('div.catalog-controls', search, sort);
}

/** The list itself, under headings when it is gathered by source. */
function listOf(app, ways) {
  const term = lower(state.search);
  const rows = ways.rows.filter((r) => !term || lower(r.name).includes(term) || lower(r.source).includes(term));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const choose = (row) => {
    state.chosen[ways.kind] = row.name;
    if (ways.onChoose) ways.onChoose(row);
    else ways.draw();
  };
  const line = (row) => h('li',
    h(`button.catalog-row${state.chosen[ways.kind] === row.name ? '.is-chosen' : ''}`, {
      type: 'button',
      onclick: () => choose(row),
      'aria-pressed': String(state.chosen[ways.kind] === row.name),
    },
    h('span.catalog-row-name', { text: row.name }),
    h('span.catalog-row-source', { text: row.source })));

  if (!rows.length) return h('p.empty', { text: `Nothing matches “${state.search}”.` });
  // A long list is cut short rather than drawn in full: searching is quicker
  // than scrolling past four hundred feats, and the cut says so.
  const cut = (list) => (list.length > SHOWN ? [...list.slice(0, SHOWN), null] : list);
  const more = (shown, all) => h('li.catalog-more', h('p.hint', { text: `${all - shown} more - search to narrow the list.` }));
  if (state.sort === 'name') {
    const sorted = rows.slice().sort(byName);
    return h('ul.catalog-list', cut(sorted).map((row) => (row ? line(row) : more(SHOWN, sorted.length))));
  }

  const groups = new Map();
  for (const row of rows) groups.set(row.source, [...(groups.get(row.source) || []), row]);
  return h('div.catalog-groups', [...groups.entries()]
    .sort((a, b) => sourceRank(app, a[0]) - sourceRank(app, b[0]) || a[0].localeCompare(b[0]))
    .map(([source, list]) => h('section.catalog-group',
      h('h4.catalog-group-name', { text: source }, h('span.hint', { text: ` ${list.length}` })),
      h('ul.catalog-list', cut(list.slice().sort(byName)).map((row) => (row ? line(row) : more(SHOWN, list.length)))))));
}

/** Putting it on the character: what that means depends on the kind. */
function useButtons(app, row, ways) {
  if (!ways.pick) return null;
  const type = CONTENT_TYPES[row.kind];
  if (row.kind === 'race' || row.kind === 'class') {
    return button(row.kind === 'race' ? 'Take this race' : 'Take this class', () => ways.pick(row.kind, row), { className: 'primary' });
  }
  // The rest are chosen where they belong - a feat in its slot, an item in the
  // shop. What the catalog can do is carry one written for this table onto the
  // character, so that it is there to choose.
  if (row.written) {
    return button(`Add this ${type.label.toLowerCase()} to the character`, () => ways.pick(row.kind, row), { className: 'primary' });
  }
  return h('p.hint', { text: `Choose it where it belongs: ${row.kind === 'feat' ? 'in a feat slot below' : row.kind === 'item' ? 'in the sheet’s shop' : 'on the step it belongs to'}.` });
}
