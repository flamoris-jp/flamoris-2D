# Native candidate runtime provenance

The portable candidate contains a self-contained .NET 10 Windows desktop runtime,
the C++ editing/evaluation core and Direct3D11 compositor. JavaScript, Electron,
Node, Product Host and npm decoder dependencies are not part of the current product
or repository runtime/tooling graph.

- FFmpeg N-127021-ge0c94b2d1c, Windows x64 upstream-labelled LGPL shared archive
  (FFmpeg configured for **LGPLv3; whole-archive redistribution not certified**):
  https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08 .
  Archive: `ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip`.
  SHA256: `2cc3dd0baf74ebd68a3fceaf771df8351a7a6d69694d05f43b16bb0c966ec909`.
  `ffmpeg/` retains the encoder, ffprobe, all seven replaceable shared libraries,
  original LGPLv3 license, incorporated GPLv3 license, FFTW's GPLv2 license/notice, exact upstream license
  explanation and recorded build configuration. `ffplay`, HTML manuals, SDK files
  and unrelated encoder presets are omitted; no DLL or codec is removed.
  Read `ffmpeg/SOURCE-ACCESS.md` for exact source/build references and the
  **unresolved transitive GPL component, corresponding-source and dependency-notice
  requirements in Issue #149**. The exact DLL contains FFTW implementation strings;
  pinned upstream recipes statically link it through Chromaprint. Thus the archive
  label and configure flags do not suffice to establish LGPL-only redistribution.
  Upstream source links alone are not a complete source offer or redistribution
  attestation. This candidate must not be promoted to a supported public release
  before that requirement is resolved. This software is based in part on the
  work of the Independent JPEG Group; FLAMORIS does not modify FFmpeg or its
  IJG-derived files. The source/build revisions are:
  https://github.com/BtbN/FFmpeg-Builds/tree/6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b and
  https://github.com/FFmpeg/FFmpeg/tree/e0c94b2d1c96c2548645d00690f26dc5178d4855 .
  The application invokes a separate process with an argument list; it does not
  link FFmpeg into the application. Export accepts the existing Product LGPL-only
  `h264_mf` encoder contract. The executable can be selected in Export settings.
- .NET: https://github.com/dotnet/runtime and https://github.com/dotnet/wpf .
  `DOTNET-LICENSE.txt` and `DOTNET-ThirdPartyNotices.txt` are copied from the publishing SDK; runtime notices accompany the self-contained publish output.
- The native renderer links Windows Direct3D11 and the system shader compiler.

`SHA256SUMS.txt` records each packaged file except itself after assembly. The external inventory also covers the checksum file, and ZIP contents are verified against it. The CI smoke launches
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

## Linux headless package

The Linux CLI uses the same ICU 78.3 C API with the official
`icu4c-78.3-Ubuntu22.04-x64.tgz` archive, SHA256
`9c8abe58a20cf82ea22341d8125272094f7fca2414173cbc2d8742feb84566a2`.
It packages `libicuuc.so.78`, `libicui18n.so.78`, `libicudata.so.78` and the original
`share/icu/78.3/LICENSE` as `ICU-LICENSE.txt`. The native core is built from this
repository; its picojson license is included. The self-contained .NET 10 runtime
retains `DOTNET-LICENSE.txt` and `DOTNET-ThirdPartyNotices.txt`.
MCP Core 1.4.0, Logging 1.0.0 and official MCP SDK 2.2.0 versions remain recorded
in `.deps.json`. This package contains no WPF, Capture, D3D11 or FFmpeg runtime.
