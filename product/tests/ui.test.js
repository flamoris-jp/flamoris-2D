import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every app element selector exists in the HTML", async () => {
  const [app, appElements, html] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/app-elements.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  const selectors = app + appElements;
  const ids = [...selectors.matchAll(/querySelector\("#([^"\n]+)"\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing #${id}`);
});

test("Phase 1 shell keeps File and sidebar controls reachable", async () => {
  const [app, html, stylesheet, ...styleModules] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/base.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/editor-panels.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/viewport.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/dialogs.css", import.meta.url), "utf8"),
  ]);
  const css = styleModules.join("\n");

  assert.doesNotMatch(html, /id=["']demoButton["']/);
  assert.doesNotMatch(app, /demoButton|createDemoUrl/);
  assert.match(html, /id=["']recoveryDialog["']/);
  assert.match(app, /returnValue !== "restore"/);
  assert.match(stylesheet, /@import "\.\/styles\/base\.css"/);
  assert.match(css, /\.topbar\s*\{[^}]*z-index:\s*100/s);
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  assert.match(
    css,
    /\.scene-panel, \.inspector-panel\s*\{[^}]*overflow:\s*auto/s,
  );
  assert.match(css, /\.inspector-form\[hidden\]\s*\{[^}]*display:\s*none/s);
});

test("Issue 88 workflow navigation lives in the header and the canvas is decluttered", async () => {
  const [html, app, workflow] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/workflow-view.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /素材[\s\S]*メッシュ[\s\S]*リグ[\s\S]*動き[\s\S]*プレビュー[\s\S]*書き出し/);
  assert.ok(html.indexOf("workflow-toolbar") < html.indexOf("viewport-wrap"));
  assert.doesNotMatch(html, /class=["']mode-selector["']/);
  assert.match(html, /id=["']emptyOpenButton["'][^>]*>素材を開く</);
  assert.match(app, /createWorkflowView/);
  assert.match(workflow, /projectWorkflowPanels/);
  assert.doesNotMatch(workflow, /session\.execute|executeTransaction|localStorage|persistence/);
});

test("hidden Sequence Timeline wins over its open details presentation", async () => {
  const css = await readFile(new URL("../src/styles/editor-panels.css", import.meta.url), "utf8");
  assert.match(css, /\.sequence-timeline-panel\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("Phase 8-5 timeline shell is reachable, wired, and keeps persistent authority in Core", async () => {
  const [html, app, adapter, controller, view, viewport, baseCss, panelCss] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/editor-adapter.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/sequence-timeline-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/sequence-timeline-view.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/viewport-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/base.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/editor-panels.css", import.meta.url), "utf8"),
  ]);
  for (const id of ["sequenceTimelinePanel", "sequenceSelect", "sequenceViewLane",
    "sequenceClipLane", "sequenceKeyframeLane", "sequencePlayheadInput",
    "animationClipLibrary", "sequenceProgramContext", "sequenceDiagnosticsList"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(baseCss, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(panelCss, /\.sequence-timeline-panel\s*\{[^}]*max-height:/s);
  assert.match(panelCss, /@media \(max-height: 700px\)/);
  assert.match(view, /previewViewBoundary/);
  assert.match(view, /previewClipInstance/);
  assert.match(view, /previewKeyframeTime/);
  assert.match(view, /application\/x-flamoris-animation-clip/);
  assert.doesNotMatch(controller, /session\.project|this\.session\.project/);
  assert.match(controller, /this\.session\.query\("sequence\.evaluate"/);
  assert.match(controller, /animation\.temporal\.add_track/);
  assert.match(adapter, /new SequenceTimelineController/);
  assert.match(app, /createSequenceTimelineView/);
  assert.match(viewport, /sequenceTimelineContext/);
  assert.match(viewport, /renderEvaluatedViewport\(\{/);
  assert.match(app, /createTransitionPreviewView/);
});
