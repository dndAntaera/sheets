// Everything the sheet shows that the player did not type.
//
// derive() is the one function the interface calls. It takes a stored character
// and the campaign rules, and returns a second object beside it holding every
// computed number. Nothing here writes to the character: a derived sheet can
// always be thrown away and rebuilt, which is what makes it safe to recompute
// on every keystroke.
//
// It also returns `notices` - the places where the sheet and the campaign rules
// disagree. That list is the "manages it for them" half of this tool: the point
// is that a player finds out they have overspent their skill points while they
// are building, not when the DM reads the sheet.

import { buildSummary } from './build.js';
import { abilityTotals, pointBuyCost, rolledArrayCheck, bonusSlots, ABILITIES } from './abilities.js';
import { skillPointBudget, skillTable } from './skills.js';
import { hitPoints } from './hp.js';
import { armorClass, initiative, armorCheckPenalty } from './defense.js';
import { attacks, weaponLine } from './offense.js';
import { actionPoints, taint, wealth, levelAdjustment, featBudget, trainingTime } from './houserules.js';
import { num } from './util.js';

const SAVE_ABILITY = { fort: 'con', ref: 'dex', will: 'wis' };

export function derive(character, rules, options = {}) {
  const gestalt = options.gestalt ?? rules.rules.campaign.gestaltDefault ?? false;
  const summary = buildSummary(character, rules, gestalt);
  const abilities = abilityTotals(character, summary);
  const size = rules.rules.sizes.find((s) => s.name === (character.race?.size || 'Medium'))
    || rules.rules.sizes.find((s) => s.name === 'Medium');

  const gear = character.gear || {};
  const ac = armorClass(gear, abilities.dex.mod, size.ac, rules);
  const init = initiative(abilities.dex.mod, character.combat?.initiativeMisc);
  const attackSet = attacks(summary, abilities, size, character.combat?.misc);

  const hp = hitPoints(summary.hitDice, character.hp, abilities.con.baseMod, rules);

  const saves = {};
  for (const [save, ability] of Object.entries(SAVE_ABILITY)) {
    const base = summary.baseSaves[save];
    const abilityBonus = abilities[ability].mod;
    const magic = num(character.saves?.magic?.[save]);
    const misc = num(character.saves?.misc?.[save]);
    saves[save] = {
      base,
      ability: abilityBonus,
      abilityKey: ability,
      magic,
      misc,
      total: base + abilityBonus + magic + misc,
    };
  }

  const skillCtx = {
    skillsByName: rules.skillsByName,
    classSkills: summary.classSkills,
    abilities,
    hitDice: summary.hitDiceCount,
    armorCheckPenalty: armorCheckPenalty(gear),
    sizeHideMod: size.hide,
  };
  const skills = skillTable(character, skillCtx);
  const budget = skillPointBudget(summary, abilities.int.mod, character.race?.skillPointsPerLevel);

  const ap = actionPoints(summary.hitDiceCount, character.actionPoints?.spent, rules, character.actionPoints?.bonus);
  const taintState = taint(character, abilities, rules);
  const money = wealth(character, summary.ecl, rules);
  const la = levelAdjustment(character.race?.la, summary.ecl, rules);
  const feats = featBudget(character, summary, rules);

  const weapons = (character.weapons || []).map((w) => weaponLine(w, attackSet, abilities));

  const derived = {
    gestalt,
    summary,
    abilities,
    size,
    hp,
    ac,
    initiative: init,
    attacks: attackSet,
    weapons,
    saves,
    skills: { ...skills, budget, remaining: budget.total - skills.spent },
    actionPoints: ap,
    taint: taintState,
    wealth: money,
    levelAdjustment: la,
    feats,
    training: nextLevelTraining(character, rules, summary, gestalt),
    casting: castingSummary(character, rules, summary, abilities),
  };

  // Two readouts the sheet shows beside the ability block. They are derived,
  // not stored, so switching between point buy and a rolled array never edits
  // anything a player typed.
  derived.pointBuy = pointBuyCost(character.abilities?.base, rules);
  derived.rolledTotal = rolledArrayCheck(character.abilities?.base, rules).total;

  derived.notices = notices(character, derived, rules);
  return derived;
}

