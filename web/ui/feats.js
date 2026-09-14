// Feats, traits and flaws, special abilities, and languages: the sheet's
// choices that come from lists, chosen from those lists.
//
// A feat is picked for a slot - the 1st-level feat, a human's bonus feat, a
// fighter's bonus feat - from a dropdown holding only the feats legal there
// (engine/feats.js). What a feat does arrives with it: its effects from
// data/feat-effects.json, its SRD entry a click away. Traits, flaws and
// languages work the same way, from their own indexes. Class features are not
// chosen at all: they are the class table's, listed with their SRD text.

import { h, field, labelled, panel, row, button, refill, total } from './dom.js';
import { effectsEditor } from './effects-editor.js';
import { featOptions, featLabel } from '../engine/feats.js';
import { traitsOfKind, traitEligibility } from '../engine/traits.js';
import { featureKey } from '../engine/features.js';
import { describeTarget } from '../engine/effects.js';
import { loadReference, referenceNow, lookUp, referenceHref } from '../reference.js';
import { referenceCard } from './reference.js';

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const ABILITY_CHOICES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
const lower = (s) => String(s || '').trim().toLowerCase();
const sign = (n) => (n < 0 ? String(n) : `+${n}`);

/** Load a reference once, then draw a panel again so its rows can use it. */
function withReference(app, kind, panelKey) {
  if (referenceNow(kind)) return;
  loadReference(kind).then(() => app.rebuildPanel?.(panelKey)).catch(() => {});
}

/** "About <name>": an entry from the reference, opened in place. */
function about(kind, name, label = null) {
  const entry = lookUp(kind, name);
  if (!entry) return null;
  const holder = h('div.row-reference-body');
  const details = h('details.row-reference', h('summary', { text: label || `About ${entry.name}` }), holder);
  details.addEventListener('toggle', () => {
    if (details.open && !holder.firstChild) refill(holder, referenceCard(kind, entry));
  });
  return details;
}

/** A plain dropdown that manages itself, outside the form binding. */
function chooser(label, value, options, onPick, opts = {}) {
  const el = h('select.field', {
    'aria-label': label,
    dataset: { unbound: '' },
    class: opts.className,
    disabled: opts.disabled,
    onchange: (ev) => onPick(ev.target.value),
  },
  h('option', { value: '', text: opts.empty || '- choose -', selected: !value }),
  options.map((o) => (o.group
    ? h('optgroup', { label: o.group }, o.options.map((x) => h('option', { value: x.value, text: x.text, selected: lower(x.value) === lower(value), disabled: x.disabled })))
    : h('option', { value: o.value, text: o.text, selected: lower(o.value) === lower(value), disabled: o.disabled }))));
  return opts.labelled === false ? el : labelled(label, el);
}

/* ==========================================================================
   Feats
   ========================================================================== */

/** What a feat is taken on, for the choice dropdown. */
function choiceOptions(app, rule, plan, current) {
  const equipment = referenceNow('equipment')?.list || [];
  const weapons = (filter) => equipment.filter((e) => e.family === 'Weapons' && e.subcategory !== 'Ammunition' && filter(e)).map((e) => e.name);
  const held = (name) => plan.held.filter((f) => lower(f.name) === lower(name) && f.choice).map((f) => f.choice);
  let list;
  if (rule.choiceFrom) {
    list = held(rule.choiceFrom);
  } else {
    switch (rule.choice) {
      case 'weapon': list = ['Unarmed strike', 'Grapple', 'Ray', ...weapons(() => true)]; break;
      case 'exoticWeapon': list = weapons((e) => e.category === 'Exotic Weapons'); break;
      case 'martialWeapon': list = weapons((e) => e.category === 'Martial Weapons'); break;
      case 'crossbow': list = ['Hand crossbow', 'Light crossbow', 'Heavy crossbow']; break;
      case 'skill': list = [...new Set(app.derived.skills.lines.map((l) => l.label))].sort(); break;
      case 'school': list = SCHOOLS; break;
      case 'energy': list = ['Acid', 'Cold', 'Electricity', 'Fire', 'Sonic']; break;
      case 'alignmentComponent': list = ['Chaos', 'Evil', 'Good', 'Law']; break;
      case 'power': list = (referenceNow('powers')?.list || []).map((p) => p.name); break;
      default: list = [];
    }
  }
  if (current && !list.some((x) => lower(x) === lower(current))) list = [current, ...list];
  return list.map((x) => ({ value: x, text: x }));
}

