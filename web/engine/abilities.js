// Ability scores: where they came from, what they add up to, and whether the
// way they were bought is legal under this campaign's two options.

import { abilityMod, num, floorDiv } from './util.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

/** The stack of things that can move a score, in the order a sheet lists them. */
const LAYERS = ['base', 'racial', 'levelUp', 'enhancement', 'inherent', 'misc', 'temp'];

/**
 * Totals and modifiers for all six scores.
 *
 * Two modifiers come back for each: `mod` includes temporary adjustments and is
 * what you roll with right now, and `baseMod` excludes them. Hit points use the
 * base one, because a bull's strength does not retroactively change the hit
 * points a character rolled at 4th level.
 */
export function abilityTotals(character, summary) {
  const a = character.abilities || {};
  const levelUps = countLevelUps(a.levelUps);
  const out = {};

  for (const key of ABILITIES) {
    const parts = {
      base: num(a.base?.[key], 10),
      racial: num(character.race?.abilityAdjust?.[key]),
      levelUp: levelUps[key] || 0,
      enhancement: num(a.enhancement?.[key]),
      inherent: num(a.inherent?.[key]),
      misc: num(a.misc?.[key]),
      temp: num(a.temp?.[key]),
    };
    const total = LAYERS.reduce((t, l) => t + parts[l], 0);
    const withoutTemp = total - parts.temp;
    out[key] = {
      key,
      name: ABILITY_NAMES[key],
      parts,
      total,
      mod: abilityMod(total),
      baseTotal: withoutTemp,
      baseMod: abilityMod(withoutTemp),
    };
  }
  out.levelUpsUsed = Object.values(levelUps).reduce((t, n) => t + n, 0);
  out.levelUpsAllowed = summary ? summary.abilityIncreases : 0;
  return out;
}

/** `{ 4: "str", 8: "con" }` becomes `{ str: 1, con: 1 }`. */
function countLevelUps(levelUps) {
  const counts = {};
  for (const key of Object.values(levelUps || {})) {
    if (ABILITIES.includes(key)) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Which levels grant +1 to an ability, for a character of this many hit dice. */
export function abilityIncreaseLevels(hd) {
  const levels = [];
  for (let l = 4; l <= hd; l += 4) levels.push(l);
  return levels;
}

/**
 * What a set of base scores costs under 30-point buy. Points are spent from a
 * base of 8, so an 8 is free and an 18 costs 16 of the 30 on its own.
 */
export function pointBuyCost(base, rules) {
  const table = rules.rules.abilityGeneration.pointBuy;
  let spent = 0;
  const perScore = {};
  const outOfRange = [];
  for (const key of ABILITIES) {
    const score = num(base?.[key], 10);
    const cost = table.cost[String(score)];
    if (cost === undefined) { outOfRange.push(key); perScore[key] = null; continue; }
    perScore[key] = cost;
    spent += cost;
  }
  return {
    spent, perScore, outOfRange,
    budget: table.budget,
    remaining: table.budget - spent,
    ok: outOfRange.length === 0 && spent <= table.budget,
  };
}

/** Whether a rolled array is one this campaign would let you keep. */
export function rolledArrayCheck(base, rules) {
  const r = rules.rules.abilityGeneration.rolled;
  const total = ABILITIES.reduce((t, k) => t + num(base?.[k], 10), 0);
  return {
    total, min: r.sumMin, max: r.sumMax,
    ok: total >= r.sumMin && total <= r.sumMax,
    tooLow: total < r.sumMin,
    tooHigh: total > r.sumMax,
  };
}

/** Bonus spell or power slots for a high casting ability, by spell level 1-9. */
export function bonusSlots(mod) {
  const slots = {};
  for (let level = 1; level <= 9; level++) {
    slots[level] = mod >= level ? 1 + floorDiv(mod - level, 4) : 0;
  }
  return slots;
}
