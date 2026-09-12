// The sheet itself: every panel, in the order a 3.5e sheet is usually read.
//
// Each builder takes the app (character, rules, campaign) and returns a panel.
// Inputs are bound by path and built once. Anything the sheet works out for
// itself is an `out()` naming a path into the derived sheet, so adding a
// calculation is a one-line change here and a real change in the engine, never
// a formula buried in the interface.

import {
  h, field, checkbox, select, textarea, labelled, out, total, panel, row,
  button, refill, frag,
} from './dom.js';
import { ABILITIES, ABILITY_NAMES } from '../engine/abilities.js';
import { abilityIncreaseLevels } from '../engine/abilities.js';

const SAVES = [['fort', 'Fortitude'], ['ref', 'Reflex'], ['will', 'Will']];

/* ==========================================================================
   Identity and race
   ========================================================================== */

export function identityPanel(app) {
  const c = app.character;
  const sizes = app.rules.rules.sizes.map((s) => s.name);
  const backgrounds = app.rules.backgrounds.backgrounds;
  const grouped = [...new Set(backgrounds.map((b) => b.category))];

  const backgroundSelect = h('select.field', { dataset: { field: 'background.name', kind: 'text' } },
    h('option', { value: '', text: '- choose -', selected: !c.background?.name }),
    grouped.map((category) => h('optgroup', { label: `${category} backgrounds` },
      backgrounds.filter((b) => b.category === category).map((b) =>
        h('option', { value: b.name, text: b.name, selected: b.name === c.background?.name })))));

  return panel('identity', 'The character',
    row(
      labelled('Character', field('name', c.name, { placeholder: 'Name', className: 'grow' })),
      labelled('Player', field('player', c.player, { placeholder: 'Who plays them' })),
      labelled('Alignment', field('concept.alignment', c.concept?.alignment, { placeholder: 'NG', width: '5rem' })),
      labelled('Deity', field('concept.deity', c.concept?.deity, { placeholder: 'None' })),
    ),
    row(
      labelled('Race', field('race.name', c.race?.name, { placeholder: 'Race or template' })),
      labelled('Size', select('race.size', c.race?.size, sizes, { className: 'narrow' })),
      labelled('Speed', field('race.speed', c.race?.speed, { type: 'int', width: '4rem' })),
      labelled('Racial HD', field('race.racialHD', c.race?.racialHD, { type: 'int', width: '4rem', title: 'Hit dice from the race itself, before any class levels.' })),
      labelled('LA', field('race.la', c.race?.la, { type: 'int', width: '4rem', title: 'Level adjustment. Starting LA is capped at a quarter of ECL.' })),
      labelled('LA allowed', out('levelAdjustment.allowed', { format: 'signed' })),
      labelled('Extra skill points', field('race.skillPointsPerLevel', c.race?.skillPointsPerLevel, { type: 'int', width: '4rem', title: 'Per level, before the first-level multiplier. A human has 1.' })),
    ),
    row(
      labelled('Background', backgroundSelect, { wide: true }),
      labelled('Background item', field('background.item', c.background?.item, { placeholder: 'Agreed with the DM', className: 'grow' })),
      labelled('Item cap at this level', out('wealth.backgroundItemCap', { format: 'gp' })),
    ),
    row(
      labelled('Forum thread', field('meta.forumThread', c.meta?.forumThread, { placeholder: 'Link to the #scars-characters post', className: 'grow' }), { wide: true }),
    ),
    h('details.aside',
      h('summary', 'Racial ability adjustments and traits'),
      row(...ABILITIES.map((key) => labelled(key.toUpperCase(),
        field(`race.abilityAdjust.${key}`, c.race?.abilityAdjust?.[key], { type: 'int', width: '3.5rem' })))),
      row(labelled('Racial traits', textarea('race.traits', c.race?.traits, { rows: 3, placeholder: 'Vision, immunities, bonus feats, anything the race grants.' }), { wide: true }))));
}

/* ==========================================================================
   Levels - the class build, one row per character level
   ========================================================================== */

