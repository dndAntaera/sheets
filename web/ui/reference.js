// The Reference pages: the SRD's spells, powers, feats, classes, domains and
// equipment, searched and filtered, one entry open at a time.
//
//   #/reference/<kind>          a list, with filters
//   #/reference/<kind>/<name>   the same, with one entry open
//
// referenceCard() draws one entry, and is what the sheet uses too, so a spell
// on a character's list reads exactly as it does here.

import { h, refill } from './dom.js';
import { REFERENCE_KINDS, loadReference, referenceHref } from '../reference.js';

const SPELL_CLASSES = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Wizard'];
const POWER_CLASSES = ['Psion', 'Psychic Warrior', 'Wilder', 'Egoist', 'Kineticist', 'Nomad', 'Seer', 'Shaper', 'Telepath'];
const LIST_LIMIT = 250;

// Filters are kept per kind for the visit, so going back to a list finds it as it was left.
const filters = {};

/** Text from the SRD's own (already cleaned) HTML. See scripts/build-srd.py. */
const prose = (markup, className = 'reference-text') => (markup ? h(`div.${className}`, { html: markup }) : null);
const line = (label, value) => (value === null || value === undefined || value === '' ? null : h('div.reference-line', h('span.reference-label', { text: label }), h('span', { text: String(value) })));
const levelText = (levels = {}) => Object.entries(levels).map(([who, n]) => `${who} ${n}`).join(', ');

/* ==========================================================================
   One entry
   ========================================================================== */

export function referenceCard(kind, e) {
  if (!e) return null;
  const head = (subtitle) => h('div.reference-head', h('h2', { text: e.name }), subtitle ? h('p.reference-subtitle', { text: subtitle }) : null);
  switch (kind) {
    case 'spells':
      return h('article.reference-card',
        head([e.school, e.subschool ? `(${e.subschool})` : '', e.descriptor ? `[${e.descriptor}]` : ''].filter(Boolean).join(' ')),
        h('div.reference-block',
          line('Level', levelText(e.levels)),
          line('Components', e.components),
          line('Casting time', e.castingTime),
          line('Range', e.range),
          line('Target', e.target), line('Area', e.area), line('Effect', e.effect),
          line('Duration', e.duration),
          line('Saving throw', e.save),
          line('Spell resistance', e.sr)),
        prose(e.text),
        e.material ? h('p.reference-note', h('b', { text: 'Material component: ' }), e.material) : null,
        e.focus ? h('p.reference-note', h('b', { text: 'Focus: ' }), e.focus) : null,
        e.xp ? h('p.reference-note', h('b', { text: 'XP cost: ' }), e.xp) : null);
    case 'powers':
      return h('article.reference-card',
        head([e.discipline, e.subdiscipline ? `(${e.subdiscipline})` : '', e.descriptor ? `[${e.descriptor}]` : ''].filter(Boolean).join(' ')),
        h('div.reference-block',
          line('Level', levelText(e.levels)),
          line('Display', e.display),
          line('Manifesting time', e.manifestingTime),
          line('Range', e.range),
          line('Target', e.target), line('Area', e.area), line('Effect', e.effect),
          line('Duration', e.duration),
          line('Saving throw', e.save),
          line('Power points', e.powerPoints),
          line('Power resistance', e.pr)),
        prose(e.text),
        prose(e.augment, 'reference-augment'));
    case 'feats':
      return h('article.reference-card',
        head((e.types || []).join(', ')),
        e.prerequisite ? h('p.reference-note', h('b', { text: 'Prerequisite: ' }), e.prerequisite) : null,
        prose(e.benefit),
        e.normal ? h('div.reference-note', h('b', { text: 'Normal: ' }), h('span', { html: e.normal })) : null,
        e.special ? h('div.reference-note', h('b', { text: 'Special: ' }), h('span', { html: e.special })) : null,
        e.multiple ? h('p.hint', { text: 'May be taken more than once.' }) : null);
    case 'classes':
      return h('article.reference-card',
        head((e.kinds || []).join(', ')),
        h('div.reference-block',
          line('Hit die', e.hitDie ? `d${e.hitDie}` : null),
          line('Skill points', e.skillPoints ? `${e.skillPoints} + Int modifier per level` : null),
          line('Spells or powers from', e.spellAbility),
          line('Alignment', e.alignment),
          line('Class skills', e.classSkills)),
        e.table?.length ? classTable(e) : null,
        e.text ? h('details.reference-full', h('summary', { text: 'Full description' }), prose(e.text)) : null);
    case 'domains':
      return h('article.reference-card',
        head('Cleric domain'),
        h('p', h('b', { text: 'Granted power: ' }), e.grantedPower || ''),
        h('ol.reference-domain-spells', (e.spells || []).map((s) => h('li', s
          ? h('a', { href: referenceHref('spells', s), text: s[0].toUpperCase() + s.slice(1) })
          : '-'))));
    case 'variants':
      return h('article.reference-card',
        head(`${e.category} - Unearthed Arcana`),
        h('p', { text: e.summary }),
        h('p.reference-note', h('b', { text: 'On the sheet: ' }), e.onSheet),
        prose(e.text),
        h('p.hint', {}, 'Also on the ', h('a', { href: e.url, target: '_blank', rel: 'noopener', text: 'Hypertext d20 SRD' }), '.'));
    case 'traits':
      return h('article.reference-card',
        head(`${e.kind === 'flaw' ? 'Flaw' : 'Trait'} - Unearthed Arcana`),
        h('p', { text: e.description }),
        e.benefit ? h('p', h('b', { text: 'Benefit: ' }), e.benefit) : null,
        e.drawback ? h('p', h('b', { text: 'Drawback: ' }), e.drawback) : null,
        e.effect ? h('p', h('b', { text: 'Effect: ' }), e.effect) : null,
        e.special ? h('p.reference-note', h('b', { text: 'Special: ' }), e.special) : null,
        h('p.hint', { text: e.kind === 'flaw' ? 'Each flaw taken at 1st level buys a bonus feat.' : 'Up to two traits at 1st level.' }));
    case 'languages':
      return h('article.reference-card',
        head(e.secret ? 'Secret language' : 'Language'),
        h('div.reference-block',
          line('Typical speakers', e.speakers),
          line('Alphabet', e.alphabet)),
        e.secret ? h('p.hint', { text: 'Only druids learn Druidic, and they may not teach it.' }) : null);
    case 'equipment':
      return h('article.reference-card',
        head([e.category, e.subcategory].filter(Boolean).join(' - ')),
        h('div.reference-block',
          line('Cost', e.cost), line('Weight', e.weight),
          line('Damage (small)', e.damageSmall), line('Damage (medium)', e.damageMedium),
          line('Critical', e.critical), line('Range increment', e.range), line('Type', e.damageType),
          line('Armor or shield bonus', e.armorBonus !== undefined ? `+${e.armorBonus}` : null),
          line('Maximum Dex bonus', e.maxDex !== undefined ? `+${e.maxDex}` : null),
          line('Armor check penalty', e.checkPenalty),
          line('Arcane spell failure', e.spellFailure),
          line('Speed', e.speed30 ? `${e.speed30} (30 ft.), ${e.speed20} (20 ft.)` : null)),
        prose(e.text));
    default:
      return null;
  }
}

