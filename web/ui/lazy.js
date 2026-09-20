// The parts of the app that are fetched when they are wanted, and not before.
//
// A player opening a fighter's sheet has no use for the spell panel's code,
// the shop, the Accounts page or the campaign pages, and downloading them is
// time spent before the sheet appears. Each of those is named here and fetched
// on the way to the page or panel that needs it. What a sheet needs is decided
// by the modules in its file (engine/sheet-modules.js).
//
//   await parts('magic', 'inventory')   fetch them (or return at once, if held)
//   part('magic')                       what was fetched, or null
//
// Everything else - the header, the roster, the sheet's own panels, the
// creator - is part of the app proper and is loaded with it. A module fetched
// once is kept for the rest of the visit, and the service worker keeps it for
// the next one.

const LOADERS = {
  magic: () => import('./magic.js'),
  inventory: () => import('./inventory.js'),
  feats: () => import('./feats.js'),
  variants: () => import('./variants.js'),
  history: () => import('./history.js'),
  content: () => import('./content.js'),
  campaigns: () => import('./campaigns.js'),
  admin: () => import('./admin.js'),
  profile: () => import('./profile.js'),
  reference: () => import('./reference.js'),
  feedback: () => import('./feedback.js'),
  landing: () => import('./landing.js'),
};

export const PART_NAMES = Object.keys(LOADERS);

const held = new Map();
const loading = new Map();

/** A part already fetched, or null. Never fetches: ask `parts` for that. */
export const part = (name) => held.get(name) || null;

/** Fetch these parts, and keep them. Returns them in the order asked for. */
export function parts(...names) {
  return Promise.all(names.map((name) => {
    if (held.has(name)) return held.get(name);
    if (!LOADERS[name]) return Promise.reject(new Error(`no part called ${name}`));
    if (!loading.has(name)) {
      loading.set(name, LOADERS[name]().then((module) => {
        held.set(name, module);
        loading.delete(name);
        return module;
      }).catch((err) => {
        loading.delete(name);
        throw err;
      }));
    }
    return loading.get(name);
  }));
}
