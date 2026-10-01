# Native candidate runtime provenance

The portable candidate contains a self-contained .NET 10 Windows desktop runtime,
the C++ editing/evaluation core and Direct3D11 compositor. JavaScript, Electron,
Node, Product Host and npm decoder dependencies are excluded from the application
and bridge publish inputs. The retained JS oracle is test-only.

- FFmpeg N-126947-g45f3fecca9, Windows x64 LGPL shared distribution:
  https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-28-13-06 .
  Archive: `ffmpeg-N-126947-g45f3fecca9-win64-lgpl-shared.zip`.
  SHA256: `7f82d0e4ed9c20e9ca96573f5ab82b85f1b44a5d62f195e5cf09ffc28da70a4e`.
  The distribution, documentation, notices and replaceable shared libraries are
  retained together in `ffmpeg/`. Its build/source information is supplied by
  https://github.com/BtbN/FFmpeg-Builds and https://github.com/FFmpeg/FFmpeg/tree/45f3fecca9 .
  The application invokes a separate process with an argument list; it does not
  link FFmpeg into the application. Export accepts the existing Product LGPL-only
  `h264_mf` encoder contract. The executable can be selected in Export settings.
- .NET: https://github.com/dotnet/runtime and https://github.com/dotnet/wpf .
  Runtime notices accompany the self-contained publish output.
- The native renderer links Windows Direct3D11 and the system shader compiler.

`SHA256SUMS.txt` records each packaged file after assembly. The CI smoke launches
this exact directory with Node/.NET removed from PATH and exports a real H.264
video using the packaged encoder. Installer, signing, update and default file
association policy remain part of the separately reviewed release cutover.

## Local MCP runtime (Issue #107)

Flamoris.Mcp.Core/Wpf 1.2.0 and Flamoris.Logging 1.0.0 (Apache-2.0), consumed from
nuget.org. Official ModelContextProtocol.Core 2.2.0 (MIT) and transitive
NuGet versions are recorded in published `.deps.json` files. The self-contained
bridge runtime is in `mcp/` and contains no Product Host/editor content.
See https://github.com/flamoris-jp/flamoris-mcp-core and
https://github.com/modelcontextprotocol/csharp-sdk for upstream code/notices.

Core/Wpf supplies the shared MCP settings/status UI and its assets. Asset usage
follows the upstream package notices and assets/README.md.

# picojson

The native compositor and native Project/persistence parser vendor `picojson`
by Kazuho Oku and Cybozu Labs under the BSD-2-Clause license. The full license
accompanies the portable compositor as `LICENSE-picojson.txt`; its repository
source is `core/third_party/picojson/LICENSE`.

## Native locale queries

Core.Interop and its tests link ICU 78.3 (Unicode/ICU license) for Product locale
collation and case conversion, matching Node 24.21.0's ICU version.
Official source/release: https://github.com/unicode-org/icu/releases/tag/release-78.3 .
The Windows build downloads `icu4c-78.3-Win64-MSVC2022.zip`, SHA256
`446b671f9437227daa79e221d4521d75793f9ecd65ac44c06e34dd848f201ac2`.
Its `icuuc78.dll`, `icuin78.dll`, `icudt78.dll` and original `LICENSE` (copied as
`ICU-LICENSE.txt`) accompany the production native core. Other platforms require an
exact-version installation; source archive `icu4c-78.3-sources.tgz` SHA256 is
`3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0`.
The App references Core.Interop through its single NativeWorkspace authority.
