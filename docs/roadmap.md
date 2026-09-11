# FLAMORIS 2D Development Roadmap

Status: active

This roadmap is dependency-driven rather than date-driven. A phase is complete when its acceptance criteria pass.

FLAMORIS 2D is optimized for producing short deterministic moving-picture shots from layered or flat artwork. It is not intended to reproduce every Live2D feature before real production use begins.

The defining workflow is now:

```text
PSD / PNG artwork
  -> Scene / Mesh / Semantic Mapping
  -> Clipping / Warp / Bones / Skinning where needed
  -> Key Art A -> B -> C ...
  -> reusable AnimationClips such as Blink / Breath / HairSway
  -> deterministic Sequence preview
  -> deterministic PNG / MP4 export
  -> MV shot
```

MCP/AI readiness remains an architectural constraint from the beginning, not a late integration task.

## Current checkpoint

Implemented through the current production core:

- Phase 0 repository/design baseline
- Phase 1 Editor Core + Windows Desktop shell
- Phase 2 deterministic Key-Art Transition foundation and authoring
- Phase 3 production mesh topology, Contour AutoMesh, and correspondence assistance
- Phase 4 deterministic PNG / Windows MP4 export
- repository-wide architecture audit and targeted refactor after Phase 4
- Phase 6 clipping + Warp/Lattice Deformer
- Phase 7 Bones, FK, rigid/weighted skinning, form correction, constraints, IK, and mirror helpers
- Phase 8 Multi-Key-Art Sequence / Clip animation architecture, authoring UI, deterministic mixer, and automated production proof

Phase 5 input-simplification work remains experimental/deferred and does not block the current production pipeline.

### Current production gate

The remaining gate is real packaged-Windows production QA with actual artwork/projects and a real supported FFmpeg path:

- launch the packaged app
- author or open a real multi-Key-Art shot
- scrub/play Sequence animation
- verify clipping / Warp / Bone / reusable Clip motion visually
- Save, close, reopen, and continue editing
- export PNG sequence
- export actual H.264 MP4 through Windows Media Foundation
- inspect output and repeatability

Automated Phase 8 production proof already covers deterministic Sequence evaluation, reusable Blink/Breath/HairSway clips, Undo/Redo, Save/Open equivalence, clipping coexistence, rig/Warp coexistence, and Preview/PNG/MP4 source-frame parity.

---

## Phase 0 — Repository and design baseline — COMPLETE

Goal: make GitHub the source of truth before the prototype grows further.

Delivered:

- Product source and design history in GitHub
- feature branches + PR review
- reproducible Product test entry point
- documented repository/runtime boundaries

---

## Phase 1 — Editor Core + MCP-ready architecture — COMPLETE

Goal: provide one safe editor core shared by UI, Desktop, tests, and future AI/MCP clients.

Delivered includes:

- versioned Project model
- stable scene identity
- Query / Command / Transaction / EditorSession
- Undo/Redo
- validation and migration
- deterministic Save/Open and recovery
- PSD import/re-import
- Scene Tree, Inspector, selection, and transforms
- Browser/Desktop adapters
- Windows Desktop shell and native file workflows
- typed MCP-ready command/query schemas

---

## Phase 2 — Deterministic Key-Art Transition foundation — COMPLETE

Goal: establish the multi-image transition workflow that differentiates FLAMORIS 2D.

Delivered includes:

- `KeyArt`
- `SemanticSlot`
- `Transition`
- `TemporalProgram`
- canonical 120000 ticks/sec timebase
- rational FPS and deterministic sampling
- typed geometry / appearance / opacity / presence / draw-order tracks
- stable shared mesh topology and per-Key-Art keyforms
- Morph / Hold / Replace / Appear / Disappear / Occlusion
- deterministic renderer-ready evaluation
- A/B authoring and endpoint workflow
- Transition preview and typed timing controls
- diagnostics and preview-authority reporting
- persistence and Undo/Redo equivalence

---

## Phase 3 — Production mesh editing and correspondence — COMPLETE

Goal: make target-keyform authoring practical enough for real production.

Delivered includes:

- Deform Mode and Topology Edit Mode
- Project-global stable vertex identity
- visible vertex IDs and optional Semantic Labels
- add/remove/connect/subdivide topology commands
- deterministic topology mutation contract
- reusable Key State Strip projection
- deterministic Contour AutoMesh with Grid fallback
- correspondence pins using stable vertex IDs
- deterministic target-keyform initialization
- ordinary editable MeshKeyform output after correspondence Apply

Deferred helpers remain optional future work rather than blockers:

- brush/proportional editing
- lasso selection
- smooth/relax
- advanced mirror tools
- TPS / ARAP / Laplacian solvers

---

## Phase 4 — Deterministic production export — COMPLETE IMPLEMENTATION

Goal: turn authored animation into actual output using the same deterministic semantics as preview.

Delivered includes:

### 4-1 Deterministic frame render pipeline

- rational FPS -> deterministic frame/tick plan
- half-open export tick-domain boundary
- canonical evaluator reuse
- shared preview/export composition semantics
- viewport-independent offscreen rendering
- RGBA frame readback

