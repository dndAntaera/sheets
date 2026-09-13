// Hit points, level by level.
//
// Maximum at first level, then average or rolled. The sheet keeps every level's
// number so a rolled build can be audited, and so switching the choice never
// quietly rewrites history - it only changes which number each row uses.

import { num } from './util.js';

/** The average of a die, the way tables have always written it: half, plus one. */
export const averageOf = (die) => (die > 0 ? Math.floor(die / 2) + 1 : 0);

/**
 * @param rows     [{ level, die }] from buildSummary, lowest level first
 * @param hp       character.hp: { method, rolls: { 2: 7 }, bonus }
 * @param conMod   the Constitution modifier WITHOUT temporary adjustments
 * @param rules    for whether the first die is maximised
 * @param extra    { flat, racialHD } - effect bonuses to hit points, and
 *                 racial hit dice, whose presence means the first CLASS die is
 *                 no longer the character's first die and is not maximised
 */
export function hitPoints(rows, hp, conMod, rules, extra = {}) {
  const method = hp?.method === 'roll' ? 'roll' : 'average';
  const setting = rules.ruleset?.hitPoints?.maxAtFirst ?? rules.core?.hitPoints?.maxAtFirst ?? true;
  const maxAtFirst = setting && !num(extra.racialHD);
  const perLevel = [];

  rows.forEach((row, i) => {
    const first = i === 0;
    const rolled = num(hp?.rolls?.[row.level], null);
    let fromDie;
    let basis;

    if (first && maxAtFirst) {
      fromDie = row.die;
      basis = 'max';
    } else if (method === 'roll') {
      fromDie = rolled === null ? 0 : rolled;
      basis = rolled === null ? 'missing' : 'rolled';
    } else {
      fromDie = averageOf(row.die);
      basis = 'average';
    }

    // A level never gives less than 1 hit point, however bad the Constitution.
    const gained = row.die > 0 ? Math.max(1, fromDie + conMod) : 0;
    perLevel.push({ ...row, basis, fromDie, conMod, gained, needsRoll: basis === 'missing' && row.die > 0 });
  });

  const fromLevels = perLevel.reduce((t, r) => t + r.gained, 0);
  const typed = num(hp?.bonus);
  const effects = num(extra.flat);
  return {
    method,
    perLevel,
    fromLevels,
    bonus: typed + effects,
    typedBonus: typed,
    effectBonus: effects,
    total: fromLevels + typed + effects,
    missingRolls: perLevel.filter((r) => r.needsRoll).map((r) => r.level),
  };
}
