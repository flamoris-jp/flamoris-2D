# FLAMORIS 2D Development Roadmap

Status: draft

This roadmap is dependency-driven rather than date-driven. A phase is complete when its acceptance criteria pass.

The defining workflow is now:

```text
PSD Key Art A
  -> Rig / Mesh / Semantic Mapping
  -> Editable Transition
  -> PSD Key Art B
  -> optional Transition
  -> Key Art C ...
  -> Short MV Clip
```

MCP/AI readiness is an architectural constraint from the beginning, not a late integration task.

## Phase 0 — Repository and design baseline

Goal: make GitHub the source of truth before the prototype grows further.

Work:

- Commit the current Milestone 2 + PSD import + zoom/pan prototype source to GitHub.
- Preserve current passing tests.
- Keep design, research, feature matrix, and roadmap in GitHub.
- Adopt feature branches + PR review for implementation changes.
- Establish minimal version/changelog conventions.

Acceptance criteria:

- A fresh clone can `npm install`, `npm test`, and `npm start` successfully.
- Akino PSD import can be reproduced from GitHub.
- No implementation exists only in chat attachments/local ZIPs.

## Phase 1 — Editor Core + MCP-ready architecture

Goal: turn the prototype into a safe, headless-capable editor core shared by UI and future AI/MCP.

Work:

- Versioned Project model.
- Stable IDs for nodes, meshes, vertices, clips, Key Arts, transitions.
- Separate persistent project state from transient UI state.
- Headless command/query core independent of DOM.
- Command Layer for every mutation.
- Transactions / grouped commands.
- Validation API with machine-readable errors.
- Undo/Redo and action history.
- Project save/load.
- Autosave/recovery.
- Hierarchical Scene Tree from PSD hierarchy.
- Unicode/Japanese display names independent from source identity.
- Visibility, lock, search/filter.
- Canvas picking synchronized with tree.
- Inspector panel.
- GroupNode with transform inheritance.
- Transform/pivot model and gizmo.
- Minimal PSD re-import reconciliation/review.
- Define typed MCP-facing query/command schemas.
- Optional minimal development MCP smoke adapter to prove headless editing works without DOM events.

Acceptance criteria:

- Import Akino PSD and inspect the hierarchy through UI and headless query API.
- Rename/group/transform nodes and undo the edit.
- Save/reload deterministically.
- Re-import a known PSD change while preserving compatible project identity.
- Execute a basic edit using the same command API without browser pointer events.
- Validate project state after a transaction.

Why this comes first:

Every later feature, including Key Art transitions, bones, masks, animation, and AI assistance, depends on stable identities, transactions, persistence, and deterministic commands.

## Phase 2 — Multi-Key-Art Transition foundation

Goal: establish the core two-image workflow that differentiates FLAMORIS 2D.

Work:

- `KeyArt` domain object.
- Multiple PSD source assets in one project.
- `SemanticSlot` mapping across different drawings/layer names.
- `Transition` domain object connecting Key Art A -> B.
- Project timebase of 120000 integer ticks/second with rational render FPS.
- Shared `TemporalProgram`, integer keyframes, and step/linear/Bezier sampling.
- Typed Phase 2 tracks for geometry blend, appearance, opacity, presence,
  draw order, and clipping; no arbitrary persistent property paths.
- Headless arbitrary-time Transition evaluation that emits renderer-ready
  `EvaluatedPartState` / render instances.
- Reuse stable mesh topology from A on B.
- Per-Key-Art mesh keyforms with stable vertex IDs.
- Edit target mesh positions while viewing End Key Art B.
- Interpolate mesh geometry between A and B.
- Per-Key-Art UV sets.
- Dual-texture Morph evaluation with per-instance texture/UV state for compatible parts.
- Persistent transition modes: Morph, Hold, Replace, Appear, Disappear,
  Occlusion. Crossfade/Swap are UI presets that compile to core modes.
- Presence model: present / occluded / absent.
- Basic per-Key-Art draw order and transition visibility/opacity.
- Deterministic presence/draw-order handoffs, clipping-reference evaluation,
  and reason-specific feasibility diagnostics, including intermediate-Key-Art
  recommendations. Clipping authoring/rendering remains Phase 4.
- Save/load/undo/redo of mappings, TemporalProgram, and transition data.

Acceptance criteria:

- Import two layered Akino PSDs.
- Map corresponding parts even when display/source names differ.
- Create a mesh on A and use the same topology on B.
- Position B's mesh over B artwork.
- Scrub a deterministic A-to-B geometry transition.
- Blend A and B textures using their own UV mappings.
- Explicitly handle one A-only or B-only part.
- Save/reload with pixel/geometry-equivalent result.

## Phase 3 — Production mesh editing and correspondence tools

Goal: make target-keyform authoring and ordinary deformation fast enough for real production.

Work:

- Per-part mesh density controls.
- Proportional Editing: Smooth / Linear / Sharp.
- Wheel-adjustable radius.
- Connected-only mode.
- Box/lasso selection.
- Add/remove/connect vertices.
- Partial/full reset.
- Mirror editing.
- Mesh topology validation.
- Contour automesh evaluation.
- Correspondence anchors/pins between Key Arts.
- Smooth target-mesh solve from sparse anchors.
- Evaluate piecewise affine, barycentric propagation, TPS, and ARAP-style helpers.

Phase 3-3 delivers the deterministic sparse Contour AutoMesh path described in
`phase3-contour-automesh.md`. The existing grid generator remains available.
Correspondence assistance and deformation helpers remain later Phase 3 work.

Acceptance criteria:

- Front hair can be edited naturally without point-by-point drudgery.
- A target mesh keyform can be created from a few pinned correspondences and then manually refined.
- Invalid/incompatible topology is reported rather than silently corrupted.

