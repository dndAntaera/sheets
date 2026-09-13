// The sheet itself: every panel, in the order a 3.5 sheet is usually read.
//
// Each builder takes the app - its character, rules, and the derived sheet
// computed before any panel is drawn - and returns a panel, or null when the
// ruleset in force has nothing for that panel to show. Taint does not appear on
// an SRD character as an empty box; it does not appear.
//
// Inputs are bound by path and built once. Anything the sheet works out for
// itself is an `out()` naming a path into the derived sheet, so adding a
// calculation is a one-line change here and a real change in the engine, never
// a formula buried in the interface.

import {
  h, field, checkbox, select, textarea, labelled, out, total, panel, row,
  button, refill, frag,
} from './dom.js';
import { effectsEditor } from './effects-editor.js';
import { ABILITIES, ABILITY_NAMES, abilityIncreaseLevels } from '../engine/abilities.js';
import { describeTarget } from '../engine/effects.js';
import { CONTENT_TYPES, CONTENT_KINDS, unusedContent } from '../engine/library.js';
import { loadReference, referenceNow, lookUp } from '../reference.js';
import { referenceCard } from './reference.js';

const SAVES = [['fort', 'Fortitude'], ['ref', 'Reflex'], ['will', 'Will']];
const METHOD_LABELS = {
  pointBuy: 'point buy',
  rolled: 'rolled',
  array: 'standard array',
  manual: 'entered by hand',
};

const skillNamesFor = (app) => app.derived.index.skills.map((s) => s.name);

/* ==========================================================================
   Identity, race and templates
   ========================================================================== */

export function identityPanel(app) {
  const c = app.character;
  const d = app.derived;
  const rs = app.rules.ruleset;
  const sizes = app.rules.core.sizes.map((s) => s.name);
  const known = d.race.known;

  const raceFacts = known
    ? h('div.race-facts',
      total('Size', 'race.size'),
      total('Speed', 'speed'),
      total('Level adj.', 'race.la', { format: 'signed' }),
      total('Favored class', 'race.favoredClass'),
      h('p.hint.race-traits', { text: d.race.traits }))
    : row(
      labelled('Size', select('race.size', c.race?.size, sizes, { className: 'narrow' })),
      labelled('Speed', field('race.speed', c.race?.speed, { type: 'int', width: '4rem' })),
      labelled('Racial HD', field('race.racialHD', c.race?.racialHD, { type: 'int', width: '4rem', title: 'Hit dice from the race itself, before any class levels.' })),
      labelled('Level adj.', field('race.la', c.race?.la, { type: 'int', width: '4rem' })),
      labelled('Extra skill points', field('race.skillPointsPerLevel', c.race?.skillPointsPerLevel, { type: 'int', width: '4rem', title: 'Per level, before the first-level multiplier.' })),
      h('span.hint', { text: 'A race the sheet does not know. Enter its numbers here, or write it up under Content so its effects count too.' }));

  return panel('identity', 'The character',
    row(
      labelled('Character', field('name', c.name, { placeholder: 'Name', className: 'grow' })),
      labelled('Player', field('player', c.player, { placeholder: 'Who plays them' })),
      labelled('Alignment', field('concept.alignment', c.concept?.alignment, { placeholder: 'NG', width: '5rem' })),
      labelled('Deity', field('concept.deity', c.concept?.deity, { placeholder: 'None' })),
    ),
    row(
      labelled('Race', field('race.name', c.race?.name, { list: 'race-names', placeholder: 'Choose or type a race', className: 'grow' })),
      d.levelAdjustment.capped ? labelled('Level adj. allowed', out('levelAdjustment.allowed', { format: 'signed' })) : null,
    ),
    raceFacts,
    known ? null : h('details.aside',
      h('summary', 'Ability adjustments and traits for this race'),
      row(...ABILITIES.map((key) => labelled(key.toUpperCase(),
        field(`race.abilityAdjust.${key}`, c.race?.abilityAdjust?.[key], { type: 'int', width: '3.5rem' })))),
      row(labelled('Racial traits', textarea('race.traits', c.race?.traits, { rows: 3 }), { wide: true }))),
    templatesBlock(app),
    d.modules.backgrounds ? backgroundRow(app) : null,
    rs.id === 'antaera'
      ? row(labelled('Forum thread', field('meta.forumThread', c.meta?.forumThread, { placeholder: 'Link to the #scars-characters post', className: 'grow' }), { wide: true }))
      : null);
}

function backgroundRow(app) {
  const c = app.character;
  const list = app.rules.backgrounds[app.rules.ruleset.id] || [];
  const categories = [...new Set(list.map((b) => b.category))];
  const choose = h('select.field', { dataset: { field: 'background.name', kind: 'text' } },
    h('option', { value: '', text: '- choose -', selected: !c.background?.name }),
    categories.map((category) => h('optgroup', { label: `${category} backgrounds` },
      list.filter((b) => b.category === category).map((b) =>
        h('option', { value: b.name, text: b.name, selected: b.name === c.background?.name })))));

  return row(
    labelled('Background', choose),
    labelled('Background item', field('background.item', c.background?.item, { placeholder: 'Agreed with the DM', className: 'grow' })),
    labelled('Item cap', out('wealth.backgroundItemCap', { format: 'gp' })));
}

function templatesBlock(app) {
  const c = app.character;
  const host = h('div.list');
  const rebuild = () => refill(host, c.templates.map((tpl, i) => h('div.list-row',
    field(`templates.${i}.name`, tpl.name, { list: 'template-names', placeholder: 'Template', className: 'grow' }),
    button('x', () => {
      c.templates.splice(i, 1);
      rebuild();
      app.recompute();
    }, { subtle: true, danger: true, title: 'Remove this template' }))));
  rebuild();

  return h('details.aside', { open: c.templates.length > 0 },
    h('summary', `Templates${c.templates.length ? ` (${c.templates.length})` : ''}`),
    h('p.hint', { text: 'Half-dragon, lycanthrope, anything laid over the race. Its level adjustment, ability adjustments and effects stack on top.' }),
    host,
    row(
      button('Add a template', () => {
        c.templates.push({ name: '' });
        rebuild();
        app.recompute();
      }, { subtle: true }),
      h('a.hint', { href: '#/content/template', text: 'Write a template of your own' })));
}

