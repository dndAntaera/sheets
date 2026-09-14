// Traits and flaws (Unearthed Arcana): the SRD's lists, what each does to the
// sheet, and who may take which.
//
// A trait is a small bonus with a matching drawback; a flaw is only a drawback,
// and buys a feat. Both are read from data/srd/traits.json, where each carries
// its effects - so a character with Hardy has +1 Fortitude and -1 Reflex without
// anyone typing either - and notes for what is not a number, which the sheet
// lists with the character's abilities.
//
// A row on the character is { name, choice? }: the skill Illiterate improves,
// the ability Pathetic lowers.
//
// Pure: no DOM, no fetch.

const lower = (s) => String(s || '').trim().toLowerCase();

/** The SRD's traits or flaws, as a map by lowercase name. */
export function traitsOfKind(rules, kind) {
  return new Map((rules.traits || []).filter((t) => t.kind === kind).map((t) => [lower(t.name), t]));
}

/**
 * Put a row's choice into an entry's words: `{choice}` becomes the skill or
 * ability chosen, and `{choiceSkill}` the skill a subject belongs to - Knowledge
 * for "Knowledge (arcana)". An effect naming a choice not yet made is dropped.
 */
export function withChoice(entry, choice) {
  const chosen = String(choice || '').trim();
  const skill = chosen.replace(/\s*\(.*\)$/, '');
  const fill = (text) => String(text).replace(/\{choice\}/g, chosen).replace(/\{choiceSkill\}/g, skill);
  const effects = (entry.effects || [])
    .filter((e) => !/\{choice(Skill)?\}/.test(`${e.target}${e.condition || ''}`) || chosen)
    .map((e) => {
      const target = fill(e.target);
      return {
        ...e,
        target: target.startsWith('weapon.') ? target.toLowerCase() : target,
        ...(e.condition ? { condition: fill(e.condition) } : {}),
      };
    });
  const notes = (entry.notes || []).filter((n) => !/\{choice\}/.test(n) || chosen).map(fill);
  return { ...entry, effects, notes };
}

/**
 * The character's traits or flaws, resolved: the SRD entry with the row's
 * choice filled in. A row the SRD does not know keeps what it says of itself.
 */
export function traitEntries(character, rules, kind) {
  const known = traitsOfKind(rules, kind);
  const rows = kind === 'trait' ? character.traits : character.flaws;
  return (rows || []).filter((r) => r && r.name).map((row) => {
    const def = known.get(lower(row.name));
    if (!def) return { ...row, kind, custom: true, effects: row.effects || [], notes: row.effect ? [row.effect] : [] };
    return { ...withChoice(def, row.choice), choiceDef: def.choice || null, choice: row.choice || null, kind };
  });
}

/**
 * Whether the character may take a trait or flaw.
 *
 * @param ctx { scores: {con...}, modifierTotal, speed, modules, raceTraits, feats: Set, classes: Set }
 * @returns { ok, unmet: [text] }
 */
export function traitEligibility(def, ctx) {
  const unmet = [];
  const r = def?.requires || {};
  if (r.notFeat && ctx.feats.has(lower(r.notFeat))) unmet.push(`not with ${r.notFeat}`);
  if (r.notClass && ctx.classes.has(r.notClass)) unmet.push(`not for a ${r.notClass.toLowerCase()}, who is already illiterate`);
  for (const [key, min] of Object.entries(r.minAbility || {})) {
    if ((ctx.scores[key] ?? 10) < min) unmet.push(`${key.toUpperCase()} ${min} or higher`);
  }
  if (r.minSpeed && ctx.speed < r.minSpeed) unmet.push(`a base land speed of ${r.minSpeed} feet or more`);
  if (r.module && !ctx.modules[r.module]) unmet.push(`the ${r.module === 'reputation' ? 'reputation' : 'complex skill checks'} variant`);
  if (r.raceTrait && !lower(ctx.raceTraits).includes(lower(r.raceTrait))) unmet.push(`racial ${r.raceTrait}`);
  if (r.maxModifierTotal !== undefined && ctx.modifierTotal > r.maxModifierTotal) unmet.push(`ability modifiers totalling ${r.maxModifierTotal + 1} or less`);
  return { ok: unmet.length === 0, unmet };
}

/** Where the traits, flaws and the rules disagree. */
export function traitNotices(entries, ctx, add) {
  for (const e of entries) {
    if (e.custom) continue;
    const check = traitEligibility(e, ctx);
    if (!check.ok) add('error', `${e.name} (${e.kind}): needs ${check.unmet.join('; ')}.`, 'feats');
    if (e.choiceDef && !e.choice) add('info', `${e.name}: choose ${choiceWords(e)}.`, 'feats');
  }
}

const choiceWords = (e) => ({ skill: 'a skill', ability: 'an ability', school: 'a school', subjectSkill: 'a Craft, Knowledge or Profession skill' }[e.choiceDef?.kind] || 'what it applies to');
