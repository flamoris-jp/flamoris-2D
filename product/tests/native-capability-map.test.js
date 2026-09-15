import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { commandSchemas } from "../src/commands/schemas.js";
import { projectQueries } from "../src/queries/project.js";

test("native migration ledger covers every public Product command and query", async () => {
  // Development-only safety contract; never loaded by Product runtime.
  const ledger = await readFile(new URL("../../docs/native-capability-map.md", import.meta.url), "utf8");
  for (const [kind, names] of [
    ["Command", Object.entries(commandSchemas).filter(([, schema]) => !schema.internal).map(([name]) => name)],
    ["Query", Object.keys(projectQueries)],
  ]) {
    const rows = ledger.split(/\r?\n/u).filter((line) => line.startsWith(`| ${kind} |`));
    const documented = rows.map((line) => line.split("|")[2].trim().replaceAll("`", ""));
    assert.deepEqual(documented.sort(), names.sort(), `${kind} coverage drift`);
    for (const row of rows) {
      assert.match(row, /\| (migrated|superseded|intentionally deferred) \|$/);
      assert.match(row, /src\/(commands|queries)\//);
    }
  }
  for (const gate of ["G1", "G2", "G3", "G4", "G5"])
    assert.ok(ledger.includes(`${gate} —`), `Missing decision gate ${gate}`);
  assert.match(ledger, /Electron stays/);
});
