// The data files the suite needs, named once so the two runners cannot drift.
// Each runner supplies its own `read(path)`: fs under Node, fetch in a browser.

export const RULESETS = ['srd', 'antaera'];

export async function loadData(read) {
  const [core, classes, skills, races, ...rulesets] = await Promise.all([
    read('core.json'),
    read('classes.json'),
    read('skills.json'),
    read('races.json'),
    ...RULESETS.map((id) => read(`rulesets/${id}.json`)),
  ]);
  return {
    core,
    classes,
    skills,
    races,
    rulesets: Object.fromEntries(rulesets.map((r) => [r.id, r])),
  };
}
