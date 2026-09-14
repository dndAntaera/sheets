// Player-written content, and how it reaches the arithmetic.
//
// Seven kinds of thing can be written by hand - a race, a class, a feat, a
// skill, an item, a template, a class feature - and each is described here once,
// as data. One editor in the interface renders all seven from these
// descriptions, and one code path in the engine consumes them, so adding an
// eighth kind later is a change in this file rather than a change everywhere.
//
// Where content lives, and why in two places:
//
//   the LIBRARY   kept in the browser, shared across all your characters. This
//                 is your shelf: write the Warblade once and use it on three
//                 characters.
//
//   the CHARACTER a copy of everything this particular sheet actually uses,
//                 embedded in the sheet itself, under `content`.
//
// The engine reads only the embedded copy. That is what makes an exported sheet
// whole: hand the file to your DM, or to somebody with an empty library, and
// the character still adds up, because the Warblade travelled with it. The
// alternative - a sheet that points at content it does not carry - is a sheet
// that quietly breaks the moment it leaves the browser it was made in.

/** The bonus types an effect may claim, for the editor's dropdown. */
export const BONUS_TYPES = [
  'untyped', 'alchemical', 'armor', 'circumstance', 'competence', 'deflection',
  'dodge', 'enhancement', 'inherent', 'insight', 'luck', 'morale', 'natural',
  'profane', 'racial', 'resistance', 'sacred', 'shield', 'size',
];

const PROGRESSIONS = [['good', 'good (+1 per level)'], ['average', 'average (+3/4)'], ['poor', 'poor (+1/2)']];
const SAVE_PROGRESSIONS = [['good', 'good'], ['poor', 'poor']];
const ABILITIES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];

/**
 * The seven kinds of content.
 *
 * `fields` is what the editor draws. `effects: true` means entries of this kind
 * can carry effects, which is what gives them a say in the numbers.
 */
