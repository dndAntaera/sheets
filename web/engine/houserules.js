// The Antaeran houserules the sheet can actually do arithmetic for.
//
// Each function names the wiki page it implements. When a rule changes on the
// wiki, the fix belongs here and in web/data/rules.json, and nowhere else.

import { floorDiv, num } from './util.js';

/* ---------------------------------------------------------------------------
   Action points - rules/action-points.md
   --------------------------------------------------------------------------- */

/**
 * The pool. Two readings of the page are possible and they differ a lot by
 * 10th level, so the campaign picks one:
 *
 *   refresh     5 + half your level, renewed at each new level (the printed
 *               variant, where unspent points do not carry over)
 *   accumulate  5 + half the new level ADDED to the pool at every level, which
 *               is what "every time a character advances, he gains" says if
 *               read on its own
 *
 * Spent points are gone for good either way.
 */
export function actionPoints(level, spent, rules, bonus = 0) {
  const ap = rules.rules.actionPoints;
  const mode = ap.mode === 'accumulate' ? 'accumulate' : 'refresh';
  const atLevel = (l) => 5 + floorDiv(l, 2);

  let earned;
  if (mode === 'accumulate') {
    earned = 5;
    for (let l = 2; l <= level; l++) earned += atLevel(l);
  } else {
    earned = level <= 1 ? ap.firstLevel : atLevel(level);
  }
  earned += num(bonus);

  const band = ap.diceByLevel.find((b) => level >= b.from && level <= b.to);
  const dice = band ? band.dice : 1;
  return {
    mode,
    earned,
    spent: num(spent),
    remaining: earned - num(spent),
    dice,
    /** What one point actually rolls: the best of this many d6. */
    roll: dice + 'd6, keep highest',
  };
}

/* ---------------------------------------------------------------------------
   Taint - rules/taint.md
   --------------------------------------------------------------------------- */

/**
 * How far a taint score has got, read against the ability that resists it:
 * corruption against Constitution, depravity against Wisdom.
 *
 * Below the mild band a character has taint on the books but shows no symptom
 * yet, which the table writes as a dash and this returns as "none".
 */
export function taintSeverity(score, ability, rules) {
  const bands = rules.rules.taint.thresholds;
  const s = num(score);
  const band = bands.find((b) => ability >= b.score[0] && ability <= b.score[1])
    || bands[bands.length - 1];

  let severity = 'none';
  if (s > band.severe[1]) severity = 'past';
  else if (s >= band.severe[0]) severity = 'severe';
  else if (s >= band.moderate[0]) severity = 'moderate';
  else if (s >= band.mild[0]) severity = 'mild';

  const toNext = severity === 'none' ? band.mild[0] - s
    : severity === 'mild' ? band.moderate[0] - s
      : severity === 'moderate' ? band.severe[0] - s
        : severity === 'severe' ? band.severe[1] + 1 - s : 0;

  return { score: s, severity, band, hasTaint: s > 0, toNext };
}

/** Taint, both halves, plus the saves that resist more of it. */
export function taint(character, abilities, rules) {
  const t = character.taint || {};
  const corruption = taintSeverity(t.corruption, abilities.con.total, rules);
  const depravity = taintSeverity(t.depravity, abilities.wis.total, rules);

  // Pure Soul is +4, and +1 more per Exalted feat held - the feat counts itself,
  // so a character whose only Exalted feat is Pure Soul gets +5.
  const pure = rules.rules.taint.pureSoul;
  const resistBonus = t.pureSoul
    ? pure.base + pure.perExaltedFeat * Math.max(1, num(t.exaltedFeats, 1))
    : 0;

  const order = ['past', 'severe', 'moderate', 'mild', 'none'];
  return {
    corruption,
    depravity,
    effective: corruption.score + depravity.score,
    resistBonus,
    /** Gaining more than half the ability at once forces a second save. */
    massiveGainThreshold: {
      corruption: floorDiv(abilities.con.total, 2),
      depravity: floorDiv(abilities.wis.total, 2),
      dc: (points) => rules.rules.taint.massiveGainDC + num(points),
    },
    /** DC to resist a day of exposure, from however many sources at once. */
    exposureDC: (days = 1, sources = 1) =>
      rules.rules.taint.baseExposureDC
      + rules.rules.taint.dcPerDay * Math.max(0, days - 1)
      + rules.rules.taint.dcPerExtraSource * Math.max(0, sources - 1),
    worst: order.find((s) => corruption.severity === s || depravity.severity === s),
  };
}