/* ==========================================================================
   Levels - the class build, one row per character level
   ========================================================================== */

export function levelsPanel(app) {
  const gestalt = app.derived.modules.gestalt;
  const listHost = h('div.levels');
  const rebuild = () => refill(listHost, levelRows(app, gestalt));

  const panelEl = panel('levels', 'Levels',
    h('div.summary-strip',
      h('span.build-label', { dataset: { out: 'summary.label' }, text: '-' }),
      total('Class levels', 'summary.classLevels'),
      total('Hit dice', 'summary.hitDiceCount'),
      total('ECL', 'summary.ecl'),
      total('BAB', 'summary.bab', { format: 'signed' }),
      total('Feats', 'feats.allowed'),
      app.derived.modules.training
        ? total('Training days', 'training.days', { title: 'Days to train the next level. Under gestalt the two sides overlap.' })
        : null),
    h(`div.levels-head${gestalt ? '.gestalt' : ''}`,
      h('span.label', { text: '#' }),
      h('span.label', { text: 'Class' }),
      gestalt ? h('span.label', { text: 'Second class' }) : null,
      h('span.label', { text: 'Hit die' }),
      h('span.label', { text: 'HP' }),
      h('span.label', { text: '' })),
    listHost,
    row(
      button('Add a level', () => {
        app.character.levels.push({ level: app.character.levels.length + 1, a: '', b: '' });
        rebuild();
        app.recompute();
        app.rebuildPanel('abilities');
      }),
      button('Remove the last', () => {
        if (app.character.levels.length <= 1) return;
        app.character.levels.pop();
        rebuild();
        app.recompute();
        app.rebuildPanel('abilities');
      }, { subtle: true }),
      h('span.hint', { text: gestalt
        ? 'Gestalt: each level takes two classes and the sheet keeps the better of each.'
        : 'Pick a class for each level. Multiclassing is just different classes on different rows.' }),
      h('a.hint', { href: '#/content/class', text: 'A class the SRD does not have? Write it under Content.' })),
    app.derived.modules.training
      ? h('details.aside',
        h('summary', 'Next level, for training time'),
        row(
          labelled('Next class', field('nextLevel.a', app.character.nextLevel?.a, { list: 'class-names', placeholder: 'Class' })),
          gestalt ? labelled('Next second class', field('nextLevel.b', app.character.nextLevel?.b, { list: 'class-names', placeholder: 'Class' })) : null,
          labelled('Days', out('training.days'))))
      : null);

  rebuild();
  return panelEl;
}

function levelRows(app, gestalt) {
  const c = app.character;
  return c.levels.map((lvl, i) => h(`div.level-row${gestalt ? '.gestalt' : ''}`,
    h('span.level-no', { text: String(i + 1) }),
    field(`levels.${i}.a`, lvl.a, { list: 'class-names', placeholder: 'Class' }),
    gestalt ? field(`levels.${i}.b`, lvl.b, { list: 'class-names', placeholder: 'Class' }) : null,
    out(`summary.hitDice.${i}.die`, { className: 'die' }),
    i === 0 && app.derived.hp.perLevel[0]?.basis === 'max'
      ? h('span.out.locked', { text: 'max', title: 'Hit points are maximum at first level.' })
      : c.hp?.method === 'roll'
        ? field(`hp.rolls.${i + 1}`, c.hp?.rolls?.[i + 1], { type: 'int', placeholder: 'roll' })
        : out(`hp.perLevel.${i}.fromDie`, { title: 'Half the die plus one - the average.' }),
    out(`hp.perLevel.${i}.gained`, { className: 'gained', title: 'What this level adds, Constitution included.' })));
}

/* ==========================================================================
   Abilities
   ========================================================================== */

export function abilitiesPanel(app) {
  const c = app.character;
  const rs = app.rules.ruleset;
  const generation = rs.abilityGeneration;
  const increaseLevels = abilityIncreaseLevels(Math.max(1, app.derived.summary.hitDiceCount));

  const grid = h('div.ability-grid',
    h('span.label', { text: '' }),
    h('span.label', { text: 'Base' }),
    h('span.label', { text: 'Race' }),
    h('span.label', { text: 'Levels' }),
    h('span.label', { text: 'Item', title: 'Enhancement bonus' }),
    h('span.label', { text: 'Inherent' }),
    h('span.label', { text: 'Misc' }),
    h('span.label', { text: 'Temp' }),
    h('span.label', { text: 'Score' }),
    h('span.label', { text: 'Mod' }),
    ABILITIES.map((key) => frag(
      h('span.ability-name', { text: ABILITY_NAMES[key], title: key.toUpperCase() }),
      field(`abilities.base.${key}`, c.abilities?.base?.[key], { type: 'int' }),
      out(`abilities.${key}.parts.racial`, { format: 'signed' }),
      out(`abilities.${key}.parts.levelUp`, { format: 'signed' }),
      field(`abilities.enhancement.${key}`, c.abilities?.enhancement?.[key], { type: 'int', title: 'An enhancement bonus. Does not stack with an item that grants one.' }),
      field(`abilities.inherent.${key}`, c.abilities?.inherent?.[key], { type: 'int' }),
      field(`abilities.misc.${key}`, c.abilities?.misc?.[key], { type: 'int' }),
      field(`abilities.temp.${key}`, c.abilities?.temp?.[key], { type: 'int', className: 'temp' }),
      out(`abilities.${key}.total`, { big: true }),
      out(`abilities.${key}.mod`, { big: true, format: 'signed' }))));

  const budgets = generation.pointBuy?.budgetChoices || [];
  const method = c.abilities?.method;
  const budgetSelect = select('abilities.pointBuyBudget', c.abilities?.pointBuyBudget ?? generation.pointBuy?.budget,
    budgets.map((b) => [b.points, b.label]), { className: 'narrow' });
  budgetSelect.dataset.kind = 'int';

  const methodRow = row(
    labelled('Generated by', select('abilities.method', method,
      generation.methods.map((m) => [m, METHOD_LABELS[m] || m]))),
    method === 'pointBuy' && budgets.length > 1 ? labelled('Budget', budgetSelect) : null,
    method === 'pointBuy' ? labelled('Spent', out('pointBuy.spent')) : null,
    method === 'pointBuy' ? labelled('Remaining', out('pointBuy.remaining')) : null,
    method === 'rolled' ? labelled('Array total', out('rolledTotal')) : null,
    method === 'array'
      ? button('Fill in the standard array', () => {
        app.rules.core.standardArray.forEach((score, i) => { c.abilities.base[ABILITIES[i]] = score; });
        app.rebuildPanel('abilities');
        app.recompute();
      }, { subtle: true, title: 'Then rearrange the scores however you like.' })
      : null,
    h('span.hint', { text: (generation[method] || {}).note || '' }));

  const levelUpRow = row(...increaseLevels.map((level) => {
    const el = select(`abilities.levelUps.${level}`, c.abilities?.levelUps?.[level],
      [['', '-'], ...ABILITIES.map((k) => [k, k.toUpperCase()])], { className: 'narrow' });
    el.dataset.empty = 'delete';
    return labelled(`Level ${level}`, el);
  }),
  increaseLevels.length ? null : h('span.hint', { text: 'The first ability increase comes at 4th level.' }));

  return panel('abilities', 'Abilities', methodRow, grid,
    h('details.aside', { open: increaseLevels.length > 0 },
      h('summary', 'Level increases'), levelUpRow));
}

