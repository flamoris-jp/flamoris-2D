# Native Mesh hands-on checkpoint

Baseline: main `63372daa44ddf6c862cac7c47a34ca388437a104`, merged #99.
Scope: user-authorized #96 Mesh-first proof, not production Open/Save/Recovery.

## Boundary decisions for this checkpoint

The explicit Mesh-first request permits a replaceable WPF-native reference-art renderer
before final renderer selection. ADR 0006 is not marked superseded or accepted anew.
ADR 0007 / #97 remain proposed/deferred. No recovery storage is touched.

Users explicitly select PNG artwork (including transparent Part PNGs) for a disposable
hands-on session. These are user inputs, not a Product dependency on staging/private
fixtures. Multiple PNGs share document origin; this is not PSD/.flimg layer/bounds import.
The shell warns that edits cannot be saved and confirms replacement/close. No production
file association, recent-file, persistence or Recovery completion is claimed.

The Host owns immutable straight BGRA8 raster bytes outside Project. The existing Project
owns normal nodes, Key Art membership, topology/keyforms and history. A per-process
loopback binary endpoint accepts only bounded, reserved raster handles; it exposes no
paths or filesystem operations. A random bearer secret is disclosed only in the private
stdio handshake. Browser Origin requests are rejected. Reservation, upload, read and
release use opaque IDs and document/revision tags; replacement/crash drops old ownership.
Aborted/expired uploads release their budget. PNG decode is a native WPF environment
adapter, after encoded-size/dimension checks, not a claim of browser-free PSD decoding.

Control JSON never carries raster/base64. Raster budget is deliberately a proof limit,
not a production asset policy: at most 4096 per dimension, 4,194,304 pixels per raster,
16 rasters and 64 MiB total Host raster storage (including reservations). Native decoding
and rendering retain only the same bounded set, with one in-flight decode/upload.

## Provisional rendering seam

`MeshViewport` draws immutable source bitmaps plus independently visible geometry from
revision-tagged Product projections. It owns DIP camera transforms, hit testing and
transient gestures only. A future canonical render-plan compositor replaces its raster
presentation, not Mesh commands, target identity, history or coordinate semantics.

This path does **not** guarantee textured-triangle, clipping, rig, opacity-composition,
Transition, Preview/Export or final GPU/colour parity. It is reference-art Mesh authoring,
not a substitute evaluator. No renderer ADR is accepted from a smoke test.

Audit: `MeshToolController.commitDeformPositions` is an old compatibility name that calls
`mesh_keyform.move_vertices`. That command replaces keyform positions, leaves UVs intact,
and writes no animation/form offsets. A textured renderer therefore may visibly stretch
artwork after this layout edit; that alone does not prove misrouting to Deform. The
provisional reference-art view intentionally leaves artwork stationary so placement is
legible. It does not silently rewrite UVs or claim to preview that textured consequence.

## Operation authority

The Host reuses MeshPreparationController and MeshToolController over its one
EditorSession. Native Structure maps to topology mode; Layout maps to the legacy
keyform-placement mode. Deform never exposes these mutation tools. Grid/Contour helpers
produce ordinary candidates, preview first, explicit Apply through existing transactions.
No legacy mesh writer is used; Grid's generated arrays are immediately projected into
ordinary candidate positions/UVs/indices.

A drag records document token, revision, target, stable vertex IDs and starting positions.
Moves change only its local overlay; release commits once, no-op/cancel/lost capture
commits nothing. New revisions, targets or contexts cancel a pending gesture/preview.
Undo/Redo uses the same EditorSession as WPF and headless commands.

## Remaining gates

#98 remains open for full `.fl2d` metadata/assets retention, PSD/.flimg decode/import,
bulk production-scale proof and measured final renderer choice. #97 is intentionally
not a dependency of this disposable Mesh proof. Electron and Issue #96 remain open.
Windows visual acceptance belongs to the user's hands-on pass, not Linux or CI.
