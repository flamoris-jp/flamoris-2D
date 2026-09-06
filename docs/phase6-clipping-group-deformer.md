# Phase 6: Clipping and Group Deformer

Status: proposed for implementation

## 1. Goal

Phase 6 adds the minimum production rigging primitives needed for FLAMORIS MV shots without turning the editor into a full Live2D-compatible rigging suite.

Phase 6 has two responsibilities:

1. **Clipping** — constrain rendered child artwork to another part's evaluated visible region, preserving correctness through mesh deformation, Key Art Transition, preview, and deterministic export.
2. **Warp / Lattice Group Deformer** — deform one or more Scene children with a sparse control lattice while preserving ordinary child meshes, transforms, Key Art identity, preview/export determinism, and future animation compatibility.

Out of scope: bones, skinning, IK, physics, general timeline, Animation Clips, Multi-Key-Art sequencing, AI rigging, arbitrary compositing graphs, boolean mask trees, and mask painting.

## 2. Architectural constraints

Reuse the existing architecture:

```text
Human UI / AI-MCP / Tests
        -> Query / Command
        -> Project
        -> Evaluation Core
        -> EvaluatedFrame
        -> Shared Renderer
        -> Preview / Export
```

Rules:

- all persistent mutations go through Commands;
- UI/transient visualization state is not Project state;
- the renderer does not infer rig, Transition, or semantic relationships;
- preview and export use identical evaluated clipping/deformation semantics;
- source artwork and existing MeshTopology / MeshKeyform remain authoritative;
- no parallel evaluator, time model, renderer, or hidden AI-only state is introduced.

## 3. Implementation split

Implement as four independently reviewable stages:

1. **6-1 Clipping Domain Foundation**
2. **6-2 Clipping Renderer and Authoring**
3. **6-3 Warp/Lattice Deformer Foundation**
4. **6-4 Deformer Authoring and Transition Integration**

## 4. Clipping model

Source masks and clipping are distinct concepts.

A **source mask** changes a part's own alpha/content, including imported PSD masks where supported.

**Clipping** restricts an already-evaluated target to an evaluated source region:

```text
targetAlpha = targetAlpha * clipSourceAlpha
```

Initial persistent model:

```text
ClippingBinding
├── id
├── targetNodeId
├── sourceNodeId
├── mode: inside
└── enabled
```

Phase 6 initially supports one clipping source per target. One source may clip multiple targets. Arbitrary compositing graphs are intentionally excluded.

Required validation:

- target/source exist;
- target != source;
- target/source are renderable;
- no clipping dependency cycle;
- references survive Save/Open.

Clipping relationships that change across time reuse the existing discrete `ClippingTrack` / `TemporalProgram` concepts. Identity changes are step-sampled only; no interpolation between arbitrary clipping-source identities.

## 5. Evaluated clipping contract

Evaluation resolves persistent clipping data into renderer-ready relationships.

Conceptually:

```text
EvaluatedRenderInstance
└── clipping
    ├── sourceRenderInstanceId
    └── mode
```

The renderer must not search Scene relationships, semantic mappings, or Transition modes to discover clipping.

Diagnostics should include:

- `CLIPPING_SOURCE_MISSING`
- `CLIPPING_TARGET_MISSING`
- `CLIPPING_CYCLE`
- `CLIPPING_SOURCE_NOT_RENDERABLE`

## 6. Clipping render order

Canonical order:

```text
source artwork
-> source mask
-> Key Art / Transition geometry
-> rig deformation
-> node/world transform
-> opacity / presence
-> clipping
-> compositing
```

The clipping mask must come from the same final evaluated geometry used to render the clipping source. Do not create a second independent clipping mesh.

Renderer implementation may use an offscreen alpha target, framebuffer, or stencil internally, but backend details must not leak into Project/Evaluation contracts.

## 7. Clipping authoring

Minimum Commands:

- `CreateClippingBinding`
- `SetClippingSource`
- `SetClippingEnabled`
- `RemoveClippingBinding`
- `SetClippingTrackKeyframe`

Minimum Queries:

- `clipping.get_for_node`
- `clipping.list`
- `clipping.validate`

UI:

- Scene Tree clipping indicator;
- Inspector `Enable clipping`, `Clip To`, initial mode `Inside`;
- optional transient viewport `Show Clipping Mask` visualization.

Required behavior: iris/pupil/highlight can clip to an eye region and remain constrained while source and target meshes deform and during A -> B Transition.

## 8. Warp/Lattice Deformer model

A Warp Deformer is a real rig/scene primitive that affects one or more children without baking ordinary playback into child MeshKeyforms.

Example:

```text
HeadWarp
├── Face
├── EyeLeft
├── EyeRight
├── Mouth
└── FrontHair
```

Initial persistent shape:

```text
WarpDeformer
├── id
├── displayName
├── parentNodeId
├── columns
├── rows
├── bounds
└── controlPointIds[]

WarpControlPoint
├── id
├── u
└── v

WarpDeformerKeyform
├── deformerId
├── keyArtId
└── controlPoints[]
    ├── controlPointId
    ├── x
    └── y
```

Initial grid presets: 2x2, 3x3, 4x4.

Control points require stable identity. Key Art A and B may store different authored control-point positions while compatible Deformer topology remains stable.

## 9. Deformation semantics

Initial implementation should use deterministic regular lattice interpolation, such as bilinear/bicubic evaluation over the grid.

Requirements:

- same input -> same output;
- continuous, stable deformation;
- DOM-independent evaluation;
- no hidden iterative runtime solver;
- preview/export portability.

For each child vertex:

1. convert to Deformer-local coordinates;
2. derive normalized lattice coordinates;
3. evaluate lattice displacement;
4. apply deformed position;
5. continue downstream world transform/render evaluation.

