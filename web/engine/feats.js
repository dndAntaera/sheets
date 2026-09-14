// Feats: which a character may take, where each one goes, and what the class
// and race hand out for free.
//
// Every feat has a SLOT - the feat every character gets at 1st level and every
// third level, a human's bonus feat, a fighter's bonus feat, one bought with a
// flaw - and a slot can restrict what goes in it. A fighter's bonus feat must
// be a fighter bonus feat; a monk's 2nd-level feat is Combat Reflexes or
// Deflect Arrows, prerequisites or no.
//
// A feat is legal in a slot when its prerequisites are met AT THAT LEVEL: the
// base attack bonus, caster level, class levels and ability scores the
// character had then, and the feats taken before it. The prerequisites are
// read from the SRD's own words (data/srd/feat-rules.json). What cannot be read
// as a rule is reported as unchecked rather than guessed at.
//
// Pure: no DOM, no fetch.

import { buildSummary } from './build.js';
import { ABILITIES } from './abilities.js';
import { num } from './util.js';

const ABILITY_WORDS = {
  str: 'str', strength: 'str', dex: 'dex', dexterity: 'dex', con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int', wis: 'wis', wisdom: 'wis', cha: 'cha', charisma: 'cha',
};

const lower = (s) => String(s || '').trim().toLowerCase();

/** "Weapon Focus" and "longsword" -> "Weapon Focus (longsword)". */
export const featLabel = (name, choice) => (choice ? `${name} (${choice})` : name);

/** The feat rules as a map by lowercase name. */
export function featRuleIndex(rules) {
  if (rules._featRuleIndex) return rules._featRuleIndex;
  const map = new Map((rules.featRules || []).map((f) => [lower(f.name), f]));
  Object.defineProperty(rules, '_featRuleIndex', { value: map, enumerable: false });
  return map;
}

/* ==========================================================================
   Prerequisites, read from the SRD's words
   ========================================================================== */

/**
 * "Str 13, Power Attack, base attack bonus +1." -> clauses:
 *
 *   { kind: 'ability', ability: 'str', min: 13 }
 *   { kind: 'bab', min: 1 }
 *   { kind: 'baseSave', save: 'will', min: 2 }
 *   { kind: 'casterLevel' | 'manifesterLevel' | 'characterLevel', min }
 *   { kind: 'classLevel', className, min }
 *   { kind: 'skill', skill, ranks }
 *   { kind: 'castSpells', level, type }
 *   { kind: 'feat', name, choice?, sameChoice? }
 *   { kind: 'featType', type }             "any other metamagic feat"
 *   { kind: 'feature', feature }           turning, wild shape, bardic music, rage, a familiar
 *   { kind: 'powerPoints' }                "having a power point reserve"
 *   { kind: 'alignment', component }
 *   { kind: 'size', min }
 *   { kind: 'creature' }                   natural weapons, fly speed: not a character's
 *   { kind: 'met' }                        proficiency with the weapon chosen, and the like
 *   { kind: 'unknown' }
 *
 * Every clause keeps its `text`.
 */
const parsed = new Map();

export function parsePrerequisites(text, featRules = new Map()) {
  const clean = String(text || '').trim().replace(/\.$/, '');
  if (!clean || /^none$/i.test(clean)) return [];
  // The same words always read the same way, and a dropdown asks about hundreds of feats.
  const cacheKey = `${featRules.size}|${clean}`;
  if (parsed.has(cacheKey)) return parsed.get(cacheKey);
  const parts = clean.split(/,\s*(?![^()]*\))|;\s*/).map((p) => p.trim()).filter(Boolean);
  const clauses = parts.map((part) => ({ text: part, ...readClause(part, featRules) }));
  parsed.set(cacheKey, clauses);
  return clauses;
}

