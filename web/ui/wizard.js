// The character creator: a wizard that walks a new character through 3.5
// creation one step at a time, then hands over to the full sheet.
//
// It is not a second sheet. Each step draws the same panels the sheet does -
// the abilities panel, the skills panel - bound to the same character, so every
// number, notice and rule is the sheet's own. What the wizard adds is order,
// words saying what each step is for, and a box to find a race in.
//
// A character in the wizard carries `meta.wizard.step`; finishing removes it.
// app.js draws a step with openSheet(id, { wizard: key }). Every step opened is
// remembered in `meta.creatorVisited`; finishing with steps never opened keeps
// them in `meta.creatorSkipped`, and the sheet flags them until they are.

import { h, field, select, labelled, row, total, out, button } from './dom.js';
import { ABILITIES, ABILITY_NAMES } from '../engine/abilities.js';

const ALIGNMENTS = [
  ['', '- choose -'],
  ['LG', 'Lawful good'], ['NG', 'Neutral good'], ['CG', 'Chaotic good'],
  ['LN', 'Lawful neutral'], ['N', 'True neutral'], ['CN', 'Chaotic neutral'],
  ['LE', 'Lawful evil'], ['NE', 'Neutral evil'], ['CE', 'Chaotic evil'],
];

/**
 * The steps, in order. `panels` are sheet panels drawn in the step; `notices`
 * are the notice fields the step answers for (see derive.js); `body` draws
 * anything of the wizard's own, above the panels.
 */
export const WIZARD_STEPS = [
  {
    key: 'concept',
    title: 'Concept',
    intro: [
      'Start with who this is. A name and a rough idea are enough - everything here can change later.',
      'Below that are the optional rules this character uses. Leave them off unless your table plays with them.',
    ],
    panels: [],
    notices: [],
    body: conceptStep,
  },
  {
    key: 'race',
    title: 'Race',
    intro: [
      'Your race adjusts your ability scores and sets your size, speed and a handful of traits. Type to narrow the list, and choose one to see what it gives.',
      'A race the sheet does not know can be typed in instead, or written up under Content so its traits count.',
    ],
    panels: [],
    notices: ['identity'],
    body: raceStep,
  },
  {
    key: 'class',
    title: 'Class',
    intro: [
      'Your class decides your hit die, how fast your attack bonus and saves grow, and how many skill points you get.',
      'Choose a class for each level - typing narrows the list. A different class on a row is multiclassing. With gestalt switched on (under Concept), every level takes a second class as well.',
    ],
    panels: ['levels'],
    notices: ['levels'],
  },
  {
    key: 'abilities',
    title: 'Ability scores',
    intro: [
      'Six scores, from which nearly every other number follows. Choose how they are made: buy them with points, take the standard array, or roll 4d6 six times. Then choose each score from its dropdown; your race’s adjustments are added for you.',
      'With your class chosen, you know which scores matter most.',
    ],
    panels: ['abilities'],
    notices: ['abilities'],
  },
  {
    key: 'skills',
    title: 'Skills',
    intro: [
      'Spend your skill points. Class skills cost one point a rank; others cost two and cap lower. At first level you get four times the usual points.',
      'The sheet works out every total, including ability modifiers and armor check penalties.',
    ],
    panels: ['skills'],
    notices: ['skills'],
  },
  {
    key: 'feats',
    title: 'Feats',
    intro: [
      'Everyone gets a feat at 1st level and another every three levels; a human, a fighter, a wizard and others get more. Each slot lists only the feats you qualify for when you gain it, and what a feat does is counted for you.',
      'Your class features fill in from the class table below. Where the table says so, traits and flaws come next.',
    ],
    panels: ['feats', 'abilitiesList', 'houserules'],
    notices: ['feats', 'houserules', 'trackers'],
  },
  {
    key: 'gear',
    title: 'Hit points & wealth',
    intro: [
      'Hit points are maximum at 1st level and average after, unless you roll.',
      'Starting wealth is wealth by level: at 1st level, the average of your class’s starting gold. Equipment is bought once the character is made, in the sheet’s Shop.',
    ],
    panels: ['hitPoints', 'startingWealth'],
    notices: ['hp', 'wealth'],
  },
  {
    key: 'details',
    title: 'Spells, languages & story',
    intro: [
      'Spells or powers, if your class has them - chosen from the lists your class may use - then the languages you speak, and the story.',
    ],
    panels: ['casting', 'languages', 'text'],
    notices: ['casting', 'languages', 'content'],
  },
  {
    key: 'review',
    title: 'Review',
    intro: [
      'Here is the character as it stands. Anything the sheet thinks is wrong or unfinished is listed; each step link takes you back to fix it.',
      'Finish to open the full sheet, where everything stays editable.',
    ],
    panels: [],
    notices: null,
    body: reviewStep,
  },
];

