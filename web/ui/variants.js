// The SRD's variant rules on the sheet.
//
//   variantRulesPanel    the Rules page: every variant, by category, to switch on
//                        or off (or shown as set by the campaign), with the
//                        choices a variant needs once it is on
//   variantCombatPanel   the Combat page: what adventuring variants change -
//                        defense bonus, damage reduction, vitality and wounds,
//                        reserve points, injury, massive damage, dying rules
//   variantTracksPanel   the Feats page: craft points, contacts, reputation,
//                        honor, sanity, bloodline, level adjustment, taint
//
// The numbers are engine/variants.js's; the catalog - names, what each does, what
// the sheet does about it - is data/variants.json.

import { h, button, field, labelled, row, total } from './dom.js';
import { moduleState, MODULE_LABELS, CLASS_VARIANTS, GENERIC_CLASSES } from '../engine/index.js';
import { referenceHref } from '../reference.js';

const SHEET_LABEL = { math: 'changes numbers', track: 'adds a track', table: 'rule of play' };

/** The character's state for variants, made if missing. */
const stateOf = (app) => (app.character.variants = app.character.variants || {});

/* ==========================================================================
   The Rules page: every variant
   ========================================================================== */

/**
 * @param ways  from app.js: { reopen() } - draw the page again after a change that reshapes it
 */
