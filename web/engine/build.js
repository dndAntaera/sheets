// The class build: what levels a character has taken, and the four things that
// fall out of them - hit dice, base attack bonus, base saves, and skill points.
//
// Gestalt lives here, and it is the reason this file exists at all. A gestalt
// character is not one build with bonuses; it is two complete builds worn at
// once. So each side is totalled as if it were the whole character, and only
// then is the better of the two taken, category by category. Doing it the other
// way round - picking the better class level by level and adding as you go -
// gives the wrong answer for anything that rounds, which is most of 3.5e.

import { babFor, saveFor } from './progression.js';
import { floorDiv, num } from './util.js';

export const SIDES = ['a', 'b'];
const SAVES = ['fort', 'ref', 'will'];

/** Every class the sheet knows about: the SRD list plus this character's own. */
export function classIndex(rules, character) {
  const index = new Map();
  for (const c of rules.classes.classes) index.set(c.name, c);
  for (const c of character.customClasses || []) {
    if (c.name) index.set(c.name, { ...c, custom: true });
  }
  return index;
}

// A class nobody has defined yet contributes nothing at all: no hit die, no
// attack bonus, no saves, no skill points. The sheet raises a notice instead,
// so the gap is visible rather than absorbed into a plausible-looking total.
const UNKNOWN = {
  name: '?', hd: 0, bab: null,
  saves: { fort: null, ref: null, will: null },
  skillPoints: 0, classSkills: [], missing: true,
};

/**
 * Group one side's level rows into class totals, in the order the classes were
 * first taken - which is the order a 3.5e sheet writes them: "Fighter 3/Rogue 2".
 */
function classesOnSide(levels, side, index) {
  const order = [];
  const counts = new Map();
  for (const row of levels) {
    const name = row[side];
    if (!name) continue;
    if (!counts.has(name)) { counts.set(name, 0); order.push(name); }
    counts.set(name, counts.get(name) + 1);
  }
  return order.map((name) => ({
    name,
    levels: counts.get(name),
    def: index.get(name) || { ...UNKNOWN, name },
  }));
}

/**
 * A multiclass character's BAB and saves are the SUM of each class's own
 * progression at its own level - not one progression run over the total. A
 * Fighter 3/Rogue 3 has +3 and +2, so +5; a Fighter 6 has +6.
 */
function totalSide(taken) {
  const bab = taken.reduce((t, c) => t + babFor(c.def.bab, c.levels), 0);
  const saves = {};
  for (const s of SAVES) {
    saves[s] = taken.reduce((t, c) => t + saveFor(c.def.saves?.[s], c.levels), 0);
  }
  return { classes: taken, bab, saves, levels: taken.reduce((t, c) => t + c.levels, 0) };
}

/**
 * Summarise the whole build. `gestalt` comes from the campaign, not the
 * character: with it off, side B is ignored even if rows still hold values,
 * so a GM can switch it off without silently rewriting anyone's sheet.
 */
export function buildSummary(character, rules, gestalt) {
  const index = classIndex(rules, character);
  const levels = character.levels || [];
  const active = gestalt ? SIDES : ['a'];

  const sides = active.map((side) => ({ side, ...totalSide(classesOnSide(levels, side, index)) }));
  const best = (pick) => Math.max(0, ...sides.map(pick));

  // Hit dice, level by level: the larger die of the two classes taken at that
  // level. A monk//sorcerer rolls d8s, never d4s.
  const hitDice = levels.map((row, i) => {
    const dice = active
      .map((side) => index.get(row[side])?.hd)
      .filter((d) => Number.isFinite(d) && d > 0);
    return { level: i + 1, die: dice.length ? Math.max(...dice) : 0 };
  });

  // Skill points per level, before Intelligence: again the better of the two.
  const skillPointsPerLevel = levels.map((row, i) => {
    const points = active
      .map((side) => index.get(row[side])?.skillPoints)
      .filter((p) => Number.isFinite(p));
    return { level: i + 1, base: points.length ? Math.max(...points) : 0 };
  });

  // A skill is a class skill if it appears on ANY list the character has taken,
  // on either side. Subtyped skills are matched loosely, so a list carrying
  // "Knowledge (nature)" makes Knowledge a class skill for that subject and a
  // bare "Knowledge" makes every subject one.
  const classSkills = new Set();
  for (const s of sides) {
    for (const c of s.classes) for (const name of c.def.classSkills || []) classSkills.add(name);
  }

  const classLevels = levels.length;
  const racialHD = num(character.race?.racialHD);
  const la = num(character.race?.la);
  const hd = classLevels + racialHD;

  return {
    gestalt,
    sides,
    classLevels,
    racialHD,
    la,
    hitDiceCount: hd,
    ecl: hd + la,
    bab: best((s) => s.bab),
    baseSaves: Object.fromEntries(SAVES.map((s) => [s, best((x) => x.saves[s])])),
    hitDice,
    skillPointsPerLevel,
    classSkills,
    /** "Fighter 3/Rogue 2 // Wizard 5", the way a gestalt sheet is written. */
    label: sides
      .map((s) => s.classes.map((c) => `${c.name} ${c.levels}`).join('/'))
      .filter(Boolean)
      .join(' // '),
    /** Feats come every third hit die, plus one at 1st level. */
    featsFromLevels: hd > 0 ? 1 + floorDiv(hd, 3) : 0,
    /** +1 to an ability at 4th level and every fourth level after. */
    abilityIncreases: floorDiv(hd, 4),
  };
}