export function levelsPanel(app) {
  const listHost = h('div.levels');
  const customHost = h('div.customs');

  const rebuild = () => {
    refill(listHost, levelRows(app));
    refill(customHost, customClassRows(app));
  };

  const panelEl = panel('levels', 'Levels',
    h('div.summary-strip',
      h('span.build-label', { dataset: { out: 'summary.label' }, text: '-' }),
      total('Class levels', 'summary.classLevels'),
      total('Hit dice', 'summary.hitDiceCount'),
      total('ECL', 'summary.ecl'),
      total('BAB', 'summary.bab', { format: 'signed' }),
      total('Feats', 'feats.allowed'),
      total('Training days', 'training.days', { title: 'Days to train the next level, per The Index. Under gestalt the two sides overlap.' })),
    h('div.levels-head',
      h('span.label', { text: '#' }),
      h('span.label', { text: 'Class' }),
      app.campaign.gestalt ? h('span.label', { text: 'Second class' }) : null,
      h('span.label', { text: 'Hit die' }),
      h('span.label', { text: 'HP' }),
      h('span.label', { text: '' })),
    listHost,
    row(
      button('Add a level', () => {
        app.character.levels.push({ level: app.character.levels.length + 1, a: '', b: '' });
        rebuild();
        app.recompute();
        // A new level can earn an ability increase, which the abilities panel
        // only shows a selector for if it was built after the level existed.
        app.rebuildPanel('abilities');
      }),
      button('Remove the last', () => {
        app.character.levels.pop();
        rebuild();
        app.recompute();
        app.rebuildPanel('abilities');
      }, { subtle: true }),
      h('span.hint', { text: app.campaign.gestalt
        ? 'Gestalt is on: each level takes two classes and the sheet keeps the better of each.'
        : 'Gestalt is off for this campaign, so each level takes one class.' })),
    h('details.aside',
      h('summary', 'Next level, for training time'),
      row(
        labelled('Next on side A', field('nextLevel.a', app.character.nextLevel?.a, { list: 'class-names', placeholder: 'Class' })),
        app.campaign.gestalt
          ? labelled('Next on side B', field('nextLevel.b', app.character.nextLevel?.b, { list: 'class-names', placeholder: 'Class' }))
          : null,
        labelled('Days', out('training.days')))),
    h('details.aside',
      h('summary', 'Custom classes'),
      h('p.hint', { text: 'Anything not in the SRD - a splatbook class, a prestige class, a homebrew - is entered once here and then counts exactly like a printed class.' }),
      customHost,
      button('Add a class', () => {
        app.character.customClasses.push({
          name: '', hd: 8, bab: 'average',
          saves: { fort: 'poor', ref: 'poor', will: 'poor' },
          skillPoints: 2, classSkills: [], prestige: false,
        });
        rebuild();
        app.recompute();
      })));

  rebuild();
  return panelEl;
}

function levelRows(app) {
  const c = app.character;
  return c.levels.map((lvl, i) => h('div.level-row',
    h('span.level-no', { text: String(i + 1) }),
    field(`levels.${i}.a`, lvl.a, { list: 'class-names', placeholder: 'Class' }),
    app.campaign.gestalt ? field(`levels.${i}.b`, lvl.b, { list: 'class-names', placeholder: 'Class' }) : null,
    out(`summary.hitDice.${i}.die`, { className: 'die' }),
    i === 0
      ? h('span.out.locked', { text: 'max', title: 'Hit points are maximum at first level.' })
      : c.hp?.method === 'roll'
        ? field(`hp.rolls.${i + 1}`, c.hp?.rolls?.[i + 1], { type: 'int', placeholder: 'roll' })
        : out(`hp.perLevel.${i}.fromDie`, { title: 'Half the die plus one - the average.' }),
    out(`hp.perLevel.${i}.gained`, { className: 'gained', title: 'What this level adds, Constitution included.' })));
}

function customClassRows(app) {
  const progressions = [['good', 'good (+1/level)'], ['average', 'average (+3/4)'], ['poor', 'poor (+1/2)']];
  const saveOptions = [['good', 'good'], ['poor', 'poor']];

  return app.character.customClasses.map((cls, i) => h('div.custom-row',
    field(`customClasses.${i}.name`, cls.name, { placeholder: 'Class name' }),
    labelled('d', field(`customClasses.${i}.hd`, cls.hd, { type: 'int', width: '3.5rem' })),
    labelled('BAB', select(`customClasses.${i}.bab`, cls.bab, progressions, { className: 'narrow' })),
    ...SAVES.map(([key, name]) => labelled(name.slice(0, 4),
      select(`customClasses.${i}.saves.${key}`, cls.saves?.[key], saveOptions, { className: 'narrow' }))),
    labelled('Skills', field(`customClasses.${i}.skillPoints`, cls.skillPoints, { type: 'int', width: '3.5rem' })),
    checkbox(`customClasses.${i}.prestige`, cls.prestige, 'Prestige'),
    labelled('Class skills', field(`customClasses.${i}.classSkills`, (cls.classSkills || []).join(', '),
      { placeholder: 'Balance, Climb, Jump', className: 'grow', title: 'Comma separated. A bare "Knowledge" makes every Knowledge a class skill.' })),
    button('Remove', () => {
      app.character.customClasses.splice(i, 1);
      app.rebuildPanel('levels');
      app.recompute();
    }, { subtle: true, danger: true })));
}

