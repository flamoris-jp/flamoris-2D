// Release checks; never imported by Product runtime.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const product = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(product, '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const entries = lock => Object.entries(lock.packages).filter(([path, item]) => path.includes('node_modules/') && !item.link);
const nameOf = path => path.split('node_modules/').at(-1);
const common = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', '(MIT AND Zlib)']);
// Inventory exceptions, not a legal compatibility approval. See Issue #43 audit.
const review = new Set([
  'isexe@3.1.5:BlueOak-1.0.0', 'isexe@4.0.0:BlueOak-1.0.0',
  'chownr@3.0.0:BlueOak-1.0.0', 'minimatch@10.2.6:BlueOak-1.0.0',
  'minipass@7.1.3:BlueOak-1.0.0', 'sax@1.6.1:BlueOak-1.0.0',
  'tar@7.5.22:BlueOak-1.0.0', 'yallist@5.0.0:BlueOak-1.0.0',
  'argparse@2.0.1:Python-2.0', 'sanitize-filename@1.6.4:WTFPL OR ISC',
  'truncate-utf8-bytes@1.0.2:WTFPL', 'type-fest@0.13.1:(MIT OR CC0-1.0)',
  'utf8-byte-length@1.0.5:(WTFPL OR MIT)',
]);

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
  const flagged = new Set();
  for (const [path, p] of entries(standalone)) {
    assert.ok(p.version && p.integrity && p.resolved?.startsWith('https://registry.npmjs.org/'), `Unpinned registry package: ${path}`);
    if (common.has(p.license)) continue;
    const key = `${nameOf(path)}@${p.version}:${p.license}`;
    assert.ok(p.dev && review.has(key), `License requires review: ${key}`);
    flagged.add(key);
  }
  return [...flagged].sort();
}

async function locks() {
  const root = await json(resolve(repository, 'package-lock.json'));
  const standalone = await json(resolve(product, 'package-lock.json'));
  const flagged = auditLocks(root, standalone);
  const manifest = await json(resolve(product, 'package.json'));
  for (const field of ['license', 'dependencies', 'devDependencies'])
    assert.deepEqual(standalone.packages[''][field], manifest[field], `Stale Product lock metadata: ${field}`);
  console.log(`Locked npm graph: ${entries(standalone).length} entries; ${flagged.length} documented development-license review items.`);
  for (const item of flagged) console.log(`Manual review: ${item}`);
  return standalone;
}

// Resolve packages in either npm workspace or standalone installation layout.
export async function installed(path) {
  for (const base of [product, repository]) {
    const candidate = resolve(base, path);
    try { await readFile(resolve(candidate, 'package.json')); return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`Missing installed package: ${path}`);
}
const noticeNames = async path => (await readdir(path, {withFileTypes: true}))
  .filter(e => e.isFile() && /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(e.name)).map(e => e.name);

async function prepare(lock) {
  const destination = resolve(product, 'dist/third-party-licenses');
  await rm(destination, {recursive: true, force: true});
  await mkdir(destination, {recursive: true});
  const inventory = [];
  for (const [path, p] of entries(lock).filter(([, p]) => !p.dev)) {
    const source = await installed(path);
    assert.equal((await json(resolve(source, 'package.json'))).version, p.version);
    const notices = await noticeNames(source);
    assert.ok(notices.length, `Missing upstream license: ${path}`);
    const target = resolve(destination, path);
    await mkdir(target, {recursive: true});
    for (const name of [...notices, 'package.json']) await copyFile(resolve(source, name), resolve(target, name));
    inventory.push({path, version: p.version, license: p.license, integrity: p.integrity, notices});
  }
  await writeFile(resolve(destination, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
}

export async function verifyElectron(lock, packageDirectory) {
  const {extractFile, listPackage} = await import('@electron/asar');
  const archive = resolve(packageDirectory, 'resources/app.asar');
  const files = listPackage(archive).map(p => p.replaceAll('\\', '/').replace(/^\//, ''));
  const runtime = entries(lock).filter(([, p]) => !p.dev);
  const expected = new Map(runtime);
  for (const path of files) {
    assert.ok(!/(^|\/)(?:tests?|staging|history|\.git|\.github)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:psd|psb|pfx|p12|key)$/i.test(path), `Unexpected packaged file: ${path}`);
    if (path.startsWith('node_modules/') && path.endsWith('/package.json'))
      assert.ok(expected.has(dirname(path).replaceAll('\\', '/')), `Unreviewed packaged dependency: ${path}`);
  }
  for (const [path, p] of runtime) {
    assert.equal(JSON.parse(extractFile(archive, `${path}/package.json`)).version, p.version, `Packaged version mismatch: ${path}`);
    const source = await installed(path);
    for (const name of [...await noticeNames(source), 'package.json']) {
      assert.deepEqual(await readFile(resolve(packageDirectory, 'third-party-licenses', path, name)), await readFile(resolve(source, name)), `Missing/changed packaged notice: ${path}/${name}`);
    }
  }
  const inventory = await json(resolve(packageDirectory, 'third-party-licenses/inventory.json'));
  assert.deepEqual(inventory.map(p => [p.path, p.version, p.license, p.integrity]), runtime.map(([path, p]) => [path, p.version, p.license, p.integrity]));
  assert.deepEqual(await readFile(resolve(packageDirectory, 'LICENSE-FLAMORIS.txt')), await readFile(resolve(repository, 'LICENSE')));
  // Electron's distribution carries both files outside app.asar.
  for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html'])
    assert.ok((await readFile(resolve(packageDirectory, name))).length > 100, `Missing Electron/Chromium notices: ${name}`);
  console.log('Packaged Electron licenses, locked runtime versions, and excluded content: passed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'check';
  assert.ok(['check', 'prepare', 'verify-electron'].includes(mode), 'Unknown release check');
  const lock = await locks();
  if (mode === 'prepare') await prepare(lock);
  if (mode === 'verify-electron') await verifyElectron(lock, resolve(product, process.argv[3] ?? 'dist/win-unpacked'));
}