function readClause(part, featRules) {
  const t = part.replace(/\s+/g, ' ').trim();
  const l = t.toLowerCase();
  let m;

  if ((m = l.match(/^(str|dex|con|int|wis|cha|strength|dexterity|constitution|intelligence|wisdom|charisma) (\d+)$/))) {
    return { kind: 'ability', ability: ABILITY_WORDS[m[1]], min: Number(m[2]) };
  }
  if ((m = l.match(/^base attack bonus \+(\d+)/))) return { kind: 'bab', min: Number(m[1]) };
  if ((m = l.match(/^base (fort|fortitude|ref|reflex|will) save bonus \+(\d+)/))) {
    return { kind: 'baseSave', save: { fortitude: 'fort', reflex: 'ref' }[m[1]] || m[1], min: Number(m[2]) };
  }
  if ((m = l.match(/^caster level (\d+)/))) return { kind: 'casterLevel', min: Number(m[1]) };
  if ((m = l.match(/^manifester level (\d+)/))) return { kind: 'manifesterLevel', min: Number(m[1]) };
  if ((m = l.match(/^character level (\d+)/)) || (m = l.match(/at least (\d+)(?:st|nd|rd|th) level/))) {
    return { kind: 'characterLevel', min: Number(m[1]) };
  }
  if ((m = l.match(/^([a-z][a-z ]*?) level (\d+)(?:st|nd|rd|th)?$/))) {
    return { kind: 'classLevel', className: titleCase(m[1]), min: Number(m[2]) };
  }
  if ((m = t.match(/^(.+?) (\d+) ranks?$/i))) {
    const skill = m[1].replace(/\s*\(\s*/, ' (').replace(/\s*\)\s*$/, ')').trim();
    return { kind: 'skill', skill, ranks: Number(m[2]) };
  }
  if ((m = l.match(/ability to cast (\d+)(?:st|nd|rd|th)-level (arcane or divine |arcane |divine )?spells/))) {
    return { kind: 'castSpells', level: Number(m[1]), type: (m[2] || '').trim().replace('arcane or divine', '') || null };
  }
  if (/turn or rebuke|turn undead|rebuke undead/.test(l)) return { kind: 'feature', feature: 'turn' };
  if (/wild shape/.test(l)) return { kind: 'feature', feature: 'wild shape' };
  if (/^bardic music/.test(l)) return { kind: 'feature', feature: 'bardic music' };
  if ((m = l.match(/^rage (\d+)\/day/))) return { kind: 'feature', feature: 'rage', uses: Number(m[1]) };
  if (/acquire a new familiar/.test(l)) return { kind: 'feature', feature: 'familiar' };
  if ((m = l.match(/^(chaotic|lawful|good|evil) alignment/))) return { kind: 'alignment', component: m[1] };
  if (/power point reserve/.test(l)) return { kind: 'powerPoints' };
  if (/proficiency with selected weapon|proficient with weapon|weapon proficiency \(crossbow type chosen\)|compatible alignment/.test(l)) {
    return { kind: 'met' };
  }
  if ((m = l.match(/^any other (metamagic|metapsionic) feat/))) return { kind: 'featType', type: titleCase(m[1]) };
  if ((m = l.match(/^size (large|huge|gargantuan|colossal) or larger/))) return { kind: 'size', min: titleCase(m[1]) };
  if (/natural (armor|weapon|attack)|fly speed|three or more|special attack|spell-like ability|^multiattack$/.test(l)) {
    return { kind: 'creature' };
  }

  // A feat, maybe on a choice: "Weapon Focus with selected weapon", "Spell Focus (conjuration)".
  if ((m = t.match(/^(.+?) with selected weapon$/i)) || (m = t.match(/^(.+?) \(chosen weapon\)$/i))) {
    const rule = featRules.get(lower(m[1]));
    if (rule) return { kind: 'feat', name: rule.name, sameChoice: true };
  }
  const exact = featRules.get(l);
  if (exact) return { kind: 'feat', name: exact.name };
  if ((m = t.match(/^(.+?)\s*\((.+)\)$/))) {
    const rule = featRules.get(lower(m[1]));
    if (rule) return { kind: 'feat', name: rule.name, choice: m[2] };
  }
  return { kind: 'unknown' };
}

const titleCase = (s) => String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ==========================================================================
   The character as it stood at a level
   ========================================================================== */

const SIZES = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];

/**
 * What prerequisites are measured against, for a character at one of its
 * levels. Levels after it are left off; ability increases after it too.
 *
 * @param derived  the whole character's derived sheet
 * @param level    a character level, 1 up
 * @param feats    the feats (as { name, choice }) held before this one
 */
