// The effects editor: a small table of "what this changes".
//
// It is the same control wherever an effect can live - on a homebrew race in
// the content library, on a feat row on a sheet, on a magic item - and it binds
// through the ordinary [data-field] paths, so whichever form it sits in saves it
// like any other field. Only adding and removing a row is handled here, because
// that changes the shape of the list.

import { h, field, select, checkbox, button, refill } from './dom.js';
import { TARGETS } from '../engine/effects.js';
import { BONUS_TYPES } from '../engine/library.js';

const GROUPS = [
  ['Abilities', ['ability.str', 'ability.dex', 'ability.con', 'ability.int', 'ability.wis', 'ability.cha']],
  ['Defense', ['ac', 'spellResistance']],
  ['Saving throws', ['save.all', 'save.fort', 'save.ref', 'save.will']],
  ['Attacks and damage', ['attack.all', 'attack.melee', 'attack.ranged', 'damage.melee', 'damage.ranged', 'grapple']],
  ['Everything else', ['initiative', 'speed', 'hp', 'skillPoints.perLevel', 'feats.bonus']],
];

/** Every target as <optgroup>s, with each skill the sheet knows listed by name. */
function targetOptions(selected, skillNames) {
  const el = h('select.field.effect-target', { dataset: { kind: 'text' } });
  el.append(h('option', { value: '', text: '- changes what -', selected: !selected }));
  for (const [label, targets] of GROUPS) {
    el.append(h('optgroup', { label },
      targets.map((t) => h('option', { value: t, text: TARGETS[t], selected: t === selected }))));
  }
  el.append(h('optgroup', { label: 'Skills' },
    h('option', { value: 'skill.*', text: 'all skills', selected: selected === 'skill.*' }),
    skillNames.map((name) => h('option', { value: `skill.${name}`, text: name, selected: selected === `skill.${name}` }))));

  // A target this list does not offer - a typo, or a skill from content not yet
  // loaded - is kept visible rather than silently replaced with the first option.
  if (selected && ![...el.options].some((o) => o.value === selected)) {
    el.append(h('option', { value: selected, text: `${selected} (not recognised)`, selected: true }));
  }
  return el;
}

/**
 * @param basePath  where the effects array lives in the bound model, e.g.
 *                  "feats.2.effects" on a sheet, or "effects" in the editor
 * @param getList   returns the live array (created if missing)
 * @param opts.skillNames  the skills to offer as targets
 * @param opts.onShapeChange  called after a row is added or removed
 */
export function effectsEditor(basePath, getList, opts = {}) {
  const host = h('div.effects-rows');
  const skillNames = opts.skillNames || [];

  const rebuild = () => {
    const list = getList();
    refill(host, list.length
      ? [
        h('div.effect-head',
          h('span.label', { text: 'Changes' }),
          h('span.label', { text: 'Bonus type' }),
          h('span.label', { text: 'By' }),
          h('span.label', { text: 'Only when' }),
          h('span.label', { text: '' }),
          h('span.label', { text: '' })),
        list.map((effect, i) => {
          const path = `${basePath}.${i}`;
          const target = targetOptions(effect.target, skillNames);
          target.dataset.field = `${path}.target`;
          return h('div.effect-row',
            target,
            select(`${path}.type`, effect.type || 'untyped', BONUS_TYPES.map((t) => [t, t]), { className: 'effect-type' }),
            field(`${path}.value`, effect.value, { type: 'int', className: 'effect-value' }),
            field(`${path}.condition`, effect.condition, {
              placeholder: 'always',
              className: 'effect-condition',
              title: 'Leave empty for an effect that always applies. Anything written here - "against poison", "while raging" - makes it a note beside the number instead of part of it.',
            }),
            checkbox(`${path}.perLevel`, effect.perLevel, 'per HD', { title: 'Multiply by hit dice: +1 hit point per level, say.' }),
            button('x', () => {
              getList().splice(i, 1);
              rebuild();
              opts.onShapeChange?.();
            }, { subtle: true, danger: true, title: 'Remove this effect' }));
        }),
      ]
      : h('p.hint.effects-empty', { text: opts.emptyText || 'No effects. As written, this is text only and changes no numbers.' }));
  };

  rebuild();
  return h('div.effects-editor',
    host,
    button('Add an effect', () => {
      getList().push({ target: '', type: 'untyped', value: 0, condition: '', perLevel: false });
      rebuild();
      opts.onShapeChange?.();
    }, { subtle: true }));
}
