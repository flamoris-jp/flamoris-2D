# FLAMORIS 2D Development Roadmap

Status: active

This roadmap is dependency-driven rather than date-driven. A phase is complete when its acceptance criteria pass.

FLAMORIS 2D is optimized for producing short deterministic moving-picture shots from layered or flat artwork. It is not intended to reproduce every Live2D feature before real production use begins.

The defining production workflow is now:

```text
PSD / Cutwork `.flimg` / existing `.fl2d`
  -> Scene / Mesh / Semantic Mapping
  -> Clipping / Warp / Bones / Skinning where needed
  -> Key Art A -> B -> C ...
  -> reusable AnimationClips such as Blink / Breath / HairSway
  -> deterministic Sequence preview
  -> deterministic PNG / H.264 MP4 export
  -> Save / close / reopen / continue editing
  -> MV shot
```

MCP/AI readiness remains an architectural constraint from the beginning, not a late integration task.

## Current checkpoint

The Phase 1-8 production core is implemented. The native WPF migration has advanced beyond shell proof: Issue #96 / PR #101 is now a Source-through-Export production candidate built on the existing JavaScript Product/Core authority.

Implemented production architecture includes:

- Phase 0 repository/design baseline
- Phase 1 Editor Core + deterministic Project / Command / Query / EditorSession authority
- Phase 2 deterministic Key-Art Transition foundation and authoring
- Phase 3 production mesh topology, Contour AutoMesh, layout, and correspondence assistance
- Phase 4 deterministic PNG / Windows MP4 export
- Phase 6 clipping + Warp/Lattice Deformer
- Phase 7 Bones, FK, rigid/weighted skinning, form correction, constraints, IK, and mirror helpers
- Phase 8 Multi-Key-Art Sequence / Clip animation architecture, deterministic mixer, timeline authoring, and automated production proof
- Native WPF Product Host integration from Source through Export, including Recovery, PSD/`.flimg` import, textured mesh editing, Rig/Deform, Animation, Preview, Export, Save/Open, and a self-contained Windows candidate

Phase 5 input-simplification work remains experimental/deferred and does not block the current PSD/Cutwork production pipeline.

### Current production gate

The immediate gate is **final real-art Windows acceptance of PR #101 / Issue #96**, not another architecture phase.

Automated Windows evidence now goes beyond the older Phase 8 proof. The packaged native candidate has exercised a synthetic but real-format workflow through:

```text
PSD import
-> Grid/Layout with visible textured deformation + exact Undo/Redo
-> Bone/Skin
-> nested Warp
-> form correction + reusable MeshDeformation sample
-> 8-second Sequence / Clip animation
-> scrub / Preview parity
-> 240 PNG frames
-> real H.264 MP4 + ffprobe verification
-> atomic Save
-> New / Open
-> resumed edit + Undo
-> reviewed PSD re-import + Undo/Redo
-> duplicate Key Art / Transition
-> Cutwork .flimg import
```

At the current PR #101 candidate, Product CI, Native Shell Boundary, and Windows Desktop Package are green. The remaining acceptance is deliberately human/physical where automation is weak:

- use real FLAMORIS artwork/project data rather than synthetic fixtures
- inspect actual deformation/compositing and exported motion
- verify focus, shortcuts, dialogs, pointer capture/cancel and discoverability
- verify 100/125/150/200% DPI behavior on the real Windows machine
- inspect light/dark artwork overlay contrast and dense timeline navigation
- Save, close, reopen and continue editing in normal use
- review release cutover / installer / association / Electron-retirement conditions

Issue #78 remains the broader post-Phase-8 packaged-Windows QA checklist. Issue #79 remains the Production Robustness / Internal Beta umbrella. Issues #97 and #98 have implementation and accepted decision records in PR #101, but stay open until review/final acceptance is complete.

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
- Undo/Redo and saved-history identity
- validation and migration
- deterministic Save/Open and recovery contracts
- PSD import/re-import
- Scene Tree / target projection / selection / transforms
- typed MCP-ready command/query schemas
- Windows desktop adapters

Native WPF does not replace this authority. It routes edits through the same Product Host / EditorSession.

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
- diagnostics and preview-authority reporting
- persistence and Undo/Redo equivalence

---

## Phase 3 — Production mesh editing and correspondence — COMPLETE

Goal: make target-keyform authoring practical enough for real production.

Delivered includes:

- strict Mesh Structure / Mesh Layout / Deform separation
- Project-global stable vertex identity
- visible vertex IDs and optional Semantic Labels
- add/remove/connect/subdivide topology commands
- deterministic topology mutation contract
- deterministic Contour AutoMesh with Grid fallback
- correspondence pins using stable vertex IDs
- deterministic target-keyform initialization
- ordinary editable MeshKeyform output after correspondence Apply
- native textured Layout preview/commit and whole-mesh alignment in PR #101
- explicit UV editing and reference-protected cleanup in the native candidate

Optional helpers such as proportional editing, smooth/relax, lasso and advanced solvers remain intentionally deferred unless real production proves they are needed.

---

## Phase 4 — Deterministic production export — COMPLETE IMPLEMENTATION

Goal: turn authored animation into actual output using the same deterministic semantics as preview.

Delivered includes:

- rational FPS -> deterministic frame/tick planning
- half-open export tick-domain boundary
- canonical evaluator reuse
- shared preview/export render-plan semantics
- deterministic PNG frame sequence export
- Windows H.264 `h264_mf` encoder contract
- progress/cancel/diagnostics and explicit partial-output policy

The native WPF candidate now uses the same canonical evaluated plan and D3D11 compositor for Preview and Export. Packaged CI has produced and ffprobe-verified a real 8-second / 240-frame H.264 MP4 through the pinned LGPL FFmpeg package. Human visual inspection on real artwork remains part of the current production gate, not missing export architecture.

---

## Phase 5 — Input Simplification / Part Decomposition — EXPERIMENTAL / DEFERRED

Goal: reduce setup effort when no layered PSD exists.

The historical classical-cutout experiment was split into the separate Cutwork product. FLAMORIS 2D now imports Cutwork `.flimg` v1 as ordinary source art, while mask/repair authoring stays outside this editor.

This phase is not a blocker for the main production loop. Future AI-assisted input should still follow the same principle:

> helpers propose or prepare ordinary editable data; the deterministic Project model remains authoritative.

---

## Phase 6 — Clipping and Group Deformer — COMPLETE

Goal: support facial occlusion and grouped organic deformation without turning FLAMORIS into a full Live2D clone.

Delivered includes:

- persistent clipping bindings with stable identity
- clipping validation and cycle protection
- clipping-aware shared preview/export semantics
- final-geometry clipping resolution
- Warp/Lattice Deformer domain model
- 2x2 / 3x3 / 4x4 deterministic lattices
- stable Warp control-point IDs
- Key-Art-specific Warp keyforms
- nested parent-first Warp semantics
- child-lattice projection through parent Warp
- persistence, Undo/Redo, Commands/Queries, and MCP-ready schemas
- native Warp creation/nesting/control-point authoring and clipping controls in PR #101

---

## Phase 7 — Bones and Skinning — COMPLETE

Goal: make limbs and large pose changes practical when mesh/deformer editing alone is inefficient.

Delivered includes:

- persistent Bone and BonePoseKeyform
- Scene-owned Bone hierarchy
- deterministic parent-first FK
- post-Warp projected Bone frames
- Bone Edit / Pose authoring
- rigid Bone attachment
- persistent SkinBinding
- stable-vertex-ID weights
- one-to-four normalized influences
- weight authoring and visualization
- deterministic linear blend skinning
- MeshFormCorrectionKeyform
- rotation constraints
- authoring-only analytic two-bone IK
- mirror helpers
- exact Undo/Redo and persistence
- native Bone/Warp/Weight subcontexts, helper previews, and form correction in PR #101

Canonical evaluation keeps Warp before projected Bone frames, constraints before FK, skin/rigid deformation before form correction, and clipping after final deformation.

---

## Phase 8 — Multi-Key-Art Animation and Clip Sequencing — COMPLETE

Goal: move from isolated A -> B Transitions to reusable short MV shots.

The normative contracts are defined in [`phase8-animation-sequencing.md`](phase8-animation-sequencing.md), with the original production proof recorded in [`phase8-production-proof.md`](phase8-production-proof.md).

Delivered includes:

- persistent `Sequence` / ViewLane
- reusable `AnimationClip` / `ClipInstance`
- Once / Loop semantics and rational playback rate
- Transform / Bone / Deformer / MeshDeformation / Camera and existing discrete typed channels
- deterministic contribution ordering and canonical evaluator stages
- Transition/KeyArt semantic base + Clip overlays
- Sequence/Clip timeline authoring
- keyframe CRUD, explicit interpolation and ease presets
- deterministic scrub/playback time projection
- Save/Open and Preview/Export semantic parity

