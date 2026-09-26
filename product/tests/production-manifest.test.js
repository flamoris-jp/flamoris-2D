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
  // Native startup resolves ProductHost/main.mjs. Preserve its published layout,
  // including workers' sibling imports, rather than mirroring source directory names.
  const links = [...props.matchAll(/<None Include="\$\(MSBuildThisFileDirectory\)\.\.\\([^"\n]+)" Link="([^"\n]+)"/gu)];
  assert.equal(links.length, entries.length);
  for (const [, source, target] of links)
    assert.equal(target.replaceAll('\\', '/'), source.replaceAll('\\', '/').replace(/^product-host\//u, 'ProductHost/'));
  const product=new Set(await productionFiles());
  for(const entry of entries){assert.ok(entry.startsWith('product-host/')||product.has(entry),entry);assert.doesNotMatch(entry,/(?:tests|staging|history)\/|src\/app\.js|(?:-view|renderer)\.js$/u);}
});

test('native MCP uses packaged Core/bridge and has no Node HTTP production runtime', async () => {
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const runtime = Object.entries(lock.packages).filter(([name, entry]) => name && !entry.dev).map(([name]) => name.slice('node_modules/'.length));
  assert.deepEqual(runtime.sort(), ['ag-psd', 'base64-js', 'pako']);
  const client = await readFile(new URL('../native/src/Flamoris2D.ProductHost.Client/Flamoris2D.ProductHost.Client.csproj', import.meta.url), 'utf8');
  assert.match(client, /Include="Flamoris.Mcp.Core" Version="1.1.0"/);
  const bridge = await readFile(new URL('../native/src/Flamoris2D.Bridge/Flamoris2D.Bridge.csproj', import.meta.url), 'utf8');
  assert.match(bridge, /<AssemblyName>Flamoris.Mcp.Bridge<\/AssemblyName>/);
  assert.doesNotMatch(bridge, /ProjectReference|ProductHost/);
  const host = await readFile(new URL('../product-host/session-service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(host, /StreamableHTTP|live-mcp-transport/);
});
