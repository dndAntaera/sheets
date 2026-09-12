// The test suite, written so it can run in two places: under `node --test`
// (test/engine.test.js) and in a browser (web/test.html). Whoever is working on
// this repo may not have Node installed, and a suite nobody can run is a suite
// that rots.
//
// Cases are chosen for the arithmetic that is easy to get wrong and expensive
// to get wrong: the places 3.5e rounds, the places multiclassing adds instead
// of replacing, and the gestalt best-of rule.

import {
  abilityMod, babFor, saveFor, iterativeAttacks, makeRules, buildSummary,
  abilityTotals, pointBuyCost, rolledArrayCheck, bonusSlots, skillPointBudget,
  maxRanks, hitPoints, armorClass, attacks, actionPoints, taintSeverity,
  wealth, levelAdjustment, trainingTime, blankCharacter, derive,
} from '../web/engine/index.js';

/** A character with the given per-level class pairs, on top of a blank sheet. */
function characterWith(rules, levels, extra = {}) {
  const c = blankCharacter(rules);
  c.levels = levels.map(([a, b], i) => ({ level: i + 1, a, b: b || '' }));
  return { ...c, ...extra };
}

export function buildSuite(data) {
  const rules = makeRules(data);
  const cases = [];
  const test = (name, run) => cases.push({ name, run });

  /* --- the rounding ----------------------------------------------------- */

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
  });

  test('the attack routine gains an attack at +6 and every +5 after', (t) => {
    t.eq(iterativeAttacks(5), [5]);
    t.eq(iterativeAttacks(6), [6, 1]);
    t.eq(iterativeAttacks(11), [11, 6, 1]);
    t.eq(iterativeAttacks(20), [20, 15, 10, 5]);
  });

  /* --- multiclassing adds, gestalt picks -------------------------------- */

  test('a multiclass build sums each class progression separately', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter'], ['Rogue'], ['Rogue'], ['Rogue']]);
    const s = buildSummary(c, rules, false);
    t.eq(s.bab, 5, 'Fighter 3 (+3) plus Rogue 3 (+2), not a +4 six-level average');
    t.eq(s.baseSaves.fort, 4, 'good 3 (+3) plus poor 3 (+1)');
    t.eq(s.baseSaves.ref, 4, 'poor 3 (+1) plus good 3 (+3)');
    t.eq(s.label, 'Fighter 3/Rogue 3');
  });

  test('gestalt takes the better total, not the sum', (t) => {
    const c = characterWith(rules, [['Fighter', 'Wizard'], ['Fighter', 'Wizard'], ['Fighter', 'Wizard']]);
    const s = buildSummary(c, rules, true);
    t.eq(s.bab, 3, 'the fighter side, not fighter plus wizard');
    t.eq(s.baseSaves.fort, 3, 'good from the fighter');
    t.eq(s.baseSaves.will, 3, 'good from the wizard');
    t.eq(s.baseSaves.ref, 1, 'both sides are poor, so poor it stays');
    t.eq(s.hitDice.map((h) => h.die), [10, 10, 10], 'the d10, never the d4');
    t.eq(s.label, 'Fighter 3 // Wizard 3');
  });

  test('gestalt hit dice and skill points are per level, from either side', (t) => {
    const c = characterWith(rules, [['Barbarian', 'Bard']]);
    const s = buildSummary(c, rules, true);
    t.eq(s.hitDice[0].die, 12, 'the barbarian d12');
    t.eq(s.skillPointsPerLevel[0].base, 6, 'the bard 6, not the barbarian 4');
    t.ok(s.classSkills.has('Perform'), 'the bard list counts');
    t.ok(s.classSkills.has('Survival'), 'and so does the barbarian list');
  });

  test('with gestalt off the second column is ignored entirely', (t) => {
    const c = characterWith(rules, [['Wizard', 'Fighter'], ['Wizard', 'Fighter'], ['Wizard', 'Fighter']]);
    const s = buildSummary(c, rules, false);
    t.eq(s.bab, 1, 'three wizard levels, poor progression');
    t.eq(s.hitDice[0].die, 4);
    t.eq(s.baseSaves.fort, 1);
  });

  test('a good save on both sides is still only one good save', (t) => {
    const c = characterWith(rules, [['Monk', 'Ranger'], ['Monk', 'Ranger'], ['Monk', 'Ranger']]);
    const s = buildSummary(c, rules, true);
    t.eq(s.baseSaves.fort, 3);
    t.eq(s.baseSaves.ref, 3);
    t.eq(s.baseSaves.will, 3, 'the monk brings it; the ranger does not double it');
    t.eq(s.bab, 3, 'the ranger full progression beats the monk three quarters');
  });

  test('hit dice, level adjustment and ECL are counted apart', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.race = { ...c.race, racialHD: 2, la: 1 };
    const s = buildSummary(c, rules, false);
    t.eq(s.classLevels, 3);
    t.eq(s.hitDiceCount, 5, 'three class levels plus two racial hit dice');
    t.eq(s.ecl, 6, 'and the level adjustment on top');
    t.eq(s.featsFromLevels, 2, 'one at first, one per three hit dice');
    t.eq(s.abilityIncreases, 1, 'one at fourth');
  });

  /* --- abilities -------------------------------------------------------- */

  test('point buy spends from a base of eight', (t) => {
    const all8 = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    t.eq(pointBuyCost(all8, rules).spent, 0);
    const spread = { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 8 };
    const pb = pointBuyCost(spread, rules);
    t.eq(pb.spent, 28, '10 + 6 + 6 + 4 + 2 + 0');
    t.eq(pb.remaining, 2);
    t.ok(pb.ok);
    const tooMuch = pointBuyCost({ str: 18, dex: 18, con: 8, int: 8, wis: 8, cha: 8 }, rules);
    t.eq(tooMuch.spent, 32);
    t.ok(!tooMuch.ok, '32 is over the 30 point budget');
  });

  test('a rolled array is kept only between 65 and 85', (t) => {
    t.ok(rolledArrayCheck({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, rules).tooLow);
    t.ok(rolledArrayCheck({ str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 }, rules).tooHigh);
    const fine = rolledArrayCheck({ str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 9 }, rules);
    t.eq(fine.total, 75);
    t.ok(fine.ok);
  });

  test('ability totals stack racial, level-up and item bonuses', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter'], ['Fighter']]);
    c.abilities.base.str = 16;
    c.race.abilityAdjust.str = 2;
    c.abilities.levelUps = { 4: 'str' };
    c.abilities.enhancement.str = 2;
    c.abilities.temp.str = 4;
    const s = buildSummary(c, rules, false);
    const a = abilityTotals(c, s);
    t.eq(a.str.total, 25, '16 + 2 racial + 1 level + 2 item + 4 temporary');
    t.eq(a.str.mod, 7);
    t.eq(a.str.baseTotal, 21, 'without the temporary bonus');
    t.eq(a.str.baseMod, 5);
    t.eq(a.levelUpsUsed, 1);
    t.eq(a.levelUpsAllowed, 1);
  });

  test('bonus spell slots match the printed table', (t) => {
    t.eq(bonusSlots(4)[1], 1);
    t.eq(bonusSlots(4)[4], 1);
    t.eq(bonusSlots(4)[5], 0);
    t.eq(bonusSlots(9)[1], 3, 'a +9 modifier gives three first-level slots');
    t.eq(bonusSlots(9)[2], 2);
    t.eq(bonusSlots(9)[9], 1);
    t.eq(bonusSlots(1)[1], 1);
    t.eq(bonusSlots(0)[1], 0);
  });

  /* --- skills ----------------------------------------------------------- */

  test('first level buys four times the per-level points', (t) => {
    const c = characterWith(rules, [['Rogue'], ['Rogue'], ['Rogue']]);
    const s = buildSummary(c, rules, false);
    const b = skillPointBudget(s, 2);
    t.eq(b.rows[0].points, 40, '(8 + 2) x 4');
    t.eq(b.rows[1].points, 10);
    t.eq(b.total, 60);
  });

  test('a level never gives less than one skill point', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter']]);
    const s = buildSummary(c, rules, false);
    const b = skillPointBudget(s, -3);
    t.eq(b.rows[0].points, 4, 'even the quadrupled first level floors at one per level');
    t.eq(b.rows[1].points, 1);
  });

  test('a racial bonus is added before the first-level multiplier', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter']]);
    const s = buildSummary(c, rules, false);
    const b = skillPointBudget(s, 0, 1);
    t.eq(b.rows[0].points, 12, 'a human fighter: (2 + 1) x 4');
    t.eq(b.rows[1].points, 3);
  });

  test('rank caps follow hit dice, and cross-class keeps its half', (t) => {
    t.eq(maxRanks(3, true), 6);
    t.eq(maxRanks(3, false), 3);
    t.eq(maxRanks(4, false), 3.5, 'halves are real ranks, not rounded away');
    t.eq(maxRanks(20, true), 23);
  });

  test('cross-class ranks cost double, and the sheet notices overspending', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.abilities.base = { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 8 };
    c.skills = [
      { name: 'Climb', subtype: '', ranks: 6, misc: 0 },
      { name: 'Hide', subtype: '', ranks: 3, misc: 0 },
      { name: 'Jump', subtype: '', ranks: 1, misc: 0 },
    ];
    const d = derive(c, rules, { gestalt: false });
    t.eq(d.skills.budget.total, 12, '(2 + 0) x 4, then 2 and 2');
    t.eq(d.skills.spent, 13, '6 and 1 on class skills, 6 for three cross-class ranks');
    t.eq(d.skills.remaining, -1);
    t.ok(d.notices.some((n) => n.level === 'error' && /overspent/.test(n.text)));
  });

  test('armour check penalty reaches the skill line, doubled for Swim', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.gear.armor = { name: 'Full plate', bonus: 8, maxDex: 1, acp: 6, asf: 35, speed: 20 };
    c.skills = [
      { name: 'Climb', subtype: '', ranks: 0, misc: 0 },
      { name: 'Swim', subtype: '', ranks: 0, misc: 0 },
      { name: 'Spot', subtype: '', ranks: 0, misc: 0 },
    ];
    const d = derive(c, rules, { gestalt: false });
    const line = (name) => d.skills.lines.find((l) => l.name === name);
    t.eq(line('Climb').acp, 6);
    t.eq(line('Swim').acp, 12, 'Swim is the one skill that suffers it twice');
    t.eq(line('Spot').acp, 0, 'and a Wisdom skill not at all');
  });

  /* --- hit points ------------------------------------------------------- */

  test('hit points are maximum at first level, then by the chosen method', (t) => {
    const rows = [{ level: 1, die: 10 }, { level: 2, die: 10 }, { level: 3, die: 10 }];
    const avg = hitPoints(rows, { method: 'average' }, 2, rules);
    t.eq(avg.perLevel[0].gained, 12, 'the full die plus Constitution');
    t.eq(avg.perLevel[1].gained, 8, 'half the die plus one, plus Constitution');
    t.eq(avg.total, 28);

    const rolled = hitPoints(rows, { method: 'roll', rolls: { 2: 7, 3: 3 } }, 2, rules);
    t.eq(rolled.perLevel[1].gained, 9);
    t.eq(rolled.perLevel[2].gained, 5);
    t.eq(rolled.total, 26);
  });

  test('a level always gives at least one hit point', (t) => {
    const rows = [{ level: 1, die: 4 }, { level: 2, die: 4 }];
    const hp = hitPoints(rows, { method: 'average' }, -5, rules);
    t.eq(hp.perLevel[0].gained, 1, 'a d4 wizard with Constitution 1 still lives');
    t.eq(hp.perLevel[1].gained, 1);
  });

  test('a rolled build with a missing roll says so', (t) => {
    const rows = [{ level: 1, die: 8 }, { level: 2, die: 8 }];
    const hp = hitPoints(rows, { method: 'roll', rolls: {} }, 0, rules);
    t.eq(hp.missingRolls, [2]);
  });

  /* --- defence and offence ---------------------------------------------- */

  test('armour class, touch and flat-footed split the bonuses correctly', (t) => {
    const gear = {
      armor: { bonus: 5, maxDex: 3, acp: 4 },
      shield: { bonus: 2 },
      natural: 1, deflection: 1, dodge: 1, misc: 0,
    };
    const ac = armorClass(gear, 4, 0, rules);
    t.eq(ac.dex.applied, 3, 'Dexterity is capped by the armour');
    t.ok(ac.dex.capped);
    t.eq(ac.total, 23, '10 + 5 + 2 + 1 + 1 + 1 + 3');
    t.eq(ac.touch, 15, 'armour, shield and natural armour drop out');
    t.eq(ac.flatFooted, 19, 'Dexterity and dodge drop out');
    t.eq(ac.acp, 4);
  });

  test('size enters attacks and grapple with different numbers', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.abilities.base = { str: 14, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
    c.race.size = 'Small';
    const s = buildSummary(c, rules, false);
    const a = abilityTotals(c, s);
    const small = rules.rules.sizes.find((x) => x.name === 'Small');
    const set = attacks(s, a, small);
    t.eq(set.melee.total, 6, '+3 base, +2 Strength, +1 for being small');
    t.eq(set.ranged.total, 6);
    t.eq(set.grapple.total, 1, 'but small hurts in a hold: +3 +2 -4');
    t.eq(set.trip, -2, 'an opposed Strength check: +2 Strength, -4 for the size');
  });

  test('the routine comes from the base attack bonus, never from the total', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.abilities.base = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    const medium = rules.rules.sizes.find((x) => x.name === 'Medium');
    let s = buildSummary(c, rules, false);
    let set = attacks(s, abilityTotals(c, s), medium);
    t.eq(set.melee.total, 6, '+3 base and +3 Strength');
    t.eq(set.melee.routine, '+6', 'one attack: a 16 Strength does not buy a second');

    // Six fighter levels is where the second attack is actually earned.
    c.levels = [1, 2, 3, 4, 5, 6].map((l) => ({ level: l, a: 'Fighter', b: '' }));
    s = buildSummary(c, rules, false);
    set = attacks(s, abilityTotals(c, s), medium);
    t.eq(set.melee.routine, '+9/+4', '+6 base becomes +6/+1, then +3 Strength on each');
  });

  /* --- houserules ------------------------------------------------------- */

  test('action points follow level, and the die count follows the band', (t) => {
    t.eq(actionPoints(1, 0, rules).earned, 5);
    t.eq(actionPoints(3, 0, rules).earned, 6, '5 + half of 3');
    t.eq(actionPoints(10, 4, rules).earned, 10);
    t.eq(actionPoints(10, 4, rules).remaining, 6);
    t.eq(actionPoints(7, 0, rules).dice, 1);
    t.eq(actionPoints(8, 0, rules).dice, 2);
    t.eq(actionPoints(15, 0, rules).dice, 3);
  });

  test('taint severity is read against the resisting ability', (t) => {
    const con14 = (score) => taintSeverity(score, 14, rules).severity;
    t.eq(con14(3), 'none', 'on the books, but no symptom yet');
    t.eq(con14(8), 'mild');
    t.eq(con14(12), 'moderate');
    t.eq(con14(20), 'severe');
    t.eq(con14(25), 'past', 'past severe the character is lost');
    t.eq(taintSeverity(8, 4, rules).severity, 'moderate', 'a frail character shows it sooner');
    t.eq(taintSeverity(8, 20, rules).severity, 'none', 'a hardy one later');
    t.eq(taintSeverity(5, 14, rules).toNext, 2, 'two more points reaches mild');
  });

  test('wealth by level carries the single-item cap', (t) => {
    const c = blankCharacter(rules);
    c.wealth = { startingGold: null, gold: 0, items: [{ name: 'Ring', value: 700, qty: 1 }] };
    const w = wealth(c, 3, rules);
    t.eq(w.expected, 2700);
    t.eq(w.cap, 675, 'a quarter of wealth by level, after first');
    t.eq(w.overCapItems.length, 1);
    const first = wealth(c, 1, rules);
    t.eq(first.capFraction, 0.5, 'at first level the cap is a half');
  });

  test('level adjustment is capped at a quarter of ECL, but +1 is always fine', (t) => {
    t.ok(levelAdjustment(1, 3, rules).ok);
    t.ok(!levelAdjustment(2, 3, rules).ok);
    t.ok(levelAdjustment(2, 8, rules).ok);
    t.eq(levelAdjustment(0, 3, rules).allowed, 0);
  });

  test('gestalt training overlaps, and the far-ahead class trains at three quarters', (t) => {
    // The wiki's example: Fighter 6 // Rogue 4/Sorcerer 2, taking Fighter 7 and
    // Sorcerer 3, costs "2 days and 1 day".
    const gestaltLevel = trainingTime(
      [{ classLevel: 7, prestige: false }, { classLevel: 3, prestige: false }],
      rules, true
    );
    t.eq(gestaltLevel.perSide, [2, 1]);
    t.eq(gestaltLevel.days, 2, 'the two train at once, so the longer one is the cost');

    t.eq(trainingTime([{ classLevel: 1, prestige: false }], rules, false).days, 2);
    t.eq(trainingTime([{ classLevel: 1, prestige: true }], rules, false).days, 3);
    t.eq(trainingTime([{ classLevel: 4, prestige: false }], rules, false).days, 2);
    t.eq(trainingTime([{ classLevel: 4, prestige: true }], rules, false).days, 4);
  });

  /* --- the whole sheet -------------------------------------------------- */

  test('a fresh character is legal apart from the choices still to make', (t) => {
    const c = blankCharacter(rules);
    const d = derive(c, rules, { gestalt: false });
    t.eq(d.summary.classLevels, 3, 'the campaign starts at third level');
    t.ok(!d.notices.some((n) => n.level === 'error'), 'nothing is wrong yet, only unfinished');
    t.ok(d.skills.lines.length > 30, 'the skill table arrives filled in');
  });

  test('a finished third-level gestalt sheet adds up end to end', (t) => {
    const c = characterWith(rules, [['Fighter', 'Rogue'], ['Fighter', 'Rogue'], ['Fighter', 'Rogue']]);
    c.abilities.method = 'pointBuy';
    c.abilities.base = { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 8 };
    c.hp.method = 'average';
    c.gear.armor = { name: 'Chain shirt', bonus: 4, maxDex: 4, acp: 2, asf: 20, speed: null };
    c.background = { name: 'Soldier', item: '', notes: '' };
    c.skills = [
      { name: 'Climb', subtype: '', ranks: 6, misc: 0 },
      { name: 'Hide', subtype: '', ranks: 6, misc: 0 },
      { name: 'Move Silently', subtype: '', ranks: 6, misc: 0 },
      { name: 'Spot', subtype: '', ranks: 6, misc: 0 },
      { name: 'Listen', subtype: '', ranks: 6, misc: 0 },
    ];
    c.feats = [{ name: 'Power Attack' }, { name: 'Cleave' }];
    const d = derive(c, rules, { gestalt: true });

    t.eq(d.summary.bab, 3, 'the fighter side');
    t.eq(d.summary.baseSaves.fort, 3);
    t.eq(d.summary.baseSaves.ref, 3, 'the rogue side');
    t.eq(d.summary.baseSaves.will, 1);
    t.eq(d.saves.fort.total, 5, '+3 base and +2 Constitution');
    t.eq(d.saves.ref.total, 5);
    t.eq(d.saves.will.total, 1);
    t.eq(d.hp.total, 28, '10 + 6 + 6, plus 2 Constitution each level');
    t.eq(d.ac.total, 16, '10 + 4 chain shirt + 2 Dexterity');
    t.eq(d.attacks.melee.total, 6);
    t.eq(d.skills.budget.total, 54, 'rogue 8 + Int 1: 36 at first, then 9 and 9');
    t.eq(d.skills.spent, 30, 'all five are class skills on one side or the other');
    t.eq(d.actionPoints.earned, 6);
    t.eq(d.feats.allowed, 2);
    t.eq(d.feats.taken, 2);
    t.ok(!d.notices.some((n) => n.level === 'error'), 'no errors on a legal sheet');
  });

  test('an unknown class is reported rather than silently scoring zero', (t) => {
    const c = characterWith(rules, [['Warblade'], ['Warblade'], ['Warblade']]);
    const d = derive(c, rules, { gestalt: false });
    t.eq(d.summary.bab, 0);
    t.ok(d.notices.some((n) => n.level === 'error' && /Warblade/.test(n.text)));
  });

  test('a custom class is counted exactly like a printed one', (t) => {
    const c = characterWith(rules, [['Warblade'], ['Warblade'], ['Warblade']]);
    c.customClasses = [{
      name: 'Warblade', hd: 12, bab: 'good',
      saves: { fort: 'good', ref: 'poor', will: 'poor' },
      skillPoints: 4, classSkills: ['Balance', 'Climb', 'Jump'],
    }];
    const d = derive(c, rules, { gestalt: false });
    t.eq(d.summary.bab, 3);
    t.eq(d.summary.baseSaves.fort, 3);
    t.eq(d.hp.perLevel[0].fromDie, 12);
    t.ok(!d.notices.some((n) => /Warblade/.test(n.text)));
  });

  test('two prestige classes cannot share a gestalt level', (t) => {
    const c = characterWith(rules, [['Ravager', 'Assassin']]);
    c.customClasses = [
      { name: 'Ravager', hd: 10, bab: 'good', saves: { fort: 'good', ref: 'poor', will: 'poor' }, skillPoints: 2, classSkills: [], prestige: true },
      { name: 'Assassin', hd: 6, bab: 'average', saves: { fort: 'poor', ref: 'good', will: 'poor' }, skillPoints: 4, classSkills: [], prestige: true },
    ];
    const d = derive(c, rules, { gestalt: true });
    t.ok(d.notices.some((n) => n.level === 'error' && /two prestige classes/.test(n.text)));
  });

  test('an odd enhancement bonus to an ability is flagged', (t) => {
    const c = characterWith(rules, [['Fighter'], ['Fighter'], ['Fighter']]);
    c.abilities.enhancement.str = 3;
    const d = derive(c, rules, { gestalt: false });
    t.ok(d.notices.some((n) => /even numbers only/.test(n.text)));
  });

  return cases;
}