/* ==========================================================================
   Abilities
   ========================================================================== */

export function abilitiesPanel(app) {
  const c = app.character;
  const hd = Math.max(1, (c.levels || []).length + Number(c.race?.racialHD || 0));
  const increaseLevels = abilityIncreaseLevels(hd);

  const grid = h('div.ability-grid',
    h('span.label', { text: '' }),
    h('span.label', { text: 'Base' }),
    h('span.label', { text: 'Race' }),
    h('span.label', { text: 'Levels' }),
    h('span.label', { text: 'Item' }),
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
      field(`abilities.enhancement.${key}`, c.abilities?.enhancement?.[key], { type: 'int', title: 'Items raise an ability in even numbers only.' }),
      field(`abilities.inherent.${key}`, c.abilities?.inherent?.[key], { type: 'int' }),
      field(`abilities.misc.${key}`, c.abilities?.misc?.[key], { type: 'int' }),
      field(`abilities.temp.${key}`, c.abilities?.temp?.[key], { type: 'int', className: 'temp' }),
      out(`abilities.${key}.total`, { big: true }),
      out(`abilities.${key}.mod`, { big: true, format: 'signed' }))));

  const methodRow = row(
    labelled('Generated by', select('abilities.method', c.abilities?.method,
      [['pointBuy', '30 point buy'], ['rolled', 'rolled array']])),
    labelled('Point buy spent', h('span.out', { dataset: { out: 'pointBuy.spent' }, text: '-' })),
    labelled('Remaining', h('span.out', { dataset: { out: 'pointBuy.remaining' }, text: '-' })),
    labelled('Array total', h('span.out', { dataset: { out: 'rolledTotal' }, text: '-' })),
    h('span.hint', { text: 'Rolled arrays are kept only between 65 and 85. Roll two with !rollstats and keep one.' }));

  const levelUpRow = row(...increaseLevels.map((level) => labelled(`Level ${level}`,
    select(`abilities.levelUps.${level}`, c.abilities?.levelUps?.[level],
      [['', '-'], ...ABILITIES.map((k) => [k, k.toUpperCase()])], { className: 'narrow' }))),
    increaseLevels.length ? null : h('span.hint', { text: 'The first ability increase comes at 4th level.' }));

  return panel('abilities', 'Abilities', methodRow, grid,
    h('details.aside', { open: increaseLevels.length > 0 },
      h('summary', 'Level increases'), levelUpRow));
}

/* ==========================================================================
   Combat: hit points, defences, attacks, saves
   ========================================================================== */

