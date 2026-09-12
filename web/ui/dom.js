// Building and updating the page, without a framework.
//
// A character sheet is a form, and a form has one hard requirement: typing in a
// field must never move the caret. So this app never re-renders an input that
// exists. Inputs are created once and bound to a path in the character by name;
// typing writes straight to the model, the model is recomputed, and only the
// DERIVED outputs are repainted. Lists that can grow (levels, skills, items)
// are rebuilt on their own, but only when a row is added or removed - never
// while someone is typing in one.
//
// That single rule is why there is no virtual DOM here and no need for one.

/** h('div#id.panel.wide', { ... }, child, child) - tag, id and classes. */
export function h(spec, attrs, ...children) {
  const [head, ...classes] = String(spec).split('.');
  const [tag, id] = head.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');

  if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list' && key !== 'form') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  f.append(...children.flat(Infinity).filter(Boolean));
  return f;
};

/* --------------------------------------------------------------------------
   Paths

   Fields name where they live - "abilities.base.str", "gear.armor.maxDex" -
   and these two walk that. Numeric segments make arrays, so "skills.3.ranks"
   works without the caller knowing whether skills exists yet.
   -------------------------------------------------------------------------- */

export function getPath(object, path) {
  return String(path).split('.').reduce((o, k) => (o === null || o === undefined ? o : o[k]), object);
}

export function setPath(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (node[key] === null || node[key] === undefined) {
      node[key] = /^\d+$/.test(keys[keys.indexOf(key) + 1] ?? last) ? [] : {};
    }
    node = node[key];
  }
  node[last] = value;
  return object;
}

/* --------------------------------------------------------------------------
   Fields
   -------------------------------------------------------------------------- */

/**
 * A bound input. `path` is where it reads and writes; the app listens for
 * input events at the root and needs nothing else from the caller.
 *
 * type 'int' keeps the value numeric, which matters because "" from an empty
 * field would otherwise poison every sum it takes part in.
 */
export function field(path, value, opts = {}) {
  const { type = 'text', placeholder, list, min, max, step, title, className = '', width } = opts;
  const el = h('input', {
    class: `field ${className}`.trim(),
    type: type === 'int' || type === 'number' ? 'number' : type,
    value: value === null || value === undefined ? '' : value,
    placeholder,
    title,
    min, max, step,
    dataset: { field: path, kind: type },
  });
  if (list) el.setAttribute('list', list);
  if (width) el.style.width = width;
  return el;
}

export function checkbox(path, value, label, opts = {}) {
  return h('label.check', { title: opts.title },
    h('input', { type: 'checkbox', checked: Boolean(value), dataset: { field: path, kind: 'bool' } }),
    h('span', { text: label }));
}

export function select(path, value, options, opts = {}) {
  const el = h('select.field', {
    dataset: { field: path, kind: 'text' },
    title: opts.title,
    class: opts.className,
  });
  for (const option of options) {
    const [v, label] = Array.isArray(option) ? option : [option, option];
    el.append(h('option', { value: v, text: label, selected: String(v) === String(value ?? '') }));
  }
  return el;
}

export function textarea(path, value, opts = {}) {
  return h('textarea.field.text-block', {
    value: value || '',
    rows: opts.rows || 6,
    placeholder: opts.placeholder,
    dataset: { field: path, kind: 'text' },
  });
}

/** A labelled cell. The label is small caps above the control, as on paper. */
export function labelled(label, control, opts = {}) {
  return h(`div.cell${opts.wide ? '.wide' : ''}`, { title: opts.title },
    h('span.label', { text: label }),
    control);
}

/**
 * A derived number: the thing the sheet works out for you.
 *
 * It is not an input, because there is nothing to type. `out` names the path
 * into the derived sheet, and paint() fills every one of these after any edit.
 */
export function out(path, opts = {}) {
  return h(`span.out${opts.big ? '.big' : ''}${opts.className ? `.${opts.className}` : ''}`, {
    dataset: { out: path, ...(opts.format ? { format: opts.format } : {}) },
    title: opts.title,
    text: '-',
  });
}

/** A derived number with a label, styled as the boxed totals on a sheet. */
export function total(label, path, opts = {}) {
  return h(`div.total${opts.big ? '.big' : ''}`, { title: opts.title },
    h('span.label', { text: label }),
    out(path, { big: opts.big, format: opts.format }));
}

export const signedFormat = (n) => (n === null || n === undefined || Number.isNaN(n) ? '-' : (n < 0 ? String(n) : `+${n}`));

const FORMATS = {
  signed: signedFormat,
  gp: (n) => (n === null || n === undefined ? '-' : `${Math.round(Number(n)).toLocaleString()} gp`),
  plain: (n) => (n === null || n === undefined || n === '' ? '-' : String(n)),
  // A class skill is shown as a filled dot rather than the word "true".
  dot: (v) => (v ? '●' : '○'),
  // Taint severity reads as a word, and the class it carries colours it.
  severity: (v) => (v && v !== 'none' ? String(v) : 'none'),
  // An over-cap item needs a mark, not a boolean.
  cap: (v) => (v ? 'over cap' : ''),
};

/**
 * Fill every derived output on the page from a freshly computed sheet.
 *
 * One pass over the outputs beats keeping a subscription per number: there are
 * a few hundred of them, it runs in well under a frame, and nothing can get out
 * of step with anything else.
 */
export function paint(root, derived) {
  for (const el of root.querySelectorAll('[data-out]')) {
    const raw = getPath(derived, el.dataset.out);
    const format = FORMATS[el.dataset.format] || FORMATS.plain;
    const value = typeof raw === 'function' ? undefined : raw;
    el.textContent = format(value);
    el.classList.toggle('is-negative', typeof value === 'number' && value < 0);
    if (el.dataset.format === 'severity') el.dataset.severity = value || 'none';
    if (el.dataset.format === 'cap') el.classList.toggle('is-over', Boolean(value));
    if (el.dataset.format === 'dot') el.classList.toggle('is-on', Boolean(value));
  }
}

/** A section of the sheet. `id` is what a notice points at. */
export function panel(id, title, ...children) {
  return h('section.panel', { id: `panel-${id}`, dataset: { panel: id } },
    h('h2.panel-title', h('span', { text: title })),
    h('div.panel-body', ...children));
}

export function row(...children) {
  return h('div.row', ...children);
}

export function button(label, onclick, opts = {}) {
  return h(`button.btn${opts.subtle ? '.subtle' : ''}${opts.danger ? '.danger' : ''}`, {
    type: 'button', onclick, title: opts.title, class: opts.className,
  }, label);
}

/** Replace a container's children in one go, for lists that grow and shrink. */
export function refill(container, ...children) {
  container.replaceChildren(...children.flat(Infinity).filter(Boolean));
  return container;
}
