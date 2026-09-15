# FLAMORIS 2D

FLAMORIS 2D is a deterministic 2D animation editor for producing short moving-picture and MV shots from layered or flat artwork.

The current production workflow is:

```text
PSD / PNG / Cutwork `.flimg` artwork
  -> Scene / Mesh / Semantic Mapping
  -> Clipping / Warp / Bones / Skinning where needed
  -> Key Art A -> B -> C ...
  -> reusable AnimationClips such as Blink / Breath / HairSway
  -> deterministic Sequence preview
  -> deterministic PNG / MP4 export
  -> MV shot
```

FLAMORIS 2D is intentionally focused. It is not intended to reproduce every Live2D feature or become a general DAW/NLE.

## Current status

The Phase 1-8 production core is implemented.

The native WPF production candidate in [PR #101](https://github.com/flamoris-jp/flamoris-2D/pull/101) now supports Source through Export and save/reopen. See the [Japanese native workflow](docs/native-production-workflow.md) and [completion ledger](docs/native-capability-map.md). Electron remains the default release until final Windows acceptance and reviewed cutover.

Current checkpoint:

- Phase 1 Editor Core + Windows Desktop shell — complete
- Phase 2 deterministic Key-Art Transition foundation and authoring — complete
- Phase 3 production mesh topology / Contour AutoMesh / correspondence assistance — complete
- Phase 4 deterministic PNG / Windows MP4 export — implementation complete
- Phase 6 clipping + Warp/Lattice Deformer — complete
- Phase 7 Bones / FK / rigid and weighted skinning / form correction / constraints / IK — complete
- Phase 8 Multi-Key-Art Sequence / AnimationClip / deterministic mixer / timeline authoring — complete
- Phase 9 Production Robustness / Internal Beta — current hardening stage

The immediate production gate is real packaged-Windows end-to-end QA in Issue #78. Phase 9 hardening is tracked in Issue #79.

Phase 5 flat-image part decomposition remains an experimental/deferred input-simplification track and does not block the current PSD/part-based production workflow.

## Current capabilities

### Project and editor core

- versioned `.fl2d` Project model
- stable Scene / mesh / rig identities
- deterministic Query / Command / Transaction / EditorSession architecture
- Undo / Redo and grouped history
- Save / Save As / Incremental Save / Save Copy
- dirty/save-point tracking, recovery, Recent Files, and native Windows dialogs
- PSD import/re-import and Cutwork `.flimg` v1 source-art import with document-coordinate placement
- Windows Desktop shell and `.fl2d` file association
- typed MCP-ready command/query boundaries

### Mesh and Key Art authoring

- Object / Edit / Deform / Topology authoring modes
- stable mesh vertex IDs and optional semantic labels
- add / remove / connect / subdivide topology operations
- Grid Mesh and deterministic Contour AutoMesh
- per-Key-Art MeshKeyforms over shared topology
- deterministic correspondence assistance
- explicit SemanticSlot correspondence across Key Arts

### Transition, deformation, and rigging

- canonical 120000 ticks/sec integer timebase
- rational FPS conversion and deterministic sampling
- Morph / Hold / Replace / Appear / Disappear / Occlusion
- clipping with final evaluated geometry/alpha
- Warp/Lattice Deformer with nested parent-first evaluation
- Bones and deterministic FK
- rigid Bone attachment
- weighted skinning using stable mesh vertex IDs
- MeshFormCorrection after skeletal deformation
- rotation constraints
- analytic two-bone IK as an authoring helper
- mirror helpers

### Sequence and reusable motion

- persistent multi-Key-Art Sequence / ViewLane
- KeyArtHold and retimed TransitionInstance placement
- reusable AnimationClip / ClipInstance
- Once / Loop playback semantics
- TransformTrack / BoneTrack / DeformerTrack / MeshDeformationTrack / CameraTrack
- reusable Blink / Breath / HairSway-style motion
- deterministic typed contribution mixer
- Sequence timeline, scrub, playback, clip placement, and keyframe editing
- explicit Bezier interpolation with authoring ease presets

### Preview and export

- shared evaluated-frame path for preview and export
- deterministic frame planning from rational FPS
- viewport-independent offscreen rendering
- deterministic PNG frame sequence export
- Windows MP4/H.264 export boundary using FFmpeg with Media Foundation `h264_mf`
- progress, cancellation, conflict handling, diagnostics, and temporary-frame cleanup paths

The remaining real-device validation work belongs to Production QA / Phase 9 rather than missing animation architecture.

## Run Windows Desktop

From the repository root:

```powershell
npm install
npm test
npm run desktop
```

Create an unpacked Windows app:

```powershell
npm run desktop:pack
```

Create an NSIS installer:

```powershell
npm run desktop:dist
```

## Run browser shell

From the repository root:

```powershell
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173`.

The Windows Desktop application is the production target. The browser shell remains a development-compatible adapter.

## Repository boundaries

```text
product/   current editor/runtime implementation
staging/   manual/visual acceptance setup and non-production fixtures
test/      integration/system/staging checks outside Product runtime
history/   superseded prototypes and historical material
docs/      current design, research, ADRs, and production proof
```

Product code must not depend on Staging, integration-test helpers, History, or private acceptance artwork. Production artifacts use an explicit allowlist or equivalent build boundary.

See `AGENTS.md` and `docs/repository-boundaries.md`.

## Architecture principles

- GitHub `main` is the reviewed source of truth.
- Persistent animation time uses one canonical integer tick domain: 120000 ticks/sec.
- `TemporalProgram` is shared by Transitions, Sequences, and AnimationClips rather than duplicated into parallel timing models.
- Stable IDs, not display names or array positions, are authoritative for Scene, mesh, rig, and animation targets.
- Major visual changes are represented by Key Arts; reusable ordinary motion is layered through AnimationClips.
- Preview, PNG, and MP4 source frames share the same evaluated semantics.
- The renderer consumes final evaluated geometry/compositing state and remains unaware of Sequence/Clip/Bone authoring semantics.
- Persistent mutations go through deterministic Commands / Transactions and remain Undo/Redo-safe.
- Transient UI state such as selection, playhead, hover, drag preview, and playback state does not become Project authority.
- AI may propose edits in future phases, but accepted output must become ordinary deterministic Project data.

## Documentation

Current design index: `docs/README.md`

Current roadmap: `docs/roadmap.md`

Phase 8 sequencing design: `docs/phase8-animation-sequencing.md`

Phase 8 production proof: `docs/phase8-production-proof.md`

Documentation may mix Japanese and English. Use translation tools or AI translation where useful. Technical clarity and development continuity take priority over language uniformity.

## Development workflow

Use focused Issues and reviewable branches. Keep implementation commits small enough that interrupted work can resume safely.

Typical flow:

```text
Issue
  -> design / acceptance contract when needed
  -> feature branch
  -> small purpose-driven commits
  -> focused + full regression tests
  -> Pull Request review
  -> merge to main
```

Non-trivial defects found during Production QA should become focused Issues rather than being hidden inside broad Phase umbrellas.

## Current follow-up work

- #78 — packaged Windows end-to-end Production QA
- #79 — Phase 9 Production Robustness / Internal Beta
- #58 — production UX cleanup and Japanese-first labels
- #6 — dependency lockfile / reproducibility
- #43 — public repository release preparation

The public-release and licensing work in #43 is intentionally separate from current product hardening. Do not infer licensing of FLAMORIS creative assets from the software repository until that release work is completed.

## Historical reference

The original v0.3 prototype snapshot remains preserved on `prototype/psd-import-zoom-pan-v0.3` for history/reference. It is not the branch for continuing Product development.
