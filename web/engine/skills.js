// Skills: the points you have to spend, the ranks you may put in one place,
// and what each line on the sheet adds up to.

import { abilityMod, num, floorDiv } from './util.js';

/**
 * The skill point budget for the whole build.
 *
 * First level is the per-level figure times four. Every level after is the
 * figure itself, and never less than 1 no matter how low Intelligence is -
 * a character with Int 3 still learns something each level.
 *
 * Under gestalt the per-level figure is the better of the two classes taken
 * at that level, which buildSummary has already worked out.
 */
export function skillPointBudget(summary, intMod, racialPerLevel = 0) {
  const rows = summary.skillPointsPerLevel.map(({ level, base }) => {
    const perLevel = Math.max(1, base + intMod + num(racialPerLevel));
    const points = level === 1 ? perLevel * 4 : perLevel;
    return { level, base, perLevel, points, quadrupled: level === 1 };
  });
  return { rows, total: rows.reduce((t, r) => t + r.points, 0) };
}

/** Class skills cap at hit dice + 3; cross-class at half that, halves kept. */
export function maxRanks(hitDice, isClassSkill) {
  const cap = hitDice + 3;
  return isClassSkill ? cap : cap / 2;
}

/**
 * Is this line a class skill? A class list carrying a bare "Knowledge" makes
 * every Knowledge a class skill; one carrying "Knowledge (nature)" makes only
 * that subject a class skill, which is how the cleric and wizard lists differ.
 */
export function isClassSkill(classSkills, name, subtype) {
  if (classSkills.has(name)) return true;
  if (subtype && classSkills.has(`${name} (${subtype})`)) return true;
  return false;
}

/** A rank costs 1 point on a class skill and 2 on a cross-class one. */
export const rankCost = (ranks, classSkill) => (classSkill ? ranks : ranks * 2);

/**
 * One line of the skill table, totalled.
 *
 * The armour check penalty is stored as a positive number and subtracted here,
 * twice for Swim, which is the only skill that suffers it double.
 */
export function skillLine(entry, ctx) {
  const def = ctx.skillsByName.get(entry.name) || { name: entry.name, ability: null };
  const classSkill = isClassSkill(ctx.classSkills, entry.name, entry.subtype);
  const ranks = num(entry.ranks);
  const ability = def.ability ? ctx.abilities[def.ability] : null;
  const acp = def.acp ? ctx.armorCheckPenalty * (def.acpDouble ? 2 : 1) : 0;
  const sizeMod = def.sizeMod ? num(ctx.sizeHideMod) : 0;
  const misc = num(entry.misc);

  const total = (ability ? ability.mod : 0) + ranks + misc + sizeMod - acp;
  const cap = maxRanks(ctx.hitDice, classSkill);

  return {
    ...entry,
    def,
    classSkill,
    ranks,
    abilityKey: def.ability,
    abilityMod: ability ? ability.mod : 0,
    acp,
    sizeMod,
    misc,
    cost: rankCost(ranks, classSkill),
    maxRanks: cap,
    overCap: ranks > cap,
    untrained: def.trainedOnly && ranks <= 0,
    total: def.noCheck ? null : total,
  };
}

/** Every line, plus what the ranks cost against the budget. */
export function skillTable(character, ctx) {
  const lines = (character.skills || []).map((entry) => skillLine(entry, ctx));
  return {
    lines,
    spent: lines.reduce((t, l) => t + l.cost, 0),
  };
}

/** Ranks that count as "5 or more ranks" synergies, for the notes column. */
export function synergies(lines) {
  return lines.filter((l) => l.ranks >= 5).map((l) => l.name);
}

export { abilityMod, floorDiv };