### 4-2 PNG sequence export

- deterministic `frame_000001.png` ordering
- PNG encoding boundary
- Desktop-owned destination/filesystem operations
- conflict handling
- progress and cancellation
- explicit partial-output policy

### 4-3 Windows MP4/H.264 integration

- external FFmpeg boundary
- Windows Media Foundation `h264_mf` path
- capability/license gate
- deterministic encoder invocation
- process diagnostics and cancellation
- incomplete-output cleanup

### 4-4 Export UX

- compact Export dialog
- resolution presets/custom size
- rational FPS presets/custom FPS
- PNG sequence and MP4
- native destination selection
- progress/cancel/diagnostics
- one-step temporary-frame MP4 workflow

The remaining export gate is packaged-Windows manual production QA with real artwork and real FFmpeg, now tracked as part of the current production gate rather than unfinished export architecture.

---

## Phase 5 — Input Simplification / Part Decomposition — EXPERIMENTAL / DEFERRED

Goal: reduce setup effort when no layered PSD exists.

A classical cutout experiment explored human-in-the-loop flat-image decomposition with deterministic local tools. Useful findings include:

- Polygon Lasso as an exact final binary selection
- FG/BG refinement where needed
- multi-layer cutouts and masks
- manual Patch-based hidden-region repair
- blur/smudge cleanup
- original-image visibility for recovering damaged or occluded details
- lightweight `.flimg` style packaging concepts for cutout layers and order metadata

The experiment confirmed that rough perceptual sufficiency and editing speed matter more than pixel-perfect segmentation for short moving-picture clips.

This work is intentionally not a blocker for the current PSD/part-based production pipeline. Future input simplification should reuse the same principle used elsewhere in FLAMORIS:

> helpers propose or prepare ordinary editable data; the deterministic Project model remains authoritative.

Future candidates:

- deterministic candidate-mask generation
- review/merge/delete candidate workflow
- rough stacking-order assistance
- optional AI-assisted segmentation layered on top of the deterministic review/apply path

---

## Phase 6 — Clipping and Group Deformer — COMPLETE

Goal: support facial occlusion and grouped organic deformation without turning FLAMORIS into a full Live2D clone.

Delivered includes:

- persistent clipping bindings with stable identity
- clipping validation and cycle protection
- clipping authoring UI and diagnostics
- clipping-aware shared preview/export renderer
- final-geometry clipping resolution
- Warp/Lattice Deformer domain model
- 2x2 / 3x3 / 4x4 deterministic lattices
- stable Warp control-point IDs
- Key-Art-specific Warp keyforms
- nested parent-first Warp semantics
- child-lattice projection through parent Warp
- Deformer authoring and Transition integration
- persistence, Undo/Redo, Commands/Queries, and MCP-ready schemas

Acceptance achieved:

- clipped facial parts remain constrained through deformation
- one sparse deformer can affect grouped child content
- clipping and Warp coexist with Transition preview/export semantics

---

## Phase 7 — Bones and Skinning — COMPLETE

Goal: make limbs and large pose changes practical when mesh/deformer editing alone is inefficient.

Delivered includes:

### Bone / FK foundation

- persistent Bone and BonePoseKeyform
- Scene-owned Bone hierarchy
- deterministic parent-first FK
- post-Warp projected Bone frames
- Bone Edit / Pose authoring
- rigid Bone attachment

### Weighted skinning and correction

- persistent SkinBinding
- stable-vertex-ID weights
- one-to-four normalized influences
- weight authoring and visualization
- deterministic linear blend skinning
- MeshFormCorrectionKeyform
- direct correction after skeletal deformation

### Constraints and helpers

- rotation constraints
- authoring-only analytic two-bone IK
- mirror helpers
- exact Undo/Redo and persistence

Canonical evaluation keeps Warp before projected Bone frames, constraints before FK, skin/rigid deformation before form correction, and clipping after final deformation.

---

## Phase 8 — Multi-Key-Art Animation and Clip Sequencing — COMPLETE IMPLEMENTATION / AUTOMATED PROOF

Goal: move from isolated A -> B Transitions to reusable short MV shots.

The normative contracts are defined in [`phase8-animation-sequencing.md`](phase8-animation-sequencing.md), with the production proof recorded in [`phase8-production-proof.md`](phase8-production-proof.md).

Delivered includes:

### 8-1 Sequence / ViewLane foundation

- persistent `Sequence`
- one owned `TemporalProgram` per Sequence
- strict contiguous ViewLane coverage
- KeyArtHold / TransitionInstance
- deterministic boundary ownership
- exact rational Transition retiming

### 8-2 AnimationClip / ClipInstance foundation

- reusable `AnimationClip`
- owned clip TemporalPrograms
- persistent `ClipInstance`
- once / loop semantics
- exact local-time projection
- source offset / rational playback rate / weight / layer

### 8-3 General typed animation tracks

- TransformTrack
- BoneTrack
- DeformerTrack
- MeshDeformationTrack
- CameraTrack
- opacity and discrete intent tracks
- stable target identity and owner-aware validation

### 8-4 Deterministic mixer