export const CONTENT_TYPES = {
  race: {
    key: 'race',
    plural: 'races',
    label: 'Race',
    blurb: 'A race or species. Ability adjustments, size and speed feed the sheet directly; everything else is an effect.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'size', label: 'Size', type: 'size' },
      { key: 'speed', label: 'Speed', type: 'int' },
      { key: 'la', label: 'Level adjustment', type: 'int' },
      { key: 'racialHD', label: 'Racial hit dice', type: 'int' },
      { key: 'racialHDType', label: 'Racial hit die', type: 'int', hint: 'The die, as a number: 8 for d8.' },
      { key: 'abilityAdjust', label: 'Ability adjustments', type: 'abilities' },
      { key: 'favoredClass', label: 'Favored class', type: 'text' },
      { key: 'traits', label: 'Traits', type: 'textarea', wide: true,
        hint: 'Darkvision, immunities, anything the sheet cannot count. Add the countable parts as effects below.' },
    ],
  },

  class: {
    key: 'class',
    plural: 'classes',
    label: 'Class',
    blurb: 'A base or prestige class. Once entered it counts exactly like a printed one: hit die, attack progression, saves, skill points and class skills all feed the totals.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'hd', label: 'Hit die', type: 'int', hint: 'As a number: 8 for d8.' },
      { key: 'bab', label: 'Attack progression', type: 'select', options: PROGRESSIONS },
      { key: 'saves.fort', label: 'Fortitude', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'saves.ref', label: 'Reflex', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'saves.will', label: 'Will', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'skillPoints', label: 'Skill points', type: 'int', hint: 'Before Intelligence.' },
      { key: 'prestige', label: 'Prestige class', type: 'bool' },
      { key: 'classSkills', label: 'Class skills', type: 'list', wide: true,
        hint: 'Comma separated. A bare "Knowledge" makes every Knowledge a class skill.' },
      { key: 'casting.ability', label: 'Casting ability', type: 'select', options: [['', 'none'], ...ABILITIES],
        hint: 'Set this and the sheet works out spell save DCs and bonus slots.' },
      { key: 'features', label: 'Class features', type: 'textarea', wide: true },
    ],
  },

  feat: {
    key: 'feat',
    plural: 'feats',
    label: 'Feat',
    blurb: 'A feat. Give it effects and taking it changes the sheet; leave them off and it is a line of text, which is all most feats need.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'category', label: 'Type', type: 'text', hint: 'General, Combat, Metamagic, Item Creation ...' },
      { key: 'prerequisites', label: 'Prerequisites', type: 'text', wide: true },
      { key: 'uses', label: 'Uses per day', type: 'int', hint: 'Leave empty unless it can be used only so many times. A sheet taking it tracks the uses.' },
      { key: 'usesPer', label: 'Uses reset', type: 'select', options: [['day', 'each day'], ['week', 'each week']] },
      { key: 'benefit', label: 'Benefit', type: 'textarea', wide: true },
    ],
  },

  skill: {
    key: 'skill',
    plural: 'skills',
    label: 'Skill',
    blurb: 'A skill the edition does not have. It joins the skill table, with its own key ability and rank costs.',
    effects: false,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'ability', label: 'Key ability', type: 'select', options: [['', 'none'], ...ABILITIES] },
      { key: 'trainedOnly', label: 'Trained only', type: 'bool' },
      { key: 'acp', label: 'Armor check penalty applies', type: 'bool' },
      { key: 'subtype', label: 'Taken per subject', type: 'bool', hint: 'As Craft and Knowledge are.' },
      { key: 'description', label: 'What it does', type: 'textarea', wide: true },
    ],
  },

  item: {
    key: 'item',
    plural: 'items',
    label: 'Item',
    blurb: 'A piece of equipment. Effects apply while it is equipped, and stop when it is not.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'slot', label: 'Slot', type: 'text', hint: 'Ring, cloak, held ...' },
      { key: 'value', label: 'Value in gp', type: 'int' },
      { key: 'weight', label: 'Weight', type: 'int' },
      { key: 'uses', label: 'Uses or charges per day', type: 'int', hint: 'For an item usable only so many times a day.' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
  },

  template: {
    key: 'template',
    plural: 'templates',
    label: 'Template',
    blurb: 'Something applied on top of a race - half-dragon, lycanthrope, a homebrew curse.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'la', label: 'Level adjustment', type: 'int' },
      { key: 'abilityAdjust', label: 'Ability adjustments', type: 'abilities' },
      { key: 'traits', label: 'What it grants', type: 'textarea', wide: true },
    ],
  },

  feature: {
    key: 'feature',
    plural: 'features',
    label: 'Feature',
    blurb: 'Anything else a character has: a class feature, a boon, a bloodline, a curse. The catch-all, so nothing is unrepresentable.',
    effects: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'from', label: 'Where it comes from', type: 'text', hint: 'A class, a story, a deity ...' },
      { key: 'uses', label: 'Uses per day', type: 'int', hint: 'Leave empty unless it can be used only so many times.' },
      { key: 'usesPer', label: 'Uses reset', type: 'select', options: [['day', 'each day'], ['week', 'each week']] },
      { key: 'description', label: 'What it does', type: 'textarea', wide: true },
    ],
  },
};

export const CONTENT_KINDS = Object.keys(CONTENT_TYPES);

/** An empty entry of one kind, ready for the editor. */
export function blankEntry(kind) {
  const type = CONTENT_TYPES[kind];
  if (!type) throw new Error(`no such content kind: ${kind}`);
  const entry = { kind, name: '', custom: true };
  for (const field of type.fields) {
    const value = field.type === 'bool' ? false
      : field.type === 'int' ? 0
        : field.type === 'list' ? []
          : field.type === 'abilities' ? {}
            : '';
    setDeep(entry, field.key, value);
  }
  if (type.effects) entry.effects = [];
  if (kind === 'class') entry.saves = { fort: 'poor', ref: 'poor', will: 'poor' };
  if (kind === 'race') entry.size = 'Medium';
  return entry;
}

function setDeep(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  if (node[last] === undefined) node[last] = value;
}

/** An empty library: one list per kind. */
export function blankLibrary() {
  return Object.fromEntries(CONTENT_KINDS.map((kind) => [CONTENT_TYPES[kind].plural, []]));
}

/**
 * The content available to one character: what ships with the app, plus what
 * the character carries. The character's own entries win on a name clash, so a
 * table that has rewritten the Bard gets its Bard.
 */
