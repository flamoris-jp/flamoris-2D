# Phase 4 Export Production Contract

Status: Phase 4-4 implementation and production validation

Issue: #45

## Purpose

Phase 4 turns one authored `Transition` into a deterministic image sequence or video file from the Windows Desktop application. It is an export path, not a general timeline, mixer, render queue, or DAW.

The export path reuses the existing deterministic animation architecture:

```text
Transition / TemporalProgram
  -> ExportFramePlanner
  -> canonical Transition evaluator
  -> shared composition renderer
  -> offscreen RGBA frame
  -> PNG encoder
  -> Desktop-owned destination
  -> optional FFmpeg h264_mf encode
```

No export-only interpolation or persistent export state is introduced.

## Time and frame contract

- Canonical timebase: 120000 ticks/sec.
- FPS is a normalized rational `numerator / denominator`.
- Frame ticks use the existing direct rational projection and round-half-up convention.
- Planned ticks satisfy `0 <= timeTicks < durationTicks`.
- Frame timing is never accumulated in floating point.
- Export progress, cancellation state, temporary files, encoder state, and destination paths are transient and never enter `.fl2d` or Undo/Redo.

## Export settings

The Phase 4-4 dialog exposes:

- Transition / current authored shot.
- Resolution:
  - project canvas size;
  - 1920 x 1080 when the project aspect ratio is exactly 16:9;
  - custom width and height.
- FPS:
  - 24;
  - 30;
  - 60;
  - project rational FPS when it is not one of those presets;
  - custom rational FPS.
- Format:
  - PNG sequence;
  - MP4 / H.264.
- MP4 quality (independent of FPS): Standard (10 Mbps), High (20 Mbps,
  default), or Custom (whole Mbps, 1–200). These are bitrate presets, not
  encoder-specific quality/CRF values.
- Native Desktop destination selection.
- Export / Cancel.
- Frame progress, encoding status, and reason-specific diagnostics.

The Export action is disabled when the current Transition cannot resolve its required endpoint render assets.

## PNG sequence contract

PNG sequence export remains the lossless reference path.

- Names are one-based and deterministic: `frame_000001.png`, `frame_000002.png`, ...
- Desktop owns the destination directory and filesystem writes.
- Existing output directories are rejected rather than overwritten.
- A frame failure aborts the remaining sequence.
- Cancellation preserves the already-written prefix for a user-requested PNG sequence.

## MP4 / H.264 contract

The initial Windows video profile is:

- container: MP4;
- encoder: FFmpeg `h264_mf` using Windows Media Foundation;
- encoder input pixel format: NV12;
- rate control: explicit `-rate_control cbr`;
- target video bitrate: explicit `-b:v <videoBitRate>` in bits/sec, default
  20,000,000 (High); Standard is 10,000,000;
- audio: disabled;
- overwrite: rejected;
- alpha policy: deterministic composite over opaque black before alpha is discarded.

Alpha flattening uses the explicit filter chain:

```text
format=gbrap,premultiply=inplace=1,format=nv12
```

The FFmpeg capability probe requires `h264_mf` and `premultiply` and rejects builds configured with `--enable-gpl`, `--enable-nonfree`, or `--enable-libx264` for the official distribution path.

The first production implementation does not claim that H.264 bytes are bit-for-bit identical across different Media Foundation implementations or hardware. The deterministic contract covers evaluated frames, frame order, rational FPS, encoder arguments, and output policy.

### Bitrate settings and validation

`native.export_settings` exposes `videoBitRatePresets` and `videoBitRateRange`
(1,000,000–200,000,000 bits/sec), with the default bitrate and rate control in
`videoProfile`. `native.export_plan` and `native.encoder` accept optional
`videoBitRate`; omission uses High for compatibility with existing callers.
Explicit null, strings, fractional bits/sec and out-of-range values are rejected.
Video planning validates this before rendering any PNG frames. PNG-only planning
ignores video bitrate. The managed export settings and encoder adapter pass the
same value through to Product; the shell does not assemble encoder arguments.

Quality settings are transient export choices: they do not change Project,
`.fl2d`, revision or Undo/Redo. FPS still determines frame timing and is not a
compression-quality control. No MCP tool/schema is added or changed.

The target bitrate is an encoder request, not a promised measured bitrate or
file size. In Windows artwork QA on 2026-10-24, 720 PNGs at 1122×1402 / 60 FPS
produced severe blocking with the previous implicit bitrate (about 0.23 Mbps).
Explicit `h264_mf -rate_control cbr -b:v 20M` preserved hair and clothing detail;
that output measured about 4.96 Mbps / 7.44 MB / 12 seconds. This confirms one
machine/artwork result, not cross-device encoder equivalence. Private artwork is
not a repository test dependency.

