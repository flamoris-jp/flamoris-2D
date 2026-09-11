import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/ui/sequence-timeline-view.js", import.meta.url),
  "utf8",
);

test("AnimationClip keyframe add uses transient program-local authoring tick", () => {
  assert.match(source, /const programTicks = new Map\(\);/u);
  assert.match(source, /function programAuthoringTick\(timelineState\)/u);
  assert.match(source, /timelineState\.ownerContext\?\.kind === "Sequence"/u);
  assert.match(source, /timelineState\.ownerContext\?\.kind !== "AnimationClip"/u);
  assert.match(source, /rememberProgramTick\(timelineState, draft\.timeTicks\);/u);
  assert.match(source, /timeTicks: draft\.timeTicks/u);
  assert.doesNotMatch(source, /timeTicks: timelineState\.currentTick/u);
});

test("ClipInstance drag cancellation discards preview and skips no-op commit", () => {
  assert.match(source, /let commitPreview = false;/u);
  assert.match(source, /commitPreview = accepted === true && startTicks !== originalStart;/u);
  assert.match(source, /controller\(\)\.cancelClipPreview\(instance\.id\)/u);
});

test("keyframe pointer cancellation clears transient preview", () => {
  assert.match(source, /commitPreview = accepted === true && timeTicks !== keyframe\.timeTicks;/u);
  assert.match(source, /controller\(\)\.cancelKeyframePreview\(\)/u);
  assert.doesNotMatch(source, /onCancel\(\) \{ act\(\(\) => controller\(\)\.selectKeyframe/u);
});
