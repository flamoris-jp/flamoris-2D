# FLAMORIS 2D Development Roadmap

Status: active

This roadmap is dependency-driven rather than date-driven. A phase is complete when its acceptance criteria pass.

FLAMORIS 2D is optimized for producing moving-picture shots from layered or flat artwork with deterministic editing, preview, and export. It is not intended to reproduce every Live2D feature before real production use begins.

The defining workflow is now:

```text
PSD or PNG artwork
  -> optional part decomposition
  -> Scene / Mesh / Semantic Mapping
  -> Key Art A -> B transition
  -> optional Key Art C / D sequence
  -> preview
  -> deterministic PNG / MP4 export
  -> MV shot
```

MCP/AI readiness is an architectural constraint from the beginning, not a late integration task.

## Current checkpoint

Implemented and merged:

- Phase 0 repository/design baseline
- Phase 1 Editor Core + Windows Desktop shell
- Phase 2 deterministic two-Key-Art Transition foundation and authoring
- Phase 3 production mesh topology, Contour AutoMesh, and correspondence assistance
- Phase 4 deterministic video export through PNG sequence and Windows MP4
- repository-wide architecture audit and targeted refactor after Phase 4

Current production gate:

- real Windows manual QA using actual artwork/projects and real FFmpeg

The sections below preserve completed work and define the next implementation order.

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
- deterministic save/open and recovery
- PSD import/re-import
- Scene Tree, Inspector, selection and transforms
- Browser/Desktop adapters
- Windows Desktop shell and native file workflows
- typed MCP-ready command/query schemas

Remaining acceptance work is manual Windows production QA, not core implementation.

---

## Phase 2 — Deterministic Multi-Key-Art Transition foundation — COMPLETE

Goal: establish the two-image workflow that differentiates FLAMORIS 2D.

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

Deferred advanced helpers remain optional future work rather than blockers:

- brush/proportional editing
- lasso selection
- smooth/relax
- advanced mirror tools
- TPS / ARAP / Laplacian solvers

---

## Phase 4 — Deterministic production export — COMPLETE IMPLEMENTATION

Goal: turn an authored Transition into an actual video output using the same deterministic semantics as preview.

Delivered includes:

### 4-1 Deterministic frame render pipeline

- rational FPS -> deterministic frame/tick plan
- half-open tick-domain boundary
- canonical Transition evaluator reuse
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

### Remaining Phase 4 gate

Run real Windows production QA with:

- actual FLAMORIS project/artwork
- PNG sequence comparison against preview
- real supported FFmpeg
- MP4 playback
- viewport-independence checks
- cancellation/conflict/temp-cleanup checks
- edit-after-export checks

---

## Phase 5 — Input Simplification and PNG Part Decomposition

Goal: reduce the effort required before authoring can begin, especially when no layered PSD exists.

A single flat PNG should be able to enter FLAMORIS through a lightweight deterministic path first, with AI assistance layered on later rather than becoming a mandatory dependency.

### Phase 5A — PNG Part Decomposition Light

Goal: turn one flat or partially transparent PNG into rough editable part candidates without AI.

Initial candidates:

- alpha-connected-region analysis
- contour / edge / color-region heuristics where useful
- deterministic candidate masks/cutouts
- merge/delete/review of proposed parts
- rough stacking-order assistance where deterministic evidence exists
- generated temporary names such as `part_001`
- Apply into ordinary Scene/render-asset structures

Principles:

- no opaque persistent decomposition model
- no mandatory cloud service
- deterministic inputs produce deterministic candidate output
- decomposition preview is transient
- accepted results become ordinary editable FLAMORIS parts
- hidden/occluded pixels are not fabricated by the Light path

Acceptance criteria:

- import one PNG and produce multiple editable part candidates
- review, reject, merge, or accept candidates
- Apply creates normal project content usable by existing mesh/Transition tools
- accepted results survive Save/Open
- ordinary Project mutation/history rules remain intact
- no AI runtime is required

### Phase 5B — Input workflow polish

Goal: make PSD and PNG entry equally understandable in production.

Work may include:

- Import PSD / Import PNG / Decompose PNG entry points
- clear decomposition Review/Apply workflow
- source-artwork provenance and replacement behavior
- diagnostics for unusable segmentation candidates
- production testing with character illustrations rather than synthetic fixtures only

---

## Phase 6 — Clipping and group deformers

Goal: support common facial occlusion and grouped organic deformation without turning FLAMORIS into a full Live2D clone.

Work:

- source mask preservation/model
- part-to-part clipping
- eye clipping workflow
- clipping-aware render pass
- clipping visualization
- Warp/Lattice Deformer
- deformer child hierarchy
- control-point editing
- Key-Art-specific clipping/visibility state where required

Acceptance criteria:

- iris/pupil remain constrained inside an eye region during deformation
- one sparse deformer can move multiple child parts
- clipping/deformer results remain valid through a Transition and export

Implementation priority may be adjusted by real-production QA findings.

---

## Phase 7 — Bones and skinning

Goal: make limbs and large pose changes practical when mesh/deformer editing alone becomes inefficient.

