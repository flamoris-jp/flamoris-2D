# FFmpeg source access and redistribution status

This package uses unmodified FFmpeg N-127021-ge0c94b2d1c from the BtbN Windows
x64 LGPL shared archive. FFmpeg and its DLLs are separate, replaceable files.
FLAMORIS invokes `ffmpeg.exe` as a separate process and does not link its own
executable to the FFmpeg libraries. Export settings can select another compatible
executable. No restriction on modifying or reverse engineering FFmpeg is added.

The FFmpeg configuration selects **LGPL version 3**, with `--enable-version3`. The original
`LICENSE.txt` is LGPLv3; `COPYING.GPLv3.txt` supplies the GPLv3 terms it incorporates.
`FFMPEG-LICENSE.md` is FFmpeg's unmodified license explanation at the exact revision.
`BUILD-CONFIG.txt` records the configuration embedded in the pinned binary.
This software is based in part on the work of the Independent JPEG Group.
FLAMORIS has not modified FFmpeg's IJG-derived files or the distributed binaries.
However, transitive FFTW implementation evidence in the pinned DLL prevents this
audit from certifying the whole archive as LGPL-only. `FFTW-NOTICE.md` records
that GPLv2-or-later component, its source revision and the unresolved conclusion.

## Exact upstream references

- Binary release: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08
- Archive: `ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip`
- SHA256: `2cc3dd0baf74ebd68a3fceaf771df8351a7a6d69694d05f43b16bb0c966ec909`
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e0c94b2d1c96c2548645d00690f26dc5178d4855
- FFmpeg source archive: https://github.com/FFmpeg/FFmpeg/archive/e0c94b2d1c96c2548645d00690f26dc5178d4855.tar.gz
- Build scripts, pinned dependency revisions and patches:
  https://github.com/BtbN/FFmpeg-Builds/tree/6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b
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
with a complete dependency notice inventory and build/relink instructions, resolve
the transitive GPL component evidence, or adopt
a separately reviewed external-FFmpeg distribution. No durable FLAMORIS source
download URL or written offer is asserted by this file. The current audit and
recovery references are at:
https://github.com/flamoris-jp/flamoris-2D/blob/main/docs/reviews/issue-149-ffmpeg-redistribution.md

Copyright-license compliance does not settle H.264 or other codec patent rights.
The current export contract remains Windows Media Foundation `h264_mf`.

Current archive availability, exact pin and refreshed binary/recipe observations:
https://github.com/flamoris-jp/flamoris-2D/blob/main/docs/reviews/issue-157-ffmpeg-build-input.md
