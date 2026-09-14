// Ability scores: where they came from, what they add up to, and whether the
// way they were generated is legal under the ruleset in force.

import { abilityMod, num, floorDiv } from './util.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

/**
 * Totals and modifiers for all six scores.
 *
 * The layers, in the order a sheet lists them:
 *
 *   base      what was bought, rolled or assigned
 *   racial    from the race and any templates
 *   levelUp   +1 at 4th level and every fourth after
 *   bonuses   every typed bonus, stacked by the rules - an item's enhancement,
 *             a tome's inherent bonus, a homebrew feat's +2. The sheet's own
 *             enhancement and inherent fields arrive here as effects too, so a
 *             belt of giant strength typed on the sheet and one carried as an
 *             item do not both count.
 *   temp      a temporary change - a spell, a drain - kept apart so it can be
 *             excluded where the rules say it should be
 *
 * Two modifiers come back for each score: `mod` includes temporary changes and
 * is what you roll with right now; `baseMod` does not. Hit points use the base
 * one, because a bull's strength does not retroactively change the hit points
 * a character rolled at 4th level.
 *
 * @param racial    { str: 2, ... } from raceFacts
 * @param resolved  the character's resolved effects
 */
export function abilityTotals(character, summary, racial = {}, resolved = {}) {
  const a = character.abilities || {};
  const levelUps = countLevelUps(a.levelUps);
  const out = {};

  for (const key of ABILITIES) {
    const bucket = resolved[`ability.${key}`];
    const parts = {
      base: num(a.base?.[key], 10),
      racial: num(racial[key]),
      levelUp: levelUps[key] || 0,
      bonuses: bucket?.total || 0,
      enhancement: bucket?.byType?.enhancement || 0,
      inherent: bucket?.byType?.inherent || 0,
      temp: num(a.temp?.[key]),
    };
    parts.otherBonuses = parts.bonuses - parts.enhancement - parts.inherent;

    const withoutTemp = parts.base + parts.racial + parts.levelUp + parts.bonuses;
    const total = withoutTemp + parts.temp;
    out[key] = {
      key,
      name: ABILITY_NAMES[key],
      parts,
      total,
      mod: abilityMod(total),
      baseTotal: withoutTemp,
      baseMod: abilityMod(withoutTemp),
      suppressed: bucket?.suppressed || [],
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
 * The point-buy budget for this character: its own choice where the ruleset
 * offers one, otherwise the ruleset's figure.
 */
export function pointBuyBudget(character, rules) {
  const pb = rules.ruleset.abilityGeneration.pointBuy;
  const chosen = num(character?.abilities?.pointBuyBudget, null);
  const allowed = (pb.budgetChoices || []).map((c) => c.points);
  if (chosen !== null && (allowed.length === 0 || allowed.includes(chosen) || rules.ruleset.variantsChosenBy === 'player')) {
    return chosen;
  }
  return pb.budget;
}

/**
 * What a set of base scores costs under point buy. Points are spent from a
 * base of 8, so an 8 is free and an 18 costs 16 on its own.
 */
export function pointBuyCost(base, rules, budget = null) {
  const pb = rules.ruleset.abilityGeneration.pointBuy;
  const table = rules.core.pointBuyCosts;
  const min = pb.minScore ?? 8;
  const max = pb.maxScore ?? 18;
  let spent = 0;
  const perScore = {};
  const outOfRange = [];
  for (const key of ABILITIES) {
    const score = num(base?.[key], 10);
    const cost = table[String(score)];
    if (cost === undefined || score < min || score > max) {
      outOfRange.push(key);
      perScore[key] = null;
      continue;
    }
    perScore[key] = cost;
    spent += cost;
  }
  const limit = budget ?? pb.budget;
  return {
    spent, perScore, outOfRange, min, max,
    budget: limit,
    remaining: limit - spent,
    ok: outOfRange.length === 0 && spent <= limit,
  };
}

/**
 * Whether a rolled array is one the ruleset would let you keep. Under the SRD
 * there are no bounds and every array is fine; a campaign may set them.
 */
export function rolledArrayCheck(base, rules) {
  const r = rules.ruleset.abilityGeneration.rolled || {};
  const total = ABILITIES.reduce((t, k) => t + num(base?.[k], 10), 0);
  const min = r.sumMin ?? null;
  const max = r.sumMax ?? null;
  const tooLow = min !== null && total < min;
  const tooHigh = max !== null && total > max;
  return { total, min, max, ok: !tooLow && !tooHigh, tooLow, tooHigh, bounded: min !== null || max !== null };
}

/**
 * Whether the scores are the standard array, in some order. Only the order is
 * the player's; the numbers are not.
 */
export function standardArrayCheck(base, rules) {
  const want = [...rules.core.standardArray].sort((x, y) => y - x);
  const have = ABILITIES.map((k) => num(base?.[k], 10)).sort((x, y) => y - x);
  return { ok: want.every((v, i) => v === have[i]), want: rules.core.standardArray };
}

/**
 * One array of six scores: 4d6 each, the lowest die dropped. `random` returns
 * [0, 1) like Math.random, so a test can hand in its own.
 *
 * @returns [{ dice: [5, 3, 6, 1], score: 14 }, ...] - six, in the order rolled
 */
export function rollAbilityArray(random = Math.random) {
  return ABILITIES.map(() => {
    const dice = Array.from({ length: 4 }, () => 1 + Math.floor(random() * 6));
    const lowest = Math.min(...dice);
    return { dice, score: dice.reduce((t, n) => t + n, 0) - lowest };
  });
}

/**
 * A fresh roll: as many arrays as the ruleset has you roll (one under the SRD),
 * the first one kept. `times` counts every roll made for this character, so a
 * sheet shows how often its scores were rolled again.
 */
export function newAbilityRolls(rules, previous = null, random = Math.random) {
  const count = Math.max(1, num(rules.ruleset.abilityGeneration?.rolled?.arrays, 1));
  return {
    arrays: Array.from({ length: count }, () => rollAbilityArray(random)),
    chosen: 0,
    times: num(previous?.times, 0) + 1,
  };
}

/**
 * The six scores a player places on their abilities, when the method hands
 * them a set: the rolled array kept, or the standard array. Null for point buy
 * and scores entered by hand, where there is nothing to place.
 */
export function scorePool(character, rules) {
  const a = character.abilities || {};
  if (a.method === 'array') return { method: 'array', scores: [...rules.core.standardArray] };
  if (a.method === 'rolled' && a.rolls?.arrays?.length) {
    const chosen = Math.min(Math.max(0, num(a.rolls.chosen, 0)), a.rolls.arrays.length - 1);
    return { method: 'rolled', chosen, scores: a.rolls.arrays[chosen].map((r) => num(r.score, 0)) };
  }
  return null;
}

/**
 * Where the set's scores went. `abilities.placed` maps an ability to the index
 * of a score in the set; each score goes to one ability.
 *
 * @returns null when there is no set to place, otherwise {
 *   method       'rolled' or 'array'
 *   scores       the set, in the order rolled (or the array's order)
 *   placed       { str: 2, ... } - only abilities holding a real, unshared index
 *   unplaced     indexes of scores not yet given to an ability
 *   matches      whether the base scores are the set, in some order
 *   arrays       rolled only: every array rolled, its total, and whether the ruleset allows it
 *   chosen, times, typed   rolled only: the array kept, how often rolled, and whether typed in
 * }
 */
export function scorePlacement(character, rules) {
  const pool = scorePool(character, rules);
  if (!pool) return null;
  const a = character.abilities;
  const { scores } = pool;
  const placed = {};
  const taken = new Set();
  for (const key of ABILITIES) {
    const i = a.placed?.[key];
    if (Number.isInteger(i) && i >= 0 && i < scores.length && !taken.has(i)) {
      placed[key] = i;
      taken.add(i);
    }
  }
  const want = [...scores].sort((x, y) => y - x);
  const have = ABILITIES.map((k) => num(a.base?.[k], 10)).sort((x, y) => y - x);
  const out = {
    method: pool.method,
    scores,
    placed,
    unplaced: scores.map((_, i) => i).filter((i) => !taken.has(i)),
    matches: want.every((v, i) => v === have[i]),
  };
  if (pool.method === 'rolled') {
    const bounds = rules.ruleset.abilityGeneration?.rolled || {};
    out.arrays = a.rolls.arrays.map((array) => {
      const total = array.reduce((t, r) => t + num(r.score, 0), 0);
      const tooLow = bounds.sumMin != null && total < bounds.sumMin;
      const tooHigh = bounds.sumMax != null && total > bounds.sumMax;
      return { scores: array.map((r) => num(r.score, 0)), total, tooLow, tooHigh, ok: !tooLow && !tooHigh };
    });
    out.chosen = pool.chosen;
    out.times = num(a.rolls.times, 1);
    out.typed = Boolean(a.rolls.typed);
  }
  return out;
}

/**
 * Give the score at `index` to `key`. Whichever ability held that score takes
 * the one `key` gave up, so a swap is one choice; `index` null takes it back.
 * Returns new `placed` and `base` - the character is not changed.
 */
export function placeScore(character, rules, key, index) {
  const pool = scorePool(character, rules);
  const placed = { ...(character.abilities.placed || {}) };
  const base = { ...(character.abilities.base || {}) };
  if (!pool) return { placed, base };
  const before = placed[key];
  if (index === null || index === undefined) {
    delete placed[key];
    return { placed, base };
  }
  const holder = ABILITIES.find((k) => k !== key && placed[k] === index);
  if (holder) {
    if (Number.isInteger(before)) {
      placed[holder] = before;
      base[holder] = pool.scores[before];
    } else {
      delete placed[holder];
    }
  }
  placed[key] = index;
  base[key] = pool.scores[index];
  return { placed, base };
}

/** Bonus spell or power slots for a high casting ability, by spell level 1-9. */
export function bonusSlots(mod) {
  const slots = {};
  for (let level = 1; level <= 9; level++) {
    slots[level] = mod >= level ? 1 + floorDiv(mod - level, 4) : 0;
  }
  return slots;
}
