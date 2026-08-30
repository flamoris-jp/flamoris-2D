# FLAMORIS 2D Development Roadmap

Status: draft

This roadmap is dependency-driven rather than date-driven. A phase is complete when its acceptance criteria pass.

## Phase 0 — Repository and design baseline

Goal: make GitHub the source of truth before the prototype grows further.

Work:

- Commit the current Milestone 2 + PSD import + zoom/pan prototype source to GitHub.
- Preserve the current passing tests.
- Add `basic-design.md`, `feature-matrix.md`, `roadmap.md`, and research notes.
- Decide package/project naming and version convention.
- Add a minimal changelog/release note convention.
- Use feature branches + PRs for future implementation changes.

Acceptance criteria:

- A fresh clone can `npm install`, `npm test`, and `npm start` successfully.
- The Akino PSD import prototype can be reproduced from the GitHub revision.
- No implementation exists only inside a chat attachment or local ZIP.

## Phase 1 — Editor foundation

Goal: turn the prototype into a safe editable project rather than a demo page.

Work:

- Introduce versioned `Project` model and stable IDs.
- Separate core project state from transient editor UI state.
- Introduce Command Layer.
- Undo/Redo and action history.
- Project save/load.
- Autosave/recovery.
- Hierarchical Scene Tree using PSD hierarchy.
- Japanese/Unicode display names independent from source/internal identity.
- Visibility, lock, search/filter.
- Canvas click picking synchronized with tree selection.
- Inspector panel.
- GroupNode with transform inheritance.
- Transform and pivot model.
- Transform gizmo.
- Implement PSD re-import matching/review at a minimal usable level.

Why this comes before bones:

Bones, masks, deformers, and timeline tracks all need stable node identity, hierarchy, undo, persistence, and selection. Building them first would force repeated rewrites.

Acceptance criteria:

- Import Akino PSD and see the full hierarchy in a tree.
- Rename a part to Japanese without losing source mapping.
- Group eye components and move the group.
- Undo/redo hierarchy and transform edits.
- Save, reload, and reproduce the same scene.
- Modify a known PSD layer, re-import it, and preserve existing project identity/rig data where compatible.

## Phase 2 — Production mesh editing

Goal: make direct deformation comfortable enough for real artwork.

Work:

- Per-part mesh density controls.
- Proportional Editing with Smooth/Linear/Sharp falloff.
- Wheel-adjustable influence radius.
- Connected-only mode.
- Box/lasso selection.
- Add/remove/connect vertices.
- Partial/full deformation reset.
- Mirror editing.
- Mesh topology validation.
- Evaluate contour automesh as optional alternative to grid automesh.

Acceptance criteria:

- A front-hair part can be shaped naturally without dragging dozens of vertices individually.
- Eye/mouth meshes can be edited precisely at useful zoom levels.
- Invalid topology is reported rather than silently corrupting rendering.

## Phase 3 — Clipping and deformers

Goal: support facial rigging and grouped organic deformation.

Work:

- Source mask model.
- Part-to-part clipping relationships.
- Eye clipping workflow.
- Clipping-aware WebGL render pass.
- Clipping visualization in editor.
- Warp/Lattice Deformer node.
- Child attachment to a deformer.
- Deformer control-point editing.
- Deformer hierarchy validation.

Acceptance criteria:

- Iris/pupil can move without rendering outside the eye region.
- A low-resolution face/hair deformer can move multiple child parts together.
- Deformer state survives save/load and undo/redo.

## Phase 4 — Bones and skinning

Goal: make limbs and larger poses practical.

Work in slices:

### 4A — Bone controls / FK proof

- Bone hierarchy.
- Bone edit mode vs pose mode.
- Pivot/origin and parent-child transforms.
- Rigid part attachment for initial workflow validation.

### 4B — Weighted mesh skinning

- Per-vertex bone weights.
- Multiple bone influences.
- Weight normalization.
- Weight visualization.
- Basic weight editing/painting.

### 4C — Rig convenience

- Rotation constraints.
- Simple 2-bone IK for arms/legs.
- Optional mirror rig helpers.

