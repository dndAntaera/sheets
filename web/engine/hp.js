// Hit points, level by level.
//
// Two campaign rules shape this: maximum at 1st level, and after that a choice
// of average or rolled that is made once and then holds for the whole career.
// The sheet keeps every level's number so a rolled build can be audited, and so
// switching the choice never quietly rewrites history - it only changes which
// number each row uses.

import { num } from './util.js';

/** The average of a die, the way tables have always written it: half, plus one. */
export const averageOf = (die) => (die > 0 ? Math.floor(die / 2) + 1 : 0);

/**
 * @param rows  [{ level, die }] from buildSummary, lowest level first
 * @param hp    character.hp: { method, rolls: { 2: 7 }, bonus, racial }
 * @param conMod  the modifier WITHOUT temporary adjustments
 */
export function hitPoints(rows, hp, conMod, rules) {
  const method = hp?.method === 'roll' ? 'roll' : 'average';
  const maxAtFirst = rules.rules.hitPoints.maxAtFirst !== false;
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
    const gained = Math.max(1, fromDie + conMod);
    perLevel.push({ ...row, basis, fromDie, conMod, gained, needsRoll: basis === 'missing' });
  });

  const fromLevels = perLevel.reduce((t, r) => t + r.gained, 0);
  const bonus = num(hp?.bonus);
  return {
    method,
    perLevel,
    fromLevels,
    bonus,
    total: fromLevels + bonus,
    missingRolls: perLevel.filter((r) => r.needsRoll).map((r) => r.level),
  };
}
