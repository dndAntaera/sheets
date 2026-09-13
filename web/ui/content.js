// The content library: where players write what the SRD does not have.
//
// Every kind of content is drawn by the same editor, from its description in
// engine/library.js. Nothing in this file knows what a race is, or a feat; it
// knows how to draw a text field, a number, a dropdown, six ability boxes and an
// effects table, and the description says which of those an entry needs.

import {
  h, field, select, checkbox, textarea, labelled, button, refill, bindForm,
} from './dom.js';
import { effectsEditor } from './effects-editor.js';
import { CONTENT_TYPES, CONTENT_KINDS, blankEntry } from '../engine/library.js';
import { TARGETS } from '../engine/effects.js';
import { library } from '../store.js';

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** The player's own library, as showContent draws it. */
function personalSource(app) {
  return {
    shelf: library,
    base: '#/content',
    heading: 'Your homebrew',
    intro: 'Anything the SRD does not have. Write it once here, pick it by name on any of your own characters, and it counts - its numbers and its effects, not just its name. In a campaign, only the campaign\u2019s homebrew counts, unless its GMs allow yours.',
    where: app.user
      ? `Saved to your account, ${app.user.name}. It counts on your own characters outside campaigns.`
      : 'Kept in this browser. Export it to share or back it up.',
    switcher: [],
  };
}

// Only one page listens for failed campaign saves at a time.
let listening = null;

/**
 * Draw a library for one kind, with one entry open for editing.
 *
 * @param main    the element to draw into
 * @param app     for the rules (sizes, skill names) and navigation
 * @param kind    'race' | 'class' | ...
 * @param at      index of the open entry, or null
 * @param source  which library: { shelf, base, heading, intro, where, switcher },
 *                over the player's own - pass only what differs
 */
export function showContent(main, app, kind = 'race', at = null, source = null) {
  const src = { ...personalSource(app), ...(source || {}) };
  const { shelf: store } = src;
  if (!CONTENT_TYPES[kind]) kind = 'race';
  const type = CONTENT_TYPES[kind];
  const shelf = store.load();
  const entries = shelf[type.plural];
  const index = at === null || at === undefined || at === '' ? null : Number(at);
  const open = index !== null && entries[index] ? entries[index] : null;

  const go = (k, i = null) => { location.hash = `${src.base}/${k}${i === null ? '' : `/${i}`}`; };

  const failure = h('p.banner.fail', { hidden: true });
  listening?.abort();
  listening = new AbortController();
  window.addEventListener('campaign-library-failed', (ev) => {
    if (ev.detail?.campaignId !== store.campaignId) return;
    failure.textContent = `Not saved to the campaign: ${ev.detail.message}.`;
    failure.hidden = false;
  }, { signal: listening.signal });

  const tabs = h('nav.content-tabs', CONTENT_KINDS.map((k) => h('a.content-tab', {
    href: `${src.base}/${k}`,
    class: k === kind ? 'is-active' : '',
  }, CONTENT_TYPES[k].label, h('span.count', { text: String(shelf[CONTENT_TYPES[k].plural].length) }))));

  const list = h('ul.content-list', entries.length
    ? entries.map((entry, i) => h('li', h('a.content-item', {
      href: `${src.base}/${kind}/${i}`,
      class: i === index ? 'is-active' : '',
    },
    h('span.content-item-name', { text: entry.name || `Unnamed ${type.label.toLowerCase()}` }),
    h('span.content-item-meta', { text: summaryLine(kind, entry) }))))
    : h('li.hint', { text: `No ${type.plural} yet.` }));

  const create = button(`New ${type.label.toLowerCase()}`, () => {
    const fresh = store.load();
    fresh[type.plural].push({ ...blankEntry(kind), created: new Date().toISOString() });
    store.save(fresh);
    go(kind, fresh[type.plural].length - 1);
  });

  refill(main, h('div.content-page',
    src.switcher.length > 1
      ? h('nav.library-switch', { 'aria-label': 'Libraries' }, src.switcher.map((s) => h('a.library-choice', {
        href: s.href, class: s.active ? 'is-active' : '',
      }, s.label)))
      : null,
    h('div.content-head',
      h('div',
        h('h1', { text: src.heading }),
        h('p.hint', { text: src.intro }),
        h('p.hint.content-where', { text: src.where })),
      h('div.content-actions',
        button('Export all', () => exportLibrary(store), { subtle: true, title: 'Download every entry as one file.' }),
        importControl(store, () => showContent(main, app, kind, index, source)))),
    failure,
    tabs,
    h('div.content-body',
      h('aside.content-side',
        h('p.content-blurb', { text: type.blurb }),
        create,
        list),
      open
        ? editor(app, store, kind, index, open, go)
        : h('div.content-empty',
          h('p', { text: entries.length ? `Choose a ${type.label.toLowerCase()} to edit.` : `Start with New ${type.label.toLowerCase()}.` }),
          effectsPrimer()))));
}

