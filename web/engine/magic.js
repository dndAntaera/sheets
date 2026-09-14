// Spells and powers: what a character can cast or manifest today, and what they have used.
//
// The class tables (data/srd/progression.json, from the SRD) give each class's
// spells per day, spells known, power points and powers known by class level.
// Everything else follows the SRD's rules:
//
//   spells per day   the table's number for the level, plus bonus spells from a
//                    high ability score (none at level 0), plus a cleric's domain
//                    slot and a specialist wizard's school slot. A "0" in the
//                    table means bonus spells only. A caster cannot cast spells
//                    of a level higher than their ability score minus 10.
//   spells known     the table's number, for casters who have one (bard,
//                    sorcerer). A wizard's spellbook has no limit.
//   caster level     class level; half of it for paladins and rangers.
//   save DC          10 + spell level + ability modifier.
//   power points     the table's number, plus (ability modifier x manifester
//                    level) / 2, rounded down. Every manifesting class draws on
//                    one pool.
//
// What the player has done - spells learned, prepared, cast; power points spent
// - is kept on the character under `magic`, one entry per class:
//
//   magic[className] = {
//     known:    [{ name, level }]              spells or powers known, or a spellbook
//     prepared: { [level]: [{ name, used, domain?, school? }] }
//     used:     { [level]: count }             for casters who cast spontaneously
//     domains:  [name, name]                   a cleric's two domains
//     specialty, prohibited: [school]          a specialist wizard
//     discipline                               a psion's discipline
//   }
//   magic.powerPointsUsed                      the shared pool's spent points
//
// Nothing here is stored on the derived side; resting is restedMagic().

import { bonusSlots } from './abilities.js';
import { spellPointsFor, rechargeTimesFor } from './variants.js';

const MAX_LEVEL = 20;

/** '3' -> {base 3}, '1+1' -> {base 1, domain 1}, null or '-' -> null. */
function slotCount(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).match(/^(\d+)(?:\+(\d+))?/);
  return m ? { base: Number(m[1]), extra: m[2] ? Number(m[2]) : 0 } : null;
}