/* ==========================================================================
   Combat: hit points, defenses, attacks, saves
   ========================================================================== */

export function combatPanel(app) {
  const c = app.character;
  withReference(app, 'equipment', 'combat');
  const lock = app.rules.ruleset.hitPoints?.lockNote;

  const hpBlock = h('div.block',
    h('h3', 'Hit points'),
    row(
      labelled('After 1st level', select('hp.method', c.hp?.method,
        [['average', 'average'], ['roll', 'rolled']], { title: lock })),
      labelled('Bonus', field('hp.bonus', c.hp?.bonus, { type: 'int', width: '4rem', title: 'Anything flat that is not already an effect.' })),
      total('Total', 'hp.total', { big: true }),
      labelled('Current', field('hp.current', c.hp?.current, { type: 'int', width: '4.5rem' })),
      labelled('Temp', field('hp.temp', c.hp?.temp, { type: 'int', width: '4rem' })),
      labelled('Nonlethal', field('hp.nonlethal', c.hp?.nonlethal, { type: 'int', width: '4rem' })),
      total('From effects', 'hp.effectBonus', { format: 'signed' }),
    ),
    h('p.hint', { text: lock ? `${lock} Rolls are entered beside each level, under Levels.` : 'Rolls are entered beside each level, under Levels.' }));

  const acBlock = h('div.block',
    h('h3', 'Armor class'),
    row(
      labelled('Armor', field('gear.armor.name', c.gear?.armor?.name, { placeholder: 'Chain shirt', list: 'armor-names', className: 'grow', title: 'Pick an SRD armor and its numbers fill in.' })),
      labelled('Bonus', field('gear.armor.bonus', c.gear?.armor?.bonus, { type: 'int', width: '3.5rem' })),
      labelled('Max Dex', field('gear.armor.maxDex', c.gear?.armor?.maxDex, { type: 'int', width: '3.5rem', placeholder: '-' })),
      labelled('Check', field('gear.armor.acp', c.gear?.armor?.acp, { type: 'int', width: '3.5rem', title: 'As a positive number. The skill table subtracts it.' })),
      labelled('Spell fail', field('gear.armor.asf', c.gear?.armor?.asf, { type: 'int', width: '3.5rem' })),
      labelled('Speed', field('gear.armor.speed', c.gear?.armor?.speed, { type: 'int', width: '3.5rem', placeholder: '-' })),
    ),
    row(
      labelled('Shield', field('gear.shield.name', c.gear?.shield?.name, { placeholder: 'Shield, heavy steel', list: 'shield-names', className: 'grow', title: 'Pick an SRD shield and its numbers fill in.' })),
      labelled('Bonus', field('gear.shield.bonus', c.gear?.shield?.bonus, { type: 'int', width: '3.5rem' })),
      labelled('Max Dex', field('gear.shield.maxDex', c.gear?.shield?.maxDex, { type: 'int', width: '3.5rem', placeholder: '-' })),
      labelled('Check', field('gear.shield.acp', c.gear?.shield?.acp, { type: 'int', width: '3.5rem' })),
      labelled('Spell fail', field('gear.shield.asf', c.gear?.shield?.asf, { type: 'int', width: '3.5rem' })),
    ),
    row(
      labelled('Natural', field('gear.natural', c.gear?.natural, { type: 'int', width: '3.5rem' })),
      labelled('Deflection', field('gear.deflection', c.gear?.deflection, { type: 'int', width: '3.5rem' })),
      labelled('Dodge', field('gear.dodge', c.gear?.dodge, { type: 'int', width: '3.5rem' })),
      labelled('Misc', field('gear.misc', c.gear?.misc, { type: 'int', width: '3.5rem' })),
      labelled('Dex to AC', out('ac.parts.dex', { format: 'signed', title: 'Capped by the armor you are wearing.' })),
      labelled('Check penalty', out('ac.acp')),
      labelled('Spell failure', out('ac.arcaneSpellFailure')),
    ),
    h('p.hint', { text: 'Typed-in bonuses and bonuses from equipment follow the same stacking rules: two deflection bonuses give the better one, not both.' }),
    h('div.totals',
      total('AC', 'ac.total', { big: true }),
      total('Touch', 'ac.touch'),
      total('Flat-footed', 'ac.flatFooted'),
      total('Initiative', 'initiative.total', { format: 'signed' }),
      total('Speed', 'speed'),
      total('Spell resistance', 'spellResistance')),
    h('ul.conditions', { dataset: { conditionsFor: 'ac' } }));

  const attackBlock = h('div.block',
    h('h3', 'Attacks'),
    row(
      labelled('Melee misc', field('combat.misc.melee', c.combat?.misc?.melee, { type: 'int', width: '3.5rem' })),
      labelled('Ranged misc', field('combat.misc.ranged', c.combat?.misc?.ranged, { type: 'int', width: '3.5rem' })),
      labelled('Grapple misc', field('combat.misc.grapple', c.combat?.misc?.grapple, { type: 'int', width: '3.5rem' })),
      labelled('Initiative misc', field('combat.initiativeMisc', c.combat?.initiativeMisc, { type: 'int', width: '3.5rem' })),
      labelled('Spell resistance', field('combat.spellResistance', c.combat?.spellResistance, { type: 'int', width: '3.5rem' })),
    ),
    h('div.totals',
      total('Melee', 'attacks.melee.routine'),
      total('Ranged', 'attacks.ranged.routine'),
      total('Grapple', 'attacks.grapple.total', { format: 'signed' }),
      total('Bull rush / trip', 'attacks.bullRush', { format: 'signed', title: 'An opposed Strength check, with the size modifier.' })),
    h('ul.conditions', { dataset: { conditionsFor: 'attack' } }));

  const saveBlock = h('div.block',
    h('h3', 'Saving throws'),
    h('div.save-grid',
      h('span.label', { text: '' }),
      h('span.label', { text: 'Base' }),
      h('span.label', { text: 'Ability' }),
      h('span.label', { text: 'Resistance', title: 'A resistance bonus, like a cloak of resistance. Does not stack with another one.' }),
      h('span.label', { text: 'Misc' }),
      h('span.label', { text: 'Effects', title: 'Everything from race, feats and items, already stacked - including the two fields beside it.' }),
      h('span.label', { text: 'Total' }),
      SAVES.map(([key, name]) => frag(
        h('span.ability-name', { text: name }),
        out(`saves.${key}.base`, { format: 'signed' }),
        out(`saves.${key}.ability`, { format: 'signed' }),
        field(`saves.magic.${key}`, c.saves?.magic?.[key], { type: 'int' }),
        field(`saves.misc.${key}`, c.saves?.misc?.[key], { type: 'int' }),
        out(`saves.${key}.bonuses`, { format: 'signed' }),
        out(`saves.${key}.total`, { big: true, format: 'signed' })))),
    h('ul.conditions', { dataset: { conditionsFor: 'save' } }));

  const weaponHost = h('div.weapons');
  const rebuildWeapons = () => refill(weaponHost, (c.weapons || []).map((w, i) => h('div.weapon-row',
    field(`weapons.${i}.name`, w.name, { placeholder: 'Weapon', list: 'weapon-names', className: 'grow', title: 'Pick an SRD weapon and its damage and critical fill in.' }),
    labelled('Atk', field(`weapons.${i}.attackBonus`, w.attackBonus, { type: 'int', width: '3.5rem', title: 'The weapon’s own enhancement, masterwork included.' })),
    labelled('Damage', field(`weapons.${i}.damageDice`, w.damageDice, { placeholder: '1d8', width: '5rem' })),
    labelled('Dmg +', field(`weapons.${i}.damageBonus`, w.damageBonus, { type: 'int', width: '3.5rem' })),
    labelled('Crit', field(`weapons.${i}.crit`, w.crit, { placeholder: '20/x2', width: '5rem' })),
    checkbox(`weapons.${i}.ranged`, w.ranged, 'Ranged'),
    checkbox(`weapons.${i}.thrown`, w.thrown, 'Thrown'),
    checkbox(`weapons.${i}.finesse`, w.finesse, 'Finesse'),
    labelled('Attack', out(`weapons.${i}.routine`)),
    labelled('Damage', out(`weapons.${i}.damage`)),
    button('Remove', () => {
      c.weapons.splice(i, 1);
      rebuildWeapons();
      app.recompute();
    }, { subtle: true, danger: true }))));
  rebuildWeapons();

  const weaponBlock = h('div.block',
    h('h3', 'Weapons'),
    weaponHost,
    button('Add a weapon', () => {
      c.weapons.push({ name: '', attackBonus: 0, damageDice: '', damageBonus: 0, crit: '', ranged: false, thrown: false, finesse: false });
      rebuildWeapons();
      app.recompute();
    }));

  return panel('combat', 'Combat', hpBlock, acBlock, attackBlock, saveBlock, weaponBlock);
}

