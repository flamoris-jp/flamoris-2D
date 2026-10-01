import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import test from "node:test";

const productRoot = new URL("../", import.meta.url);

async function productionFiles() {
  const contents = await readFile(new URL("../legacy-reference-files.txt", import.meta.url), "utf8");
  return contents.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
}

function relativeImports(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

test("legacy reference graph is unique, complete, and closed over relative imports", async () => {
  const entries = await productionFiles();
  assert.equal(new Set(entries).size, entries.length, "legacy reference graph contains duplicates");
  const allowlist = new Set(entries);

  for (const entry of entries) {
    const source = await readFile(new URL(entry, productRoot), "utf8");
    if (!/\.(?:c?js|mjs)$/u.test(entry)) continue;
    for (const specifier of relativeImports(source)) {
      const resolved = posix.normalize(posix.join(dirname(entry), specifier));
      const candidate = posix.extname(resolved) ? resolved : `${resolved}.js`;
      assert.ok(
        allowlist.has(candidate),
        `${entry} imports ${candidate}, which is absent from legacy-reference-files.txt`,
      );
    }
  }
});

test('native production uses one workspace and has no JS/Node/Host build inputs', async () => {
  const app = await readFile(new URL('../native/src/Flamoris2D.App/Flamoris2D.App.csproj', import.meta.url), 'utf8');
  const client = await readFile(new URL('../native/src/Flamoris2D.Native.Client/Flamoris2D.Native.Client.csproj', import.meta.url), 'utf8');
  const startup = await readFile(new URL('../native/src/Flamoris2D.App/MainWindow.xaml.cs', import.meta.url), 'utf8');
  const authority = await readFile(new URL('../native/src/Flamoris2D.Native.Client/NativeSessionClient.cs', import.meta.url), 'utf8');
  const mcp = await readFile(new URL('../native/src/Flamoris2D.Native.Client/McpClient.cs', import.meta.url), 'utf8');
  const publish = await readFile(new URL('../packaging/publish-windows.ps1', import.meta.url), 'utf8');
  assert.match(app, /Flamoris2D.Native.Client/);
  assert.match(client, /ProjectReference Include="..\/Flamoris2D.Session\/Flamoris2D.Session.csproj"/);
  assert.match(authority, /NativeWorkspace _workspace=new\(\)/);
  assert.match(mcp, /new NativeMcpHost\(_workspace,expectedToken,/);
  for (const source of [app, client, startup, authority, mcp])
    assert.doesNotMatch(source, /ProductHost|main\.mjs|node\.exe|FLAMORIS_NODE_PATH|ProcessStartInfo|HttpClient/);
  assert.doesNotMatch(publish, /npm ci|Get-Command node|Copy-Item \$node/);
  assert.match(publish, /Flamoris2D.Core.Native.dll/);
  assert.match(publish, /Obsolete editing runtime packaged/);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.build, undefined);
  assert.equal(manifest.main, undefined);
  assert.ok(!Object.keys(manifest.scripts).some(name => /desktop|product-host/.test(name)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const [name, dependency] of Object.entries(lock.packages)) if (name) assert.equal(dependency.dev, true, name);
  assert.ok(!Object.keys(lock.packages).some(name => /electron|app-builder/.test(name)));
  const bridge = await readFile(new URL('../native/src/Flamoris2D.Bridge/Flamoris2D.Bridge.csproj', import.meta.url), 'utf8');
  assert.match(bridge, /<AssemblyName>Flamoris.Mcp.Bridge<\/AssemblyName>/);
  assert.doesNotMatch(bridge, /ProductHost|Flamoris2D.App|Flamoris2D.Session/);
});