export const stepIndex = (key) => Math.max(0, WIZARD_STEPS.findIndex((s) => s.key === key));

/** "a", "a and b", "a, b and c". */
export const listed = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * Remember that a step was opened, and that it is no longer skipped. Returns
 * whether anything changed, so the caller knows to save.
 */
export function visitStep(character, key) {
  const meta = character.meta = character.meta || {};
  let changed = false;
  // A draft begun before visits were remembered has been through the steps before its own.
  if (!meta.creatorVisited && meta.wizard?.step) {
    meta.creatorVisited = WIZARD_STEPS.slice(0, stepIndex(meta.wizard.step)).map((s) => s.key);
  }
  if (meta.wizard?.step !== key) { meta.wizard = { step: key }; changed = true; }
  const visited = new Set(meta.creatorVisited || []);
  if (!visited.has(key)) { visited.add(key); meta.creatorVisited = [...visited]; changed = true; }
  if ((meta.creatorSkipped || []).some((s) => s.key === key)) {
    meta.creatorSkipped = meta.creatorSkipped.filter((s) => s.key !== key);
    if (!meta.creatorSkipped.length) delete meta.creatorSkipped;
    changed = true;
  }
  return changed;
}

/** The steps never opened, the review aside. */
export function skippedSteps(character) {
  const visited = new Set(character.meta?.creatorVisited || []);
  return WIZARD_STEPS.filter((s) => s.key !== 'review' && !visited.has(s.key)).map((s) => ({ key: s.key, title: s.title }));
}

/** Leave the creator: the draft is done, and any skipped steps are kept to be flagged. */
export function finishCreator(character, skipped) {
  character.meta = character.meta || {};
  delete character.meta.wizard;
  if (skipped.length) character.meta.creatorSkipped = skipped;
  else delete character.meta.creatorSkipped;
}

/** Which step a notice belongs to, by its field. */
export function stepForNotice(field) {
  return WIZARD_STEPS.find((s) => (s.notices || []).includes(field))?.key || 'review';
}

/**
 * The wizard around one step.
 *
 * @param app    the app, with character, rules, derived, panels
 * @param key    the step
 * @param ways   from app.js: {
 *                 panels: { key: build(app) }, hrefFor(step), fullSheetHref,
 *                 go(step), finish(), choose(path, value),
 *                 variants(), raceChoices()
 *               }
 * @returns { root, panels } - the page, and the panels drawn in it by key
 */