/* ---------------------------------------------------------------------------
   Wealth - character-creation.md, DMG Table 5-1
   --------------------------------------------------------------------------- */

export function wealth(character, ecl, rules) {
  const w = rules.rules.wealthByLevel;
  const expected = w.gp[String(ecl)] ?? null;
  const firstLevel = ecl <= 1;
  const capFraction = firstLevel
    ? w.singleItemCap.atFirstLevel
    : w.singleItemCap.afterFirstLevel;
  const startingGold = num(character.wealth?.startingGold, expected || 0);
  const cap = startingGold ? startingGold * capFraction : null;

  const items = (character.wealth?.items || []).map((item) => ({
    ...item,
    lineValue: num(item.value) * Math.max(1, num(item.qty, 1)),
    overCap: cap !== null && num(item.value) > cap,
  }));

  const held = items.reduce((t, i) => t + i.lineValue, 0) + num(character.wealth?.gold);
  return {
    expected,
    startingGold,
    capFraction,
    cap,
    items,
    held,
    overCapItems: items.filter((i) => i.overCap),
    /** Level 4+ background items are held to a quarter of wealth by level. */
    backgroundItemCap: expected ? expected * w.backgroundItemCap : null,
  };
}

/* ---------------------------------------------------------------------------
   Level adjustment - character-creation.md
   --------------------------------------------------------------------------- */

/** Starting LA may not pass a quarter of ECL, and +1 is always allowed. */
export function levelAdjustment(la, ecl, rules) {
  const taken = num(la);
  const allowed = taken === 0
    ? 0
    : Math.max(1, Math.floor(ecl * rules.rules.levelAdjustment.maxFraction));
  return { la: taken, ecl, allowed, ok: taken <= allowed };
}

/* ---------------------------------------------------------------------------
   Feats, traits and flaws - character-creation.md
   --------------------------------------------------------------------------- */

export function featBudget(character, summary, rules) {
  const tf = rules.rules.traitsFlaws;
  const traits = (character.traits || []).filter((t) => t.name).length;
  const flaws = (character.flaws || []).filter((f) => f.name).length;
  const fromFlaws = Math.min(flaws, tf.flaws) * tf.featPerFlaw;
  const granted = num(character.featSlots?.bonus);
  const allowed = summary.featsFromLevels + fromFlaws + granted;
  const taken = (character.feats || []).filter((f) => f.name).length;

  return {
    traits,
    flaws,
    fromFlaws,
    granted,
    fromLevels: summary.featsFromLevels,
    allowed,
    taken,
    remaining: allowed - taken,
    traitLimit: tf.traits,
    flawLimit: tf.flaws,
  };
}

/* ---------------------------------------------------------------------------
   Training time - the-index.md
   --------------------------------------------------------------------------- */

/**
 * Days of training for a level. Under gestalt the two sides train at the same
 * time rather than one after the other, so the level costs the longer of the
 * two - and the far-ahead class counts as three quarters of its level, which is
 * the campaign brake on lopsided builds.
 *
 * The wiki's own example pins the reading down: Fighter 6 // Rogue 4/Sorcerer 2
 * taking Fighter 7 and Sorcerer 3 costs "2 days and 1 day". Fighter 7 is more
 * than twice Sorcerer 3, so it trains at 7 x 3/4 = 5.25, halved and rounded
 * down to 2; the sorcerer side pays the plain 3/2 = 1. So the comparison is
 * between the two class levels being taken, not between the sides as a whole.
 *
 * @param nextLevels [{ classLevel, prestige }] one per active side
 */
export function trainingTime(nextLevels, rules, gestalt) {
  const t = rules.rules.trainingTime;
  const days = (classLevel, prestige, discount) => {
    if (classLevel <= 1) return prestige ? t.prestige.firstLevel : t.base.firstLevel;
    const level = discount ? classLevel * t.gestalt.lopsidedFactor : classLevel;
    return prestige ? Math.floor(level) : Math.floor(level / 2);
  };

  if (!gestalt || nextLevels.length < 2) {
    const n = nextLevels[0];
    return n
      ? { days: days(n.classLevel, n.prestige, false), perSide: null }
      : { days: 0, perSide: null };
  }

  const [a, b] = nextLevels;
  const lopsided = (x, y) => x.classLevel > y.classLevel * 2;
  const perSide = [
    days(a.classLevel, a.prestige, lopsided(a, b)),
    days(b.classLevel, b.prestige, lopsided(b, a)),
  ];
  return { days: Math.max(...perSide), perSide, overlapping: true };
}
