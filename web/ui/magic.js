// The Spell Sheet, or Powers Sheet: spells per day and what is left of them,
// spells known and prepared, power points and powers known - for every class
// the character casts or manifests with, following their levels.
//
// The numbers are engine/magic.js's. This file draws them and records what the
// player does: learning a spell, preparing it, casting it, spending power
// points, resting. Spells and powers are chosen from the SRD reference, and each
// one opens to its full entry.

import { h, button, refill } from './dom.js';
import { loadReferences, referenceNow, lookUp, referenceHref } from '../reference.js';
import { referenceCard } from './reference.js';

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const DISCIPLINES = ['Egoist', 'Kineticist', 'Nomad', 'Seer', 'Shaper', 'Telepath'];
const levelName = (n) => (n === 0 ? '0-level' : `${ordinal(n)} level`);
const ordinal = (n) => (n === 0 ? '0' : `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10] || 'th'}`);

/** What the sheet is called, by what the character does. */
export function magicTitle(magic) {
  const kinds = magic?.kinds || new Set();
  if (kinds.has('casting') && kinds.has('manifesting')) return 'Spell & Powers Sheet';
  return kinds.has('manifesting') ? 'Powers Sheet' : 'Spell Sheet';
}

/**
 * @param app   the app: character, derived, recompute, rebuildPanel
 * @param ways  from app.js: { rest() }
 */
export function magicPanel(app, ways) {
  const magic = app.derived.magic;
  const title = magicTitle(magic);
  const panelEl = h('section.panel.magic-panel', { id: 'panel-casting', dataset: { panel: 'casting' } },
    h('h2.panel-title', h('span', { text: title })));
  const body = h('div.panel-body');
  panelEl.append(body);

  if (!magic.classes.length) {
    refill(body, h('p.empty', { text: 'No class that casts spells or manifests powers. Take one on the Character page and this sheet fills in.' }));
    return panelEl;
  }

  // The reference arrives once; until then the lists show names without detail.
  const wanted = ['spells', 'powers', 'domains'];
  if (wanted.some((k) => !referenceNow(k))) {
    loadReferences(...wanted).then(() => { if (app.panels?.casting === panelEl) app.rebuildPanel('casting'); }).catch(() => {});
  }

  const changed = () => { app.recompute(); app.rebuildPanel('casting'); };
  const stateFor = (name) => {
    app.character.magic = app.character.magic || {};
    app.character.magic[name] = app.character.magic[name] || {};
    return app.character.magic[name];
  };

  refill(body,
    h('div.magic-top',
      magic.powerPoints ? powerPool(app, magic.powerPoints, changed) : null,
      h('div.magic-rest',
        button('Rest', () => {
          if (!confirm('Rest for the night? Every spell slot and power point comes back, uses per day reset, and prepared spells stay prepared.')) return;
          ways.rest();
        }, { title: 'A night’s rest: spells and power points back, daily uses reset.' }),
        h('span.hint', { text: 'After 8 hours’ rest.' }))),
    magic.classes.map((m) => (m.kind === 'casting'
      ? casterBlock(app, m, stateFor(m.name), changed)
      : manifesterBlock(app, m, stateFor(m.name), changed))));
  return panelEl;
}

/* ==========================================================================
   Spellcasters
   ========================================================================== */

