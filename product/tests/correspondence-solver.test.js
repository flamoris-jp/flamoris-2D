import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { solveCorrespondence } from "../src/core/correspondence-solver.js";

const topology = {
  id: "topology",
  vertexIds: ["vtx_0001", "vtx_0002", "vtx_0003", "vtx_0004"],
  indices: [0, 1, 2, 0, 2, 3],
  vertexMetadata: { vtx_0001: { semanticLabel: "chin_tip" } },
};
const sourceKeyform = {
  id: "source", topologyId: "topology",
  positions: [0, 0, 10, 0, 10, 10, 0, 10],
};
const targetKeyform = {
  id: "target", topologyId: "topology",
  positions: [100, 100, 110, 100, 110, 110, 100, 110],
};

function solve(pins, options = {}) {
  return solveCorrespondence({ topology, sourceKeyform, targetKeyform, pins, ...options });
}

test("pins resolve only through Stable Vertex ID and semanticLabel is not identity", () => {
  assert.deepEqual(solve([{ vertexId: "vtx_0001", target: { x: 3, y: 4 } }]).candidatePositions,
    [3, 4, 13, 4, 13, 14, 3, 14]);
  const byLabel = solve([{ vertexId: "chin_tip", target: { x: 3, y: 4 } }]);
  assert.equal(byLabel.candidatePositions, null);
  assert.equal(byLabel.diagnostics[0].code, "CORRESPONDENCE_UNKNOWN_VERTEX_ID");
});

test("zero, unknown, duplicate, invalid anchor, and topology mismatch are reason-specific", () => {
  assert.equal(solve([]).diagnostics[0].code, "CORRESPONDENCE_NO_PINS");
  assert.equal(solve([{ vertexId: "missing", target: { x: 0, y: 0 } }]).diagnostics[0].code,
    "CORRESPONDENCE_UNKNOWN_VERTEX_ID");
  assert.equal(solve([
    { vertexId: "vtx_0001", target: { x: 0, y: 0 } },
    { vertexId: "vtx_0001", target: { x: 1, y: 1 } },
  ]).diagnostics[0].code, "CORRESPONDENCE_DUPLICATE_PIN");
  assert.equal(solve([{ vertexId: "vtx_0001", target: { x: NaN, y: 0 } }]).diagnostics[0].code,
    "CORRESPONDENCE_INVALID_TARGET_ANCHOR");
  assert.equal(solveCorrespondence({
    topology, sourceKeyform, targetKeyform: { ...targetKeyform, topologyId: "other" },
    pins: [{ vertexId: "vtx_0001", target: { x: 0, y: 0 } }],
  }).diagnostics[0].code, "CORRESPONDENCE_TOPOLOGY_MISMATCH");
});

test("one pin is deterministic whole-mesh translation with an exact anchor", () => {
  const input = [{ vertexId: "vtx_0003", target: { x: 15, y: 8 } }];
  const first = solve(input);
  const second = solve(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidatePositions, [5, -2, 15, -2, 15, 8, 5, 8]);
});

test("two and multiple pins deterministically propagate finite local displacement", () => {
  for (const pins of [
    [
      { vertexId: "vtx_0001", target: { x: 2, y: 3 } },
      { vertexId: "vtx_0002", target: { x: 14, y: 1 } },
    ],
    [
      { vertexId: "vtx_0004", target: { x: -1, y: 12 } },
      { vertexId: "vtx_0001", target: { x: 2, y: 3 } },
      { vertexId: "vtx_0002", target: { x: 14, y: 1 } },
    ],
  ]) {
    const first = solve(pins);
    const second = solve([...pins].reverse());
    assert.deepEqual(first, second);
    assert.equal(first.candidatePositions.length, sourceKeyform.positions.length);
    assert.ok(first.candidatePositions.every(Number.isFinite));
    for (const pin of pins) {
      const index = topology.vertexIds.indexOf(pin.vertexId);
      assert.deepEqual(first.candidatePositions.slice(index * 2, index * 2 + 2),
        [pin.target.x, pin.target.y]);
    }
  }
});

test("coincident source constraints and position count mismatch do not silently fallback", () => {
  const coincidentSource = { ...sourceKeyform, positions: [0, 0, 0, 0, 10, 10, 0, 10] };
  assert.equal(solveCorrespondence({
    topology, sourceKeyform: coincidentSource, targetKeyform,
    pins: [
      { vertexId: "vtx_0001", target: { x: 1, y: 0 } },
      { vertexId: "vtx_0002", target: { x: 2, y: 0 } },
    ],
  }).diagnostics[0].code, "CORRESPONDENCE_POORLY_CONDITIONED");
  assert.equal(solveCorrespondence({
    topology, sourceKeyform: { ...sourceKeyform, positions: [0, 0] }, targetKeyform,
    pins: [{ vertexId: "vtx_0001", target: { x: 1, y: 0 } }],
  }).diagnostics[0].code, "CORRESPONDENCE_POSITION_COUNT_MISMATCH");
});

test("solver core is DOM-independent and part of production allowlist", async () => {
  const [source, allowlist] = await Promise.all([
    readFile(new URL("../src/core/correspondence-solver.js", import.meta.url), "utf8"),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|session\.|EditorSession/);
  assert.match(allowlist, /^src\/core\/correspondence-solver\.js$/m);
});