## Phase 4 — Clipping and group deformers

Goal: support facial rigging, occlusion control, and grouped organic deformation.

Work:

- Source mask preservation/model.
- Part-to-part clipping.
- Eye clipping workflow.
- Clipping-aware WebGL render pass.
- Clipping visualization.
- Warp/Lattice Deformer.
- Deformer children and hierarchy validation.
- Deformer control point editing.
- Key-Art-specific clipping/visibility states where required.

Acceptance criteria:

- Iris/pupil remain inside the eye region during gaze/deformation.
- A sparse deformer moves multiple child parts.
- Mask/clipping state works through an A-to-B transition.

## Phase 5 — Bones and skinning

Goal: make limbs and large pose changes practical.

### 5A — FK proof

- Bone hierarchy.
- Edit vs pose mode.
- Origin/pivot and parent-child transforms.
- Rigid part attachment for workflow proof.

### 5B — Weighted skinning

- Per-vertex bone weights.
- Multiple influences.
- Weight normalization.
- Weight visualization/editing/painting.

### 5C — Convenience

- Rotation constraints.
- Simple 2-bone IK.
- Mirror rig helpers.

Acceptance criteria:

- Manipulate shoulder/upper-arm/forearm to pose Akino's arm.
- Elbow bends smoothly under weights.
- Direct mesh/form correction can be applied after skeletal deformation.
- Bone poses may differ between Key Arts while keeping semantic rig identity where compatible.

## Phase 6 — Animation system + multi-Key-Art sequencing

Goal: turn transitions and rig controls into a reusable MV timeline workflow.

Work:

- Reuse the Phase 2 `TemporalProgram`, 120000-tick timebase, typed-track
  union, keyframe IDs, and step/linear/Bezier sampler without redefining them.
- Multi-track timeline and deterministic clip/transition mixer.
- Tracks for node/group transforms, bones, deformers, mesh/form states.
- General keyframe CRUD and Ease presets compiled to existing Bezier data.
- Bezier graph editor after the track model stabilizes.
- Reusable Animation Clips and ClipInstances.
- Clip looping and clip instances.
- Pose/Form/Shape states.
- Visibility/opacity tracks.
- Key Art strip / sequence UI.
- Chain `A -> B -> C -> D` transitions.
- Transition timing/curves in the timeline.
- Draw-order step events where required.

Acceptance criteria:

- Build Blink, Breath, HairSway, HeadTilt clips.
- Combine normal rig animation with a two-Key-Art pose transition.
- Chain at least three Key Arts in one short shot.
- Scrub/play deterministically.

## Phase 7 — Production output and robustness

Goal: reliably finish a real MV shot.

Work:

- Render settings: canvas, FPS, duration, alpha.
- PNG sequence export.
- Transparent WebM where practical.
- Silent preview video export.
- Export progress/cancel/errors.
- Recovery testing.
- Large PSD/multi-Key-Art performance profiling.
- Missing-source diagnostics.
- Project migration tests.

Acceptance criteria:

- Create an 8-second multi-Key-Art Akino shot, save, reopen, preview, and export a transparent sequence usable downstream.
- Repeated export from identical project state is deterministic.

### Production Beta checkpoint

At the end of Phase 7, FLAMORIS 2D is a focused internal production tool rather than a prototype.

## Phase 8 — AI correspondence + full MCP workflow + bridges

Goal: use AI to reduce setup work without hiding or replacing the deterministic editor model.

MCP work:

- Production MCP server/adapter over existing typed commands/queries.
- Transactional bulk edits and dry-run previews.
- Semantic operations compiled to ordinary commands.
- Structured change summaries and confidence metadata.

Key Art AI assistance:

- Suggest semantic part mappings between drawings.
- Suggest core Morph/Hold/Replace/Appear/Disappear/Occlusion modes; a Swap
  suggestion compiles to ordinary core-mode commands.
- Suggest anchor/vertex correspondence.
- Optical-flow-assisted initialization for visually continuous changes.
- Semantic-correspondence-assisted mapping for larger pose/view changes.
- Confidence/ambiguity review UI.

Rig assistance:

- Auto clipping suggestions.
- Auto groups/pivots.
- Heuristic/pose-detection-assisted bones.
- Optional AI-assisted rigging.

Bridges:

- After Effects bridge.
- Blender importer/bridge.

Principle:

> AI proposes; deterministic commands commit.

The saved project must contain normal semantic mappings, mesh keyforms, rigs, transitions, and keyframes, not opaque model-generated state.

## Phase 9 — Advanced motion and specialized features

Candidates:

- spring/physics secondary motion
- automatic hair sway
- Glue/seam binding
- path deformer
- improved contour automesh
- advanced occlusion/depth transitions
- optional semantic parameter/driver layer
- idle helpers
- view-state graph branching
- generative intermediate-frame suggestions as non-destructive reference layers

Acceptance criteria should be defined per feature before implementation.

## Deferred unless production need appears

- real-time face/body tracking
- lip-sync/audio analysis
- full Live2D compatibility
- advanced rigid-body simulation
- game-engine runtime as primary product
- mandatory cloud/AI services

## Recommended GitHub workflow

Use GitHub as durable project memory:

```text
main
  reviewed stable state

feature/*
  implementation

docs/*
  design/research
```

For each capability:

1. keep acceptance criteria in roadmap/design,
2. create an Issue for testable work,
3. implement on a feature branch,
4. add tests for model/geometry/serialization behavior,
5. review through PR,
6. merge only when acceptance criteria pass,
7. tag meaningful checkpoints.

Suggested checkpoints:

```text
v0.1-prototype
v0.2-psd-import
v0.3-editor-core
v0.4-key-art-transition
v0.5-rigging
v0.6-animation
v0.7-production-beta
```