/* ==========================================================================
   Skills
   ========================================================================== */

export function skillsPanel(app) {
  const host = h('div.skill-table');
  const rebuild = () => refill(host, skillRows(app));

  const subjectSkills = app.derived.index.skills.filter((s) => s.subtype || s.custom);
  const picker = h('div.row', { dataset: { unbound: '' } },
    labelled('Add', h('select.field.grow',
      h('option', { value: '', text: '- a skill -' }),
      subjectSkills.map((s) => h('option', { value: s.name, text: s.custom ? `${s.name} (yours)` : `${s.name}...` })))),
    field('', '', { placeholder: 'Subject, e.g. nature', className: 'grow' }),
    button('Add', (ev) => {
      const wrap = ev.target.closest('.row');
      const name = wrap.querySelector('select').value;
      const subject = wrap.querySelector('input');
      if (!name) return;
      app.character.skills.push({ name, subtype: subject.value.trim(), ranks: 0, misc: 0 });
      subject.value = '';
      rebuild();
      app.recompute();
    }),
    h('span.hint', { text: 'Craft, Knowledge, Perform and Profession are taken one subject at a time. Skills you have written under Content are listed here too.' }));

  const panelEl = panel('skills', 'Skills',
    h('div.summary-strip',
      total('Points', 'skills.budget.total'),
      total('Spent', 'skills.spent'),
      total('Remaining', 'skills.remaining'),
      h('span.hint', { text: 'A class skill costs 1 point a rank and caps at hit dice + 3; a cross-class skill costs 2 and caps at half that.' })),
    h('div.skill-head',
      h('span.label', { text: '' }),
      h('span.label', { text: 'Skill' }),
      h('span.label', { text: 'Total' }),
      h('span.label', { text: 'Ability' }),
      h('span.label', { text: 'Ranks' }),
      h('span.label', { text: 'Misc' }),
      h('span.label', { text: 'Effects', title: 'From race, feats and items, already stacked.' }),
      h('span.label', { text: 'Max' }),
      h('span.label', { text: 'Cost' })),
    host,
    picker);

  rebuild();
  return panelEl;
}

