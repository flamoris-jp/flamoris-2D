import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import test from "node:test";

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