/** The line under an entry's name in the list: its most telling numbers. */
function summaryLine(kind, e) {
  const fx = (e.effects || []).length;
  const effects = fx ? `${fx} effect${fx === 1 ? '' : 's'}` : '';
  switch (kind) {
    case 'race': return [e.size, e.la ? `LA +${e.la}` : '', effects].filter(Boolean).join(' - ');
    case 'class': return [e.hd ? `d${e.hd}` : '', e.bab, e.prestige ? 'prestige' : '', effects].filter(Boolean).join(' - ');
    case 'skill': return [e.ability ? e.ability.toUpperCase() : '', e.trainedOnly ? 'trained only' : ''].filter(Boolean).join(' - ');
    case 'item': return [e.slot, e.value ? `${Number(e.value).toLocaleString()} gp` : '', effects].filter(Boolean).join(' - ');
    default: return effects;
  }
}

/* ==========================================================================
   The editor
   ========================================================================== */

function editor(app, store, kind, index, entry, go) {
  const type = CONTENT_TYPES[kind];
  const sizes = app.rules.core.sizes.map((s) => s.name);
  const skillNames = app.rules.skills.skills.map((s) => s.name)
    .concat(store.list('skill').map((s) => s.name).filter(Boolean));

  const status = h('span.status', { text: 'saved' });
  let timer = null;

  const form = h('form.content-form', { onsubmit: (ev) => ev.preventDefault() },
    h('div.content-form-head',
      h('h2', { text: entry.name || `New ${type.label.toLowerCase()}` }),
      status),
    h('div.content-fields', type.fields.map((f) => fieldFor(f, entry, sizes))),
    type.effects
      ? h('section.content-effects',
        h('h3', { text: 'Effects' }),
        h('p.hint', { text: 'What this changes on a sheet. Each effect is added to the number it names, by the rules for stacking bonuses of the same type.' }),
        effectsEditor('effects', () => (entry.effects = entry.effects || []), {
          skillNames,
          onShapeChange: () => persist(),
        }))
      : null,
    h('div.content-form-actions',
      button('Duplicate', () => {
        const shelf = store.load();
        const stamp = new Date().toISOString();
        const copy = { ...structuredClone(entry), id: undefined, name: `${entry.name || 'Unnamed'} (copy)`, created: stamp, updated: stamp };
        shelf[type.plural].push(copy);
        store.save(shelf);
        go(kind, shelf[type.plural].length - 1);
      }, { subtle: true }),
      button('Download', () => download(`${slug(entry.name || kind)}.json`, { ...entry, kind }), { subtle: true, title: 'Just this one, as a file.' }),
      button('Delete', () => {
        if (!confirm(`Delete ${entry.name || 'this entry'} from this library? Characters already using it keep their own copy.`)) return;
        const shelf = store.load();
        shelf[type.plural].splice(index, 1);
        store.save(shelf);
        go(kind);
      }, { subtle: true, danger: true })));

  // The editor saves its own model - the library entry - rather than a
  // character, which is why it binds a form of its own.
  function persist() {
    status.textContent = 'editing';
    clearTimeout(timer);
    timer = setTimeout(() => {
      const shelf = store.load();
      entry.kind = kind;
      entry.updated = new Date().toISOString();
      shelf[type.plural][index] = entry;
      store.save(shelf);
      status.textContent = 'saved';
      form.querySelector('.content-form-head h2').textContent = entry.name || `New ${type.label.toLowerCase()}`;
      const link = document.querySelector('.content-item.is-active .content-item-name');
      if (link) link.textContent = entry.name || `Unnamed ${type.label.toLowerCase()}`;
    }, 400);
  }

  bindForm(form, () => entry, () => persist());
  return form;
}

