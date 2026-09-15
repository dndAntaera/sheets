// The SRD's variant rules on the sheet.
//
//   advancedRulesPanel   the creator's Advanced step: every rule of play, by
//                        category, to switch on or off (or shown as set by the
//                        campaign), with the choices a rule needs once it is on
//   classChoicesPanel    the creator's Class step: what a generic or paragon
//                        class chooses, a class feature traded for a variant's,
//                        and what a prestige class asks for
//   rulesInPlayPanel     the sheet's Rules page: every rule this character plays
//                        by, to read - changed in the creator
//   variantCombatPanel   the Combat page: what adventuring variants change -
//                        defense bonus, damage reduction, vitality and wounds,
//                        reserve points, injury, massive damage, dying rules
//   variantTracksPanel   the Feats page: craft points, contacts, reputation,
//                        honor, sanity, bloodline, level adjustment, taint
//
// The numbers are engine/variants.js's; the catalog - names, what each does, what
// the sheet does about it - is data/variants.json.

import { h, button, labelled, row, total } from './dom.js';
import {
  moduleState, MODULE_LABELS, MODULES, PLAY_MODULES, BUILD_MODULES, CONTENT_MODULES, featureVariantOptions, REPLACED_FEATURES,
} from '../engine/index.js';
import { referenceHref } from '../reference.js';

const SHEET_LABEL = { math: 'changes numbers', track: 'adds a track', table: 'rule of play' };

/** The character's state for variants, made if missing. */
const stateOf = (app) => (app.character.variants = app.character.variants || {});

/* ==========================================================================
   The creator's Advanced step: the rules of play
   ========================================================================== */

/** A variant's switch: on or off, or its state as the campaign or ruleset sets it. */
function variantSwitch(app, id, name, ways) {
  const c = app.character;
  const s = moduleState(app.rules, c, id, app.overrides);
  if (!s.available) return h('span.hint', { text: 'not in this ruleset' });
  if (!s.choosable) return h(`span.variant-locked${s.on ? '.is-on' : ''}`, { title: s.lockedBy === 'campaign' || s.lockedBy === 'gm' ? 'Set by the campaign.' : 'Set by the ruleset.' }, s.on ? 'on' : 'off');
  return h('label.switch', { title: s.on ? 'Switch off' : 'Switch on' },
    h('input', {
      type: 'checkbox',
      checked: s.on,
      onchange: (ev) => {
        c.options = { ...c.options, [id]: ev.target.checked };
        ways.reopen();
      },
    }),
    h('span.switch-track', { 'aria-hidden': 'true' }),
    h('span.sr-only', { text: name }));
}

/**
 * Every rule that changes how a character plays rather than how it is built -
 * defense bonus, vitality and wound points, spell points and the rest - each to
 * switch on, with what it needs once it is.
 *
 * @param ways  from app.js: { reopen() } - draw the step again after a change that reshapes it
 */
export function advancedRulesPanel(app, ways) {
  const catalog = app.rules.variants;
  if (!catalog) return null;
  const d = app.derived;
  const offered = PLAY_MODULES.filter((id) => moduleState(app.rules, app.character, id, app.overrides).available);
  const listed = catalog.variants.filter((v) => offered.includes(v.id));
  // A ruleset's own rules of play - Antaera's taint and training - are not in the SRD's catalog.
  const own = offered.filter((id) => !listed.some((v) => v.id === id));
  const on = offered.filter((id) => d.modules[id]).length;

  const item = (id, name, tag, summary, effect, link) => h(`li.variant-item${d.modules[id] ? '.is-on' : ''}`,
    h('div.variant-head',
      variantSwitch(app, id, name, ways),
      h('div.variant-text',
        h('span.variant-name', { text: name }),
        tag ? h('span.tag', { text: tag }) : null,
        summary ? h('p.hint.variant-summary', { text: summary }) : null,
        d.modules[id] && effect ? h('p.variant-effect', { text: effect }) : null),
      link ? h('a.hint.variant-link', { href: link, text: 'Rules' }) : null),
    d.modules[id] ? variantOptions(app, id, ways) : null);

  return h('section.panel', { id: 'panel-advancedRules', dataset: { panel: 'advancedRules' } },
    h('h2.panel-title', h('span', { text: 'Rules of play' })),
    h('div.panel-body',
      h('p.hint', { text: `Optional rules that change how a character plays at the table. ${on ? `${on} in play for this character.` : 'None in play.'} Switch one on and the sheet follows it; each links to its full rules in the Reference.` }),
      own.length
        ? h('details.variant-group', { open: own.some((id) => d.modules[id]) },
          h('summary', h('span.variant-group-name', { text: app.rules.ruleset.shortName }), h('span.hint', { text: `${own.length} rules` })),
          h('ul.variant-list', own.map((id) => item(id, MODULE_LABELS[id], null, app.rules.ruleset.variantNotes?.[id] || '', null, null))))
        : null,
      catalog.categories.map(([key, label]) => {
        const list = listed.filter((v) => v.category === key);
        if (!list.length) return null;
        const active = list.filter((v) => d.modules[v.id]).length;
        return h('details.variant-group', { open: active > 0 },
          h('summary', h('span.variant-group-name', { text: label }), h('span.hint', { text: active ? `${active} on` : `${list.length} rules` })),
          h('ul.variant-list', list.map((v) => item(v.id, v.name, SHEET_LABEL[v.sheet] || v.sheet, v.summary, v.onSheet, referenceHref('variants', v.name)))));
      })));
}