export function combatPanel(app) {
  const c = app.character;

  const hpBlock = h('div.block',
    h('h3', 'Hit points'),
    row(
      labelled('After 1st', select('hp.method', c.hp?.method,
        [['average', 'average'], ['roll', 'rolled']], { title: 'Chosen once, then held for every level after. Maximum at 1st level either way.' })),
      labelled('Bonus', field('hp.bonus', c.hp?.bonus, { type: 'int', width: '4rem', title: 'Toughness, a familiar, anything flat.' })),
      total('Total', 'hp.total', { big: true }),
      labelled('Current', field('hp.current', c.hp?.current, { type: 'int', width: '4.5rem' })),
      labelled('Temp', field('hp.temp', c.hp?.temp, { type: 'int', width: '4rem' })),
      labelled('Nonlethal', field('hp.nonlethal', c.hp?.nonlethal, { type: 'int', width: '4rem' })),
    ),
    h('p.hint', { text: 'The roll for each level is entered beside that level, under Levels.' }));

  const acBlock = h('div.block',
    h('h3', 'Armour class'),
    row(
      labelled('Armour', field('gear.armor.name', c.gear?.armor?.name, { placeholder: 'Chain shirt', className: 'grow' })),
      labelled('Bonus', field('gear.armor.bonus', c.gear?.armor?.bonus, { type: 'int', width: '3.5rem' })),
      labelled('Max Dex', field('gear.armor.maxDex', c.gear?.armor?.maxDex, { type: 'int', width: '3.5rem', placeholder: '-' })),
      labelled('Check', field('gear.armor.acp', c.gear?.armor?.acp, { type: 'int', width: '3.5rem', title: 'As a positive number. The skill table subtracts it.' })),
      labelled('Spell fail', field('gear.armor.asf', c.gear?.armor?.asf, { type: 'int', width: '3.5rem' })),
      labelled('Speed', field('gear.armor.speed', c.gear?.armor?.speed, { type: 'int', width: '3.5rem', placeholder: '-' })),
    ),
    row(
      labelled('Shield', field('gear.shield.name', c.gear?.shield?.name, { placeholder: 'Heavy steel', className: 'grow' })),
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
      labelled('Dex to AC', out('ac.parts.dex', { format: 'signed', title: 'Capped by the armour you are wearing.' })),
      labelled('Check penalty', out('ac.acp')),
      labelled('Spell failure', out('ac.arcaneSpellFailure')),
    ),
    h('div.totals',
      total('AC', 'ac.total', { big: true }),
      total('Touch', 'ac.touch'),
      total('Flat-footed', 'ac.flatFooted'),
      total('Initiative', 'initiative.total', { format: 'signed' })));

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
      total('Bull rush', 'attacks.bullRush', { format: 'signed' })));

  const saveBlock = h('div.block',
    h('h3', 'Saving throws'),
    h('div.save-grid',
      h('span.label', { text: '' }),
      h('span.label', { text: 'Base' }),
      h('span.label', { text: 'Ability' }),
      h('span.label', { text: 'Magic' }),
      h('span.label', { text: 'Misc' }),
      h('span.label', { text: 'Total' }),
      SAVES.map(([key, name]) => frag(
        h('span.ability-name', { text: name }),
        out(`saves.${key}.base`, { format: 'signed' }),
        out(`saves.${key}.ability`, { format: 'signed' }),
        field(`saves.magic.${key}`, c.saves?.magic?.[key], { type: 'int' }),
        field(`saves.misc.${key}`, c.saves?.misc?.[key], { type: 'int' }),
        out(`saves.${key}.total`, { big: true, format: 'signed' })))));

  const weaponHost = h('div.weapons');
  const rebuildWeapons = () => refill(weaponHost, (c.weapons || []).map((w, i) => h('div.weapon-row',
    field(`weapons.${i}.name`, w.name, { placeholder: 'Weapon', className: 'grow' }),
    labelled('Atk', field(`weapons.${i}.attackBonus`, w.attackBonus, { type: 'int', width: '3.5rem', title: 'The weapon own enhancement, masterwork included.' })),
    labelled('Damage', field(`weapons.${i}.damageDice`, w.damageDice, { placeholder: '1d8', width: '5rem' })),
    labelled('Dmg +', field(`weapons.${i}.damageBonus`, w.damageBonus, { type: 'int', width: '3.5rem' })),
    labelled('Crit', field(`weapons.${i}.crit`, w.crit, { placeholder: '20/x2', width: '5rem' })),
    checkbox(`weapons.${i}.ranged`, w.ranged, 'Ranged'),
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
      c.weapons.push({ name: '', attackBonus: 0, damageDice: '', damageBonus: 0, crit: '', ranged: false, finesse: false });
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
  const subtyped = app.rules.skills.skills.filter((s) => s.subtype);

  const rebuild = () => refill(host, skillRows(app));

  const addRow = row(
    labelled('Add', select('', '', [['', '- a skill with a subject -'], ...subtyped.map((s) => [s.name, s.name])], { className: 'grow' })),
    field('', '', { placeholder: 'Subject, e.g. nature', className: 'grow' }),
    button('Add', (ev) => {
      const wrap = ev.target.closest('.row');
      const name = wrap.querySelector('select').value;
      const subtypeField = wrap.querySelector('input');
      if (!name) return;
      app.character.skills.push({ name, subtype: subtypeField.value.trim(), ranks: 0, misc: 0 });
      subtypeField.value = '';
      rebuild();
      app.recompute();
    }),
    h('span.hint', { text: 'Craft, Knowledge, Perform and Profession are taken one subject at a time.' }));

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
      h('span.label', { text: 'Max' }),
      h('span.label', { text: 'Cost' })),
    host,
    addRow);

  rebuild();
  return panelEl;
}

