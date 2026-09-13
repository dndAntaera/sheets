// Armour Class and the two variants of it that come up every session, plus the
// armour check penalty the skill table needs.

import { num } from './util.js';
import { resolveEffects, AC_OFF_TOUCH, AC_OFF_FLATFOOTED } from './effects.js';

/**
 * Dexterity reaching Armour Class is capped by the most restrictive thing worn.
 * Armour is the usual limit; a tower shield is the other one that matters.
 */
function dexToAC(dexMod, gear) {
  const caps = [gear.armor?.maxDex, gear.shield?.maxDex]
    .map((c) => (c === '' || c === null || c === undefined ? null : Number(c)))
    .filter((c) => c !== null && Number.isFinite(c));
  if (!caps.length) return { applied: dexMod, cap: null, capped: false };
  const cap = Math.min(...caps);
  return { applied: Math.min(dexMod, cap), cap, capped: dexMod > cap };
}

export function armorCheckPenalty(gear) {
  return num(gear.armor?.acp) + num(gear.shield?.acp);
}

/**
 * The sheet's own armour fields, as effects.
 *
 * Treating the typed-in armour, shield and natural armour exactly like an
 * item's effects is what makes stacking honest: a +2 deflection typed on the
 * sheet and a ring of protection +1 carried as an item do not add to +3. The
 * better one counts, as the rules say.
 */
export function gearEffects(gear) {
  const source = 'typed on the sheet';
  const list = [
    { target: 'ac', type: 'armor', value: num(gear.armor?.bonus), source: gear.armor?.name || 'armour' },
    { target: 'ac', type: 'shield', value: num(gear.shield?.bonus), source: gear.shield?.name || 'shield' },
    { target: 'ac', type: 'natural', value: num(gear.natural), source },
    { target: 'ac', type: 'deflection', value: num(gear.deflection), source },
    { target: 'ac', type: 'dodge', value: num(gear.dodge), source },
    { target: 'ac', type: 'untyped', value: num(gear.misc), source },
  ];
  return list.filter((e) => e.value !== 0);
}

/**
 * Armour Class, touch, and flat-footed, from typed bonuses.
 *
 * Touch drops armour, shield and natural armour. Flat-footed drops Dexterity
 * and dodge - but a Dexterity PENALTY still applies when flat-footed, because
 * being caught unawares does not make a clumsy character less clumsy.
 *
 * Everything else - deflection, luck, insight, sacred, untyped - counts towards
 * all three, which is the rule people most often get wrong.
 *
 * @param acBucket  the resolved `ac` target: { byType, applied, suppressed, conditional }
 */
export function armorClass(gear, dexMod, sizeAC, acBucket = null) {
  const dex = dexToAC(dexMod, gear);
  const bucket = acBucket || resolveEffects(gearEffects(gear)).ac || { byType: {}, applied: [], suppressed: [], conditional: [] };
  const byType = bucket.byType || {};

  const sum = (skip) => Object.entries(byType)
    .filter(([type]) => !skip.has(type))
    .reduce((t, [, v]) => t + v, 0);

  const all = sum(new Set());
  const touchBonuses = sum(AC_OFF_TOUCH);
  const flatBonuses = sum(AC_OFF_FLATFOOTED);

  return {
    dex,
    byType,
    parts: {
      base: 10,
      size: sizeAC,
      dex: dex.applied,
      armor: byType.armor || 0,
      shield: byType.shield || 0,
      natural: byType.natural || 0,
      deflection: byType.deflection || 0,
      dodge: byType.dodge || 0,
      other: all - (byType.armor || 0) - (byType.shield || 0) - (byType.natural || 0)
        - (byType.deflection || 0) - (byType.dodge || 0),
    },
    total: 10 + sizeAC + dex.applied + all,
    touch: 10 + sizeAC + dex.applied + touchBonuses,
    flatFooted: 10 + sizeAC + Math.min(0, dex.applied) + flatBonuses,
    applied: bucket.applied || [],
    suppressed: bucket.suppressed || [],
    conditional: bucket.conditional || [],
    acp: armorCheckPenalty(gear),
    arcaneSpellFailure: num(gear.armor?.asf) + num(gear.shield?.asf),
    maxSpeed: gear.armor?.speed ?? null,
  };
}

/** Initiative is Dexterity plus whatever a feat or item adds. */
export function initiative(dexMod, misc, bonuses = 0) {
  return { dexMod, misc: num(misc), bonuses, total: dexMod + num(misc) + bonuses };
}
