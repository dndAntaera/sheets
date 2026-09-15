// Dice, and the rolls a sheet can make - for a table's Discord, or anywhere else.
//
// A bot in a chat has no engine to run: it cannot derive a sheet. So each time a
// sheet is saved the app writes `character.rolls`, a small snapshot of the
// numbers a roll needs - ability modifiers, saves, skills, initiative, attacks
// and their damage (rollSheet). The server reads that snapshot when a command
// arrives (worker/src/features/discord.js) and rolls from it here.
//
//   rollSheet(derived, character)   the snapshot, from a derived sheet
//   findRoll(sheet, words)          "hide", "fort", "longsword +2", "2d6+3" -> what to roll
//   rollFor(sheet, words, random)   roll it: { title, total, text, lines }
//   rollChoices(sheet, typed)       what a partly typed roll could be, for autocomplete
//   rollDice(expression, random)    "4d6kh3+2" -> each die and the total
//
// Pure: `random` is passed in, so a test can decide every die.

import { ABILITIES } from './abilities.js';

export const ROLLS_VERSION = 1;

const ABILITY_WORDS = {
  str: 'str', strength: 'str', dex: 'dex', dexterity: 'dex', con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int', wis: 'wis', wisdom: 'wis', cha: 'cha', charisma: 'cha',
};
const ABILITY_LABEL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SAVE_WORDS = { fort: 'fort', fortitude: 'fort', ref: 'ref', reflex: 'ref', will: 'will' };
const SAVE_LABEL = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const sign = (n) => (n < 0 ? `${n}` : `+${n}`);
const lower = (s) => String(s || '').trim().toLowerCase();

/* ==========================================================================
   Dice
   ========================================================================== */

/**
 * "2d6+3", "d20 - 1", "4d6kh3", "1d8+1d6+2" as terms, or null if it is not dice.
 *
 * @returns [{ sign: 1|-1, count, sides, keep: { high|low, n } | null } | { sign, value }]
 */
export function parseDice(expression) {
  const text = String(expression || '').replace(/\s+/g, '').toLowerCase();
  if (!text || text.length > 60 || !/^[-+]?(\d*d\d+(k[hl]?\d+)?|\d+)([-+](\d*d\d+(k[hl]?\d+)?|\d+))*$/.test(text)) return null;
  const terms = [];
  for (const m of text.matchAll(/([-+]?)(?:(\d*)d(\d+)(?:k([hl]?)(\d+))?|(\d+))/g)) {
    const s = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) { terms.push({ sign: s, value: Number(m[6]) }); continue; }
    const count = m[2] === '' ? 1 : Number(m[2]);
    const sides = Number(m[3]);
    if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null;
    const keep = m[5] !== undefined ? { which: m[4] === 'l' ? 'low' : 'high', n: Math.min(count, Math.max(1, Number(m[5]))) } : null;
    terms.push({ sign: s, count, sides, keep });
  }
  return terms.length ? terms : null;
}

/** One die, 1 to sides. */
const die = (sides, random) => 1 + Math.floor(random() * sides);

/**
 * Roll dice.
 *
 * @returns { expression, total, parts: [{ text, value }], text } or null if it is not dice
 */
export function rollDice(expression, random = Math.random) {
  const terms = parseDice(expression);
  if (!terms) return null;
  const parts = [];
  let total = 0;
  for (const term of terms) {
    if (term.value !== undefined) {
      total += term.sign * term.value;
      parts.push({ text: `${term.sign < 0 ? '-' : '+'} ${term.value}`, value: term.sign * term.value });
      continue;
    }
    const rolls = Array.from({ length: term.count }, () => die(term.sides, random));
    let kept = rolls.map((value, i) => ({ value, i }));
    if (term.keep) {
      kept = [...kept].sort((a, b) => (term.keep.which === 'high' ? b.value - a.value : a.value - b.value)).slice(0, term.keep.n);
    }
    const keptIndex = new Set(kept.map((k) => k.i));
    const value = term.sign * kept.reduce((t, k) => t + k.value, 0);
    total += value;
    const shown = rolls.map((r, i) => (keptIndex.has(i) ? String(r) : `~~${r}~~`)).join(', ');
    const label = `${term.count}d${term.sides}${term.keep ? `k${term.keep.which === 'high' ? 'h' : 'l'}${term.keep.n}` : ''}`;
    parts.push({ text: `${term.sign < 0 ? '-' : '+'} ${label} (${shown})`, value, rolls, sides: term.sides });
  }
  const text = `${parts.map((p) => p.text).join(' ').replace(/^\+ /, '')} = **${total}**`;
  return { expression: String(expression).trim(), total, parts, text };
}