/** 0-level, 1st-level, 2nd-level... */
export function levelLabel(n) {
  if (n === 0) return '0-level';
  const suffix = [11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}-level`;
}

const byLevel = (list, level) => (list || []).filter((e) => e && e.name && Number(e.level) === level);

/**
 * @param character  the stored character
 * @param summary    buildSummary's result: classes and their levels
 * @param abilities  abilityTotals's result
 * @param rules      the rules context, with `progression`
 * @returns { classes: [...], powerPoints: { base, bonus, total, used, remaining } | null, kinds: Set }
 */
export function magicFor(character, summary, abilities, rules, options = {}) {
  const modules = options.modules || {};
  const classes = [];
  const seen = new Set();
  let pool = null;

  for (const side of summary.sides) {
    for (const c of side.classes) {
      if (seen.has(c.name)) continue;
      const casting = c.def?.casting?.ability ? c.def.casting : null;
      const manifesting = c.def?.manifesting?.ability ? c.def.manifesting : null;
      if (!casting && !manifesting) continue;
      seen.add(c.name);

      const progression = rules.progression?.[c.name] || c.def.progression || {};
      const level = Math.min(c.levels, MAX_LEVEL);
      const at = (column) => progression[column]?.[level - 1];
      const ability = (casting || manifesting).ability;
      const { total: score, mod } = abilities[ability];
      const state = character.magic?.[c.name] || {};

      if (casting) {
        const castingScore = casting.castingScore ? abilities[casting.castingScore].total : score;
        const entry = spellcaster(c, casting, level, at, ability, score, mod, state, { castingScore, rules, modules, rating: options.rating });
        classes.push(entry);
      } else {
        const entry = manifester(c, manifesting, level, at, ability, score, mod, state);
        classes.push(entry);
        pool = pool || { base: 0, bonus: 0 };
        pool.base += entry.powerPoints.base;
        pool.bonus += entry.powerPoints.bonus;
      }
    }
  }

  if (pool) {
    pool.total = pool.base + pool.bonus;
    pool.used = Math.max(0, Number(character.magic?.powerPointsUsed) || 0);
    pool.remaining = pool.total - pool.used;
  }
  return { classes, powerPoints: pool, kinds: new Set(classes.map((c) => c.kind)) };
}

function spellcaster(c, casting, level, at, ability, score, mod, state, extra = {}) {
  const slots = at('slots') || [];
  const bonus = bonusSlots(mod);
  const spontaneous = Boolean(casting.spontaneous);
  const spellbook = Boolean(casting.spellbook) && !casting.spontaneous;
  const classCasterLevel = casting.half ? (level >= 4 ? Math.floor(level / 2) : 0) : level;
  // Magic rating (Unearthed Arcana): caster level is the character's total rating.
  const casterLevel = extra.rating ? extra.rating.casterLevelOf(c.name, c.def) : classCasterLevel;
  const specialist = spellbook && state.specialty ? 1 : 0;
  // Spontaneous divine casters (Unearthed Arcana) learn from their own table.
  const divineKnown = casting.spontaneousDivine ? extra.rules?.variants?.tables?.spontaneousDivineKnown?.[String(level)] : null;
  const knownRow = divineKnown ? divineKnown.map((n) => (n === null ? null : String(n))) : at('known') || [];
  const castingScore = extra.castingScore ?? score;

  const levels = [];
  for (let L = 0; L < Math.max(slots.length, knownRow.length); L++) {
    const table = slotCount(slots[L]);
    const known = slotCount(knownRow[L]);
    if (!table && !known) continue;
    const castable = castingScore >= 10 + L;
    // A spontaneous divine caster gets one more spell a day at each level, and no domain slot.
    const base = castable && table ? Math.max(0, table.base + (casting.slotAdjust || 0)) + (casting.spontaneousDivine ? 1 : 0) : 0;
    const fromAbility = castable && table && L > 0 ? bonus[L] : 0;
    const domain = castable && table ? (casting.spontaneousDivine ? 0 : table.extra) + (casting.domainSlot || 0) : 0;
    const school = castable && table ? specialist : 0;
    const perDay = base + fromAbility;
    const prepared = state.prepared?.[L] || [];
    const used = spontaneous
      ? Math.max(0, Number(state.used?.[L]) || 0)
      : prepared.filter((p) => p?.name && p.used).length;
    const extraSlots = domain + school;
    levels.push({
      level: L,
      castable,
      base,
      bonus: fromAbility,
      domain,
      school,
      perDay: perDay + extraSlots,
      knownAllowed: known
        ? Math.max(known.base > 0 || casting.knownAdjust ? 1 : 0, known.base + (casting.knownAdjust || 0))
          + (castable && casting.extraKnown ? casting.extraKnown : 0)
          + (casting.spontaneousDivine && L > 0 ? casting.knownBonus || 0 : 0)
        : null,
      knownCount: byLevel(state.known, L).length,
      preparedCount: prepared.filter((p) => p?.name && !p.domain && !p.school).length,
      preparedExtra: prepared.filter((p) => p?.name && (p.domain || p.school)).length,
      used,
      remaining: spontaneous ? perDay + extraSlots - used : prepared.filter((p) => p?.name && !p.used).length,
      saveDC: 10 + L + mod,
    });
  }

  const highestCastable = levels.filter((l) => l.castable && l.perDay > 0).reduce((n, l) => Math.max(n, l.level), -1);
  const modules = extra.modules || {};
  const spellPoints = modules.spellPoints && highestCastable >= 0
    ? spellPointsFor(c.name, level, score, highestCastable, extra.rules)
    : null;
  if (spellPoints) spellPoints.used = Math.max(0, Number(state.spellPointsUsed) || 0);
  const recharge = modules.rechargeMagic && highestCastable >= 0
    ? rechargeTimesFor(highestCastable, spontaneous && casting.type !== 'divine', extra.rules)
    : null;

  return {
    name: c.name,
    kind: 'casting',
    type: casting.type || null,
    classLevel: level,
    casterLevel,
    classCasterLevel,
    highestCastable,
    spellPoints: spellPoints ? { ...spellPoints, remaining: spellPoints.total - spellPoints.used } : null,
    recharge,
    recharging: recharge ? state.recharging || {} : null,
    variant: c.def?.classVariant || null,
    ability,
    score,
    mod,
    spontaneous,
    spellbook,
    domains: casting.domains ? (state.domains || []) : null,
    specialty: spellbook ? state.specialty || null : null,
    prohibited: spellbook ? state.prohibited || [] : null,
    // A wizard's spellbook: every 0-level spell, then three 1st-level spells and
    // one more per point of Intelligence bonus, and two a level after that.
    spellbookFree: spellbook ? {
      free: 3 + Math.max(0, mod) + 2 * Math.max(0, level - 1),
      used: (state.known || []).filter((k) => k && k.name && Number(k.level) > 0).length,
    } : null,
    levels,
    highest: levels.filter((l) => l.perDay > 0 || (l.knownAllowed ?? 0) > 0).reduce((n, l) => Math.max(n, l.level), -1),
  };
}

function manifester(c, manifesting, level, at, ability, score, mod, state) {
  const base = Number(at('powerPoints')) || 0;
  const bonus = Math.floor((Math.max(0, mod) * level) / 2);
  const maxByTable = Number(at('maxPowerLevel')) || 0;
  const maxByScore = Math.max(0, score - 10);
  return {
    name: c.name,
    kind: 'manifesting',
    classLevel: level,
    manifesterLevel: level,
    ability,
    score,
    mod,
    disciplines: Boolean(manifesting.disciplines),
    discipline: manifesting.disciplines ? state.discipline || null : null,
    powerPoints: { base, bonus },
    powersKnown: { allowed: Number(at('powersKnown')) || 0, count: (state.known || []).filter((k) => k?.name).length },
    maxPowerLevel: Math.min(maxByTable, maxByScore),
    maxPowerLevelByTable: maxByTable,
    known: (state.known || []).filter((k) => k?.name),
    saveDC: (powerLevel) => 10 + powerLevel + mod,
  };
}

/** Where the spell and power sheet and the rules disagree. */
export function magicNotices(magic, add) {
  for (const c of magic.classes) {
    if (c.kind === 'casting') {
      for (const l of c.levels) {
        const label = `${levelLabel(l.level)} spells`;
        if (l.knownAllowed !== null && l.knownCount > l.knownAllowed) {
          add('error', `${c.name}, ${label}: ${l.knownCount} known, but only ${l.knownAllowed} allowed.`, 'casting');
        }
        if (!c.spontaneous && l.preparedCount > l.perDay - l.domain - l.school) {
          add('error', `${c.name}, ${label}: ${l.preparedCount} prepared, but only ${l.perDay - l.domain - l.school} slots.`, 'casting');
        }
        if (c.spontaneous && l.used > l.perDay) {
          add('error', `${c.name}, ${label}: ${l.used} cast, but only ${l.perDay} a day.`, 'casting');
        }
        if (!l.castable && (l.knownCount || l.preparedCount)) {
          add('warn', `${c.name}, ${label}: casting them takes ${c.ability.toUpperCase()} ${10 + l.level}.`, 'casting');
        }
        if (c.spontaneous && l.knownAllowed && l.knownCount < l.knownAllowed) {
          add('info', `${c.name}, ${label}: ${l.knownAllowed - l.knownCount} still to learn.`, 'casting');
        }
      }
      if (c.domains && new Set(c.domains.filter(Boolean)).size < 2) add('info', `${c.name}: choose two different domains.`, 'casting');
      if (c.spellbookFree) {
        const { free, used } = c.spellbookFree;
        if (used < free) add('info', `${c.name}: ${free - used} free spell${free - used === 1 ? '' : 's'} still to add to the spellbook.`, 'casting');
        else if (used > free) add('info', `${c.name}: ${used - free} spell${used - free === 1 ? '' : 's'} beyond the free ones - copied from scrolls or other spellbooks.`, 'casting');
      }
      if (c.specialty) {
        const need = c.specialty === 'Divination' ? 1 : 2;
        const have = (c.prohibited || []).filter((s) => s !== c.specialty && s !== 'Divination').length;
        if (have !== need) add('warn', `${c.name}: a ${c.specialty.toLowerCase()} specialist gives up ${need} other school${need === 1 ? '' : 's'}; ${have} chosen.`, 'casting');
      }
    } else {
      if (c.powersKnown.count > c.powersKnown.allowed) {
        add('error', `${c.name}: ${c.powersKnown.count} powers known, but only ${c.powersKnown.allowed} allowed.`, 'casting');
      } else if (c.powersKnown.count < c.powersKnown.allowed) {
        add('info', `${c.name}: ${c.powersKnown.allowed - c.powersKnown.count} power${c.powersKnown.allowed - c.powersKnown.count === 1 ? '' : 's'} still to learn.`, 'casting');
      }
      const tooHigh = c.known.filter((k) => Number(k.level) > c.maxPowerLevel);
      if (tooHigh.length) add('warn', `${c.name}: ${tooHigh.map((k) => k.name).join(', ')} above the highest power level you can manifest (${c.maxPowerLevel}).`, 'casting');
    }
  }
  if (magic.powerPoints && magic.powerPoints.used > magic.powerPoints.total) {
    add('error', `${magic.powerPoints.used} power points spent, but only ${magic.powerPoints.total} a day.`, 'casting');
  }
}

/** The character's magic after a night's rest: nothing cast, nothing spent, the same spells prepared. */
export function restedMagic(magic = {}) {
  const next = structuredClone(magic);
  for (const [key, state] of Object.entries(next)) {
    if (!state || typeof state !== 'object') continue;
    state.used = {};
    for (const list of Object.values(state.prepared || {})) {
      for (const p of list || []) if (p) p.used = false;
    }
    next[key] = state;
  }
  next.powerPointsUsed = 0;
  for (const state of Object.values(next)) {
    if (state && typeof state === 'object') {
      state.spellPointsUsed = 0;
      state.recharging = {};
    }
  }
  return next;
}
