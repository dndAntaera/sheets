// Everything the sheet shows that the player did not type.
//
// derive() is the one function the interface calls. It takes a stored character
// and the rules, and returns a second object beside it holding every computed
// number. Nothing here writes to the character: a derived sheet can always be
// thrown away and rebuilt, which is what makes it safe to recompute on every
// keystroke.
//
// The order below is the order the numbers depend on each other:
//
//   1. which rules are in force        the ruleset, and its modules
//   2. what the character is built of  classes, race, templates
//   3. every effect on the character   race, feats, items, features, and the
//                                      sheet's own typed bonus fields
//   4. abilities                       because nearly everything reads them
//   5. everything else
//
// It also returns `notices` - the places where the sheet and the rules disagree.
// Under the SRD there are few, because the SRD forbids little; under a campaign
// ruleset there are the campaign's limits too.

import { buildSummary } from './build.js';
import {
  abilityTotals, pointBuyCost, pointBuyBudget, rolledArrayCheck, standardArrayCheck,
  bonusSlots, ABILITIES,
} from './abilities.js';
import { skillPointBudget, skillTable } from './skills.js';
import { hitPoints } from './hp.js';
import { armorClass, initiative, armorCheckPenalty, gearEffects } from './defense.js';
import { attacks, weaponLine } from './offense.js';
import { actionPoints, taint, wealth, levelAdjustment, featBudget, trainingTime } from './houserules.js';
import {
  collectEffects, resolveEffects, bonusTo, bonusToWithAll, conditionsFor, allConditions,
  unknownTargets, describeTarget,
} from './effects.js';
import { contentIndex, raceFacts, resolveEntries, usableContent, CONTENT_TYPES } from './library.js';
import { activeModules } from './modules.js';
import { magicFor, magicNotices } from './magic.js';
import { trackersFor, trackerNotices } from './trackers.js';
import {
  variantClassIndex, variantArmorClass, variantHealth, variantScores, magicRatingFor, spontaneousMetamagicFor,
  skillSystemOf, skillsKnownAllowed, variantNotices,
} from './variants.js';
import { num } from './util.js';

const SAVE_ABILITY = { fort: 'con', ref: 'dex', will: 'wis' };

/**
 * The effects a player typed straight onto the sheet rather than attaching to
 * a piece of content. They are effects like any other, so the stacking rules
 * hold between them and everything else: an enhancement bonus typed in the
 * ability table and a belt carried as an item do not both count.
 */
function sheetEffects(character) {
  const source = 'typed on the sheet';
  const out = [];
  const a = character.abilities || {};
  for (const key of ABILITIES) {
    out.push({ target: `ability.${key}`, type: 'enhancement', value: num(a.enhancement?.[key]), source });
    out.push({ target: `ability.${key}`, type: 'inherent', value: num(a.inherent?.[key]), source });
    out.push({ target: `ability.${key}`, type: 'untyped', value: num(a.misc?.[key]), source });
  }
  for (const save of ['fort', 'ref', 'will']) {
    out.push({ target: `save.${save}`, type: 'resistance', value: num(character.saves?.magic?.[save]), source });
    out.push({ target: `save.${save}`, type: 'untyped', value: num(character.saves?.misc?.[save]), source });
  }
  out.push(...gearEffects(character.gear || {}));
  return out.filter((e) => e.value !== 0);
}

/**
 * @param options.overrides  settings imposed from outside the sheet, such as the
 *                           campaign server's gestalt switch
 * @param options.gestalt    shorthand for overrides.gestalt
 */
