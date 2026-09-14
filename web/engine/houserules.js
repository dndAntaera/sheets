// The optional systems the sheet can do arithmetic for: action points, taint,
// wealth limits, level adjustment limits, traits and flaws, training time.
//
// None of these is core 3.5. Each is switched on by a ruleset (see modules.js)
// and reads its numbers from that ruleset, so the SRD ruleset and the Antaera
// one can disagree about action points without this file knowing either exists.
// When a campaign's rule changes, the fix belongs in its ruleset file.

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
  const ap = rules.ruleset.actionPoints || rules.rulesets?.srd?.actionPoints;
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
  const bands = rules.ruleset.taint.thresholds;
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
  const pure = rules.ruleset.taint.pureSoul;
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
      dc: (points) => rules.ruleset.taint.massiveGainDC + num(points),
    },
    /** DC to resist a day of exposure, from however many sources at once. */
    exposureDC: (days = 1, sources = 1) =>
      rules.ruleset.taint.baseExposureDC
      + rules.ruleset.taint.dcPerDay * Math.max(0, days - 1)
      + rules.ruleset.taint.dcPerExtraSource * Math.max(0, sources - 1),
    worst: order.find((s) => corruption.severity === s || depravity.severity === s),
  };
}

/* ---------------------------------------------------------------------------
   Wealth - character-creation.md, DMG Table 5-1
   --------------------------------------------------------------------------- */

/**
 * Wealth: what the character starts with, what it holds, what a character of
 * its level is expected to hold, and - only where the ruleset enforces them -
 * the caps on a single item. Under the SRD the expectation is advice and
 * nothing is capped.
 *
 * Starting wealth, in order of who decides:
 *
 *   campaign        a campaign's GMs set one figure for every character in it
 *   custom          an independent character's own figure
 *   wealthByLevel   the DMG's table, from 2nd level
 *   classGold       at 1st level, the average of the first class's starting gold
 *
 * @param firstClass  the class taken at 1st level, for its starting gold
 */
export function wealth(character, ecl, rules, firstClass = null) {
  const table = rules.core.wealthByLevel;
  const policy = rules.ruleset.wealth || {};
  const tableGold = table.gp[String(ecl)] ?? null;
  const classGold = ecl <= 1 ? firstClass?.startingGold?.average ?? null : null;
  const expected = tableGold ?? classGold;
  const firstLevel = ecl <= 1;
  const caps = policy.enforceCaps && policy.singleItemCap;
  const capFraction = caps
    ? (firstLevel ? policy.singleItemCap.atFirstLevel : policy.singleItemCap.afterFirstLevel)
    : null;

  const inCampaign = Boolean(rules.campaign);
  const campaignGold = inCampaign ? rules.campaign.startingWealth : null;
  const typed = character.wealth?.startingGold;
  const custom = !inCampaign && typed !== null && typed !== undefined && typed !== '' ? num(typed) : null;
  let startingGold = 0;
  let source = 'none';
  if (campaignGold !== null && campaignGold !== undefined && campaignGold !== '') {
    startingGold = num(campaignGold);
    source = 'campaign';
  } else if (custom !== null) {
    startingGold = custom;
    source = 'custom';
  } else if (expected !== null) {
    startingGold = expected;
    source = tableGold !== null ? 'wealthByLevel' : 'classGold';
  }
  const cap = caps && startingGold ? startingGold * capFraction : null;

  const items = (character.wealth?.items || []).map((item) => ({
    ...item,
    lineValue: num(item.value) * Math.max(1, num(item.qty, 1)),
    overCap: cap !== null && num(item.value) > cap,
  }));

  const itemsValue = items.reduce((t, i) => t + i.lineValue, 0);
  const held = itemsValue + num(character.wealth?.gold);
  return {
    expected,
    startingGold,
    source,
    classGold,
    itemsValue,
    /** What is left of the starting wealth after the gear bought with it. */
    leftToSpend: startingGold - itemsValue,
    capFraction,
    cap,
    items,
    held,
    overCapItems: items.filter((i) => i.overCap),
    enforced: Boolean(caps),
    /** Level 4+ background items are held to a quarter of wealth by level. */
    backgroundItemCap: expected && policy.backgroundItemCap ? expected * policy.backgroundItemCap : null,
  };
}

/* ---------------------------------------------------------------------------
   Level adjustment - character-creation.md
   --------------------------------------------------------------------------- */

/**
 * Level adjustment against the ruleset's cap, if it has one. Antaera holds
 * starting LA to a quarter of ECL with +1 always allowed; the SRD sets no cap,
 * and then every LA is fine and `allowed` is null.
 */
export function levelAdjustment(la, ecl, rules) {
  const taken = num(la);
  const fraction = rules.ruleset.levelAdjustment?.cap;
  if (fraction === null || fraction === undefined) {
    return { la: taken, ecl, allowed: null, ok: true, capped: false };
  }
  const allowed = taken === 0 ? 0 : Math.max(1, Math.floor(ecl * fraction));
  return { la: taken, ecl, allowed, ok: taken <= allowed, capped: true };
}

/* ---------------------------------------------------------------------------
   Feats, traits and flaws - character-creation.md
   --------------------------------------------------------------------------- */

/**
 * Feats earned and taken.
 *
 * Levels grant them; a race or class may grant more, either typed on the sheet
 * or as a `feats.bonus` effect (a human's bonus feat arrives that way); and
 * where traits and flaws are in play, each flaw buys one.
 *
 * @param opts { traitsFlaws: boolean, bonusFromEffects: number }
 */
export function featBudget(character, summary, rules, opts = {}) {
  const tf = rules.ruleset.traitsFlaws || rules.rulesets?.srd?.traitsFlaws || { traits: 2, flaws: 2, featPerFlaw: 1 };
  const useTF = opts.traitsFlaws !== false;
  const traits = useTF ? (character.traits || []).filter((t) => t.name).length : 0;
  const flaws = useTF ? (character.flaws || []).filter((f) => f.name).length : 0;
  const fromFlaws = useTF ? Math.min(flaws, tf.flaws) * tf.featPerFlaw : 0;
  const granted = num(character.featSlots?.bonus) + num(opts.bonusFromEffects);
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
  const t = rules.ruleset.training;
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