function skillRows(app) {
  return app.character.skills.map((entry, i) => {
    const def = app.rules.skillsByName.get(entry.name) || {};
    const label = entry.subtype ? `${entry.name} (${entry.subtype})` : entry.name;
    return h('div.skill-row', { dataset: { skill: String(i) } },
      h('span.class-dot', { dataset: { out: `skills.lines.${i}.classSkill`, format: 'dot' },
        title: 'Filled when the skill is on a class list you have taken.' }),
      h('span.skill-name', { text: label, title: def.trainedOnly ? 'Trained only: useless at 0 ranks.' : '' },
        def.acp ? h('span.tag', { text: def.acpDouble ? 'armour x2' : 'armour', title: 'The armour check penalty applies.' }) : null,
        def.trainedOnly ? h('span.tag', { text: 'trained' }) : null),
      out(`skills.lines.${i}.total`, { big: true, format: 'signed' }),
      out(`skills.lines.${i}.abilityMod`, { format: 'signed' }),
      field(`skills.${i}.ranks`, entry.ranks, { type: 'int', step: '0.5' }),
      field(`skills.${i}.misc`, entry.misc, { type: 'int' }),
      out(`skills.lines.${i}.maxRanks`),
      out(`skills.lines.${i}.cost`),
      def.subtype
        ? button('x', () => {
          app.character.skills.splice(i, 1);
          app.rebuildPanel('skills');
          app.recompute();
        }, { subtle: true, title: 'Remove this line' })
        : h('span'));
  });
}

/* ==========================================================================
   Feats, traits and flaws
   ========================================================================== */

