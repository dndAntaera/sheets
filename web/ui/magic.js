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
              ? (l.level === 0 ? 'all' : String(l.knownCount))
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
  const pick = (label, value, list, onPick, disabledValues = []) => h('label.magic-option',
    h('span.label', { text: label }),
    h('select.field', { onchange: (ev) => onPick(ev.target.value), dataset: { unbound: '' } },
      [['', '- choose -'], ...list.map((v) => [v, v])].map(([v, t]) => h('option', {
        value: v,
        text: disabledValues.includes(v) && v ? `${t} (chosen)` : t,
        selected: (value || '') === v,
        disabled: Boolean(v) && disabledValues.includes(v),
      }))));

  if (m.domains) {
    const domains = (referenceNow('domains')?.list || []).map((d) => d.name);
    const current = state.domains || [];
    return h('div.magic-options',
      h('div.row',
        [0, 1].map((i) => pick(`Domain ${i + 1}`, current[i], domains, (v) => {
          const next = [...current];
          next[i] = v || null;
          state.domains = next;
          changed();
        }, current.filter((d, j) => j !== i && d)))),
      h('p.hint', { text: 'Two different domains. Each gives a granted power, listed under Special abilities, and a domain spell a day at every level you can cast.' }),
      current.filter(Boolean).map((name) => h('a.hint', { href: referenceHref('domains', name), text: `${name} domain` })));
  }
  if (m.spellbook) {
    const prohibited = new Set(state.prohibited || []);
    const need = state.specialty === 'Divination' ? 1 : 2;
    return h('div.magic-options',
      h('div.row', pick('Specialty school', state.specialty, SCHOOLS, (v) => {
        state.specialty = v || null;
        state.prohibited = (state.prohibited || []).filter((s) => s !== v && s !== 'Divination');
        changed();
      })),
      state.specialty
        ? h('div.row.magic-prohibited',
          h('span.label', { text: `Prohibited schools (${need})` }),
          SCHOOLS.filter((s) => s !== state.specialty).map((school) => h('label.check', { title: school === 'Divination' ? 'A wizard can never give up divination.' : '' },
            h('input', {
              type: 'checkbox',
              checked: prohibited.has(school),
              disabled: school === 'Divination' || (!prohibited.has(school) && prohibited.size >= need),
              onchange: (ev) => {
                if (ev.target.checked) prohibited.add(school); else prohibited.delete(school);
                state.prohibited = [...prohibited];
                changed();
              },
            }), h('span', { text: school }))))
        : h('p.hint', { text: 'A specialist prepares one more spell of their school at each level, and gives up two other schools (a diviner, one).' }));
  }
  return null;
}

/* ==========================================================================
   The lists: what may be learned, and what may be prepared
   ========================================================================== */

/** The spells a class may choose at a level, from the reference, less a specialist's prohibited schools. */
function spellsFor(className, level, state) {
  const prohibited = new Set(state?.prohibited || []);
  return (referenceNow('spells')?.list || [])
    .filter((e) => e.levels?.[className] === level && !prohibited.has(e.school));
}

/** The names a manifester may learn: its class list and discipline, up to the highest level it can learn. */
function powersFor(lists, maxLevel) {
  return (referenceNow('powers')?.list || [])
    .map((e) => ({ e, level: Math.min(...lists.map((w) => e.levels?.[w]).filter((n) => n !== undefined)) }))
    .filter(({ level }) => Number.isFinite(level) && level <= maxLevel);
}

const METAMAGIC = {
  'Empower Spell': 2, 'Enlarge Spell': 1, 'Extend Spell': 1, 'Maximize Spell': 3,
  'Quicken Spell': 4, 'Silent Spell': 1, 'Still Spell': 1, 'Widen Spell': 3, 'Heighten Spell': 0,
};

/** A dropdown that manages itself. `groups`: [{ label, options: [{ value, text, disabled }] }]. */
function dropdown(label, value, groups, onPick, opts = {}) {
  return h('select.field.grow', {
    'aria-label': label,
    dataset: { unbound: '' },
    disabled: opts.disabled,
    onchange: (ev) => onPick(ev.target.value),
  },
  h('option', { value: '', text: opts.empty || '- choose -', selected: !value }),
  groups.filter((g) => g.options.length).map((g) => (g.label
    ? h('optgroup', { label: g.label }, g.options.map((o) => h('option', { value: o.value, text: o.text, selected: o.value === value, disabled: o.disabled })))
    : g.options.map((o) => h('option', { value: o.value, text: o.text, selected: o.value === value, disabled: o.disabled })))));
}