export function contentIndex(rules, character) {
  const content = character?.content || {};
  const index = {};

  index.classByName = new Map(rules.classes.classes.map((c) => [c.name, c]));
  for (const c of content.classes || []) if (c.name) index.classByName.set(c.name, { ...c, custom: true });
  // Sheets made before the library existed kept their classes here.
  for (const c of character?.customClasses || []) if (c.name) index.classByName.set(c.name, { ...c, custom: true });

  index.raceByName = new Map((rules.races?.races || []).map((r) => [r.name, r]));
  for (const r of content.races || []) if (r.name) index.raceByName.set(r.name, { ...r, custom: true });

  index.skills = [...rules.skills.skills];
  for (const s of content.skills || []) {
    if (!s.name) continue;
    const at = index.skills.findIndex((x) => x.name === s.name);
    if (at >= 0) index.skills[at] = { ...s, custom: true };
    else index.skills.push({ ...s, custom: true });
  }
  index.skillsByName = new Map(index.skills.map((s) => [s.name, s]));

  index.featByName = new Map((content.feats || []).filter((f) => f.name).map((f) => [f.name, f]));
  // The SRD's feats carry their effects from data/feat-effects.json; a homebrew
  // feat of the same name, carried by the character, wins.
  index.srdFeatEffects = new Map(Object.entries(rules.featEffects?.feats || {}));
  index.featRuleByName = new Map((rules.featRules || []).map((f) => [f.name.toLowerCase(), f]));
  index.itemByName = new Map((content.items || []).filter((i) => i.name).map((i) => [i.name, i]));
  index.templateByName = new Map((content.templates || []).filter((t) => t.name).map((t) => [t.name, t]));
  index.featureByName = new Map((content.features || []).filter((f) => f.name).map((f) => [f.name, f]));

  return index;
}

/**
 * The mechanical facts of a character's race.
 *
 * A race the sheet knows - an SRD race, or one the character carries - supplies
 * its own size, speed, level adjustment and ability adjustments, and the sheet's
 * fields for those are not consulted. A race the sheet does not know is typed in
 * by hand, and then those fields are all there is. This is what stops a dwarf's
 * +2 Constitution being counted once from the race and again from a field a
 * player filled in to match it.
 *
 * Templates stack on top either way: their level adjustment and ability
 * adjustments are added, never substituted.
 */
export function raceFacts(character, index) {
  const typed = character.race || {};
  const known = index.raceByName.get(typed.name);
  const source = known || typed;
  const num = (v, d = 0) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));

  const abilityAdjust = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const key of Object.keys(abilityAdjust)) {
    abilityAdjust[key] = num(source.abilityAdjust?.[key]);
    for (const template of character.templates || []) {
      const t = index.templateByName.get(template.name) || template;
      abilityAdjust[key] += num(t.abilityAdjust?.[key]);
    }
  }

  const templateLA = (character.templates || []).reduce((total, template) => {
    const t = index.templateByName.get(template.name) || template;
    return total + num(t.la);
  }, 0);

  return {
    known: Boolean(known),
    name: typed.name || '',
    size: source.size || 'Medium',
    speed: num(source.speed, 30),
    la: num(source.la) + templateLA,
    racialHD: num(source.racialHD),
    racialHDType: num(source.racialHDType),
    abilityAdjust,
    favoredClass: source.favoredClass || '',
    traits: source.traits || '',
  };
}

/**
 * The things on this character that can carry effects, resolved to objects.
 *
 * A row on the sheet may carry its own effects, or name a piece of content that
 * does. Both work, and a row that does both gets both - a +1 ring someone has
 * also written a note on is still a +1 ring.
 */
export function resolveEntries(character, index, granted = []) {
  const race = index.raceByName.get(character.race?.name);
  const raceEntry = race || (character.race?.name ? { name: character.race.name } : null);

  const withContent = (rows, lookup, kind) => (rows || [])
    .filter((row) => row && (row.name || (row.effects || []).length))
    .map((row) => {
      const entry = lookup.get(row.name);
      const effects = [...(entry?.effects || []), ...(row.effects || [])];
      return { ...entry, ...row, kind, effects };
    });

  // Feats: the character's own content first, then what the SRD feat does -
  // with its choice filled in, again for each further time it is taken, and
  // Psionic Body's hit points for every psionic feat held. Feats a class grants
  // count as held.
  const featRows = [...granted.map((g) => ({ ...g, granted: true })), ...(character.feats || [])];
  const psionicFeats = featRows.filter((f) => f?.name && (index.featRuleByName?.get(f.name.toLowerCase())?.types || []).includes('Psionic')).length;
  const copies = new Map();
  const feats = withContent(featRows, index.featByName, 'feat').map((row) => {
    if (index.featByName.has(row.name)) return row;
    const srd = index.srdFeatEffects?.get(row.name);
    if (!srd) return row;
    const n = copies.get(row.name) || 0;
    copies.set(row.name, n + 1);
    const filled = fillChoice(srd, row.choice);
    const effects = filled.effects.map((e) => ({
      ...e,
      value: toNumber(e.value) * (e.perPsionicFeat ? psionicFeats : 1) + toNumber(e.perCopy) * n,
    }));
    return { ...row, effects: [...effects, ...(row.effects || [])], notes: filled.notes };
  });

  return {
    race: raceEntry
      ? { ...raceEntry, effects: [...(race?.effects || []), ...(character.race?.effects || [])] }
      : null,
    templates: withContent(character.templates, index.templateByName, 'template'),
    feats,
    features: withContent(character.features, index.featureByName, 'feature'),
    items: withContent(character.wealth?.items, index.itemByName, 'item'),
  };
}