export function derive(character, rules, options = {}) {
  // --- 1. the rules in force ---------------------------------------------
  const overrides = { ...(options.overrides || {}) };
  if (options.gestalt !== undefined) overrides.gestalt = options.gestalt;
  const modules = activeModules(rules, character, overrides);
  const gestalt = modules.gestalt;

  // --- 2. what the character is built of ---------------------------------
  // In a campaign, only the homebrew the campaign allows counts.
  const usable = usableContent(character, rules);
  const index = contentIndex(rules, { ...character, content: usable.content });
  // Variant rules that change classes: generic and paragon classes, class variants.
  index.classByName = variantClassIndex(index.classByName, character, rules, modules);
  const summary = buildSummary(character, rules, gestalt, index);
  // Reducing level adjustments: reductions paid for lower the adjustment, and ECL with it.
  summary.baseLA = summary.la;
  if (modules.reducingLA) {
    const schedule = rules.variants?.tables?.reducingLA?.[String(summary.la)] || [];
    const cut = Math.min(num(character.variants?.laReductions), schedule.filter((l) => summary.classLevels >= l).length);
    summary.la -= cut;
    summary.ecl -= cut;
  }
  const race = raceFacts(character, index);
  const size = rules.core.sizes.find((s) => s.name === race.size)
    || rules.core.sizes.find((s) => s.name === 'Medium');

  // --- 3. every effect ---------------------------------------------------
  const entries = resolveEntries(character, index);
  const effects = [
    ...collectEffects(entries),
    ...sheetEffects(character).map((e) => ({ condition: null, perLevel: false, note: null, ...e })),
  ];
  // Taint (Unearthed Arcana) is a penalty to Constitution and Wisdom, not ability damage.
  if (modules.uaTaint && num(character.variants?.taint) > 0) {
    for (const key of ['con', 'wis']) {
      effects.push({ target: `ability.${key}`, type: 'untyped', value: -num(character.variants.taint), source: 'taint', condition: null, perLevel: false, note: null });
    }
  }
  const resolved = resolveEffects(effects, summary.hitDiceCount);

  // --- 4. abilities ------------------------------------------------------
  const abilities = abilityTotals(character, summary, race.abilityAdjust, resolved);

  // --- 5. everything else ------------------------------------------------
  const gear = character.gear || {};
  const armorVariants = variantArmorClass(armorClass(gear, abilities.dex.mod, size.ac, resolved.ac), gear, summary, rules, modules);
  const ac = armorVariants.ac;
  const init = initiative(abilities.dex.mod, character.combat?.initiativeMisc, bonusTo(resolved, 'initiative'));
  const attackSet = attacks(summary, abilities, size, character.combat?.misc, {
    melee: bonusToWithAll(resolved, 'attack.melee', 'attack.all'),
    ranged: bonusToWithAll(resolved, 'attack.ranged', 'attack.all'),
    grapple: bonusTo(resolved, 'grapple'),
    damageMelee: bonusTo(resolved, 'damage.melee'),
    damageRanged: bonusTo(resolved, 'damage.ranged'),
  });

  const hp = hitPoints(summary.hitDice, character.hp, abilities.con.baseMod, rules, {
    flat: bonusTo(resolved, 'hp'),
    racialHD: summary.racialHD,
  });

  const saves = {};
  for (const [save, ability] of Object.entries(SAVE_ABILITY)) {
    const base = summary.baseSaves[save];
    const abilityBonus = abilities[ability].mod;
    const bonuses = bonusToWithAll(resolved, `save.${save}`, 'save.all');
    saves[save] = {
      base,
      ability: abilityBonus,
      abilityKey: ability,
      bonuses,
      conditions: conditionsFor(resolved, `save.${save}`, 'save.all'),
      total: base + abilityBonus + bonuses,
    };
  }

  const skillCtx = {
    skillsByName: index.skillsByName,
    classSkills: summary.classSkills,
    abilities,
    hitDice: summary.hitDiceCount,
    armorCheckPenalty: armorCheckPenalty(gear),
    sizeHideMod: size.hide,
    resolved,
    system: skillSystemOf(modules),
  };
  const skills = skillTable(character, skillCtx);
  const extraSkillPoints = bonusTo(resolved, 'skillPoints.perLevel')
    + (race.known ? 0 : num(character.race?.skillPointsPerLevel));
  const budget = skillPointBudget(summary, abilities.int.mod, extraSkillPoints);

  const money = wealth(character, summary.ecl, rules);
  const la = levelAdjustment(summary.la, summary.ecl, rules);
  const feats = featBudget(character, summary, rules, {
    traitsFlaws: modules.traitsFlaws,
    bonusFromEffects: bonusTo(resolved, 'feats.bonus'),
  });
  const weapons = (character.weapons || []).map((w) => weaponLine(w, attackSet, abilities));

  const derived = {
    ruleset: rules.ruleset.id,
    modules,
    gestalt,
    index,
    homebrew: { blocked: usable.blocked, campaignNames: usable.campaignNames },
    race,
    summary,
    effects: {
      all: effects,
      resolved,
      conditional: allConditions(resolved),
      unknown: unknownTargets(resolved),
    },
    abilities,
    size,
    speed: race.speed + bonusTo(resolved, 'speed'),
    spellResistance: Math.max(num(character.combat?.spellResistance), bonusTo(resolved, 'spellResistance')),
    hp,
    ac,
    initiative: init,
    attacks: attackSet,
    weapons,
    saves,
    skills: { ...skills, budget, remaining: skillCtx.system ? 0 : budget.total - skills.spent, system: skillCtx.system },
    wealth: money,
    levelAdjustment: la,
    feats,
    casting: castingSummary(summary, abilities),
    magic: magicFor(character, summary, abilities, rules, {
      modules,
      rating: modules.magicRating ? magicRatingFor(summary, rules, Boolean(character.variants?.magicRatingSeparate)) : null,
    }),
    trackers: trackersFor(character, summary, abilities, rules, index),
    // Only the modules in force produce anything; the rest are null, and the
    // interface draws no panel for a null.
    actionPoints: modules.actionPoints
      ? actionPoints(summary.hitDiceCount, character.actionPoints?.spent, rules, character.actionPoints?.bonus)
      : null,
    taint: modules.taint ? taint(character, abilities, rules) : null,
    training: modules.training ? nextLevelTraining(character, rules, summary, gestalt, index) : null,
  };

  // The variant rules' own readouts and tracks.
  const highestSpell = Math.max(-1, ...derived.magic.classes.filter((m) => m.kind === 'casting').map((m) => m.highestCastable ?? -1));
  derived.variants = {
    defenseBonus: armorVariants.defenseBonus,
    damageReduction: armorVariants.damageReduction,
    health: variantHealth(character, derived, summary, abilities, size, rules, modules),
    scores: variantScores(character, derived, summary, abilities, rules, modules),
    magicRating: modules.magicRating ? magicRatingFor(summary, rules, Boolean(character.variants?.magicRatingSeparate)) : null,
    playersRoll: modules.playersRollDice ? {
      defense: ac.total - 10,
      touch: ac.touch - 10,
      flatFooted: ac.flatFooted - 10,
      spellResistance: derived.spellResistance ? derived.spellResistance - 10 : null,
    } : null,
    skills: skillCtx.system ? {
      system: skillCtx.system,
      known: skills.lines.filter((l) => l.known).length,
      allowed: skillCtx.system === 'maxRanks' ? skillsKnownAllowed(summary, abilities.int.mod, extraSkillPoints) : null,
    } : null,
    classesChosing: [...new Set(summary.sides.flatMap((s) => s.classes))]
      .filter((c) => c.def?.chooseSkills && (character.variants?.chosenSkills?.[c.name] || []).length < c.def.chooseSkills)
      .map((c) => [c.name, c.def]),
  };
  if (modules.spontaneousMetamagic && highestSpell >= 0) {
    for (const m of spontaneousMetamagicFor(character, highestSpell, rules)) {
      derived.trackers.push({ ...m, source: 'spontaneous metamagic', per: 'day', unit: null, used: num(character.trackers?.[m.key]), remaining: 3 - num(character.trackers?.[m.key]) });
    }
  }

  // Two readouts beside the ability block. Derived, not stored, so switching
  // between methods never edits anything a player typed.
  derived.pointBuy = pointBuyCost(character.abilities?.base, rules, pointBuyBudget(character, rules));
  derived.rolledTotal = rolledArrayCheck(character.abilities?.base, rules).total;

  derived.notices = notices(character, derived, rules);
  return derived;
}