function skillRows(app) {
  return app.character.skills.map((entry, i) => {
    const line = app.derived.skills.lines[i];
    const def = line?.def || {};
    return h('div.skill-row', { dataset: { skill: String(i) } },
      h('span.class-dot', { dataset: { out: `skills.lines.${i}.classSkill`, format: 'dot' },
        title: 'Filled when the skill is on a class list you have taken.' }),
      h('span.skill-name', { title: def.trainedOnly ? 'Trained only: useless at 0 ranks.' : (def.description || '') },
        h('span', { text: line?.label || entry.name }),
        def.acp ? h('span.tag', { text: def.acpDouble ? 'armor x2' : 'armor', title: 'The armor check penalty applies.' }) : null,
        def.trainedOnly ? h('span.tag', { text: 'trained' }) : null,
        def.custom ? h('span.tag', { text: 'yours' }) : null,
        h('span.cond-mark', { dataset: { condMark: `skill.${entry.name}` } })),
      out(`skills.lines.${i}.total`, { big: true, format: 'signed' }),
      out(`skills.lines.${i}.abilityMod`, { format: 'signed' }),
      field(`skills.${i}.ranks`, entry.ranks, { type: 'int', step: '0.5' }),
      field(`skills.${i}.misc`, entry.misc, { type: 'int' }),
      out(`skills.lines.${i}.bonuses`, { format: 'signed' }),
      out(`skills.lines.${i}.maxRanks`),
      out(`skills.lines.${i}.cost`),
      entry.subtype || def.custom || def.subtype
        ? button('x', () => {
          app.character.skills.splice(i, 1);
          app.rebuildPanel('skills');
          app.recompute();
        }, { subtle: true, title: 'Remove this line' })
        : h('span'));
  });
}

/* ==========================================================================
   Feats, features, traits and flaws
   ========================================================================== */

/**
 * A list of named rows that can each carry effects - feats, features. A row
 * named after something in the content library gains that entry's effects; its
 * own effects, edited in place, are added on top.
 */
