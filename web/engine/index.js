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
export function makeRules(data, rulesetId = 'srd') {
  const {
    core, rulesets, classes, skills, races, backgrounds = {}, progression = {}, variants = null,
    featRules = [], featEffects = null, traits = [], languages = [], domains = [], synergies = null, variantContent = null,
    packs = Object.keys(DATA_PACKS),
  } = data;
  const base = {
    // What was loaded, and the files it came from: adding a pack later
    // (addPacks) makes the rules again from these plus the new files.
    packs,
    data,
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
 * The data every sheet needs, and the data only some do.
 *
 * A fighter never reads the domains, a character with no traits never reads
 * the traits, and a character built entirely from the SRD never reads
 * Unearthed Arcana's races, classes and feats - about 140 KB between them. The
 * app loads the core, then whatever a character turns out to need
 * (`packsForCharacter` in sheet-modules.js, then `addPacks` here).
 */
export const DATA_PACKS = {
  variants: { variants: 'variants.json', variantContent: 'srd/variant-content.json' },
  traits: { traits: 'srd/traits.json' },
  domains: { domains: 'srd/domains.json' },
};

/** Ask for a data file, stamped with the build when there is one. */
const fetcher = (base, version) => async (path) => {
  const res = await fetch(version ? `${base}${path}?v=${encodeURIComponent(version)}` : `${base}${path}`, { cache: version ? 'default' : 'no-cache' });
  if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
  return res.json();
};

/**
 * Fetch the data files and build the rules context. Browser side.
 *
 * With a `version` (the deployed commit) each file is asked for by it, and the
 * browser may keep what it has until the next deploy; without one, as on a
 * working copy, every file is checked with the server each time. `packs` names
 * the optional data to fetch as well; the default is all of it, which is what
 * the tests and anything outside the app want.
 */
export async function loadRules(base = './data/', rulesetId = 'srd', { version = null, packs = Object.keys(DATA_PACKS) } = {}) {
  const get = fetcher(base, version);
  const wanted = packs.filter((name) => DATA_PACKS[name]);
  const extraFiles = wanted.flatMap((name) => Object.entries(DATA_PACKS[name]));

  const [core, classes, skills, races, progression, featRules, featEffects, languages, synergies, ...rest] = await Promise.all([
    get('core.json'),
    get('classes.json'),
    get('skills.json'),
    get('races.json'),
    get('srd/progression.json'),
    get('srd/feat-rules.json'),
    get('feat-effects.json'),
    get('srd/languages.json'),
    get('synergies.json'),
    ...RULESET_IDS.map((id) => get(`rulesets/${id}.json`)),
    ...extraFiles.map(([, file]) => get(file)),
  ]);
  const rulesetFiles = rest.slice(0, RULESET_IDS.length);
  const extra = Object.fromEntries(extraFiles.map(([key], i) => [key, rest[RULESET_IDS.length + i]]));

  const rulesets = Object.fromEntries(rulesetFiles.map((r) => [r.id, r]));

  // A ruleset may bring its own data - Antaera brings its backgrounds.
  const backgrounds = {};
  for (const ruleset of rulesetFiles) {
    if (ruleset.backgrounds?.data) {
      backgrounds[ruleset.id] = (await get(`rulesets/${ruleset.backgrounds.data}`)).backgrounds;
    }
  }

  return makeRules({
    core, rulesets, classes, skills, races, backgrounds, progression, featRules, featEffects, languages, synergies,
    ...extra, packs: wanted, base, version,
  }, rulesetId);
}

/**
 * The same rules with more of the optional data in them. Nothing is fetched
 * twice: rules that already have a pack come straight back.
 */
export async function addPacks(rules, names, options = {}) {
  const wanted = [...new Set(names)].filter((name) => DATA_PACKS[name] && !rules.packs.includes(name));
  if (!wanted.length) return rules;
  const base = options.base ?? rules.data.base ?? './data/';
  const get = fetcher(base, options.version ?? rules.data.version ?? null);
  const files = wanted.flatMap((name) => Object.entries(DATA_PACKS[name]));
  const loaded = await Promise.all(files.map(([, file]) => get(file)));
  const extra = Object.fromEntries(files.map(([key], i) => [key, loaded[i]]));
  return makeRules({ ...rules.data, ...extra, packs: [...rules.packs, ...wanted] }, rules.rulesetId);
}
