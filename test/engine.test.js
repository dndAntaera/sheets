// The node:test runner. `npm test` from a checkout with Node installed; CI runs
// this on every push. The same cases run in a browser at test/browser.html,
// which is how they are checked on a machine without Node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildSuite } from './suite.js';
import { checker } from './assert.js';
import { loadData } from './load-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = await loadData(async (path) =>
  JSON.parse(readFileSync(join(here, '..', 'web', 'data', path), 'utf8')));

for (const testCase of buildSuite(data)) {
  test(testCase.name, () => {
    const t = checker();
    testCase.run(t);
    assert.equal(t.failures.length, 0, t.failures.join('\n  '));
  });
}