function casterBlock(app, m, state, changed) {
  const sign = (n) => (n >= 0 ? `+${n}` : String(n));
  const choices = m.levels.filter((l) => l.perDay > 0 || l.knownAllowed || l.knownCount || (state.prepared?.[l.level] || []).length);

  return h('section.magic-class',
    h('header.magic-class-head',
      h('h3', { text: `${m.name} ${m.classLevel}` }),
      m.variant ? h('span.tag', { text: m.variant.name }) : null,
      h('span.hint', { text: [
        `Caster level ${m.casterLevel}${m.casterLevel !== m.classCasterLevel ? ' (magic rating)' : ''}`,
        `${m.ability.toUpperCase()} ${m.score} (${sign(m.mod)})`,
        `save DC 10 + spell level ${sign(m.mod)}`,
        m.type ? `${m.type} ${m.spontaneous ? 'spontaneous' : 'prepared'}` : null,
      ].filter(Boolean).join(' - ') })),
    options(app, m, state, changed),
    m.spellPoints ? spellPointPool(m, state, changed) : null,
    m.levels.length
      ? h('div.table-scroll', h('table.magic-slots',
        h('thead', h('tr', ['Level', m.spellPoints ? 'Cost' : 'Per day', m.spontaneous ? 'Known' : m.spellbook ? 'In spellbook' : 'Prepared', m.spellPoints ? 'Cast' : m.recharge ? 'Recharge' : m.spontaneous ? 'Cast today' : 'Left today', 'Save DC'].map((c) => h('th', { text: c })))),
        h('tbody', m.levels.map((l) => h(`tr${l.castable ? '' : '.is-closed'}`,
          h('th', { text: ordinal(l.level) }),
          h('td', { title: m.spellPoints ? 'Spell points to cast one' : perDayTitle(l), text: !l.castable ? `needs ${m.ability.toUpperCase()} ${10 + l.level}` : m.spellPoints ? (l.level === 0 ? `free (${m.spellPoints.cantripsPerDay} a day)` : `${m.spellPoints.cost[l.level]} pts`) : String(l.perDay) }),
          h('td', { text: m.spontaneous
            ? `${l.knownCount} / ${l.knownAllowed ?? '-'}`
            : m.spellbook
              ? String(l.knownCount)
              : `${l.preparedCount + l.preparedExtra} / ${l.perDay}` }),
          h('td', m.spellPoints
            ? (l.castable && l.level > 0 ? button(`Cast (${m.spellPoints.cost[l.level]})`, () => { state.spellPointsUsed = (Number(state.spellPointsUsed) || 0) + m.spellPoints.cost[l.level]; changed(); }, { subtle: true }) : h('span.hint', { text: l.level === 0 ? 'free' : '-' }))
            : m.recharge
              ? h('label.check', { title: `After casting a spell of this level, ${m.recharge[l.level] || '0'} before the next.` },
                h('input', { type: 'checkbox', checked: Boolean(m.recharging?.[l.level]), onchange: (ev) => { state.recharging = { ...(state.recharging || {}), [l.level]: ev.target.checked }; changed(); } }),
                h('span', { text: m.recharging?.[l.level] ? `recharging (${m.recharge[l.level]})` : m.recharge[l.level] || 'ready' }))
              : m.spontaneous
                ? slotPips(l.perDay, l.used, (used) => { state.used = { ...(state.used || {}), [l.level]: used }; changed(); })
                : h('span', { text: `${l.remaining} of ${l.preparedCount + l.preparedExtra}` })),
          h('td', { text: String(l.saveDC) }))))))
      : h('p.hint', { text: `No ${m.name.toLowerCase()} spells yet at this level.` }),
    m.spontaneous || m.spellbook ? knownLists(app, m, state, choices, changed) : null,
    m.spontaneous ? null : preparedLists(app, m, state, choices, changed));
}

/** Spell points (Unearthed Arcana): a class's daily pool, spent a spell at a time. */
function spellPointPool(m, state, changed) {
  const p = m.spellPoints;
  const amount = h('input.field.narrow', { type: 'number', min: 0, value: 1, 'aria-label': 'Spell points' });
  const set = (used) => { state.spellPointsUsed = Math.max(0, used); changed(); };
  return h('div.magic-pool',
    h('div.magic-pool-numbers',
      h('span.magic-pool-left', { text: String(p.remaining) }),
      h('span.hint', { text: `of ${p.total} spell points (${p.base} from class, ${p.bonus} bonus). 0-level spells are free, ${p.cantripsPerDay} a day.` })),
    h('div.magic-meter', h('span', { style: `width: ${p.total ? Math.max(0, Math.min(100, (p.remaining / p.total) * 100)) : 0}%` })),
    h('div.row', amount, button('Spend', () => set(p.used + (Number(amount.value) || 0))), button('Regain', () => set(p.used - (Number(amount.value) || 0)), { subtle: true })));
}

function perDayTitle(l) {
  const parts = [`${l.base} from the class table`];
  if (l.bonus) parts.push(`${l.bonus} bonus`);
  if (l.domain) parts.push(`${l.domain} domain`);
  if (l.school) parts.push(`${l.school} specialty school`);
  return parts.join(' + ');
}

