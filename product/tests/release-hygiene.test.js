import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPackage, uncacheAll} from '@electron/asar';
import {FileMatcher, copyFiles} from 'app-builder-lib/out/fileMatcher.js';
import {auditLocks, verifyElectron, installed} from '../scripts/release-hygiene.mjs';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const originalRoot = await readJson('../../package-lock.json');
const originalProduct = await readJson('../package-lock.json');

test('release audit accepts locked layouts and rejects changed versions, integrity or metadata', () => {
  assert.equal(auditLocks(originalRoot, originalProduct).length, 13);
  for (const field of ['version', 'integrity', 'license']) {
    const root = structuredClone(originalRoot);
    root.packages['node_modules/ag-psd'][field] = 'changed';
    assert.throws(() => auditLocks(root, originalProduct), /locked graphs differ/);
  }
});

test('new unknown/restrictive licenses and development exceptions entering runtime need review', () => {
  for (const license of [undefined, 'AGPL-3.0-only', 'LicenseRef-Custom']) {
    const root = structuredClone(originalRoot), product = structuredClone(originalProduct);
    root.packages['node_modules/ag-psd'].license = product.packages['node_modules/ag-psd'].license = license;
    assert.throws(() => auditLocks(root, product), /License requires review/);
  }
  const root = structuredClone(originalRoot), product = structuredClone(originalProduct);
  delete product.packages['node_modules/truncate-utf8-bytes'].dev;
  delete root.packages['node_modules/truncate-utf8-bytes'].dev;
  assert.throws(() => auditLocks(root, product), /License requires review/);
});

test('packaged audit rejects missing notices, version drift and unintended content in real ASAR', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'flamoris-release-'));
  try {
    const source = join(temp, 'source'), output = join(temp, 'package');
    await mkdir(join(output, 'resources'), {recursive: true});
    const inventory = [];
    for (const [path, p] of Object.entries(originalProduct.packages).filter(([path, p]) => path && !p.dev)) {
      const target = join(source, path);
      await mkdir(target, {recursive: true});
      const installedPath = await installed(path);
      const metadata = join(installedPath, 'package.json');
      const license = join(installedPath, 'LICENSE');
      await cp(metadata, join(target, 'package.json'));
      const notices = join(temp, 'notices', path.replaceAll('node_modules/', 'packages/'));
      await mkdir(notices, {recursive: true});
      await cp(metadata, join(notices, 'package.json'));
      await cp(license, join(notices, 'LICENSE'));
      inventory.push({path, version: p.version, license: p.license, integrity: p.integrity, notices: ['LICENSE']});
    }
    await writeFile(join(temp, 'notices/inventory.json'), JSON.stringify(inventory));
    // Exercise the actual builder copy filter, which silently omits root node_modules.
    await copyFiles([new FileMatcher(join(temp, 'notices'), join(output, 'third-party-licenses'), value => value)]);
    await cp(new URL('../../LICENSE', import.meta.url), join(output, 'LICENSE-FLAMORIS.txt'));
    for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html'])
      await writeFile(join(output, name), 'Synthetic notice used only in test. '.repeat(10));
    const archive = join(output, 'resources/app.asar');
    await createPackage(source, archive);
    uncacheAll();
    await verifyElectron(originalProduct, output);
    await rm(join(output, 'LICENSES.chromium.html'));
    await assert.rejects(verifyElectron(originalProduct, output), /ENOENT/);
    await writeFile(join(output, 'LICENSES.chromium.html'), 'Synthetic test notice. '.repeat(10));
    const metadata = join(source, 'node_modules/ag-psd/package.json');
    const correct = await readFile(metadata);
    await writeFile(metadata, JSON.stringify({version: '0.0.0'}));
    await createPackage(source, archive);
    uncacheAll();
    await assert.rejects(verifyElectron(originalProduct, output), /version mismatch/);
    await writeFile(metadata, correct);
    await mkdir(join(source, 'staging'), {recursive: true});
    await writeFile(join(source, 'staging/private.txt'), 'Synthetic forbidden fixture');
    await createPackage(source, archive);
    uncacheAll();
    await assert.rejects(verifyElectron(originalProduct, output), /Unexpected packaged file/);
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
});