## One-step MP4 temporary-frame boundary

Phase 4-4 does not require the user to export a visible PNG sequence before creating MP4.

For one-step MP4 export:

1. the renderer asks Desktop to begin an opaque video session;
2. Desktop creates a temporary directory and never exposes its path to the renderer;
3. the renderer sends deterministic PNG names and bytes through IPC;
4. Desktop enforces exact one-based frame order and exclusive writes;
5. the renderer asks Desktop to encode the session without supplying a filesystem path;
6. Desktop invokes FFmpeg against its own temporary directory;
7. temporary frames are removed after success, encoder failure, or cancellation where practical.

The older Phase 4-3 path that encodes an already-completed Desktop-created PNG sequence remains supported. Arbitrary renderer-selected filesystem paths are rejected.

## Cancellation and partial output

PNG sequence:

- cancellation stops subsequent frame rendering/writes;
- already-written frames are retained.

MP4:

- cancellation during frame production closes the opaque video session and removes temporary frames;
- cancellation during encoding aborts the FFmpeg process;
- incomplete MP4 output is removed;
- temporary render frames are removed after the encoder exits;
- pre-existing destination files are never deleted.

A temporary cleanup error is reported as a diagnostic instead of silently disappearing.

## Licensing and distribution notes

FLAMORIS does not use `libx264` in the official Phase 4 encoder path.

Development may use a system-installed FFmpeg executable. A future bundled Windows FFmpeg binary must be a vetted LGPL-compatible build that passes the runtime capability policy above and must include the required license/provenance material. Bundling a binary is a separate packaging decision; the current implementation does not silently vendor one.

H.264 patent/licensing obligations are separate from the FFmpeg LGPL/GPL build configuration and must be reviewed for the intended distribution context before a bundled public release.

## Automated regression checkpoint

Automated tests cover the Phase 4 contracts including:

- deterministic frame count/tick planning and rational FPS;
- viewport-independent offscreen rendering;
- canonical evaluator reuse;
- mesh/Morph/Replace/opacity/draw-order rendering;
- no Project/history mutation;
- PNG naming/order/write failure/cancellation/conflict;
- Desktop-owned filesystem/process boundaries;
- FFmpeg capability, deterministic argv, diagnostics, cancellation and partial MP4 cleanup;
- deterministic black alpha flattening to NV12;
- Desktop-owned temporary MP4 frames and exact write order;
- ExportJobController validation/progress/cancel/reuse;
- resolution/FPS presets and missing-render-asset preflight.
- explicit bitrate defaults/presets/custom bounds, managed/native argument
  propagation, preflight rejection, PNG isolation and unchanged document history.

Native C++/managed regression tests and the Windows Portable Package workflow
must be green at the PR head before merge. The retired JavaScript test runner
is not current validation authority.

## Manual Windows QA

Before declaring the first production export path validated on a Windows release candidate:

1. Open a saved project with a working A/B Transition and all PSD render assets restored.
2. Preview the Transition and note equivalent start, middle, and final-frame-near-boundary states.
3. Open Export and verify the active Transition is selected.
4. Export PNG sequence at project resolution and verify frame count and one-based file ordering.
5. Compare representative PNG frames with preview at the same canonical ticks.
6. Export at a second resolution and confirm composition scales independently of viewport size.
7. Change viewport zoom and pan, then repeat export and confirm output is unchanged.
8. Confirm mesh deformation, AutoMesh/correspondence results, Morph/Replace, opacity, and draw order appear correctly.
9. Start a longer PNG export, cancel it, and confirm the written prefix is retained and editing still works.
10. Use an LGPL-compatible FFmpeg build that passes the runtime probe and provides `h264_mf` plus `premultiply`.
11. Export MP4 directly from the Export dialog without first choosing a PNG-sequence directory.
12. Play the MP4 in a normal Windows player and confirm duration, FPS, dimensions, and black alpha background behavior.
13. Cancel during MP4 frame production and during FFmpeg encoding; confirm no incomplete MP4 is reported as success and temporary files are cleaned.
14. Attempt export to an existing destination and confirm it is not silently overwritten.
15. Confirm editor selection, viewport, Undo/Redo history, dirty state, and authoring remain usable after success, failure, and cancellation.
16. Select Standard, High and Custom; confirm the bitrate field follows the
    preset, is editable only for Custom, and is disabled for PNG-only export.
    Reject custom zero, non-integer and >200 Mbps before any frames are rendered.
17. With detailed artwork, compare High MP4 against PNG at the same frame/time
    and inspect hair lines, dark fabric and moving areas. Record actual bitrate;
    do not require it to equal the requested bitrate.

Record any machine-specific Media Foundation or FFmpeg behavior in the Phase 4 PR/Issue before final release validation.