/** Every feat that could be picked: the SRD's, and the homebrew this character may use. */
function featCatalogue(app) {
  const srd = app.rules.featRules || [];
  const known = new Set(srd.map((f) => lower(f.name)));
  const homebrew = [
    ...app.derived.index.featByName.values(),
    ...(app.shelfEntries?.('feat') || []),
  ].filter((f) => f?.name && !known.has(lower(f.name)))
    .map((f) => ({ name: f.name, types: [f.category || 'Homebrew'], prerequisite: f.prerequisites || '', homebrew: true }));
  const unique = new Map(homebrew.map((f) => [lower(f.name), f]));
  return [...srd, ...unique.values()];
}

/** What a feat does to the numbers and beyond, in a line. */
function featDoes(app, name, choice) {
  const def = app.rules.featEffects?.feats?.[name];
  if (!def) return null;
  const fill = (text) => String(text).replace(/\{choice\}/g, choice || 'the choice');
  const parts = [
    ...(def.effects || []).map((e) => `${sign(e.value)} ${e.type && e.type !== 'untyped' ? `${e.type} ` : ''}${describeTarget(fill(e.target).toLowerCase().startsWith('weapon.') ? fill(e.target).toLowerCase() : fill(e.target))}${e.condition ? ` ${e.condition}` : ''}`),
    ...(def.notes || []).map(fill),
  ];
  return parts.length ? parts.join('; ') : null;
}