/** Training days for the level after this one, per the-index.md. */
function nextLevelTraining(character, rules, summary, gestalt) {
  const next = summary.sides.map((side) => {
    const planned = character.nextLevel?.[side.side];
    const existing = side.classes.find((c) => c.name === planned);
    return {
      classLevel: (existing ? existing.levels : 0) + 1,
      prestige: Boolean(rules.classByName.get(planned)?.prestige
        || (character.customClasses || []).find((c) => c.name === planned)?.prestige),
      sideTotal: side.levels,
      className: planned || null,
    };
  });
  if (!next.some((n) => n.className)) return null;
  return { ...trainingTime(next, rules, gestalt), sides: next };
}

/** Save DCs and bonus slots, for each casting or manifesting class taken. */
function castingSummary(character, rules, summary, abilities) {
  const seen = new Map();
  for (const side of summary.sides) {
    for (const c of side.classes) {
      const key = c.def.casting ? 'casting' : c.def.manifesting ? 'manifesting' : null;
      if (!key) continue;
      const ability = (c.def.casting || c.def.manifesting).ability;
      const mod = abilities[ability].mod;
      seen.set(c.name, {
        name: c.name,
        kind: key,
        levels: c.levels,
        ability,
        mod,
        // Spells per day come from class tables that are not in this repo, but
        // the bonus slots a high ability grants are pure arithmetic.
        bonusSlots: bonusSlots(mod),
        saveDC: (spellLevel) => 10 + spellLevel + mod,
        note: c.def.note,
      });
    }
  }
  return [...seen.values()];
}

/**
 * Where the sheet and the rules disagree.
 *
 * `error` is something a DM would send back; `warn` is probably a mistake but
 * has legitimate cases; `info` is a reminder and nothing more. Nothing here
 * blocks saving - a half-built character is a normal state, and a sheet that
 * refuses to save is a sheet players stop using.
 */