Acceptance criteria:

- Move Akino's arm by manipulating shoulder/upper-arm/forearm controls.
- Elbow deformation is smooth under weighted skinning.
- User can apply a direct mesh/form correction after the skeletal pose.

## Phase 5 — Animation system v2

Goal: move from A/B prototype animation to a reusable MV animation workflow.

Work:

- Multi-track timeline.
- Tracks for Group/Part transforms.
- Tracks for bones and deformers.
- Tracks for mesh/form deformation.
- Keyframe add/move/delete/copy.
- Linear + Ease In/Out interpolation.
- Bezier/graph editor after the track model is stable.
- Reusable Animation Clips.
- Clip looping.
- Clip instances on shot timeline.
- Pose/Form states such as `EyesClosed`, `Smile`, `LookLeft`.
- Blendable shape/form influence.
- Optional visibility/opacity tracks.

Acceptance criteria:

- Build reusable `Blink`, `Breath`, `HairSway`, and `HeadTilt` clips.
- Place multiple blink instances without recreating eye keyframes.
- Animate body/bones, facial forms, and hair deformers together in one short shot.
- Preview and scrub deterministically.

## Phase 6 — Production output and robustness

Goal: reliably finish a real MV shot with the editor.

Work:

- Render settings: canvas, FPS, duration, alpha.
- PNG sequence export.
- Transparent WebM where practical.
- Silent preview video export.
- Export progress/cancel/error handling.
- Recovery testing and large-PSD performance work.
- Project diagnostics for missing source files/references.
- Performance profiling for multi-part deformed scenes.

Acceptance criteria:

- Create an 8-second Akino shot, save it, reopen it, preview it, and export a transparent sequence usable in After Effects/Premiere/Blender pipeline.
- Export is deterministic across repeated runs from the same project.

### Production Beta checkpoint

At the end of Phase 6, FLAMORIS 2D can reasonably be treated as a focused internal production tool rather than a prototype.

## Phase 7 — Secondary motion and advanced rigging

Goal: reduce repetitive animation work without compromising manual control.

Candidates:

- simple spring/physics secondary motion
- automatic hair sway helper
- Glue / seam binding between adjacent meshes
- path deformer for long hair/ribbons
- better contour automesh
- additional blend modes
- optional semantic parameter/driver layer
- idle motion helpers such as blink/breath/gaze drift

Acceptance criteria should be defined per feature before implementation.

## Phase 8 — Bridges, MCP, and assisted rigging

Goal: leverage the stable project/command model for automation and pipeline integration.

Work:

- Low-level MCP around existing commands.
- Semantic MCP commands such as `blink`, `tilt_head`, `bend_hair`, `raise_arm`.
- After Effects bridge.
- Blender importer/bridge.
- Auto clipping suggestions.
- Auto group/pivot suggestions.
- Heuristic or pose-detection-assisted bone setup.
- Optional AI-assisted rigging.

Principle:

AI or MCP must not create a parallel hidden editing system. They should produce the same project operations and commands as the UI.

## Deferred unless a concrete production need appears

- real-time face/body tracking
- lip-sync system
- full Live2D parameter compatibility
- advanced rigid-body physics
- game-engine runtime as a primary product
- AI image decomposition as a required dependency

## Recommended GitHub workflow

Use GitHub as the durable project memory:

```text
main
  stable reviewed state

feature/*
  implementation work

docs/*
  design/research updates
```

For each phase:

1. maintain the roadmap acceptance criteria,
2. create Issues for individually testable capabilities,
3. implement through a feature branch,
4. require tests for model/geometry/serialization behavior,
5. review via PR,
6. merge only when acceptance criteria are satisfied,
7. tag meaningful checkpoints.

Suggested checkpoint tags:

```text
v0.1-prototype        PNG mesh + A/B animation
v0.2-psd-import       PSD direct import + multi-part reconstruction
v0.3-editor-core      scene tree + project + undo/reimport
v0.4-rigging          clipping + deformers + bones
v0.5-animation        clip-first timeline
v0.6-production-beta  reliable short-shot export
```

Exact version numbers may change before the first tagged baseline.