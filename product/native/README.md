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
use the development build instructions below if none is available. Extract the entire directory and run
`Flamoris2D.exe` on Windows x64. The package includes a self-contained .NET 10 runtime,
Node 24.21.0, the exact Product Host/worker dependency graph, pinned PSD decoder and
pinned LGPL shared FFmpeg distribution. Keep these files beside the executable.
No developer runtime installation or command prompt is required. The candidate does
not register `.fl2d` or replace the installed Electron version.

## Build and tests

Development prerequisites: Windows 10/11 x64, .NET 10 SDK, Node 24 and authenticated
access to the FLAMORIS NuGet feed configured in `NuGet.config`. From the repository
root, install the locked Product dependencies (including development dependencies),
using the same command as the Native Shell Boundary workflow, then build and test:

```powershell
npm ci --prefix product --workspaces=false --ignore-scripts
dotnet build product/native/Flamoris2D.Native.sln -c Release
dotnet run --project product/native/tests/Flamoris2D.ProductHost.Client.Tests -c Release --no-build -- product/product-host/main.mjs
dotnet run --project product/native/src/Flamoris2D.App -c Release --no-build -- --smoke-test
dotnet run --project product/native/src/Flamoris2D.App -c Release
```

`ProductHost.files.props` is the explicit native source allowlist: main Host and both
workers, closed over their relative import graph. Build dependencies include no tests,
private artwork, Electron, index.html or DOM view modules. Existing pure JavaScript
controllers/evaluators remain authoritative. The package graph is protected by
`product/tests/production-manifest.test.js`. CI assembles the exact runtimes/notices,
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

For a portable candidate, publish both projects:

```powershell
dotnet publish product/native/src/Flamoris2D.Bridge -c Release -r win-x64 --self-contained true -o out/native-win-x64/mcp
dotnet publish product/native/src/Flamoris2D.App -c Release -r win-x64 --self-contained true -o out/native-win-x64
```

The existing Native workflow then adds pinned Node/FFmpeg and notices, and decodes
the canonical Chipsy sheet to a PNG display cache with the packaged FFmpeg. The
original WebP remains byte-identical in `mcp-assets/`; WPF selects row 7/column 0.
The cache and sheet are runtime artifacts, not committed derivatives. Development
builds without the cache retain activity text and cursor.

Set `FLAMORIS_TEST_BRIDGE` to the published executable before running the C# client
suite. The existing Windows gate exercises official-client transport and the
packaged WPF smoke verifies visible Mesh changes, automatic refresh and shared
Undo/Redo before continuing Source→Export→Save/reopen. Node MCP HTTP dependencies
are absent from the Native package. The private binary artwork channel is unchanged.