/** A spontaneous caster's spells known, or a wizard's spellbook, by level. */
function knownLists(app, m, state, levels, changed) {
  state.known = state.known || [];
  const book = m.spellbook ? m.spellbookFree : null;
  return h('div.magic-lists',
    h('h4', { text: m.spellbook ? 'Spellbook' : 'Spells known' }),
    book ? h('p.hint', { text: `A wizard's spellbook holds every 0-level spell of an allowed school, plus ${book.free} spells chosen at 1st level and as levels are gained (${book.used} chosen). More can be copied in from scrolls and other spellbooks.` }) : null,
    levels.map((l) => {
      if (m.spellbook && l.level === 0) {
        const cantrips = spellsFor(m.name, 0, state);
        return h('div.magic-level',
          h('div.magic-level-head', h('span.magic-level-name', { text: levelName(0) }), h('span.hint', { text: `all ${cantrips.length}` })),
          h('details.magic-cantrips', h('summary', { text: 'Every 0-level spell of an allowed school' }),
            h('ul.magic-spells', cantrips.map((e) => spellRow(e.name, 'spells', [], m, state)))));
      }
      const here = state.known.map((k, i) => ({ ...k, i })).filter((k) => Number(k.level) === l.level);
      const full = l.knownAllowed !== null && here.length >= l.knownAllowed;
      // A wizard learns spells only of levels they can cast.
      const learnable = !m.spellbook || (l.castable && l.base + l.bonus > 0);
      const have = new Set(state.known.map((k) => k.name));
      const choices = spellsFor(m.name, l.level, state).filter((e) => !have.has(e.name));
      return h('div.magic-level',
        h('div.magic-level-head', h('span.magic-level-name', { text: levelName(l.level) }),
          l.knownAllowed !== null ? h('span.hint', { text: `${here.length} of ${l.knownAllowed}` }) : null),
        h('ul.magic-spells', here.map((k) => spellRow(k.name, 'spells', [
          button('x', () => { state.known.splice(k.i, 1); changed(); }, { subtle: true, danger: true, title: 'Forget this spell' }),
        ], m, state))),
        h('div.row.magic-adder',
          dropdown(`Add a ${levelName(l.level)} spell`, '', [{ options: choices.map((e) => ({ value: e.name, text: `${e.name} - ${e.school}` })) }], (name) => {
            if (!name) return;
            state.known.push({ name, level: l.level });
            changed();
          }, {
            disabled: full || !learnable || !choices.length,
            empty: full ? '- all known -' : !learnable ? `- needs ${m.ability.toUpperCase()} ${10 + l.level} and a slot -` : `- learn a ${levelName(l.level)} spell -`,
          })));
    }));
}