function options(app, m, state, changed) {
  const pick = (label, value, list, onPick) => h('label.magic-option',
    h('span.label', { text: label }),
    h('select.field', { onchange: (ev) => onPick(ev.target.value) },
      [['', '- none -'], ...list.map((v) => [v, v])].map(([v, t]) => h('option', { value: v, text: t, selected: (value || '') === v }))));

  if (m.domains) {
    const domains = (referenceNow('domains')?.list || []).map((d) => d.name);
    const current = state.domains || [];
    return h('div.row.magic-options',
      [0, 1].map((i) => pick(`Domain ${i + 1}`, current[i], domains, (v) => {
        const next = [...current];
        next[i] = v || null;
        state.domains = next;
        changed();
      })),
      current.filter(Boolean).map((name) => h('a.hint', { href: referenceHref('domains', name), text: `${name} domain` })));
  }
  if (m.spellbook) {
    const prohibited = new Set(state.prohibited || []);
    return h('div.magic-options',
      h('div.row', pick('Specialty school', state.specialty, SCHOOLS, (v) => { state.specialty = v || null; changed(); })),
      state.specialty
        ? h('div.row.magic-prohibited', h('span.label', { text: 'Prohibited schools' }), SCHOOLS.filter((s) => s !== state.specialty).map((school) => h('label.check',
          h('input', {
            type: 'checkbox',
            checked: prohibited.has(school),
            onchange: (ev) => {
              if (ev.target.checked) prohibited.add(school); else prohibited.delete(school);
              state.prohibited = [...prohibited];
              changed();
            },
          }), h('span', { text: school }))))
        : null);
  }
  return null;
}

/** A spontaneous caster's spells known, or a wizard's spellbook, by level. */
function knownLists(app, m, state, levels, changed) {
  state.known = state.known || [];
  return h('div.magic-lists',
    h('h4', { text: m.spellbook ? 'Spellbook' : 'Spells known' }),
    levels.map((l) => {
      const here = state.known.map((k, i) => ({ ...k, i })).filter((k) => Number(k.level) === l.level);
      return h('div.magic-level',
        h('div.magic-level-head', h('span.magic-level-name', { text: levelName(l.level) }),
          l.knownAllowed !== null ? h('span.hint', { text: `${here.length} of ${l.knownAllowed}` }) : null),
        h('ul.magic-spells', here.map((k) => spellRow(k.name, 'spells', [
          button('x', () => { state.known.splice(k.i, 1); changed(); }, { subtle: true, danger: true, title: 'Forget this spell' }),
        ], m, state))),
        adder(m.name, 'spells', l.level, state.known.map((k) => k.name), (name) => {
          state.known.push({ name, level: l.level });
          changed();
        }, m));
    }));
}

/** A prepared caster's spells for today, a slot at a time, with a box to mark each one cast. */
function preparedLists(app, m, state, levels, changed) {
  state.prepared = state.prepared || {};
  const domainSpells = (level) => (state.domains || []).filter(Boolean)
    .map((d) => referenceNow('domains')?.byName.get(d.toLowerCase())?.spells?.[level - 1])
    .filter(Boolean).map((n) => lookUp('spells', n)?.name || n);

  return h('div.magic-lists',
    h('h4', { text: 'Prepared today' }),
    levels.filter((l) => l.perDay > 0 || (state.prepared[l.level] || []).length).map((l) => {
      const list = state.prepared[l.level] = state.prepared[l.level] || [];
      const regular = l.perDay - l.domain - l.school;
      const rows = [];
      // A slot is the index-th prepared entry of its kind: regular, domain, or specialty school.
      const ofKind = (kind) => list.filter((p) => (kind === 'domain' ? p?.domain : kind === 'school' ? p?.school : !p?.domain && !p?.school));
      const slot = (kind, index, label) => {
        const entry = ofKind(kind)[index] || null;
        const at = entry ? list.indexOf(entry) : -1;
        const source = kind === 'domain'
          ? domainSpells(l.level)
          : m.spellbook ? (state.known || []).filter((k) => Number(k.level) === l.level).map((k) => k.name) : null;
        const choose = spellInput(m.name, 'spells', l.level, entry?.name || '', (name) => {
          if (!name) {
            if (at >= 0) list.splice(at, 1);
          } else if (entry) {
            entry.name = name;
          } else {
            list.push({ name, used: false, ...(kind === 'domain' ? { domain: true } : {}), ...(kind === 'school' ? { school: true } : {}) });
          }
          changed();
        }, source, label);
        rows.push(h(`li.magic-slot${entry?.used ? '.is-used' : ''}`,
          h('label.check', { title: 'Cast' }, h('input', {
            type: 'checkbox',
            checked: Boolean(entry?.used),
            disabled: !entry,
            onchange: (ev) => { entry.used = ev.target.checked; changed(); },
          })),
          choose,
          label ? h('span.tag', { text: label }) : null,
          entry?.name ? detailToggle('spells', entry.name) : null));
      };
      for (let i = 0; i < Math.max(regular, 0); i++) slot('regular', i, null);
      for (let i = 0; i < l.domain; i++) slot('domain', i, 'domain');
      for (let i = 0; i < l.school; i++) slot('school', i, state.specialty || 'school');
      const extra = list.filter((p) => !p?.domain && !p?.school).slice(Math.max(regular, 0));
      return h('div.magic-level',
        h('div.magic-level-head',
          h('span.magic-level-name', { text: levelName(l.level) }),
          h('span.hint', { text: `${l.remaining} left of ${l.preparedCount + l.preparedExtra} prepared` })),
        h('ul.magic-spells', rows),
        extra.length ? h('p.hint.is-error', { text: `${extra.length} more prepared than there are slots: ${extra.map((p) => p.name).join(', ')}.` }) : null);
    }));
}

