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
  mergeLibraries, fillMissing, applyCampaign, restedMagic, usesInSpecial, restedTrackers, VARIANT_MODULES,
  rollAbilityArray, newAbilityRolls, placeScore, parsePrerequisites, featRuleIndex, stateAtLevel, featEligibility,
  featOptions, languagePlan, featureKey, applyCampaign as campaignRules,
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

  test('rolling ability scores: 4d6, the lowest die dropped, six times', (t) => {
    // Dice come round 1..6 in turn: 1,2,3,4 then 5,6,1,2 and so on.
    let n = 0;
    const cycle = () => ((n++ % 6) + 0.5) / 6;
    const array = rollAbilityArray(cycle);
    t.eq(array.length, 6);
    t.eq(array[0], { dice: [1, 2, 3, 4], score: 9 }, 'the 1 is dropped');
    t.eq(array[1], { dice: [5, 6, 1, 2], score: 13 });
    const all = rollAbilityArray(Math.random);
    t.ok(all.every((r) => r.score >= 3 && r.score <= 18 && r.dice.every((d) => d >= 1 && d <= 6)), 'every score 3 to 18');
    t.eq([newAbilityRolls(srd).arrays.length, newAbilityRolls(antaera).arrays.length], [1, 2], 'Antaera rolls two sets');
    t.eq(newAbilityRolls(srd, { times: 2 }).times, 3, 'rolling again is counted');
  });

  test('rolled scores are placed where the player chooses, a taken one swapping', (t) => {
    const c = blankCharacter(srd);
    c.abilities.method = 'rolled';
    const scores = [15, 14, 13, 12, 10, 8];
    c.abilities.rolls = { arrays: [scores.map((score) => ({ dice: [], score }))], chosen: 0, times: 1 };
    const place = (key, i) => Object.assign(c.abilities, placeScore(c, srd, key, i));
    place('int', 0);
    place('dex', 1);
    let d = derive(c, srd);
    t.eq([c.abilities.base.int, c.abilities.base.dex, d.placement.unplaced], [15, 14, [2, 3, 4, 5]]);
    t.ok(d.notices.some((x) => x.text === '4 scores still to place.'), 'the sheet says what is left');
    place('dex', 0);
    t.eq([c.abilities.base.dex, c.abilities.base.int], [15, 14], 'giving INT\u2019s 15 to DEX hands DEX\u2019s 14 to INT');
    ['str', 'con', 'wis', 'cha'].forEach((key, i) => place(key, i + 2));
    d = derive(c, srd);
    t.eq([d.placement.unplaced, d.placement.matches], [[], true]);
    t.ok(!d.notices.some((x) => x.field === 'abilities'), 'nothing left to say');
    c.abilities.base.str = 18;
    t.ok(derive(c, srd).notices.some((x) => x.text.startsWith('The base scores are not the scores rolled')), 'a typed-over score is noticed');
  });

  test('the standard array is placed the same way', (t) => {
    const c = blankCharacter(srd);
    c.abilities.method = 'array';
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((key, i) => Object.assign(c.abilities, placeScore(c, srd, key, i)));
    const d = derive(c, srd);
    t.eq([c.abilities.base.str, c.abilities.base.cha, d.placement.method, d.placement.matches], [15, 8, 'array', true]);
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
    const c = characterWith(srd, repeat(['Wizard'], 2));
    c.race.name = 'Human';
    c.abilities.base.int = 10;
    const d = derive(c, srd);
    t.eq(d.feats.allowed, 2, 'one from first level, one from being human');
    t.eq(d.skills.budget.total, 15, '(2 + 1) x 4, then 3');
    t.eq(derive({ ...c, levels: characterWith(srd, repeat(['Fighter'], 2)).levels }, srd).feats.allowed, 4, 'and a fighter’s bonus feats at 1st and 2nd');
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

  test('a sparse character is filled out rather than breaking the sheet', (t) => {
    const sparse = { id: 'x', name: 'Only a name', ruleset: 'srd', levels: [{ level: 1, a: 'Rogue' }], abilities: { base: { str: 16 } } };
    const c = fillMissing(sparse, srd);
    t.eq(c.name, 'Only a name', 'what it had is kept');
    t.eq(c.levels.length, 1);
    t.ok(Array.isArray(c.skills) && c.skills.length > 30, 'what it lacked is added');
    t.eq(c.abilities.base.str, 16);
    t.eq(c.abilities.method, 'pointBuy', 'nested parts are filled too');
    const d = derive(c, srd);
    t.eq(d.summary.label, 'Rogue 1');
  });

  /* === syncing a library between devices =============================== */

  const entry = (id, updated, extra = {}) => ({ id, kind: 'class', name: id, updated, ...extra });
  const ids = (list) => list.map((e) => e.id).sort();

  test('a new entry here is uploaded, and a new one elsewhere is taken', (t) => {
    const r = mergeLibraries([entry('mine', '2026-01-01')], [entry('theirs', '2026-01-02')], {});
    t.eq(ids(r.entries), ['mine', 'theirs']);
    t.eq(ids(r.upload), ['mine']);
    t.eq(r.remove, []);
    t.ok(r.changed, 'the local library gained an entry');
    t.eq(r.synced, { mine: '2026-01-01', theirs: '2026-01-02' });
  });

  test('the newer copy of an entry wins, in either direction', (t) => {
    const newerHere = mergeLibraries([entry('a', '2026-02-01')], [entry('a', '2026-01-01')], { a: '2026-01-01' });
    t.eq(ids(newerHere.upload), ['a']);
    t.ok(!newerHere.changed);
    const newerThere = mergeLibraries([entry('a', '2026-01-01', { name: 'old' })], [entry('a', '2026-03-01', { name: 'new' })], { a: '2026-01-01' });
    t.eq(newerThere.entries[0].name, 'new');
    t.eq(newerThere.upload, []);
    t.ok(newerThere.changed);
  });

  test('an entry deleted here is deleted from the server', (t) => {
    const r = mergeLibraries([], [entry('gone', '2026-01-01')], { gone: '2026-01-01' });
    t.eq(r.remove, ['gone']);
    t.eq(r.entries, []);
    t.eq(r.synced, {}, 'and forgotten');
  });

  test('an entry deleted on another device is removed here', (t) => {
    const r = mergeLibraries([entry('gone', '2026-01-01')], [], { gone: '2026-01-01' });
    t.eq(r.entries, []);
    t.eq(r.upload, []);
    t.ok(r.changed);
  });

  test('when an edit and a deletion collide, the edit wins', (t) => {
    const editedHere = mergeLibraries([entry('a', '2026-05-01')], [], { a: '2026-01-01' });
    t.eq(ids(editedHere.upload), ['a'], 'deleted elsewhere, edited here: it comes back');
    const editedThere = mergeLibraries([], [entry('a', '2026-05-01')], { a: '2026-01-01' });
    t.eq(ids(editedThere.entries), ['a'], 'deleted here, edited elsewhere: it comes back');
    t.eq(editedThere.remove, []);
  });

  test('a first sign-in uploads everything made before it', (t) => {
    const r = mergeLibraries([entry('a', '1'), entry('b', '2'), entry('c', '3')], [], {});
    t.eq(ids(r.upload), ['a', 'b', 'c']);
    t.eq(r.remove, []);
  });

  test('agreement changes nothing and sends nothing', (t) => {
    const r = mergeLibraries([entry('a', '1')], [entry('a', '1')], { a: '1' });
    t.eq(r.upload, []);
    t.eq(r.remove, []);
    t.ok(!r.changed);
  });

  test('the merged library keeps this browser order, with new entries after', (t) => {
    const r = mergeLibraries([entry('z', '1'), entry('a', '1')], [entry('m', '1'), entry('a', '1')], { a: '1' });
    t.eq(r.entries.map((e) => e.id), ['z', 'a', 'm']);
  });

  /* === whose homebrew counts =========================================== */

  /** A fighter taking one feat of their own homebrew and one the campaign wrote. */
  const homebrewFighter = () => {
    const c = characterWith(srd, [['Fighter']]);
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    c.feats = [{ name: 'Stubborn' }, { name: 'Table Blessing' }];
    c.content.feats = [
      { id: 'mine', kind: 'feat', name: 'Stubborn', effects: [{ target: 'save.will', type: 'untyped', value: 2 }] },
      // The sheet's copy of the campaign's feat, edited to be better than it is.
      { id: 'theirs', kind: 'feat', name: 'Table Blessing', campaign: 'k1', effects: [{ target: 'save.fort', type: 'untyped', value: 5 }] },
    ];
    return c;
  };
  const tableLibrary = [{ id: 'theirs', kind: 'feat', name: 'Table Blessing', effects: [{ target: 'save.fort', type: 'untyped', value: 1 }] }];
  const inCampaign = (settings, content) => applyCampaign(srd, { id: 'k1', name: 'The Table', ruleset: 'srd', settings, content }).rules;

  test('an independent character counts all the homebrew it carries', (t) => {
    const d = derive(homebrewFighter(), srd);
    t.eq([d.saves.will.bonuses, d.saves.fort.bonuses], [2, 5]);
    t.eq(d.homebrew.blocked, []);
  });

  test('in a campaign, only the campaign’s homebrew counts, as its GMs wrote it', (t) => {
    const d = derive(homebrewFighter(), inCampaign({}, tableLibrary));
    t.eq(d.saves.will.bonuses, 0, 'the player’s own feat does not count');
    t.eq(d.saves.fort.bonuses, 1, 'the campaign’s feat counts from the campaign’s library, not the edited copy');
    t.eq(d.homebrew.blocked, [{ kind: 'feat', name: 'Stubborn' }]);
    t.ok(d.notices.some((n) => n.level === 'warn' && /Not counted in The Table: Stubborn/.test(n.text)));
  });

  test('a campaign that allows homebrew counts the player’s too', (t) => {
    const d = derive(homebrewFighter(), inCampaign({ allowHomebrew: true }, tableLibrary));
    t.eq([d.saves.will.bonuses, d.saves.fort.bonuses], [2, 1]);
    t.eq(d.homebrew.blocked, []);
  });

  test('without the campaign’s library to hand, the sheet’s copies of its entries stand in', (t) => {
    const d = derive(homebrewFighter(), inCampaign({}, undefined));
    t.eq([d.saves.will.bonuses, d.saves.fort.bonuses], [0, 5]);
    t.eq(d.homebrew.blocked.map((b) => b.name), ['Stubborn']);
  });

  test('nothing is taken off the sheet by a campaign’s rule', (t) => {
    const c = homebrewFighter();
    derive(c, inCampaign({}, tableLibrary));
    t.eq(c.content.feats.map((f) => f.name), ['Stubborn', 'Table Blessing']);
  });

  /* === spells and powers ================================================ */

  const caster = (cls, n, ability, score, extra = {}) => {
    const c = characterWith(srd, repeat([cls], n));
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ability]: score };
    return { ...c, ...extra };
  };
  const magicOf = (c, name) => derive(c, srd).magic.classes.find((m) => m.name === name);
  const perDay = (m) => m.levels.map((l) => l.perDay);

  test('a wizard’s spells per day are the table plus bonus spells, none at level 0', (t) => {
    const m = magicOf(caster('Wizard', 5, 'int', 16), 'Wizard');
    t.eq(perDay(m), [4, 4, 3, 2], 'table 4/3/2/1, Int 16 adds one each at 1st to 3rd');
    t.eq([m.casterLevel, m.levels[3].saveDC, m.spellbook], [5, 16, true]);
  });

  test('a specialist wizard gets a slot of her school at every level, and a low score closes a level', (t) => {
    t.eq(perDay(magicOf(caster('Wizard', 5, 'int', 16, { magic: { Wizard: { specialty: 'Evocation' } } }), 'Wizard')), [5, 5, 4, 3]);
    const dull = magicOf(caster('Wizard', 5, 'int', 11), 'Wizard');
    t.eq(perDay(dull), [4, 3, 0, 0], 'Int 11 casts no 2nd- or 3rd-level spells');
    t.eq(dull.levels[2].castable, false);
  });

  test('a sorcerer casts from spells known, and the sheet counts what is cast', (t) => {
    const c = caster('Sorcerer', 4, 'cha', 16, { magic: { Sorcerer: { used: { 1: 2 }, known: [{ name: 'Magic Missile', level: 1 }] } } });
    const m = magicOf(c, 'Sorcerer');
    t.eq(perDay(m), [6, 7, 4]);
    t.eq(m.levels.map((l) => l.knownAllowed), [6, 3, 1]);
    t.eq([m.levels[1].used, m.levels[1].remaining, m.levels[1].knownCount], [2, 5, 1]);
  });

  test('a cleric has a domain slot beside her own, and a paladin’s 0 is bonus spells only', (t) => {
    const cleric = magicOf(caster('Cleric', 1, 'wis', 15), 'Cleric');
    t.eq(perDay(cleric), [3, 3], '1st level: 1 + 1 bonus + 1 domain');
    t.eq(cleric.levels[1].domain, 1);
    const paladin = magicOf(caster('Paladin', 4, 'wis', 12), 'Paladin');
    t.eq([paladin.levels.map((l) => [l.level, l.perDay]), paladin.casterLevel], [[[1, 1]], 2]);
    t.eq(magicOf(caster('Paladin', 3, 'wis', 18), 'Paladin').levels, [], 'no spells before 4th level');
  });

  test('power points: the table plus modifier times manifester level over two, in one pool', (t) => {
    const psion = caster('Psion', 1, 'int', 14);
    t.eq(derive(psion, srd).magic.powerPoints.total, 3, '2 + (2 x 1) / 2');
    const m = magicOf(psion, 'Psion');
    t.eq([m.powersKnown.allowed, m.maxPowerLevel], [3, 1]);
    const both = characterWith(srd, [['Psion'], ['Psychic Warrior'], ['Psychic Warrior']]);
    both.abilities.base = { str: 10, dex: 10, con: 10, int: 14, wis: 14, cha: 10 };
    both.magic = { powerPointsUsed: 2 };
    const pool = derive(both, srd).magic.powerPoints;
    t.eq([pool.base, pool.bonus, pool.total, pool.remaining], [3, 3, 6, 4], 'Psion 1 (2 + 1) and Psychic Warrior 2 (1 + 2)');
  });

  test('the sheet says when more is known or cast than allowed, and rest clears the day', (t) => {
    const c = caster('Sorcerer', 1, 'cha', 12, { magic: { Sorcerer: { used: { 1: 9 }, known: [1, 2, 3].map((i) => ({ name: `Spell ${i}`, level: 1 })) } } });
    const d = derive(c, srd);
    t.ok(d.notices.some((n) => n.level === 'error' && /1st-level spells: 3 known, but only 2/.test(n.text)));
    t.ok(d.notices.some((n) => n.level === 'error' && /1st-level spells: 9 cast/.test(n.text)));
    const rested = restedMagic({ Sorcerer: { used: { 1: 9 }, prepared: { 1: [{ name: 'Sleep', used: true }] } }, powerPointsUsed: 5 });
    t.eq([rested.Sorcerer.used, rested.Sorcerer.prepared[1][0], rested.powerPointsUsed], [{}, { name: 'Sleep', used: false }, 0]);
  });

  /* === limited uses ======================================================== */

  const usesOf = (c) => Object.fromEntries(derive(c, srd).trackers.map((t) => [t.name, [t.max, t.per]]));

  test('uses in a class table special are read, the second of a pair included', (t) => {
    t.eq(usesInSpecial('Rage 4/day, trap sense +4'), [{ name: 'Rage', uses: 4, per: 'day' }]);
    t.eq(usesInSpecial('Wild shape (6/day, elemental 2/day)'), [
      { name: 'Wild shape', uses: 6, per: 'day' },
      { name: 'Wild shape (elemental)', uses: 2, per: 'day' },
    ]);
    t.eq(usesInSpecial('Remove Disease 3/week'), [{ name: 'Remove disease', uses: 3, per: 'week' }]);
    t.eq(usesInSpecial('Uncanny dodge'), []);
  });

  test('class uses follow the class level: the table’s latest figure, and the SRD’s formulas', (t) => {
    t.eq(usesOf(caster('Barbarian', 8, 'str', 16)).Rage, [3, 'day']);
    const druid = usesOf(caster('Druid', 18, 'wis', 16));
    t.eq([druid['Wild shape'], druid['Wild shape (elemental)']], [[6, 'day'], [2, 'day']]);
    const paladin = usesOf(caster('Paladin', 6, 'cha', 14));
    t.eq([paladin['Smite evil'], paladin['Remove disease'], paladin['Turn undead'], paladin['Lay on hands']],
      [[2, 'day'], [1, 'week'], [5, 'day'], [12, 'day']], 'smite 2, remove disease 1/week, turning 3 + 2, lay on hands 6 x 2');
    const monk = usesOf(caster('Monk', 7, 'wis', 12));
    t.eq([monk['Stunning fist'], monk['Wholeness of body']], [[7, 'day'], [14, 'day']]);
    t.eq(usesOf(caster('Bard', 3, 'cha', 14))['Bardic music'], [3, 'day']);
  });

  test('Extra Turning adds four turnings, and a feat or item row with uses gets a tracker', (t) => {
    const c = caster('Cleric', 1, 'cha', 12);
    c.feats = [{ name: 'Extra Turning' }, { name: 'Lucky strike', uses: 2 }];
    c.wealth.items = [{ name: 'Wand of sparks', uses: 3, usesUsed: 1 }];
    const trackers = derive(c, srd).trackers;
    const by = Object.fromEntries(trackers.map((x) => [x.name, x]));
    t.eq(by['Turn or rebuke undead'].max, 8, '3 + 1 Cha + 4');
    t.eq([by['Lucky strike'].max, by['Wand of sparks'].remaining], [2, 2]);
  });

  test('rest brings back daily uses; a new week brings back weekly ones too', (t) => {
    const c = caster('Paladin', 6, 'cha', 14);
    c.trackers = { 'class:Paladin:Smite evil': 2, 'class:Paladin:Remove disease': 1 };
    c.feats = [{ name: 'Once a day', uses: 1, usesUsed: 1 }];
    const trackers = derive(c, srd).trackers;
    const night = restedTrackers(c, trackers, 'day');
    t.eq([night.trackers['class:Paladin:Smite evil'], night.trackers['class:Paladin:Remove disease'], night.feats[0].usesUsed], [0, 1, 0]);
    t.eq(restedTrackers(c, trackers, 'week').trackers['class:Paladin:Remove disease'], 0);
  });

  /* === variant rules (Unearthed Arcana) ================================== */

  /** A character with some variants switched on, on a blank sheet. */
  const withVariants = (cls, n, variants, extra = {}) => {
    const c = characterWith(srd, repeat([cls], n));
    c.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...(extra.abilities || {}) };
    c.options = Object.fromEntries(variants.map((v) => [v, true]));
    return { ...c, ...extra, abilities: { ...c.abilities, base: { ...c.abilities.base, ...(extra.abilities || {}) } } };
  };

  test('every variant in the catalog is a module, and every variant module is in the catalog', (t) => {
    const catalog = data.variants.variants.map((v) => v.id).filter((id) => !['gestalt', 'actionPoints', 'traitsFlaws'].includes(id)).sort();
    t.eq(catalog, [...VARIANT_MODULES].sort());
    t.ok(VARIANT_MODULES.every((id) => srd.ruleset.modules[id]?.available), 'and the SRD ruleset offers each');
  });

  test('defense bonus: the better of it and armor, and it counts against touch attacks', (t) => {
    const fighter = derive(withVariants('Fighter', 1, ['defenseBonus']), srd);
    t.eq([fighter.variants.defenseBonus, fighter.ac.total, fighter.ac.touch], [6, 16, 16], 'a 1st-level fighter: +6');
    const wizard = withVariants('Wizard', 3, ['defenseBonus']);
    wizard.gear.armor = { name: 'Chain shirt', bonus: 4, maxDex: 4 };
    const d = derive(wizard, srd);
    t.eq([d.variants.defenseBonus, d.ac.total, d.ac.touch], [3, 14, 13], 'armor +4 beats defense +3; touch still gets +3');
  });

  test('armor as damage reduction trades half the armor bonus for DR, and combines with defense bonus', (t) => {
    const c = withVariants('Fighter', 5, ['armorAsDR']);
    c.gear.armor = { name: 'Full plate', bonus: 8, maxDex: 1 };
    const d = derive(c, srd);
    t.eq([d.variants.damageReduction, d.ac.total], [4, 14], 'full plate: DR 4/-, +4 AC');
    c.options.defenseBonus = true;
    const both = derive(c, srd);
    t.eq([both.variants.damageReduction, both.variants.defenseBonus, both.ac.total], [4, 7, 17], 'defense +7 beats the remaining +4');
  });

  test('vitality, wounds, reserve and massive damage come from the sheet\u2019s own numbers', (t) => {
    const c = withVariants('Fighter', 5, ['vitalityWounds', 'reservePoints', 'massiveDamage'], { abilities: { con: 14 } });
    c.variants = { woundsTaken: 3, massiveDamage: { threshold: 'hd', result: 'dying' } };
    const d = derive(c, srd);
    t.eq([d.variants.health.vitality.max, d.variants.health.wounds.current, d.variants.health.reserve.max], [d.hp.total, 11, d.hp.total]);
    t.eq([d.variants.health.massiveDamage.threshold, d.variants.health.massiveDamage.result], [35, 'dying'], '25 + 2 per Hit Die');
  });

  test('level-based skills and maximum ranks set ranks without spending points', (t) => {
    const c = withVariants('Fighter', 5, ['skillsLevelBased']);
    const line = (d, name) => d.skills.lines.find((l) => l.name === name);
    let d = derive(c, srd);
    t.eq([line(d, 'Climb').ranks, line(d, 'Hide').ranks, d.skills.remaining], [5, 0, 0], 'class skill: level; cross-class: nothing');
    c.options = { skillsMaxRanks: true };
    c.skills.find((s) => s.name === 'Climb').known = true;
    c.skills.find((s) => s.name === 'Hide').known = true;
    d = derive(c, srd);
    t.eq([line(d, 'Climb').ranks, line(d, 'Hide').ranks, d.variants.skills.known, d.variants.skills.allowed], [8, 4, 2, 2]);
  });

  test('craft points, contacts, reputation, honor and sanity follow their tables', (t) => {
    const c = withVariants('Bard', 6, ['craftPoints', 'contacts', 'reputation', 'honor', 'sanity'], { abilities: { wis: 14 } });
    c.feats = [{ name: 'Scribe Scroll' }, { name: 'Renown' }];
    c.concept.alignment = 'LG';
    c.variants = { honor: { ancestry: 'hero' }, contacts: [{ name: 'Old Tam', type: 'information' }] };
    const v = derive(c, srd).variants.scores;
    t.eq(v.craftPoints.total, 2600, '2,100 for 6th level + 500 for Scribe Scroll');
    t.eq(v.contacts.allowed, 3, 'a bard gains contacts at 2nd, 4th and 6th');
    t.eq(v.reputation.total, 5, '+2 for bard 6 and +3 for Renown');
    t.eq([v.honor.starting, v.sanity.starting, v.sanity.maximum], [27, 70, 99]);
  });

  test('magic rating adds up across classes and becomes caster level', (t) => {
    const c = characterWith(srd, [...repeat(['Wizard'], 6), ...repeat(['Rogue'], 4)]);
    c.abilities.base.int = 16;
    c.options = { magicRating: true };
    const wizard = derive(c, srd).magic.classes.find((m) => m.name === 'Wizard');
    t.eq([wizard.casterLevel, wizard.classCasterLevel], [7, 6], 'wizard 6 (6) + rogue 4 (1)');
  });

  test('spell points: the class table plus the bonus for the ability score and highest spell', (t) => {
    const c = withVariants('Wizard', 5, ['spellPoints'], { abilities: { int: 16 } });
    const m = derive(c, srd).magic.classes[0];
    t.eq([m.spellPoints.base, m.spellPoints.bonus, m.spellPoints.total, m.spellPoints.cantripsPerDay], [16, 9, 25, 5]);
  });

  test('spontaneous divine casters: spells known from their table, and a spell more a day', (t) => {
    const m = derive(withVariants('Cleric', 3, ['spontaneousDivine'], { abilities: { wis: 15 } }), srd).magic.classes[0];
    t.eq(m.spontaneous, true);
    t.eq(m.levels.map((l) => l.knownAllowed), [5, 5, 2], 'table 5/3/0, plus two domain spells at 1st and 2nd');
    t.eq(m.levels.map((l) => l.perDay), [5, 4, 3], 'table + 1 + bonus, no domain slot');
  });

  test('class variants change the class: cloistered cleric and battle sorcerer', (t) => {
    const cleric = withVariants('Cleric', 4, ['classVariants']);
    cleric.variants = { classVariant: { Cleric: 'cloisteredCleric' } };
    const d = derive(cleric, srd);
    t.eq([d.summary.bab, d.summary.hitDice[1].die, d.summary.skillPointsPerLevel[0].base], [2, 6, 6]);
    const sorcerer = withVariants('Sorcerer', 1, ['classVariants'], { abilities: { cha: 11 } });
    sorcerer.variants = { classVariant: { Sorcerer: 'battleSorcerer' } };
    const m = derive(sorcerer, srd).magic.classes[0];
    t.eq([m.levels.map((l) => l.perDay), m.levels.map((l) => l.knownAllowed)], [[4, 2], [3, 1]], 'one fewer a day and known, to a minimum of one known');
  });

  test('generic and paragon classes join the class list when their variants are on', (t) => {
    const warrior = withVariants('Warrior (generic)', 2, ['genericClasses']);
    warrior.variants = { genericSaves: { 'Warrior (generic)': ['ref'] } };
    const w = derive(warrior, srd);
    t.eq([w.summary.bab, w.saves.ref.base, w.saves.fort.base], [2, 3, 0]);
    const dwarf = withVariants('Dwarf paragon', 2, ['paragonClasses']);
    const p = derive(dwarf, srd);
    t.eq([p.summary.bab, p.saves.fort.base, p.summary.hitDice[0].die], [2, 3, 10]);
    t.eq(derive(characterWith(srd, [['Dwarf paragon']]), srd).summary.hitDice[0].die, 0, 'and not when it is off');
  });

  test('reducing level adjustments lowers ECL once paid for; taint takes Constitution and Wisdom', (t) => {
    const c = withVariants('Fighter', 6, ['reducingLA', 'uaTaint'], { abilities: { con: 16, wis: 14 } });
    c.race.la = 2;
    c.variants = { laReductions: 1, taint: 4 };
    const d = derive(c, srd);
    t.eq([d.summary.la, d.summary.ecl, d.variants.scores.levelAdjustment.nextAt], [1, 7, 9]);
    t.eq([d.abilities.con.total, d.abilities.wis.total, d.variants.health.taint.severity], [12, 10, 'mild']);
  });

  test('spontaneous metamagic gives each metamagic feat three uses a day', (t) => {
    const c = withVariants('Wizard', 5, ['spontaneousMetamagic'], { abilities: { int: 16 } });
    c.feats = [{ name: 'Empower Spell' }];
    const tracker = derive(c, srd).trackers.find((x) => x.name === 'Empower Spell');
    t.eq([tracker.max, tracker.highestSpell], [3, 1], 'highest spell 3, less 2 for Empower');
  });

  /* === feats, traits, languages, class features, wealth ================== */

  test('prerequisites are read from the SRD\u2019s words', (t) => {
    const rules = featRuleIndex(srd);
    const kinds = (text) => parsePrerequisites(text, rules).map((c) => c.kind);
    t.eq(kinds('Str 13, Power Attack, base attack bonus +1.'), ['ability', 'feat', 'bab']);
    t.eq(kinds('Caster level 3rd.'), ['casterLevel']);
    t.eq(kinds('Weapon Focus with selected weapon, fighter level 4th.'), ['feat', 'classLevel']);
    t.eq(kinds('Knowledge (arcana) 5 ranks, Spell Focus (conjuration).'), ['skill', 'feat']);
    t.eq(kinds('Ability to turn or rebuke creatures.'), ['feature']);
    t.eq(parsePrerequisites('fighter level 4th', rules)[0], { text: 'fighter level 4th', kind: 'classLevel', className: 'Fighter', min: 4 });
  });

  test('a feat is legal only when its prerequisites were met at the level it was taken', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 4));
    c.abilities.base.str = 13;
    const d = derive(c, srd);
    const rules = featRuleIndex(srd);
    const at1 = stateAtLevel(c, d, srd, 1, [{ name: 'Power Attack', types: ['General'] }]);
    t.ok(featEligibility(rules.get('cleave'), at1, rules).ok, 'Cleave after Power Attack');
    t.ok(!featEligibility(rules.get('cleave'), stateAtLevel(c, d, srd, 1, []), rules).ok, 'but not before');
    const spec = rules.get('weapon specialization');
    const wf = [{ name: 'Weapon Focus', choice: 'Longsword', types: ['General'] }];
    t.ok(!featEligibility(spec, stateAtLevel(c, d, srd, 3, wf), rules, { choice: 'Longsword' }).ok, 'Weapon Specialization needs fighter 4');
    t.ok(featEligibility(spec, stateAtLevel(c, d, srd, 4, wf), rules, { choice: 'Longsword' }).ok, 'and has it at 4th');
    t.ok(!featEligibility(spec, stateAtLevel(c, d, srd, 4, wf), rules, { choice: 'Greatsword' }).ok, 'on the weapon it focused on');
  });

  test('feat slots: every third level, a human\u2019s, a fighter\u2019s from the fighter list, a wizard\u2019s from its own', (t) => {
    const human = characterWith(srd, repeat(['Fighter'], 6));
    human.race.name = 'Human';
    const plan = derive(human, srd).featPlan;
    t.eq(plan.slots.map((s) => s.id), ['level:1', 'race:0', 'class:Fighter:1', 'class:Fighter:2', 'level:3', 'class:Fighter:4', 'level:6', 'class:Fighter:6']);
    const fighterSlot = plan.slots.find((s) => s.id === 'class:Fighter:1');
    const d = derive(human, srd);
    const options = featOptions(fighterSlot, plan, human, d, srd, srd.featRules).map((o) => o.name);
    t.ok(options.includes('Blind-Fight') && !options.includes('Alertness'), 'fighter bonus feats only');
    t.ok(!options.includes('Cleave'), 'and only those whose prerequisites are met');
    const wizard = characterWith(srd, repeat(['Wizard'], 5));
    const wp = derive(wizard, srd).featPlan;
    t.eq(wp.granted.map((g) => g.name), ['Scribe Scroll'], 'Scribe Scroll is granted, not chosen');
    const wslot = wp.slots.find((s) => s.id === 'class:Wizard:5');
    const wopts = featOptions(wslot, wp, wizard, derive(wizard, srd), srd, srd.featRules).map((o) => o.name);
    t.ok(wopts.includes('Empower Spell') && wopts.includes('Craft Wand') && !wopts.includes('Dodge'), 'metamagic and item creation');
  });

  test('a monk\u2019s bonus feats ignore prerequisites, and an illegal feat is an error', (t) => {
    const monk = characterWith(srd, repeat(['Monk'], 2));
    monk.feats = [{ name: 'Deflect Arrows', slot: 'class:Monk:2' }, { name: 'Cleave', slot: 'level:1' }];
    const d = derive(monk, srd);
    t.ok(d.featPlan.slots.find((s) => s.id === 'class:Monk:2').check.ok, 'Deflect Arrows without Dex 13');
    t.ok(d.notices.some((n) => n.level === 'error' && n.text.startsWith('Cleave (1st-level feat)')), 'Cleave without Power Attack');
  });

  test('SRD feats bring their effects: Toughness, Skill Focus, Weapon Focus', (t) => {
    const c = characterWith(srd, repeat(['Fighter'], 1));
    c.weapons = [{ name: 'Longsword', attackBonus: 0, damageDice: '1d8', damageBonus: 0 }];
    const before = derive(c, srd);
    c.feats = [{ name: 'Toughness' }, { name: 'Skill Focus', choice: 'Climb' }, { name: 'Weapon Focus', choice: 'Longsword' }];
    const d = derive(c, srd);
    t.eq(d.hp.total - before.hp.total, 3, 'Toughness: +3 hit points');
    const climb = (x) => x.skills.lines.find((l) => l.name === 'Climb').total;
    t.eq(climb(d) - climb(before), 3, 'Skill Focus (Climb): +3');
    t.eq(d.weapons[0].attack - before.weapons[0].attack, 1, 'Weapon Focus (longsword): +1 with it');
  });

  test('traits and flaws change the sheet, and flaws buy feats', (t) => {
    const c = characterWith(srd, repeat(['Rogue'], 1));
    c.options = { traitsFlaws: true };
    const before = derive(c, srd);
    c.traits = [{ name: 'Hardy' }, { name: 'Illiterate', choice: 'Hide' }];
    c.flaws = [{ name: 'Vulnerable' }, { name: 'Slow' }];
    const d = derive(c, srd);
    t.eq([d.saves.fort.total - before.saves.fort.total, d.saves.ref.total - before.saves.ref.total], [1, -1], 'Hardy');
    t.eq(d.ac.total - before.ac.total, -1, 'Vulnerable');
    t.eq(d.speed, 15, 'Slow halves 30 feet');
    t.eq(d.feats.allowed - before.feats.allowed, 2, 'two flaws, two feats');
    t.ok(d.specialNotes.some((n) => n.source === 'Illiterate'), 'what is not a number is listed');
  });

  test('languages: automatic, a bonus per point of Intelligence from the race\u2019s list, and Speak Language', (t) => {
    const c = characterWith(srd, repeat(['Wizard'], 1));
    c.race.name = 'Dwarf';
    c.abilities.base.int = 14;
    c.languages = ['Giant', 'Draconic', 'Elven'];
    const plan = languagePlan(c, derive(c, srd), srd);
    t.eq(plan.automatic, ['Common', 'Dwarven']);
    t.eq(plan.bonusAllowed, 2);
    t.eq(plan.chosen.map((x) => x.via), ['bonus', 'bonus', null], 'Draconic through the wizard; Elven is not on the list');
    t.ok(!plan.available.includes('Druidic'), 'never a secret language');
  });

  test('class features come from the class table, and some are numbers', (t) => {
    t.eq([featureKey('Sneak attack +3d6'), featureKey('Slow fall 40 ft.'), featureKey('2nd favored enemy'), featureKey('Wild shape (Large)')], ['sneak attack', 'slow fall', 'favored enemy', 'wild shape']);
    const rogue = derive(characterWith(srd, repeat(['Rogue'], 5)), srd);
    const sneak = rogue.classFeatures.find((f) => f.key === 'sneak attack');
    t.eq(sneak.latest, 'Sneak attack +3d6');
    const paladin = characterWith(srd, repeat(['Paladin'], 2));
    paladin.abilities.base.cha = 16;
    const base = characterWith(srd, repeat(['Paladin'], 1));
    base.abilities.base.cha = 16;
    t.eq(derive(paladin, srd).saves.will.total - derive(base, srd).saves.will.total, 3, 'divine grace: +3 Charisma at 2nd, on top of the save\u2019s own +0');
    const monk = characterWith(srd, repeat(['Monk'], 5));
    monk.abilities.base.wis = 14;
    const m = derive(monk, srd);
    t.eq([m.ac.total, m.speed], [10 - 1 + 2 + 1, 40], 'Wisdom +2 and +1 at 5th to AC; fast movement +10');
  });

  test('a cleric\u2019s domains add class skills, granted feats and trackers', (t) => {
    const c = characterWith(srd, repeat(['Cleric'], 1));
    c.magic = { Cleric: { domains: ['Travel', 'Darkness'] } };
    const d = derive(c, srd);
    t.ok(d.summary.classSkills.has('Survival'), 'Travel: Survival');
    t.ok(d.feats.grantedFeats.some((g) => g.name === 'Blind-Fight'), 'Darkness: Blind-Fight');
    t.ok(d.trackers.some((x) => x.name === 'Freedom of movement' && x.max === 1), 'Travel: a round a level');
  });

  test('starting wealth: the class\u2019s gold at 1st, wealth by level after, a custom figure, and a campaign\u2019s', (t) => {
    const first = characterWith(srd, [['Fighter']]);
    t.eq([derive(first, srd).wealth.startingGold, derive(first, srd).wealth.source], [150, 'classGold']);
    const fifth = characterWith(srd, repeat(['Fighter'], 5));
    t.eq(derive(fifth, srd).wealth.startingGold, 9000);
    fifth.wealth.startingGold = 12000;
    t.eq(derive(fifth, srd).wealth.source, 'custom');
    const { rules } = campaignRules(srd, { id: 'c1', ruleset: 'srd', settings: { startingWealth: 5000 } });
    t.eq([derive(fifth, rules).wealth.startingGold, derive(fifth, rules).wealth.source], [5000, 'campaign'], 'the GM\u2019s figure, not the player\u2019s');
  });

  test('skill synergies: 5 ranks give +2, untyped, stacking; conditional ones only noted', (t) => {
    const c = characterWith(srd, repeat(['Rogue'], 2));
    const line = (d, label) => d.skills.lines.find((l) => l.label === label);
    const set = (name, ranks) => { c.skills.find((s) => s.name === name).ranks = ranks; };
    const before = derive(c, srd);
    set('Bluff', 5);
    set('Sense Motive', 4);
    set('Tumble', 5);
    let d = derive(c, srd);
    t.eq(line(d, 'Diplomacy').total - line(before, 'Diplomacy').total, 2, 'Bluff 5 ranks: +2 Diplomacy');
    t.eq([line(d, 'Balance').total - line(before, 'Balance').total, line(d, 'Jump').total - line(before, 'Jump').total], [2, 2], 'Tumble 5 ranks: Balance and Jump');
    t.eq(line(d, 'Disguise').total, line(before, 'Disguise').total, 'acting in character is conditional: not added');
    t.ok(d.effects.resolved['skill.Disguise'].conditional.length === 1, 'but listed');
    set('Sense Motive', 5);
    d = derive(c, srd);
    t.eq(line(d, 'Diplomacy').total - line(before, 'Diplomacy').total, 4, 'Sense Motive too: they stack');
    c.skills.push({ name: 'Knowledge', subtype: 'arcana', ranks: 5, misc: 0 });
    d = derive(c, srd);
    t.eq(line(d, 'Spellcraft').total - line(before, 'Spellcraft').total, 2, 'Knowledge (arcana) 5 ranks: +2 Spellcraft');
    c.skills.push({ name: 'Knowledge', subtype: 'history', ranks: 6, misc: 0 });
    t.ok(derive(c, srd).specialNotes.some((n) => n.kind === 'synergy' && /bardic knowledge/.test(n.text)), 'a synergy on something not a skill is a note');
  });

  return cases;
}
