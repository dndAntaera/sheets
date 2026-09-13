// Limited uses: everything a character can do only so many times a day or week.
//
// Three sources, one list:
//
//   the class table   "rage 2/day", "smite evil 3/day", "wild shape (6/day,
//                     elemental 2/day)", "remove disease 1/week" - read from
//                     each class's specials in data/srd/progression.json, the
//                     latest figure at or below the class level
//   the SRD's rules   uses that follow a formula rather than a table: turning
//                     undead (3 + Cha), bardic music (bard level), stunning
//                     fist, lay on hands, a monk's wholeness of body...
//   the sheet's rows  any feat, class feature or item a player gives a number
//                     of uses, and any homebrew entry that carries one
//
// What has been used is kept on the character: character.trackers[key] for the
// first two, and `usesUsed` on the row itself for the third.

const PER_DAY = 'day';
const PER_WEEK = 'week';

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Uses the SRD sets by formula. `uses(ctx)` returns the maximum; ctx carries
 * the class's levels, the character's total levels, ability modifiers and the
 * character's feats by name.
 */
const FORMULAS = {
  Bard: [
    { name: 'Bardic music', from: 1, per: PER_DAY, uses: (x) => x.levels },
  ],
  Cleric: [
    { name: 'Turn or rebuke undead', from: 1, per: PER_DAY, turning: true, uses: (x) => 3 + x.mod.cha },
  ],
  Paladin: [
    { name: 'Turn undead', from: 4, per: PER_DAY, turning: true, uses: (x) => 3 + x.mod.cha },
    { name: 'Lay on hands', from: 2, per: PER_DAY, unit: 'hit points', uses: (x) => x.levels * Math.max(0, x.mod.cha) },
  ],
  Monk: [
    { name: 'Stunning fist', from: 1, per: PER_DAY, uses: (x) => x.levels + Math.floor((x.characterLevel - x.levels) / 4) },
    { name: 'Wholeness of body', from: 7, per: PER_DAY, unit: 'hit points', uses: (x) => 2 * x.levels },
    { name: 'Abundant step', from: 12, per: PER_DAY, uses: () => 1 },
    { name: 'Quivering palm', from: 15, per: PER_WEEK, uses: () => 1 },
    { name: 'Empty body', from: 19, per: PER_DAY, unit: 'rounds', uses: (x) => x.levels },
  ],
};

