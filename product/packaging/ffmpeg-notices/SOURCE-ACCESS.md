# FFmpeg source access and redistribution status

This package uses unmodified FFmpeg N-126947-g45f3fecca9 from the BtbN Windows
x64 LGPL shared archive. FFmpeg and its DLLs are separate, replaceable files.
FLAMORIS invokes `ffmpeg.exe` as a separate process and does not link its own
executable to the FFmpeg libraries. Export settings can select another compatible
executable. No restriction on modifying or reverse engineering FFmpeg is added.

The exact build selects **LGPL version 3**, with `--enable-version3`. The original
`LICENSE.txt` is LGPLv3; `COPYING.GPLv3.txt` supplies the GPLv3 terms it incorporates.
`FFMPEG-LICENSE.md` is FFmpeg's unmodified license explanation at the exact revision.
`BUILD-CONFIG.txt` records the configuration embedded in the pinned binary.
This software is based in part on the work of the Independent JPEG Group.
FLAMORIS has not modified FFmpeg's IJG-derived files or the distributed binaries.

## Exact upstream references

- Binary release: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-28-13-06
- Archive: `ffmpeg-N-126947-g45f3fecca9-win64-lgpl-shared.zip`
- SHA256: `7f82d0e4ed9c20e9ca96573f5ab82b85f1b44a5d62f195e5cf09ffc28da70a4e`
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a
- FFmpeg source archive: https://github.com/FFmpeg/FFmpeg/archive/45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a.tar.gz
- Build scripts, pinned dependency revisions and patches:
  https://github.com/BtbN/FFmpeg-Builds/tree/16523e260106182950d7072b6ea1401808f68a50
- LGPLv3: https://www.gnu.org/licenses/lgpl-3.0.html
- GPLv3: https://www.gnu.org/licenses/gpl-3.0.html

## Unresolved distribution requirement — Issue #149 remains open

These upstream references identify the source; they are **not a complete
corresponding-source distribution or written source offer by FLAMORIS**.
The BtbN release's automatically generated “Source code” archive contains build
scripts, not all FFmpeg/dependency sources. Several dependencies are statically
included inside the DLLs. Their notices, licenses, exact source (including upstream
patches and vendored dependencies), and applicable relinking materials must also
be accounted for. Keeping the DLLs replaceable alone does not resolve that work.

Before promoting this candidate to a supported public release, FLAMORIS must
publish and retain a verified corresponding-source bundle alongside the binaries,
with a complete dependency notice inventory and build/relink instructions, or adopt
a separately reviewed external-FFmpeg distribution. No durable FLAMORIS source
download URL or written offer is asserted by this file. The current audit and
recovery references are at:
https://github.com/flamoris-jp/flamoris-2D/blob/main/docs/reviews/issue-149-ffmpeg-redistribution.md

Copyright-license compliance does not settle H.264 or other codec patent rights.
The current export contract remains Windows Media Foundation `h264_mf`.