/** The choices a variant needs, once it is on. */
function variantOptions(app, id, ways) {
  const c = app.character;
  const d = app.derived;
  const state = stateOf(app);
  const classes = [...new Set((d.summary.sides || []).flatMap((s) => s.classes.map((k) => k.name)))];
  const change = (fn, reshape = true) => (ev) => {
    fn(ev);
    if (reshape) ways.reopen(); else app.recompute();
  };
  const choose = (label, value, options, onPick) => labelled(label, h('select.field', { onchange: change((ev) => onPick(ev.target.value)) },
    options.map(([v, t]) => h('option', { value: v, text: t, selected: String(value ?? '') === v }))));

  switch (id) {
    case 'massiveDamage': {
      const m = state.massiveDamage || {};
      return h('div.row.variant-options',
        choose('Threshold', m.threshold || 'standard', [['standard', '50 (standard)'], ['con', 'Constitution score'], ['hd', '25 + 2 per Hit Die'], ['size', '50, ±10 per size from Medium']],
          (value) => { state.massiveDamage = { ...m, threshold: value }; }),
        choose('A failed save', m.result || 'death', [['death', 'kills (standard)'], ['dying', 'leaves you at -1 and dying'], ['nearDeath', 'leaves you at -8 and dying']],
          (value) => { state.massiveDamage = { ...(state.massiveDamage || {}), result: value }; }));
    }
    case 'magicRating':
      return h('div.row.variant-options', h('label.check', h('input', {
        type: 'checkbox',
        checked: Boolean(state.magicRatingSeparate),
        onchange: change((ev) => { state.magicRatingSeparate = ev.target.checked; }),
      }), h('span', { text: 'Keep arcane and divine ratings apart (the optional rule)' })));
    case 'bloodlines': {
      const b = state.bloodline || {};
      const set = (key, value) => { state.bloodline = { ...(state.bloodline || {}), [key]: value }; };
      return h('div.row.variant-options',
        labelled('Source', h('input.field', { value: b.source || '', placeholder: 'Celestial, Dragon (red)...', onchange: change((ev) => set('source', ev.target.value), false) })),
        choose('Strength', b.strength || '', [['', '- choose -'], ['minor', 'Minor'], ['intermediate', 'Intermediate'], ['major', 'Major']], (value) => set('strength', value)),
        labelled('Bloodline levels taken', h('input.field', { type: 'number', min: 0, max: 3, value: b.levels ?? 0, style: 'width:4rem', onchange: change((ev) => set('levels', Number(ev.target.value) || 0)) })));
    }
    case 'honor':
      return h('div.row.variant-options', choose('Ancestry', state.honor?.ancestry || 'none',
        [['none', 'Neither'], ['hero', 'A hero among your ancestors (+2)'], ['failure', 'A failure among your ancestors (-2)']],
        (value) => { state.honor = { ...(state.honor || {}), ancestry: value }; }));
    default:
      return null;
  }
}

/* ==========================================================================
   The creator's Class step: choices a class makes
   ========================================================================== */

/**
 * What the classes chosen ask for beyond a name: a generic class's good saves
 * and class skills, a paragon's skills, a druid's aspect of nature in place of
 * wild shape, and what a prestige class needs first. Hidden while there is
 * nothing to choose, so it can appear the moment a class that asks is picked.
 */
