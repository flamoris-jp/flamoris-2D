import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import test from "node:test";
import { auditModuleGraph } from '../product-host/runtime-audit.mjs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const productRoot = new URL("../", import.meta.url);

async function productionFiles() {
  const contents = await readFile(new URL("../production-files.txt", import.meta.url), "utf8");
  return contents.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
}

function relativeImports(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

test("production manifest is unique, complete, and closed over relative imports", async () => {
  const entries = await productionFiles();
  assert.equal(new Set(entries).size, entries.length, "production manifest contains duplicates");
  const allowlist = new Set(entries);

  for (const entry of entries) {
    const source = await readFile(new URL(entry, productRoot), "utf8");
    if (!/\.(?:c?js|mjs)$/u.test(entry)) continue;
    for (const specifier of relativeImports(source)) {
      const resolved = posix.normalize(posix.join(dirname(entry), specifier));
      const candidate = posix.extname(resolved) ? resolved : `${resolved}.js`;
      assert.ok(
        allowlist.has(candidate),
        `${entry} imports ${candidate}, which is absent from production-files.txt`,
      );
    }
  }
});

test('native package allowlist is exactly the Product Host and worker dependency graph',async()=>{
  const graph=new Set();
  for(const entry of ['main.mjs','source-import-worker.mjs','mesh-generation-worker.mjs'])
    for(const file of (await auditModuleGraph(new URL('../product-host/'+entry,import.meta.url))).modules)
      graph.add(relative(fileURLToPath(productRoot),file).replaceAll('\\','/'));
  const props=await readFile(new URL('../native/ProductHost.files.props',import.meta.url),'utf8');
  const entries=[...props.matchAll(/<None Include="\$\(MSBuildThisFileDirectory\)\.\.\\([^"\n]+)"/gu)].map(m=>m[1].replaceAll('\\','/'));
  assert.deepEqual(entries.sort(),[...graph].sort());
  const product=new Set(await productionFiles());
  for(const entry of entries){assert.ok(entry.startsWith('product-host/')||product.has(entry),entry);assert.doesNotMatch(entry,/(?:tests|staging|history)\/|src\/app\.js|(?:-view|renderer)\.js$/u);}
});

test('native MCP runtime allowlist matches locked production SDK dependencies and excludes client/test packages', async () => {
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const runtime = Object.entries(lock.packages).filter(([name, entry]) => name && !entry.dev).map(([name]) => name.slice('node_modules/'.length));
  const expected = ['@hono/node-server', '@modelcontextprotocol/core', '@modelcontextprotocol/node', '@modelcontextprotocol/server', 'hono', 'zod'];
  assert.deepEqual(runtime.filter(name => !['ag-psd', 'base64-js', 'pako'].includes(name)).sort(), expected);
  for (const name of expected) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry.integrity?.startsWith('sha512-'), name);
    if (name.startsWith('@modelcontextprotocol/')) assert.equal(entry.version, '2.0.0');
  }
  const props = await readFile(new URL('../native/McpRuntime.files.props', import.meta.url), 'utf8');
  const included = [...props.matchAll(/node_modules\\([^"*]+?)\\(?:\*\*|LICENSE)/g)].map(m => m[1].replaceAll('\\', '/'));
  assert.deepEqual([...new Set(included)].sort(), expected);
  assert.doesNotMatch(props, /client|tests|fixtures|staging|\.ts"/);
  const csproj = await readFile(new URL('../native/src/Flamoris2D.App/Flamoris2D.App.csproj', import.meta.url), 'utf8');
  assert.match(csproj, /McpRuntime\.files\.props/);
});