function classTable(e) {
  const casting = e.table.some((r) => r.slots?.length);
  const psionic = e.table.some((r) => r.powerPoints !== undefined);
  const slotCount = Math.max(0, ...e.table.map((r) => r.slots?.length || 0));
  return h('div.table-scroll', h('table.reference-table',
    h('thead', h('tr',
      ['Level', 'Base attack', 'Fort', 'Ref', 'Will', 'Special'].map((c) => h('th', { text: c })),
      psionic ? [h('th', { text: 'Power points' }), h('th', { text: 'Powers known' }), h('th', { text: 'Max level' })] : null,
      casting ? Array.from({ length: slotCount }, (_, i) => h('th', { text: String(i) })) : null)),
    h('tbody', e.table.map((r) => h('tr',
      h('td', { text: String(r.level) }),
      h('td', { text: r.bab || '' }),
      h('td', { text: `+${r.fort ?? 0}` }), h('td', { text: `+${r.ref ?? 0}` }), h('td', { text: `+${r.will ?? 0}` }),
      h('td', { text: r.special || '' }),
      psionic ? [h('td', { text: String(r.powerPoints ?? '') }), h('td', { text: String(r.powersKnown ?? '') }), h('td', { text: String(r.maxPowerLevel ?? '') })] : null,
      casting ? Array.from({ length: slotCount }, (_, i) => h('td', { text: r.slots?.[i] ?? '-' })) : null)))));
}

/* ==========================================================================
   The page
   ========================================================================== */

export async function showReference(main, app, kind = 'spells', name = null) {
  if (!REFERENCE_KINDS[kind]) kind = 'spells';
  refill(main, h('div.roster.reference-page', h('p.empty', { text: `Opening the ${REFERENCE_KINDS[kind].label.toLowerCase()}…` })));
  let index;
  try {
    index = await loadReference(kind);
  } catch (err) {
    refill(main, h('div.roster', h('h1', { text: 'Reference' }), h('p.empty', { text: `${err.message}.` })));
    return;
  }
  const open = name ? index.byName.get(name.toLowerCase()) : null;
  const state = filters[kind] = filters[kind] || { q: '' };

  const results = h('ul.content-list.reference-list');
  const count = h('p.hint.reference-count');
  const draw = () => {
    const found = index.list.filter((e) => matches(kind, e, state));
    count.textContent = `${found.length} of ${index.list.length}`;
    refill(results,
      found.slice(0, LIST_LIMIT).map((e) => h('li', h('a.content-item', {
        href: referenceHref(kind, e.id || e.name),
        class: open && e === open ? 'is-active' : '',
      },
      h('span.content-item-name', { text: e.name }),
      h('span.content-item-meta', { text: listLine(kind, e, state) })))),
      found.length > LIST_LIMIT ? h('li.hint', { text: `${found.length - LIST_LIMIT} more. Narrow the search to see them.` }) : null,
      found.length ? null : h('li.hint', { text: 'Nothing matches.' }));
  };

  const search = h('input.field', {
    type: 'search',
    value: state.q,
    placeholder: `Search ${REFERENCE_KINDS[kind].label.toLowerCase()}`,
    'aria-label': 'Search',
    oninput: (ev) => { state.q = ev.target.value; draw(); },
  });

  refill(main, h('div.content-page.reference-page',
    h('div.content-head',
      h('div',
        h('h1', { text: 'Reference' }),
        h('p.hint', { text: 'The System Reference Document: every spell, power, feat, class, domain, piece of equipment, variant rule, trait, flaw and language. Pick one on a sheet and it reads the same as it does here.' }))),
    h('nav.content-tabs', Object.entries(REFERENCE_KINDS).map(([k, v]) => h('a.content-tab', { href: referenceHref(k), class: k === kind ? 'is-active' : '' }, v.label))),
    h('div.content-body',
      h('aside.content-side',
        search,
        filterControls(kind, index.list, state, draw),
        count,
        results),
      open
        ? h('div.reference-detail', referenceCard(kind, open))
        : h('div.content-empty', h('p', { text: name ? `No ${REFERENCE_KINDS[kind].singular} called ${name}.` : `Choose a ${REFERENCE_KINDS[kind].singular} to read it.` })))));
  draw();
  if (open) document.title = `${open.name} - Reference`;
}

