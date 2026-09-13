// The SRD's variant rules (Unearthed Arcana): what each one does to a character.
//
// Which variants exist, and their tables, are data/variants.json (built by
// scripts/build-variants.py); whether each is in force for a character is the
// module system's call (modules.js), like gestalt's. This file is the rules
// themselves. Every function here is pure: given the character, the rules and
// the numbers the sheet has already worked out, it returns what the variant
// changes or adds.
//
// A player's choices within a variant - a class's variant, a generic class's
// good saves, massive damage's threshold, what has been spent - are kept on the
// character under `variants`:
//
//   variants.classVariant[className]   'cloisteredCleric', 'battleSorcerer', ...
//   variants.genericSaves[className]   ['fort'] or ['ref', 'will']
//   variants.chosenSkills[className]   the class skills a generic or human paragon class picks
//   variants.casterAbility[className]  a generic spellcaster's 'int', 'cha' or 'wis'
//   variants.massiveDamage             { threshold: 'standard'|'con'|'hd'|'size', result: 'death'|'dying'|'nearDeath' }
//   variants.magicRatingSeparate       arcane and divine ratings kept apart
//   variants.laReductions              level adjustment reductions paid for
//   variants.bloodline                 { source, strength: 'minor'|'intermediate'|'major', levels }
//   variants.honor                     { ancestry: 'none'|'hero'|'failure', current }
//   variants.sanity                    { current }
//   variants.craftPointsSpent, variants.contacts: [{ name, type, notes }]
//   variants.vitalityTaken, variants.woundsTaken, variants.reserveUsed, variants.injuryHits, variants.taint

const SAVES = ['fort', 'ref', 'will'];
const num = (v, d = 0) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));

/** Which lettered column of a variant table a class uses. */
function columnOf(table, className, fallback = null) {
  for (const [letter, names] of Object.entries(table.columns || {})) if (names.includes(className)) return letter;
  return fallback;
}
const COLUMN_INDEX = { A: 0, B: 1, C: 2, D: 3 };
const tableAt = (table, level) => table.byLevel?.[String(Math.max(1, Math.min(20, level)))] || [];

/* ==========================================================================
   Classes: variants, generic classes, paragon classes
   ========================================================================== */

/**
 * Class variants: what each changes about its class. Features that change only
 * what a class can do in play - a totem, a fighting style, a paladin's cause -
 * are listed with no numbers, so the choice is recorded and the text is a click
 * away.
 */
export const CLASS_VARIANTS = {
  Barbarian: {
    totemBarbarian: { name: 'Totem barbarian', note: 'Totem abilities in place of fast movement, uncanny dodge and trap sense.' },
  },
  Bard: {
    bardicSage: { name: 'Bardic sage', saves: { fort: 'poor', ref: 'poor', will: 'good' }, casting: { castingScore: 'int', extraKnown: 1 } },
    divineBard: { name: 'Divine bard', casting: { type: 'divine', castingScore: 'wis' } },
    savageBard: { name: 'Savage bard', saves: { fort: 'good', ref: 'poor', will: 'good' }, skills: { remove: ['Decipher Script', 'Speak Language'], add: ['Survival'] } },
  },
  Cleric: {
    cloisteredCleric: { name: 'Cloistered cleric', hd: 6, bab: 'poor', skillPoints: 6, skills: { add: ['Decipher Script', 'Speak Language', 'Knowledge'] } },
  },
  Druid: {
    druidicAvenger: { name: 'Druidic avenger', skills: { add: ['Intimidate'], remove: ['Diplomacy'] } },
  },
  Fighter: {
    thug: { name: 'Thug', skillPoints: 4, skills: { add: ['Bluff', 'Gather Information', 'Knowledge (local)', 'Sleight of Hand'] } },
  },
  Monk: {
    fightingStyle: { name: 'Monk with a fighting style', note: 'A fighting style decides the bonus feats at 1st, 2nd and 6th level.' },
  },
  Paladin: {
    paladinOfFreedom: { name: 'Paladin of freedom', note: 'Chaotic good; aura of resolve in place of aura of courage.' },
    paladinOfSlaughter: { name: 'Paladin of slaughter', note: 'Chaotic evil; smite good in place of smite evil.' },
    paladinOfTyranny: { name: 'Paladin of tyranny', note: 'Lawful evil; smite good in place of smite evil.' },
  },
  Ranger: {
    planarRanger: { name: 'Planar ranger', skills: { remove: ['Knowledge (nature)', 'Knowledge (dungeoneering)'], add: ['Knowledge (the planes)', 'Speak Language'] } },
    urbanRanger: { name: 'Urban ranger', skills: { remove: ['Knowledge (nature)', 'Knowledge (dungeoneering)', 'Survival'], add: ['Gather Information', 'Knowledge (local)', 'Sense Motive'] } },
  },
  Rogue: {
    wildernessRogue: { name: 'Wilderness rogue', skills: { remove: ['Appraise', 'Diplomacy', 'Decipher Script', 'Forgery', 'Gather Information'], add: ['Handle Animal', 'Knowledge (geography)', 'Knowledge (nature)', 'Ride', 'Survival'] } },
  },
  Sorcerer: {
    battleSorcerer: { name: 'Battle sorcerer', hd: 8, bab: 'average', casting: { slotAdjust: -1, knownAdjust: -1 } },
  },
  Wizard: {
    domainWizard: { name: 'Domain wizard', casting: { domainSlot: 1 }, note: 'An arcane domain: a bonus slot each level for its spell. Cannot also specialize.' },
  },
};