export function classChoicesPanel(app) {
  const c = app.character;
  const d = app.derived;
  const state = stateOf(app);
  const taken = [...new Map((d.summary.sides || []).flatMap((s) => s.classes).map((k) => [k.name, k])).values()];
  const rebuild = () => { app.recompute(); app.rebuildPanel('classChoices'); app.rebuildPanel('skills'); };
  const blocks = [];

  for (const k of taken) {
    const def = k.def;
    const shown = def.displayName || k.name;
    if (def.classVariant?.note) blocks.push(h('div.variant-class', h('span.variant-name', { text: shown }), h('p.hint', { text: def.classVariant.note })));
    if (def.generic || def.chooseSkills) {
      const name = k.name;
      const skillNames = app.rules.skills.skills.map((s) => s.name);
      blocks.push(h('div.variant-class',
        h('span.variant-name', { text: shown }),
        def.generic ? h('div.row',
          h('span.label', { text: `${def.generic.goodSaves} good save${def.generic.goodSaves === 1 ? '' : 's'}` }),
          ['fort', 'ref', 'will'].map((save) => {
            const chosen = state.genericSaves?.[name] || [];
            return h('label.check', h('input', {
              type: 'checkbox',
              checked: def.saves[save] === 'good',
              dataset: { unbound: '', lock: 'classes' },
              onchange: (ev) => {
                const next = new Set(chosen.length ? chosen : Object.keys(def.saves).filter((x) => def.saves[x] === 'good'));
                if (ev.target.checked) next.add(save); else next.delete(save);
                state.genericSaves = { ...(state.genericSaves || {}), [name]: [...next].slice(-def.generic.goodSaves) };
                rebuild();
              },
            }), h('span', { text: save[0].toUpperCase() + save.slice(1) }));
          }),
          def.generic.spellcaster ? labelled('Casts with', h('select.field', {
            dataset: { unbound: '', lock: 'classes' },
            onchange: (ev) => { state.casterAbility = { ...(state.casterAbility || {}), [name]: ev.target.value }; rebuild(); },
          }, [['int', 'Intelligence (arcane)'], ['cha', 'Charisma (arcane)'], ['wis', 'Wisdom (divine)']].map(([v, t]) => h('option', { value: v, text: t, selected: (state.casterAbility?.[name] || 'cha') === v })))) : null)
          : null,
        def.chooseSkills ? h('details.variant-skills', { open: (state.chosenSkills?.[name] || []).length < def.chooseSkills },
          h('summary', { text: `Class skills: ${(state.chosenSkills?.[name] || []).length} of ${def.chooseSkills} chosen` }),
          h('div.variant-skill-grid', skillNames.map((skill) => {
            const chosen = state.chosenSkills?.[name] || [];
            return h('label.check', h('input', {
              type: 'checkbox',
              checked: chosen.includes(skill),
              disabled: !chosen.includes(skill) && chosen.length >= def.chooseSkills,
              dataset: { unbound: '', lock: 'classes' },
              onchange: (ev) => {
                const next = new Set(chosen);
                if (ev.target.checked) next.add(skill); else next.delete(skill);
                state.chosenSkills = { ...(state.chosenSkills || {}), [name]: [...next] };
                rebuild();
              },
            }), h('span', { text: skill }));
          })))
          : null));
    }
    if (def.requires) blocks.push(h('div.variant-class', h('span.variant-name', { text: shown }), h('p.hint', { text: `A prestige class. Before its first level: ${def.requires}` }), def.note ? h('p.hint', { text: def.note }) : null));

    // A class feature traded for a variant's. A specialist wizard's are chosen with the school, on the Spells step.
    if (k.name !== 'Wizard') {
      const groups = featureVariantOptions(k.name, app.rules, d.modules);
      for (const [replaces, list] of Object.entries(groups)) {
        const picked = state.featureVariants?.[k.name]?.[replaces] || '';
        blocks.push(h('div.variant-class',
          h('span.variant-name', { text: `${shown}: ${REPLACED_FEATURES[replaces] || replaces}` }),
          labelled('Take', h('select.field', {
            dataset: { unbound: '', lock: 'classes' },
            onchange: (ev) => {
              const mine = { ...(state.featureVariants?.[k.name] || {}), [replaces]: ev.target.value || undefined };
              state.featureVariants = { ...(state.featureVariants || {}), [k.name]: mine };
              rebuild();
              app.rebuildPanel('abilitiesList');
            },
          }, [['', `${REPLACED_FEATURES[replaces] || replaces} (standard)`], ...list.map((o) => [o.key, o.name])].map(([v, t]) => h('option', { value: v, text: t, selected: picked === v })))),
          picked ? h('p.hint', { text: list.find((o) => o.key === picked)?.note || '' }) : null));
      }
    }
  }

  return h('section.panel', { id: 'panel-classChoices', dataset: { panel: 'classChoices' }, hidden: !blocks.length },
    h('h2.panel-title', h('span', { text: 'Class choices' })),
    h('div.panel-body.variant-options', blocks));
}

