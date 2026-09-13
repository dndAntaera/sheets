// Effects: how anything on a character changes a number.
//
// This is the piece that makes player-written content real. A race, a feat, an
// item, a template or a class feature can all carry a list of effects, and an
// effect is a small, boring object:
//
//     { target: 'skill.Hide', type: 'racial', value: 4 }
//     { target: 'ac', type: 'deflection', value: 1 }
//     { target: 'save.all', type: 'resistance', value: 2 }
//     { target: 'ability.str', type: 'enhancement', value: 4 }
//     { target: 'save.will', type: 'racial', value: 2, condition: 'against enchantments' }
//
// The engine does not care where one came from. A dwarf's +2 and a homebrew
// race's +2 go through exactly the same code, which is the whole point: content
// somebody types in this afternoon has the same standing as content that shipped
// with the app.
//
// Two rules do the real work.
//
// STACKING. Two bonuses of the same type do not add; the larger applies. Dodge,
// circumstance and untyped bonuses are the exceptions and stack with themselves.
// Getting this wrong is how a character ends up four points of Armour Class
// better than the rules allow, and it is tedious enough by hand that it is worth
// a computer doing it.
//
// CONDITIONS. An effect with a `condition` is never added to anything. Nothing
// here can know whether you are fighting a giant this round. Conditional effects
// are collected and shown beside the number they would modify, which is what the
// margin of a paper sheet is for.

import { num } from './util.js';

/**
 * Everything an effect may point at.
 *
 * Anything not on this list is kept, reported, and not applied - so a typo in
 * somebody's homebrew shows up as a notice rather than silently doing nothing.
 */
export const TARGETS = {
  'ability.str': 'Strength',
  'ability.dex': 'Dexterity',
  'ability.con': 'Constitution',
  'ability.int': 'Intelligence',
  'ability.wis': 'Wisdom',
  'ability.cha': 'Charisma',

  ac: 'Armour Class',

  'save.all': 'all saving throws',
  'save.fort': 'Fortitude',
  'save.ref': 'Reflex',
  'save.will': 'Will',

  'skill.*': 'all skills',

  'attack.all': 'all attacks',
  'attack.melee': 'melee attacks',
  'attack.ranged': 'ranged attacks',
  'damage.melee': 'melee damage',
  'damage.ranged': 'ranged damage',

  initiative: 'initiative',
  speed: 'speed',
  hp: 'hit points',
  grapple: 'grapple',
  spellResistance: 'spell resistance',
  'skillPoints.perLevel': 'skill points per level',
  'feats.bonus': 'bonus feats',
  naturalReach: 'reach',
};

/** `skill.Hide` is legal for any skill, so targets are matched by prefix too. */
export function isKnownTarget(target) {
  if (TARGETS[target]) return true;
  return typeof target === 'string' && target.startsWith('skill.');
}

export function describeTarget(target) {
  if (TARGETS[target]) return TARGETS[target];
  if (target?.startsWith('skill.')) return target.slice(6);
  return target;
}

/** The bonus types that stack with themselves. Everything else takes the best. */
const STACKS = new Set(['dodge', 'circumstance', 'untyped', '']);

const clean = (effect, source) => ({
  target: String(effect.target || '').trim(),
  type: String(effect.type || 'untyped').trim().toLowerCase(),
  value: num(effect.value),
  condition: effect.condition ? String(effect.condition) : null,
  note: effect.note || null,
  perLevel: Boolean(effect.perLevel),
  source: effect.source || source || 'unknown',
});

/**
 * Every effect on the character, labelled with where it came from.
 *
 * The order of the sources is the order they are listed on the sheet, which is
 * also the order a player would think of them in: what I am, what I have
 * learned, what I am carrying, what has been done to me.
 *
 * @param entries {race, feats, items, templates, features} - already resolved
 *        from the content library to actual objects with `effects` arrays
 */
export function collectEffects(entries) {
  const all = [];
  const add = (holder, kind) => {
    if (!holder) return;
    const label = holder.name || kind;
    for (const effect of holder.effects || []) {
      if (!effect || !effect.target) continue;
      all.push(clean(effect, `${label}`));
    }
  };

  add(entries.race, 'race');
  for (const template of entries.templates || []) add(template, 'template');
  for (const feat of entries.feats || []) add(feat, 'feat');
  for (const feature of entries.features || []) add(feature, 'feature');
  // Only what is actually worn or held: an unequipped cloak of resistance in
  // a backpack protects nobody.
  for (const item of entries.items || []) if (item.equipped !== false) add(item, 'item');
  for (const other of entries.other || []) add(other, 'other');

  return all;
}