/** The three generic classes: their numbers, and how many saves and skills each chooses. */
export const GENERIC_CLASSES = [
  { name: 'Expert (generic)', hd: 6, bab: 'average', goodSaves: 2, skillPoints: 6, chooseSkills: 12, classSkills: ['Craft', 'Profession'] },
  { name: 'Spellcaster (generic)', hd: 4, bab: 'poor', goodSaves: 1, skillPoints: 2, chooseSkills: 4, classSkills: ['Craft', 'Knowledge', 'Profession'], spellcaster: true },
  { name: 'Warrior (generic)', hd: 10, bab: 'good', goodSaves: 1, skillPoints: 2, chooseSkills: 6, classSkills: ['Craft'] },
];

const progressionFromTable = (table, key, levels) => {
  // A three-level paragon table read back into a progression: good BAB adds 1 a
  // level, average 3/4, poor 1/2; a good save starts at +2.
  const last = table[table.length - 1] || {};
  const n = table.length || 1;
  if (key === 'bab') return last.bab >= n ? 'good' : last.bab >= Math.floor((n * 3) / 4) ? 'average' : 'poor';
  return (table[0]?.[key] ?? 0) >= 2 ? 'good' : 'poor';
};

/**
 * The class list a character's variants make: every class it already has, the
 * generic and paragon classes when those variants are on, and each class the
 * character plays a variant of, changed to match.
 *
 * @param classByName  the Map from contentIndex
 * @returns a new Map; the one passed in is not changed
 */
