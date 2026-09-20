// What a sheet is made of, part by part - and what is left out of the file.
//
// A character in memory is whole: every field `blankCharacter` describes is
// there, so nothing that reads a sheet has to ask whether a part exists. A
// character *on disk* is not: it keeps what a player has actually used and
// nothing else. A fighter's file has no spells in it; a sheet with an empty
// inventory has no inventory in it; a skill nobody put a rank in is not a row.
//
//   packCharacter(character, rules)   the file: what is used, and the module
//                                     list that says which parts those are
//   fillCharacter(stored, rules)      the whole character again
//
// Filling undoes packing: fill(pack(c)) is c again, but for empty shapes the
// app leaves behind as it goes (`magic: { Wizard: { known: [] } }` from opening
// the casting panel), which say nothing and are not written. The parts are
// named here, as modules, because the file's `modules` list is what lets the
// app fetch a sheet's code and data without first reading the whole sheet -
// a fighter never loads the casting tables.
//
// Adding a field to a character means adding it to `blankCharacter`; if it
// belongs to a part that not every sheet has, name it in the module here too,
// or it will be kept in every file.

import { blankCharacter } from './character.js';

/**
 * The optional parts. Everything not named here - the name, race, levels,
 * abilities, hit points, skills, saves, combat, gear, meta - is core, kept in
 * every sheet that has it.
 */
export const SHEET_MODULES = [
  { key: 'spells', label: 'Spells and powers', fields: ['magic'] },
  { key: 'inventory', label: 'Inventory and equipment', fields: ['wealth', 'equipment', 'weapons'] },
  { key: 'feats', label: 'Feats, traits and features', fields: ['feats', 'featSlots', 'features', 'traits', 'flaws'] },
  { key: 'languages', label: 'Languages', fields: ['languages'] },
  { key: 'effects', label: 'Effects in play', fields: ['effects'] },
  { key: 'trackers', label: 'Uses spent', fields: ['trackers'] },
  { key: 'variants', label: 'Variant rules', fields: ['options', 'variants'] },
  { key: 'taint', label: 'Taint', fields: ['taint'] },
  { key: 'actionPoints', label: 'Action points', fields: ['actionPoints'] },
  { key: 'story', label: 'Story', fields: ['concept', 'background', 'portrait', 'templates', 'text'] },
  { key: 'homebrew', label: 'Homebrew of its own', fields: ['content'] },
  { key: 'history', label: 'Change history', fields: ['history'] },
];

/** Kept even when it is still what a new character starts with. */
const ALWAYS = ['id', 'schema', 'ruleset', 'name', 'levels', 'meta'];

/** A skill row nobody has touched: no ranks, no bonus, no subject of its own. */
const emptySkill = (row) => {
  if (!row || typeof row !== 'object') return true;
  const { name, subtype, ranks, misc, ...rest } = row;
  return !Number(ranks) && !Number(misc) && !String(subtype || '').trim()
    && Object.values(rest).every((v) => v === '' || v === 0 || v === false || v === null || v === undefined);
};

const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `value` with everything it shares with `blank` taken out, or undefined when
 * nothing is left. A field the blank character does not have is kept whole:
 * it is something the app added (a roll snapshot, the change history).
 */
function trim(value, blank) {
  if (blank === undefined) return value;
  if (same(value, blank)) return undefined;
  if (!plain(value) || !plain(blank)) return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    const kept = trim(inner, blank[key]);
    if (kept !== undefined) out[key] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Empty shapes out: a list with nothing in it, a map with no keys, and
 * anything left holding only those. The app makes them as it goes - opening
 * the casting panel writes `magic: { Wizard: { known: [] } }` - and they say
 * no more than leaving them out does. A list with a gap in it (an empty weapon
 * slot) is not empty: the gap is the point.
 */
function strip(value) {
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (!plain(value)) return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    const kept = strip(inner);
    if (kept !== undefined) out[key] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The modules a packed sheet turned out to need. */
export function modulesIn(packed) {
  return SHEET_MODULES.filter((m) => m.fields.some((f) => packed[f] !== undefined)).map((m) => m.key);
}

/**
 * The sheet as it is written down: what this character uses, and a list of the
 * parts it is made of. Everything a new character would have anyway is left
 * out, because filling puts it back.
 */
export function packCharacter(character, rules) {
  const blank = blankCharacter(rules);
  const out = {};
  for (const [key, value] of Object.entries(character || {})) {
    if (value === undefined || key === 'modules') continue;
    if (key === 'skills') {
      const rows = (value || []).filter((row) => !emptySkill(row));
      if (rows.length) out.skills = rows;
      continue;
    }
    const kept = strip(trim(value, blank[key]));
    if (kept !== undefined) out[key] = kept;
  }
  for (const key of ALWAYS) if (character?.[key] !== undefined && out[key] === undefined) out[key] = character[key];
  out.modules = modulesIn(out);
  return out;
}

/** Every skill the rules offer, in their order, wearing whatever the file kept. */
function fillSkills(stored, blank) {
  const key = (row) => `${String(row?.name || '').toLowerCase()}|${String(row?.subtype || '').toLowerCase()}`;
  const kept = new Map((Array.isArray(stored) ? stored : []).map((row) => [key(row), row]));
  const rows = blank.map((row) => {
    const mine = kept.get(key(row));
    kept.delete(key(row));
    return mine ? { ...row, ...mine } : { ...row };
  });
  // A skill with a subject of its own - Craft (bowmaking) - is the player's own row.
  return [...rows, ...kept.values()];
}

/** Deep fill: what the file kept, over what a new character has. */
function fill(stored, blank) {
  if (stored === undefined || stored === null) return blank;
  if (!plain(blank)) return stored;
  if (!plain(stored)) return blank;
  const out = { ...blank, ...stored };
  for (const [key, value] of Object.entries(blank)) {
    if (plain(value)) out[key] = fill(stored[key], value);
  }
  return out;
}

/**
 * A packed sheet, whole again: every part a character has, whether this one
 * uses it or not. An older file, which kept everything, comes through
 * unchanged - what it says wins over what a new character would have.
 */
export function fillCharacter(stored, rules) {
  const blank = blankCharacter(rules);
  const filled = fill(stored || {}, blank);
  filled.skills = fillSkills(stored?.skills, blank.skills);
  if (!Array.isArray(filled.levels) || !filled.levels.length) filled.levels = blank.levels;
  for (const [key, value] of Object.entries(blank)) {
    if (Array.isArray(value) && !Array.isArray(filled[key])) filled[key] = value;
  }
  delete filled.modules;
  return filled;
}
