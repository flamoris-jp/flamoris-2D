import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {auditLocks} from '../scripts/release-hygiene.mjs';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const root = await json('../../package-lock.json'), product = await json('../package-lock.json');
test('JS reference oracle has a pinned test-only dependency graph', () => {
  assert.deepEqual(auditLocks(root, product), []);
  for (const field of ['version', 'integrity', 'license']) {
    const changed = structuredClone(root);
    changed.packages['node_modules/ag-psd'][field] = 'changed';
    assert.throws(() => auditLocks(changed, product), /locked graphs differ/);
  }
});
test('reference dependencies cannot become runtime or acquire an unknown license', () => {
  for (const [field, value] of [['dev', false], ['license', 'LicenseRef-Custom']]) {
    const a = structuredClone(root), b = structuredClone(product);
    a.packages['node_modules/ag-psd'][field] = b.packages['node_modules/ag-psd'][field] = value;
    assert.throws(() => auditLocks(a, b), /Production npm dependency|License requires review/);
  }
});
