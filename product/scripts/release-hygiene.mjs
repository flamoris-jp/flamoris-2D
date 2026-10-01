// Release checks; never imported by Product runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const product = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(product, '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const entries = lock => Object.entries(lock.packages).filter(([path, item]) => path.includes('node_modules/') && !item.link);
const nameOf = path => path.split('node_modules/').at(-1);
const common = new Set(['MIT', 'Apache-2.0', '(MIT AND Zlib)']);

export function auditLocks(root, standalone) {
  const fingerprint = lock => entries(lock).map(([path, p]) => JSON.stringify([
    nameOf(path), p.version, p.integrity, p.resolved, p.license,
  ])).sort();
  assert.deepEqual(fingerprint(root), fingerprint(standalone), 'Workspace and standalone locked graphs differ');
  const runtime = lock => entries(lock).filter(([, p]) => !p.dev).map(([path, p]) => `${nameOf(path)}@${p.version}`).sort();
  assert.deepEqual(runtime(root), runtime(standalone), 'Workspace and standalone runtime graphs differ');
  assert.equal(root.packages[''].license, 'Apache-2.0');
  assert.equal(root.packages.product.license, 'Apache-2.0');
  assert.equal(standalone.packages[''].license, 'Apache-2.0');
  for (const field of ['dependencies', 'devDependencies'])
    assert.deepEqual(root.packages.product[field], standalone.packages[''][field], `Product ${field} differs`);
  for (const [path, p] of entries(standalone)) {
    assert.ok(p.version && p.integrity && p.resolved?.startsWith('https://registry.npmjs.org/'), `Unpinned registry package: ${path}`);
    assert.ok(p.dev, `Production npm dependency survived: ${path}`);
    assert.ok(common.has(p.license), `License requires review: ${nameOf(path)}@${p.version}:${p.license}`);
  }
  return [];
}

async function locks() {
  const root = await json(resolve(repository, 'package-lock.json'));
  const standalone = await json(resolve(product, 'package-lock.json'));
  const flagged = auditLocks(root, standalone);
  const manifest = await json(resolve(product, 'package.json'));
  for (const field of ['license', 'dependencies', 'devDependencies'])
    assert.deepEqual(standalone.packages[''][field], manifest[field], `Stale Product lock metadata: ${field}`);
  console.log(`Test-only npm graph: ${entries(standalone).length} entries.`);
  for (const item of flagged) console.log(`Manual review: ${item}`);
  return standalone;
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(!process.argv[2] || process.argv[2] === 'check', 'Electron packaging is retired.');
  await locks();
}
