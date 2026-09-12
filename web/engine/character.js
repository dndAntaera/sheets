// The stored shape of a character, and how to make a new one.
//
// Only what a player TYPED is stored. Every number that can be worked out from
// something else - base attack bonus, saves, hit points, skill totals, action
// points - is left out on purpose and computed by derive(). A sheet that stores
// its own totals is a sheet whose totals eventually disagree with its parts.

export const SCHEMA = 1;

const abilityBlock = (value = 0) => ({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

/**
 * A blank character, at the level this campaign starts at.
 *
 * The skill list arrives pre-filled with every skill that has no subject, in
 * the order a printed sheet lists them, because a player scanning for Listen
 * should find Listen rather than an Add button. Craft, Knowledge, Perform and
 * Profession are added as needed, one line per subject.
 */
export function blankCharacter(rules, overrides = {}) {
  const startingLevel = rules.rules.campaign.startingLevel || 1;

  return {
    schema: SCHEMA,
    name: '',
    player: '',
    portrait: '',

    concept: { alignment: '', deity: '', age: '', gender: '', height: '', weight: '', eyes: '', hair: '', skin: '' },

    race: {
      name: '',
      size: 'Medium',
      speed: 30,
      la: 0,
      racialHD: 0,
      abilityAdjust: abilityBlock(0),
      skillPointsPerLevel: 0,
      traits: '',
    },

    background: { name: '', item: '', notes: '' },

    // One row per character level. `a` is the only side used unless the GM has
    // turned gestalt on, and `b` is kept either way so switching the campaign
    // setting never destroys what a player typed.
    levels: Array.from({ length: startingLevel }, (_, i) => ({ level: i + 1, a: '', b: '' })),
    customClasses: [],
    nextLevel: { a: '', b: '' },

    abilities: {
      method: 'pointBuy',
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
      .map((s) => ({ name: s.name, subtype: '', ranks: 0, misc: 0 })),

    feats: [],
    traits: [],
    flaws: [],
    featSlots: { bonus: 0 },

    actionPoints: { spent: 0, bonus: 0 },
    taint: { corruption: 0, depravity: 0, pureSoul: false, exaltedFeats: 0, notes: '' },

    wealth: { startingGold: null, gold: 0, items: [] },

    // Free text, because this is the half of a character the campaign rewrites
    // constantly and no schema would survive it.
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
 * Nothing to do yet, and that is the point of keeping it here from the start:
 * when the shape does change, every reader goes through one function and old
 * sheets keep opening.
 */
export function migrate(character) {
  const c = { ...character };
  c.schema = SCHEMA;
  return c;
}

/** Levels in, levels out - keeps `level` honest after an insert or delete. */
export function renumberLevels(levels) {
  return levels.map((row, i) => ({ ...row, level: i + 1 }));
}
