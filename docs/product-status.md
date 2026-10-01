# FLAMORIS 2D — capabilities and status

[Back to the product overview](../README.md) · [Native workflow (日本語)](native-production-workflow.md)

This is the detailed companion to the README. For implementation evidence and
capability disposition, use the [native completion ledger](native-capability-map.md);
for phase dependencies and release gates, use the [roadmap](roadmap.md).

## Current status

The production core is implemented through Phase 8, except the deferred Phase 5 input-simplification track described below.

The native WPF candidate now uses one C++ NativeSession shared with MCP under
#118/#142. Source through Export, Recovery, PSD/Cutwork ingest and save/reopen
remain the production workflow. JS/Electron/Product Host are retained only as
compatibility references, outside native build/publish inputs. Windows CI and
human artwork/interaction acceptance remain gates; installer/signing/default
association are a separate release decision.

Current checkpoint:

- Phase 1 Editor Core + Windows Desktop shell — complete
- Phase 2 deterministic Key-Art Transition foundation and authoring — complete
- Phase 3 production mesh topology / Contour AutoMesh / correspondence assistance — complete
- Phase 4 deterministic PNG / Windows MP4 export — implementation complete
- Phase 6 clipping + Warp/Lattice Deformer — complete
- Phase 7 Bones / FK / rigid and weighted skinning / form correction / constraints / IK — complete
- Phase 8 Multi-Key-Art Sequence / AnimationClip / deterministic mixer / timeline authoring — complete
- Phase 9 Production Robustness / Internal Beta — active hardening stage
- Native renovation (#118/#142) — one C++ authority and native-only package candidate; final Windows verification and release acceptance remain

The immediate gate is the unified native candidate's full regression/packaged
Windows verification, followed by real-art Windows hands-on. Track discovered
defects as focused fixes. Code conformance does not certify perceptual acceptance.

Phase 5 flat-image part decomposition remains an experimental/deferred input-simplification track and does not block the current PSD/Cutwork production workflow.

## Current capabilities

### Project and editor core

- versioned `.fl2d` Project model
- stable Scene / mesh / rig identities
- deterministic Query / Command / Transaction / EditorSession architecture
- Undo / Redo and grouped history
- Save / Save As / Incremental Save / Save Copy
- dirty/save-point tracking, lineage-scoped native Recovery, Recent Files, and native Windows dialogs
- PSD import/re-import and Cutwork `.flimg` v1/v2 source-art import with document-coordinate placement
- native WPF production candidate; previous shells retained as compatibility references
- portable native candidate does not change an existing installed `.fl2d` association
- typed MCP-ready command/query boundaries with one shared EditorSession authority

### Mesh and Key Art authoring

- separate Mesh Structure / Layout and Deform authoring semantics
- stable mesh vertex IDs and optional semantic labels
- add / remove / connect / subdivide topology operations
- Grid Mesh and deterministic Contour AutoMesh
- per-Key-Art MeshKeyforms over shared topology
- textured native Layout preview and commit
- whole-mesh position / rotation / scale alignment and explicit UV editing
- deterministic correspondence assistance and pins
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
- weight painting/numeric editing and normalization
- MeshFormCorrection after skeletal deformation
- rotation constraints
- analytic two-bone IK as an authoring helper
- mirror helpers
- reusable MeshDeformation samples for animation

### Sequence and reusable motion

- persistent multi-Key-Art Sequence / ViewLane
- KeyArtHold and retimed TransitionInstance placement
- reusable AnimationClip / ClipInstance
- Once / Loop playback semantics
- TransformTrack / BoneTrack / DeformerTrack / MeshDeformationTrack / CameraTrack plus existing opacity/presence/draw-order/clipping channels
- reusable Blink / Breath / HairSway-style motion
- deterministic typed contribution mixer
- native Sequence timeline, scrub, playback, clip placement/trim, zoom/scroll, and keyframe editing
- explicit Bezier interpolation with authoring ease presets

### Preview and export

- one canonical evaluated-frame/render-plan path for native Preview and Export
- D3D11 hardware renderer with WARP fallback, selected by measured ADR 0008 evidence
- deterministic frame planning from rational FPS
- deterministic PNG frame sequence export
- Windows MP4/H.264 export using pinned LGPL FFmpeg and Media Foundation `h264_mf`
- progress, cancellation, conflict handling, diagnostics, and explicit partial-output policy
- packaged automated eight-second workflow verifies 240 PNGs and an H.264 MP4, then Save/Open/resumed editing

The remaining real-device validation work is perceptual/operational acceptance: real artwork, DPI/focus/input feel, dense timeline usability, output inspection, and release cutover policy. It is not a missing Source-to-Export architecture stage.

## Current follow-up work

- #118/#142 — native cutover review, Windows packaged verification and physical acceptance.
- Real production QA — artwork/DPI/interaction/playback and output inspection.
- Release policy — installer/signing/update/file association, separately reviewed.
- Existing roadmap hardening and deferred features continue after the native path is dependable.

The software license does not grant rights to FLAMORIS creative assets.

## README visual example — remaining acceptance for #108

No tracked editor screenshot, GIF, video, or explicitly cleared artwork suitable
for a product demonstration was found in the repository at the post-#112 baseline
(`0ac63220c5b86f0957bcff99d9e9732db6a20986`). Source-generated test fixtures are
technical proof, not a representative product demo. No private production artwork
or unrelated placeholder has been added to the README.

Issue [#108](https://github.com/flamoris-jp/flamoris-2D/issues/108) stays open until
an owner-approved screenshot, GIF, or short demo is supplied and added near the
README opening. It should show the current native editor with an actual artwork
and mesh or timeline, identify the demonstrated build, and have a caption/alt text.
Confirm publication and redistribution permission for the visible artwork and
record its separate rights statement beside the example. Check that the capture
contains no local paths, account details, or MCP connection keys. The software's
Apache-2.0 license does not grant rights to the depicted creative assets.
