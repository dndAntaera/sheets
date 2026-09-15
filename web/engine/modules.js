// The optional systems, and whether each is in force for one character.
//
// A module is a piece of the rules a table may or may not use: gestalt, action
// points, taint, traits and flaws, backgrounds, training time. Each ruleset
// says, per module, whether it is AVAILABLE at all and whether it starts ON.
//
// Who then decides is the ruleset's call too:
//
//   SRD      the player. These are printed variants, and a public creator has
//            no business deciding for a stranger's table whether it uses them.
//
//   Antaera  the ruleset. A player does not get to switch taint off. Gestalt
//            is handed to the GM: a character's campaign sets it, and a
//            character in no campaign is its own player's call.
//
// And a campaign overrides both: whatever its GM has set for the table, passed
// in as `overrides`, is what every character in it plays by.
//
// Everything in the engine that belongs to a module asks here first, and
// everything the interface shows for a module asks the same question, so the
// two can never disagree about whether taint is on.

/**
 * The SRD's variant rules (Unearthed Arcana), beside gestalt, action points and
 * traits and flaws above. What each does is data/variants.json and
 * engine/variants.js; here they are only names, so every module is one list.
 */
export const VARIANT_MODULES = [
  'environmentalRaces',
  'elementalRaces',
  'reducingLA',
  'paragonClasses',
  'bloodlines',
  'classVariants',
  'specialistVariants',
  'spontaneousDivine',
  'classFeatureVariants',
  'prestigiousClasses',
  'genericClasses',
  'skillsMaxRanks',
  'skillsLevelBased',
  'complexSkills',
  'spelltouchedFeats',
  'weaponGroups',
  'craftPoints',
  'srdBackground',
  'defenseBonus',
  'armorAsDR',
  'damageConversion',
  'injury',
  'reservePoints',
  'massiveDamage',
  'vitalityWounds',
  'bellCurve',
  'playersRollDice',
  'deathAndDying',
  'variableModifiers',
  'hexGrid',
  'combatFacing',
  'magicRating',
  'summonVariants',
  'rechargeMagic',
  'metamagicComponents',
  'spontaneousMetamagic',
  'spellPoints',
  'incantations',
  'legendaryWeapons',
  'itemFamiliars',
  'contacts',
  'reputation',
  'honor',
  'uaTaint',
  'testPrerequisites',
  'sanity',
];

export const MODULES = ['gestalt', 'actionPoints', 'taint', 'traitsFlaws', 'backgrounds', 'training', ...VARIANT_MODULES];

/**
 * Variant rules that are only more to choose from - races, classes, feats and
 * class features. They are not switched on: their races are in the race list,
 * their classes in the class list, for everyone, unless a campaign's GMs take
 * them off the table.
 */
export const CONTENT_MODULES = [
  'environmentalRaces',
  'elementalRaces',
  'paragonClasses',
  'classVariants',
  'specialistVariants',
  'spontaneousDivine',
  'classFeatureVariants',
  'prestigiousClasses',
  'genericClasses',
  'spelltouchedFeats',
  'weaponGroups',
];

/**
 * The switches that change how a character is BUILT - two classes a level, a
 * different way of buying skills, flaws that buy feats. The creator asks about
 * them first, in Concept. Every other switch changes how a character PLAYS, and
 * waits for the creator's Advanced step.
 */
export const BUILD_MODULES = ['gestalt', 'traitsFlaws', 'skillsMaxRanks', 'skillsLevelBased', 'srdBackground', 'backgrounds'];

/** The switches the Advanced step holds: every module that is neither content nor part of the build. */
export const PLAY_MODULES = MODULES.filter((m) => !CONTENT_MODULES.includes(m) && !BUILD_MODULES.includes(m));