/** "Rage 2/day, trap sense +4" -> [{ name: 'Rage', uses: 2, per: 'day' }]. */
export function usesInSpecial(text) {
  const found = [];
  let lastName = null;
  for (const m of String(text || '').matchAll(/([A-Za-z][A-Za-z' -]*?)\s*\(?\s*(\d+)\s*\/\s*(day|week)/gi)) {
    let name = m[1].trim().replace(/\s+/g, ' ');
    // "Wild shape (6/day, elemental 2/day)": the second use belongs to the first.
    if (/^elemental$/i.test(name)) name = `${lastName || 'Wild shape'} (elemental)`;
    else lastName = name;
    found.push({ name: titleCase(name.toLowerCase()), uses: Number(m[2]), per: m[3].toLowerCase() });
  }
  return found;
}

/**
 * Every limited use the character has.
 *
 * @param character  the stored character
 * @param summary    buildSummary's result
 * @param abilities  abilityTotals's result
 * @param rules      the rules context, with `progression`
 * @param index      contentIndex's result, for homebrew entries that carry uses
 * @returns [{ key, name, source, max, used, remaining, per, unit, row? }]
 */
export function trackersFor(character, summary, abilities, rules, index) {
  const out = [];
  const used = character.trackers || {};
  const mod = Object.fromEntries(Object.entries(abilities).map(([k, v]) => [k, v.mod]));
  const characterLevel = summary.classLevels || (character.levels || []).length;
  const featNames = new Set((character.feats || []).map((f) => String(f.name || '').trim().toLowerCase()).filter(Boolean));
  const extraTurning = (character.feats || []).filter((f) => /^extra turning$/i.test(String(f.name || '').trim())).length;
  const seen = new Set();

  const push = (entry) => {
    const max = Math.max(0, Math.floor(entry.max));
    const spent = Math.max(0, Number(entry.used) || 0);
    out.push({ ...entry, max, used: spent, remaining: max - spent });
  };

  for (const side of summary.sides || []) {
    for (const c of side.classes) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const levels = c.levels;

      // From the class table: the latest figure for each use, at or below the class level.
      const specials = rules.progression?.[c.name]?.special || c.def?.progression?.special || [];
      const latest = new Map();
      specials.slice(0, levels).forEach((text) => {
        for (const u of usesInSpecial(text)) latest.set(u.name.toLowerCase(), u);
      });
      for (const u of latest.values()) {
        const key = `class:${c.name}:${u.name}`;
        push({ key, name: u.name, source: c.name, max: u.uses, used: used[key], per: u.per });
      }

      // From the SRD's formulas.
      for (const f of FORMULAS[c.name] || []) {
        if (levels < f.from) continue;
        const key = `class:${c.name}:${f.name}`;
        const max = f.uses({ levels, characterLevel, mod }) + (f.turning ? 4 * extraTurning : 0);
        if (max <= 0 && f.unit) continue;
        push({ key, name: f.name, source: c.name, max, used: used[key], per: f.per, unit: f.unit || null });
      }
    }
  }

  // Stunning Fist, taken as a feat by someone who is not a monk.
  if (featNames.has('stunning fist') && !seen.has('Monk')) {
    const key = 'feat:Stunning fist';
    push({ key, name: 'Stunning fist', source: 'feat', max: Math.max(1, Math.floor(characterLevel / 4)), used: used[key], per: PER_DAY });
  }

  // Rows on the sheet, and the homebrew they name.
  const rows = [
    ['feats', character.feats, index?.featByName, 'feat'],
    ['features', character.features, index?.featureByName, 'class feature'],
    ['wealth.items', character.wealth?.items, index?.itemByName, 'item'],
  ];
  for (const [path, list, lookup, source] of rows) {
    (list || []).forEach((row, i) => {
      if (!row) return;
      const content = row.name ? lookup?.get(row.name) : null;
      const max = Number(row.uses) || Number(content?.uses) || 0;
      if (max <= 0) return;
      push({
        key: `row:${path}:${i}`,
        name: row.name || `Unnamed ${source}`,
        source,
        max,
        used: row.usesUsed,
        per: row.usesPer || content?.usesPer || PER_DAY,
        unit: null,
        row: { path, index: i },
      });
    });
  }

  return out;
}

/** Where the trackers and the rules disagree. */
export function trackerNotices(trackers, add) {
  for (const t of trackers) {
    if (t.used > t.max) add('warn', `${t.name}: ${t.used} used, but only ${t.max} a ${t.per}.`, 'trackers');
  }
}

/**
 * The character after resting: every use of `per` ('day', or 'week') back.
 * Returns the parts to change: { trackers, feats, features, items }.
 */
export function restedTrackers(character, trackers, per = PER_DAY) {
  const next = { ...(character.trackers || {}) };
  const clearRows = (list, path) => (list || []).map((row, i) => {
    const t = trackers.find((x) => x.row && x.row.path === path && x.row.index === i);
    return t && (per === PER_WEEK || t.per === per) ? { ...row, usesUsed: 0 } : row;
  });
  for (const t of trackers) {
    if (t.row) continue;
    if (per === PER_WEEK || t.per === per) next[t.key] = 0;
  }
  return {
    trackers: next,
    feats: clearRows(character.feats, 'feats'),
    features: clearRows(character.features, 'features'),
    items: clearRows(character.wealth?.items, 'wealth.items'),
  };
}
