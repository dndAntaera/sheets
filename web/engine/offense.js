// Attack bonuses and the full attack routine.

import { iterativeAttacks } from './progression.js';
import { num, signed } from './util.js';

/**
 * Melee and ranged attack bonuses, and the opposed checks that come up most.
 *
 * The routine is built from the BASE attack bonus and then has the modifier
 * added to each attack - never from the total. A character with +3 base and a
 * 16 Strength attacks once at +6; they do not get a second attack because the
 * Strength pushed the total to +6. Extra attacks are earned at +6 base and
 * every +5 after, and nothing else grants them.
 *
 * Size enters twice with different numbers: a Small creature is +1 to hit and
 * -4 to grapple, because being small helps you aim and hurts you in a hold.
 *
 * @param misc     what the player typed: { melee, ranged, grapple }
 * @param bonuses  what effects add: { melee, ranged, grapple, damageMelee, damageRanged }
 */
export function attacks(summary, abilities, size, misc = {}, bonuses = {}) {
  const bab = summary.bab;
  const str = abilities.str.mod;
  const dex = abilities.dex.mod;
  const base = iterativeAttacks(bab);

  const set = (mod) => ({
    total: bab + mod,
    mod,
    attacks: base.map((b) => b + mod),
    routine: base.map((b) => signed(b + mod)).join('/'),
  });

  const melee = set(str + size.attack + num(misc.melee) + num(bonuses.melee));
  const ranged = set(dex + size.attack + num(misc.ranged) + num(bonuses.ranged));

  return {
    bab,
    melee,
    ranged,
    grapple: { total: bab + str + size.grapple + num(misc.grapple) + num(bonuses.grapple) },
    damageBonus: { melee: num(bonuses.damageMelee), ranged: num(bonuses.damageRanged) },
    // Bull rush and trip are opposed Strength checks, not attacks: no base
    // attack bonus, and the size modifier is the grapple one - four points a
    // size category.
    bullRush: str + size.grapple,
    trip: str + size.grapple,
  };
}

/** One weapon line: its own enhancement on top of the character's routine. */
export function weaponLine(weapon, attackSet, abilities) {
  const useDex = weapon.ranged || weapon.finesse;
  const set = useDex ? attackSet.ranged : attackSet.melee;
  const extra = num(weapon.attackBonus);

  // A thrown weapon adds Strength to damage; a bow or crossbow does not.
  const isRanged = weapon.ranged && !weapon.thrown;
  const strToDamage = isRanged ? 0 : abilities.str.mod;
  const effectDamage = weapon.ranged ? attackSet.damageBonus?.ranged || 0 : attackSet.damageBonus?.melee || 0;
  const damageMod = strToDamage + num(weapon.damageBonus) + effectDamage;

  return {
    ...weapon,
    attack: set.total + extra,
    routine: set.attacks.map((a) => signed(a + extra)).join('/'),
    damageMod,
    damage: `${weapon.damageDice || ''}${damageMod ? signed(damageMod) : ''}`,
  };
}
