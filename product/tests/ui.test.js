import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every app element selector exists in the HTML", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  const ids = [...app.matchAll(/querySelector\("#([^"\n]+)"\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing #${id}`);
});
