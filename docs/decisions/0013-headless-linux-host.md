# ADR 0013: Headless Linux CLI and MCP host

Status: implementation candidate, requested by Akino on 2026-11-07.

## Requirement

Prepare a short animated shot on LIME without starting the Windows workstation:
load Cutwork/PSD artwork or an existing `.fl2d`, edit using the existing typed
MCP tools, inspect actual rendered PNGs, checkpoint and export transparent frames.

## Decision

Add a .NET 10 console host under `product/native/src/Flamoris2D.Cli`. It owns one
existing `NativeWorkspace` and its C++ NativeSession. Existing Commands, Queries,
transactions, revision guards, history, ticks, codecs and persistence remain the
authority. No project schema or evaluator changes are required.

Use the existing managed `EvaluatedRasterizer` for an explicit **offline CPU**
backend in this host. It consumes the ordinary native evaluated projection;
geometry, clipping order, camera and animation are not reimplemented. PNG preview
and export use this same backend and `PngFrameWriter`. ADR 0008's Windows D3D11
selection is unchanged; its software reference is now also an explicitly selected
headless backend. This does not claim interactive performance or bit-exact GPU
parity. Linux GPU rendering and MP4 encoding are deferred; alpha-preserving PNG
sequences are the initial output contract.

The CLI offers import, inspect, preview, render, mcp and mcp-catalog. MCP reuses
`NativeMcpHost` and MCP Core 1.4.0 transports, grants, typed tools and guards. It
adds a bounded image query, fixed-workspace checkpoint and single-slot render JOB
start/status/cancel. Stdio uses the official SDK directly on bounded process
streams and routes tool calls through Core's public boundary; no local socket
or private Core API is required. Hub is outbound WSS using Core's provider. Neither path introduces a network
listener or arbitrary remote path/command access. The Hub credential is supplied
through `FLAMORIS_HUB_CREDENTIAL`, consumed and removed from the environment.

## Files and lifetime

- Startup input is explicit and read-only. One-shot outputs reject existing files.
- `mcp --workspace DIR` authorizes only `DIR/project.fl2d` checkpoints and
  `DIR/renders/<generated-job-id>/` output. On restart, an existing project is
  reopened rather than reimporting and discarding authored animation.
- Only one service may hold a workspace. Read-only permission never initializes
  or saves a project and cannot start/cancel rendering. Checkpoint checks the
  previous file hash and refuses an external writer's changes; mark-saved occurs
  only after atomic, flushed storage succeeds.
- No automatic save on exit. Users explicitly checkpoint; uncheckpointed edits
  remain process-local just as in a normal editing session.
- Each export is tied to one document token/revision. Concurrent edits stop the
  job with a conflict instead of mixing revisions. Rendering is cancellable,
  limited to 1,800 frames and 512 MiB of PNG output per job; completed frames stay
  available after cancellation/failure. Receipts persist in the output directory.
  A prior process's nonterminal receipt is reported as interrupted, never success.
- Preview disclosure is revalidated after rendering. Preview is at most 960 px
  per edge and 1 MiB, with no desktop or screen capture.

Linux builds retain the exact ICU 78.3 contract and package the native core and
its required runtime libraries. They do not pull in WPF, Capture or D3D11.

## Acceptance

Protect the new Linux boundary with an actual-process official MCP client test:
import a shareable `.flimg`, render RGBA, edit/Undo/Redo through normal tools,
reject stale guards/read-only edits/unknown fields, checkpoint/restart/reopen,
reject external-file conflicts, start/status/cancel frame export, and verify PNG
alpha and source preservation. Exercise EOF/shutdown. Run existing source/session
regressions where relevant. Add one path-scoped Linux workflow at this milestone;
retain the existing Windows checks. Real-art visual quality, LIME performance and
live Hub deployment must be reported separately from automated Linux acceptance.
