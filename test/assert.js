// A two-assertion test harness. Deliberately tiny: the suite needs deep
// equality and a boolean, and nothing else, so it can run anywhere a module
// runs without installing a framework first.

const show = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
  }
  return false;
};

/** A checker that collects its failures rather than throwing on the first. */
export function checker() {
  const failures = [];
  return {
    failures,
    eq(actual, expected, because = '') {
      if (!same(actual, expected)) {
        failures.push(`expected ${show(expected)}, got ${show(actual)}${because ? ` - ${because}` : ''}`);
      }
    },
    ok(value, because = '') {
      if (!value) failures.push(`expected truthy${because ? ` - ${because}` : ''}`);
    },
  };
}
