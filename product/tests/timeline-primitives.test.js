import assert from "node:assert/strict";
import test from "node:test";

import {
  TransientPlaybackClock,
  projectTimelineItems,
  projectTimelineTime,
} from "../src/ui/timeline-primitives.js";

test("timeline projection uses stable identity and transient preview placement", () => {
  const source = [{ id: "item_b", startTicks: 50, endTicks: 100 },
    { id: "item_a", startTicks: 0, endTicks: 50 }];
  const preview = new Map([["item_b", { startTicks: 40, endTicks: 100 }]]);
  const result = projectTimelineItems(source, 100, {
    selectedId: "item_b",
    previewById: preview,
  });
  assert.deepEqual(result.map((entry) => entry.id), ["item_b", "item_a"]);
  assert.equal(result[0].startTicks, 40);
  assert.equal(result[0].selected, true);
  assert.equal(result[0].previewing, true);
  assert.deepEqual(source[0], { id: "item_b", startTicks: 50, endTicks: 100 });
});

test("tick seconds and rational-frame displays derive from canonical helpers", () => {
  assert.equal(projectTimelineTime(4004, "ticks", { numerator: 30000, denominator: 1001 }).label,
    "4004 ticks");
  assert.equal(projectTimelineTime(60000, "seconds", { numerator: 24, denominator: 1 }).label,
    "0.5 s · 60000 ticks");
  const exact = projectTimelineTime(4004, "frames", { numerator: 30000, denominator: 1001 });
  assert.deepEqual({ value: exact.value, exact: exact.exact }, { value: 1, exact: true });
  const approximate = projectTimelineTime(1, "frames", { numerator: 7, denominator: 1 });
  assert.equal(approximate.exact, false);
  assert.match(approximate.label, /1 ticks$/u);
});

test("shared transient playback clock stops or wraps at integer ticks", () => {
  const scheduled = [];
  const ticks = [];
  const clock = new TransientPlaybackClock({
    onTick: (tick) => ticks.push(tick),
    scheduleFrame: (callback) => (scheduled.push(callback), scheduled.length),
    cancelFrame: () => {},
  });
  clock.play({ durationTicks: 120000, startTick: 0, startTimeMs: 0 });
  scheduled.shift()(1000);
  assert.deepEqual(ticks, [0, 120000]);
  assert.equal(clock.playing, false);

  ticks.length = 0;
  clock.setMode("loop");
  clock.play({ durationTicks: 120000, startTick: 60000, startTimeMs: 0 });
  scheduled.shift()(1000);
  assert.deepEqual(ticks, [60000, 60000]);
  assert.equal(clock.playing, true);
});
