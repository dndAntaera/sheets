// Class features: what each class level gives, read from the class tables, so
// nobody types "sneak attack +2d6" - and what a cleric's domains give.
//
// Each class's "Special" column (data/srd/progression.json) names what is gained
// at each level. A feature that grows - sneak attack +1d6, +2d6; slow fall 20
// ft., 30 ft.; wild shape (Large) - is one feature with its latest step. A
// feature that names a feat (Scribe Scroll, Track) is left to the feats, which
// grant it; "Bonus feat" is a feat slot. Uses per day are the trackers'.
//
// Some features are numbers, and those reach the sheet as effects: a paladin's
// divine grace, a monk's Armor Class bonus and fast movement, trap sense, and
// the bonuses of a few domains. The rest are listed, with their SRD text, where
// the character's abilities are.
//
// Pure: no DOM, no fetch.

import { num } from './util.js';

const lower = (s) => String(s || '').trim().toLowerCase();

/** Split "Sneak attack +1d6, trapfinding" on commas outside parentheses. */
const splitSpecial = (text) => String(text || '').split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);

/** The name a feature is known by, whatever step of it this is. */
export function featureKey(text) {
  return lower(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\d+(st|nd|rd|th)\s+/, '')
    .replace(/[+-]\s*\d+d\d+/g, ' ')
    .replace(/\+\s*\d+/g, ' ')
    .replace(/\d+\s*\/\s*(day|week)/g, ' ')
    .replace(/\d+\s*\/\s*-/g, ' ')
    .replace(/\d+\s*ft\.?/g, ' ')
    .replace(/any distance/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Domains, in rules: the class skills a domain adds, the feat it grants, what it
 * does to a number, and how often its power can be used.
 */
export const DOMAIN_RULES = {
  Air: { uses: 'turning' },
  Animal: { classSkills: ['Knowledge (nature)'], uses: 1 },
  Artifice: { effects: [{ target: 'skill.Craft', value: 4 }] },
  Charm: { uses: 1 },
  Community: { uses: 1, effects: [{ target: 'skill.Diplomacy', type: 'competence', value: 2 }] },
  Darkness: { feat: 'Blind-Fight' },
  Death: { uses: 1 },
  Destruction: { uses: 1 },
  Earth: { uses: 'turning' },
  Fire: { uses: 'turning' },
  Knowledge: { classSkills: ['Knowledge'] },
  Liberation: { effects: [{ target: 'save.all', type: 'morale', value: 2, condition: 'against enchantment spells and effects' }] },
  Luck: { uses: 1 },
  Madness: { uses: 1 },
  Mind: { effects: [{ target: 'skill.Bluff', value: 2 }, { target: 'skill.Diplomacy', value: 2 }, { target: 'skill.Sense Motive', value: 2 }, { target: 'save.will', value: 2, condition: 'against enchantment spells and effects' }] },
  Nobility: { uses: 1 },
  Plant: { classSkills: ['Knowledge (nature)'], uses: 'turning' },
  Protection: { uses: 1 },
  Repose: { uses: 1 },
  Rune: { feat: 'Scribe Scroll' },
  Scalykind: { uses: 'turning' },
  Strength: { uses: 1 },
  Sun: { uses: 1 },
  Travel: { classSkills: ['Survival'], uses: 'rounds' },
  Trickery: { classSkills: ['Bluff', 'Disguise', 'Hide'] },
  War: { feat: 'Weapon Focus', featChoice: "deity's favored weapon" },
  Water: { uses: 'turning' },
  Weather: { classSkills: ['Survival'] },
};

/** The domains a character has chosen, with the class that chose them. */
export function chosenDomains(character, summary) {
  const out = [];
  const seen = new Set();
  for (const side of summary.sides || []) {
    for (const c of side.classes) {
      if (!c.def?.casting?.domains || seen.has(c.name)) continue;
      seen.add(c.name);
      for (const name of new Set((character.magic?.[c.name]?.domains || []).filter(Boolean))) {
        out.push({ name, className: c.name, classLevels: c.levels });
      }
    }
  }
  return out;
}

/** Class skills the chosen domains add. */
export function domainClassSkills(character, summary) {
  return chosenDomains(character, summary).flatMap((d) => DOMAIN_RULES[d.name]?.classSkills || []);
}

/** Feats the chosen domains grant. */
export function domainFeats(character, summary) {
  return chosenDomains(character, summary)
    .filter((d) => DOMAIN_RULES[d.name]?.feat)
    .map((d) => ({ name: DOMAIN_RULES[d.name].feat, choice: DOMAIN_RULES[d.name].featChoice || null, level: 1, source: `${d.name} domain` }));
}

/**
 * Every class feature the character has, in the order gained.
 *
 * @param featNames  a Set of lowercase SRD feat names, so a feat in the Special
 *                   column is left to the feats
 * @returns [{ key, name, className, gained, latest, steps: [{ level, text }], domain? }]
 */
export function classFeatures(character, summary, rules, featNames = new Set()) {
  const out = [];
  const seen = new Set();
  for (const side of summary.sides || []) {
    for (const c of side.classes) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const specials = rules.progression?.[c.name]?.special || c.def?.progression?.special || [];
      const found = new Map();
      specials.slice(0, c.levels).forEach((text, i) => {
        for (const part of splitSpecial(text)) {
          if (/^bonus feat$/i.test(part)) continue;
          const bare = lower(part.replace(/\s*\([^)]*\)\s*$/, ''));
          if (featNames.has(lower(part)) || featNames.has(bare)) continue;
          const key = featureKey(part);
          if (!key) continue;
          const entry = found.get(key) || { key, name: capitalise(key), className: c.name, gained: i + 1, steps: [] };
          entry.steps.push({ level: i + 1, text: part });
          entry.latest = part;
          found.set(key, entry);
        }
      });
      out.push(...found.values());
    }
  }
  for (const d of chosenDomains(character, summary)) {
    const def = (rules.domains || []).find((x) => x.name === d.name);
    out.push({
      key: `domain:${lower(d.name)}`,
      name: `${d.name} domain`,
      className: d.className,
      gained: 1,
      steps: [{ level: 1, text: def?.grantedPower || '' }],
      latest: def?.grantedPower || '',
      domain: d.name,
      text: def?.grantedPower || '',
    });
  }
  return out;
}