/** One field of an entry, drawn by its description. */
function fieldFor(f, entry, sizes) {
  const value = f.key.split('.').reduce((o, k) => (o == null ? o : o[k]), entry);
  let control;
  switch (f.type) {
    case 'int': control = field(f.key, value, { type: 'int' }); break;
    case 'bool': return h('div.cell.cell-check', checkbox(f.key, value, f.label, { title: f.hint }));
    case 'select': control = select(f.key, value ?? '', f.options); break;
    case 'size': control = select(f.key, value || 'Medium', sizes); break;
    case 'list': control = field(f.key, value || [], { type: 'list', placeholder: 'comma, separated' }); break;
    case 'textarea': control = textarea(f.key, value, { rows: 4 }); break;
    case 'abilities':
      control = h('div.ability-adjust', ABILITY_KEYS.map((k) => h('label.ability-adjust-cell',
        h('span.label', { text: k.toUpperCase() }),
        field(`${f.key}.${k}`, value?.[k] ?? 0, { type: 'int' }))));
      break;
    default: control = field(f.key, value, {});
  }
  return h(`div.cell${f.wide ? '.wide' : ''}`,
    h('span.label', { text: f.label }),
    control,
    f.hint ? h('span.hint', { text: f.hint }) : null);
}

/* ==========================================================================
   The primer - how effects work, shown when nothing is open
   ========================================================================== */

function effectsPrimer() {
  const example = (what, rows) => h('div.primer-example',
    h('p', h('strong', { text: what })),
    h('table.primer-table',
      h('thead', h('tr', ['Changes', 'Type', 'By', 'Only when'].map((c) => h('th', { text: c })))),
      h('tbody', rows.map((r) => h('tr', r.map((c) => h('td', { text: c })))))));

  return h('section.primer',
    h('h2', { text: 'How content changes a sheet' }),
    h('p', { text: 'Most of an entry is description. Its effects are the part the sheet can count: each one names a number, a bonus type and an amount.' }),
    example('A ring of protection +2', [['Armour Class', 'deflection', '+2', '']]),
    example('A homebrew race of stone-skinned folk', [
      ['Armour Class', 'natural', '+2', ''],
      ['Hide', 'racial', '+4', 'in rocky terrain'],
      ['Fortitude', 'racial', '+2', 'against poison'],
    ]),
    h('h3', { text: 'Stacking' }),
    h('p', { text: 'Two bonuses of the same type do not add; the larger one applies. A ring of protection +1 and a shield of faith +3 give +3, not +4. Dodge, circumstance and untyped bonuses are the exceptions, and stack with themselves. Penalties always count.' }),
    h('h3', { text: 'Conditions' }),
    h('p', { text: 'An effect with something written under Only when is never added to a total - the sheet cannot know whether you are fighting a giant. It is listed beside the number instead, the way you would pencil it in the margin.' }),
    h('h3', { text: 'What an effect can change' }),
    h('p.primer-targets', { text: `${Object.values(TARGETS).join(', ')}, and any individual skill.` }));
}

/* ==========================================================================
   Files
   ========================================================================== */

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'content';

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportLibrary(store) {
  download(`content-${new Date().toISOString().slice(0, 10)}.json`, store.exportFile());
}

function importControl(store, after) {
  const input = h('input', {
    type: 'file', accept: 'application/json', class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const added = store.importFile(JSON.parse(await file.text()));
        alert(added ? `${added} ${added === 1 ? 'entry' : 'entries'} added.` : 'That file held no content the library could read.');
        after();
      } catch (err) {
        alert(`That file could not be read: ${err.message}`);
      }
      ev.target.value = '';
    },
  });
  return h('span', input, button('Import', () => input.click(), {
    subtle: true, title: 'A content file, a single entry, or an exported character - its homebrew comes with it.',
  }));
}

export { download, slug };