/* ==========================================================================
   The sheet's rolls
   ========================================================================== */

/**
 * The snapshot a bot rolls from, made from a derived sheet. Small on purpose:
 * only what a roll or a one-line summary needs.
 */
export function rollSheet(d, character) {
  const skills = (d.skills?.lines || [])
    .filter((l) => l && l.label)
    .map((l) => ({
      name: l.label,
      total: l.total,
      // A trained-only skill with no ranks cannot be rolled at all.
      usable: !(l.def?.trainedOnly && !(Number(l.ranks) > 0)),
    }));
  const attacks = (d.weapons || []).filter(Boolean).map((w) => ({
    name: w.name || 'Weapon',
    bonuses: w.calc?.attacks || [],
    damage: w.calc?.damageDice ? `${w.calc.damageDice}${w.calc.damageMod ? sign(w.calc.damageMod) : ''}` : null,
    critical: w.calc?.critical || '20/x2',
  }));
  return {
    version: ROLLS_VERSION,
    name: character?.name || 'Unnamed',
    build: [character?.race?.name, d.summary?.label].filter(Boolean).join(' ') || '',
    level: d.summary?.ecl || 0,
    hp: { max: d.hp?.total ?? 0, current: character?.hp?.current ?? null },
    ac: { total: d.ac?.total ?? 10, touch: d.ac?.touch ?? 10, flatFooted: d.ac?.flatFooted ?? 10 },
    speed: d.speed ?? 30,
    initiative: d.initiative?.total ?? 0,
    bab: d.summary?.bab ?? 0,
    melee: d.attacks?.melee?.total ?? null,
    ranged: d.attacks?.ranged?.total ?? null,
    grapple: d.attacks?.grapple?.total ?? null,
    abilities: Object.fromEntries(ABILITIES.map((k) => [k, { score: d.abilities?.[k]?.total ?? 10, mod: d.abilities?.[k]?.mod ?? 0 }])),
    saves: { fort: d.saves?.fort?.total ?? 0, ref: d.saves?.ref?.total ?? 0, will: d.saves?.will?.total ?? 0 },
    skills,
    attacks,
  };
}