/** Uses of the chosen domains' powers, for the trackers. */
export function domainTrackers(character, summary, abilities) {
  const out = [];
  for (const d of chosenDomains(character, summary)) {
    const uses = DOMAIN_RULES[d.name]?.uses;
    if (!uses) continue;
    const key = `domain:${d.name}`;
    if (uses === 'turning') out.push({ key, name: `${d.name} domain turning`, source: `${d.name} domain`, max: 3 + abilities.cha.mod, per: 'day', turning: true });
    else if (uses === 'rounds') out.push({ key, name: 'Freedom of movement', source: `${d.name} domain`, max: d.classLevels, per: 'day', unit: 'rounds' });
    else out.push({ key, name: `${d.name} domain power`, source: `${d.name} domain`, max: uses, per: 'day' });
  }
  return out;
}

/**
 * The class features and domains that are numbers, as effects. Read after the
 * ability scores, since several use them.
 *
 * @param features  classFeatures()'s result
 */
export function featureEffects(character, summary, abilities, features) {
  const effects = [];
  const levelsOf = (name) => Math.max(0, ...(summary.sides || []).flatMap((s) => s.classes.filter((c) => c.name === name).map((c) => c.levels)));
  const has = (className, key) => features.some((f) => f.className === className && f.key === key);
  const add = (source, e) => effects.push({ type: 'untyped', condition: null, perLevel: false, note: null, ...e, source });
  const gear = character.gear || {};
  const armored = Boolean(gear.armor?.name) || num(gear.armor?.bonus) > 0;
  const shielded = Boolean(gear.shield?.name) || num(gear.shield?.bonus) > 0;
  const heavy = /heavy/i.test(gear.armor?.category || '');

  // Paladin: divine grace, Charisma to every save.
  if (has('Paladin', 'divine grace') && abilities.cha.mod > 0) add('Divine grace', { target: 'save.all', value: abilities.cha.mod });

  // Monk: Wisdom and a bonus by level to AC, and fast movement - unarmored only.
  const monk = levelsOf('Monk');
  if (monk && !armored && !shielded) {
    const bonus = Math.max(0, abilities.wis.mod) + Math.floor(monk / 5);
    if (bonus) add('Monk AC bonus', { target: 'ac', value: bonus });
    if (monk >= 3) add('Monk fast movement', { target: 'speed', value: 10 * Math.floor(monk / 3) });
  }
  if (has('Monk', 'still mind')) add('Still mind', { target: 'save.all', value: 2, condition: 'against enchantment spells and effects' });

  // Barbarian: fast movement, out of heavy armor.
  if (has('Barbarian', 'fast movement') && !heavy) add('Barbarian fast movement', { target: 'speed', value: 10 });

  // Trap sense, from every class that has it, stacking.
  const trapSense = features.filter((f) => f.key === 'trap sense')
    .reduce((t, f) => t + (Number(String(f.latest).match(/\+\s*(\d+)/)?.[1]) || 0), 0);
  if (trapSense) {
    add('Trap sense', { target: 'save.ref', value: trapSense, condition: 'against traps' });
    add('Trap sense', { target: 'ac', type: 'dodge', value: trapSense, condition: 'against attacks by traps' });
  }

  if (has('Druid', "resist nature's lure")) add("Resist nature's lure", { target: 'save.all', value: 4, condition: 'against the spell-like and supernatural abilities of fey' });
  if (features.some((f) => f.key === 'favored enemy')) {
    for (const skill of ['Bluff', 'Listen', 'Sense Motive', 'Spot', 'Survival']) {
      add('Favored enemy', { target: `skill.${skill}`, value: 2, condition: 'against a favored enemy (more against later ones)' });
    }
  }

  for (const d of chosenDomains(character, summary)) {
    for (const e of DOMAIN_RULES[d.name]?.effects || []) add(`${d.name} domain`, e);
  }
  return effects;
}
