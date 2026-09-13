// The SRD's reference data: spells, powers, feats, classes, domains, equipment.
//
// Built from the SRD by scripts/build-srd.py into data/srd/, and large enough
// (two megabytes between them) that each file is fetched only when something
// asks for it, then kept for the rest of the visit. Everything that shows a
// spell, a feat or a class - the Reference pages, the sheet's spell and feat
// lists - reads it from here, so the same entry reads the same everywhere.

export const REFERENCE_KINDS = {
  spells: { label: 'Spells', singular: 'spell' },
  powers: { label: 'Powers', singular: 'power' },
  feats: { label: 'Feats', singular: 'feat' },
  classes: { label: 'Classes', singular: 'class' },
  domains: { label: 'Domains', singular: 'domain' },
  equipment: { label: 'Equipment', singular: 'item' },
};

const loading = new Map();
const loaded = new Map();

const key = (name) => String(name || '').trim().toLowerCase();

/**
 * One kind's entries, fetched once.
 * @returns Promise<{ list, byName: Map<lowercase name, entry> }>
 */
export function loadReference(kind) {
  if (!REFERENCE_KINDS[kind]) return Promise.reject(new Error(`no reference called ${kind}`));
  if (!loading.has(kind)) {
    loading.set(kind, fetch(`./data/srd/${kind}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`the ${REFERENCE_KINDS[kind].label.toLowerCase()} could not be loaded`);
        return res.json();
      })
      .then((list) => {
        const index = { list, byName: new Map(list.map((e) => [key(e.name), e])) };
        loaded.set(kind, index);
        return index;
      })
      .catch((err) => {
        loading.delete(kind);
        throw err;
      }));
  }
  return loading.get(kind);
}

/** Several kinds at once. */
export const loadReferences = (...kinds) => Promise.all(kinds.map(loadReference));

/** A kind's entries if they have already arrived, or null - for code that draws without waiting. */
export function referenceNow(kind) {
  return loaded.get(kind) || null;
}

/** One entry by name, if its kind has arrived. Case does not matter. */
export function lookUp(kind, name) {
  return loaded.get(kind)?.byName.get(key(name)) || null;
}

/** The address of an entry's Reference page. */
export const referenceHref = (kind, name) => `#/reference/${kind}${name ? `/${encodeURIComponent(name)}` : ''}`;