export function variantRulesPanel(app, ways) {
  const catalog = app.rules.variants;
  if (!catalog) return null;
  const c = app.character;
  const on = catalog.variants.filter((v) => app.derived.modules[v.id]);

  const toggle = (v) => {
    const s = moduleState(app.rules, c, v.id, app.overrides);
    if (!s.available) return h('span.hint', { text: 'not in this ruleset' });
    if (!s.choosable) return h(`span.variant-locked${s.on ? '.is-on' : ''}`, { title: s.lockedBy === 'campaign' || s.lockedBy === 'gm' ? 'Set by the campaign.' : 'Set by the ruleset.' }, s.on ? 'on' : 'off');
    return h('label.switch', { title: s.on ? 'Switch off' : 'Switch on' },
      h('input', {
        type: 'checkbox',
        checked: s.on,
        onchange: (ev) => {
          c.options = { ...c.options, [v.id]: ev.target.checked };
          ways.reopen();
        },
      }),
      h('span.switch-track', { 'aria-hidden': 'true' }),
      h('span.sr-only', { text: v.name }));
  };

  return h('section.panel', { id: 'panel-variantRules', dataset: { panel: 'variantRules' } },
    h('h2.panel-title', h('span', { text: 'SRD variant rules' })),
    h('div.panel-body',
      h('p.hint', { text: `The optional rules from Unearthed Arcana in the System Reference Document. ${on.length ? `${on.length} in play for this character.` : 'None in play.'} Switch one on and the sheet follows it; each opens to its full rules in the Reference.` }),
      catalog.categories.map(([key, label]) => {
        const list = catalog.variants.filter((v) => v.category === key);
        const active = list.filter((v) => app.derived.modules[v.id]).length;
        return h('details.variant-group', { open: active > 0 },
          h('summary', h('span.variant-group-name', { text: label }), h('span.hint', { text: active ? `${active} on` : `${list.length} rules` })),
          h('ul.variant-list', list.map((v) => h(`li.variant-item${app.derived.modules[v.id] ? '.is-on' : ''}`,
            h('div.variant-head',
              toggle(v),
              h('div.variant-text',
                h('span.variant-name', { text: v.name }),
                h('span.tag', { text: SHEET_LABEL[v.sheet] || v.sheet }),
                h('p.hint.variant-summary', { text: v.summary }),
                app.derived.modules[v.id] ? h('p.variant-effect', { text: v.onSheet }) : null),
              h('a.hint.variant-link', { href: referenceHref('variants', v.name), text: 'Rules' })),
            app.derived.modules[v.id] ? variantOptions(app, v.id, ways) : null))));
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
    case 'classVariants': {
      const eligible = classes.filter((name) => CLASS_VARIANTS[name]);
      if (!eligible.length) return h('p.hint.variant-options', { text: 'None of this character’s classes has a variant. Barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, sorcerer and wizard do.' });
      return h('div.row.variant-options', eligible.map((name) => choose(name, state.classVariant?.[name] || '',
        [['', `Standard ${name.toLowerCase()}`], ...Object.entries(CLASS_VARIANTS[name]).map(([k, v]) => [k, v.name])],
        (value) => { state.classVariant = { ...(state.classVariant || {}), [name]: value || undefined }; })));
    }
    case 'genericClasses':
    case 'paragonClasses': {
      const here = classes.map((name) => [name, d.index.classByName.get(name)]).filter(([, def]) => def && (id === 'genericClasses' ? def.generic : def.paragon));
      if (!here.length) {
        return h('p.hint.variant-options', { text: id === 'genericClasses'
          ? 'Expert (generic), Spellcaster (generic) and Warrior (generic) are now on the class list.'
          : 'The paragon classes - dwarf paragon, elf paragon and the rest - are now on the class list.' });
      }
      const skillNames = app.rules.skills.skills.map((s) => s.name);
      return h('div.variant-options', here.map(([name, def]) => h('div.variant-class',
        h('span.variant-name', { text: name }),
        def.generic ? h('div.row',
          h('span.label', { text: `${def.generic.goodSaves} good save${def.generic.goodSaves === 1 ? '' : 's'}` }),
          ['fort', 'ref', 'will'].map((save) => {
            const chosen = state.genericSaves?.[name] || [];
            return h('label.check', h('input', {
              type: 'checkbox',
              checked: def.saves[save] === 'good',
              onchange: change((ev) => {
                const next = new Set(chosen.length ? chosen : Object.keys(def.saves).filter((k) => def.saves[k] === 'good'));
                if (ev.target.checked) next.add(save); else next.delete(save);
                state.genericSaves = { ...(state.genericSaves || {}), [name]: [...next].slice(-def.generic.goodSaves) };
              }),
            }), h('span', { text: save[0].toUpperCase() + save.slice(1) }));
          }),
          def.generic.spellcaster ? choose('Casts with', state.casterAbility?.[name] || 'cha', [['int', 'Intelligence (arcane)'], ['cha', 'Charisma (arcane)'], ['wis', 'Wisdom (divine)']],
            (value) => { state.casterAbility = { ...(state.casterAbility || {}), [name]: value }; }) : null)
          : null,
        def.chooseSkills ? h('details.variant-skills',
          h('summary', { text: `Class skills: ${(state.chosenSkills?.[name] || []).length} of ${def.chooseSkills} chosen` }),
          h('div.variant-skill-grid', skillNames.map((skill) => {
            const chosen = state.chosenSkills?.[name] || [];
            return h('label.check', h('input', {
              type: 'checkbox',
              checked: chosen.includes(skill),
              disabled: !chosen.includes(skill) && chosen.length >= def.chooseSkills,
              onchange: change((ev) => {
                const next = new Set(chosen);
                if (ev.target.checked) next.add(skill); else next.delete(skill);
                state.chosenSkills = { ...(state.chosenSkills || {}), [name]: [...next] };
              }),
            }), h('span', { text: skill }));
          })))
          : null)));
    }
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
    case 'reducingLA': {
      const la = d.variants.scores.levelAdjustment;
      if (!la || !la.starting) return h('p.hint.variant-options', { text: 'This character has no level adjustment to reduce.' });
      return h('div.row.variant-options',
        labelled('Reductions paid for', h('select.field', { onchange: change((ev) => { state.laReductions = Number(ev.target.value); }) },
          Array.from({ length: la.eligible + 1 }, (_, i) => h('option', { value: String(i), text: String(i), selected: la.taken === i })))),
        h('span.hint', { text: la.nextAt
          ? `Next eligible at class level ${la.nextAt}, for ${((d.summary.ecl - 1) * 1000).toLocaleString()} XP.`
          : la.eligible > la.taken ? `Eligible now, for ${((d.summary.ecl - 1) * 1000).toLocaleString()} XP.` : 'No further reductions until epic levels.' }));
    }
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
    blocks.push(h('div.variant-block', h('h3', 'Massive damage'), h('p', { text: `A single hit of ${health.massiveDamage.threshold} or more calls for a DC 15 Fortitude save; failing means ${results[health.massiveDamage.result]}. Choose the threshold on the Rules page.` })));
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
    h('p.hint', { text: 'Starting honor is set by alignment and ancestry (on the Rules page).' }))));

  if (s.sanity) blocks.push(h('div.variant-block', h('h3', 'Sanity'), row(
    h('div.total', h('span.label', { text: 'Starting' }), h('span.out', { text: String(s.sanity.starting) })),
    h('div.total', h('span.label', { text: 'Maximum' }), h('span.out', { text: String(s.sanity.maximum) })),
    labelled('Current', number((n) => { state.sanity = { ...(state.sanity || {}), current: n }; }, s.sanity.current, 'Current Sanity')),
    h('p.hint', { text: 'Starting Sanity is Wisdom x 5; the maximum is 99 less your ranks in Knowledge (forbidden lore).' }))));

  if (s.bloodline && s.bloodline.strength) blocks.push(h('div.variant-block', h('h3', `Bloodline: ${s.bloodline.source || 'unnamed'} (${s.bloodline.strength})`),
    h('p', { text: `${s.bloodline.taken} bloodline level${s.bloodline.taken === 1 ? '' : 's'} taken; ${s.bloodline.required} due by now.${s.bloodline.nextBefore ? ` The next is due before character level ${s.bloodline.nextBefore}.` : ''}` })));

  if (s.levelAdjustment && s.levelAdjustment.starting) blocks.push(h('div.variant-block', h('h3', 'Level adjustment'),
    h('p', { text: `+${s.levelAdjustment.current} now (from +${s.levelAdjustment.starting}); ${s.levelAdjustment.taken} reduction${s.levelAdjustment.taken === 1 ? '' : 's'} paid for.` })));

  if (health.taint) blocks.push(h('div.variant-block', h('h3', 'Taint'), row(
    labelled('Taint score', number((n) => { state.taint = Math.max(0, n); }, health.taint.score, 'Taint score')),
    h('div.total', h('span.label', { text: 'Tainted' }), h('span.out', { text: health.taint.severity })),
    h('p.hint', { text: `Taken from Constitution and Wisdom (shown in the ability scores). ${health.taint.canEmbrace ? 'At 10 or more, taint can be embraced.' : ''}` }))));

  if (!blocks.length) return null;
  return h('section.panel', { id: 'panel-variantTracks', dataset: { panel: 'variantTracks' } },
    h('h2.panel-title', h('span', { text: 'Variant rules: scores and tracks' })),
    h('div.panel-body', blocks));
}
