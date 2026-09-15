// The stored shape of a character, and how to make a new one.
//
// Only what a player TYPED or CHOSE is stored. Every number that can be worked
// out from something else - base attack bonus, saves, hit points, skill totals -
// is left out on purpose and computed by derive(). A sheet that stores its own
// totals is a sheet whose totals eventually disagree with its parts.

import { migrateInventory } from './inventory.js';
import { CLASS_VARIANTS } from './variants.js';

export const SCHEMA = 2;

/** What a new character is built under, unless someone chooses otherwise. */
export const DEFAULT_RULESET = 'srd';

const abilityBlock = (value = 0) => ({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

/**
 * A blank character under a ruleset: the SRD's 1st-level blank slate by
 * default, or a 3rd-level Antaeran one.
 *
 * The skill list arrives pre-filled with every skill that has no subject, in
 * the order a printed sheet lists them, because a player scanning for Listen
 * should find Listen rather than an Add button.
 */
export function blankCharacter(rules, overrides = {}) {
  const ruleset = rules.ruleset;
  const startingLevel = ruleset.startingLevel || 1;
  const generation = ruleset.abilityGeneration;

  return {
    schema: SCHEMA,
    ruleset: ruleset.id || DEFAULT_RULESET,

    // Variant rules a player has switched on or off, where the ruleset lets
    // them choose. Absent means "whatever the ruleset starts with".
    options: {},

    name: '',
    player: '',
    portrait: '',

    concept: { alignment: '', deity: '', age: '', gender: '', height: '', weight: '', eyes: '', hair: '', skin: '' },

    // A race the sheet knows (an SRD race, or one in `content`) supplies its own
    // numbers, and these fields are ignored. A race it does not know is typed
    // in here instead.
    race: {
      name: '',
      size: 'Medium',
      speed: 30,
      la: 0,
      racialHD: 0,
      abilityAdjust: abilityBlock(0),
      traits: '',
    },
    templates: [],

    background: { name: '', item: '', notes: '' },

    // One row per character level. `b` is only read under gestalt, and is kept
    // either way so switching gestalt never destroys what a player typed.
    levels: Array.from({ length: startingLevel }, (_, i) => ({ level: i + 1, a: '', b: '' })),
    nextLevel: { a: '', b: '' },

    abilities: {
      method: generation.default || 'pointBuy',
      pointBuyBudget: generation.pointBuy?.budget ?? null,
      base: abilityBlock(8),
      levelUps: {},
      enhancement: abilityBlock(0),
      inherent: abilityBlock(0),
      misc: abilityBlock(0),
      temp: abilityBlock(0),
    },

    hp: { method: 'average', rolls: {}, bonus: 0, current: null, nonlethal: 0, temp: 0 },

    gear: {
      armor: { name: '', bonus: 0, maxDex: null, acp: 0, asf: 0, speed: null },
      shield: { name: '', bonus: 0, maxDex: null, acp: 0, asf: 0 },
      natural: 0,
      deflection: 0,
      dodge: 0,
      misc: 0,
    },

    combat: { initiativeMisc: 0, misc: { melee: 0, ranged: 0, grapple: 0 }, spellResistance: 0, damageReduction: '' },
    weapons: [],

    saves: { magic: { fort: 0, ref: 0, will: 0 }, misc: { fort: 0, ref: 0, will: 0 } },

    skills: rules.skills.skills
      .filter((s) => !s.subtype)
      .filter((s) => !s.psionic || ruleset.modules?.psionics?.enabled !== false)
      .map((s) => ({ name: s.name, subtype: '', ranks: 0, misc: 0 })),

    // Rows here can name a piece of content (and gain its effects) or carry
    // effects of their own. See library.js resolveEntries.
    feats: [],
    features: [],
    traits: [],
    flaws: [],
    featSlots: { bonus: 0 },

    actionPoints: { spent: 0, bonus: 0 },
    taint: { corruption: 0, depravity: 0, pureSoul: false, exaltedFeats: 0, notes: '' },

    // The inventory, and what paid for it (engine/inventory.js).
    wealth: { startingGold: null, items: [], ledger: [] },
    equipment: { armor: null, shield: null, weapons: [], slots: {} },

    // Homebrew this character uses, embedded so the sheet is whole on its own.
    content: { races: [], classes: [], feats: [], skills: [], items: [], templates: [], features: [] },

    text: {
      classFeatures: '',
      spells: '',
      powers: '',
      languages: '',
      equipment: '',
      backstory: '',
      notes: '',
    },

    meta: { created: null, updated: null, owner: null, forumThread: '' },
    ...overrides,
  };
}

/**
 * Bring an older stored character up to the current schema.
 *
 *   schema 1 -> 2   The app was Antaera-only, so every sheet from then was an
 *                   Antaeran character: it keeps that ruleset rather than being
 *                   silently re-read under the SRD. Custom classes move from
 *                   their old home into `content`.
 */
export function migrate(character) {
  const c = { ...character };

  if (!c.schema || c.schema < 2) {
    c.ruleset = c.ruleset || 'antaera';
    c.options = c.options || {};
    c.content = c.content || {};
    if (Array.isArray(c.customClasses) && c.customClasses.length) {
      c.content.classes = [...(c.content.classes || []), ...c.customClasses];
    }
    delete c.customClasses;
  }

  c.options = c.options || {};
  c.templates = c.templates || [];
  c.features = c.features || [];
  c.content = { races: [], classes: [], feats: [], skills: [], items: [], templates: [], features: [], ...(c.content || {}) };
  migrateInventory(c);
  migrateClassVariants(c);
  c.schema = SCHEMA;
  return c;
}

/**
 * Unearthed Arcana's class variants were a switch and a choice of variant for
 * each class; spontaneous divine casting, a switch for clerics and druids both.
 * Now the variant is the class chosen - "Cloistered cleric" on the level rows -
 * so a sheet that had one switched on is given the variant's name there.
 */
function migrateClassVariants(c) {
  const renamed = {};
  if (c.options?.classVariants === true) {
    for (const [className, key] of Object.entries(c.variants?.classVariant || {})) {
      const variant = CLASS_VARIANTS[className]?.[key];
      if (variant) renamed[className] = variant.name;
    }
  }
  if (c.options?.spontaneousDivine === true) {
    renamed.Cleric = renamed.Cleric || CLASS_VARIANTS.Cleric.spontaneousCleric.name;
    renamed.Druid = renamed.Druid || CLASS_VARIANTS.Druid.spontaneousDruid.name;
  }
  const legacy = c.variants?.classVariant || c.options?.classVariants !== undefined || c.options?.spontaneousDivine !== undefined;
  if (!legacy) return;
  const to = (name) => renamed[name] || name;
  c.levels = (c.levels || []).map((row) => ({ ...row, a: to(row.a), b: to(row.b) }));
  if (c.nextLevel) c.nextLevel = { ...c.nextLevel, a: to(c.nextLevel.a), b: to(c.nextLevel.b) };
  if (c.variants?.classVariant) {
    c.variants = { ...c.variants };
    delete c.variants.classVariant;
  }
  const options = { ...c.options };
  delete options.classVariants;
  delete options.spontaneousDivine;
  c.options = options;
}

/**
 * A character with every part a sheet expects, filled from a blank one where it
 * is missing.
 *
 * A sheet made in the app is always whole. One that arrives another way - an
 * old export, a file written by hand, a character saved through the API by some
 * other tool - may have a name and a level and nothing else, and a sheet that
 * crashes on a missing skill list is worse than one that shows an empty one.
 * What the character has is kept; only what it lacks is added.
 */
export function fillMissing(character, rules) {
  const blank = blankCharacter(rules);
  const filled = { ...blank, ...character };
  for (const [key, value] of Object.entries(blank)) {
    const have = character[key];
    if (have === undefined || have === null) continue;
    if (Array.isArray(value)) {
      if (!Array.isArray(have)) filled[key] = value;
    } else if (value && typeof value === 'object') {
      filled[key] = have && typeof have === 'object' && !Array.isArray(have) ? { ...value, ...have } : value;
    }
  }
  if (!Array.isArray(filled.levels) || filled.levels.length === 0) filled.levels = blank.levels;
  return filled;
}

/** Levels in, levels out - keeps `level` honest after an insert or delete. */
export function renumberLevels(levels) {
  return levels.map((row, i) => ({ ...row, level: i + 1 }));
}