/* ==========================================================================
   The sheet's Rules page: what this character plays by
   ========================================================================== */

/**
 * The rules in force, to read. Rules are chosen in the creator - how the
 * character is built in Concept, how it plays in Advanced - so the page says
 * which, and links there.
 *
 * @param ways  from app.js: { creatorHref(step), campaign }
 */
export function rulesInPlayPanel(app, ways) {
  const d = app.derived;
  const rs = app.rules.ruleset;
  const catalog = new Map((app.rules.variants?.variants || []).map((v) => [v.id, v]));
  const nameOf = (id) => catalog.get(id)?.name || MODULE_LABELS[id] || id;
  const available = (id) => moduleState(app.rules, app.character, id, app.overrides).available;
  const building = BUILD_MODULES.filter((id) => available(id) && d.modules[id]);
  const playing = PLAY_MODULES.filter((id) => available(id) && d.modules[id]);
  const withheld = CONTENT_MODULES.filter((id) => available(id) && !d.modules[id]);
  const others = MODULES.filter((id) => !available(id));

  const list = (ids, empty) => (ids.length
    ? h('ul.rules-in-play', ids.map((id) => h('li',
      h('span.variant-name', { text: nameOf(id) }),
      catalog.get(id)?.onSheet ? h('span.hint', { text: ` ${catalog.get(id).onSheet}` }) : null)))
    : h('p.hint', { text: empty }));

  return h('section.panel', { id: 'panel-rulesInPlay', dataset: { panel: 'rulesInPlay' } },
    h('h2.panel-title', h('span', { text: 'Rules this character plays by' })),
    h('div.panel-body',
      h('p', {},
        h('strong', { text: rs.name }),
        ways.campaign ? [' - set by ', h('a', { href: `#/campaign/${ways.campaign.id}`, text: ways.campaign.name })] : null,
        '. ',
        h('span.hint', { text: rs.tagline || '' })),
      h('h3', { text: 'Building' }),
      list(building, 'The standard rules: one class a level, skill points, no traits or flaws.'),
      h('h3', { text: 'In play' }),
      list(playing, 'No optional rules of play.'),
      withheld.length ? [h('h3', { text: 'Not offered at this table' }), list(withheld, '')] : null,
      h('p.hint', { text: `Races, classes and feats from the variant rules - aquatic dwarves, bardic sages, spelltouched feats and the rest - are in the creator's lists${withheld.length ? ', except those above' : ''}.${others.length ? '' : ''}` }),
      h('div.row',
        h('a.btn.subtle', { href: ways.creatorHref('concept') }, 'Change how it is built'),
        h('a.btn.subtle', { href: ways.creatorHref('advanced') }, 'Change the rules of play'))));
}

/* ==========================================================================
   The Combat page
   ========================================================================== */