export function variantClassIndex(classByName, character, rules, modules) {
  const index = new Map(classByName);
  const state = character.variants || {};
  const chosen = (name) => (state.chosenSkills?.[name] || []).filter(Boolean);

  if (modules.genericClasses) {
    const slots = rules.variants?.tables?.genericSpellcasterSlots || [];
    for (const g of GENERIC_CLASSES) {
      const good = (state.genericSaves?.[g.name] || []).filter((s) => SAVES.includes(s)).slice(0, g.goodSaves);
      const defaults = g.goodSaves === 2 ? ['ref', 'will'] : g.spellcaster ? ['will'] : ['fort'];
      const goodSaves = good.length ? good : defaults;
      const ability = state.casterAbility?.[g.name] || 'cha';
      index.set(g.name, {
        name: g.name,
        hd: g.hd,
        bab: g.bab,
        saves: Object.fromEntries(SAVES.map((s) => [s, goodSaves.includes(s) ? 'good' : 'poor'])),
        skillPoints: g.skillPoints,
        classSkills: [...g.classSkills, ...chosen(g.name)],
        chooseSkills: g.chooseSkills,
        generic: g,
        variant: 'genericClasses',
        ...(g.spellcaster ? {
          casting: { ability, type: ability === 'wis' ? 'divine' : 'arcane', spontaneous: true },
          progression: { slots: slots, known: rules.progression?.Sorcerer?.known || [] },
        } : {}),
      });
    }
  }

  if (modules.paragonClasses) {
    for (const p of rules.variants?.paragonClasses || []) {
      index.set(p.name, {
        name: p.name,
        hd: p.hd,
        bab: progressionFromTable(p.table, 'bab'),
        saves: Object.fromEntries(SAVES.map((s) => [s, progressionFromTable(p.table, s)])),
        skillPoints: p.skillPoints,
        classSkills: [...p.classSkills, ...chosen(p.name)],
        chooseSkills: p.chooseSkills || 0,
        maxLevel: p.maxLevel,
        paragon: true,
        variant: 'paragonClasses',
        progression: { special: p.table.map((r) => r.special) },
      });
    }
  }

  if (modules.classVariants) {
    for (const [className, variantKey] of Object.entries(state.classVariant || {})) {
      const variant = CLASS_VARIANTS[className]?.[variantKey];
      const base = index.get(className);
      if (!variant || !base) continue;
      const skills = new Set(Array.isArray(base.classSkills) ? base.classSkills : String(base.classSkills || '').split(',').map((s) => s.trim()));
      for (const s of variant.skills?.remove || []) skills.delete(s);
      for (const s of variant.skills?.add || []) skills.add(s);
      index.set(className, {
        ...base,
        hd: variant.hd ?? base.hd,
        bab: variant.bab ?? base.bab,
        saves: variant.saves ? { ...base.saves, ...variant.saves } : base.saves,
        skillPoints: variant.skillPoints ?? base.skillPoints,
        classSkills: [...skills].filter(Boolean),
        casting: base.casting && variant.casting ? { ...base.casting, ...variant.casting } : base.casting,
        classVariant: { key: variantKey, name: variant.name, note: variant.note || null },
      });
    }
  }

  if (modules.spontaneousDivine) {
    for (const className of ['Cleric', 'Druid']) {
      const base = index.get(className);
      if (!base?.casting) continue;
      index.set(className, {
        ...base,
        casting: { ...base.casting, spontaneous: true, spontaneousDivine: true, knownBonus: className === 'Cleric' ? 2 : 1 },
      });
    }
  }
  return index;
}

/* ==========================================================================
   Armor Class: defense bonus, armor as damage reduction
   ========================================================================== */

// Classes the SRD's defense bonus table does not name, by the armor their class grants.
const DEFENSE_BY_ARMOR = {
  Psion: 'A', Wilder: 'B', 'Psychic Warrior': 'C', Soulknife: 'B', Adept: 'A', Aristocrat: 'D', Commoner: 'A', Expert: 'B', Warrior: 'D',
  'Expert (generic)': 'B', 'Spellcaster (generic)': 'A', 'Warrior (generic)': 'C',
};

/** The best defense bonus a character's classes give at their character level. */
export function defenseBonusFor(summary, rules) {
  const table = rules.variants?.tables?.defenseBonus;
  if (!table) return 0;
  const level = summary.classLevels || 0;
  const row = tableAt(table, level);
  let best = 0;
  for (const side of summary.sides || []) {
    for (const c of side.classes) {
      const letter = columnOf(table, c.name, DEFENSE_BY_ARMOR[c.name] || (c.def?.paragon ? 'B' : 'A'));
      best = Math.max(best, num(row[COLUMN_INDEX[letter]]));
    }
  }
  return level > 0 ? best : 0;
}

/**
 * Armor Class under the defense bonus and armor-as-DR variants.
 *
 * Armor as damage reduction: armor grants DR equal to half its armor bonus
 * before enhancement, and loses that much of its AC bonus; natural armor grants
 * DR of a fifth of itself and loses that much. Defense bonus: the character
 * uses the better of the defense bonus and the (remaining) armor bonus, and
 * the defense bonus counts against touch attacks too.
 */
export function variantArmorClass(ac, gear, summary, rules, modules) {
  if (!modules.armorAsDR && !modules.defenseBonus) return { ac, damageReduction: 0, defenseBonus: null };
  const next = { ...ac, parts: { ...ac.parts } };
  let damageReduction = 0;

  if (modules.armorAsDR) {
    const armor = ac.parts.armor || 0;
    const enhancement = num(gear.armor?.enhancement);
    const fromArmor = Math.floor(Math.max(0, armor - enhancement) / 2);
    const natural = ac.parts.natural || 0;
    const fromNatural = Math.floor(natural / 5);
    damageReduction = fromArmor + fromNatural;
    next.parts.armor = armor - fromArmor;
    next.parts.natural = natural - fromNatural;
    next.total -= damageReduction;
    next.flatFooted -= damageReduction;
  }

  let defenseBonus = null;
  if (modules.defenseBonus) {
    defenseBonus = defenseBonusFor(summary, rules);
    const armorNow = next.parts.armor || 0;
    const gain = Math.max(0, defenseBonus - armorNow);
    next.parts.defense = gain;
    next.total += gain;
    next.flatFooted += gain;
    next.touch += defenseBonus;
  }
  return { ac: next, damageReduction, defenseBonus };
}