/** Fill `{choice}` in an entry's effects and notes; drop what names a choice not made. */
function fillChoice(entry, choice) {
  const chosen = String(choice || '').trim();
  const fill = (text) => String(text).replace(/\{choice\}/g, chosen);
  const effects = (entry.effects || [])
    .filter((e) => !String(e.target).includes('{choice}') || chosen)
    .map((e) => {
      const target = fill(e.target);
      return { ...e, target: target.startsWith('weapon.') ? target.toLowerCase() : target };
    });
  const notes = (entry.notes || []).filter((n) => !n.includes('{choice}') || chosen).map(fill);
  return { effects, notes };
}

const toNumber = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));

/**
 * Copy a library entry onto a character, so the sheet carries what it uses.
 * Called when a player picks something from their shelf.
 */
export function embed(character, kind, entry) {
  const plural = CONTENT_TYPES[kind].plural;
  character.content = character.content || {};
  const list = character.content[plural] = character.content[plural] || [];
  const at = list.findIndex((e) => e.name === entry.name);
  const copy = structuredClone(entry);
  if (at >= 0) list[at] = copy;
  else list.push(copy);
  return copy;
}

/**
 * The homebrew that counts for a character, and what it carries that does not.
 *
 *   independent   everything it carries: its player's own homebrew, embedded
 *   in a campaign the campaign's homebrew, which its GMs write, always - and
 *                 the player's own only if the campaign allows homebrew
 *
 * A campaign's entries are taken from the campaign's library when the app has
 * it (`rules.campaign.content`), not from the copy on the sheet, so what counts
 * is what the GMs wrote, however the sheet's copy was edited. Without the
 * library - offline - the sheet's copies of campaign entries stand in.
 *
 * Nothing is removed from the sheet: an entry that does not count here is kept,
 * listed in `blocked`, and counts again if the character leaves the campaign or
 * the GMs allow homebrew.
 *
 * @returns { content, blocked: [{ kind, name }], campaignNames: Set }
 */
export function usableContent(character, rules) {
  const carried = character?.content || {};
  const campaign = rules?.campaign;
  if (!campaign) return { content: carried, blocked: [], campaignNames: new Set() };

  const fromLibrary = Array.isArray(campaign.content);
  const content = {};
  const blocked = [];
  const campaignNames = new Set();

  for (const kind of CONTENT_KINDS) {
    const plural = CONTENT_TYPES[kind].plural;
    const own = (carried[plural] || []).filter((e) => e && e.name);
    const theirs = fromLibrary
      ? campaign.content.filter((e) => e && e.kind === kind && e.name)
      : own.filter((e) => e.campaign === campaign.id);
    const names = new Set(theirs.map((e) => e.name));
    names.forEach((n) => campaignNames.add(n));

    const rest = own.filter((e) => !names.has(e.name) && e.campaign !== campaign.id);
    if (campaign.allowHomebrew) {
      content[plural] = [...rest, ...theirs];
    } else {
      content[plural] = theirs;
      for (const e of rest) blocked.push({ kind, name: e.name });
    }
  }
  return { content, blocked, campaignNames };
}

/** Content the character carries that nothing on the sheet refers to. */
export function unusedContent(character) {
  const content = character.content || {};
  const used = new Set([
    character.race?.name,
    ...(character.levels || []).flatMap((l) => [l.a, l.b]),
    ...(character.feats || []).map((f) => f.name),
    ...(character.features || []).map((f) => f.name),
    ...(character.templates || []).map((t) => t.name),
    ...(character.wealth?.items || []).map((i) => i.name),
    ...(character.skills || []).map((s) => s.name),
  ].filter(Boolean));

  const out = [];
  for (const kind of CONTENT_KINDS) {
    for (const entry of content[CONTENT_TYPES[kind].plural] || []) {
      if (entry.name && !used.has(entry.name)) out.push({ kind, name: entry.name });
    }
  }
  return out;
}