export function featsPanel(app) {
  const c = app.character;
  const d = app.derived;
  const plan = d.featPlan;
  const tf = d.modules.traitsFlaws;
  withReference(app, 'feats', 'feats');
  withReference(app, 'equipment', 'feats');
  if (tf) withReference(app, 'traits', 'feats');
  c.feats = c.feats || [];

  const changed = () => { app.recompute(); app.rebuildPanel('feats'); if (app.panels.abilitiesList) app.rebuildPanel('abilitiesList'); if (app.panels.trackers) app.rebuildPanel('trackers'); };
  const catalogue = featCatalogue(app);

  const setFeat = (slot, name) => {
    if (slot.row !== null && slot.row !== undefined) {
      if (!name) c.feats.splice(slot.row, 1);
      else {
        const was = c.feats[slot.row];
        c.feats[slot.row] = { ...was, name, slot: slot.id, ...(lower(was.name) !== lower(name) ? { choice: null } : {}) };
      }
    } else if (name) {
      c.feats.push({ name, slot: slot.id, choice: null, effects: [] });
    }
    if (name) app.adopt?.('feat', name);
    changed();
  };

  const slotRow = (slot) => {
    const options = featOptions(slot, plan, c, d, app.rules, catalogue);
    const byType = new Map();
    for (const o of options) {
      const type = o.rule.homebrew ? 'Homebrew' : (o.rule.types || ['General']).find((t) => t !== 'General') || 'General';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push({ value: o.name, text: o.check.unchecked.length ? `${o.name} *` : o.name });
    }
    const groups = [...byType.entries()].sort(([a], [b]) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b)))
      .map(([group, list]) => ({ group, options: list.sort((x, y) => x.text.localeCompare(y.text)) }));
    const current = slot.feat?.name || '';
    if (current && !options.some((o) => lower(o.name) === lower(current))) {
      groups.unshift({ group: 'Chosen', options: [{ value: current, text: `${current} (not legal here)` }] });
    }
    const rule = slot.rule;
    const does = slot.feat ? featDoes(app, slot.feat.name, slot.feat.choice) : null;
    return h(`li.feat-slot${slot.check && !slot.check.ok ? '.is-illegal' : ''}${slot.feat ? '' : '.is-open'}`,
      h('div.feat-slot-head',
        h('span.feat-slot-label', { text: slot.label }),
        slot.listLabel ? h('span.hint', { text: slot.listLabel }) : null,
        slot.ignorePrerequisites ? h('span.tag', { text: 'no prerequisites' }) : null),
      h('div.row.feat-slot-choice',
        chooser(`Feat for ${slot.label}`, current, groups, (name) => setFeat(slot, name), { labelled: false, empty: options.length ? '- choose a feat -' : '- none qualify yet -', className: 'grow' }),
        rule?.choice || rule?.choiceFrom
          ? chooser(`${slot.feat.name} applies to`, slot.feat.choice || '', choiceOptions(app, rule, plan, slot.feat.choice), (choice) => {
            c.feats[slot.row].choice = choice || null;
            changed();
          }, { labelled: false, empty: '- applies to -' })
          : null),
      does ? h('p.feat-does', { text: does }) : null,
      slot.check && !slot.check.ok ? h('p.hint.is-error', { text: `Not legal here: ${slot.check.unmet.join('; ')}.` }) : null,
      slot.check?.unchecked.filter((u) => u !== 'not an SRD feat').length
        ? h('p.hint', { text: `The sheet cannot check: ${slot.check.unchecked.filter((u) => u !== 'not an SRD feat').join('; ')}.` })
        : null,
      slot.feat ? about('feats', slot.feat.name) : null);
  };

  // Rows in no slot: homebrew typed in by hand, or more feats than slots.
  const inSlots = new Set(plan.slots.map((s) => s.row).filter((r) => r !== null && r !== undefined));
  const loose = c.feats.map((row, i) => ({ row, i })).filter(({ i }) => !inSlots.has(i));
  const otherHost = h('div.list');
  refill(otherHost, loose.map(({ row: entry, i }) => {
    const fromContent = d.index.featByName.get(entry.name);
    return h('div.effect-list-row',
      h('div.list-row',
        field(`feats.${i}.name`, entry.name, { list: 'feat-names', placeholder: 'Homebrew feat', className: 'grow' }),
        fromContent || lookUp('feats', entry.name) ? null : field(`feats.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
        button('x', () => { c.feats.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Remove' })),
      fromContent || lookUp('feats', entry.name) ? null : h('details.row-effects', { open: (entry.effects || []).length > 0 },
        h('summary', (entry.effects || []).length ? `${entry.effects.length} effect${entry.effects.length === 1 ? '' : 's'}` : 'Effects'),
        effectsEditor(`feats.${i}.effects`, () => (c.feats[i].effects = c.feats[i].effects || []), {
          skillNames: d.index.skills.map((s) => s.name),
          emptyText: 'None. Add one and this feat changes the sheet.',
          onShapeChange: () => app.recompute(),
        })));
  }));

  return panel('feats', tf ? 'Feats, traits and flaws' : 'Feats',
    h('div.summary-strip',
      total('Feats earned', 'feats.allowed'),
      total('Taken', 'feats.taken'),
      total('From levels', 'feats.fromLevels'),
      total('Class bonus', 'feats.fromClasses'),
      tf ? total('From flaws', 'feats.fromFlaws') : null,
      h('span.hint', { text: 'Each slot lists only the feats this character qualifies for at the level the slot was gained. What a feat does is counted for you.' })),
    plan.granted.length
      ? h('div.block', h('h3', 'Granted'),
        h('ul.feat-granted', plan.granted.map((g) => h('li',
          h('span.feat-granted-name', { text: featLabel(g.name, g.choice) }),
          h('span.hint', { text: g.source }),
          about('feats', g.name)))))
      : null,
    h('div.block', h('h3', 'Feats'),
      plan.slots.length ? h('ol.feat-slots', plan.slots.map(slotRow)) : h('p.empty', { text: 'No feats yet: choose a class on the Character page.' })),
    h('details.block.feat-other', { open: loose.length > 0 },
      h('summary', loose.length ? `Other feats (${loose.length})` : 'Other feats'),
      h('p.hint', { text: 'A homebrew feat, or one a story gave. It fills no slot; say where it came from in Bonus feats.' }),
      otherHost,
      row(
        button('Add a homebrew feat', () => { c.feats.push({ name: '', slot: 'other', effects: [] }); changed(); }, { subtle: true }),
        labelled('Bonus feats granted', field('featSlots.bonus', c.featSlots?.bonus, { type: 'int', width: '3.5rem', title: 'Feats given by something other than a class or race - a story, a boon. A class’s and a race’s are already counted.' })),
        h('a.hint', { href: '#/content/feat', text: 'Write a feat of your own' }))),
    tf
      ? traitsAndFlaws(app, changed)
      : h('p.hint', { text: app.rules.campaign
        ? 'Traits and flaws (Unearthed Arcana) are off in this campaign.'
        : 'Traits and flaws (Unearthed Arcana) are an optional rule: switch them on under Rules for this character, and each flaw buys a feat.' }));
}

/* ==========================================================================
   Traits and flaws
   ========================================================================== */

function traitsAndFlaws(app, changed) {
  const c = app.character;
  const d = app.derived;
  const limits = app.rules.ruleset.traitsFlaws || app.rules.rulesets?.srd?.traitsFlaws || { traits: 2, flaws: 2 };
  const ctx = d.traitContext;

  const picker = (kind, limit) => {
    const key = kind === 'trait' ? 'traits' : 'flaws';
    c[key] = c[key] || [];
    const known = traitsOfKind(app.rules, kind);
    const rows = [];
    const count = Math.max(limit, c[key].length);
    for (let i = 0; i < count; i++) {
      const entry = c[key][i] || null;
      const def = entry ? known.get(lower(entry.name)) : null;
      if (entry && entry.name && !def) {
        // A trait written before the list existed: kept as it was typed.
        rows.push(h('li.trait-row', h('div.list-row',
          field(`${key}.${i}.name`, entry.name, { className: 'grow' }),
          field(`${key}.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
          button('x', () => { c[key].splice(i, 1); changed(); }, { subtle: true, danger: true }))));
        continue;
      }
      const taken = new Set(c[key].filter((r, j) => j !== i && r?.name).map((r) => lower(r.name)));
      const options = [...known.values()]
        .filter((t) => t.multiple || !taken.has(lower(t.name)))
        .map((t) => {
          const check = traitEligibility(t, ctx);
          return { value: t.name, text: check.ok ? t.name : `${t.name} (needs ${check.unmet.join('; ')})`, disabled: !check.ok && lower(t.name) !== lower(entry?.name) };
        });
      const set = (name) => {
        if (!name) { if (entry) c[key].splice(i, 1); } else if (entry) c[key][i] = { name, choice: lower(entry.name) === lower(name) ? entry.choice : null };
        else c[key].push({ name, choice: null });
        changed();
      };
      const choice = def?.choice ? traitChoice(app, def, entry, (value) => { c[key][i].choice = value || null; changed(); }) : null;
      rows.push(h('li.trait-row',
        h('div.row',
          chooser(`${kind === 'trait' ? 'Trait' : 'Flaw'} ${i + 1}`, entry?.name || '', options, set, { labelled: false, className: 'grow', empty: `- ${kind === 'trait' ? 'a trait' : 'a flaw'} -` }),
          choice),
        def ? h('p.feat-does', { text: kind === 'trait' ? `${def.benefit} ${def.drawback}` : def.effect }) : null,
        def ? about('traits', def.id || def.name) : null));
    }
    return h('div.block',
      h('h3', kind === 'trait' ? 'Traits' : 'Flaws'),
      h('p.hint', { text: kind === 'trait'
        ? `Up to ${limit}, chosen at 1st level. Each gives a benefit and a matching drawback, both counted on the sheet.`
        : `Up to ${limit}, chosen at 1st level. Each is a penalty, and buys a bonus feat.` }),
      h('ol.trait-rows', rows));
  };

  return h('div.traits-flaws', picker('trait', limits.traits), picker('flaw', limits.flaws));
}