export function stateAtLevel(character, derived, rules, level, feats = []) {
  const levels = (character.levels || []).slice(0, Math.max(1, level));
  const at = { ...character, levels };
  const summary = buildSummary(at, rules, derived.gestalt, derived.index);
  const hd = summary.hitDiceCount;

  // Scores: everything but temporary changes, less the increases not yet earned.
  const later = {};
  for (const [lvl, key] of Object.entries(character.abilities?.levelUps || {})) {
    if (Number(lvl) > hd && ABILITIES.includes(key)) later[key] = (later[key] || 0) + 1;
  }
  const scores = Object.fromEntries(ABILITIES.map((k) => [k, (derived.abilities[k]?.baseTotal ?? 10) - (later[k] || 0)]));

  // Class levels, the better side's under gestalt.
  const classLevels = {};
  for (const side of summary.sides) {
    for (const c of side.classes) classLevels[c.name] = Math.max(classLevels[c.name] || 0, c.levels);
  }

  let casterLevel = 0;
  let manifesterLevel = 0;
  let castSpells = { arcane: -1, divine: -1 };
  const features = new Set();
  for (const side of summary.sides) {
    for (const c of side.classes) {
      const def = c.def || {};
      if (def.casting?.ability) {
        const cl = def.casting.half ? (c.levels >= 4 ? Math.floor(c.levels / 2) : 0) : c.levels;
        casterLevel = Math.max(casterLevel, cl);
        const row = rules.progression?.[c.name]?.slots?.[c.levels - 1] || [];
        const score = scores[def.casting.ability];
        let highest = -1;
        row.forEach((v, L) => { if (v !== null && v !== undefined && score >= 10 + L) highest = L; });
        const type = def.casting.type === 'divine' ? 'divine' : 'arcane';
        castSpells[type] = Math.max(castSpells[type], highest);
      }
      if (def.manifesting?.ability) manifesterLevel = Math.max(manifesterLevel, c.levels);
      const specials = (rules.progression?.[c.name]?.special || []).slice(0, c.levels).join(', ').toLowerCase();
      if (/turn or rebuke|turn undead/.test(specials)) features.add('turn');
      if (/wild shape/.test(specials)) features.add('wild shape');
      if (/bardic music/.test(specials)) features.add('bardic music');
      if (/familiar/.test(specials)) features.add('familiar');
      const rage = [...specials.matchAll(/rage (\d+)\/day/g)].map((x) => Number(x[1]));
      if (rage.length) features.add(`rage:${Math.max(...rage)}`);
    }
  }

  const skillRanks = new Map();
  for (const line of derived.skills?.lines || []) {
    const ranks = Math.min(num(line.ranks), hd + 3);
    for (const key of [lower(line.label), lower(line.name)]) skillRanks.set(key, Math.max(skillRanks.get(key) || 0, ranks));
  }

  const powerFeats = feats.filter((f) => /^(wild talent|psionic talent)$/i.test(f.name)).length;
  return {
    level,
    hitDice: hd,
    characterLevel: hd,
    bab: summary.bab,
    baseSaves: summary.baseSaves,
    scores,
    classLevels,
    casterLevel,
    manifesterLevel,
    castSpells,
    features,
    skillRanks,
    feats,
    powerPoints: manifesterLevel > 0 || powerFeats > 0,
    alignment: String(character.concept?.alignment || '').toUpperCase(),
    size: derived.race?.size || 'Medium',
  };
}

/* ==========================================================================
   Eligibility
   ========================================================================== */

/**
 * Whether a character in `state` may take a feat.
 *
 * @param rule   the feat's entry in feat-rules.json (or a homebrew feat)
 * @param opts   { choice, ignorePrerequisites }
 * @returns { ok, unmet: [text], unchecked: [text] }
 */
export function featEligibility(rule, state, featRules, opts = {}) {
  const unmet = [];
  const unchecked = [];
  if (!rule) return { ok: true, unmet, unchecked };
  if (opts.ignorePrerequisites) return { ok: true, unmet, unchecked };
  if ((rule.types || []).includes('Epic') && state.characterLevel < 21) unmet.push('21st level (an epic feat)');

  const held = (name, choice) => state.feats.some((f) => lower(f.name) === lower(name) && (choice === undefined || lower(f.choice) === lower(choice)));
  const text = rule.prerequisite || rule.prerequisites || '';
  for (const clause of parsePrerequisites(text, featRules)) {
    const ok = clauseMet(clause, state, rule, opts, held);
    if (ok === null) unchecked.push(clause.text);
    else if (!ok) unmet.push(clause.text);
  }
  return { ok: unmet.length === 0, unmet, unchecked };
}

