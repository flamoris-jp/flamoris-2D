# FLAMORIS 2D Native production candidate

The .NET 10/WPF editor now connects the production Source → Mesh → Rig → Deform →
Animation → Preview → Export workflow to the existing authoritative JavaScript Product.
Start with the [Japanese production guide](../../docs/native-production-workflow.md).
The [completion ledger](../../docs/native-capability-map.md) records every production
capability and public Command/Query disposition. PR #101 is the review surface.

## Run the portable candidate

Download the `flamoris2d-native-production-candidate-win-x64` artifact from the latest
successful Native Shell Boundary run on PR #101. Extract the entire directory and run
`Flamoris2D.exe` on Windows x64. The package includes a self-contained .NET 10 runtime,
Node 24.21.0, the exact Product Host/worker dependency graph, pinned PSD decoder and
pinned LGPL shared FFmpeg distribution. Keep these files beside the executable.
No developer runtime installation or command prompt is required. The candidate does
not register `.fl2d` or replace the installed Electron version.

## Build and tests

Development prerequisites: Windows 10/11 x64, .NET 10 SDK and Node 24. Install the
Product dependency with `npm install --prefix product --workspaces=false --omit=dev
--ignore-scripts --package-lock=false` from the repository root (one command).

```powershell
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

## Live MCP (Issue #102)

The `MCP / AI` menu enables a document-scoped loopback Streamable HTTP endpoint,
disabled by default. See [workflow](../../docs/native-production-workflow.md) and
[ADR 0010](../../docs/decisions/0010-native-live-mcp.md). Official SDK 2.0.0 implements
2026-07-28 plus stateless 2025 compatibility. No separate Host or stdio bridge.

Before a local native build, install locked packages with
`npm ci --prefix product --workspaces=false --ignore-scripts`.
`McpRuntime.files.props` includes only named, reviewed production dependencies;
SDK client/fixtures/tests are excluded from the candidate. The package's bundled
Node runs the endpoint even with developer Node/.NET absent from PATH.
The production smoke uses an independent HTTP client for modern discovery,
visible rename/Mesh edits, automatic WPF refresh and shared history; it then
continues the established Source→Export→Save/reopen path.