The native production candidate migrates these capabilities into WPF without creating a second C# timeline/timebase.

Deferred beyond Phase 8 remain existing roadmap items such as a full graph editor, nested AnimationClips, reusable Camera clips, runtime IK, physics/procedural secondary motion, and NLE/audio workflow.

---

## Native WPF migration — SOURCE THROUGH EXPORT CANDIDATE

Design authority:

- [`csharp-wpf-ui-migration.md`](csharp-wpf-ui-migration.md)
- ADR 0006 Product Host boundary
- ADR 0007 native Recovery lifecycle
- ADR 0008 measured D3D11 renderer selection
- ADR 0009 mesh-animation identity bridge
- [`native-capability-map.md`](native-capability-map.md)
- [`native-production-workflow.md`](native-production-workflow.md)

Current PR #101 implements:

- native New/Open/Save/Save As/Incremental/Copy and scoped Recovery
- full `.fl2d` envelope/artwork retention
- PSD and Cutwork `.flimg` import plus reviewed PSD update
- authenticated bounded document/raster bulk transfer
- D3D11 hardware renderer with WARP fallback consuming canonical Product render plans
- textured Mesh Layout, topology, Grid/Contour, correspondence, UV and Key State authoring
- Bone / Warp / Weight / Skin / clipping / IK / mirror / form correction
- Sequence / clips / typed tracks / keys / scrub / playback / camera
- Preview / PNG / H.264 MP4 export through the same evaluated semantics
- self-contained Windows x64 candidate with pinned Node and LGPL FFmpeg

The migration is **not yet a release cutover**. Electron remains the default installed/released shell until the final Windows acceptance and retirement stop conditions pass.

---

## Phase 9 — Production Robustness / Internal Beta — ACTIVE

Goal: turn the feature-complete core and native production candidate into a dependable internal MV production tool through real usage, focused fixes, profiling, and operational cleanup.

Primary work now:

- final PR #101 review and real-art Windows acceptance
- focused bug fixes found by that hands-on pass
- production-scale PSD / multi-Key-Art profiling
- missing-source/decode diagnostics and recovery stress
- export stress/cancellation/partial-output checks
- performance profiling before optimization
- dependency lockfile/provenance work (#6)
- focused production UX cleanup (#58)
- release/installer/association/cutover policy before Electron retirement
- public repository readiness only when desired (#43)

Acceptance criteria:

- create an approximately 8-second real FLAMORIS/Akino shot using real artwork
- use Mesh / Rig / Deform / multiple Key Arts / reusable animation as needed by the shot
- save, close, reopen, edit, preview, and export successfully
- produce and visually inspect PNG and real Windows H.264 MP4 output
- repeated export from identical project state remains semantically deterministic
- production blockers found through real usage are fixed or explicitly documented
- major observed performance bottlenecks are measured and acceptably resolved
- current dependency/runtime graph is reproducible and provenance is reviewed
- failures are actionable rather than silent
- release cutover does not remove capability or create a second authority

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

1. Keep PR #101 reviewable and green; fix documentation/implementation review findings as focused commits.
2. Run the final native Windows hands-on with real PSD/`.flimg`/`.fl2d` material and an approximately 8-second shot.
3. Turn any real defect found by hands-on into a focused Issue/fix rather than extending the migration umbrella blindly.
4. When acceptance evidence is complete, decide merge/cutover status for #96 and whether #97/#98 can close.
5. Continue Phase 9 profiling, recovery/export stress and UX hardening under #79.
6. Retire or replace the Electron default only after every stop condition in the migration design passes, including installer/association/release policy.
7. Revisit input simplification and AI assistance only after the main production loop is dependable.

This order deliberately favors producing real MV shots and hardening the current production candidate over adding broad new feature families.

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

## Issue #102 — Native live MCP transport

Implemented for PR review: current SDK/protocol Streamable HTTP, explicit local
capabilities, read/edit permissions, same Host mutation queue and source-art history,
revision conflicts, request cancellation/revocation and Native management UI.
Protocol/security/shared-session tests and packaged external WPF edit proof protect
this milestone. Final physical Windows acceptance remains the documented hands-on
check; remote transport, providers, stdio bridge and semantic AI authoring are deferred.
