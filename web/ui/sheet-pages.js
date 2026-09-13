// The sheet, a page at a time.
//
//   #/sheet/<id>/<page>
//
// Each page is some of the sheet's panels. They are the same panels, bound the
// same way, over the same derived character - a page only chooses which to draw
// - so every number agrees from page to page. The notices beside a page are the
// ones about it, with a count of the rest; the "Full sheet" page draws every
// panel, and is what prints.

import { h } from './dom.js';

/**
 * `panels` are keys of PANELS in app.js; `notices` are the notice fields the
 * page answers for (see engine/derive.js). `label` may depend on the character:
 * the magic page is Spells, Powers, or both.
 */
export const SHEET_PAGES = [
  { key: 'character', label: 'Character', panels: ['identity', 'levels', 'abilities'], notices: ['identity', 'levels', 'abilities'] },
  { key: 'combat', label: 'Combat', panels: ['combat', 'effects'], notices: ['hp', 'effects'] },
  { key: 'skills', label: 'Skills', panels: ['skills'], notices: ['skills'] },
  { key: 'feats', label: 'Feats & abilities', panels: ['trackers', 'feats', 'houserules'], notices: ['feats', 'houserules', 'trackers'] },
  {
    key: 'magic',
    label: (d) => magicLabel(d),
    panels: ['casting'],
    notices: ['casting'],
    visible: (d) => (d.casting || []).length > 0,
  },
  { key: 'gear', label: 'Gear & wealth', panels: ['wealth'], notices: ['wealth'] },
  { key: 'story', label: 'Story', panels: ['text'], notices: [] },
  { key: 'rules', label: 'Rules', panels: ['variants', 'content'], notices: ['content', 'variants'] },
  { key: 'all', label: 'Full sheet', panels: null, notices: null },
];

/** Spells, Powers, or Spells & powers, by what the character casts and manifests. */
export function magicLabel(d) {
  const kinds = new Set((d.casting || []).map((c) => c.kind));
  if (kinds.has('casting') && kinds.has('manifesting')) return 'Spells & powers';
  return kinds.has('manifesting') ? 'Powers' : 'Spells';
}

export const pageFor = (key) => SHEET_PAGES.find((p) => p.key === key) || SHEET_PAGES[0];

/** The page a notice is about, by its field. */
export function pageForNotice(field) {
  return SHEET_PAGES.find((p) => (p.notices || []).includes(field))?.key || 'character';
}

/** The row of page tabs across the top of the sheet. */
export function sheetTabs(characterId, current, derived) {
  return h('nav.sheet-tabs', { 'aria-label': 'Sheet pages' },
    SHEET_PAGES.filter((p) => !p.visible || p.visible(derived) || p.key === current).map((p) => h('a.sheet-tab', {
      href: `#/sheet/${characterId}/${p.key}`,
      class: p.key === current ? 'is-active' : '',
      'aria-current': p.key === current ? 'page' : null,
    }, typeof p.label === 'function' ? p.label(derived) : p.label)));
}