function effectRows(app, key, opts) {
  const c = app.character;
  const host = h('div.list');
  const rebuild = () => refill(host, (c[key] || []).map((entry, i) => {
    const fx = entry.effects || [];
    const fromContent = app.derived.index[opts.lookup]?.get(entry.name);
    const contentFx = fromContent?.effects?.length || 0;
    return h('div.effect-list-row',
      h('div.list-row',
        field(`${key}.${i}.name`, entry.name, { list: opts.datalist, placeholder: opts.placeholder, className: 'grow' }),
        field(`${key}.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
        opts.sources ? select(`${key}.${i}.source`, entry.source, opts.sources, { className: 'narrow' }) : null,
        opts.uses ? usesField(`${key}.${i}`, entry, fromContent) : null,
        button('x', () => {
          c[key].splice(i, 1);
          rebuild();
          app.recompute();
        }, { subtle: true, danger: true, title: 'Remove' })),
      h('details.row-effects', { open: fx.length > 0 },
        h('summary', contentFx
          ? `${contentFx} effect${contentFx === 1 ? '' : 's'} from your content${fx.length ? `, ${fx.length} added here` : ''}`
          : fx.length ? `${fx.length} effect${fx.length === 1 ? '' : 's'}` : 'Effects'),
        effectsEditor(`${key}.${i}.effects`, () => (c[key][i].effects = c[key][i].effects || []), {
          skillNames: skillNamesFor(app),
          emptyText: fromContent ? 'Nothing added here beyond what the content entry already does.' : 'None. Add one and this row changes the sheet.',
          onShapeChange: () => app.recompute(),
        })),
      opts.reference ? referenceDetails(opts.reference, entry.name) : null);
  }));
  rebuild();
  return { host, rebuild };
}

/** A row's uses per day: a number, and whether they come back daily or weekly. */
function usesField(path, entry, fromContent) {
  return labelled('Uses', field(`${path}.uses`, entry.uses, {
    type: 'int',
    width: '3.5rem',
    placeholder: fromContent?.uses ? String(fromContent.uses) : '-',
    title: 'Uses per day, for something that can be used only so many times. Leave empty otherwise; the Feats page tracks it.',
  }));
}

/** "About" a feat or item: its SRD entry, opened in place, when the name is one the reference knows. */
export function referenceDetails(kind, name) {
  const entry = lookUp(kind, name);
  if (!entry) return null;
  const holder = h('div.row-reference-body');
  const details = h('details.row-reference', h('summary', { text: `About ${entry.name}` }), holder);
  details.addEventListener('toggle', () => {
    if (details.open && !holder.firstChild) refill(holder, referenceCard(kind, entry));
  });
  return details;
}

/** Load a reference once, then draw a panel again so its rows can use it. */
function withReference(app, kind, panelKey) {
  if (referenceNow(kind)) return;
  loadReference(kind).then(() => app.rebuildPanel?.(panelKey)).catch(() => {});
}

export function featsPanel(app) {
  const c = app.character;
  const tf = app.derived.modules.traitsFlaws;
  withReference(app, 'feats', 'feats');

  const feats = effectRows(app, 'feats', {
    datalist: 'feat-names', placeholder: 'Feat', lookup: 'featByName', uses: true, reference: 'feats',
    sources: [['level', 'level'], ['bonus', 'bonus'], ['flaw', 'flaw'], ['class', 'class'], ['race', 'race'], ['other', 'other']],
  });
  const features = effectRows(app, 'features', { datalist: 'feature-names', placeholder: 'Class feature, boon, curse...', lookup: 'featureByName', uses: true });

  const simpleList = (key, label) => {
    const host = h('div.list');
    const rebuild = () => refill(host, (c[key] || []).map((entry, i) => h('div.list-row',
      field(`${key}.${i}.name`, entry.name, { placeholder: label, className: 'grow' }),
      field(`${key}.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
      button('x', () => {
        c[key].splice(i, 1);
        rebuild();
        app.recompute();
      }, { subtle: true, danger: true }))));
    rebuild();
    return h('div.block', h('h3', `${label}s`), host, button(`Add a ${label.toLowerCase()}`, () => {
      c[key].push({ name: '', effect: '' });
      rebuild();
      app.recompute();
    }));
  };

  return panel('feats', tf ? 'Feats, features, traits and flaws' : 'Feats and features',
    h('div.summary-strip',
      total('Feats earned', 'feats.allowed'),
      total('Taken', 'feats.taken'),
      total('From levels', 'feats.fromLevels'),
      total('Bonus', 'feats.granted'),
      tf ? total('From flaws', 'feats.fromFlaws') : null,
      h('span.hint', { text: tf
        ? (app.rules.ruleset.traitsFlaws || {}).note || ''
        : 'One feat at 1st level and one every three hit dice. A human’s bonus feat is counted for you.' })),
    h('div.block', h('h3', 'Feats'), feats.host,
      row(
        button('Add a feat', () => { c.feats.push({ name: '', effect: '', source: 'level', effects: [] }); feats.rebuild(); app.recompute(); }),
        labelled('Bonus feats granted', field('featSlots.bonus', c.featSlots?.bonus, { type: 'int', width: '3.5rem', title: 'A fighter’s, a wizard’s, a homebrew class’s. A human’s is already counted.' })),
        h('a.hint', { href: '#/content/feat', text: 'Write a feat of your own' }))),
    h('div.block', h('h3', 'Features'),
      h('p.hint', { text: 'Class features, boons, bloodlines, curses - anything that changes a number and is not a feat or an item.' }),
      features.host,
      button('Add a feature', () => { c.features.push({ name: '', effect: '', effects: [] }); features.rebuild(); app.recompute(); }, { subtle: true })),
    tf ? simpleList('traits', 'Trait') : null,
    tf ? simpleList('flaws', 'Flaw') : null);
}

/* ==========================================================================
   Campaign systems: action points and taint
   ========================================================================== */

export function houserulesPanel(app) {
  const c = app.character;
  const d = app.derived;
  if (!d.modules.actionPoints && !d.modules.taint) return null;

  const apBlock = d.modules.actionPoints ? h('div.block',
    h('h3', 'Action points'),
    row(
      total('Pool', 'actionPoints.earned'),
      labelled('Spent', field('actionPoints.spent', c.actionPoints?.spent, { type: 'int', width: '4rem' })),
      total('Remaining', 'actionPoints.remaining', { big: true }),
      labelled('Bonus', field('actionPoints.bonus', c.actionPoints?.bonus, { type: 'int', width: '4rem' })),
      total('One point rolls', 'actionPoints.roll'),
    ),
    h('p.hint', { text: app.rules.ruleset.actionPoints?.note || '' })) : null;

  const taintBlock = d.modules.taint ? h('div.block',
    h('h3', 'Taint'),
    h('div.taint-grid',
      h('span.label', { text: '' }),
      h('span.label', { text: 'Score' }),
      h('span.label', { text: 'Read against' }),
      h('span.label', { text: 'Symptoms' }),
      h('span.label', { text: 'To next' }),
      h('span.label', { text: 'Resisted by' }),

      h('span.ability-name', { text: 'Corruption' }),
      field('taint.corruption', c.taint?.corruption, { type: 'int' }),
      out('abilities.con.total', { title: 'Constitution' }),
      h('span.out.severity', { dataset: { out: 'taint.corruption.severity', format: 'severity' }, text: '-' }),
      out('taint.corruption.toNext'),
      h('span.hint', { text: 'Fortitude' }),

      h('span.ability-name', { text: 'Depravity' }),
      field('taint.depravity', c.taint?.depravity, { type: 'int' }),
      out('abilities.wis.total', { title: 'Wisdom' }),
      h('span.out.severity', { dataset: { out: 'taint.depravity.severity', format: 'severity' }, text: '-' }),
      out('taint.depravity.toNext'),
      h('span.hint', { text: 'Will' })),
    row(
      total('Effective taint', 'taint.effective'),
      checkbox('taint.pureSoul', c.taint?.pureSoul, 'Pure Soul'),
      labelled('Exalted feats', field('taint.exaltedFeats', c.taint?.exaltedFeats, { type: 'int', width: '3.5rem', title: 'Pure Soul counts itself.' })),
      total('Bonus to resist', 'taint.resistBonus', { format: 'signed' }),
    ),
    row(labelled('Notes', textarea('taint.notes', c.taint?.notes, { rows: 2, placeholder: 'Symptoms rolled, absorbing items carried, cleansings undertaken.' }), { wide: true }))) : null;

  return panel('houserules', d.modules.taint ? 'Action points and taint' : 'Action points', apBlock, taintBlock);
}

/* ==========================================================================
   Equipment and wealth
   ========================================================================== */

export function wealthPanel(app) {
  const c = app.character;
  const d = app.derived;
  const host = h('div.list');

  const rebuild = () => refill(host, (c.wealth?.items || []).map((item, i) => {
    const fromContent = app.derived.index.itemByName.get(item.name);
    const fx = item.effects || [];
    const contentFx = fromContent?.effects?.length || 0;
    return h('div.effect-list-row',
      h('div.list-row.item-row',
        checkbox(`wealth.items.${i}.equipped`, item.equipped !== false, 'Worn', { title: 'An item’s effects apply only while it is worn or held.' }),
        field(`wealth.items.${i}.name`, item.name, { list: 'item-names', placeholder: 'Item', className: 'grow' }),
        labelled('Qty', field(`wealth.items.${i}.qty`, item.qty, { type: 'int', width: '3.5rem' })),
        labelled('Value each', field(`wealth.items.${i}.value`, item.value, { type: 'int', width: '6rem' })),
        usesField(`wealth.items.${i}`, item, fromContent),
        labelled('Line', out(`wealth.items.${i}.lineValue`, { format: 'gp' })),
        d.wealth.enforced ? h('span.flag', { dataset: { out: `wealth.items.${i}.overCap`, format: 'cap' }, text: '' }) : null,
        button('x', () => {
          c.wealth.items.splice(i, 1);
          rebuild();
          app.recompute();
        }, { subtle: true, danger: true })),
      h('details.row-effects', { open: fx.length > 0 },
        h('summary', contentFx
          ? `${contentFx} effect${contentFx === 1 ? '' : 's'} from your content${fx.length ? `, ${fx.length} added here` : ''}`
          : fx.length ? `${fx.length} effect${fx.length === 1 ? '' : 's'}` : 'Effects'),
        effectsEditor(`wealth.items.${i}.effects`, () => (c.wealth.items[i].effects = c.wealth.items[i].effects || []), {
          skillNames: skillNamesFor(app),
          emptyText: 'None. A cloak of resistance +1, say, is all saving throws / resistance / +1.',
          onShapeChange: () => app.recompute(),
        })));
  }));

  rebuild();
  return panel('wealth', 'Equipment and wealth',
    h('div.summary-strip',
      total('Expected at this level', 'wealth.expected', { format: 'gp' }),
      total('Held', 'wealth.held', { format: 'gp' }),
      d.wealth.enforced ? total('Single item cap', 'wealth.cap', { format: 'gp' }) : null,
      h('span.hint', { text: d.wealth.enforced
        ? 'Wealth by level, and the campaign’s cap on any one item.'
        : 'Wealth by level is guidance: what a character of this level usually carries.' })),
    row(
      labelled('Starting gold', field('wealth.startingGold', c.wealth?.startingGold, { type: 'int', width: '7rem', placeholder: 'by level' })),
      labelled('Coin in hand', field('wealth.gold', c.wealth?.gold, { type: 'int', width: '7rem' }))),
    host,
    row(
      button('Add an item', () => {
        c.wealth.items.push({ name: '', qty: 1, value: 0, equipped: true, effects: [] });
        rebuild();
        app.recompute();
      }),
      h('a.hint', { href: '#/content/item', text: 'Write an item of your own' })));
}

/* ==========================================================================
   Bonuses in force - the working, shown
   ========================================================================== */

/**
 * Every effect on the character, grouped by what it changes. Display only, so
 * it is redrawn after every recompute; it holds no inputs to lose.
 *
 * This panel is what makes the stacking rules trustworthy. A number that has
 * quietly declined to add a player's ring is a number they will assume is a
 * bug, unless the sheet shows its reasoning.
 */
export function effectsPanel() {
  return panel('effects', 'Bonuses in force',
    h('p.hint', { text: 'Every bonus the sheet is counting, where it came from, and why the ones that do not count are left out.' }),
    h('div.effects-summary', { dataset: { effectsHost: '' } }));
}

export function paintEffects(root, derived) {
  const host = root.querySelector('[data-effects-host]');
  if (!host) return;
  const buckets = Object.values(derived.effects.resolved)
    .filter((b) => b.applied.length || b.suppressed.length || b.conditional.length)
    .sort((a, b) => describeTarget(a.target).localeCompare(describeTarget(b.target)));

  if (!buckets.length) {
    refill(host, h('p.empty', { text: 'Nothing yet. Choose a race, or give a feat or an item an effect.' }));
    return;
  }

  const sign = (n) => (n < 0 ? String(n) : `+${n}`);
  refill(host, h('div.table-scroll', h('table.effects-table',
    h('thead', h('tr', ['Changes', 'Total', 'From'].map((t) => h('th', { text: t })))),
    h('tbody', buckets.map((b) => h('tr', { class: b.unknown ? 'is-unknown' : '' },
      h('th', { scope: 'row', text: describeTarget(b.target) }),
      h('td.effects-total', { text: b.applied.length ? sign(b.total) : '-' }),
      h('td', h('ul.effect-sources',
        b.applied.map((e) => h('li', { text: `${sign(e.value)} ${e.type} - ${e.source}` })),
        b.suppressed.map((e) => h('li.is-suppressed', { text: `${sign(e.value)} ${e.type} - ${e.source}`, title: `Does not stack with a larger ${e.type} bonus.` })),
        b.conditional.map((e) => h('li.is-conditional', { text: `${sign(e.value)} ${e.type} ${e.condition} - ${e.source}`, title: 'Only in the situation described, so not in the total.' }))))))))));
}

/** The conditional bonuses listed beside the numbers they would change. */
export function paintConditions(root, derived) {
  const groups = {
    ac: ['ac'],
    save: ['save.all', 'save.fort', 'save.ref', 'save.will'],
    attack: ['attack.all', 'attack.melee', 'attack.ranged', 'damage.melee', 'damage.ranged'],
  };
  const sign = (n) => (n < 0 ? String(n) : `+${n}`);
  for (const el of root.querySelectorAll('[data-conditions-for]')) {
    const targets = groups[el.dataset.conditionsFor] || [];
    const items = targets.flatMap((t) => derived.effects.resolved[t]?.conditional || []);
    refill(el, items.map((e) => h('li', { text: `${sign(e.value)} ${describeTarget(e.target)} ${e.condition} (${e.source})` })));
  }
  for (const el of root.querySelectorAll('[data-cond-mark]')) {
    const name = el.dataset.condMark;
    const items = [...(derived.effects.resolved[name]?.conditional || []), ...(derived.effects.resolved['skill.*']?.conditional || [])];
    el.textContent = items.length ? '†' : '';
    el.title = items.map((e) => `${sign(e.value)} ${e.condition} (${e.source})`).join('\n');
  }
}

/* ==========================================================================
   Homebrew carried by this sheet
   ========================================================================== */

export function contentPanel() {
  return panel('content', 'Homebrew on this sheet',
    h('p.hint', { text: 'Content from your library that this character uses travels inside the sheet, so an exported file still adds up in somebody else’s browser. Update a copy here when you change the original.' }),
    h('div.content-carried', { dataset: { contentHost: '' } }));
}

export function paintContent(root, app, library) {
  const host = root.querySelector('[data-content-host]');
  if (!host) return;
  const c = app.character;
  const homebrew = app.derived?.homebrew || { blocked: [], campaignNames: new Set() };
  const campaignName = app.rules.campaign?.name;
  const rows = [];
  for (const kind of CONTENT_KINDS) {
    const plural = CONTENT_TYPES[kind].plural;
    (c.content?.[plural] || []).forEach((entry, i) => {
      if (!entry.name) return;
      // The campaign's own homebrew is the campaign's: it is not the player's to
      // compare with, or copy into, their library.
      const theirs = Boolean(entry.campaign) || homebrew.campaignNames.has(entry.name);
      const blocked = homebrew.blocked.some((b) => b.kind === kind && b.name === entry.name);
      // Nor, where the player's own homebrew does not count, is their library.
      const original = theirs || blocked ? null : library.find(kind, entry.name);
      const stale = original && original.updated && original.updated !== entry.updated;
      rows.push(h('li.carried',
        h('span.carried-kind', { text: CONTENT_TYPES[kind].label }),
        h('span.carried-name', { text: entry.name }),
        theirs ? h('span.tag', { text: campaignName ? `${campaignName} homebrew` : 'campaign homebrew' }) : null,
        blocked ? h('span.tag.is-blocked', { text: 'not counted here', title: 'Only the campaign\u2019s homebrew counts in this campaign, unless its GMs allow homebrew.' }) : null,
        stale ? h('span.tag.is-stale', { text: 'library copy is newer' }) : null,
        !theirs && !blocked && !original ? h('span.tag', { text: 'not in your library' }) : null,
        h('span.grow'),
        stale ? button('Update', () => {
          c.content[plural][i] = structuredClone(original);
          app.recompute();
        }, { subtle: true }) : null,
        !theirs && !blocked && !original ? button('Save to library', () => {
          const shelf = library.load();
          shelf[plural].push({ ...structuredClone(entry), kind, updated: entry.updated || new Date().toISOString() });
          library.save(shelf);
          app.recompute();
        }, { subtle: true }) : null,
        button('Remove', () => {
          c.content[plural].splice(i, 1);
          app.recompute();
        }, { subtle: true, danger: true, title: 'Take this copy off the sheet. Anything still named after it stops counting.' })));
    });
  }
  const unused = unusedContent(c);
  refill(host,
    rows.length ? h('ul.carried-list', rows) : h('p.empty', { text: 'None. Everything on this sheet is from the SRD.' }),
    unused.length ? h('p.hint', { text: `Carried but not used: ${unused.map((u) => u.name).join(', ')}.` }) : null);
}

/* ==========================================================================
   Limited uses - rage, turning, smite, wild shape, and anything with uses per day
   ========================================================================== */

/**
 * @param ways  from app.js: { rest(), newWeek(), setUsed(tracker, used) }
 */
export function trackersPanel(app, ways) {
  const trackers = app.derived.trackers || [];
  const list = h('ul.tracker-list', trackers.map((t) => h(`li.tracker${t.used > t.max ? '.is-over' : ''}`,
    h('div.tracker-name',
      h('span.tracker-title', { text: t.name }),
      h('span.hint', { text: `${t.source} - ${t.max}${t.unit ? ` ${t.unit}` : ''} a ${t.per}` })),
    t.unit || t.max > 12
      ? h('div.tracker-count',
        button('\u2212', () => ways.setUsed(t, t.used + 1), { subtle: true, title: `Use one${t.unit ? ` of the ${t.unit}` : ''}` }),
        h('span.tracker-left', { text: `${t.remaining} left` }),
        button('+', () => ways.setUsed(t, Math.max(0, t.used - 1)), { subtle: true, title: 'Take one back' }))
      : h('span.pips', { role: 'group', 'aria-label': `${t.used} of ${t.max} used` },
        Array.from({ length: t.max }, (_, i) => h(`button.pip${i < t.used ? '.is-used' : ''}`, {
          type: 'button',
          title: i < t.used ? 'Used - click to take back' : 'Click to use',
          'aria-pressed': String(i < t.used),
          onclick: () => ways.setUsed(t, i < t.used ? i : i + 1),
        }))))));

  return panel('trackers', 'Limited uses',
    trackers.length
      ? list
      : h('p.empty', { text: 'Nothing with uses per day yet. Class features like rage and turning appear here as they are gained; give any feat, feature or item a number of uses and it does too.' }),
    row(
      button('Rest', ways.rest, { title: 'A night\u2019s rest: daily uses, spells and power points back.' }),
      trackers.some((t) => t.per === 'week') ? button('New week', ways.newWeek, { subtle: true, title: 'Weekly uses back, and daily ones too.' }) : null,
      h('span.hint', { text: 'Uses a day come back with a night\u2019s rest.' })));
}

/* ==========================================================================
   The written half
   ========================================================================== */

export function textPanel(app) {
  const t = app.character.text || {};
  const blocks = [
    ['classFeatures', 'Class features', 'Rage, sneak attack, wild shape - the parts of a class that are description rather than arithmetic.'],
    ['spells', 'Spells', 'Known, prepared, per day.'],
    ['powers', 'Powers', 'Powers known and power points.'],
    ['languages', 'Languages', ''],
    ['equipment', 'Other equipment', 'Everything carried that needs no line of its own above.'],
    ['backstory', 'Backstory', ''],
    ['notes', 'Notes', ''],
  ];
  return panel('text', 'Features, spells and story',
    ...blocks.map(([key, label, hint]) => h('div.block',
      h('h3', label),
      hint ? h('p.hint', { text: hint }) : null,
      textarea(`text.${key}`, t[key], { rows: key === 'backstory' ? 10 : 5 }))));
}

/* ==========================================================================
   Casting
   ========================================================================== */

export function castingPanel() {
  return panel('casting', 'Casting and manifesting',
    h('div.casting-host', { dataset: { castingHost: '' } }),
    h('p.hint', { text: 'Spells per day come from the class tables; what the sheet works out is the save DC and the bonus slots a high ability grants.' }));
}