/**
 * Resolve a list of effects into totals per target.
 *
 * Returns, for every target touched:
 *   total        what to add to the number
 *   byType       the winning value of each bonus type, for showing the working
 *   applied      the effects that contributed
 *   conditional  the effects that did not, because they depend on the situation
 *   suppressed   same-type effects beaten by a larger one, kept so the sheet
 *                can explain why the +1 ring is doing nothing
 */
export function resolveEffects(effects, hitDice = 1) {
  const byTarget = new Map();

  for (const effect of effects) {
    if (!byTarget.has(effect.target)) {
      byTarget.set(effect.target, { target: effect.target, entries: [], conditional: [], unknown: !isKnownTarget(effect.target) });
    }
    const bucket = byTarget.get(effect.target);
    const value = effect.perLevel ? effect.value * Math.max(1, hitDice) : effect.value;
    const resolved = { ...effect, value };
    if (effect.condition) bucket.conditional.push(resolved);
    else bucket.entries.push(resolved);
  }

  const out = {};
  for (const [target, bucket] of byTarget) {
    const byType = {};
    const applied = [];
    const suppressed = [];

    // Stacking types: everything counts. Non-stacking: the largest wins, and a
    // penalty always counts - two curses do both bite, since "take the best"
    // is a rule about bonuses.
    const groups = new Map();
    for (const entry of bucket.entries) {
      if (STACKS.has(entry.type) || entry.value < 0) {
        byType[entry.type] = (byType[entry.type] || 0) + entry.value;
        applied.push(entry);
        continue;
      }
      if (!groups.has(entry.type)) groups.set(entry.type, []);
      groups.get(entry.type).push(entry);
    }

    for (const [type, entries] of groups) {
      const best = entries.reduce((a, b) => (b.value > a.value ? b : a));
      byType[type] = (byType[type] || 0) + best.value;
      applied.push(best);
      for (const entry of entries) if (entry !== best) suppressed.push(entry);
    }

    out[target] = {
      target,
      total: Object.values(byType).reduce((t, v) => t + v, 0),
      byType,
      applied,
      suppressed,
      conditional: bucket.conditional,
      unknown: bucket.unknown,
    };
  }

  return out;
}

/** The number to add for one target, or 0. */
export const bonusTo = (resolved, target) => resolved[target]?.total || 0;

/**
 * A saving throw or attack bonus can be hit by both the specific target and the
 * catch-all one, and both apply. A ring of protection is not a Fortitude item
 * and a cloak of resistance is not a Will item; they are both, at once.
 */
export const bonusToWithAll = (resolved, target, allTarget) =>
  bonusTo(resolved, target) + bonusTo(resolved, allTarget);

/** Bonuses to one skill: its own, plus anything aimed at every skill. */
export const bonusToSkill = (resolved, name) =>
  bonusTo(resolved, `skill.${name}`) + bonusTo(resolved, 'skill.*');

/** The conditional bonuses for one target, for the note beside it. */
export function conditionsFor(resolved, ...targets) {
  const out = [];
  for (const target of targets) {
    for (const entry of resolved[target]?.conditional || []) out.push(entry);
  }
  return out;
}

/** Every conditional bonus on the character, for the sheet's own list. */
export function allConditions(resolved) {
  const out = [];
  for (const bucket of Object.values(resolved)) {
    for (const entry of bucket.conditional) out.push(entry);
  }
  return out.sort((a, b) => a.target.localeCompare(b.target));
}

/** Targets that no part of the engine knows, so the interface can say so. */
export function unknownTargets(resolved) {
  return Object.values(resolved).filter((b) => b.unknown).map((b) => b.target);
}

/**
 * The AC buckets, separated the way the three Armour Classes need them.
 *
 * Touch drops armour, shield and natural armour. Flat-footed drops Dexterity
 * and dodge. Everything else - deflection, luck, insight, sacred, untyped -
 * counts towards all three, which is a rule people get wrong constantly.
 */
export const AC_OFF_TOUCH = new Set(['armor', 'shield', 'natural']);
export const AC_OFF_FLATFOOTED = new Set(['dodge']);
