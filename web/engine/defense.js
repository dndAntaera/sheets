// Armour Class and the two variants of it that come up every session, plus the
// armour check penalty the skill table needs.

import { num } from './util.js';

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
 * Armour Class, touch, and flat-footed.
 *
 * Touch drops the things a touch attack ignores: armour, shield, and natural
 * armour. Flat-footed drops Dexterity and dodge bonuses, which are exactly the
 * things you cannot use before you have acted.
 */
export function armorClass(gear, dexMod, sizeAC, rules) {
  const dex = dexToAC(dexMod, gear);
  const armor = num(gear.armor?.bonus);
  const shield = num(gear.shield?.bonus);
  const natural = num(gear.natural);
  const deflection = num(gear.deflection);
  const dodge = num(gear.dodge);
  const misc = num(gear.misc);

  const common = 10 + sizeAC + dex.applied + deflection + dodge + misc;
  return {
    dex,
    parts: { base: 10, armor, shield, natural, deflection, dodge, size: sizeAC, dex: dex.applied, misc },
    total: common + armor + shield + natural,
    touch: common,
    flatFooted: 10 + sizeAC + armor + shield + natural + deflection + misc,
    acp: armorCheckPenalty(gear),
    arcaneSpellFailure: num(gear.armor?.asf) + num(gear.shield?.asf),
    maxSpeed: gear.armor?.speed ?? null,
  };
}

/** Initiative is Dexterity plus whatever a feat or item adds. */
export function initiative(dexMod, misc) {
  return { dexMod, misc: num(misc), total: dexMod + num(misc) };
}