/* ==========================================================================
   Health: vitality and wounds, reserve points, injury, massive damage, dying
   ========================================================================== */

export function variantHealth(character, derived, summary, abilities, size, rules, modules) {
  const state = character.variants || {};
  const out = {};
  const hp = derived.hp.total;

  if (modules.vitalityWounds) {
    out.vitality = { max: hp, taken: num(state.vitalityTaken), current: hp - num(state.vitalityTaken) };
    out.wounds = { max: abilities.con.total, taken: num(state.woundsTaken), current: abilities.con.total - num(state.woundsTaken) };
  }
  if (modules.reservePoints) {
    out.reserve = { max: hp, used: num(state.reserveUsed), current: hp - num(state.reserveUsed) };
  }
  if (modules.injury) {
    const hits = num(state.injuryHits);
    out.injury = { save: derived.saves.fort.total, hits, saveWithHits: derived.saves.fort.total - hits, condition: state.injuryCondition || 'unhurt' };
  }
  if (modules.massiveDamage) {
    const choice = state.massiveDamage || {};
    const sizes = rules.core.sizes.map((s) => s.name);
    const steps = sizes.indexOf(size.name) - sizes.indexOf('Medium');
    const threshold = {
      standard: 50,
      con: abilities.con.total,
      hd: 25 + 2 * (summary.hitDiceCount || 0),
      size: 50 + 10 * steps,
    }[choice.threshold || 'standard'];
    out.massiveDamage = {
      threshold,
      thresholdRule: choice.threshold || 'standard',
      result: choice.result || 'death',
    };
  }
  if (modules.deathAndDying) {
    out.deathAndDying = { minimum: 0, dc: 'DC 10, +2 per 10 points of damage' };
  }
  if (modules.damageConversion) {
    const armor = num(character.gear?.armor?.bonus);
    out.damageConversion = { perHit: armor, ignoresNonlethal: armor };
  }
  if (modules.uaTaint) {
    const taint = num(state.taint);
    const con = abilities.con.total;
    const lostShare = con + taint > 0 ? taint / (con + taint) : 0;
    out.taint = {
      score: taint,
      severity: con <= 0 && taint > 0 ? 'dead' : lostShare >= 0.75 ? 'severe' : lostShare >= 0.5 ? 'moderate' : lostShare >= 0.25 ? 'mild' : taint > 0 ? 'faint' : 'none',
      canEmbrace: taint >= 10,
    };
  }
  return out;
}

/* ==========================================================================
   Campaign scores: craft points, contacts, reputation, honor, sanity
   ========================================================================== */