/** Training days for the level after this one. */
function nextLevelTraining(character, rules, summary, gestalt, index) {
  if (!rules.ruleset.training) return null;
  const next = summary.sides.map((side) => {
    const planned = character.nextLevel?.[side.side];
    const existing = side.classes.find((c) => c.name === planned);
    return {
      classLevel: (existing ? existing.levels : 0) + 1,
      prestige: Boolean(index.classByName.get(planned)?.prestige),
      sideTotal: side.levels,
      className: planned || null,
    };
  });
  if (!next.some((n) => n.className)) return null;
  return { ...trainingTime(next, rules, gestalt), sides: next };
}

/** Save DCs and bonus slots, for each casting or manifesting class taken. */
function castingSummary(summary, abilities) {
  const seen = new Map();
  for (const side of summary.sides) {
    for (const c of side.classes) {
      const block = c.def.casting?.ability ? c.def.casting : c.def.manifesting?.ability ? c.def.manifesting : null;
      if (!block) continue;
      const mod = abilities[block.ability].mod;
      seen.set(c.name, {
        name: c.name,
        kind: c.def.casting?.ability ? 'casting' : 'manifesting',
        levels: c.levels,
        ability: block.ability,
        mod,
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
 *
 * Each notice belongs to the part of the rules it comes from. The SRD ruleset
 * produces only the core ones; a campaign ruleset adds its own limits.
 */
function notices(character, d, rules) {
  const out = [];
  const add = (level, text, field) => out.push({ level, text, field });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  magicNotices(d.magic, add);
  trackerNotices(d.trackers || [], add);
  const rs = rules.ruleset;
  const restrictions = rs.restrictions || {};

  // --- Homebrew a campaign does not allow -----------------------------------
  const blocked = d.homebrew?.blocked || [];
  if (blocked.length) {
    const named = blocked.map((b) => `${b.name} (${CONTENT_TYPES[b.kind].label.toLowerCase()})`).join(', ');
    add('warn', `Not counted in ${rules.campaign?.name || 'this campaign'}: ${named}. Only the campaign's own homebrew counts here unless its GMs allow homebrew.`, 'content');
  }

  // --- Ability scores ------------------------------------------------------
  const method = character.abilities?.method;
  if (method === 'pointBuy') {
    const pb = d.pointBuy;
    if (pb.outOfRange.length) {
      add('error', `Point buy covers scores ${pb.min} to ${pb.max}. Out of range: ${pb.outOfRange.join(', ').toUpperCase()}.`, 'abilities');
    } else if (pb.spent > pb.budget) {
      add('error', `Point buy is over budget: ${pb.spent} of ${pb.budget} spent.`, 'abilities');
    } else if (pb.remaining > 0) {
      add('info', `${plural(pb.remaining, 'point', 'points')} of point buy still unspent.`, 'abilities');
    }
  } else if (method === 'rolled') {
    const r = rolledArrayCheck(character.abilities?.base, rules);
    if (r.tooLow) add('error', `Rolled array totals ${r.total}; under ${r.min} it must be rerolled.`, 'abilities');
    if (r.tooHigh) add('error', `Rolled array totals ${r.total}; over ${r.max} it must be rerolled.`, 'abilities');
  } else if (method === 'array') {
    const check = standardArrayCheck(character.abilities?.base, rules);
    if (!check.ok) add('warn', `The standard array is ${check.want.join(', ')}, in any order.`, 'abilities');
  }

  if (d.abilities.levelUpsUsed > d.abilities.levelUpsAllowed) {
    add('error', `${d.abilities.levelUpsUsed} level-up ability increases assigned, but only ${d.abilities.levelUpsAllowed} earned.`, 'abilities');
  } else if (d.abilities.levelUpsUsed < d.abilities.levelUpsAllowed) {
    add('info', `${d.abilities.levelUpsAllowed - d.abilities.levelUpsUsed} ability increase still to assign.`, 'abilities');
  }

  if (restrictions.evenAbilityEnhancements) {
    for (const key of ABILITIES) {
      const bonus = d.abilities[key].parts.enhancement;
      if (bonus && bonus % 2 !== 0) {
        add('warn', `${key.toUpperCase()} enhancement is +${bonus}; ability-boosting items come in even numbers only here.`, 'abilities');
      }
    }
  }

  // --- The build -----------------------------------------------------------
  if (d.summary.classLevels === 0) {
    add('info', 'No class levels yet. Add one under Levels.', 'levels');
  }
  if ((character.levels || []).some((row) => !row.a)) {
    add('info', 'A level has no class chosen yet.', 'levels');
  }
  if (rs.startingLevel > 1 && d.summary.classLevels && d.summary.ecl < rs.startingLevel) {
    const where = rules.campaign?.name ? `in ${rules.campaign.name}` : `under ${rs.name}`;
    add('info', `Characters ${where} start at level ${rs.startingLevel}; this one is ECL ${d.summary.ecl}.`, 'levels');
  }
  for (const side of d.summary.sides) {
    for (const c of side.classes) {
      if (c.def.missing) {
        add('error', `"${c.name}" is not a class the sheet knows. Add it under Content so its numbers can be counted.`, 'levels');
      }
    }
  }
  if (d.gestalt) {
    (character.levels || []).forEach((row, i) => {
      const both = [row.a, row.b].map((n) => d.index.classByName.get(n)).filter(Boolean);
      if (both.length === 2 && both.every((c) => c.prestige)) {
        add('error', `Level ${i + 1} pairs two prestige classes, which gestalt does not allow.`, 'levels');
      }
      if (row.a && row.b && row.a === row.b) {
        add('error', `Level ${i + 1} takes ${row.a} on both sides; the two halves must differ.`, 'levels');
      }
    });
  }
  if (!d.gestalt && (character.levels || []).some((row) => row.b)) {
    add('info', 'Gestalt is off, so the second class column is being ignored.', 'levels');
  }

  // --- Race and level adjustment ------------------------------------------
  if (d.levelAdjustment.capped && !d.levelAdjustment.ok) {
    add('error', `Level adjustment +${d.levelAdjustment.la} exceeds the +${d.levelAdjustment.allowed} allowed at ECL ${d.levelAdjustment.ecl}.`, 'identity');
  }

  // --- Hit points ----------------------------------------------------------
  if (d.hp.missingRolls.length) {
    add('warn', `Hit points rolled but no roll recorded for ${d.hp.missingRolls.length === 1 ? 'level' : 'levels'} ${d.hp.missingRolls.join(', ')}.`, 'hp');
  }

  // --- Variant rules -------------------------------------------------------
  variantNotices(d, d.modules, add);

  // --- Skills --------------------------------------------------------------
  if (d.skills.system) {
    // An alternative skill system has no points to spend, and no caps to pass.
  } else if (d.skills.remaining < 0) {
    add('error', `Skill points overspent by ${-d.skills.remaining}.`, 'skills');
  } else if (d.skills.remaining > 0 && d.summary.classLevels) {
    add('info', `${plural(d.skills.remaining, 'skill point', 'skill points')} unspent.`, 'skills');
  }
  for (const line of d.skills.lines) {
    if (line.overCap) {
      add('error', `${line.label} has ${line.ranks} ranks; the cap at ${d.summary.hitDiceCount} hit dice is ${line.maxRanks} ${line.classSkill ? '(class skill)' : '(cross-class)'}.`, 'skills');
    }
    if (line.def.unknown) {
      add('warn', `"${line.name}" is not a skill the sheet knows. Add it under Content to give it a key ability.`, 'skills');
    }
  }

  // --- Feats, traits, flaws ------------------------------------------------
  const f = d.feats;
  if (f.taken > f.allowed) add('error', `${f.taken} feats taken, ${f.allowed} available.`, 'feats');
  else if (f.taken < f.allowed) add('info', `${plural(f.allowed - f.taken, 'feat', 'feats')} still to choose.`, 'feats');
  if (d.modules.traitsFlaws) {
    if (f.traits > f.traitLimit) add('error', `${f.traits} traits taken; the limit is ${f.traitLimit}.`, 'feats');
    if (f.flaws > f.flawLimit) add('error', `${f.flaws} flaws taken; the limit is ${f.flawLimit}.`, 'feats');
  }

  // --- Effects -------------------------------------------------------------
  for (const target of d.effects.unknown) {
    add('warn', `An effect targets "${target}", which the sheet does not know how to apply. Check its spelling under Content.`, 'effects');
  }
  for (const bucket of Object.values(d.effects.resolved)) {
    for (const loser of bucket.suppressed) {
      const winner = bucket.applied.find((a) => a.type === loser.type);
      if (!winner || loser.source === 'typed on the sheet') continue;
      add('info', `${loser.source}'s +${loser.value} ${loser.type} bonus to ${describeTarget(bucket.target)} does not stack with ${winner.source}'s +${winner.value}.`, 'effects');
    }
  }

  // --- Campaign modules ----------------------------------------------------
  if (d.modules.backgrounds && rs.backgrounds?.required && !character.background?.name && d.summary.classLevels) {
    add('warn', `No background chosen. ${rs.backgrounds.requiredNote || ''}`.trim(), 'identity');
  }

  if (d.wealth.enforced) {
    for (const item of d.wealth.overCapItems) {
      add('warn', `${item.name || 'An item'} is worth ${num(item.value).toLocaleString()} gp, over the ${Math.round(d.wealth.capFraction * 100)}% single-item cap of ${Math.round(d.wealth.cap).toLocaleString()} gp.`, 'wealth');
    }
    if (d.wealth.expected && d.wealth.held > d.wealth.expected * 1.1) {
      add('warn', `Holdings total ${Math.round(d.wealth.held).toLocaleString()} gp against ${d.wealth.expected.toLocaleString()} gp expected at ECL ${d.summary.ecl}.`, 'wealth');
    }
  }

  if (d.taint) {
    for (const [which, state] of [['Corruption', d.taint.corruption], ['Depravity', d.taint.depravity]]) {
      if (state.severity === 'past') {
        add('error', `${which} ${state.score} is past the severe threshold. ${which === 'Corruption' ? 'The character dies and rises as a tainted minion.' : 'The character goes irretrievably mad.'}`, 'houserules');
      } else if (state.severity !== 'none') {
        add('warn', `${which} ${state.score}: ${state.severity} taint. ${state.toNext} more crosses the next threshold.`, 'houserules');
      }
    }
  }

  return out;
}