function clauseMet(clause, s, rule, opts, held) {
  switch (clause.kind) {
    case 'ability': return (s.scores[clause.ability] ?? 0) >= clause.min;
    case 'bab': return s.bab >= clause.min;
    case 'baseSave': return (s.baseSaves?.[clause.save] ?? 0) >= clause.min;
    case 'casterLevel': return s.casterLevel >= clause.min;
    case 'manifesterLevel': return s.manifesterLevel >= clause.min;
    case 'characterLevel': return s.characterLevel >= clause.min;
    case 'classLevel': return (s.classLevels[clause.className] || 0) >= clause.min;
    case 'skill': return (s.skillRanks.get(lower(clause.skill)) || s.skillRanks.get(lower(clause.skill.replace(/\s*\(.*\)$/, ''))) || 0) >= clause.ranks;
    case 'castSpells': {
      const best = clause.type ? s.castSpells[clause.type] : Math.max(s.castSpells.arcane, s.castSpells.divine);
      return best >= clause.level;
    }
    case 'feature':
      if (clause.feature === 'rage') return [...s.features].some((f) => f.startsWith('rage:') && Number(f.slice(5)) >= clause.uses);
      return s.features.has(clause.feature);
    case 'powerPoints': return s.powerPoints;
    case 'alignment': {
      const a = s.alignment;
      if (!a) return false;
      const letter = { lawful: 'L', chaotic: 'C', good: 'G', evil: 'E' }[clause.component];
      return a.includes(letter);
    }
    case 'size': return SIZES.indexOf(s.size) >= SIZES.indexOf(clause.min);
    case 'creature': return false;
    case 'met': return true;
    case 'featType': return s.feats.some((f) => lower(f.name) !== lower(rule.name) && (f.types || []).includes(clause.type));
    case 'feat':
      if (clause.sameChoice) return opts.choice ? held(clause.name, opts.choice) : held(clause.name);
      if (clause.choice) return held(clause.name, clause.choice) || held(clause.name);
      return held(clause.name);
    default: return null;
  }
}

/* ==========================================================================
   Slots
   ========================================================================== */

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

/** Which feats may fill a class's bonus feat slot, by the class's named list. */
export function onBonusList(list, rule) {
  if (!rule) return false;
  const types = rule.types || [];
  switch (list) {
    case 'fighter': return Boolean(rule.fighterBonus);
    case 'wizard': return types.includes('Metamagic') || types.includes('Item Creation') || rule.name === 'Spell Mastery';
    case 'psion': return types.includes('Psionic') || types.includes('Metapsionic') || (types.includes('Item Creation') && PSIONIC_ITEM_CREATION.has(rule.name));
    case 'psychicWarrior': return Boolean(rule.fighterBonus) || types.includes('Psionic');
    default: return true;
  }
}

const PSIONIC_ITEM_CREATION = new Set([
  'Craft Cognizance Crystal', 'Craft Dorje', 'Craft Psicrown', 'Craft Psionic Arms and Armor',
  'Craft Psionic Construct', 'Craft Universal Item', 'Imprint Stone', 'Scribe Tattoo',
]);

const LIST_LABELS = {
  fighter: 'a fighter bonus feat',
  wizard: 'a metamagic or item creation feat, or Spell Mastery',
  psion: 'a psionic, metapsionic or psionic item creation feat',
  psychicWarrior: 'a fighter bonus feat or a psionic feat',
};

/**
 * Every feat slot the character has, in the order they were gained.
 *
 * @returns {
 *   slots:   [{ id, level, kind, label, list?, options?, ignorePrerequisites?, className? }]
 *   granted: [{ name, choice?, level, source }]   feats a class gives, which fill no slot
 * }
 */