export function variantScores(character, derived, summary, abilities, rules, modules) {
  const state = character.variants || {};
  const tables = rules.variants?.tables || {};
  const feats = (character.feats || []).map((f) => String(f.name || '').trim()).filter(Boolean);
  const byClass = (summary.sides?.[0]?.classes || []);
  const level = summary.classLevels || 0;
  const out = {};

  if (modules.craftPoints) {
    const fromLevel = 50 * level * (level + 1);
    const fromFeats = feats.reduce((t, name) => t + num(tables.craftPoints?.feats?.[name]), 0);
    const spent = num(state.craftPointsSpent);
    out.craftPoints = { fromLevel, fromFeats, total: fromLevel + fromFeats, spent, remaining: fromLevel + fromFeats - spent };
  }

  if (modules.contacts) {
    let allowed = 0;
    for (const c of byClass) {
      const letter = columnOf(tables.contacts, c.name);
      if (!letter) continue;
      for (let l = 1; l <= Math.min(20, c.levels); l++) if (tableAt(tables.contacts, l)[COLUMN_INDEX[letter]]) allowed += 1;
    }
    const list = (state.contacts || []).filter((x) => x && (x.name || x.type));
    out.contacts = { allowed, count: list.length };
  }

  if (modules.reputation) {
    let score = 0;
    for (const c of byClass) {
      const letter = columnOf(tables.reputation, c.name, 'C');
      score += num(tableAt(tables.reputation, c.levels)[COLUMN_INDEX[letter]]);
    }
    const fromFeats = feats.reduce((t, name) => t + num(tables.reputation?.feats?.[name]), 0);
    out.reputation = { fromClasses: score, fromFeats, total: score + fromFeats };
  }

  if (modules.honor) {
    const alignment = ALIGNMENT_NAMES[String(character.concept?.alignment || '').trim().toUpperCase()] || String(character.concept?.alignment || '').trim().toLowerCase();
    const base = tables.honor?.byAlignment?.[alignment];
    const ancestry = state.honor?.ancestry === 'hero' ? tables.honor.ancestralHero : state.honor?.ancestry === 'failure' ? tables.honor.ancestralFailure : 0;
    const starting = base === undefined ? null : base + ancestry;
    out.honor = { starting, current: state.honor?.current ?? starting, alignmentKnown: base !== undefined };
  }

  if (modules.sanity) {
    const forbidden = (character.skills || []).filter((s) => /^Knowledge$/.test(s.name) && /forbidden lore/i.test(s.subtype || '')).reduce((t, s) => t + num(s.ranks), 0);
    const starting = abilities.wis.total * 5;
    const maximum = 99 - forbidden;
    out.sanity = { starting, maximum, current: state.sanity?.current ?? Math.min(starting, maximum) };
  }

  if (modules.bloodlines) {
    const b = state.bloodline || {};
    const thresholds = tables.bloodlineLevels?.[b.strength] || [];
    const required = thresholds.filter((t) => level >= t).length;
    const next = thresholds.find((t) => level < t) || null;
    out.bloodline = { source: b.source || '', strength: b.strength || '', taken: num(b.levels), required, nextBefore: next };
  }

  if (modules.reducingLA) {
    const la = summary.baseLA ?? summary.la;
    const schedule = tables.reducingLA?.[String(la)] || [];
    const eligible = schedule.filter((l) => level >= l).length;
    const taken = Math.min(num(state.laReductions), eligible);
    out.levelAdjustment = { starting: la, schedule, eligible, taken, current: la - taken, nextAt: schedule.find((l) => level < l) || null };
  }
  return out;
}

const ALIGNMENT_NAMES = {
  LG: 'lawful good', NG: 'neutral good', CG: 'chaotic good',
  LN: 'lawful neutral', N: 'neutral', TN: 'neutral', CN: 'chaotic neutral',
  LE: 'lawful evil', NE: 'neutral evil', CE: 'chaotic evil',
};

/* ==========================================================================
   Magic: magic rating, spell points, recharge, spontaneous metamagic
   ========================================================================== */

// Classes the magic rating table does not name, by how they cast.
const MAGIC_RATING_FALLBACK = (def) => (def?.casting?.half ? 'B' : def?.casting || def?.manifesting ? 'A' : 'C');

/** Each class's magic rating, and the character's total (or arcane and divine totals). */
export function magicRatingFor(summary, rules, separate = false) {
  const table = rules.variants?.tables?.magicRating;
  if (!table) return null;
  const perClass = {};
  const totals = { all: 0, arcane: 0, divine: 0, neither: 0 };
  for (const side of summary.sides || []) {
    for (const c of side.classes) {
      const letter = columnOf(table, c.name, MAGIC_RATING_FALLBACK(c.def));
      const rating = num(tableAt(table, c.levels)[COLUMN_INDEX[letter]]);
      perClass[c.name] = rating;
      totals.all += rating;
      const kind = c.def?.casting?.type === 'divine' ? 'divine' : c.def?.casting ? 'arcane' : 'neither';
      totals[kind] += rating;
    }
  }
  const casterLevelOf = (className, def) => {
    if (!separate) return totals.all;
    const kind = def?.casting?.type === 'divine' ? 'divine' : 'arcane';
    return totals[kind] + totals.neither;
  };
  return { perClass, totals, separate, casterLevelOf };
}