export function featsPanel(app) {
  const c = app.character;
  const hosts = {
    feats: h('div.list'),
    traits: h('div.list'),
    flaws: h('div.list'),
  };

  const rebuild = () => {
    for (const [key, host] of Object.entries(hosts)) {
      refill(host, (c[key] || []).map((entry, i) => h('div.list-row',
        field(`${key}.${i}.name`, entry.name, { placeholder: key === 'feats' ? 'Feat' : key === 'traits' ? 'Trait' : 'Flaw', className: 'grow' }),
        field(`${key}.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
        key === 'feats'
          ? select(`feats.${i}.source`, entry.source, [['level', 'level'], ['flaw', 'flaw'], ['class', 'class'], ['race', 'race'], ['other', 'other']], { className: 'narrow' })
          : null,
        button('x', () => {
          c[key].splice(i, 1);
          rebuild();
          app.recompute();
        }, { subtle: true, danger: true }))));
    }
  };

  const add = (key) => button(`Add a ${key.replace(/s$/, '')}`, () => {
    c[key].push(key === 'feats' ? { name: '', effect: '', source: 'level' } : { name: '', effect: '' });
    rebuild();
    app.recompute();
  });

  rebuild();
  return panel('feats', 'Feats, traits and flaws',
    h('div.summary-strip',
      total('Feats earned', 'feats.allowed'),
      total('Taken', 'feats.taken'),
      total('From levels', 'feats.fromLevels'),
      total('From flaws', 'feats.fromFlaws'),
      h('span.hint', { text: 'Two traits and two flaws, and each flaw buys a feat. No third-party or homebrew sources.' })),
    h('div.block', h('h3', 'Feats'), hosts.feats, add('feats'),
      row(labelled('Granted elsewhere', field('featSlots.bonus', c.featSlots?.bonus, { type: 'int', width: '3.5rem', title: 'Bonus feats from a race or class - a human 1, a fighter its own.' })))),
    h('div.block', h('h3', 'Traits'), hosts.traits, add('traits')),
    h('div.block', h('h3', 'Flaws'), hosts.flaws, add('flaws')));
}

/* ==========================================================================
   Houserules: action points and taint
   ========================================================================== */

export function houserulesPanel(app) {
  const c = app.character;

  const apBlock = h('div.block',
    h('h3', 'Action points'),
    row(
      total('Pool', 'actionPoints.earned'),
      labelled('Spent', field('actionPoints.spent', c.actionPoints?.spent, { type: 'int', width: '4rem' })),
      total('Remaining', 'actionPoints.remaining', { big: true }),
      labelled('Bonus', field('actionPoints.bonus', c.actionPoints?.bonus, { type: 'int', width: '4rem', title: 'A prestige class or the DM may grant more.' })),
      total('One point rolls', 'actionPoints.roll'),
    ),
    h('p.hint', { text: 'One point a round, and a point spent on a special action is not also a point spent on a die roll. Spent points are gone for good.' }));

  const taintBlock = h('div.block',
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
      total('Effective taint', 'taint.effective', { title: 'Corruption and depravity together.' }),
      checkbox('taint.pureSoul', c.taint?.pureSoul, 'Pure Soul'),
      labelled('Exalted feats', field('taint.exaltedFeats', c.taint?.exaltedFeats, { type: 'int', width: '3.5rem', title: 'Pure Soul counts itself.' })),
      total('Bonus to resist', 'taint.resistBonus', { format: 'signed' }),
    ),
    row(labelled('Notes', textarea('taint.notes', c.taint?.notes, { rows: 2, placeholder: 'Symptoms rolled, absorbing items carried, cleansings undertaken.' }), { wide: true })));

  return panel('houserules', 'Action points and taint', apBlock, taintBlock);
}

/* ==========================================================================
   Wealth
   ========================================================================== */

export function wealthPanel(app) {
  const c = app.character;
  const host = h('div.list');

  const rebuild = () => refill(host, (c.wealth?.items || []).map((item, i) => h('div.list-row',
    field(`wealth.items.${i}.name`, item.name, { placeholder: 'Item', className: 'grow' }),
    labelled('Qty', field(`wealth.items.${i}.qty`, item.qty, { type: 'int', width: '3.5rem' })),
    labelled('Value each', field(`wealth.items.${i}.value`, item.value, { type: 'int', width: '6rem' })),
    labelled('Line', out(`wealth.items.${i}.lineValue`, { format: 'gp' })),
    h('span.flag', { dataset: { out: `wealth.items.${i}.overCap`, format: 'cap' }, text: '' }),
    button('x', () => {
      c.wealth.items.splice(i, 1);
      rebuild();
      app.recompute();
    }, { subtle: true, danger: true }))));

  rebuild();
  return panel('wealth', 'Wealth',
    h('div.summary-strip',
      total('Expected at this level', 'wealth.expected', { format: 'gp' }),
      total('Held', 'wealth.held', { format: 'gp' }),
      total('Single item cap', 'wealth.cap', { format: 'gp' })),
    row(
      labelled('Starting gold', field('wealth.startingGold', c.wealth?.startingGold, { type: 'int', width: '7rem', placeholder: 'by level' })),
      labelled('Coin in hand', field('wealth.gold', c.wealth?.gold, { type: 'int', width: '7rem' })),
      h('span.hint', { text: 'No single item may be worth more than half your starting gold at 1st level, or a quarter of it after.' })),
    host,
    button('Add an item', () => {
      c.wealth.items.push({ name: '', qty: 1, value: 0 });
      rebuild();
      app.recompute();
    }));
}

/* ==========================================================================
   The written half
   ========================================================================== */

export function textPanel(app) {
  const t = app.character.text || {};
  const blocks = [
    ['classFeatures', 'Class features', 'Rage, sneak attack, wild shape, the lot - and what this campaign has altered about them.'],
    ['spells', 'Spells', 'Known, prepared, per day. Anything you can cast must be written down somewhere the DM can read it.'],
    ['powers', 'Powers', 'Powers known and power points.'],
    ['languages', 'Languages', ''],
    ['equipment', 'Equipment', 'What is carried, worn and stowed.'],
    ['backstory', 'Backstory', 'Where they came from. This is what shapes the world around you.'],
    ['notes', 'Notes', ''],
  ];
  return panel('text', 'Features, spells and story',
    ...blocks.map(([key, label, hint]) => h('div.block',
      h('h3', label),
      hint ? h('p.hint', { text: hint }) : null,
      textarea(`text.${key}`, t[key], { rows: key === 'backstory' ? 10 : 5 }))));
}

/* ==========================================================================
   The casting summary, shown only when a casting class is taken
   ========================================================================== */

export function castingPanel() {
  return panel('casting', 'Casting and manifesting',
    h('div.casting-host', { dataset: { castingHost: '' } }),
    h('p.hint', { text: 'Spells per day come from the class tables on the wiki; what the sheet works out is the save DC and the bonus slots a high ability grants.' }));
}