export function featSlots(character, derived, rules, opts = {}) {
  const slots = [];
  const granted = [];
  const summary = derived.summary;
  const racialHD = summary.racialHD || 0;
  const hd = summary.hitDiceCount;

  // Every character: one at 1st and every third hit die.
  for (let n = 1; n <= hd; n++) {
    if (n === 1 || n % 3 === 0) {
      slots.push({ id: `level:${n}`, level: Math.max(1, n - racialHD), kind: 'general', label: n === 1 ? '1st-level feat' : `${ordinal(n)}-level feat` });
    }
  }

  // A race's bonus feats (a human's), and any a player was granted by hand.
  const raceBonus = Math.max(0, num(opts.raceBonus));
  for (let i = 0; i < raceBonus; i++) {
    slots.push({ id: `race:${i}`, level: 1, kind: 'general', label: `${derived.race?.name || 'Racial'} bonus feat` });
  }

  // A class's bonus feats, as each class level is reached.
  const counts = { a: {}, b: {} };
  const sides = derived.gestalt ? ['a', 'b'] : ['a'];
  (character.levels || []).forEach((row, i) => {
    for (const side of sides) {
      const name = row[side];
      if (!name) continue;
      counts[side][name] = (counts[side][name] || 0) + 1;
      const classLevel = counts[side][name];
      const def = derived.index.classByName.get(name);
      const bonus = def?.bonusFeats;
      if (bonus?.levels?.includes(classLevel)) {
        slots.push({
          id: `class:${name}:${classLevel}`, level: i + 1, kind: 'class', className: name, list: bonus.list,
          label: `${name} bonus feat (${ordinal(classLevel)} level)`, listLabel: LIST_LABELS[bonus.list] || null,
        });
      }
      const options = bonus?.choices?.[String(classLevel)];
      if (options) {
        slots.push({
          id: `class:${name}:${classLevel}`, level: i + 1, kind: 'class', className: name, options,
          ignorePrerequisites: Boolean(bonus.ignorePrerequisites), samePath: Boolean(bonus.samePath),
          label: `${bonus.label || `${name} bonus feat`} (${ordinal(classLevel)} level)`, listLabel: options.join(' or '),
        });
      }
      for (const g of def?.grantedFeats || []) {
        if (g.level === classLevel) granted.push({ name: g.name, choice: g.choice || null, level: i + 1, source: `${name} ${ordinal(classLevel)} level` });
      }
    }
  });

  // Each flaw buys a feat.
  for (let i = 0; i < num(opts.fromFlaws); i++) slots.push({ id: `flaw:${i}`, level: 1, kind: 'general', label: 'Feat for a flaw' });

  // Anything else a player says they were given.
  for (let i = 0; i < Math.max(0, num(character.featSlots?.bonus)); i++) {
    slots.push({ id: `extra:${i}`, level: Math.max(1, character.levels?.length || 1), kind: 'general', label: 'Other bonus feat' });
  }

  slots.sort((x, y) => x.level - y.level);
  return { slots, granted };
}

/**
 * Which feat row sits in which slot. A row names its slot; rows that do not
 * (older sheets, homebrew typed in) fill the empty slots in order, and what is
 * left over is listed as extra.
 *
 * @returns { bySlot: Map<slotId, rowIndex>, extra: [rowIndex] }
 */
export function assignFeats(slots, feats) {
  const bySlot = new Map();
  const ids = new Set(slots.map((s) => s.id));
  const loose = [];
  (feats || []).forEach((row, i) => {
    if (!row || !row.name) return;
    if (row.slot && ids.has(row.slot) && !bySlot.has(row.slot)) bySlot.set(row.slot, i);
    else loose.push(i);
  });
  const extra = [];
  for (const i of loose) {
    const empty = slots.find((s) => !bySlot.has(s.id) && (s.kind === 'general' || feats[i].slot === s.id));
    if (empty && !feats[i].slot) bySlot.set(empty.id, i);
    else extra.push(i);
  }
  return { bySlot, extra };
}

/**
 * The whole feat picture: slots, what fills each, whether it is legal there,
 * and the feats a class grants.
 *
 * @returns {
 *   slots: [{ ...slot, row, feat, rule, check }],
 *   granted, extra: [{ row, feat }], held: [{ name, choice }]
 * }
 */