/** Spell points a day for one class, from the class table and the ability score. */
export function spellPointsFor(className, classLevel, score, highestLevel, rules) {
  const table = rules.variants?.tables?.spellPoints;
  if (!table) return null;
  const group = table.groups[className];
  if (group === undefined) return null;
  const base = num(tableAt(table, classLevel)[group]);
  const band = table.bonus.find((b) => score >= b.from && score <= b.to)
    || (score > 51 ? table.bonus[table.bonus.length - 1] : null);
  const bonus = band && highestLevel >= 1 ? num(band.byMaxLevel[Math.min(9, highestLevel)]) : 0;
  const firstLevel = num(tableAt(table, 1)[group]);
  return { base, bonus, total: base + bonus, cost: table.cost, cantripsPerDay: 3 + firstLevel };
}

/** How long each spell level takes to recharge, counting down from the highest castable. */
export function rechargeTimesFor(highestLevel, spontaneousArcane, rules) {
  const rows = rules.variants?.tables?.rechargeTimes || [];
  const out = {};
  for (let level = highestLevel; level >= 0; level--) {
    const row = rows[highestLevel - level];
    out[level] = row ? row[spontaneousArcane ? 0 : 1] : '0';
  }
  return out;
}

/** Spontaneous metamagic: three uses a day of each metamagic feat, and the highest spell each affects. */
export function spontaneousMetamagicFor(character, highestLevel, rules) {
  const adjust = rules.variants?.tables?.metamagic || {};
  const state = character.variants?.metamagicUsed || {};
  return (character.feats || [])
    .map((f) => String(f.name || '').trim())
    .filter((name) => adjust[name] !== undefined || /^heighten spell$/i.test(name))
    .map((name) => ({
      key: `metamagic:${name}`,
      name,
      max: 3,
      used: num(state[name]),
      highestSpell: /^heighten spell$/i.test(name) ? highestLevel : highestLevel - adjust[name],
    }));
}

/* ==========================================================================
   Skills
   ========================================================================== */

/** The alternative skill system in force, if any: 'maxRanks', 'levelBased', or null. */
export const skillSystemOf = (modules) => (modules.skillsLevelBased ? 'levelBased' : modules.skillsMaxRanks ? 'maxRanks' : null);

/** Under maximum ranks, how many skills a character may know: first class's points + Int, +1 human, at least 1. */
export function skillsKnownAllowed(summary, intMod, extraPerLevel = 0) {
  const first = summary.skillPointsPerLevel?.[0]?.base || 0;
  return Math.max(1, first + intMod + num(extraPerLevel));
}

/* ==========================================================================
   Notices
   ========================================================================== */

export function variantNotices(d, modules, add) {
  const v = d.variants || {};
  if (modules.skillsMaxRanks && modules.skillsLevelBased) add('warn', 'Two alternative skill systems are on; level-based skills is used.', 'variants');
  if (modules.vitalityWounds && modules.injury) add('warn', 'Vitality and wound points and the injury variant replace hit points in different ways; use one.', 'variants');
  if (modules.spellPoints && modules.rechargeMagic) add('warn', 'Spell points and recharge magic both replace spell slots; use one.', 'variants');
  if (v.scores?.contacts && v.scores.contacts.count > v.scores.contacts.allowed) {
    add('warn', `${v.scores.contacts.count} contacts listed, but your class levels give ${v.scores.contacts.allowed}.`, 'variants');
  }
  if (v.scores?.bloodline && v.scores.bloodline.strength && v.scores.bloodline.taken < v.scores.bloodline.required) {
    add('warn', `Your ${v.scores.bloodline.strength} bloodline needs ${v.scores.bloodline.required} bloodline level${v.scores.bloodline.required === 1 ? '' : 's'} by now; until then it grants no new traits and experience is 20% lower.`, 'variants');
  }
  if (v.scores?.honor && !v.scores.honor.alignmentKnown) add('info', 'Honor starts from alignment: set one on the Character page.', 'variants');
  if (v.scores?.craftPoints && v.scores.craftPoints.remaining < 0) add('error', `Craft points overspent by ${-v.scores.craftPoints.remaining}.`, 'variants');
  if (v.health?.taint && v.health.taint.severity === 'dead') add('error', 'Taint has taken all of your Constitution.', 'variants');
  if (v.skills && v.skills.system === 'maxRanks' && v.skills.known > v.skills.allowed) {
    add('error', `${v.skills.known} skills known, but only ${v.skills.allowed} allowed.`, 'skills');
  }
  for (const [name, def] of v.classesChosing || []) {
    add('info', `${name}: choose ${def.chooseSkills} class skills on the Rules page.`, 'variants');
  }
}