Canonical Phase 6 geometry order:

```text
MeshKeyform base
-> Transition geometry interpolation
-> Warp/Lattice Deformer
-> future Bone/Skinning stage
-> future animation/form correction
-> node/world transform
-> appearance/opacity/presence/draw order
-> resolved clipping
-> EvaluatedFrame
-> shared renderer
```

The future bone stage is reserved explicitly so Phase 7 cannot silently redefine existing Warp behavior.

## 10. Nested deformers and hierarchy

Allow ordinary tree hierarchy:

```text
BodyWarp
└── HeadWarp
    └── Face
```

Evaluation is parent-first. Arbitrary influence graphs are not supported. Deformer hierarchy cycles are invalid.

Clipping needs no special deformation subsystem: source and target geometries are both evaluated normally, then clipping uses their final evaluated forms.

## 11. Deformer and Transition integration

For compatible Key Art Deformer keyforms:

```text
controlPoint(t) = lerp(controlPointA, controlPointB, transitionWeight)
```

Reuse the existing deterministic Transition timing and timebase.

If required Deformer keyforms/topology are missing or incompatible, evaluation emits diagnostics rather than inventing geometry.

Example diagnostics:

- `DEFORMER_PARENT_MISSING`
- `DEFORMER_CYCLE`
- `DEFORMER_KEYFORM_MISSING`
- `DEFORMER_KEYFORM_INCOMPATIBLE`
- `DEFORMER_CONTROL_POINT_INVALID`
- `DEFORMER_CHILD_REFERENCE_INVALID`

## 12. Deformer authoring and commands

Minimum Commands:

- `CreateWarpDeformer`
- `RemoveWarpDeformer`
- `RenameWarpDeformer`
- `SetWarpDeformerGrid`
- `ReparentNodeToDeformer`
- `MoveWarpControlPoints`
- `ResetWarpControlPoints`
- `SetWarpDeformerKeyform`

Grid topology changes must either deterministically migrate all compatible keyforms or be rejected. Never silently discard authored Key Art states.

UI should provide:

- Deformer node in Scene Tree;
- Inspector grid preset and active Key Art;
- viewport lattice boundary, grid, control points, selection, box select, move, reset selected/all;
- Key Art A/B marker and optional transient ghost comparison.

No brush/proportional-edit layer is required initially because the lattice itself provides broad deformation.

## 13. Animation readiness

Phase 6 does not introduce general timeline authoring.

Keep these concepts separate:

```text
WarpDeformer = rig capability
WarpDeformerKeyform = authored Key Art state
DeformerTrack = future time-varying animation
```

The existing animation data model reserves DeformerTrack/TemporalProgram concepts. Phase 8 general animation and clip sequencing should reuse them rather than redesign the Deformer model.

## 14. Persistence and migration

Project schema gains explicit representation for clipping bindings and Warp Deformer/keyform data.

Requirements:

- older projects migrate deterministically to empty collections;
- stable IDs survive Save/Open;
- no transient viewport state enters Project JSON;
- Undo/Redo and transactions cover all persistent authoring operations.

## 15. MCP readiness

Candidate queries:

- `clipping.list`
- `clipping.get`
- `deformer.list`
- `deformer.get`
- `deformer.get_keyform`

Candidate mutations:

- `clipping.set_source`
- `clipping.remove`
- `deformer.create_warp`
- `deformer.move_control_points`
- `deformer.set_keyform`
- ordinary scene reparenting through the existing command boundary

AI may later compile a semantic request such as "keep the iris inside the left eye" into these deterministic operations, but Phase 6 requires no AI runtime.

## 16. Test strategy

Domain tests:

- clipping validation and cycle rejection;
- Deformer hierarchy/cycle validation;
- stable control-point identity;
- Key Art keyform persistence;
- Undo/Redo equivalence.

Geometry tests:

- undeformed lattice is identity;
- deterministic point displacement;
- boundary behavior;
- nested deformers;
- A/B Deformer interpolation.

Renderer tests:

- fully/partially clipped target;
- transparent clipping source;
- deformed clipping source and target;
- dual-texture Transition under clipping.

Export regression:

```text
preview evaluated semantics
= PNG export evaluated semantics
= MP4 source-frame evaluated semantics
```

within existing raster/output contracts.

## 17. Acceptance criteria

Phase 6 is complete when a real FLAMORIS character can:

1. clip iris/pupil/highlight inside an eye region;
2. deform the eye while preserving clipping;
3. deform multiple head/face parts through one sparse Warp Deformer;
4. retain independent ordinary child meshes;
5. author different Warp keyforms for Key Arts A and B;
6. scrub A -> B deterministically;
7. preserve clipping throughout the Transition;
8. Save/Open without semantic loss;
9. Undo/Redo all persistent operations;
10. export PNG/MP4 matching preview semantics;
11. work offline without AI/cloud services.

## 18. Recommended commit boundaries

Use small, single-purpose commits where practical:

```text
phase6/clipping-domain
phase6/clipping-evaluation
phase6/clipping-renderer
phase6/clipping-ui
phase6/deformer-domain
phase6/deformer-evaluator
phase6/deformer-ui
phase6/integration-tests
phase6/fixes
```

## 19. Production proof

Use a small real face rig first:

```text
Akino face
├── eye white
│   ├── iris
│   └── pupil
├── mouth
├── front hair
└── face
```

Proof flow:

```text
Key Art A: front / neutral
-> slight Head/Face Warp
-> Key Art B: small head tilt / expression change
-> iris remains clipped
-> face/hair deform together
-> preview
-> PNG
-> MP4
```

If this flow succeeds without special-case code, Phase 6 has satisfied its production purpose.
