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

export const MODULES = ['gestalt', 'actionPoints', 'taint', 'traitsFlaws', 'backgrounds', 'training'];

export const MODULE_LABELS = {
  gestalt: 'Gestalt',
  actionPoints: 'Action points',
  taint: 'Taint',
  traitsFlaws: 'Traits and flaws',
  backgrounds: 'Backgrounds',
  training: 'Training time',
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
