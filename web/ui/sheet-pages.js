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
  { key: 'character', label: 'Character', panels: ['identity', 'levels', 'classChoices', 'abilities', 'languages'], notices: ['identity', 'levels', 'abilities', 'languages', 'creator'] },
  { key: 'combat', label: 'Combat', panels: ['combat', 'attackCards', 'variantCombat', 'effects'], notices: ['hp', 'effects'] },
  { key: 'skills', label: 'Skills', panels: ['skills'], notices: ['skills'] },
  { key: 'feats', label: 'Feats & abilities', panels: ['trackers', 'variantTracks', 'abilitiesList', 'feats', 'houserules'], notices: ['feats', 'houserules', 'trackers'] },
  {
    key: 'magic',
    label: (d) => magicLabel(d),
    panels: ['casting'],
    notices: ['casting'],
    visible: (d) => (d.casting || []).length > 0,
  },
  { key: 'equipment', label: 'Equipment', panels: ['equipment'], notices: ['equipment'] },
  { key: 'inventory', label: 'Inventory', panels: ['inventory'], notices: ['inventory', 'wealth'] },
  { key: 'shop', label: 'Shop', panels: ['shop'], notices: [] },
  { key: 'story', label: 'Story', panels: ['text'], notices: [] },
  { key: 'rules', label: 'Rules', panels: ['rulesInPlay', 'content'], notices: ['content', 'variants'] },
  { key: 'history', label: 'History', panels: ['history'], notices: [], visible: (d, c) => (c?.history || []).length > 0 },
  { key: 'all', label: 'Full sheet', panels: null, notices: null },
];

/** Spells, Powers, or Spells & powers, by what the character casts and manifests. */
export function magicLabel(d) {
  const kinds = new Set((d.casting || []).map((c) => c.kind));
  if (kinds.has('casting') && kinds.has('manifesting')) return 'Spells & powers';
  return kinds.has('manifesting') ? 'Powers' : 'Spells';
}

// The Gear & wealth page became Equipment, Inventory and Shop; an old link still lands.
export const pageFor = (key) => SHEET_PAGES.find((p) => p.key === (key === 'gear' ? 'inventory' : key)) || SHEET_PAGES[0];

/** The page a notice is about, by its field. */
export function pageForNotice(field) {
  return SHEET_PAGES.find((p) => (p.notices || []).includes(field))?.key || 'character';
}

/** The row of page tabs across the top of the sheet. */
export function sheetTabs(characterId, current, derived, character = null) {
  return h('nav.sheet-tabs', { 'aria-label': 'Sheet pages' },
    SHEET_PAGES.filter((p) => !p.visible || p.visible(derived, character) || p.key === current).map((p) => h('a.sheet-tab', {
      href: `#/sheet/${characterId}/${p.key}`,
      class: p.key === current ? 'is-active' : '',
      'aria-current': p.key === current ? 'page' : null,
    }, typeof p.label === 'function' ? p.label(derived) : p.label)));
}
