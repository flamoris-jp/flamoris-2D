# FLAMORIS 2D Native production candidate

The .NET 10/WPF shell and live MCP share one C++ `NativeSession` through the
serialized `NativeWorkspace` lane. C++ owns Project, commands/queries, validation,
history, revision, `.fl2d` migration/serialization, source reconciliation,
authoring, evaluation and rendering. C# owns UI, OS files, immutable decoded
artwork and the shared MCP transport adapter. See [capability map](../../docs/native-capability-map.md),
[renovation map](../../docs/repository-renovation.md) and [ADR 0012](../../docs/decisions/0012-native-session-cutover.md).

## Run the portable candidate

Extract the entire package and run `Flamoris2D.exe` on Windows x64. Keep its C++
core/compositor, ICU libraries, self-contained .NET runtime, `mcp/` and `ffmpeg/`
directories together. Node, Electron and Product Host are absent. The portable
candidate does not install itself or change `.fl2d` associations.

The [Native Shell Boundary workflow](https://github.com/flamoris-jp/flamoris-2D/actions/workflows/native-shell-ci.yml)
uploads the accepted ZIP and inventory as `FLAMORIS-2D-win-x64` after successful
PR/manual runs, with three-day retention.
Use the [Japanese production guide](../../docs/native-production-workflow.md).

## Build and tests

Windows 10/11 x64 prerequisites: .NET 10 SDK, CMake 3.21+, Visual Studio or Build
Tools with Desktop development with C++ and a Windows SDK. Public nuget.org
provides shared FLAMORIS packages; no GitHub credentials or Node install is needed.

```powershell
dotnet build product/native/Flamoris2D.Native.sln -c Release
ctest --test-dir product/native/src/Flamoris2D.Core.Interop/obj/native-x64 -C Release --output-on-failure
dotnet run --project product/native/tests/Flamoris2D.Source.Codecs.Tests -c Release --no-build -- product/native/tests/source-codec-conformance.json product/native/tests/psd-codec-conformance.json
dotnet run --project product/native/tests/Flamoris2D.Session.Tests -c Release --no-build -- product/native/tests/source-codec-conformance.json product/native/tests/psd-codec-conformance.json
dotnet run --project product/native/src/Flamoris2D.App/Flamoris2D.App.csproj -c Release --no-build
```

Build the portable app/bridge and pinned LGPL shared FFmpeg from the repository root:

```powershell
./product/packaging/publish-windows.ps1
```

Output: `artifacts/windows/FLAMORIS-2D-win-x64/`. The script verifies required
libraries, rejects development/legacy runtime content and writes `SHA256SUMS.txt` (excluding itself). The matching ZIP and inventory are beside the package; see [Windows packaging](../../docs/windows-packaging.md).
For full Windows client/bridge tests set `FLAMORIS_TEST_BRIDGE` to the published
`mcp/Flamoris.Mcp.Bridge.exe` and run:

```powershell
dotnet run --project product/native/tests/Flamoris2D.Native.Client.Tests -c Release --no-build -- product/native/tests
```

The Windows workflow generates synthetic source/render fixtures, runs the
packaged WPF Source→Export→Save/reopen smoke with developer runtimes absent from
PATH, and checks real H.264 output. These checks do not replace human artwork,
DPI, pointer, GPU/playback and manual external MCP acceptance.

## Native boundary

C ABI 1.5 is declared in `core/include/flamoris2d_core.h`. Opaque sessions and
prepared edits have explicit ownership; managed adapters use SafeHandle.
Caller-owned UTF-8 buffers carry immutable projections. Prepared candidates can
be queried for gesture previews and disposed without changing live history.
All mutations enter native Commands/Transactions and the same revision guards.

`.fl2d` format-v1 and schema 15 retain current compatibility. Native parsing
migrates schemas 1–14 and retains embedded PNG records/identity metadata. Save
acknowledges a captured revision only after successful atomic filesystem write;
copy/recovery never marks the document clean. PSD/PSB and `.flimg` v1/v2 decode
into immutable candidates; C++ converts/reconciles them before guarded replacement.

ICU 78.3 supplies locale queries. Windows CMake fetches the pinned official
Win64 MSVC2022 archive and copies its DLLs/license. Other platforms require that
exact version (`-DICU_ROOT=/path/to/icu`). The C++ D3D11 compositor owns devices,
textures/masks and readback; WPF only maps viewport/DPI/output resolution.
Third-party provenance is in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Validation authority

Native C++/managed tests and packaged Windows smoke are the authoritative regression checks. JSON fixtures under `tests/` are retained where they are consumed directly by native or managed tests. The retired JavaScript/Product Host/Electron implementation is no longer part of the repository.

## Live MCP

Core/Wpf 1.2.0 supplies the stdio/named-pipe bridge, same-user security, grants,
guards and connection UI. The bridge has no Project or session. WPF and MCP use
the exact same workspace/native history. Connection is manual by default; copied
credentials are transient and never stored in project/settings/logs.
See [MCP design](../../docs/mcp-design.md) and [connection guide](../../docs/shared-mcp-connection.md).
