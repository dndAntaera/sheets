// The test suite, written so it can run in two places: under `node --test`
// (test/engine.test.js) and in a browser (test/browser.html). Whoever is working
// on this repo may not have Node installed, and a suite nobody can run is a
// suite that rots.
//
// Cases are chosen for the arithmetic that is easy to get wrong and expensive
// to get wrong: where 3.5 rounds, where multiclassing adds instead of replacing,
// the gestalt best-of rule, the bonus stacking rules - and the line between the
// SRD ruleset and a campaign's, which must never leak in either direction.

import {
  abilityMod, babFor, saveFor, iterativeAttacks, makeRules, buildSummary,
  pointBuyCost, rolledArrayCheck, bonusSlots, skillPointBudget, maxRanks,
  hitPoints, armorClass, attacks, actionPoints, taintSeverity, wealth,
  levelAdjustment, trainingTime, blankCharacter, derive, migrate,
  resolveEffects, collectEffects, abilityTotals, moduleState, blankEntry, embed,
} from '../web/engine/index.js';

export function buildSuite(data) {
  const srd = makeRules(data, 'srd');
  const antaera = makeRules(data, 'antaera');
  const cases = [];
  const test = (name, run) => cases.push({ name, run });

  /** A character with the given per-level class pairs, on a blank sheet. */
  const characterWith = (rules, levels, extra = {}) => {
    const c = blankCharacter(rules);
    c.levels = levels.map(([a, b], i) => ({ level: i + 1, a, b: b || '' }));
    return { ...c, ...extra };
  };
  const repeat = (pair, n) => Array.from({ length: n }, () => pair);
  const medium = srd.core.sizes.find((s) => s.name === 'Medium');
  const small = srd.core.sizes.find((s) => s.name === 'Small');

  /* === the rounding ===================================================== */

  test('ability modifiers round down, and an odd score adds nothing', (t) => {
    t.eq(abilityMod(10), 0);
    t.eq(abilityMod(11), 0);
    t.eq(abilityMod(12), 1);
    t.eq(abilityMod(8), -1);
    t.eq(abilityMod(7), -2);
    t.eq(abilityMod(18), 4);
    t.eq(abilityMod(3), -4);
  });

  test('base attack bonus per progression', (t) => {
    t.eq(babFor('good', 5), 5);
    t.eq(babFor('average', 5), 3, 'average is three quarters, rounded down');
    t.eq(babFor('average', 4), 3);
    t.eq(babFor('poor', 5), 2);
    t.eq(babFor('poor', 1), 0, 'a wizard has no attack bonus at first level');
    t.eq(babFor('good', 20), 20);
  });

  test('base saves per progression', (t) => {
    t.eq(saveFor('good', 1), 2, 'a good save starts at +2');
    t.eq(saveFor('good', 5), 4);
    t.eq(saveFor('good', 20), 12);
    t.eq(saveFor('poor', 1), 0);
    t.eq(saveFor('poor', 3), 1);
    t.eq(saveFor('poor', 20), 6);
    t.eq(saveFor(null, 20), 0, 'an unknown progression adds nothing');
  });

  test('the attack routine gains an attack at +6 and every +5 after', (t) => {
    t.eq(iterativeAttacks(5), [5]);
    t.eq(iterativeAttacks(6), [6, 1]);
    t.eq(iterativeAttacks(11), [11, 6, 1]);
    t.eq(iterativeAttacks(20), [20, 15, 10, 5]);
  });

  /* === multiclassing adds, gestalt picks ================================ */

  test('a multiclass build sums each class progression separately', (t) => {
    const c = characterWith(srd, [...repeat(['Fighter'], 3), ...repeat(['Rogue'], 3)]);
    const s = buildSummary(c, srd, false);
    t.eq(s.bab, 5, 'Fighter 3 (+3) plus Rogue 3 (+2), not a +4 six-level average');
    t.eq(s.baseSaves.fort, 4, 'good 3 (+3) plus poor 3 (+1)');
    t.eq(s.baseSaves.ref, 4, 'poor 3 (+1) plus good 3 (+3)');
    t.eq(s.label, 'Fighter 3/Rogue 3');
  });

  test('gestalt takes the better total, not the sum', (t) => {
    const c = characterWith(srd, repeat(['Fighter', 'Wizard'], 3));
    const s = buildSummary(c, srd, true);
    t.eq(s.bab, 3, 'the fighter side, not fighter plus wizard');
    t.eq(s.baseSaves.fort, 3, 'good from the fighter');
    t.eq(s.baseSaves.will, 3, 'good from the wizard');
    t.eq(s.baseSaves.ref, 1, 'both sides are poor, so poor it stays');
    t.eq(s.hitDice.map((h) => h.die), [10, 10, 10], 'the d10, never the d4');
    t.eq(s.label, 'Fighter 3 // Wizard 3');
  });

  test('gestalt hit dice and skill points are per level, from either side', (t) => {
    const s = buildSummary(characterWith(srd, [['Barbarian', 'Bard']]), srd, true);
    t.eq(s.hitDice[0].die, 12, 'the barbarian d12');
    t.eq(s.skillPointsPerLevel[0].base, 6, 'the bard 6, not the barbarian 4');
    t.ok(s.classSkills.has('Perform'), 'the bard list counts');
    t.ok(s.classSkills.has('Survival'), 'and so does the barbarian list');
  });

  test('with gestalt off the second column is ignored entirely', (t) => {
    const s = buildSummary(characterWith(srd, repeat(['Wizard', 'Fighter'], 3)), srd, false);
    t.eq(s.bab, 1, 'three wizard levels, poor progression');
    t.eq(s.hitDice[0].die, 4);
    t.eq(s.baseSaves.fort, 1);
  });

  test('a good save on both sides is still only one good save', (t) => {
    const s = buildSummary(characterWith(srd, repeat(['Monk', 'Ranger'], 3)), srd, true);
    t.eq(s.baseSaves.will, 3, 'the monk brings it; the ranger does not double it');
    t.eq(s.bab, 3, 'the ranger full progression beats the monk three quarters');
  });

  test('hit dice, level adjustment and ECL are counted apart', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 3));
    c.race = { ...c.race, name: 'Something odd', racialHD: 2, la: 1 };
    const s = buildSummary(c, srd, false);
    t.eq(s.classLevels, 3);
    t.eq(s.hitDiceCount, 5, 'three class levels plus two racial hit dice');
    t.eq(s.ecl, 6, 'and the level adjustment on top');
    t.eq(s.featsFromLevels, 2, 'one at first, one per three hit dice');
    t.eq(s.abilityIncreases, 1, 'one at fourth');
  });

  /* === abilities ======================================================== */

  test('point buy spends from a base of eight, against the chosen budget', (t) => {
    const all8 = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    t.eq(pointBuyCost(all8, srd).spent, 0);
    const spread = { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 8 };
    t.eq(pointBuyCost(spread, srd, 25).spent, 28, '10 + 6 + 6 + 4 + 2 + 0');
    t.ok(!pointBuyCost(spread, srd, 25).ok, '28 is over a 25-point game');
    t.ok(pointBuyCost(spread, srd, 32).ok, 'and within a 32-point one');
    t.eq(pointBuyCost(spread, antaera).budget, 30, 'Antaera fixes its budget at 30');
  });

  test('the SRD never bounds a rolled array; Antaera keeps 65 to 85', (t) => {
    const low = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    t.ok(rolledArrayCheck(low, srd).ok, 'a 60 is fine in a public creator');
    t.ok(rolledArrayCheck(low, antaera).tooLow, 'and a reroll in Antaera');
    const high = { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 };
    t.ok(rolledArrayCheck(high, antaera).tooHigh);
    t.ok(rolledArrayCheck({ str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 9 }, antaera).ok);
  });

  test('bonus spell slots match the printed table', (t) => {
    t.eq(bonusSlots(4)[1], 1);
    t.eq(bonusSlots(4)[4], 1);
    t.eq(bonusSlots(4)[5], 0);
    t.eq(bonusSlots(9)[1], 3, 'a +9 modifier gives three first-level slots');
    t.eq(bonusSlots(9)[2], 2);
    t.eq(bonusSlots(9)[9], 1);
    t.eq(bonusSlots(0)[1], 0);
  });

  test('ability totals stack race, level, typed bonuses and temporary changes', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 4));
    c.race.name = 'Half-Orc';
    c.abilities.base.str = 16;
    c.abilities.levelUps = { 4: 'str' };
    c.abilities.enhancement.str = 2;
    c.abilities.temp.str = 4;
    const d = derive(c, srd);
    t.eq(d.abilities.str.parts.racial, 2, 'the half-orc +2, from the race itself');
    t.eq(d.abilities.str.total, 25, '16 + 2 race + 1 level + 2 enhancement + 4 temporary');
    t.eq(d.abilities.str.mod, 7);
    t.eq(d.abilities.str.baseTotal, 21, 'without the temporary change');
    t.eq(d.abilities.int.parts.racial, -2);
  });

  /* === skills =========================================================== */

  test('first level buys four times the per-level points', (t) => {
    const s = buildSummary(characterWith(srd, repeat(['Rogue'], 3)), srd, false);
    const b = skillPointBudget(s, 2);
    t.eq(b.rows[0].points, 40, '(8 + 2) x 4');
    t.eq(b.rows[1].points, 10);
    t.eq(b.total, 60);
  });

  test('a level never gives less than one skill point', (t) => {
    const s = buildSummary(characterWith(srd, repeat(['Fighter'], 2)), srd, false);
    const b = skillPointBudget(s, -3);
    t.eq(b.rows[0].points, 4, 'even the quadrupled first level floors at one per level');
    t.eq(b.rows[1].points, 1);
  });

  test('rank caps follow hit dice, and cross-class keeps its half', (t) => {
    t.eq(maxRanks(3, true), 6);
    t.eq(maxRanks(3, false), 3);
    t.eq(maxRanks(4, false), 3.5, 'halves are real ranks, not rounded away');
  });

  test('cross-class ranks cost double, and the sheet notices overspending', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 3));
    c.abilities.base = { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 8 };
    c.skills = [
      { name: 'Climb', subtype: '', ranks: 6, misc: 0 },
      { name: 'Hide', subtype: '', ranks: 3, misc: 0 },
      { name: 'Jump', subtype: '', ranks: 1, misc: 0 },
    ];
    const d = derive(c, srd);
    t.eq(d.skills.budget.total, 12, '(2 + 0) x 4, then 2 and 2');
    t.eq(d.skills.spent, 13, '6 and 1 on class skills, 6 for three cross-class ranks');
    t.ok(d.notices.some((n) => n.level === 'error' && /overspent/.test(n.text)));
  });

  test('armour check penalty reaches the skill line, doubled for Swim', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 3));
    c.gear.armor = { name: 'Full plate', bonus: 8, maxDex: 1, acp: 6, asf: 35, speed: 20 };
    c.skills = ['Climb', 'Swim', 'Spot'].map((name) => ({ name, subtype: '', ranks: 0, misc: 0 }));
    const d = derive(c, srd);
    const line = (name) => d.skills.lines.find((l) => l.name === name);
    t.eq(line('Climb').acp, 6);
    t.eq(line('Swim').acp, 12, 'Swim is the one skill that suffers it twice');
    t.eq(line('Spot').acp, 0);
  });

  /* === hit points ======================================================= */

  test('hit points are maximum at first level, then by the chosen method', (t) => {
    const rows = [{ level: 1, die: 10 }, { level: 2, die: 10 }, { level: 3, die: 10 }];
    const avg = hitPoints(rows, { method: 'average' }, 2, srd);
    t.eq(avg.perLevel[0].gained, 12, 'the full die plus Constitution');
    t.eq(avg.perLevel[1].gained, 8, 'half the die plus one, plus Constitution');
    t.eq(avg.total, 28);
    const rolled = hitPoints(rows, { method: 'roll', rolls: { 2: 7, 3: 3 } }, 2, srd);
    t.eq(rolled.total, 26);
  });

  test('a level always gives at least one hit point', (t) => {
    const hp = hitPoints([{ level: 1, die: 4 }, { level: 2, die: 4 }], { method: 'average' }, -5, srd);
    t.eq(hp.perLevel[0].gained, 1);
    t.eq(hp.perLevel[1].gained, 1);
  });

  test('racial hit dice mean the first class level is not maximised', (t) => {
    const rows = [{ level: 1, die: 10 }];
    t.eq(hitPoints(rows, { method: 'average' }, 0, srd, { racialHD: 0 }).total, 10);
    t.eq(hitPoints(rows, { method: 'average' }, 0, srd, { racialHD: 2 }).total, 6, 'the average instead');
  });

  /* === defence and offence ============================================== */

  test('armour class, touch and flat-footed split the bonuses correctly', (t) => {
    const gear = {
      armor: { bonus: 5, maxDex: 3, acp: 4 },
      shield: { bonus: 2 },
      natural: 1, deflection: 1, dodge: 1, misc: 0,
    };
    const ac = armorClass(gear, 4, 0);
    t.eq(ac.dex.applied, 3, 'Dexterity is capped by the armour');
    t.eq(ac.total, 23, '10 + 5 + 2 + 1 + 1 + 1 + 3');
    t.eq(ac.touch, 15, 'armour, shield and natural armour drop out');
    t.eq(ac.flatFooted, 19, 'Dexterity and dodge drop out');
  });

  test('a Dexterity penalty still applies when flat-footed', (t) => {
    const ac = armorClass({}, -2, 0);
    t.eq(ac.total, 8);
    t.eq(ac.flatFooted, 8, 'being caught unawares does not make you less clumsy');
  });

  test('size enters attacks and grapple with different numbers', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 3));
    c.abilities.base = { str: 14, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
    const s = buildSummary(c, srd, false);
    const set = attacks(s, abilityTotals(c, s), small);
    t.eq(set.melee.total, 6, '+3 base, +2 Strength, +1 for being small');
    t.eq(set.grapple.total, 1, 'but small hurts in a hold: +3 +2 -4');
    t.eq(set.trip, -2);
  });

  test('the routine comes from the base attack bonus, never from the total', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 3));
    c.abilities.base = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    let s = buildSummary(c, srd, false);
    t.eq(attacks(s, abilityTotals(c, s), medium).melee.routine, '+6', 'a 16 Strength does not buy a second attack');
    c.levels = repeat(['Fighter'], 6).map(([a], i) => ({ level: i + 1, a, b: '' }));
    s = buildSummary(c, srd, false);
    t.eq(attacks(s, abilityTotals(c, s), medium).melee.routine, '+9/+4');
  });

  /* === rulesets: the SRD is the default and adds nothing ================ */

  test('a new character is a 1st-level SRD character by default', (t) => {
    const c = blankCharacter(srd);
    t.eq(c.ruleset, 'srd');
    t.eq(c.levels.length, 1);
    t.eq(c.abilities.pointBuyBudget, 32);
    const d = derive(c, srd);
    t.eq(d.actionPoints, null, 'no action points');
    t.eq(d.taint, null, 'no taint');
    t.eq(d.training, null, 'no training time');
    t.ok(!d.notices.some((n) => /background/i.test(n.text)), 'no background demanded');
    t.ok(!d.notices.some((n) => /start at level/.test(n.text)), 'no starting level imposed');
  });

  test('the same character under Antaera gains the campaign systems', (t) => {
    const c = characterWith(antaera, repeat(['Fighter'], 3));
    const d = derive(c, antaera);
    t.eq(d.actionPoints.earned, 6, '5 + half of 3');
    t.ok(d.taint !== null, 'taint is tracked');
    t.ok(d.notices.some((n) => /background/i.test(n.text)), 'a background is required');
    t.eq(blankCharacter(antaera).levels.length, 3, 'and characters start at 3rd level');
  });

  test('SRD variants are the player choice; Antaera modules are not', (t) => {
    const c = blankCharacter(srd);
    t.eq(moduleState(srd, c, 'actionPoints').on, false, 'off by default');
    t.ok(moduleState(srd, c, 'actionPoints').choosable, 'but the player may switch it on');
    c.options.actionPoints = true;
    t.ok(derive(c, srd).actionPoints !== null, 'and then the pool appears');
    t.eq(moduleState(srd, c, 'taint').available, false, 'taint is not an SRD variant at all');

    const a = blankCharacter(antaera);
    a.options.taint = false;
    t.eq(moduleState(antaera, a, 'taint').on, true, 'a player cannot switch the campaign rules off');
    t.eq(moduleState(antaera, a, 'gestalt', { gestalt: false }).on, false, 'the DM switch wins');
  });

  test('level adjustment is uncapped under the SRD and capped in Antaera', (t) => {
    t.ok(levelAdjustment(4, 3, srd).ok, 'a public creator imposes no limit');
    t.eq(levelAdjustment(4, 3, srd).allowed, null);
    t.ok(levelAdjustment(1, 3, antaera).ok);
    t.ok(!levelAdjustment(2, 3, antaera).ok);
    t.ok(levelAdjustment(2, 8, antaera).ok);
  });

  test('wealth caps apply only where the ruleset enforces them', (t) => {
    const c = blankCharacter(srd);
    c.wealth.items = [{ name: 'Ring', value: 700, qty: 1 }];
    const open = wealth(c, 3, srd);
    t.eq(open.expected, 2700, 'the expectation is shown either way');
    t.eq(open.cap, null, 'but the SRD caps nothing');
    t.eq(open.overCapItems.length, 0);
    const capped = wealth(c, 3, antaera);
    t.eq(capped.cap, 675, 'a quarter of wealth by level, after first');
    t.eq(capped.overCapItems.length, 1);
  });

  test('odd ability enhancements are only a problem in Antaera', (t) => {
    const make = (rules) => {
      const c = characterWith(rules, repeat(['Fighter'], 3));
      c.abilities.enhancement.str = 3;
      return derive(c, rules);
    };
    t.ok(!make(srd).notices.some((n) => /even numbers/.test(n.text)));
    t.ok(make(antaera).notices.some((n) => /even numbers/.test(n.text)));
  });

  test('an old Antaera-only sheet keeps its ruleset and its custom classes', (t) => {
    const old = {
      schema: 1, name: 'Vashti', levels: [{ level: 1, a: 'Warblade', b: '' }],
      customClasses: [{ name: 'Warblade', hd: 12, bab: 'good', saves: { fort: 'good', ref: 'poor', will: 'poor' }, skillPoints: 4, classSkills: [] }],
    };
    const c = migrate(old);
    t.eq(c.ruleset, 'antaera', 'not silently re-read under the SRD');
    t.eq(c.content.classes[0].name, 'Warblade');
    t.eq(c.customClasses, undefined);
  });

  /* === campaign modules ================================================= */

  test('action points follow level, and the die count follows the band', (t) => {
    t.eq(actionPoints(1, 0, antaera).earned, 5);
    t.eq(actionPoints(3, 0, antaera).earned, 6);
    t.eq(actionPoints(10, 4, antaera).remaining, 6);
    t.eq(actionPoints(7, 0, antaera).dice, 1);
    t.eq(actionPoints(8, 0, antaera).dice, 2);
    t.eq(actionPoints(15, 0, antaera).dice, 3);
  });

  test('taint severity is read against the resisting ability', (t) => {
    const con14 = (score) => taintSeverity(score, 14, antaera).severity;
    t.eq(con14(3), 'none');
    t.eq(con14(8), 'mild');
    t.eq(con14(12), 'moderate');
    t.eq(con14(20), 'severe');
    t.eq(con14(25), 'past');
    t.eq(taintSeverity(8, 4, antaera).severity, 'moderate', 'a frail character shows it sooner');
    t.eq(taintSeverity(5, 14, antaera).toNext, 2);
  });

  test('gestalt training overlaps, and the far-ahead class trains at three quarters', (t) => {
    // The wiki's own example: Fighter 7 alongside Sorcerer 3 costs "2 days and 1 day".
    const level = trainingTime([{ classLevel: 7, prestige: false }, { classLevel: 3, prestige: false }], antaera, true);
    t.eq(level.perSide, [2, 1]);
    t.eq(level.days, 2);
    t.eq(trainingTime([{ classLevel: 1, prestige: true }], antaera, false).days, 3);
    t.eq(trainingTime([{ classLevel: 4, prestige: false }], antaera, false).days, 2);
  });

  test('a finished third-level Antaera gestalt sheet adds up end to end', (t) => {
    const c = characterWith(antaera, repeat(['Fighter', 'Rogue'], 3));
    c.abilities.base = { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 8 };
    c.gear.armor = { name: 'Chain shirt', bonus: 4, maxDex: 4, acp: 2, asf: 20, speed: null };
    c.background = { name: 'Soldier', item: '', notes: '' };
    c.skills = ['Climb', 'Hide', 'Move Silently', 'Spot', 'Listen'].map((name) => ({ name, subtype: '', ranks: 6, misc: 0 }));
    c.feats = [{ name: 'Power Attack' }, { name: 'Cleave' }];
    const d = derive(c, antaera, { gestalt: true });
    t.eq(d.summary.bab, 3);
    t.eq(d.saves.fort.total, 5);
    t.eq(d.saves.ref.total, 5);
    t.eq(d.hp.total, 28);
    t.eq(d.ac.total, 16);
    t.eq(d.skills.budget.total, 54);
    t.eq(d.skills.spent, 30);
    t.eq(d.actionPoints.earned, 6);
    t.ok(!d.notices.some((n) => n.level === 'error'), 'no errors on a legal sheet');
  });

  /* === effects: the stacking rules ====================================== */

  const fx = (target, type, value, source, extra = {}) => ({ target, type, value, source, condition: null, perLevel: false, ...extra });

  test('two bonuses of the same type do not stack; the larger applies', (t) => {
    const r = resolveEffects([
      fx('ac', 'deflection', 1, 'Ring of Protection +1'),
      fx('ac', 'deflection', 3, 'Shield of Faith'),
    ]);
    t.eq(r.ac.total, 3);
    t.eq(r.ac.suppressed.length, 1);
    t.eq(r.ac.suppressed[0].source, 'Ring of Protection +1');
  });

  test('dodge, circumstance and untyped bonuses stack with themselves', (t) => {
    const r = resolveEffects([
      fx('ac', 'dodge', 1, 'Dodge'),
      fx('ac', 'dodge', 4, 'Mobility'),
      fx('ac', 'untyped', 1, 'a'),
      fx('ac', 'untyped', 2, 'b'),
    ]);
    t.eq(r.ac.total, 8);
    t.eq(r.ac.suppressed.length, 0);
  });

  test('different types stack, and penalties always count', (t) => {
    const r = resolveEffects([
      fx('save.will', 'resistance', 2, 'Cloak'),
      fx('save.will', 'luck', 1, 'Stone'),
      fx('save.will', 'morale', -2, 'Curse one'),
      fx('save.will', 'morale', -1, 'Curse two'),
    ]);
    t.eq(r['save.will'].total, 0, '+2 +1 -2 -1: two penalties of one type both bite');
  });

  test('a conditional effect is listed, never added', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    c.race.name = 'Dwarf';
    const d = derive(c, srd);
    t.eq(d.saves.fort.bonuses, 0, 'the +2 against poison is not in the total');
    t.ok(d.saves.fort.conditions.some((e) => /poison/.test(e.condition)), 'but it is beside it');
    t.ok(d.ac.conditional.some((e) => /giants/.test(e.condition)));
  });

  test('a typed bonus on the sheet and an item of the same type do not both count', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    c.abilities.base.dex = 10;
    c.gear.deflection = 2;
    c.wealth.items = [{ name: 'Ring of Protection +1', equipped: true, effects: [{ target: 'ac', type: 'deflection', value: 1 }] }];
    const d = derive(c, srd);
    t.eq(d.ac.parts.deflection, 2, 'the better one');
    t.eq(d.ac.total, 12);
  });

  test('an effect per hit die scales with the character', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 5));
    c.features = [{ name: 'Tough as nails', effects: [{ target: 'hp', value: 1, perLevel: true }] }];
    t.eq(derive(c, srd).hp.effectBonus, 5);
  });

  test('an effect aimed at something unknown is reported', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    c.features = [{ name: 'Typo', effects: [{ target: 'armour class', value: 2 }] }];
    const d = derive(c, srd);
    t.ok(d.effects.unknown.includes('armour class'));
    t.ok(d.notices.some((n) => /does not know how to apply/.test(n.text)));
  });

  /* === SRD races, as effects =========================================== */

  test('a dwarf is +2 Con, -2 Cha, and slow', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    c.race.name = 'Dwarf';
    c.abilities.base = { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 };
    const d = derive(c, srd);
    t.eq(d.abilities.con.total, 16);
    t.eq(d.abilities.cha.total, 8);
    t.eq(d.speed, 20);
  });

  test('a halfling is Small, luckier and better at the listed skills', (t) => {
    const c = characterWith(srd, [['Rogue']]);
    c.race.name = 'Halfling';
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    c.skills = [{ name: 'Listen', subtype: '', ranks: 0, misc: 0 }];
    const d = derive(c, srd);
    t.eq(d.size.name, 'Small');
    t.eq(d.ac.total, 12, '10, +1 for a 12 Dexterity, +1 for being Small');
    t.eq(d.saves.will.total, 1, 'the +1 racial bonus to every save');
    t.eq(d.skills.lines[0].total, 2);
  });

  test('a human gets a bonus feat and an extra skill point a level', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 2));
    c.race.name = 'Human';
    c.abilities.base.int = 10;
    const d = derive(c, srd);
    t.eq(d.feats.allowed, 2, 'one from first level, one from being human');
    t.eq(d.skills.budget.total, 15, '(2 + 1) x 4, then 3');
  });

  /* === homebrew content ================================================ */

  test('a homebrew class counts exactly like a printed one', (t) => {
    const c = characterWith(srd, repeat(['Warblade'], 3));
    embed(c, 'class', { name: 'Warblade', hd: 12, bab: 'good', saves: { fort: 'good', ref: 'poor', will: 'poor' }, skillPoints: 4, classSkills: ['Balance', 'Climb', 'Jump'] });
    const d = derive(c, srd);
    t.eq(d.summary.bab, 3);
    t.eq(d.summary.baseSaves.fort, 3);
    t.eq(d.hp.perLevel[0].fromDie, 12);
    t.ok(d.summary.classSkills.has('Climb'));
    t.ok(!d.notices.some((n) => /Warblade/.test(n.text)));
  });

  test('a class nobody has defined is reported rather than scored', (t) => {
    const d = derive(characterWith(srd, repeat(['Warblade'], 3)), srd);
    t.eq(d.summary.bab, 0);
    t.ok(d.notices.some((n) => n.level === 'error' && /Warblade/.test(n.text)));
  });

  test('a homebrew race supplies its own numbers and effects', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    embed(c, 'race', {
      name: 'Stonekin', size: 'Medium', speed: 20, la: 1,
      abilityAdjust: { str: 2, dex: -2 },
      effects: [{ target: 'ac', type: 'natural', value: 2 }, { target: 'skill.Hide', type: 'racial', value: 4 }],
    });
    c.race.name = 'Stonekin';
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    c.skills = [{ name: 'Hide', subtype: '', ranks: 0, misc: 0 }];
    const d = derive(c, srd);
    t.eq(d.abilities.str.total, 12);
    t.eq(d.ac.total, 11, '10 - 1 Dex + 2 natural armour');
    t.eq(d.ac.touch, 9, 'natural armour does not help against a touch');
    t.eq(d.summary.ecl, 2, 'its level adjustment counts');
    t.eq(d.skills.lines[0].total, 3, '-1 Dex, +4 racial');
  });

  test('a homebrew feat with an effect changes the sheet when taken', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    embed(c, 'feat', { name: 'Iron Hide', effects: [{ target: 'ac', type: 'natural', value: 1 }, { target: 'save.fort', type: 'untyped', value: 1 }] });
    const before = derive(c, srd);
    c.feats = [{ name: 'Iron Hide' }];
    const after = derive(c, srd);
    t.eq(after.ac.total - before.ac.total, 1);
    t.eq(after.saves.fort.total - before.saves.fort.total, 1);
  });

  test('an item affects the sheet only while it is equipped', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    embed(c, 'item', { name: 'Cloak of Resistance +2', value: 4000, effects: [{ target: 'save.all', type: 'resistance', value: 2 }] });
    c.wealth.items = [{ name: 'Cloak of Resistance +2', qty: 1, value: 4000, equipped: true }];
    t.eq(derive(c, srd).saves.will.bonuses, 2);
    c.wealth.items[0].equipped = false;
    t.eq(derive(c, srd).saves.will.bonuses, 0, 'in a backpack it protects nobody');
  });

  test('a homebrew skill joins the table with its own key ability', (t) => {
    const c = characterWith(srd, [['Fighter']]);
    embed(c, 'skill', { name: 'Seamanship', ability: 'wis', acp: true });
    c.abilities.base.wis = 14;
    c.gear.armor = { bonus: 4, acp: 3 };
    c.skills = [{ name: 'Seamanship', subtype: '', ranks: 2, misc: 0 }];
    const d = derive(c, srd);
    t.eq(d.skills.lines[0].total, 1, '+2 Wisdom + 2 ranks - 3 armour');
    t.ok(!d.notices.some((n) => /Seamanship/.test(n.text)));
  });

  test('a template stacks its level adjustment and abilities onto the race', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 4));
    c.race.name = 'Elf';
    embed(c, 'template', {
      name: 'Half-Dragon', la: 3, abilityAdjust: { str: 8, con: 2, int: 2, cha: 2 },
      effects: [{ target: 'ac', type: 'natural', value: 4 }],
    });
    c.templates = [{ name: 'Half-Dragon' }];
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    const d = derive(c, srd);
    t.eq(d.abilities.con.total, 10, '-2 elf, +2 half-dragon');
    t.eq(d.abilities.str.total, 18);
    t.eq(d.summary.ecl, 7);
    t.eq(d.ac.parts.natural, 4);
  });

  test('the editor starts every kind of content from a usable blank', (t) => {
    for (const kind of ['race', 'class', 'feat', 'skill', 'item', 'template', 'feature']) {
      t.eq(blankEntry(kind).name, '', `${kind} has a name`);
    }
    t.eq(blankEntry('class').saves, { fort: 'poor', ref: 'poor', will: 'poor' });
    t.ok(Array.isArray(blankEntry('feat').effects));
  });

  test('collected effects say where they came from', (t) => {
    const all = collectEffects({ race: { name: 'Elf', effects: [{ target: 'skill.Spot', type: 'racial', value: 2 }] }, feats: [], items: [] });
    t.eq(all[0].source, 'Elf');
    t.eq(all[0].type, 'racial');
  });

  return cases;
}