### 7A — FK proof

- Bone hierarchy
- Edit vs Pose mode
- origin/pivot and parent-child transforms
- rigid part attachment

### 7B — Weighted skinning

- per-vertex bone weights
- multiple influences
- normalization
- weight visualization/editing

### 7C — Convenience

- rotation constraints
- simple 2-bone IK
- mirror rig helpers

Acceptance criteria:

- pose shoulder / upper arm / forearm efficiently
- elbow bends acceptably under weights
- direct mesh/form correction remains possible after skeletal deformation
- Key Arts may use different bone poses while preserving compatible semantic identity

---

## Phase 8 — Multi-Key-Art Animation and Clip Sequencing

Goal: move from isolated A -> B Transitions to reusable short MV shots.

This phase reuses the existing TemporalProgram/timebase/evaluator architecture instead of inventing a second timeline model.

The normative Sequence ownership, ViewLane/ClipInstance boundary, mixer, and
evaluation-stage contracts are defined in
[`phase8-animation-sequencing.md`](phase8-animation-sequencing.md).

Work:

- chain `A -> B -> C -> D` Key Arts
- persistent Clip / ClipInstance model where justified
- deterministic Transition/Clip mixer
- Key Art strip / sequence UI
- reusable motion clips such as Blink / Breath / HairSway / HeadTilt
- tracks for node/group transforms, bones, deformers, mesh/form states
- loop behavior
- ease presets compiled to existing Bezier data
- graph editor only after track semantics stabilize
- draw-order events where required

Acceptance criteria:

- build at least three reusable short animation clips
- combine ordinary rig motion with Key-Art transition motion
- chain at least three Key Arts in one shot
- scrub/play deterministically
- export the resulting shot through the existing deterministic output path

---

## Phase 9 — Production robustness / Beta

Goal: turn the feature-complete core into a dependable internal MV production tool.

Work:

- end-to-end Windows QA and regression closure
- real large PSD / multi-Key-Art profiling
- missing-source and decode diagnostics
- migration/recovery stress testing
- export stress/cancellation cleanup testing
- render/performance profiling
- production presets where justified
- dependency lockfile/provenance maintenance
- public repository readiness where desired

Acceptance criteria:

- create an approximately 8-second multi-Key-Art Akino shot
- save, close, reopen, edit, preview, and export successfully
- repeated export from identical project state is deterministic
- failures are actionable rather than silent

### Production Beta checkpoint

At the end of Phase 9, FLAMORIS 2D is a focused internal production tool rather than an experimental editor.

---

## Phase 10 — AI-Assisted Part Decomposition and Authoring

Goal: use AI to reduce setup work without hiding or replacing the deterministic editor model.

### 10A — AI PNG Part Decomposition

Build on the Phase 5 Light workflow rather than replacing it.

Candidate capabilities:

- semantic segmentation
- improved alpha matting
- character-part proposals such as hair / face / eye / mouth / clothing regions
- semantic label suggestions
- occlusion-aware hidden-part completion/inpainting as optional proposed artwork
- stacking-order suggestions
- confidence / ambiguity metadata
- side-by-side review before Apply

Principles:

- AI proposes; deterministic commands commit
- accepted output becomes normal Scene/render assets/masks
- model-private latent state is not required for future editing
- low-confidence or ambiguous proposals must remain reviewable
- AI failure must not prevent use of the Light path

Acceptance criteria:

- one flat character image can receive useful semantic part proposals
- proposed masks/cutouts can be edited or rejected before Apply
- optional hidden-part completion is clearly distinguished from observed source pixels
- accepted results behave as ordinary FLAMORIS project data

### 10B — AI correspondence / rig assistance / MCP workflow

MCP/AI work:

- production MCP server/adapter over existing typed commands/queries
- transactional bulk edits and dry-run previews
- semantic part mapping suggestions across Key Arts
- Transition mode suggestions
- correspondence anchor/vertex suggestions
- optical-flow-assisted initialization where useful
- auto clipping/group/pivot suggestions
- optional rigging assistance
- confidence and structured change summaries

Principle:

> AI proposes; deterministic commands commit.

---

## Phase 11 — Bridges and advanced production features

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

Audio analysis/lip-sync may later integrate with FLAMORIS production workflows, but should reuse the established deterministic command/timeline boundaries rather than drive the core architecture prematurely.

---

## Near-term execution order

1. Complete Windows manual QA for the current Phase 1-4 Product.
2. Fix blocker/major production defects found by QA as focused Issues.
3. Design and implement Phase 5A PNG Part Decomposition Light.
4. Use real PNG/PSD clip production to decide which clipping/deformer/bone capabilities are actually needed first.
5. Design Phase 8 Multi-Key-Art sequencing with production evidence from real authored clips.
6. Add AI PNG decomposition only after the deterministic Light review/apply contract is stable.

This order deliberately favors easier source input and actual MV production over implementing every traditional rigging feature in advance.

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

Suggested checkpoints should be revised when the next public/internal release strategy is chosen; phase numbers should describe actual implemented order rather than preserve obsolete numbering for appearance alone.
