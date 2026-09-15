// The choices a finished character keeps, and a record of every change to them.
//
// While a character is being made, everything is open. Once the creator is
// finished, what the character is BUILT of - race, classes, ability scores,
// skills, feats, traits and flaws, spells and powers known, languages, hit
// point rolls, the rules it plays by - is held: the sheet shows it, but changing
// it means going back into the creator. Coming out of the creator again records
// what changed, in the character's own `history`, and a character in a campaign
// has its GMs told.
//
// Everything that plays - hit points lost, spells prepared and cast, uses
// spent, gear bought - stays open on the sheet, as it must.
//
// Pure, and shared: the app enforces the lock and records changes made offline;
// the server (worker/src/features/characters.js) keeps its own copy of the
// finished choices, so a change that reaches it any other way is recorded too.
//
//   character.history   [{ id, at, by: { id, name } | null, changes: [{ area, label, step, text }] }]

import { num } from './util.js';
import { MODULE_LABELS } from './modules.js';

/** A character still in the creator for the first time is not held. */
export const isFinished = (character) => !character?.meta?.wizard || Boolean(character.meta.wizard.revision);

/** Whether the sheet (not the creator) holds a character's choices right now. */
export const isHeld = (character) => !character?.meta?.wizard;

/** The most history a sheet carries; older entries fall away. */
export const HISTORY_LIMIT = 200;

/**
 * The fields, by path, that hold a finished character's choices. The sheet
 * disables a field whose `data-field` matches one of these.
 */
export const LOCKED_FIELDS = [
  /^race\./,
  /^levels\./,
  /^abilities\.(method|base|levelUps|rolls|placed|pointBuyBudget)(\.|$)/,
  /^skills\.\d+\.(name|subtype|ranks|known)$/,
  /^feats\.\d+\.(name|choice|slot)$/,
  /^(traits|flaws)\.\d+\./,
  /^languages(\.|$)/,
  /^hp\.(method|rolls)(\.|$)/,
  /^options\./,
  /^ruleset$/,
  /^variants\.(genericSaves|chosenSkills|casterAbility|featureVariants)(\.|$)/,
  /^magic\.[^.]+\.(known|specialty|prohibited|domains|discipline)(\.|$)/,
];

export const isLockedPath = (path) => LOCKED_FIELDS.some((re) => re.test(String(path)));

/** The areas of choice, each with the creator step it is changed in. */
export const LOCKED_AREAS = [
  { key: 'rules', label: 'Rules', step: 'concept' },
  { key: 'race', label: 'Race', step: 'race' },
  { key: 'classes', label: 'Classes', step: 'class' },
  { key: 'abilities', label: 'Ability scores', step: 'abilities' },
  { key: 'skills', label: 'Skills', step: 'skills' },
  { key: 'feats', label: 'Feats', step: 'feats' },
  { key: 'traits', label: 'Traits and flaws', step: 'feats' },
  { key: 'hitPoints', label: 'Hit points', step: 'gear' },
  { key: 'spells', label: 'Spells and powers', step: 'details' },
  { key: 'languages', label: 'Languages', step: 'details' },
];

const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const pick = (object, keys) => Object.fromEntries(keys.filter((k) => object?.[k] !== undefined).map((k) => [k, copy(object[k])]));
const MAGIC_CHOICES = ['known', 'specialty', 'prohibited', 'domains', 'discipline'];
const VARIANT_CHOICES = ['genericSaves', 'chosenSkills', 'casterAbility', 'featureVariants'];

/**
 * A copy of just the held parts of a character, exactly as stored - enough to
 * put them back (restoreLocked) or compare (lockedSummary).
 */