/** A prepared caster's spells for today, a slot at a time, with a box to mark each one cast. */
function preparedLists(app, m, state, levels, changed) {
  state.prepared = state.prepared || {};
  const metamagicFeats = (app.derived.featPlan?.held || []).map((f) => f.name).filter((n) => METAMAGIC[n] !== undefined);
  const domainSpells = (upTo) => {
    const out = [];
    for (const d of (state.domains || []).filter(Boolean)) {
      const spells = referenceNow('domains')?.byName.get(d.toLowerCase())?.spells || [];
      spells.slice(0, upTo).forEach((n, i) => { if (n) out.push({ name: lookUp('spells', n)?.name || n, level: i + 1, school: lookUp('spells', n)?.school }); });
    }
    return out;
  };
  // What may go in a slot: a spell of the slot's level or lower, from the
  // spellbook (a wizard), the class list (a cleric, druid, paladin or ranger),
  // the domains (a domain slot), or the specialty school (a specialist's slot).
  const sourceFor = (kind, level) => {
    if (kind === 'domain') return domainSpells(level);
    const pool = [];
    for (let L = 0; L <= level; L++) {
      if (m.spellbook) {
        if (L === 0) pool.push(...spellsFor(m.name, 0, state).map((e) => ({ name: e.name, level: 0, school: e.school })));
        else pool.push(...(state.known || []).filter((k) => Number(k.level) === L).map((k) => ({ name: k.name, level: L, school: lookUp('spells', k.name)?.school })));
      } else {
        pool.push(...spellsFor(m.name, L, state).map((e) => ({ name: e.name, level: L, school: e.school })));
      }
    }
    if (m.spellbook && !pool.some((p) => p.name === 'Read Magic') && level >= 0) pool.push({ name: 'Read Magic', level: 0, school: 'Universal' });
    // A specialist cannot prepare spells of a prohibited school, even ones already in the spellbook.
    const prohibited = new Set(state.prohibited || []);
    const allowed = pool.filter((p) => !prohibited.has(p.school));
    return kind === 'school' ? allowed.filter((p) => p.school === state.specialty) : allowed;
  };

  return h('div.magic-lists',
    h('h4', { text: 'Prepared today' }),
    m.spellbook ? h('p.hint', { text: 'From the spellbook only (and read magic, from memory). A lower-level spell can fill a higher slot, and a metamagic feat raises the slot a spell needs.' }) : null,
    levels.filter((l) => l.perDay > 0 || (state.prepared[l.level] || []).length).map((l) => {
      const list = state.prepared[l.level] = state.prepared[l.level] || [];
      const regular = l.perDay - l.domain - l.school;
      const rows = [];
      const ofKind = (kind) => list.filter((p) => (kind === 'domain' ? p?.domain : kind === 'school' ? p?.school : !p?.domain && !p?.school));
      const slot = (kind, index, label) => {
        const entry = ofKind(kind)[index] || null;
        const at = entry ? list.indexOf(entry) : -1;
        const source = sourceFor(kind, l.level);
        const adjust = entry?.metamagic ? (entry.metamagic === 'Heighten Spell' ? 0 : METAMAGIC[entry.metamagic] || 0) : 0;
        const fits = (p) => p.level + adjust <= l.level;
        const byLevel = new Map();
        for (const p of source) {
          const key = p.level === l.level ? 'This level' : `${levelName(p.level)}`;
          if (!byLevel.has(key)) byLevel.set(key, []);
          if (!byLevel.get(key).some((x) => x.value === p.name)) byLevel.get(key).push({ value: p.name, text: p.name, disabled: !fits(p) });
        }
        const groups = [...byLevel.entries()].sort(([a], [b]) => (a === 'This level' ? -1 : b === 'This level' ? 1 : b.localeCompare(a)))
          .map(([group, options]) => ({ label: group, options: options.sort((x, y) => x.text.localeCompare(y.text)) }));
        if (entry?.name && !source.some((p) => p.name === entry.name)) groups.unshift({ label: 'Prepared', options: [{ value: entry.name, text: `${entry.name} (not available)` }] });
        const prepared = entry ? source.find((p) => p.name === entry.name) : null;
        const tooHigh = prepared && !fits(prepared);
        rows.push(h(`li.magic-slot${entry?.used ? '.is-used' : ''}`,
          h('label.check', { title: 'Cast' }, h('input', {
            type: 'checkbox',
            checked: Boolean(entry?.used),
            disabled: !entry,
            onchange: (ev) => { entry.used = ev.target.checked; changed(); },
          })),
          h('span.magic-slot-input', { dataset: { unbound: '' } },
            dropdown(`${levelName(l.level)} slot`, entry?.name || '', groups, (name) => {
              if (!name) {
                if (at >= 0) list.splice(at, 1);
              } else if (entry) {
                entry.name = name;
              } else {
                list.push({ name, used: false, ...(kind === 'domain' ? { domain: true } : {}), ...(kind === 'school' ? { school: true } : {}) });
              }
              changed();
            }, { empty: source.length ? (kind === 'domain' ? '- a domain spell -' : '- prepare a spell -') : m.spellbook ? '- nothing in the spellbook yet -' : kind === 'domain' ? '- choose domains first -' : '- no spells -' })),
          entry && metamagicFeats.length && l.level > 0
            ? dropdown('Metamagic', entry.metamagic || '', [{ options: metamagicFeats.map((f) => ({ value: f, text: `${f.replace(' Spell', '')} (+${METAMAGIC[f] || 'to slot'})` })) }], (feat) => {
              entry.metamagic = feat || null;
              changed();
            }, { empty: '- no metamagic -' })
            : null,
          label ? h('span.tag', { text: label }) : null,
          tooHigh ? h('span.tag.is-blocked', { text: `needs a ${levelName(prepared.level + adjust)} slot` }) : null,
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
      (() => {
        const have = new Set(state.known.map((k) => k.name));
        const full = m.powersKnown.count >= m.powersKnown.allowed;
        const byLevel = new Map();
        for (const { e, level } of powersFor(lists, m.maxPowerLevel)) {
          if (have.has(e.name)) continue;
          if (!byLevel.has(level)) byLevel.set(level, []);
          byLevel.get(level).push({ value: e.name, text: `${e.name} (${e.powerPoints ?? '?'} pp)` });
        }
        const groups = [...byLevel.entries()].sort(([x], [y]) => x - y)
          .map(([level, options]) => ({ label: levelName(level), options: options.sort((x, y) => x.text.localeCompare(y.text)) }));
        return h('div.row.magic-adder', { dataset: { unbound: '' } },
          dropdown('Learn a power', '', groups, (name) => {
            if (!name) return;
            const power = lookUp('powers', name);
            const level = power ? Math.min(...lists.map((w) => power.levels?.[w]).filter((n) => n !== undefined)) : 1;
            state.known.push({ name: power?.name || name, level: Number.isFinite(level) ? level : 1 });
            changed();
          }, {
            disabled: full || !groups.length,
            empty: full ? '- all powers known -' : m.maxPowerLevel < 1 ? `- needs ${m.ability.toUpperCase()} 11 to learn a power -` : m.disciplines && !m.discipline ? '- choose a discipline, or learn from the psion list -' : '- learn a power -',
          }));
      })()));
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
