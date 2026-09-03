# FLAMORIS 2D Phase 3-2 Key State Editing UX

Status: Phase 3-2 implementation contract

## Scope

Phase 3-2 replaces the scattered visible A/B endpoint and preview controls with
one Key State Strip. It does not add a persistent Key State collection, a
general Timeline, or A -> B -> C sequencing. The current Transition remains the
only persistent source and is projected as two UI states:

```text
Transition.fromKeyArtId -> { id: endpoint-a, label: A, tick: 0 }
Transition.toKeyArtId   -> { id: endpoint-b, label: B, tick: durationTicks }
```

The view consumes `states[]`; it does not contain two-marker layout logic.
Future callers can project more markers without replacing the component. That
does not authorize multi-state persistence before the later sequencing phase.

## Edit and preview semantics

A state marker is an edit action. Selecting A or B delegates to the existing
`EndpointMeshController`, selects the corresponding real MeshKeyform context,
and returns mesh authoring to Deform Mode.

Moving the playhead is a preview action, including at tick `0` and
`durationTicks`. It exits endpoint editing and evaluates the active Transition
through the existing headless query:

```text
integer playhead tick
  -> transition.evaluate
  -> EvaluatedPartState / render instances
  -> existing viewport renderer
```

The strip contains no interpolation implementation. Preview is read-only:
viewport deform commits and MeshToolController deform/topology commands are
rejected until a state marker re-enters endpoint editing.

## Time contract

- `TemporalProgram.durationTicks` is the only persistent duration authority.
- The timebase remains 120000 integer ticks per second.
- Seconds and percentage are derived UI values only.
- `animation.temporal.set_duration` is an ordinary Command and Transaction;
  Undo and Redo restore the exact prior integer duration.
- Existing validation rejects a shortened duration if persistent keys/events or
  regions would fall outside it. No timing data is silently moved or repaired.

The Project schema remains version 4 because no persistent field is added. The
MCP-facing command schema is version 5 to expose the duration command.

## Playback contract

Playback mode, running state, wall-clock origin, scheduled frame handle, and
playhead are transient controller state.

For elapsed wall-clock milliseconds, evaluation uses:

```text
elapsedTicks = floor(elapsedMilliseconds * 120000 / 1000)
```

`Once` evaluates `min(durationTicks, elapsedTicks)` and stops at the exact end
tick. `Loop` evaluates `elapsedTicks % durationTicks`, so the exact end boundary
wraps deterministically to zero. Each frame only updates the transient tick,
calls `transition.evaluate`, and renders. It never executes a Project command
or adds history.

## Persistent / transient boundary

Persistent:

- existing Transition, TemporalProgram, MeshTopology, and MeshKeyform data;
- `TemporalProgram.durationTicks` changes through Command/Transaction.

Transient:

- states[] projection;
- active strip marker and endpoint edit presentation;
- playhead/current preview tick and derived percentage;
- Once/Loop selection and playback running state;
- evaluated preview result and hover state.

Serialization therefore contains no playhead, playback mode, percentage,
marker selection, or evaluated frame.

## Extension boundary

`KeyStateStripController` coordinates endpoint markers, preview evaluation,
duration, and playback without DOM access. `KeyStateStripView` renders an
arbitrary `states[]` projection and delegates every action to that controller.
The existing Transition preview controller remains the evaluator/typed-track
boundary. `MeshToolController` remains the mesh-mode boundary and receives no
timeline responsibility.

Phase 3-3 contour AutoMesh, Phase 3-4 correspondence assistance, and Phase 6
multi-state persistence/general Timeline remain out of scope.