function traitChoice(app, def, entry, onPick) {
  const kind = def.choice.kind;
  let options;
  if (kind === 'ability') options = ABILITY_CHOICES.map(([value, text]) => ({ value, text }));
  else if (kind === 'school') options = SCHOOLS.map((s) => ({ value: s, text: s }));
  else if (kind === 'subjectSkill') {
    options = app.derived.skills.lines.filter((l) => def.choice.skills.includes(l.name) && l.subtype).map((l) => ({ value: l.label, text: l.label }));
    if (!options.length) options = [{ value: '', text: 'Add a Craft, Knowledge or Profession skill first', disabled: true }];
  } else {
    const exclude = new Set(def.choice.exclude || []);
    options = [...new Set(app.derived.skills.lines.map((l) => l.name))].filter((n) => !exclude.has(n)).sort().map((n) => ({ value: n, text: n }));
  }
  return chooser(`${def.name} applies to`, entry?.choice || '', options, onPick, { labelled: false, empty: '- applies to -' });
}

/* ==========================================================================
   Special abilities: class features, racial traits, and what is not a number
   ========================================================================== */

/** A class's feature descriptions, from its SRD text, by feature key. */
const descriptionCache = new Map();
function classDescriptions(className) {
  if (descriptionCache.has(className)) return descriptionCache.get(className);
  const cls = lookUp('classes', className);
  if (!cls?.text) return null;
  const sections = [];
  let current = null;
  for (const chunk of cls.text.split(/(?=<p>)/)) {
    const head = chunk.match(/^<p><b>([^<]+?)<\/b>/);
    if (head) {
      const title = head[1].replace(/:\s*$/, '').replace(/\s*\((Ex|Su|Sp)\)\s*$/i, '').trim();
      current = { title, key: featureKey(title), html: chunk };
      sections.push(current);
    } else if (current && !/^<p><h5>/.test(chunk)) {
      current.html += chunk;
    } else {
      current = null;
    }
  }
  descriptionCache.set(className, sections);
  return sections;
}