export function wizardPage(app, key, ways) {
  const at = stepIndex(key);
  const step = WIZARD_STEPS[at];
  const next = WIZARD_STEPS[at + 1];
  const back = WIZARD_STEPS[at - 1];
  const panels = {};
  for (const name of step.panels) {
    const built = ways.panels[name]?.(app);
    if (built) panels[name] = built;
  }

  const progress = h('ol.wizard-steps', WIZARD_STEPS.map((s, i) => h(`li.wizard-step${i < at ? '.is-done' : ''}${i === at ? '.is-current' : ''}`,
    h('a', { href: ways.hrefFor(s.key), 'aria-current': i === at ? 'step' : null },
      h('span.wizard-step-number', { text: String(i + 1) }),
      h('span.wizard-step-title', { text: s.title })))));

  const root = h('div.wizard',
    h('div.wizard-top',
      h('div',
        h('p.eyebrow', { text: `New ${app.rules.ruleset.shortName} character` }),
        h('h1.wizard-title', { text: 'Create a character' })),
      h('button.btn.subtle.hint', { type: 'button', onclick: ways.skip, title: 'Steps not yet opened are flagged on the sheet until you come back to them.' }, 'Skip to the full sheet')),
    h('nav.wizard-progress', { 'aria-label': 'Steps' }, progress),
    h('div.wizard-layout',
      h('div.wizard-main',
        h('section.wizard-intro',
          h('p.wizard-count', { text: `Step ${at + 1} of ${WIZARD_STEPS.length}` }),
          h('h2', { text: step.title }),
          step.intro.map((text) => h('p', { text }))),
        step.body ? step.body(app, ways) : null,
        Object.values(panels),
        h('div.wizard-nav',
          back ? button(`Back: ${back.title}`, () => ways.go(back.key), { subtle: true }) : h('span'),
          h('p.wizard-nav-note', { dataset: { wizardNote: '' } }),
          next
            ? h('button.btn.primary', { type: 'button', onclick: () => ways.go(next.key) }, `Next: ${next.title}`)
            : h('button.btn.primary', { type: 'button', onclick: ways.finish }, 'Finish and open the sheet'))),
      h('aside.wizard-side',
        summaryCard(app),
        h('aside#notices.notices'))));

  return { root, panels };
}

/** The running summary beside every step. Its numbers are painted like the sheet's. */
function summaryCard(app) {
  return h('section.wizard-summary', { 'aria-label': 'Your character so far' },
    h('div.wizard-summary-head',
      h('span.wizard-summary-name', { dataset: { wizardName: '' }, text: app.character.name || 'Unnamed' }),
      h('span.wizard-summary-build', { dataset: { wizardBuild: '' } })),
    h('div.wizard-summary-grid',
      total('AC', 'ac.total', { big: true }),
      total('HP', 'hp.total', { big: true }),
      total('BAB', 'summary.bab', { format: 'signed' }),
      total('Init', 'initiative.total', { format: 'signed' }),
      total('Fort', 'saves.fort.total', { format: 'signed' }),
      total('Ref', 'saves.ref.total', { format: 'signed' }),
      total('Will', 'saves.will.total', { format: 'signed' }),
      total('Speed', 'speed')),
    h('div.wizard-summary-abilities', ABILITIES.map((key) => h('div.wizard-ability', { title: ABILITY_NAMES[key] },
      h('span.label', { text: key.toUpperCase() }),
      out(`abilities.${key}.total`),
      out(`abilities.${key}.mod`, { format: 'signed', className: 'mod' })))));
}

/** What the summary shows that is not a derived number: the name and the build in words. */
export function paintWizard(root, app) {
  const name = root.querySelector('[data-wizard-name]');
  if (!name) return;
  name.textContent = app.character.name || 'Unnamed';
  const race = app.character.race?.name;
  const build = app.derived.summary.label && app.derived.summary.label !== '-' ? app.derived.summary.label : '';
  root.querySelector('[data-wizard-build]').textContent = [race, build].filter(Boolean).join(' ') || 'Race and class to come';
}

/* ==========================================================================
   The steps' own parts
   ========================================================================== */

function conceptStep(app, ways) {
  const c = app.character;
  const concept = c.concept || {};
  const small = (label, key, placeholder) => labelled(label, field(`concept.${key}`, concept[key], { placeholder }));
  return h('div.wizard-body',
    h('section.panel', h('div.panel-body',
      row(labelled('Character name', field('name', c.name, { placeholder: 'What they are called', className: 'grow wizard-name-field' }), { wide: true })),
      row(
        labelled('Player', field('player', c.player, { placeholder: 'Who plays them' })),
        labelled('Alignment', select('concept.alignment', concept.alignment || '', ALIGNMENTS)),
        small('Deity', 'deity', 'None')),
      h('details.aside',
        h('summary', 'Appearance'),
        row(small('Gender', 'gender'), small('Age', 'age'), small('Height', 'height'), small('Weight', 'weight')),
        row(small('Eyes', 'eyes'), small('Hair', 'hair'), small('Skin', 'skin'))))),
    h('section.panel', h('div.panel-body',
      h('h3', { text: 'Rules for this character' }),
      ways.variants(),
      h('p.hint', { text: 'Every other variant rule in the SRD - defense bonus, spell points, vitality and wound points and the rest - can be switched on from the sheet\u2019s Rules page.' }))));
}

