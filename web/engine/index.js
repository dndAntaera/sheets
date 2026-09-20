// The engine's front door.
//
// The calculating half of this repository is deliberately free of the browser:
// it takes data in and gives numbers back, so the same code runs the sheet, the
// tests, and any validation a server wants to do.
//
// Rules come in layers:
//
//   core       what every 3.5 game shares: sizes, bonus types, the buy table
//   ruleset    what one table adds: SRD (the default, which adds nothing) or
//              Antaera (gestalt, taint, action points and the rest)
//   content    what one character carries: homebrew classes, races, feats ...
//
// `makeRules` assembles the first two; the third arrives with the character.

export * from './util.js';
export * from './progression.js';
export * from './build.js';
export * from './abilities.js';
export * from './skills.js';
export * from './hp.js';
export * from './defense.js';
export * from './offense.js';
export * from './houserules.js';
export * from './effects.js';
export * from './library.js';
export * from './modules.js';
export * from './sheet-modules.js';
export * from './sync.js';
export * from './campaign.js';
export * from './preferences.js';
export * from './magic.js';
export * from './trackers.js';
export * from './variants.js';
export * from './feats.js';
export * from './features.js';
export * from './languages.js';
export * from './traits.js';
export * from './synergies.js';
export * from './inventory.js';
export * from './feedback.js';
export * from './locks.js';
export * from './rolls.js';
export { derive } from './derive.js';
export { blankCharacter, migrate, renumberLevels, SCHEMA, DEFAULT_RULESET } from './character.js';

/** The rulesets that ship with the app, in the order the toggle lists them. */
export const RULESET_IDS = ['srd', 'antaera'];

/**
 * Bundle the data files into the context every engine function takes.
 *
 * `rulesets` holds every ruleset so switching between them costs nothing;
 * `ruleset` is the one in force. Use `withRuleset` to get the context for a
 * different one - it shares everything else.
 */
export function makeRules({
  core, rulesets, classes, skills, races, backgrounds = {}, progression = {}, variants = null,
  featRules = [], featEffects = null, traits = [], languages = [], domains = [], synergies = null, variantContent = null,
}, rulesetId = 'srd') {
  const base = {
    core,
    rulesets,
    classes,
    skills,
    races,
    backgrounds,
    progression,
    variants,
    // Unearthed Arcana's races, classes, feats and class features (srd/variant-content.json).
    variantContent,
    // Its feats sit beside the SRD's, each marked with the variant it belongs to.
    featRules: [...featRules, ...(variantContent?.feats || [])],
    featEffects,
    traits,
    languages,
    domains,
    synergies,
    classByName: new Map(classes.classes.map((c) => [c.name, c])),
    skillsByName: new Map(skills.skills.map((s) => [s.name, s])),
    raceByName: new Map((races?.races || []).map((r) => [r.name, r])),
  };
  return withRuleset(base, rulesetId);
}

/** The same rules context, under a different ruleset. */
export function withRuleset(rules, rulesetId) {
  const ruleset = rules.rulesets[rulesetId] || rules.rulesets.srd;
  return { ...rules, ruleset, rulesetId: ruleset.id };
}

/**
 * Fetch the data files and build the rules context. Browser side.
 *
 * With a `version` (the deployed commit) each file is asked for by it, and the
 * browser may keep what it has until the next deploy; without one, as on a
 * working copy, every file is checked with the server each time.
 */
export async function loadRules(base = './data/', rulesetId = 'srd', { version = null } = {}) {
  const get = async (path) => {
    const res = await fetch(version ? `${base}${path}?v=${encodeURIComponent(version)}` : `${base}${path}`, { cache: version ? 'default' : 'no-cache' });
    if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
    return res.json();
  };

  const [core, classes, skills, races, progression, variants, featRules, featEffects, traits, languages, domains, synergies, variantContent, ...rulesetFiles] = await Promise.all([
    get('core.json'),
    get('classes.json'),
    get('skills.json'),
    get('races.json'),
    get('srd/progression.json'),
    get('variants.json'),
    get('srd/feat-rules.json'),
    get('feat-effects.json'),
    get('srd/traits.json'),
    get('srd/languages.json'),
    get('srd/domains.json'),
    get('synergies.json'),
    get('srd/variant-content.json'),
    ...RULESET_IDS.map((id) => get(`rulesets/${id}.json`)),
  ]);

  const rulesets = Object.fromEntries(rulesetFiles.map((r) => [r.id, r]));

  // A ruleset may bring its own data - Antaera brings its backgrounds.
  const backgrounds = {};
  for (const ruleset of rulesetFiles) {
    if (ruleset.backgrounds?.data) {
      backgrounds[ruleset.id] = (await get(`rulesets/${ruleset.backgrounds.data}`)).backgrounds;
    }
  }

  return makeRules({
    core, rulesets, classes, skills, races, backgrounds, progression, variants, featRules, featEffects, traits, languages, domains, synergies, variantContent,
  }, rulesetId);
}