export function variantCombatPanel(app) {
  const d = app.derived;
  const m = d.modules;
  const v = d.variants || {};
  const health = v.health || {};
  const state = stateOf(app);
  const blocks = [];
  const counter = (label, entry, key, unit = '') => h('div.variant-counter',
    h('span.label', { text: label }),
    h('span.variant-counter-value', { text: `${entry.current} / ${entry.max}${unit}` }),
    button('−', () => { state[key] = Math.max(0, (Number(state[key]) || 0) + 1); app.recompute(); app.rebuildPanel('variantCombat'); }, { subtle: true, title: 'Take one' }),
    button('+', () => { state[key] = Math.max(0, (Number(state[key]) || 0) - 1); app.recompute(); app.rebuildPanel('variantCombat'); }, { subtle: true, title: 'Heal one' }),
    h('input.field.narrow', {
      type: 'number',
      min: 0,
      value: state[key] || 0,
      title: 'Taken',
      onchange: (ev) => { state[key] = Math.max(0, Number(ev.target.value) || 0); app.recompute(); app.rebuildPanel('variantCombat'); },
    }));

  if (m.defenseBonus) blocks.push(h('div.variant-block', h('h3', 'Defense bonus'), row(total('Defense bonus', 'variants.defenseBonus', { format: 'signed' }), h('p.hint', { text: 'Used in place of your armor bonus when higher, and added to touch AC. Shown in the AC above.' }))));
  if (m.armorAsDR) blocks.push(h('div.variant-block', h('h3', 'Armor as damage reduction'), row(
    total('Damage reduction', 'variants.damageReduction'),
    total('Armor enhancement', 'variants.armorEnhancement', { title: 'Set on the Equipment page. A magic armor’s enhancement adds to AC but not to its damage reduction.' }),
    h('p.hint', { text: 'Half of your armor’s bonus before enhancement, and a fifth of natural armor, become DR /-, and come off your AC.' }))));
  if (m.damageConversion && health.damageConversion) blocks.push(h('div.variant-block', h('h3', 'Damage conversion'), h('p', { text: `Your armor converts up to ${health.damageConversion.perHit} lethal damage a hit into nonlethal damage, and ignores ${health.damageConversion.ignoresNonlethal} nonlethal damage a hit.` })));
  if (health.vitality) blocks.push(h('div.variant-block', h('h3', 'Vitality and wound points'),
    counter('Vitality', health.vitality, 'vitalityTaken'),
    counter('Wounds', health.wounds, 'woundsTaken'),
    h('p.hint', { text: 'Hit points above are your vitality. Critical hits and damage past vitality come off wounds, equal to Constitution. The first wound damage fatigues you; each wounding hit calls for a Fortitude save (DC 5 + wounds lost) or be stunned.' })));
  if (health.reserve) blocks.push(h('div.variant-block', h('h3', 'Reserve points'), counter('Reserve', health.reserve, 'reserveUsed'), h('p.hint', { text: 'Out of combat, reserve points turn into hit points at one a minute.' })));
  if (health.injury) blocks.push(h('div.variant-block', h('h3', 'Injury'),
    row(
      h('div.variant-counter', h('span.label', { text: 'Hits' }), h('span.variant-counter-value', { text: String(health.injury.hits) }),
        button('+', () => { state.injuryHits = (Number(state.injuryHits) || 0) + 1; app.recompute(); app.rebuildPanel('variantCombat'); }, { subtle: true }),
        button('−', () => { state.injuryHits = Math.max(0, (Number(state.injuryHits) || 0) - 1); app.recompute(); app.rebuildPanel('variantCombat'); }, { subtle: true })),
      labelled('Condition', h('select.field', { onchange: (ev) => { state.injuryCondition = ev.target.value; app.recompute(); } },
        ['unhurt', 'disabled', 'staggered', 'dying', 'stable', 'unconscious'].map((cond) => h('option', { value: cond, text: cond, selected: health.injury.condition === cond })))),
      h('p', { text: `Save to resist injury: Fort ${health.injury.saveWithHits >= 0 ? '+' : ''}${health.injury.saveWithHits} against DC 15 + damage ÷ 5 (rounded up). Failing by 10 or more disables you.` }))));
  if (health.massiveDamage) {
    const results = { death: 'death', dying: '-1 hit points and dying', nearDeath: '-8 hit points and dying' };
    blocks.push(h('div.variant-block', h('h3', 'Massive damage'), h('p', { text: `A single hit of ${health.massiveDamage.threshold} or more calls for a DC 15 Fortitude save; failing means ${results[health.massiveDamage.result]}. The threshold is chosen in the creator’s Advanced step.` })));
  }
  if (health.deathAndDying) blocks.push(h('div.variant-block', h('h3', 'Death and dying'), h('p', { text: 'Hit points stop at 0. Reaching 0 calls for a Fortitude save, DC 10 + 2 per 10 points of damage from the hit: success leaves you disabled, failure dying, failure by 10 or more dead.' })));
  if (v.playersRoll) blocks.push(h('div.variant-block', h('h3', 'Players roll all the dice'), row(
    h('div.total', h('span.label', { text: 'Defense check' }), h('span.out', { text: `d20 ${v.playersRoll.defense >= 0 ? '+' : ''}${v.playersRoll.defense}` })),
    h('div.total', h('span.label', { text: 'Touch' }), h('span.out', { text: `d20 ${v.playersRoll.touch >= 0 ? '+' : ''}${v.playersRoll.touch}` })),
    h('div.total', h('span.label', { text: 'Flat-footed' }), h('span.out', { text: `d20 ${v.playersRoll.flatFooted >= 0 ? '+' : ''}${v.playersRoll.flatFooted}` })),
    v.playersRoll.spellResistance !== null ? h('div.total', h('span.label', { text: 'Spell resistance check' }), h('span.out', { text: `d20 +${v.playersRoll.spellResistance}` })) : null),
    h('p.hint', { text: 'You roll against the attacker’s score of 11 + attack bonus. Your spells’ magic check is d20 + spell level + your casting modifier against 11 + the target’s save.' })));
  if (m.bellCurve) {
    const threats = app.rules.variants?.tables?.bellCurveThreats || [];
    blocks.push(h('div.variant-block', h('h3', 'Bell curve rolls'), h('p', { text: 'Roll 3d6 wherever a d20 is rolled. Threat ranges change:' }),
      h('p.hint', { text: threats.slice(1).map((r) => `${r[0]} becomes ${r[1]}`).join('; ') })));
  }
  for (const [id, text] of [
    ['variableModifiers', 'Some modifiers are rolled each time instead of fixed; see the Rules link for which.'],
    ['hexGrid', 'The battle map is hexes: movement, reach and areas follow the hex rules.'],
    ['combatFacing', 'Facing matters: flank and rear attacks, and turning to face, follow the facing rules.'],
  ]) {
    if (m[id]) blocks.push(h('div.variant-block', h('h3', MODULE_LABELS[id]), h('p.hint', {}, text, ' ', h('a', { href: referenceHref('variants', app.rules.variants.variants.find((x) => x.id === id).name), text: 'Rules' }))));
  }
  if (!blocks.length) return null;
  return h('section.panel', { id: 'panel-variantCombat', dataset: { panel: 'variantCombat' } },
    h('h2.panel-title', h('span', { text: 'Variant rules in combat' })),
    h('div.panel-body', blocks));
}