function featureDescription(className, key) {
  const sections = classDescriptions(className);
  if (!sections) return null;
  return sections.find((s) => s.key === key)
    || sections.find((s) => s.key.startsWith(key) || key.startsWith(s.key))
    || sections.find((s) => s.key.includes(key))
    || null;
}

export function abilitiesListPanel(app) {
  const d = app.derived;
  const c = app.character;
  withReference(app, 'classes', 'abilitiesList');
  const changed = () => { app.recompute(); app.rebuildPanel('abilitiesList'); if (app.panels.trackers) app.rebuildPanel('trackers'); };

  const byClass = new Map();
  for (const f of d.classFeatures || []) {
    if (!byClass.has(f.className)) byClass.set(f.className, []);
    byClass.get(f.className).push(f);
  }
  const trackerFor = (f) => (d.trackers || []).find((t) => (t.source === f.className && featureKey(t.name).startsWith(f.key)) || (f.domain && t.source === `${f.domain} domain`));

  const featureRow = (f) => {
    const tracker = trackerFor(f);
    const desc = f.domain ? null : featureDescription(f.className, f.key);
    const body = h('div.row-reference-body');
    const details = f.domain || desc
      ? h('details.row-reference', h('summary', { text: 'What it does' }), body)
      : null;
    details?.addEventListener('toggle', () => {
      if (!details.open || body.firstChild) return;
      if (f.domain) refill(body, referenceCard('domains', lookUp('domains', f.domain)) || h('p', { text: f.text }));
      else refill(body, h('div.reference-text', { html: desc.html }));
    });
    const step = f.latest && lower(f.latest) !== lower(f.name) ? f.latest : null;
    return h('li.ability-row',
      h('div.ability-row-head',
        h('span.ability-row-name', { text: f.name }),
        step && !f.domain ? h('span.tag', { text: step.replace(new RegExp(`^${f.key}\\s*`, 'i'), '') || step }) : null,
        h('span.hint', { text: f.domain ? 'granted power' : `from ${f.className} ${f.gained}` }),
        tracker ? h('span.tag', { text: `${tracker.remaining} of ${tracker.max}${tracker.unit ? ` ${tracker.unit}` : ''} left today`, title: 'Tracked under Limited uses.' }) : null),
      f.domain ? h('p.hint', { text: f.text }) : null,
      details);
  };

  const racial = d.race?.traits;
  const notes = d.specialNotes || [];
  const features = effectRowsFor(app, changed);

  return panel('abilitiesList', 'Special abilities',
    byClass.size
      ? [...byClass.entries()].map(([className, list]) => h('div.block',
        h('h3', { text: `${className} features` }),
        h('ul.ability-rows', list.map(featureRow))))
      : h('p.empty', { text: 'No class features yet. They fill in from the class tables as levels are taken.' }),
    racial ? h('div.block', h('h3', { text: `${d.race.name} traits` }), h('p', { text: racial })) : null,
    notes.length
      ? h('div.block', h('h3', 'From feats, traits and flaws'),
        h('ul.ability-rows', notes.map((n) => h('li.ability-row', h('div.ability-row-head', h('span.ability-row-name', { text: n.source }), h('span.hint', { text: n.kind })), h('p', { text: n.text })))))
      : null,
    h('details.block', { open: (c.features || []).some((f) => f?.name) },
      h('summary', 'Other abilities'),
      h('p.hint', { text: 'A boon, a bloodline, a curse - anything else the character has. Give it effects and it changes the sheet; give it uses and it is tracked.' }),
      features.host,
      button('Add an ability', () => { c.features = c.features || []; c.features.push({ name: '', effect: '', effects: [] }); changed(); }, { subtle: true })));
}

