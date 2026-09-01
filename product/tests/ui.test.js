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

test("Phase 1 shell keeps File and sidebar controls reachable", async () => {
  const [app, html, css] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /id=["']demoButton["']/);
  assert.doesNotMatch(app, /demoButton|createDemoUrl/);
  assert.match(html, /id=["']recoveryDialog["']/);
  assert.match(app, /returnValue !== "restore"/);
  assert.match(css, /\.topbar\s*\{[^}]*z-index:\s*100/s);
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  assert.match(
    css,
    /\.scene-panel, \.inspector-panel\s*\{[^}]*overflow:\s*auto/s,
  );
  assert.match(css, /\.inspector-form\[hidden\]\s*\{[^}]*display:\s*none/s);
});