/* ==========================================================================
   Manifesters
   ========================================================================== */

function powerPool(app, pool, changed) {
  const set = (used) => { app.character.magic.powerPointsUsed = Math.max(0, used); changed(); };
  const amount = h('input.field.narrow', { type: 'number', min: 0, value: 1, 'aria-label': 'Power points' });
  return h('div.magic-pool',
    h('div.magic-pool-numbers',
      h('span.magic-pool-left', { text: String(pool.remaining) }),
      h('span.hint', { text: `of ${pool.total} power points (${pool.base} from class, ${pool.bonus} bonus)` })),
    h('div.magic-meter', h('span', { style: `width: ${pool.total ? Math.max(0, Math.min(100, (pool.remaining / pool.total) * 100)) : 0}%` })),
    h('div.row',
      amount,
      button('Spend', () => set(pool.used + (Number(amount.value) || 0))),
      button('Regain', () => set(pool.used - (Number(amount.value) || 0)), { subtle: true })));
}

function manifesterBlock(app, m, state, changed) {
  const sign = (n) => (n >= 0 ? `+${n}` : String(n));
  state.known = state.known || [];
  const lists = [m.name];
  if (m.discipline) lists.push(m.discipline);
  const spend = (cost) => { app.character.magic.powerPointsUsed = (Number(app.character.magic.powerPointsUsed) || 0) + cost; changed(); };

  return h('section.magic-class',
    h('header.magic-class-head',
      h('h3', { text: `${m.name} ${m.classLevel}` }),
      h('span.hint', { text: [
        `Manifester level ${m.manifesterLevel}`,
        `${m.ability.toUpperCase()} ${m.score} (${sign(m.mod)})`,
        `highest power level ${m.maxPowerLevel}${m.maxPowerLevel < m.maxPowerLevelByTable ? ` (${m.maxPowerLevelByTable} with a higher ${m.ability.toUpperCase()})` : ''}`,
        `save DC 10 + power level ${sign(m.mod)}`,
      ].join(' - ') })),
    m.disciplines
      ? h('div.row.magic-options', h('label.magic-option',
        h('span.label', { text: 'Discipline' }),
        h('select.field', { onchange: (ev) => { state.discipline = ev.target.value || null; changed(); } },
          [['', '- choose -'], ...DISCIPLINES.map((d) => [d, d])].map(([v, t]) => h('option', { value: v, text: t, selected: (state.discipline || '') === v })))))
      : null,
    h('div.magic-lists',
      h('div.magic-level-head',
        h('h4', { text: 'Powers known' }),
        h('span.hint', { text: `${m.powersKnown.count} of ${m.powersKnown.allowed}` })),
      h('ul.magic-spells', state.known.map((k, i) => {
        const power = lookUp('powers', k.name);
        const cost = power?.powerPoints ?? null;
        return spellRow(k.name, 'powers', [
          h('span.tag', { text: `${ordinal(Number(k.level) || 0)}` }),
          cost !== null ? button(`Manifest (${cost} pp)`, () => spend(cost), { subtle: true, title: 'Spend its base cost. Augmenting costs more: spend the extra from the pool.' }) : null,
          button('x', () => { state.known.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Forget this power' }),
        ], m, state);
      })),
      adder(lists, 'powers', null, state.known.map((k) => k.name), (name) => {
        const power = lookUp('powers', name);
        const level = power ? Math.min(...lists.map((w) => power.levels?.[w]).filter((n) => n !== undefined)) : 1;
        state.known.push({ name: power?.name || name, level: Number.isFinite(level) ? level : 1 });
        changed();
      }, m, m.maxPowerLevel)));
}

/* ==========================================================================
   Rows and pickers
   ========================================================================== */

/** A spell or power by name: its summary, the way to its full entry, and actions. */
function spellRow(name, kind, actions, m, state) {
  const entry = lookUp(kind, name);
  const prohibited = kind === 'spells' && entry && (state?.prohibited || []).includes(entry.school);
  return h(`li.magic-spell${prohibited ? '.is-prohibited' : ''}`,
    h('div.magic-spell-line',
      h('span.magic-spell-name', { text: entry?.name || name }),
      h('span.hint.magic-spell-summary', { text: entry ? [entry.school || entry.discipline, entry.summary].filter(Boolean).join(' - ') : 'Not in the SRD reference' }),
      prohibited ? h('span.tag.is-blocked', { text: 'prohibited school' }) : null,
      actions),
    entry ? detailToggle(kind, entry.name) : null);
}

/** "Details" that open the reference entry in place. */
function detailToggle(kind, name) {
  const holder = h('div.magic-detail');
  const details = h('details.magic-details',
    h('summary', { text: 'Details' }),
    holder);
  details.addEventListener('toggle', () => {
    if (details.open && !holder.firstChild) refill(holder, referenceCard(kind, lookUp(kind, name)) || h('p.hint', { text: 'Not in the reference.' }));
  });
  return details;
}

/** The names a class may choose at a level, from the reference. */
function namesFor(lists, kind, level, maxLevel) {
  const who = [].concat(lists);
  return (referenceNow(kind)?.list || [])
    .filter((e) => who.some((w) => {
      const at = e.levels?.[w];
      if (at === undefined) return false;
      if (level !== null && level !== undefined) return at === level;
      return maxLevel === undefined || at <= maxLevel;
    }))
    .map((e) => e.name);
}

let pickerCount = 0;

/** A text box that completes from the class's list, and adds what is chosen. */
function adder(lists, kind, level, have, onAdd, m, maxLevel) {
  const names = namesFor(lists, kind, level, maxLevel).filter((n) => !have.includes(n));
  const id = `magic-picker-${++pickerCount}`;
  const input = h('input.field.grow', {
    type: 'text',
    placeholder: kind === 'powers' ? `Add a power${maxLevel ? ` (up to ${levelName(maxLevel)})` : ''}` : `Add a ${level === 0 ? '0-level' : `${ordinal(level)}-level`} spell`,
    list: id,
    dataset: { unbound: '' },
  });
  const add = () => {
    const typed = input.value.trim();
    if (!typed) return;
    onAdd(lookUp(kind, typed)?.name || typed);
  };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  input.addEventListener('change', () => { if (names.includes(input.value.trim()) || lookUp(kind, input.value)) add(); });
  return h('div.row.magic-adder', { dataset: { unbound: '' } },
    input,
    h('datalist', { id }, names.map((n) => h('option', { value: n }))),
    button('Add', add, { subtle: true }));
}

/** A slot's spell: a box that completes from the spellbook, the domain, or the class's list. */
function spellInput(className, kind, level, value, onSet, source, label) {
  const names = source || namesFor(className, kind, level);
  const id = `magic-picker-${++pickerCount}`;
  const input = h('input.field.grow', {
    type: 'text',
    value,
    placeholder: label === 'domain' ? 'Domain spell' : source && !source.length ? 'Nothing in the spellbook at this level' : 'Prepare a spell',
    list: id,
    dataset: { unbound: '' },
  });
  input.addEventListener('change', () => onSet(lookUp(kind, input.value)?.name || input.value.trim()));
  return h('span.magic-slot-input', { dataset: { unbound: '' } }, input, h('datalist', { id }, names.map((n) => h('option', { value: n }))));
}

/** A row of boxes, one a slot, filled for each cast; clicking sets how many are cast. */
function slotPips(total, used, onSet) {
  if (!total) return h('span.hint', { text: '-' });
  return h('span.pips', { role: 'group', 'aria-label': `${used} of ${total} cast` },
    Array.from({ length: total }, (_, i) => h(`button.pip${i < used ? '.is-used' : ''}`, {
      type: 'button',
      title: i < used ? 'Cast - click to take back' : 'Click to cast',
      'aria-pressed': String(i < used),
      onclick: () => onSet(i < used ? i : i + 1),
    })),
    used > total ? h('span.tag.is-blocked', { text: `+${used - total}` }) : null);
}