export function lockedParts(character) {
  const c = character || {};
  return {
    ruleset: c.ruleset || null,
    options: copy(c.options || {}),
    race: copy(c.race || {}),
    levels: copy(c.levels || []),
    variants: pick(c.variants, VARIANT_CHOICES),
    abilities: pick(c.abilities, ['method', 'base', 'levelUps', 'rolls', 'placed', 'pointBuyBudget']),
    skills: copy(c.skills || []),
    feats: copy(c.feats || []),
    traits: copy(c.traits || []),
    flaws: copy(c.flaws || []),
    hp: pick(c.hp, ['method', 'rolls']),
    magic: Object.fromEntries(Object.entries(c.magic || {}).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => [k, pick(v, MAGIC_CHOICES)])),
    languages: copy(c.languages || []),
  };
}

/**
 * Put held parts back onto a character: changes made in the creator, thrown
 * away. What is not held - hit points lost, spells prepared - is left alone.
 */
export function restoreLocked(character, parts) {
  if (!parts) return character;
  character.ruleset = parts.ruleset || character.ruleset;
  character.options = copy(parts.options || {});
  character.race = copy(parts.race || {});
  character.levels = copy(parts.levels || []);
  const variants = { ...(character.variants || {}) };
  for (const k of VARIANT_CHOICES) delete variants[k];
  character.variants = { ...variants, ...copy(parts.variants || {}) };
  character.abilities = { ...(character.abilities || {}) };
  for (const k of ['method', 'base', 'levelUps', 'rolls', 'placed', 'pointBuyBudget']) delete character.abilities[k];
  Object.assign(character.abilities, copy(parts.abilities || {}));
  character.skills = copy(parts.skills || []);
  character.feats = copy(parts.feats || []);
  character.traits = copy(parts.traits || []);
  character.flaws = copy(parts.flaws || []);
  character.hp = { ...(character.hp || {}) };
  for (const k of ['method', 'rolls']) delete character.hp[k];
  Object.assign(character.hp, copy(parts.hp || {}));
  const magic = { ...(character.magic || {}) };
  for (const [name, state] of Object.entries(magic)) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) continue;
    const kept = { ...state };
    for (const k of MAGIC_CHOICES) delete kept[k];
    magic[name] = kept;
  }
  for (const [name, state] of Object.entries(parts.magic || {})) magic[name] = { ...(magic[name] || {}), ...copy(state) };
  character.magic = magic;
  character.languages = copy(parts.languages || []);
  return character;
}

const clean = (s) => String(s ?? '').trim();
const label = (name, choice) => (clean(choice) ? `${clean(name)} (${clean(choice)})` : clean(name));
const sortedNames = (list) => [...new Set((list || []).map((x) => (typeof x === 'string' ? clean(x) : label(x?.name, x?.choice))).filter(Boolean))].sort();

/**
 * The held choices in a plain, comparable form: what matters and nothing else,
 * in a stable order. Two characters with the same summary made the same choices.
 * Takes a character or the parts of one.
 */
