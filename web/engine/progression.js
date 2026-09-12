// The three progressions every class is built from, and the attack routine
// that falls out of the first one.

import { floorDiv } from './util.js';

/**
 * Base attack bonus for a number of levels in one progression.
 *   good    +1 per level          (fighter, barbarian, paladin, ranger)
 *   average +3/4 per level        (cleric, rogue, monk, bard, most psionics)
 *   poor    +1/2 per level        (wizard, sorcerer, psion)
 */
export function babFor(kind, levels) {
  if (levels <= 0) return 0;
  switch (kind) {
    case 'good': return levels;
    case 'average': return floorDiv(levels * 3, 4);
    case 'poor': return floorDiv(levels, 2);
    default: return 0;
  }
}

/**
 * Base save bonus for a number of levels in one progression.
 *   good  2 + level/2
 *   poor  level/3
 * Both round down. A good save is worth +2 at 1st level, which is why a
 * gestalt character with two good saves in one slot still only gets +2: the
 * better progression is taken, not the sum of them.
 */
export function saveFor(kind, levels) {
  if (levels <= 0) return 0;
  if (kind === 'good') return 2 + floorDiv(levels, 2);
  if (kind === 'poor') return floorDiv(levels, 3);
  // Anything else - including a class the sheet does not recognise - adds
  // nothing. Falling back to "poor" would quietly hand out saves for a class
  // whose real progression nobody has entered yet.
  return 0;
}

/**
 * The full attack routine for a base attack bonus: +6 becomes [6, 1],
 * +11 becomes [11, 6, 1]. Extra attacks arrive at +6 and every +5 after.
 */
export function iterativeAttacks(bab) {
  if (bab < 1) return [bab];
  const attacks = [];
  for (let b = bab; b > 0; b -= 5) attacks.push(b);
  return attacks.length ? attacks : [bab];
}
