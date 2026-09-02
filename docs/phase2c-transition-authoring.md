# FLAMORIS 2D Phase 2C Transition Authoring and Preview

Status: design contract for Phase 2C implementation

## Goal

Phase 2C turns the deterministic Phase 2B Transition Core into a usable editor workflow for authoring and previewing one A -> B Transition without introducing the general animation timeline or clip mixer.

```text
Import / select Key Art A + B
  -> confirm SemanticSlot correspondence
  -> choose PartTransition modes
  -> author shared topology / endpoint keyforms
  -> edit Transition-owned typed tracks
  -> scrub deterministic evaluation
  -> render evaluated state in the viewport
  -> inspect diagnostics
  -> save / reload / undo / redo
```

Phase 2C reuses the existing Project, Command, Transaction, EditorSession, Undo/Redo, Query, TemporalProgram, typed tracks, Transition evaluator, and renderer boundary. It must not create a parallel UI-only transition model.

## Scope principles

1. Persistent edits always go through existing Commands and Transactions.
2. The UI reads Transition state through Queries and renders `transition.evaluate` output.
3. The viewport renderer consumes `EvaluatedPartState[]`; it does not infer Transition semantics.
4. The Phase 2C scrubber edits a Transition-owned `TemporalProgram`; it is not the Phase 6 general timeline.
5. UI presets may compile to core modes/tracks, but no new persistent transition mode is introduced.
6. Temporary selection, hover, panel layout, ghost opacity, and scrub position remain editor/workspace state unless they are actual project data.
7. Creating a Transition together with its owned TemporalProgram is one atomic transaction: failure leaves neither object, and one Undo/Redo step removes/restores both while preserving the one-owner invariant.
8. Endpoint mesh editing persists mesh/keyform-local coordinates only. Pointer conversion must follow `screen -> document -> inverse endpoint part world transform -> mesh/keyform local`; transformed parts must never write screen/document coordinates into MeshKeyform positions.
9. Preview authority is explicit. Structural invalidity or renderer-unsupported features mark the viewport preview non-authoritative rather than silently approximating a valid final result.

## 1. Key Art authoring surface

Provide a focused Key Art panel or strip sufficient for two-Key-Art Transition authoring.

Minimum operations:

- list existing Key Arts;
- create/update/remove Key Arts through existing `keyart.*` commands;
- choose Start Key Art A and End Key Art B for the active Transition;
- activate A or B as the endpoint editing context;
- jump directly to Start / End endpoint view;
- show basic source/member summary and missing-reference state.

Phase 2C does not implement a multi-shot sequence strip or A -> B -> C mixer. The data model may already support multiple Key Arts, but the authoring workflow is scoped to one selected Transition at a time.

## 2. Semantic correspondence UI

Provide explicit reviewable SemanticSlot mapping between A and B.

For the selected slot show:

```text
SemanticSlot
├── slot identity / display name
├── Key Art A -> node
├── Key Art B -> node
└── mapping status
```

Required operations:

- create/update/remove SemanticSlot;
- map/unmap the selected A/B node;
- expose unmapped A-only and B-only parts;
- reject duplicate/ambiguous persistent mappings using existing validation;
- never match by display/source name at evaluation time.

Useful UI states:

```text
mapped
A only
B only
missing / invalid reference
```

AI mapping suggestions remain Phase 8.

## 3. PartTransition authoring

For each selected SemanticSlot expose the existing persistent modes:

```text
Morph
Hold
Replace
Appear
Disappear
Occlusion
```

The inspector must edit existing `PartTransition` data rather than maintaining a second UI representation.

Mode-specific UI should expose only valid controls. Examples:

- Morph: shared topology, A/B keyforms, geometry and appearance timing;
- Hold: authored endpoint/source state with explicit handoff behavior where supported;
- Replace: A/B overlap/handoff timing and explicit composite behavior;
- Appear / Disappear: presence and opacity timing;
- Occlusion: semantic occlusion state while preserving identity.

Crossfade / Swap may be presented later as convenience presets that compile to the existing core mode + typed tracks. They must not be persisted as additional modes.

## 4. Endpoint mesh/keyform authoring

