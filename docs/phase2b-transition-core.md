# FLAMORIS 2D Phase 2B Transition Core

Status: implementation contract for Issue #31

## Goal

Phase 2B implements the deterministic headless core that connects two authored Key Arts and evaluates a Transition at any integer tick.

```text
Key Art A
  -> confirmed SemanticSlot correspondence
  -> Transition + TemporalProgram
  -> evaluate(timeTicks)
  -> EvaluatedPartState[]
  -> renderer-ready state
  -> Key Art B
```

This phase builds on the Phase 2A Temporal Core and deliberately excludes the full Transition authoring UI, Timeline, mixer, bones, deformers, mask authoring, AI correspondence, and network MCP server.

## Domain additions

```text
Project
├── keyArts[]
├── semanticSlots[]
├── meshTopologies[]
├── meshKeyforms[]
├── transitions[]
└── temporalPrograms[]
```

All objects use stable Product IDs. PSD source names/paths are metadata, never authoritative cross-Key-Art identity.

### KeyArt

```text
KeyArt
├── id
├── displayName
├── rootNodeId
├── sourceAssetId?
├── members[]
└── metadata
```

Key Art references existing scene identity instead of duplicating ordinary Scene Node state.

### SemanticSlot

```text
SemanticSlot
├── id
├── displayName
├── role?
├── mappings[]
│   ├── keyArtId
│   └── nodeId
└── metadata
```

Rules:

- evaluation never matches by display/source names;
- at most one node from a Key Art maps to one SemanticSlot;
- one node belongs to at most one SemanticSlot;
- missing mapping is valid;
- ambiguous mapping is not valid persistent state;
- Phase 2B does not generalize arbitrary one-to-many/many-to-one correspondence.

### Transition

```text
Transition
├── id
├── displayName
├── fromKeyArtId
├── toKeyArtId
├── temporalProgramId
├── partTransitions[]
└── diagnosticOverrides[]
```

One Transition connects exactly two different Key Arts. `program.durationTicks` remains the sole duration. One Transition owns exactly one TemporalProgram through `temporalProgramId`; the same TemporalProgram must not be owned by multiple Transitions.

This preserves Phase 2A's owner-neutral `project.temporalPrograms[]` storage while making semantic ownership explicit.

### PartTransition modes

Persistent modes are:

```text
morph
hold
replace
appear
disappear
occlusion
```

`Swap`/Crossfade remain UI conveniences that compile to ordinary modes/tracks.

```text
PartTransition
├── id
├── semanticSlotId
├── mode
├── topologyId?
├── fromKeyformId?
├── toKeyformId?
└── configuration
```

## Transition-default temporal targeting

Phase 2B may add the typed target `transition-default` to transition-relevant track kinds.

A specific `semanticSlotId` target overrides `transition-default`. Same-specificity incompatible tracks are validation errors. This remains a typed target model, not an arbitrary string property path.

## Shared topology and per-Key-Art keyforms

```text
MeshTopology
├── id
├── vertexIds[]
└── indices[]
```

Topology contains stable vertex identity/connectivity only.

```text
MeshKeyform
├── id
├── topologyId
├── keyArtId
├── semanticSlotId
├── positions[]
└── uvs[]
```

A/B share topology while allowing independent positions, UVs, and artwork.

## Evaluation

For Morph and stable vertex `i`:

```text
P_i(t) = lerp(P_A_i, P_B_i, geometryWeight(t))
```

Geometry and appearance timing are independent. Compatible Morph may emit one geometry instance with multiple weighted appearance samples, each using its own endpoint UV set.

Replace may emit independent A/B render instances simultaneously. Appear/Disappear use explicit presence + opacity changes. Occlusion preserves semantic identity and stays distinct from `absent`.

Presence remains:

```text
present
occluded
absent
```

Opacity is independent. Draw order is explicit/discrete and never falls back to accidental array order.

## EvaluatedPartState

```text
EvaluatedPartState
├── semanticSlotId
├── presence
└── renderInstances[]
```

Each render instance contains complete renderer instructions:

```text
RenderInstance
├── renderInstanceId
├── sourceNodeId
├── transform
├── mesh.positions
├── mesh.indices
├── appearanceSamples[]
├── opacity
├── drawOrder
├── clipping
├── compositeGroupId?
└── compositeWeight?
```

The renderer consumes this state. It does not infer Morph/Replace, correspondence, presence semantics, hidden z-order handoffs, or diagnostic validity.

## Deterministic pipeline

For one Transition and `localTicks`:

```text
1. validate references
2. clamp tick to 0..durationTicks
3. resolve endpoint Key Arts
4. resolve confirmed SemanticSlot mappings
5. resolve PartTransition
6. sample TemporalProgram
7. evaluate geometry
8. evaluate appearance + UV
9. evaluate opacity
10. evaluate presence
11. evaluate draw order
12. evaluate clipping reference/state
13. build renderInstances[]
14. emit EvaluatedPartState[]
15. derive diagnostics
```

Evaluation is pure and mutation-free. Identical Project state + tick must produce equivalent output independent of insertion order.

## Endpoint invariant

For every valid complete Transition:

```text
evaluateTransition(0) ~= Key Art A
evaluateTransition(durationTicks) ~= Key Art B
```

This includes geometry, appearance, opacity, presence, draw order, and visible mapped parts.

## Diagnostics

Diagnostics are derived, not sticky persistent warnings. Initial reason-specific diagnostics include missing correspondence, invalid mode/mapping, incompatible topology, missing keyform, degenerate/inverted triangles, excessive stretch/compression, UV distortion, ghosting risk, draw-order conflicts/crossings, presence mismatch, invalid/unsupported clipping, and intermediate-Key-Art recommendation.

Only scoped acknowledgements may persist. Structural errors cannot be acknowledged into validity.

## Commands and queries

Persistent changes continue through existing Command / Transaction / EditorSession paths. Phase 2A `animation.temporal.*` commands remain authoritative for TemporalProgram editing.

Suggested Phase 2B command families:

```text
keyart.*
semantic_slot.*
mesh_topology.*
mesh_keyform.*
transition.*
```

Suggested queries:

```text
keyart.get / list
semantic_slot.get / list / get_mapping
mesh.get_topology / get_keyform
transition.get / list / evaluate / get_diagnostics
```

`transition.evaluate` is DOM/Canvas/pointer independent and returns `EvaluatedPartState[]` plus derived diagnostics.

## Migration

Phase 2A Projects migrate with empty/default Phase 2B collections. Existing `temporalPrograms[]` are preserved unchanged. Unowned Phase 2A programs may remain legal orphan definitions, while validation prevents multiple semantic owners once ownership exists.

## Implementation order

### 2B-1 Domain foundation

KeyArt, SemanticSlot, MeshTopology, MeshKeyform, Transition, ownership, validation, persistence, commands, queries.

### 2B-2 Evaluator

Morph, Hold, Replace, Appear, Disappear, Occlusion, `EvaluatedPartState`, diagnostics.

### 2B-3 Renderer proof and regression

Consume evaluated state, weighted appearance samples, multiple Replace instances, endpoint/equivalence checks, save/reload equivalence, and full regression suite.

## Out of scope

- full Key Art / Transition authoring UI
- Timeline / graph editor / mixer
- bones / deformers
- mask authoring or clipping rasterization
- proportional/topology mesh editing
- AI correspondence or generated intermediate artwork
- network MCP server

Issue #31 is the implementation authority for acceptance details and regression requirements.