/* ==========================================================================
   The Feats page: scores and tracks
   ========================================================================== */

export function variantTracksPanel(app) {
  const d = app.derived;
  const s = d.variants?.scores || {};
  const health = d.variants?.health || {};
  const state = stateOf(app);
  const blocks = [];
  const rebuild = () => { app.recompute(); app.rebuildPanel('variantTracks'); };
  const number = (key, value, title) => h('input.field.narrow', { type: 'number', value: value ?? '', title, onchange: (ev) => { key(Number(ev.target.value) || 0); rebuild(); } });

  if (s.craftPoints) blocks.push(h('div.variant-block', h('h3', 'Craft points'), row(
    h('div.total', h('span.label', { text: 'Total' }), h('span.out.big', { text: s.craftPoints.total.toLocaleString() })),
    h('div.total', h('span.label', { text: 'Left' }), h('span.out.big', { text: s.craftPoints.remaining.toLocaleString() })),
    labelled('Spent', number((n) => { state.craftPointsSpent = n; }, s.craftPoints.spent, 'Craft points spent')),
    h('p.hint', { text: `${s.craftPoints.fromLevel.toLocaleString()} from character level, ${s.craftPoints.fromFeats.toLocaleString()} from item creation feats.` }))));

  if (s.contacts) {
    const list = state.contacts = state.contacts || [];
    blocks.push(h('div.variant-block', h('h3', `Contacts (${s.contacts.count} of ${s.contacts.allowed})`),
      h('ul.variant-contacts', list.map((contact, i) => h('li.row',
        h('input.field.grow', { value: contact.name || '', placeholder: 'Name', onchange: (ev) => { contact.name = ev.target.value; app.recompute(); } }),
        h('select.field', { onchange: (ev) => { contact.type = ev.target.value; app.recompute(); } },
          [['', 'type'], ['information', 'Information'], ['influence', 'Influence'], ['skill', 'Skill']].map(([v, t]) => h('option', { value: v, text: t, selected: (contact.type || '') === v }))),
        h('input.field.grow', { value: contact.notes || '', placeholder: 'Who they are, what they do', onchange: (ev) => { contact.notes = ev.target.value; app.recompute(); } }),
        button('x', () => { list.splice(i, 1); rebuild(); }, { subtle: true, danger: true })))),
      button('Add a contact', () => { list.push({ name: '', type: '' }); rebuild(); }, { subtle: true })));
  }

  if (s.reputation) blocks.push(h('div.variant-block', h('h3', 'Reputation'), row(
    h('div.total', h('span.label', { text: 'Reputation' }), h('span.out.big', { text: `${s.reputation.total >= 0 ? '+' : ''}${s.reputation.total}` })),
    h('p.hint', { text: `+${s.reputation.fromClasses} from class levels${s.reputation.fromFeats ? `, ${s.reputation.fromFeats > 0 ? '+' : ''}${s.reputation.fromFeats} from Renown or Low Profile` : ''}.` }))));

  if (s.honor) blocks.push(h('div.variant-block', h('h3', 'Honor'), row(
    h('div.total', h('span.label', { text: 'Starting' }), h('span.out', { text: s.honor.starting === null ? '-' : String(s.honor.starting) })),
    labelled('Current', number((n) => { state.honor = { ...(state.honor || {}), current: n }; }, s.honor.current, 'Current honor')),
    h('p.hint', { text: 'Starting honor is set by alignment and ancestry (in the creator’s Advanced step).' }))));

  if (s.sanity) blocks.push(h('div.variant-block', h('h3', 'Sanity'), row(
    h('div.total', h('span.label', { text: 'Starting' }), h('span.out', { text: String(s.sanity.starting) })),
    h('div.total', h('span.label', { text: 'Maximum' }), h('span.out', { text: String(s.sanity.maximum) })),
    labelled('Current', number((n) => { state.sanity = { ...(state.sanity || {}), current: n }; }, s.sanity.current, 'Current Sanity')),
    h('p.hint', { text: 'Starting Sanity is Wisdom x 5; the maximum is 99 less your ranks in Knowledge (forbidden lore).' }))));

  if (s.bloodline && s.bloodline.strength) blocks.push(h('div.variant-block', h('h3', `Bloodline: ${s.bloodline.source || 'unnamed'} (${s.bloodline.strength})`),
    h('p', { text: `${s.bloodline.taken} bloodline level${s.bloodline.taken === 1 ? '' : 's'} taken; ${s.bloodline.required} due by now.${s.bloodline.nextBefore ? ` The next is due before character level ${s.bloodline.nextBefore}.` : ''}` })));

  if (s.levelAdjustment && s.levelAdjustment.starting) {
    const la = s.levelAdjustment;
    blocks.push(h('div.variant-block', h('h3', 'Level adjustment'), row(
      h('div.total', h('span.label', { text: 'Now' }), h('span.out.big', { text: `+${la.current}` })),
      labelled('Reductions paid for', h('select.field', { onchange: (ev) => { state.laReductions = Number(ev.target.value); rebuild(); } },
        Array.from({ length: la.eligible + 1 }, (_, i) => h('option', { value: String(i), text: String(i), selected: la.taken === i })))),
      h('p.hint', { text: `From +${la.starting}. ${la.nextAt
        ? `Next eligible at class level ${la.nextAt}, for ${((d.summary.ecl - 1) * 1000).toLocaleString()} XP.`
        : la.eligible > la.taken ? `Eligible now, for ${((d.summary.ecl - 1) * 1000).toLocaleString()} XP.` : 'No further reductions until epic levels.'}` }))));
  }

  if (health.taint) blocks.push(h('div.variant-block', h('h3', 'Taint'), row(
    labelled('Taint score', number((n) => { state.taint = Math.max(0, n); }, health.taint.score, 'Taint score')),
    h('div.total', h('span.label', { text: 'Tainted' }), h('span.out', { text: health.taint.severity })),
    h('p.hint', { text: `Taken from Constitution and Wisdom (shown in the ability scores). ${health.taint.canEmbrace ? 'At 10 or more, taint can be embraced.' : ''}` }))));

  if (!blocks.length) return null;
  return h('section.panel', { id: 'panel-variantTracks', dataset: { panel: 'variantTracks' } },
    h('h2.panel-title', h('span', { text: 'Variant rules: scores and tracks' })),
    h('div.panel-body', blocks));
}