function notices(character, d, rules) {
  const out = [];
  const add = (level, text, field) => out.push({ level, text, field });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // --- Ability scores ------------------------------------------------------
  const method = character.abilities?.method;
  if (method === 'pointBuy') {
    const pb = pointBuyCost(character.abilities?.base, rules);
    if (pb.outOfRange.length) {
      add('error', `Point buy covers scores 8 to 18. Out of range: ${pb.outOfRange.join(', ').toUpperCase()}.`, 'abilities');
    } else if (pb.spent > pb.budget) {
      add('error', `Point buy is over budget: ${pb.spent} of ${pb.budget} spent.`, 'abilities');
    } else if (pb.remaining > 0) {
      add('info', `${plural(pb.remaining, 'point', 'points')} of point buy still unspent.`, 'abilities');
    }
  } else if (method === 'rolled') {
    const r = rolledArrayCheck(character.abilities?.base, rules);
    if (r.tooLow) add('error', `Rolled array totals ${r.total}; under ${r.min} it must be rerolled.`, 'abilities');
    if (r.tooHigh) add('error', `Rolled array totals ${r.total}; over ${r.max} it must be rerolled.`, 'abilities');
  }

  if (d.abilities.levelUpsUsed > d.abilities.levelUpsAllowed) {
    add('error', `${d.abilities.levelUpsUsed} level-up ability increases assigned, but only ${d.abilities.levelUpsAllowed} earned.`, 'abilities');
  } else if (d.abilities.levelUpsUsed < d.abilities.levelUpsAllowed) {
    add('info', `${d.abilities.levelUpsAllowed - d.abilities.levelUpsUsed} ability increase still to assign.`, 'abilities');
  }

  // Items that raise an ability come in even numbers only - the-index.md.
  for (const key of ABILITIES) {
    const bonus = num(character.abilities?.enhancement?.[key]);
    if (bonus && bonus % 2 !== 0) {
      add('warn', `${key.toUpperCase()} enhancement is +${bonus}; ability-boosting items come in even numbers only.`, 'abilities');
    }
  }

  // --- The build -----------------------------------------------------------
  if (d.summary.classLevels === 0) {
    add('info', 'No class levels yet. Add one under Levels.', 'levels');
  }
  if (d.summary.classLevels && d.summary.ecl < rules.rules.campaign.startingLevel) {
    add('info', `Characters enter this campaign at level ${rules.rules.campaign.startingLevel}; this one is ECL ${d.summary.ecl}.`, 'levels');
  }
  for (const side of d.summary.sides) {
    for (const c of side.classes) {
      if (c.def.missing) {
        add('error', `"${c.name}" is not a class the sheet knows. Add it under Custom Classes so its numbers can be counted.`, 'levels');
      }
    }
  }
  if (d.gestalt) {
    (character.levels || []).forEach((row, i) => {
      const both = [row.a, row.b]
        .map((n) => rules.classByName.get(n) || (character.customClasses || []).find((c) => c.name === n))
        .filter(Boolean);
      if (both.length === 2 && both.every((c) => c.prestige)) {
        add('error', `Level ${i + 1} pairs two prestige classes, which gestalt does not allow.`, 'levels');
      }
      if (row.a && row.b && row.a === row.b) {
        add('error', `Level ${i + 1} takes ${row.a} on both sides; the two halves must differ.`, 'levels');
      }
    });
  }
  if (!d.gestalt && (character.levels || []).some((row) => row.b)) {
    add('info', 'Gestalt is off for this campaign, so the second class column is being ignored.', 'levels');
  }

  // --- Level adjustment ----------------------------------------------------
  if (!d.levelAdjustment.ok) {
    add('error', `Level adjustment +${d.levelAdjustment.la} exceeds the +${d.levelAdjustment.allowed} allowed at ECL ${d.levelAdjustment.ecl}.`, 'race');
  }

  // --- Hit points ----------------------------------------------------------
  if (d.hp.missingRolls.length) {
    add('warn', `Hit points rolled but no roll recorded for ${d.hp.missingRolls.length === 1 ? 'level' : 'levels'} ${d.hp.missingRolls.join(', ')}.`, 'hp');
  }

  // --- Skills --------------------------------------------------------------
  if (d.skills.remaining < 0) {
    add('error', `Skill points overspent by ${-d.skills.remaining}.`, 'skills');
  } else if (d.skills.remaining > 0 && d.summary.classLevels) {
    add('info', `${plural(d.skills.remaining, 'skill point', 'skill points')} unspent.`, 'skills');
  }
  for (const line of d.skills.lines) {
    if (line.overCap) {
      const label = line.subtype ? `${line.name} (${line.subtype})` : line.name;
      add('error', `${label} has ${line.ranks} ranks; the cap at ${d.summary.hitDiceCount} hit dice is ${line.maxRanks} ${line.classSkill ? '(class skill)' : '(cross-class)'}.`, 'skills');
    }
  }

  // --- Feats, traits, flaws ------------------------------------------------
  const f = d.feats;
  if (f.taken > f.allowed) add('error', `${f.taken} feats taken, ${f.allowed} available.`, 'feats');
  else if (f.taken < f.allowed) add('info', `${plural(f.allowed - f.taken, 'feat', 'feats')} still to choose.`, 'feats');
  if (f.traits > f.traitLimit) add('error', `${f.traits} traits taken; the limit is ${f.traitLimit}.`, 'feats');
  if (f.flaws > f.flawLimit) add('error', `${f.flaws} flaws taken; the limit is ${f.flawLimit}.`, 'feats');

  // --- Background ----------------------------------------------------------
  if (!character.background?.name && d.summary.classLevels) {
    add('warn', 'No background chosen. Every character picks one at 1st level.', 'background');
  }

  // --- Wealth --------------------------------------------------------------
  for (const item of d.wealth.overCapItems) {
    add('warn', `${item.name || 'An item'} is worth ${num(item.value).toLocaleString()} gp, over the ${Math.round(d.wealth.capFraction * 100)}% single-item cap of ${Math.round(d.wealth.cap).toLocaleString()} gp.`, 'wealth');
  }
  if (d.wealth.expected && d.wealth.held > d.wealth.expected * 1.1) {
    add('warn', `Holdings total ${Math.round(d.wealth.held).toLocaleString()} gp against ${d.wealth.expected.toLocaleString()} gp expected at ECL ${d.summary.ecl}.`, 'wealth');
  }

  // --- Taint ---------------------------------------------------------------
  for (const [which, state] of [['Corruption', d.taint.corruption], ['Depravity', d.taint.depravity]]) {
    if (state.severity === 'past') {
      add('error', `${which} ${state.score} is past the severe threshold. ${which === 'Corruption' ? 'The character dies and rises as a tainted minion.' : 'The character goes irretrievably mad.'}`, 'taint');
    } else if (state.severity !== 'none') {
      add('warn', `${which} ${state.score}: ${state.severity} taint. ${state.toNext} more crosses the next threshold.`, 'taint');
    }
  }

  return out;
}