- canonical contribution ordering
- Transition/KeyArt semantic base + Clip overlays
- Deformer before Warp
- Bone mix before constraints/FK/skin
- form correction before MeshDeformationTrack
- Transform stage after rig geometry
- final clipping and Sequence camera
- renderer remains Sequence/Clip unaware

### 8-5 Timeline authoring UX

- Sequence selection/lifecycle
- Key Art strip / ViewLane editing
- scrub/playback/time display
- Clip library and ClipInstance placement/editing
- owner-aware track/keyframe editing
- transient Clip-local authoring tick
- one gesture = one history unit
- drag cancel/no-op history protection

### 8-6 Motion polish and production proof

- Ease In / Ease Out / Ease In Out convenience compiled to explicit Bezier control points
- reusable Blink / Breath / HairSway authored as ordinary typed AnimationClips
- at least three distinct Key Arts in one Sequence
- Transition retiming across A -> B -> C
- node Transform + Warp + Bone + rigid/skin/form-correction coexistence
- final-geometry clipping coexistence
- deterministic looping and Clip reuse
- Undo/Redo production regression coverage
- Save/Open semantic equivalence
- Preview / PNG / MP4 source-frame parity
- realistic 5-second proof at 24 fps using the canonical 120000 ticks/sec timebase
- automated Product and Windows packaging validation

Phase 8 implementation is considered complete. The remaining manual packaged-Windows validation belongs to the current production gate and Phase 9 robustness work, not to a missing animation architecture feature.

Deferred beyond Phase 8:

- full graph editor
- nested AnimationClips
- reusable Camera clips
- runtime IK
- physics/procedural secondary motion
- audio/NLE workflow

---

## Phase 9 — Production Robustness / Beta — NEXT

Goal: turn the feature-complete core into a dependable internal MV production tool.

Primary work:

- end-to-end packaged Windows QA and regression closure
- real FLAMORIS PSD / multi-Key-Art project validation
- actual Windows Media Foundation MP4 encoding and playback
- large-project and multi-Key-Art profiling
- missing-source and decode diagnostics
- migration/recovery stress testing
- export stress/cancellation/temp-cleanup testing
- render/performance profiling
- production presets only where real workflow evidence justifies them
- dependency lockfile/provenance maintenance
- public repository readiness where desired

Acceptance criteria:

- create an approximately 8-second multi-Key-Art Akino shot using real artwork
- use reusable animation clips in that shot
- save, close, reopen, edit, preview, and export successfully
- produce real PNG and H.264 MP4 output on Windows
- repeated export from identical project state is deterministic
- failures are actionable rather than silent
- no production blocker remains from the Phase 1-8 architecture

### Production Beta checkpoint

At the end of Phase 9, FLAMORIS 2D is a focused internal production tool rather than an experimental editor.

---

## Phase 10 — AI-Assisted Input and Authoring

Goal: use AI to reduce setup work without hiding or replacing the deterministic editor model.

Candidate capabilities:

- semantic part proposals for flat images
- improved mask/matting suggestions
- hidden-part completion as optional proposed artwork
- stacking-order suggestions
- semantic-label suggestions
- correspondence anchor/vertex suggestions
- Transition mode suggestions
- clipping/group/pivot suggestions
- optional rigging assistance
- transactional dry-run previews and structured change summaries

Principle:

> AI proposes; deterministic commands commit.

Accepted output must become ordinary editable FLAMORIS Project data. Model-private latent state must never become required persistent authority.

---

## Phase 11 — Bridges and Advanced Production Features

Candidates:

- After Effects bridge
- Blender importer/bridge
- spring/physics secondary motion
- automatic hair sway
- Glue/seam binding
- path deformer
- improved contour automesh
- advanced occlusion/depth transitions
- optional semantic parameter/driver layer
- generative intermediate-frame suggestions as non-destructive references

Acceptance criteria should be defined per feature before implementation.

---

## Deferred unless production need appears

- real-time face/body tracking
- full Live2D compatibility
- game-engine runtime as the primary product
- advanced rigid-body simulation
- mandatory cloud/AI services
- DAW/NLE replacement features

Audio analysis/lip-sync may later integrate with FLAMORIS production workflows, but should reuse the established deterministic command/timeline boundaries rather than drive core architecture prematurely.

---

## Near-term execution order

1. Complete packaged Windows manual QA for the Phase 8 production pipeline.
2. Fix any blocker/major defects found by QA as focused Issues and small single-purpose commits.
3. Close Phase 8 once real launch, Save/Open, PNG, and actual MP4 output are verified.
4. Begin Phase 9 using a real approximately 8-second FLAMORIS/Akino shot as the production acceptance project.
5. Profile and harden only the bottlenecks exposed by real production.
6. Revisit input simplification / part decomposition after the main production loop is dependable.
7. Add AI assistance only where it can propose ordinary deterministic edits without becoming persistent authority.

This order deliberately favors producing real MV shots and hardening the existing architecture over adding broad new feature families.

---

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

Large implementation work should be committed in resumable logical slices such as foundation / domain / evaluator / command / UI / tests / fixes. Phase numbers should describe actual architectural checkpoints rather than preserve an obsolete implementation order for appearance alone.