export function lockedSummary(character) {
  // A character and the parts of one read the same way: the parts are the character's own keys.
  const p = lockedParts(character || {});
  const skills = {};
  for (const s of p.skills || []) {
    const ranks = num(s.ranks);
    const key = label(s.name, s.subtype);
    if (key && (ranks > 0 || s.known)) skills[key] = s.known && !ranks ? 'known' : ranks;
  }
  const spells = {};
  for (const [name, state] of Object.entries(p.magic || {})) {
    const known = sortedNames((state.known || []).map((k) => ({ name: k?.name, choice: k?.level !== undefined ? `level ${k.level}` : '' })));
    const entry = {};
    if (known.length) entry.known = known;
    if (state.specialty) entry.specialty = state.specialty;
    if ((state.prohibited || []).length) entry.prohibited = [...state.prohibited].sort();
    if ((state.domains || []).filter(Boolean).length) entry.domains = state.domains.filter(Boolean);
    if (state.discipline) entry.discipline = state.discipline;
    if (Object.keys(entry).length) spells[name] = entry;
  }
  const options = Object.fromEntries(Object.entries(p.options || {}).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => a.localeCompare(b)));
  const rolls = Object.fromEntries(Object.entries(p.hp?.rolls || {}).filter(([, v]) => clean(v) !== '').map(([k, v]) => [k, num(v)]));
  return {
    rules: { ruleset: p.ruleset || null, options },
    race: clean(p.race?.name),
    classes: {
      levels: (p.levels || []).map((r) => [clean(r?.a), clean(r?.b)]),
      choices: sortKeys(p.variants || {}),
    },
    abilities: {
      method: p.abilities?.method || null,
      base: sortKeys(p.abilities?.base || {}),
      levelUps: sortKeys(Object.fromEntries(Object.entries(p.abilities?.levelUps || {}).filter(([, v]) => v))),
    },
    skills: sortKeys(skills),
    feats: sortedNames(p.feats),
    traits: { traits: sortedNames(p.traits), flaws: sortedNames(p.flaws) },
    hitPoints: { method: p.hp?.method || null, rolls: sortKeys(rolls) },
    spells: sortKeys(spells),
    languages: sortedNames(p.languages),
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const METHOD_WORDS = { pointBuy: 'point buy', array: 'standard array', rolled: 'rolled' };
const word = (v) => (v === null || v === undefined || v === '' ? 'none' : String(v));

/** Items added and taken away between two lists of names. */
function addedRemoved(before, after, noun) {
  const out = [];
  const was = new Set(before);
  const now = new Set(after);
  const added = after.filter((x) => !was.has(x));
  const removed = before.filter((x) => !now.has(x));
  if (added.length) out.push(`${noun} added: ${added.join(', ')}`);
  if (removed.length) out.push(`${noun} removed: ${removed.join(', ')}`);
  return out;
}

/**
 * What changed between two summaries (or characters), in words, area by area.
 *
 * @returns [{ area, label, step, text }]
 */
export function lockChanges(before, after) {
  const a = before?.classes && before?.rules ? before : lockedSummary(before || {});
  const b = after?.classes && after?.rules ? after : lockedSummary(after || {});
  const out = [];
  const add = (key, text) => {
    const area = LOCKED_AREAS.find((x) => x.key === key);
    out.push({ area: key, label: area.label, step: area.step, text });
  };

  if (a.rules.ruleset !== b.rules.ruleset) add('rules', `Ruleset: ${word(a.rules.ruleset)} to ${word(b.rules.ruleset)}`);
  const optionKeys = [...new Set([...Object.keys(a.rules.options), ...Object.keys(b.rules.options)])].sort();
  for (const k of optionKeys) {
    if (Boolean(a.rules.options[k]) !== Boolean(b.rules.options[k]) && a.rules.options[k] !== b.rules.options[k]) {
      add('rules', `${MODULE_LABELS[k] || k}: ${b.rules.options[k] ? 'switched on' : 'switched off'}`);
    }
  }

  if (a.race !== b.race) add('race', `Race: ${word(a.race)} to ${word(b.race)}`);

  const rows = Math.max(a.classes.levels.length, b.classes.levels.length);
  const pair = (r) => (r ? r.filter(Boolean).join(' / ') || 'no class' : '');
  for (let i = 0; i < rows; i++) {
    const was = a.classes.levels[i];
    const now = b.classes.levels[i];
    if (!was) add('classes', `Level ${i + 1} added: ${pair(now)}`);
    else if (!now) add('classes', `Level ${i + 1} removed (was ${pair(was)})`);
    else if (!same(was, now)) add('classes', `Level ${i + 1}: ${pair(was)} to ${pair(now)}`);
  }
  if (!same(a.classes.choices, b.classes.choices)) add('classes', 'Class choices changed (good saves, class skills or a class feature variant)');

  if (a.abilities.method !== b.abilities.method) add('abilities', `Method: ${METHOD_WORDS[a.abilities.method] || word(a.abilities.method)} to ${METHOD_WORDS[b.abilities.method] || word(b.abilities.method)}`);
  const scores = ABILITY_ORDER.filter((k) => num(a.abilities.base[k]) !== num(b.abilities.base[k]))
    .map((k) => `${k.toUpperCase()} ${num(a.abilities.base[k])} to ${num(b.abilities.base[k])}`);
  if (scores.length) add('abilities', `Base scores: ${scores.join(', ')}`);
  const levels = [...new Set([...Object.keys(a.abilities.levelUps), ...Object.keys(b.abilities.levelUps)])].sort((x, y) => Number(x) - Number(y));
  for (const l of levels) {
    if (a.abilities.levelUps[l] !== b.abilities.levelUps[l]) {
      add('abilities', `Level ${l} increase: ${word(a.abilities.levelUps[l]).toUpperCase()} to ${word(b.abilities.levelUps[l]).toUpperCase()}`);
    }
  }

  const skillNames = [...new Set([...Object.keys(a.skills), ...Object.keys(b.skills)])].sort();
  const skillLines = [];
  for (const name of skillNames) {
    const was = a.skills[name];
    const now = b.skills[name];
    if (was === now) continue;
    if (was === undefined) skillLines.push(`${name} ${now === 'known' ? 'known' : `${now} ranks`}`);
    else if (now === undefined) skillLines.push(`${name} dropped (was ${was === 'known' ? 'known' : `${was} ranks`})`);
    else skillLines.push(`${name} ${was} to ${now} ranks`);
  }
  if (skillLines.length) add('skills', `Skills: ${skillLines.join('; ')}`);

  for (const text of addedRemoved(a.feats, b.feats, 'Feats')) add('feats', text);
  for (const text of addedRemoved(a.traits.traits, b.traits.traits, 'Traits')) add('traits', text);
  for (const text of addedRemoved(a.traits.flaws, b.traits.flaws, 'Flaws')) add('traits', text);

  if (a.hitPoints.method !== b.hitPoints.method) add('hitPoints', `Hit points after 1st level: ${word(a.hitPoints.method)} to ${word(b.hitPoints.method)}`);
  const rollLevels = [...new Set([...Object.keys(a.hitPoints.rolls), ...Object.keys(b.hitPoints.rolls)])].sort((x, y) => Number(x) - Number(y));
  const rolls = rollLevels.filter((l) => a.hitPoints.rolls[l] !== b.hitPoints.rolls[l]).map((l) => `level ${l} ${word(a.hitPoints.rolls[l])} to ${word(b.hitPoints.rolls[l])}`);
  if (rolls.length) add('hitPoints', `Hit point rolls: ${rolls.join(', ')}`);

  for (const name of [...new Set([...Object.keys(a.spells), ...Object.keys(b.spells)])].sort()) {
    const was = a.spells[name] || {};
    const now = b.spells[name] || {};
    for (const text of addedRemoved(was.known || [], now.known || [], `${name} spells or powers`)) add('spells', text);
    if (was.specialty !== now.specialty) add('spells', `${name} specialty school: ${word(was.specialty)} to ${word(now.specialty)}`);
    if (!same(was.prohibited || [], now.prohibited || [])) add('spells', `${name} prohibited schools: ${(was.prohibited || []).join(', ') || 'none'} to ${(now.prohibited || []).join(', ') || 'none'}`);
    if (!same(was.domains || [], now.domains || [])) add('spells', `${name} domains: ${(was.domains || []).join(', ') || 'none'} to ${(now.domains || []).join(', ') || 'none'}`);
    if (was.discipline !== now.discipline) add('spells', `${name} discipline: ${word(was.discipline)} to ${word(now.discipline)}`);
  }

  for (const text of addedRemoved(a.languages, b.languages, 'Languages')) add('languages', text);
  return out;
}

/** A history entry for these changes, or null if there are none. */
export function historyEntry(changes, { at, by = null, id } = {}) {
  if (!changes?.length) return null;
  return { id: id || `h${Date.parse(at || '') || Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: at || new Date().toISOString(), by, changes };
}

/** A history with an entry added, the oldest dropped past the limit. */
export function withHistory(history, entry) {
  const list = Array.isArray(history) ? history : [];
  return entry ? [...list, entry].slice(-HISTORY_LIMIT) : list;
}
