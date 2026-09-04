# FLAMORIS 2D Phase 3-4 Correspondence Assistance

Status: Phase 3-4 implementation contract

Issue #39 remains the Phase 3 authority. Correspondence is an authoring aid
for initializing an existing target `MeshKeyform`; it is not a rig, a new mesh
model, or a persistent correspondence entity.

## Pin and persistence contract

A transient pin is `{ vertexId, target: { x, y } }`. `vertexId` resolves only
through `MeshTopology.vertexIds`; representation indices and semantic labels
are never identity. Source and target keyforms must reference the same
topology and contain one finite position pair per stable vertex.

Pins, selected pin, source/target direction, solver preset, candidate
positions, and overlays are workspace state. They are absent from Project
serialization and Undo history. The only persistent result is an explicitly
applied target `MeshKeyform.positions` array.

## Solver

`solveCorrespondence` is pure, deterministic, DOM-free, and does not inspect
Project or viewport state. The initial solver uses inverse-distance weighted
(IDW) pin displacement because it has no iterative or matrix state, behaves
predictably with sparse constraints, has no dependency or bundle cost, and
produces an editable starting point rather than pretending to be a final
artistic solve.

For source vertex `P` and each pin displacement `D_i = anchor_i - P_i`, an
unpinned result is:

```text
P' = P + sum(w_i * D_i) / sum(w_i)
w_i = 1 / distance(P, P_i) ^ falloffPower
```

Pins are evaluated in topology vertex order so caller iteration order cannot
change floating-point accumulation. Soft, Normal, and Firm presets use
falloff powers 1, 2, and 4. Pinned vertices are assigned their anchor values
after propagation, making the constraint exact rather than approximate.

- zero pins: `CORRESPONDENCE_NO_PINS`, no candidate;
- one pin: exact whole-mesh translation;
- two or more pins: deterministic local IDW propagation;
- coincident source pin positions: `CORRESPONDENCE_POORLY_CONDITIONED`, no
  silent fallback.

The source keyform is the geometric baseline. The current target keyform is
validated for topology/count compatibility but is not blended into the new
estimate; this makes repeated initialization explicit and reproducible.

## Preview, coordinates, and Apply

Direction is generic `sourceEndpoint -> targetEndpoint` and supports both
A-to-B and B-to-A. Solver inputs and pin anchors are mesh/keyform-local
coordinates. Pointer input follows the existing conversion:

```text
screen -> document -> inverse target PartNode world transform -> mesh local
```

Zoom, pan, viewport dimensions, and DOM layout are not solver inputs.

Solve creates a read-only transient candidate. It does not mutate Project or
history. The candidate is bound to the exact topology ID, source/target
keyform IDs, and endpoint direction used by Solve. Apply rejects and clears a
stale candidate if any current context ID differs, even when the new target has
the same vertex count. Apply reuses `mesh_keyform.move_vertices` through
`EditorSession` as one semantic transaction. Undo restores the exact previous
target positions; Redo replays the recorded candidate payload without
rerunning the solver.
After Apply, the target endpoint returns to ordinary Deform Mode with no
solver-specific lock or persistent state.

## Diagnostics and headless boundary

The core reports reason-specific diagnostics for missing keyforms, topology
mismatch, no pins, unknown/duplicate stable IDs, invalid anchors, incompatible
position counts, poorly conditioned pin geometry, and non-finite results. The
preview controller additionally diagnoses missing active endpoint context and
candidate count mismatch. Failures do not silently fall back to another
solver.

The Project schema and MCP schema remain unchanged. Headless callers can use
the pure solver directly and commit an accepted array with the existing typed
`mesh_keyform.move_vertices` command. Network MCP, persistent pins, optical
flow, AI pin generation, intermediate image generation, advanced deformation,
general Timeline, and export remain deferred.