Phase 2C needs the minimum mesh workflow required by the Phase 2 roadmap acceptance criteria, but not the full Phase 3 production mesh toolset.

Required workflow:

1. select a Morph-capable SemanticSlot;
2. create or choose a shared `MeshTopology`;
3. create endpoint `MeshKeyform` for A;
4. create endpoint `MeshKeyform` for B using the same topology;
5. activate A or B endpoint editing context;
6. move existing vertices in the viewport;
7. persist positions/UV changes through ordinary mesh keyform commands;
8. preview interpolation through `transition.evaluate`.

Minimum editing behavior:

- point vertex selection;
- single/multi vertex move if already supported cheaply by the existing mesh editor;
- endpoint reset/reload only if representable by existing commands;
- clear visual distinction between A-keyform editing, B-keyform editing, and Transition preview.

### Endpoint edit coordinate contract

Endpoint vertex editing must use the same transform discipline as the existing PSD Edit Mode and must remain correct after Object Mode transforms.

Pointer conversion is:

```text
screen
  -> document
  -> inverse endpoint PartNode world transform
  -> mesh/keyform-local
```

Requirements:

- rendering and dragging use the same endpoint PartNode world transform and inverse;
- parent/group transforms are included through the resolved world transform;
- Rotate / Scale / Translate applied in Object Mode must not change the semantic direction or amount of a local vertex drag;
- MeshKeyform `positions[]` store mesh/keyform-local coordinates only;
- changing viewport zoom/pan must not change persisted coordinates;
- A and B endpoint editing use their respective endpoint node/world transforms rather than assuming identical transforms.

A regression test must cover a transformed endpoint part, including non-identity rotation and scale, and verify that screen drag round-trips to the expected mesh/keyform-local delta.

Explicitly deferred to Phase 3:

- proportional editing;
- box/lasso/brush selection unless already available with no new model impact;
- add/remove/connect vertices;
- advanced automesh;
- correspondence anchors / solver;
- mirror editing;
- production topology tooling.

## 5. Target-Key-Art viewing and ghost comparison

The viewport should support authoring B's keyform while viewing B artwork.

Minimum view modes:

```text
Endpoint A
Endpoint B
Transition Preview
```

Recommended transient aids:

- optional A/B ghost overlay;
- selected SemanticSlot highlight;
- mesh overlay;
- currently active endpoint label;
- diagnostic marker/highlight where practical.

Ghost/onion display settings are editor state unless explicitly promoted later to project preferences.

## 6. Transition scrubber

Provide a focused scrubber for the active Transition.

Requirements:

- range is `0 .. program.durationTicks`;
- arbitrary integer tick evaluation;
- Start / End jump;
- normalized progress display is derived only;
- scrubbing does not mutate persistent project state;
- repeated evaluation of the same Project + tick displays equivalent output;
- endpoint evaluation must respect the Phase 2B endpoint invariant;
- endpoint visual equivalence is asserted only for renderer-supported features; unsupported rendering capabilities must be surfaced as non-authoritative preview state.

The scrubber may expose human-friendly seconds/frames, but conversion must use the established 120000 ticks/second timebase and rational FPS rules.

## 7. Transition-owned typed track editing

Phase 2C needs only a focused editor for the active Transition's existing `TemporalProgram`.

It may edit the Phase 2 typed tracks already defined for Transition evaluation, including as applicable:

- geometry blend;
- appearance;
- opacity;
- presence;
- draw order;
- clipping state/reference where already supported by the Phase 2B core.

Required behavior:

- display existing tracks/keyframes;
- add/update/remove keyframes using existing `animation.temporal.*` commands;
- edit step / linear / Bezier interpolation using the existing sampler schema;
- support `transition-default` and specific SemanticSlot targets where defined;
- visibly distinguish default versus slot-specific override;
- surface validation conflicts instead of silently resolving them.

This is not a reusable Clip timeline, track mixer, graph editor, or multi-Transition sequence editor.

## 8. Renderer integration

The existing viewport path must be able to display Phase 2B evaluated output.

Renderer responsibilities are limited to generic rendering instructions from `EvaluatedPartState[]` / render instances:

- mesh rasterization;
- transforms;
- per-instance opacity;
- explicit draw order;
- weighted appearance samples;
- per-Key-Art UVs;
- multiple simultaneous Replace render instances;
- supported clipping state/reference handling as defined by the current renderer capability.

The renderer must not:

- infer SemanticSlot mapping;
- decide Morph vs Replace;
- derive presence semantics;
- invent draw-order handoffs;
- decide diagnostic validity.

### Preview authority

The viewport must expose whether the displayed Transition preview is authoritative for the evaluated state.

`authoritative` means:

- Transition evaluation is structurally valid for the current tick; and
- every evaluated feature that contributes to the expected visible result is supported by the current renderer path.

The preview is `non-authoritative` when, for example:

- structural diagnostics invalidate the Transition/current evaluated state; or
- the evaluator emits valid clipping state/reference data but Phase 4 clipping rasterization is not yet implemented; or
- another evaluated renderer instruction required for visual equivalence is unsupported.

Non-authoritative preview may still render the supported subset for editing convenience, but the UI must visibly label it and surface the reason-specific diagnostic. It must never silently present a partial rendering as proof of endpoint visual equivalence.

If clipping rasterization remains unsupported until Phase 4, the UI must display the Phase 2B unsupported diagnostic and mark the preview non-authoritative.

## 9. Diagnostics UX

Expose `transition.get_diagnostics` and/or diagnostics returned from `transition.evaluate` in a structured UI.

Minimum behavior:

- show severity + reason-specific code/message;
- associate diagnostics with the active Transition;
- identify SemanticSlot and tick where supplied;
- selecting a diagnostic should focus the relevant slot/part when practical;
- structural invalidity blocks or clearly marks authoritative preview;
- renderer-unsupported diagnostics mark preview non-authoritative even when core evaluation itself is structurally valid;
- scoped acknowledgements use existing persistent commands only when supported;
- never collapse all diagnostics into one opaque quality score.

Important diagnostic families include missing correspondence, invalid mode/mapping, topology/keyform problems, triangle inversion/degeneration, stretch/compression, UV distortion, ghosting risk, draw-order conflicts/crossings, presence mismatch, clipping limitations, and intermediate-Key-Art recommendation.

## 10. Undo / Redo / transactions

All persistent Phase 2C edits must remain fully undoable through the existing EditorSession.

Examples:

- create Transition + TemporalProgram atomically;
- map/unmap SemanticSlot;
- change PartTransition mode;
- create/update endpoint MeshKeyform;
- move endpoint vertices;
- add/update/remove Transition keyframes.

### Transition creation atomicity

Creating a Transition and its owned TemporalProgram is one semantic operation and one transaction.

Requirements:

- validate both objects and ownership before commit;
- if any step fails, neither Transition nor TemporalProgram remains in Project state;
- one Undo removes both objects and restores the pre-transaction state;
- one Redo restores both objects with the same stable IDs and ownership;
- the operation must never expose an intermediate committed state containing a Transition with a missing program or a program multiply owned by Transitions;
- tests must cover validation failure rollback, Undo, Redo, and ownership invariant preservation.

Scrub position, selected Key Art, selected slot, viewport ghost mode, and temporary preview state must not pollute Project history unless later explicitly designed as persistent project data.

Undo/Redo must keep UI selection resilient when the selected domain object disappears or reappears.

## 11. Save / open / migration

Phase 2C must not introduce a second serialization format.

Requirements:

- use the existing Project schema produced by Phase 2B;
- save/reload Key Arts, mappings, topology, keyforms, Transition, and TemporalProgram without UI-only duplication;
- after reload, evaluating an identical Transition/tick produces equivalent evaluated state;
- transient UI/editor state is not required for project equivalence;
- existing Phase 1 / 2A / 2B migration remains valid.

## 12. Headless / MCP-ready architecture

The UI is an ordinary client of existing Commands and Queries.

Any new operation discovered during UI implementation must first be expressed as a deterministic command/query that is useful without DOM pointer events.

Do not introduce hidden renderer/UI mutation shortcuts that future MCP cannot reproduce.

