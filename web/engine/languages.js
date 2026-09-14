// Languages: what a character speaks, and how many more it may learn.
//
// A race speaks its automatic languages from birth, and a class may add one
// (a druid's Druidic). A 1st-level character then learns one bonus language for
// each point of Intelligence bonus, chosen from the race's bonus languages and
// the class's (a cleric may take Celestial). Every rank of Speak Language buys
// one more language, any but a secret one.
//
// The character stores only the languages it chose, as names. Which way each
// one was learned is worked out here, bonus languages first.
//
// Pure: no DOM, no fetch.

import { abilityMod, num } from './util.js';

const lower = (s) => String(s || '').trim().toLowerCase();

/**
 * @param derived  the derived sheet so far: race, summary, abilities, skills, index
 * @returns {
 *   automatic:  [name]                         spoken without choosing
 *   chosen:     [{ name, via: 'bonus' | 'skill' | null }]   null: not legal
 *   bonusFrom:  [name] | 'any'                  the bonus languages on offer
 *   bonusAllowed, bonusUsed, skillAllowed, skillUsed
 *   available:  [name]                          legal to add now
 *   illiterate: bool
 * }
 */
export function languagePlan(character, derived, rules) {
  const all = rules.languages || [];
  const byName = new Map(all.map((l) => [lower(l.name), l]));
  const race = derived.index?.raceByName?.get(character.race?.name) || null;
  const raceLanguages = race?.languages || (character.race?.name ? { automatic: ['Common'], bonus: 'any' } : { automatic: ['Common'], bonus: 'any' });

  const automatic = new Set(raceLanguages.automatic || []);
  let bonusFrom = raceLanguages.bonus === 'any' ? 'any' : new Set(raceLanguages.bonus || []);
  let illiterate = false;
  for (const side of derived.summary?.sides || []) {
    for (const c of side.classes) {
      for (const name of c.def?.languages?.automatic || []) automatic.add(name);
      if (bonusFrom !== 'any') for (const name of c.def?.languages?.bonus || []) bonusFrom.add(name);
      if (c.def?.illiterate && character.levels?.[0]?.a === c.name) illiterate = true;
    }
  }

  const int = derived.abilities?.int;
  const intAtFirst = abilityMod(num(int?.parts?.base, 10) + num(int?.parts?.racial));
  const bonusAllowed = Math.max(0, intAtFirst);
  const skillAllowed = (derived.skills?.lines || []).filter((l) => l.name === 'Speak Language').reduce((t, l) => t + Math.floor(num(l.ranks)), 0);

  const secret = (name) => Boolean(byName.get(lower(name))?.secret);
  const inBonus = (name) => !secret(name) && (bonusFrom === 'any' || [...bonusFrom].some((b) => lower(b) === lower(name)));

  let bonusUsed = 0;
  let skillUsed = 0;
  const chosen = [];
  const names = [...new Set((character.languages || []).map((n) => String(n || '').trim()).filter(Boolean))]
    .filter((n) => ![...automatic].some((a) => lower(a) === lower(n)));
  // Bonus languages first, and the ones only a bonus can buy before the ones anything can.
  const order = [...names].sort((x, y) => Number(inBonus(y)) - Number(inBonus(x)));
  const via = new Map();
  for (const name of order) {
    if (inBonus(name) && bonusUsed < bonusAllowed) { via.set(name, 'bonus'); bonusUsed++; }
    else if (!secret(name) && skillUsed < skillAllowed) { via.set(name, 'skill'); skillUsed++; }
    else via.set(name, null);
  }
  for (const name of names) chosen.push({ name, via: via.get(name) });

  const known = new Set([...automatic, ...names].map(lower));
  const available = all
    .filter((l) => !known.has(lower(l.name)) && !l.secret)
    .filter((l) => (inBonus(l.name) && bonusUsed < bonusAllowed) || skillUsed < skillAllowed)
    .map((l) => l.name);

  return {
    automatic: [...automatic],
    chosen,
    bonusFrom: bonusFrom === 'any' ? 'any' : [...bonusFrom],
    bonusAllowed,
    bonusUsed,
    skillAllowed,
    skillUsed,
    available,
    illiterate,
  };
}

/** Where the languages and the rules disagree. */
export function languageNotices(plan, add) {
  const illegal = plan.chosen.filter((c) => !c.via);
  if (illegal.length) add('error', `Not a language this character can learn: ${illegal.map((c) => c.name).join(', ')}.`, 'languages');
  const left = (plan.bonusAllowed - plan.bonusUsed) + (plan.skillAllowed - plan.skillUsed);
  if (left > 0 && plan.available.length) add('info', `${left} language${left === 1 ? '' : 's'} still to choose.`, 'languages');
}