/**
 * One box for a choice from a list: typing narrows the list, and choosing one
 * (or leaving the box) takes it. A name not on the list can be typed in all the
 * same, for homebrew the sheet does not yet know.
 *
 * @param opts { label, listId, value, choices: [{ name, note }], placeholder, onPick(name) }
 */
function pickerBox(opts) {
  const input = h('input.field.wizard-pick-field', {
    type: 'text',
    value: opts.value,
    placeholder: opts.placeholder,
    autocomplete: 'off',
    'aria-label': opts.label,
    dataset: { unbound: '' },
  });
  input.setAttribute('list', opts.listId);
  input.addEventListener('change', () => {
    const typed = input.value.trim();
    const match = opts.choices.find((c) => c.name.toLowerCase() === typed.toLowerCase());
    const name = match ? match.name : typed;
    if (name !== opts.value) opts.onPick(name);
  });
  return h('div.wizard-pick',
    labelled(opts.label, input),
    h('datalist', { id: opts.listId }, opts.choices.map((c) => h('option', { value: c.name, label: c.note || '' }))));
}

function raceStep(app, ways) {
  const chosen = app.character.race?.name || '';
  const choices = ways.raceChoices();
  const adjust = (a = {}) => Object.entries(a).filter(([, v]) => v).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`).join(', ') || 'no adjustments';
  const picked = choices.find((r) => r.name === chosen);

  return h('div.wizard-body',
    h('section.panel', h('div.panel-body',
      pickerBox({
        label: 'Race',
        listId: 'wizard-race-names',
        value: chosen,
        placeholder: 'Start typing a race',
        choices: choices.map((r) => ({ name: r.name, note: [adjust(r.abilityAdjust), r.la ? `LA +${r.la}` : '', r.custom ? 'homebrew' : ''].filter(Boolean).join(' - ') })),
        onPick: (name) => ways.choose('race.name', name),
      }),
      chosen
        ? (app.derived.race.known
          ? h('div.race-facts',
            picked ? h('p.race-adjust', { text: `Ability adjustments: ${adjust(picked.abilityAdjust)}` }) : null,
            total('Size', 'race.size'),
            total('Speed', 'speed'),
            total('Level adj.', 'race.la', { format: 'signed' }),
            total('Favored class', 'race.favoredClass'),
            h('p.hint.race-traits', { text: app.derived.race.traits }))
          : h('p.hint', { text: `${chosen} is not a race the sheet knows. Its size, speed and adjustments can be entered on the full sheet, or written up under Content.` }))
        : h('p.hint', { text: 'No race chosen yet.' }))));
}

function reviewStep(app, ways) {
  const counts = {};
  for (const n of app.derived.notices) {
    const key = stepForNotice(n.field);
    counts[key] = counts[key] || { error: 0, warn: 0, info: 0 };
    counts[key][n.level] += 1;
  }
  const skipped = skippedSteps(app.character).filter((st) => st.key !== 'review');
  return h('div.wizard-body',
    skipped.length ? h('p.wizard-skipped', { text: `Not opened yet: ${listed(skipped.map((st) => st.title))}. Finishing now flags ${skipped.length === 1 ? 'it' : 'them'} on the sheet.` }) : null,
    h('section.panel', h('div.panel-body',
      h('h3', { text: 'Step by step' }),
      h('ul.wizard-review', WIZARD_STEPS.filter((s) => s.key !== 'review').map((s) => {
        const tally = counts[s.key] || { error: 0, warn: 0, info: 0 };
        const said = [
          tally.error ? `${tally.error} to fix` : '',
          tally.warn ? `${tally.warn} to check` : '',
          tally.info ? `${tally.info} to finish` : '',
        ].filter(Boolean).join(', ');
        return h(`li${tally.error ? '.has-errors' : ''}`,
          h('a', { href: ways.hrefFor(s.key), text: s.title }),
          h('span.hint', { text: said || 'Nothing outstanding' }));
      })))));
}