/** A trailing "+2" or "-1" on what was typed: a situational modifier. */
function splitModifier(words) {
  const m = String(words || '').trim().match(/^(.*?)(?:\s*([+-])\s*(\d{1,3}))?$/);
  const rest = (m?.[1] || '').trim();
  const extra = m?.[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
  return { rest, extra };
}

/** How well a skill's name answers what was typed: 3 exact, 2 starts with, 1 every word found, 0 no. */
function nameScore(name, typed) {
  const n = lower(name);
  const t = lower(typed);
  if (!t) return 0;
  if (n === t) return 3;
  if (n.startsWith(t)) return 2;
  const words = t.split(/[\s()]+/).filter(Boolean);
  return words.every((w) => n.includes(w)) ? 1 : 0;
}

/**
 * What a typed roll means for this sheet.
 *
 * @returns { kind: 'check'|'attack'|'dice', label, bonus?, extra, attack? , dice? } or null
 */
export function findRoll(sheet, words) {
  const typed = String(words || '').trim();
  if (!typed) return null;
  // Plain dice first: "2d6+3".
  if (parseDice(typed)) return { kind: 'dice', label: typed, dice: typed, extra: 0 };

  const { rest, extra } = splitModifier(typed);
  const key = lower(rest).replace(/\s+(check|save|saving throw)$/, '');
  if (!key) return null;
  if (['init', 'initiative'].includes(key)) return { kind: 'check', label: 'Initiative', bonus: sheet.initiative, extra };
  if (SAVE_WORDS[key]) return { kind: 'check', label: `${SAVE_LABEL[SAVE_WORDS[key]]} save`, bonus: sheet.saves[SAVE_WORDS[key]], extra };
  if (ABILITY_WORDS[key]) {
    const a = ABILITY_WORDS[key];
    return { kind: 'check', label: `${ABILITY_LABEL[a]} check`, bonus: sheet.abilities[a].mod, extra };
  }
  if (key === 'grapple' && sheet.grapple !== null) return { kind: 'check', label: 'Grapple', bonus: sheet.grapple, extra };
  if (key === 'melee' && sheet.melee !== null) return { kind: 'check', label: 'Melee attack', bonus: sheet.melee, extra };
  if (key === 'ranged' && sheet.ranged !== null) return { kind: 'check', label: 'Ranged attack', bonus: sheet.ranged, extra };

  const best = (list) => list
    .map((x) => ({ x, score: nameScore(x.name, key) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.x.name.length - b.x.name.length)[0]?.x || null;
  const attack = best(sheet.attacks || []);
  const skill = best(sheet.skills || []);
  // An exact weapon name wins over a skill that merely starts with the words.
  if (attack && (!skill || nameScore(attack.name, key) >= nameScore(skill.name, key))) {
    return { kind: 'attack', label: attack.name, attack, extra };
  }
  if (skill) return { kind: 'check', label: skill.name, bonus: skill.total, extra, unusable: !skill.usable };
  return null;
}

/**
 * Roll what was typed, from a sheet.
 *
 * @returns { title, total, text, lines: [text], critical? } or { error }
 */
export function rollFor(sheet, words, random = Math.random) {
  const found = findRoll(sheet, words);
  if (!found) return { error: `Nothing on ${sheet.name}'s sheet is called "${String(words || '').trim()}". Try a skill, a save (fort, ref, will), an ability (str), init, a weapon, or dice like 2d6+3.` };

  if (found.kind === 'dice') {
    const r = rollDice(found.dice, random);
    return { title: `${sheet.name} rolls ${found.dice}`, total: r.total, text: r.text, lines: [r.text] };
  }

  const extraText = found.extra ? ` ${sign(found.extra)}` : '';
  if (found.kind === 'check') {
    if (found.unusable) return { error: `${found.label} can't be used untrained, and ${sheet.name} has no ranks in it.` };
    const d20 = die(20, random);
    const total = d20 + found.bonus + found.extra;
    const text = `1d20 (${d20}) ${sign(found.bonus)}${extraText} = **${total}**`;
    return { title: `${sheet.name}: ${found.label}`, total, text, lines: [text], natural: d20 };
  }

  // An attack: the first attack of the routine, its damage, and a confirmation roll on a threat.
  const a = found.attack;
  const bonus = (a.bonuses?.[0] ?? sheet.bab ?? 0) + found.extra;
  const d20 = die(20, random);
  const total = d20 + bonus;
  const low = Number((a.critical.match(/^(\d+)/) || [])[1]) || 20;
  const lines = [`Attack: 1d20 (${d20}) ${sign(bonus)} = **${total}**${d20 === 20 ? ' (natural 20)' : d20 === 1 ? ' (natural 1)' : ''}`];
  let critical = false;
  if (d20 >= low && d20 !== 1) {
    const confirm = die(20, random);
    critical = true;
    lines.push(`Threat ${a.critical}: confirm 1d20 (${confirm}) ${sign(bonus)} = **${confirm + bonus}**`);
  }
  if (a.damage) {
    const damage = rollDice(a.damage, random);
    if (damage) lines.push(`Damage: ${damage.text}`);
  }
  if ((a.bonuses || []).length > 1) lines.push(`Full attack: ${a.bonuses.map((b) => sign(b + found.extra)).join('/')}`);
  return { title: `${sheet.name} attacks with ${a.name}`, total, text: lines.join('\n'), lines, critical, natural: d20 };
}

/** What a partly typed roll could be, for a command's autocomplete: at most 25, best first. */
export function rollChoices(sheet, typed) {
  const base = [
    'Initiative', 'Fortitude save', 'Reflex save', 'Will save',
    ...ABILITIES.map((k) => `${ABILITY_LABEL[k]} check`),
    ...(sheet.grapple !== null ? ['Grapple'] : []),
    ...(sheet.attacks || []).map((a) => a.name),
    ...(sheet.skills || []).filter((s) => s.usable).map((s) => s.name),
  ];
  const t = lower(typed);
  const scored = [...new Set(base)]
    .map((name) => ({ name, score: t ? nameScore(name, t) : 1 }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 25).map((c) => c.name);
}