No network MCP server is implemented in Phase 2C.

## 13. Recommended UI composition

A compact first implementation can use the existing editor shell:

```text
+------------------+-----------------------+------------------+
| Scene / Key Art  |                       | Transition       |
| / Semantic Slots |       Viewport        | Inspector        |
|                  |                       | + Diagnostics    |
+------------------+-----------------------+------------------+
| Active Transition: A -> B   [| scrubber |]  typed tracks   |
+------------------------------------------------------------+
```

The exact panel layout is not persistence architecture and may evolve during implementation.

## 14. Implementation order

### 2C-1 Authoring shell

- active Transition selection;
- A/B Key Art controls;
- SemanticSlot mapping UI;
- PartTransition mode inspector;
- atomic Transition + TemporalProgram creation;
- resilient selection state.

### 2C-2 Endpoint mesh/keyform workflow

- A/B endpoint edit context;
- shared topology/keyform selection/creation;
- move existing vertices on A/B;
- screen/document/world/local coordinate conversion contract;
- transformed-part drag regression;
- mesh overlay and endpoint view controls.

### 2C-3 Preview and temporal controls

- deterministic scrubber;
- `transition.evaluate` -> viewport renderer;
- weighted appearance / Replace preview;
- explicit authoritative/non-authoritative preview state;
- focused typed-track/keyframe controls.

### 2C-4 Diagnostics and regression

- diagnostics panel/focus;
- save/reload equivalence;
- Undo/Redo UI consistency;
- Transition + TemporalProgram rollback/Undo/Redo regression;
- transformed endpoint mesh drag regression;
- endpoint evaluation equivalence;
- endpoint visual equivalence for renderer-supported features;
- non-authoritative preview for renderer-unsupported evaluated features;
- full Phase 1 / 2A / 2B regression suite.

## 15. Explicitly out of scope

- general multi-track animation Timeline;
- Clip / ClipInstance authoring;
- deterministic clip/Transition mixer;
- A -> B -> C sequence editing UI;
- graph editor;
- reusable rig animation clips;
- bones / skinning;
- warp/lattice deformers;
- clipping authoring or new clipping rasterization;
- Phase 3 production mesh editing tools;
- AI correspondence / optical flow / generated frames;
- network MCP server;
- production video/PNG/WebM export.

Those remain assigned to later roadmap phases.

## Acceptance criteria

Phase 2C is complete when a user can, through the editor UI:

1. import or use two Key Arts A and B in one Project;
2. create/select an A -> B Transition and its owned TemporalProgram atomically, with failure rollback and one-step Undo/Redo preserving the ownership invariant;
3. review and edit explicit SemanticSlot correspondence;
4. configure Morph / Hold / Replace / Appear / Disappear / Occlusion for parts;
5. create/use shared topology and A/B MeshKeyforms for a Morph part;
6. move B endpoint vertices while viewing B artwork, including after non-identity Object Mode transform, with pointer conversion `screen -> document -> inverse world transform -> mesh/keyform local` and local-only persisted positions;
7. scrub any tick and see the deterministic evaluated result in the viewport;
8. see dual-texture/per-Key-Art-UV Morph preview where applicable;
9. see simultaneous Replace instances and explicit handoff behavior;
10. edit Transition-owned typed keyframes without a general animation timeline;
11. inspect reason-specific diagnostics and clearly distinguish authoritative from non-authoritative preview;
12. jump to tick 0 and duration and evaluationally reproduce A and B for a valid complete Transition; visually reproduce endpoints for renderer-supported features, while renderer-unsupported features are explicitly diagnosed and marked non-authoritative rather than silently approximated;
13. Undo/Redo persistent authoring edits correctly;
14. save, reopen, and obtain equivalent Transition evaluation;
15. complete the workflow without UI-only persistent state or DOM-only mutation paths;
16. keep the full Phase 1 / 2A / 2B regression suite green.

## Non-goal checkpoint

A successful Phase 2C proves:

> FLAMORIS 2D can author and preview one deterministic two-Key-Art Transition end to end.

It does not yet prove the full MV animation/timeline workflow. That remains a later phase built on this same TemporalProgram and evaluator foundation.
