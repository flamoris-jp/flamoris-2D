# Native candidate runtime provenance

The portable candidate contains a self-contained .NET 10 Windows desktop runtime,
Vortice.Direct3D11 3.8.3 and its NuGet dependencies, the repository Product Host,
and the dependencies below. This preview does not install services, register a
file association, or replace the Electron release.

- Node.js 24.21.0: https://github.com/nodejs/node/releases/tag/v24.21.0 .
  The executable is copied from the exact-version `actions/setup-node` installation.
  The complete upstream license and third-party notices are in `runtime/LICENSE.txt`.
- ag-psd 31.0.2, base64-js and pako: package metadata and upstream licenses are in
  their respective `node_modules` directories. The decoder runs in a bounded worker.
- FFmpeg N-126556-g639ee84952, Windows x64 LGPL shared distribution:
  https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-14-13-17 .
  Archive: `ffmpeg-N-126556-g639ee84952-win64-lgpl-shared.zip`.
  SHA256: `526562b18482314ea17110b7e5a0cfbb701815dcba66156817b7eef4662a57f8`.
  The distribution, documentation, notices and replaceable shared libraries are
  retained together in `ffmpeg/`. Its build/source information is supplied by
  https://github.com/BtbN/FFmpeg-Builds and https://github.com/FFmpeg/FFmpeg/tree/639ee84952 .
  The application invokes a separate process with an argument list; it does not
  link FFmpeg into the application. Export accepts the existing Product LGPL-only
  `h264_mf` encoder contract. The executable can be selected in Export settings.
- .NET: https://github.com/dotnet/runtime and https://github.com/dotnet/wpf .
  Runtime notices accompany the self-contained publish output.
- Vortice.Windows: https://github.com/amerkoleci/Vortice.Windows (MIT).
  Dependency versions are recorded by the published `.deps.json` files.

`SHA256SUMS.txt` records each packaged file after assembly. The CI smoke launches
this exact directory with Node/.NET removed from PATH and exports a real H.264
video using the packaged encoder. Installer, signing, update and default file
association policy remain part of the separately reviewed release cutover.