function filterControls(kind, list, state, draw) {
  const choose = (label, keyName, options) => h('label.reference-filter',
    h('span.label', { text: label }),
    h('select.field', {
      onchange: (ev) => { state[keyName] = ev.target.value; draw(); },
    }, [['', 'Any'], ...options].map(([value, text]) => h('option', { value, text, selected: (state[keyName] || '') === value }))));
  const levels = (max, from = 0) => Array.from({ length: max - from + 1 }, (_, i) => [String(i + from), String(i + from)]);
  const distinct = (pick) => [...new Set(list.flatMap((e) => [].concat(pick(e) || [])))].filter(Boolean).sort().map((v) => [v, v]);

  switch (kind) {
    case 'spells':
      return h('div.reference-filters',
        choose('Class or domain', 'who', [...SPELL_CLASSES.map((c) => [c, c]), ...distinct((e) => Object.keys(e.levels || {})).filter(([v]) => !SPELL_CLASSES.includes(v))]),
        choose('Level', 'level', levels(9)),
        choose('School', 'school', distinct((e) => e.school)));
    case 'powers':
      return h('div.reference-filters',
        choose('Class or discipline list', 'who', POWER_CLASSES.map((c) => [c, c])),
        choose('Level', 'level', levels(9, 1)),
        choose('Discipline', 'discipline', distinct((e) => e.discipline)));
    case 'feats':
      return h('div.reference-filters', choose('Type', 'type', distinct((e) => e.types)));
    case 'classes':
      return h('div.reference-filters', choose('Kind', 'kind', distinct((e) => e.kinds)));
    case 'equipment':
      return h('div.reference-filters', choose('Category', 'category', distinct((e) => e.category)));
    case 'variants':
      return h('div.reference-filters', choose('Category', 'group', distinct((e) => e.category)));
    case 'traits':
      return h('div.reference-filters', choose('Kind', 'traitKind', [['trait', 'Traits'], ['flaw', 'Flaws']]));
    default:
      return null;
  }
}

function matches(kind, e, state) {
  if (state.q && !e.name.toLowerCase().includes(state.q.trim().toLowerCase())) return false;
  const levels = e.levels || {};
  if (state.who && levels[state.who] === undefined) return false;
  if (state.level) {
    const want = Number(state.level);
    if (state.who ? levels[state.who] !== want : !Object.values(levels).includes(want)) return false;
  }
  if (state.school && e.school !== state.school) return false;
  if (state.discipline && e.discipline !== state.discipline) return false;
  if (state.type && !(e.types || []).includes(state.type)) return false;
  if (state.kind && !(e.kinds || []).includes(state.kind)) return false;
  if (state.category && e.category !== state.category) return false;
  if (state.group && e.category !== state.group) return false;
  if (state.traitKind && e.kind !== state.traitKind) return false;
  return true;
}

function listLine(kind, e, state) {
  switch (kind) {
    case 'spells':
    case 'powers':
      return state.who && e.levels?.[state.who] !== undefined
        ? `${state.who} ${e.levels[state.who]} - ${e.summary || e.school || e.discipline || ''}`
        : e.summary || levelText(e.levels);
    case 'feats': return (e.types || []).join(', ');
    case 'classes': return [(e.kinds || []).join(', '), e.hitDie ? `d${e.hitDie}` : ''].filter(Boolean).join(' - ');
    case 'domains': return e.grantedPower ? `${e.grantedPower.slice(0, 60)}…` : '';
    case 'equipment': return [e.category, e.cost].filter(Boolean).join(' - ');
    case 'variants': return e.category;
    case 'traits': return `${e.kind === 'flaw' ? 'Flaw' : 'Trait'} - ${e.kind === 'flaw' ? e.effect : e.benefit}`;
    case 'languages': return e.speakers;
    default: return '';
  }
}
