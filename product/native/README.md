# FLAMORIS 2D Native production candidate

The .NET 10/WPF editor now connects the production Source → Mesh → Rig → Deform →
Animation → Preview → Export workflow to the existing authoritative JavaScript Product.
Start with the [Japanese production guide](../../docs/native-production-workflow.md).
The [completion ledger](../../docs/native-capability-map.md) records every production
capability and public Command/Query disposition against the implementation on current
`main`. PR #101 is merged; final real-art Windows acceptance and release cutover
remain open.

## Run the portable candidate

The [Native Shell Boundary workflow](https://github.com/flamoris-jp/flamoris-2D/actions/workflows/native-shell-ci.yml)
uploads `flamoris2d-native-production-candidate-win-x64` only after successful manual
(`workflow_dispatch`) runs; artifacts expire after three days. PR checks build/test
the package without uploading it. Download an available manual-run artifact, or
build it locally with `./product/packaging/publish-windows.ps1` if none is available. Extract the entire directory and run
`Flamoris2D.exe` on Windows x64. The package includes a self-contained .NET 10 runtime,
Node 24.21.0, the exact Product Host/worker dependency graph, pinned PSD decoder and
pinned LGPL shared FFmpeg distribution. Keep these files beside the executable.
No developer runtime installation or command prompt is required. The candidate does
not register `.fl2d` or replace the installed Electron version.

## Build and tests

Development prerequisites: Windows 10/11 x64, .NET 10 SDK, Node 24,
CMake 3.21+ and Visual Studio or Build Tools with the Desktop development
with C++ workload and Windows SDK. The C++ library is built for x64 in both
Debug and Release by the existing `dotnet build` solution command. Its native
unit executable is run with CTest during that build.
`NuGet.config` uses public nuget.org packages without GitHub authentication. From the repository
root, install the locked Product dependencies (including development dependencies),
using the same command as the Native Shell Boundary workflow, then build and test:

```powershell
npm ci --prefix product --workspaces=false --ignore-scripts
node product/native/tests/check-temporal-conformance.mjs
node product/native/tests/check-project-conformance.mjs
node product/native/tests/check-session-conformance.mjs
dotnet build product/native/Flamoris2D.Native.sln -c Release
dotnet run --project product/native/tests/Flamoris2D.ProductHost.Client.Tests -c Release --no-build -- product/product-host/main.mjs
dotnet run --project product/native/src/Flamoris2D.App -c Release --no-build -- --smoke-test
dotnet run --project product/native/src/Flamoris2D.App -c Release
```

Phase 1 of [#118](https://github.com/flamoris-jp/flamoris-2D/issues/118)
adds `Flamoris2D.Core.Native.dll` and a managed adapter. The JS Product Host
remains the only authoritative editing session. No WPF gesture or MCP command
calls the C++ engine yet. The interop adapter and DLL are built and exercised by
the solution and focused tests; the portable WPF package does not carry them in
this phase. The checked conformance fixtures are generated from current JS by
`node product/native/tests/check-temporal-conformance.mjs --write` and checked
against JS in CI. Native and managed tests compare exact integer results.

The native ABI is declared in `core/include/flamoris2d_core.h` (version 1.3).
It uses C calling convention, fixed-size integers, an opaque engine handle and
32-bit status codes. The DLL build exports its functions; native consumers import
them through the same header. `fl2d_engine_create` transfers ownership of a handle to
the caller; destroy it once with `fl2d_engine_destroy` (C# uses `SafeHandle`).
Null output pointers and invalid arguments return `FL2D_INVALID_ARGUMENT`.
The Phase 1 frame-rate primitive exchanges no strings or allocated buffers. Do not reuse a pointer after
destroying it. The first primitive reduces a positive rational frame rate using
the same safe-integer limits and GCD behavior as Product JS; it is a stable
timebase input with existing deterministic Product tests, and introduces no
Project state or separate history. Extending this contract requires version
negotiation before changing existing entry points.

Phase 1B (#121) adds an immutable schema-15 Project snapshot via a UTF-8 JSON
interchange boundary. `fl2d_snapshot_load` copies at most 1 MiB of caller-owned
bytes; the caller destroys its returned handle once. Malformed JSON, invalid
UTF-8 and oversized data have distinct status codes. Native snapshot strings
are copied into caller-owned buffers: query `required` (including the NUL byte),
then provide that capacity. C# uses `SafeHandle`. The C++ representation retains
project identity, canvas, scene node IDs/hierarchy, transform, visibility, opacity and focused validation issues;
it records presence of unsupported mesh/rig/animation and other domain sections
without treating those payloads as native authority. JSON is only an interchange
format, not the native internal model. The read-only validation subset follows
`product/src/model/validation.js` and is tested against JS-generated fixtures.
The base schema-15 checks now include animation shape, global IDs in both
animation collections, display names, and scene reachability/cycles. Native
validation also covers the basic AnimationClip checks, mesh deformation sample
references/offsets, bone rotation and two-bone IK constraints, and rigid bone
binding references/conflicts, mesh form corrections, and Bone rest/pose checks. The remaining imported
domain validators and loop endpoint warnings are still pending under #125;
the fixture generator projects the currently covered issue codes only. Native
node queries use stable `node.id`
even when a mismatched `scene.nodes` key produces a validation issue.
it is currently authoritative for conformance testing only. JS `EditorSession`
remains the sole editing authority, including WPF/MCP mutations, Undo/Redo and
save. The DLL still is not in the portable WPF package. The next migration step
will establish native session, Command, revision and Undo/Redo semantics before
any authority switch.

Phase 1C (#123) adds a test-only native EditorSession owning its own Project
state. It accepts the existing Product command envelope for `scene.rename_node`,
`scene.set_visibility`, and complete `scene.set_transform` (node-local). A
transaction validates its commands and candidate Project before a one-shot,
revision-qualified commit; its inverse list is replayed in reverse order for
Undo. Redo replays the original commands. `revisionCounter` is monotonic,
`currentRevision` follows the selected history entry, and `savedRevision` is
independent; the limit is the JS safe integer maximum. Replacement resets
history and invalidates pending prepares. A prepared handle uses a weak session
reference so destroying the session makes it unusable; callers must destroy
both handles. Callers serialize access to one session. C# uses `SafeHandle`.

The ABI exposes fixed-width session state, stable-ID node queries, caller-owned
UTF-8 project/history/error buffers, and deterministic statuses. Project and
history JSON are inspection projections; the session's native parsed state is
owned exclusively by its handle. The snapshot validator is still a focused
subset of full Product validation; the session additionally checks the node
fields it needs. Both creation/replacement and transaction candidates invoke
the snapshot validation path. Native before/after transaction validation has a
dedicated seam: the migrated scene commands cannot modify temporal ownership,
so the JS cross-state ownership rule is not triggered yet. Port that rule when
the first applicable command moves. Unsupported domains and commands remain JS-only. The
conformance fixture is generated from the current JS `EditorSession` and covers
transactions, atomic failure, Undo/Redo, stale and one-shot prepared edits,
save/dirty lineage, and replacement. Check it with
`node product/native/tests/check-session-conformance.mjs`, or regenerate
intentionally with `--write`.

**The WPF/MCP Product Host remains the only production editing authority.** The
native DLL is excluded from the portable package. The next step is to extend
native Project validation and command coverage, prove save/load parity, then
explicitly switch WPF/MCP to the one native session before retiring JS/Node.

The bounded JSON parser is the vendored BSD-2-Clause `picojson` header
(upstream commit `111c9be5188f7350c2eac9ddaedd8cca3d7bf394`) under
`core/third_party/picojson/`, with its license alongside it. Its built-in depth
limit and the explicit size/UTF-8 gate protect the host boundary. Regenerate
the checked project fixtures deliberately with
`node product/native/tests/check-project-conformance.mjs --write`.

`ProductHost.files.props` is the explicit native source allowlist: main Host and both
workers, closed over their relative import graph. Build dependencies include no tests,
private artwork, Electron, index.html or DOM view modules. Existing pure JavaScript
controllers/evaluators remain authoritative. The package graph is protected by
`product/tests/production-manifest.test.js`. The local packaging script and CI assemble the same runtimes/notices,
records packaged SHA256 values and launches the published executable with developer
Node/.NET absent from PATH. `THIRD-PARTY-NOTICES.md` records upstream provenance.

With `FLAMORIS_RENDER_FIXTURE_DIR` set, native Host tests produce synthetic PSD/flimg and
canonical renderer fixtures. The WPF smoke then authors an eight-second shot, exports
240 PNGs plus real H.264 (`FLAMORIS_TEST_FFMPEG`), saves/reopens/resumes, exercises reimport
and Key State/Transition editing, and checks source-frame parity. Fixtures are never
copied into the runtime package. Without that variable the ordinary boundary/input
smoke still runs, and does not claim the extended production fixture passed.

## Authority and acceptance

WPF gestures send typed commands/transactions to one EditorSession. Immutable
revision-tagged projections and local drafts are not a C# Project or second history.
Canonical render plans drive D3D11 hardware/WARP; coalesced command-draft previews do
not mutate history. Save uses immutable Host bytes and a revision-qualified receipt
acknowledged only after durable atomic write. Recovery cleanup is lineage/snapshot
scoped. See ADRs 0007–0009 for the implementation decisions and measured limits.

Final physical Windows checks cover real user artwork, 100/125/150/200% DPI, focus,
pointer feel, overlay contrast, discoverability and file-dialog/save behavior. The
portable smoke does not prove a signed installer, association, update/uninstall, live
external MCP attachment, or Electron retirement. Those accepted release gates remain
open; Electron stays until the migration design's stop conditions pass.

## Live MCP (Issue #107)

The `MCP / AI` menu enables a document-scoped Core 1.1.0 named-pipe endpoint.
Manual connection is disabled by default. Connection copy starts the matching
`mcp/Flamoris.Mcp.Bridge.exe`; capability travels only in
`FLAMORIS_MCP_CAPABILITY`. See [workflow](../../docs/native-production-workflow.md),
[wire contract](../../docs/mcp-design.md) and [ADR 0011](../../docs/decisions/0011-mcp-core-migration.md).
The bridge owns no Product Host, Project or history. Node remains editing authority.

Use the shared prerequisites and locked dependency installation in
[Build and tests](#build-and-tests). Both the client and bridge consume
`Flamoris.Mcp.Core 1.1.0`; no DLL is vendored.

For a portable candidate, run this from the repository root with .NET 10 SDK and Node 24.21.0 installed:

```powershell
./product/packaging/publish-windows.ps1
```

The script installs locked Product dependencies when needed, downloads the pinned LGPL FFmpeg archive and verifies its SHA256, then publishes the bridge and app with Node and notices to `artifacts/package/Flamoris2D-win-x64/`. CI uses this same script. The native runtime decodes
the canonical Chipsy sheet to a PNG display cache with the packaged FFmpeg. The
original WebP remains byte-identical in `mcp-assets/`; WPF selects row 7/column 0.
The cache and sheet are runtime artifacts, not committed derivatives. Development
builds without the cache retain activity text and cursor.

Set `FLAMORIS_TEST_BRIDGE` to the published executable before running the C# client
suite. The existing Windows gate exercises official-client transport and the
packaged WPF smoke verifies visible Mesh changes, automatic refresh and shared
Undo/Redo before continuing Source→Export→Save/reopen. Node MCP HTTP dependencies
are absent from the Native package. The private binary artwork channel is unchanged.
