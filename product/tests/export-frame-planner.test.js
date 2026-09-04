import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPORT_FRAME_BOUNDARY_CONTRACT,
  ExportFramePlanner,
  planExportFrames,
} from "../src/core/export-frame-planner.js";
import { TIMEBASE_TICKS_PER_SECOND, frameToTicks } from "../src/core/temporal.js";

test("planner derives a deterministic half-open frame range from duration and FPS", () => {
  const planner = planExportFrames({
    durationTicks: TIMEBASE_TICKS_PER_SECOND,
    frameRate: { numerator: 24, denominator: 1 },
  });

  assert.equal(planner.frameCount, 24);
  assert.deepEqual(planner.firstFrame(), { frameIndex: 0, timeTicks: 0, exact: true });
  assert.deepEqual(planner.lastFrame(), { frameIndex: 23, timeTicks: 115000, exact: true });
  assert.deepEqual(planner.describe().boundary, { start: "inclusive", end: "exclusive" });
  assert.equal(planner.describe().timebaseTicksPerSecond, 120000);
  assert.throws(() => planner.frameAt(24), /planned frame range/);
});

test("duration boundary never adds an extra frame and a partial frame is retained", () => {
  const exact = new ExportFramePlanner({
    durationTicks: 120000,
    frameRate: { numerator: 30, denominator: 1 },
  });
  const partial = new ExportFramePlanner({
    durationTicks: 120001,
    frameRate: { numerator: 30, denominator: 1 },
  });
  const shorterThanOneFrame = new ExportFramePlanner({
    durationTicks: 1,
    frameRate: { numerator: 24, denominator: 1 },
  });

  assert.equal(exact.frameCount, 30);
  assert.deepEqual(exact.lastFrame(), { frameIndex: 29, timeTicks: 116000, exact: true });
  assert.equal(partial.frameCount, 31);
  assert.deepEqual(partial.lastFrame(), { frameIndex: 30, timeTicks: 120000, exact: true });
  assert.equal(shorterThanOneFrame.frameCount, 1);
  assert.deepEqual(shorterThanOneFrame.lastFrame(), shorterThanOneFrame.firstFrame());
});

test("tick-domain exclusivity removes a frame that round-half-up projects onto duration", () => {
  const planner = new ExportFramePlanner({
    durationTicks: 17143,
    frameRate: { numerator: 7, denominator: 1 },
  });

  assert.equal(frameToTicks(1, planner.frameRate).ticks, 17143);
  assert.equal(planner.frameCount, 1);
  assert.deepEqual([...planner.frames()], [
    { frameIndex: 0, timeTicks: 0, exact: true },
  ]);
  assert.throws(() => planner.frameAt(1), /planned frame range/);
});

test("every planned frame remains strictly inside the tick-domain duration", () => {
  const cases = [
    { durationTicks: 17143, frameRate: { numerator: 7, denominator: 1 }, frameCount: 1 },
    { durationTicks: 120000, frameRate: { numerator: 24, denominator: 1 }, frameCount: 24 },
    { durationTicks: 120000, frameRate: { numerator: 30, denominator: 1 }, frameCount: 30 },
    { durationTicks: 120000, frameRate: { numerator: 60, denominator: 1 }, frameCount: 60 },
    { durationTicks: 120000, frameRate: { numerator: 30000, denominator: 1001 }, frameCount: 30 },
    { durationTicks: 120000, frameRate: { numerator: 60000, denominator: 1001 }, frameCount: 60 },
  ];

  for (const input of cases) {
    const planner = new ExportFramePlanner(input);
    assert.equal(planner.frameCount, input.frameCount);
    assert.ok([...planner.frames()].every((frame) =>
      frame.timeTicks >= 0 && frame.timeTicks < input.durationTicks));
  }
});

test("rational FPS planning is repeatable and uses direct canonical tick projection", () => {
  const input = {
    durationTicks: 10 * 60 * 60 * TIMEBASE_TICKS_PER_SECOND,
    frameRate: { numerator: 60000, denominator: 1001 },
  };
  const first = new ExportFramePlanner(input);
  const second = new ExportFramePlanner(input);

  assert.deepEqual(first.describe(), second.describe());
  assert.equal(first.frameCount, 2157843);
  for (const frameIndex of [0, 1, 1000, 1000000, first.frameCount - 1]) {
    const expected = frameToTicks(frameIndex, input.frameRate);
    assert.deepEqual(first.frameAt(frameIndex), {
      frameIndex,
      timeTicks: expected.ticks,
      exact: expected.exact,
    });
  }
  assert.ok(first.lastFrame().timeTicks < input.durationTicks);
});

test("arbitrary rational FPS keeps round-half-up metadata without accumulation", () => {
  const planner = new ExportFramePlanner({
    durationTicks: 120000,
    frameRate: { numerator: 14, denominator: 2 },
  });
  const frames = [...planner.frames()];

  assert.equal(planner.frameRate.numerator, 7);
  assert.equal(planner.frameRate.denominator, 1);
  assert.equal(frames.length, 7);
  assert.deepEqual(frames[1], { frameIndex: 1, timeTicks: 17143, exact: false });
  assert.deepEqual(frames.at(-1), { frameIndex: 6, timeTicks: 102857, exact: false });
  assert.strictEqual(EXPORT_FRAME_BOUNDARY_CONTRACT, planner.describe().boundary);
});

test("planner rejects invalid duration, FPS, and frame indices", () => {
  assert.throws(() => new ExportFramePlanner({
    durationTicks: 0,
    frameRate: { numerator: 24, denominator: 1 },
  }), /positive safe integer/);
  assert.throws(() => new ExportFramePlanner({
    durationTicks: 120000,
    frameRate: { numerator: 0, denominator: 1 },
  }), /positive safe integers/);

  const planner = new ExportFramePlanner({
    durationTicks: 120000,
    frameRate: { numerator: 24, denominator: 1 },
  });
  assert.throws(() => planner.frameAt(-1), /planned frame range/);
  assert.throws(() => planner.frameAt(0.5), /planned frame range/);
});
