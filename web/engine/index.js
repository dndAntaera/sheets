// The engine's front door.
//
// The calculating half of this repository is deliberately free of the browser:
// it takes data in and gives numbers back, so the same code runs the sheet, the
// tests, and any validation the server wants to do. `makeRules` is the only
// place the two halves meet - hand it the four JSON files and it returns the
// context every other function expects.

export * from './util.js';
export * from './progression.js';
export * from './build.js';
export * from './abilities.js';
export * from './skills.js';
export * from './hp.js';
export * from './defense.js';
export * from './offense.js';
export * from './houserules.js';
export { derive } from './derive.js';
export { blankCharacter, migrate, renumberLevels, SCHEMA } from './character.js';

/**
 * Bundle the data files into the context the engine takes as its second
 * argument, with the two lookups everything needs built once rather than on
 * every keystroke.
 */
export function makeRules({ rules, classes, skills, backgrounds }) {
  return {
    rules,
    classes,
    skills,
    backgrounds,
    classByName: new Map(classes.classes.map((c) => [c.name, c])),
    skillsByName: new Map(skills.skills.map((s) => [s.name, s])),
  };
}

/** Fetch the data files and build the rules context. Browser side. */
export async function loadRules(base = './data/') {
  const files = ['rules', 'classes', 'skills', 'backgrounds'];
  const loaded = await Promise.all(
    files.map(async (name) => {
      const res = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`could not load ${name}.json (${res.status})`);
      return [name, await res.json()];
    })
  );
  return makeRules(Object.fromEntries(loaded));
}