export function featPlan(character, derived, rules, opts = {}) {
  const featRules = featRuleIndex(rules);
  const fromSlots = featSlots(character, derived, rules, opts);
  const slots = fromSlots.slots;
  const granted = [...fromSlots.granted, ...(opts.granted || [])];
  const feats = character.feats || [];
  const { bySlot, extra } = assignFeats(slots, feats);
  const withRule = (f) => ({ name: f.name, choice: f.choice || null, types: featRules.get(lower(f.name))?.types || derived.index.featByName?.get(f.name)?.types || [] });

  // Feats held before a slot: granted ones by then, and slots filled earlier.
  const planned = slots.map((slot) => ({ ...slot, row: bySlot.has(slot.id) ? bySlot.get(slot.id) : null }));
  const states = new Map();
  const out = planned.map((slot, n) => {
    const feat = slot.row !== null ? feats[slot.row] : null;
    const before = [
      ...granted.filter((g) => g.level <= slot.level).map(withRule),
      ...planned.slice(0, n).filter((s) => s.row !== null).map((s) => withRule(feats[s.row])),
    ];
    if (!feat) return { ...slot, feat: null, rule: null, check: null, before };
    const rule = featRules.get(lower(feat.name)) || derived.index.featByName?.get(feat.name) || null;
    const key = `${slot.level}:${n}`;
    const state = states.get(key) || stateAtLevel(character, derived, rules, slot.level, before);
    states.set(key, state);
    const check = featEligibility(rule, state, featRules, { choice: feat.choice, ignorePrerequisites: slot.ignorePrerequisites });
    if (slot.options && !slot.options.some((o) => lower(o) === lower(feat.name))) {
      check.ok = false;
      check.unmet.push(`this slot takes ${slot.options.join(' or ')}`);
    } else if (slot.list && rule && !onBonusList(slot.list, rule)) {
      check.ok = false;
      check.unmet.push(`this slot takes ${LIST_LABELS[slot.list] || 'a feat from its list'}`);
    }
    if (!rule) check.unchecked.push('not an SRD feat');
    return { ...slot, feat, rule, check, before };
  });

  const held = [
    ...granted.map((g) => ({ name: g.name, choice: g.choice })),
    ...out.filter((s) => s.feat).map((s) => ({ name: s.feat.name, choice: s.feat.choice || null })),
    ...extra.map((i) => ({ name: feats[i].name, choice: feats[i].choice || null })),
  ];
  return { slots: out, granted, extra: extra.map((i) => ({ row: i, feat: feats[i] })), held };
}

/**
 * The feats that may go in a slot, for its dropdown: legal there, not already
 * held (unless the feat may be taken again), and on the slot's list.
 *
 * @param list  every feat rule, or the homebrew feats too
 * @returns [{ name, rule, check }]
 */
export function featOptions(slot, plan, character, derived, rules, list) {
  const featRules = featRuleIndex(rules);
  const state = stateAtLevel(character, derived, rules, slot.level, slot.before || []);
  const heldNames = new Set(plan.held.map((f) => lower(f.name)));
  const mine = slot.feat ? lower(slot.feat.name) : null;
  let pool = list;
  if (slot.options) pool = list.filter((r) => slot.options.some((o) => lower(o) === lower(r.name)));
  else if (slot.list) pool = list.filter((r) => onBonusList(slot.list, r));

  // A ranger's combat style: the path chosen at 2nd level holds at 6th and 11th.
  if (slot.samePath && slot.options) {
    const first = plan.slots.find((s) => s.className === slot.className && s.samePath && s.id !== slot.id && s.level < slot.level && s.feat);
    if (first) {
      const path = (derived.index.classByName.get(slot.className)?.bonusFeats?.choices?.['2'] || []).findIndex((o) => lower(o) === lower(first.feat.name));
      if (path >= 0) pool = pool.filter((r) => lower(r.name) === lower(slot.options[path]));
    }
  }

  return pool
    .filter((r) => r.multiple || !heldNames.has(lower(r.name)) || lower(r.name) === mine)
    .map((r) => ({ name: r.name, rule: r, check: featEligibility(r, state, featRules, { ignorePrerequisites: slot.ignorePrerequisites }) }))
    .filter((o) => o.check.ok);
}

/** Where the feats and the rules disagree. */
export function featNotices(plan, add) {
  for (const slot of plan.slots) {
    if (!slot.feat || !slot.check) continue;
    const label = featLabel(slot.feat.name, slot.feat.choice);
    if (!slot.check.ok) add('error', `${label} (${slot.label}): ${slot.check.unmet.join('; ')}.`, 'feats');
    if (slot.rule?.choice && !slot.feat.choice) add('info', `${slot.feat.name}: choose what it applies to.`, 'feats');
  }
  const seen = new Map();
  for (const f of plan.held) {
    const key = `${lower(f.name)}|${lower(f.choice)}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count < 2) continue;
    const [name, choice] = key.split('|');
    const rule = plan.slots.find((s) => s.feat && lower(s.feat.name) === name)?.rule;
    if (rule && rule.multiple && (rule.name === 'Toughness' || rule.name === 'Extra Turning' || rule.name === 'Psionic Talent' || !rule.choice)) continue;
    add('warn', `${titleCase(name)}${choice ? ` (${choice})` : ''} is taken ${count} times.`, 'feats');
  }
}