function effectRowsFor(app, changed) {
  const c = app.character;
  const host = h('div.list');
  refill(host, (c.features || []).map((entry, i) => {
    const fromContent = app.derived.index.featureByName?.get(entry.name);
    const fx = entry.effects || [];
    return h('div.effect-list-row',
      h('div.list-row',
        field(`features.${i}.name`, entry.name, { list: 'feature-names', placeholder: 'Ability', className: 'grow' }),
        field(`features.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
        labelled('Uses', field(`features.${i}.uses`, entry.uses, { type: 'int', width: '3.5rem', placeholder: fromContent?.uses ? String(fromContent.uses) : '-' })),
        button('x', () => { c.features.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Remove' })),
      h('details.row-effects', { open: fx.length > 0 },
        h('summary', fx.length ? `${fx.length} effect${fx.length === 1 ? '' : 's'}` : 'Effects'),
        effectsEditor(`features.${i}.effects`, () => (c.features[i].effects = c.features[i].effects || []), {
          skillNames: app.derived.index.skills.map((s) => s.name),
          emptyText: fromContent ? 'Nothing added here beyond what the content entry already does.' : 'None. Add one and this row changes the sheet.',
          onShapeChange: () => app.recompute(),
        })));
  }));
  return { host };
}

/* ==========================================================================
   Languages
   ========================================================================== */

export function languagesPanel(app) {
  const c = app.character;
  const plan = app.derived.languages;
  withReference(app, 'languages', 'languages');
  const changed = () => { app.recompute(); app.rebuildPanel('languages'); };
  c.languages = Array.isArray(c.languages) ? c.languages : [];

  const chip = (name, tag, remove) => h('li.language-chip',
    h('a', { href: referenceHref('languages', name), text: name }),
    tag ? h('span.tag', { text: tag }) : null,
    remove ? button('x', remove, { subtle: true, danger: true, title: `Forget ${name}` }) : null);

  const left = (plan.bonusAllowed - plan.bonusUsed) + (plan.skillAllowed - plan.skillUsed);
  return panel('languages', 'Languages',
    h('div.summary-strip',
      h('div.total', h('span.label', { text: 'Bonus languages' }), h('span.out', { text: `${plan.bonusUsed} of ${plan.bonusAllowed}` })),
      h('div.total', h('span.label', { text: 'From Speak Language' }), h('span.out', { text: `${plan.skillUsed} of ${plan.skillAllowed}` })),
      h('span.hint', { text: 'One bonus language per point of Intelligence bonus at 1st level, from the lists below; each rank of Speak Language buys any language but a secret one.' })),
    h('ul.language-chips',
      plan.automatic.map((name) => chip(name, 'automatic')),
      plan.chosen.map((x) => chip(x.name, x.via === 'bonus' ? 'bonus' : x.via === 'skill' ? 'Speak Language' : 'not legal', () => {
        c.languages = c.languages.filter((n) => lower(n) !== lower(x.name));
        changed();
      }))),
    row(
      chooser('Learn a language', '', plan.available.map((n) => ({ value: n, text: n })), (name) => {
        if (!name) return;
        c.languages.push(name);
        changed();
      }, { disabled: !left || !plan.available.length, empty: left ? '- a language -' : '- none left to learn -' }),
      h('span.hint', { text: plan.bonusFrom === 'any'
        ? 'Bonus languages: any but a secret one.'
        : `Bonus languages: ${plan.bonusFrom.join(', ') || 'none'}.` })),
    plan.illiterate ? h('p.hint', { text: 'A barbarian is illiterate: the languages are spoken, not read.' }) : null,
    c.text?.languages ? h('p.hint', { text: `Written before: ${c.text.languages}` }) : null);
}