export const MODULE_LABELS = {
  gestalt: 'Gestalt',
  actionPoints: 'Action points',
  taint: 'Taint',
  traitsFlaws: 'Traits and flaws',
  backgrounds: 'Backgrounds',
  training: 'Training time',
  environmentalRaces: 'Environmental racial variants',
  elementalRaces: 'Elemental racial variants',
  reducingLA: 'Reducing level adjustments',
  paragonClasses: 'Racial paragon classes',
  bloodlines: 'Bloodlines',
  classVariants: 'Variant character classes',
  specialistVariants: 'Specialist wizard variants',
  spontaneousDivine: 'Spontaneous divine casters',
  classFeatureVariants: 'Class feature variants',
  prestigiousClasses: 'Prestigious character classes',
  genericClasses: 'Generic classes',
  skillsMaxRanks: 'Skills: maximum ranks',
  skillsLevelBased: 'Skills: level-based',
  complexSkills: 'Complex skill checks',
  spelltouchedFeats: 'Spelltouched feats',
  weaponGroups: 'Weapon group feats',
  craftPoints: 'Craft points',
  srdBackground: 'Character background',
  defenseBonus: 'Defense bonus',
  armorAsDR: 'Armor as damage reduction',
  damageConversion: 'Damage conversion',
  injury: 'Injury',
  reservePoints: 'Reserve points',
  massiveDamage: 'Massive damage variants',
  vitalityWounds: 'Vitality and wound points',
  bellCurve: 'Bell curve rolls',
  playersRollDice: 'Players roll all the dice',
  deathAndDying: 'Death and dying',
  variableModifiers: 'Variable modifiers',
  hexGrid: 'Hex grid',
  combatFacing: 'Combat facing',
  magicRating: 'Magic rating',
  summonVariants: 'Summon monster variants',
  rechargeMagic: 'Recharge magic',
  metamagicComponents: 'Metamagic components',
  spontaneousMetamagic: 'Spontaneous metamagic',
  spellPoints: 'Spell points',
  incantations: 'Incantations',
  legendaryWeapons: 'Legendary weapons',
  itemFamiliars: 'Item familiars',
  contacts: 'Contacts',
  reputation: 'Reputation',
  honor: 'Honor',
  uaTaint: 'Taint (SRD)',
  testPrerequisites: 'Test-based prerequisites',
  sanity: 'Sanity',
};

/**
 * The state of one module for one character.
 *
 * @param overrides  settings imposed from outside the sheet - the campaign
 *                   server's gestalt switch, for one. They win over everything.
 * @returns { on, available, choosable, lockedBy }
 */
export function moduleState(rules, character, name, overrides = {}) {
  const def = rules.ruleset.modules?.[name] || { enabled: false, available: false };
  if (!def.available) return { on: false, available: false, choosable: false, lockedBy: 'ruleset' };

  if (overrides[name] !== undefined && overrides[name] !== null) {
    return { on: Boolean(overrides[name]), available: true, choosable: false, lockedBy: def.lockedBy || 'campaign' };
  }

  // More races, classes and feats to choose from: offered, not switched.
  if (CONTENT_MODULES.includes(name)) return { on: true, available: true, choosable: false, lockedBy: 'content' };

  // A module the ruleset hands to the GM - Antaera's gestalt - is set by the
  // campaign a character is in, which arrives above as an override. A character
  // in no campaign has no GM but its player, so the player chooses.
  const playerChooses = rules.ruleset.variantsChosenBy === 'player' || def.lockedBy === 'gm';
  if (!playerChooses) {
    return { on: Boolean(def.enabled), available: true, choosable: false, lockedBy: def.lockedBy || 'ruleset' };
  }

  const chosen = character?.options?.[name];
  return {
    on: chosen === undefined || chosen === null ? Boolean(def.enabled) : Boolean(chosen),
    available: true,
    choosable: true,
    lockedBy: null,
  };
}

/** Every module's on/off for one character, as a plain object. */
export function activeModules(rules, character, overrides = {}) {
  return Object.fromEntries(MODULES.map((m) => [m, moduleState(rules, character, m, overrides).on]));
}
