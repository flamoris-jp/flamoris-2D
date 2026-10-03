# Issue #149 — pinned FFmpeg redistribution and runtime-size audit

Audit date: 2026-10-03. **Issue #149 remains open.** This change safely removes
unused files and corrects known notices; it does not certify the archive as
LGPL-only or supply a complete corresponding-source distribution. Transitive GPL
evidence, complete dependency notices and durable source delivery remain concrete
public-release blockers.

## Exact evidence and licensing conclusion

The downloaded [BtbN release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-28-13-06)
contains `ffmpeg-N-126947-g45f3fecca9-win64-lgpl-shared.zip` (77,705,024 bytes).
SHA256 is `7f82d0e4ed9c20e9ca96573f5ab82b85f1b44a5d62f195e5cf09ffc28da70a4e`,
matching `publish-windows.ps1`. The archive's original `LICENSE.txt` is LGPLv3,
not LGPLv2.1. Its embedded configuration has `--enable-version3`,
`--enable-shared --disable-static`, `--pkg-config-flags=--static`,
`--enable-chromaprint`, `--enable-gmp`, and `--enable-libaribb24`.
It has no `--enable-gpl`, `--enable-nonfree`, or `--enable-libx264`.
The complete line is preserved in `product/packaging/ffmpeg-notices/BUILD-CONFIG.txt`.

Exact sources/build recipes:

- [FFmpeg commit 45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a](https://github.com/FFmpeg/FFmpeg/tree/45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a).
- [FFmpeg's license explanation at that commit](https://github.com/FFmpeg/FFmpeg/blob/45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a/LICENSE.md)
  explains the version3 option, GMP/aribb24's LGPLv3 requirements, Apache-2.0
  dependency compatibility, and the required Independent JPEG Group attribution.
- [BtbN recipes 16523e260106182950d7072b6ea1401808f68a50](https://github.com/BtbN/FFmpeg-Builds/tree/16523e260106182950d7072b6ea1401808f68a50),
  the commit behind the pinned release.
- [BtbN `defaults-lgpl.sh`](https://github.com/BtbN/FFmpeg-Builds/blob/16523e260106182950d7072b6ea1401808f68a50/variants/defaults-lgpl.sh)
  explicitly selects version3 and `COPYING.LGPLv3`.

### Transitive FFTW evidence

The absence of GPL configure flags is insufficient evidence of the licenses of
the static dependencies inside the DLLs:

1. [BtbN `25-fftw3.sh`](https://github.com/BtbN/FFmpeg-Builds/blob/16523e260106182950d7072b6ea1401808f68a50/scripts.d/25-fftw3.sh)
   enables FFTW unconditionally, at revision
   `93ed4c786934aec9946f8dda4b4e3eb08f8be41c`, with `--disable-shared --enable-static`.
2. [BtbN `50-chromaprint.sh`](https://github.com/BtbN/FFmpeg-Builds/blob/16523e260106182950d7072b6ea1401808f68a50/scripts.d/50-chromaprint.sh)
   builds static Chromaprint at `aed8eba2202dd9d7b3b0a56c77904cc805490d72` with
   `-DFFT_LIB=fftw3` and adds `-lfftw3` to the private link flags.
3. The pinned `avformat-63.dll` contains `(fftw-3.3.11 fftw_wisdom`,
   `fftw_dft_indirect_register`, `fftw_dft_rader_register`, and numerous
   `fftw_codelet_*` implementation strings. These can be reproduced with GNU
   binutils `strings avformat-63.dll`.
4. [FFTW's exact source license](https://github.com/FFTW/fftw3/blob/93ed4c786934aec9946f8dda4b4e3eb08f8be41c/kernel/twiddle.c)
   and [official license explanation](https://www.fftw.org/doc/License-and-Copyright.html)
   identify its implementation as GPLv2-or-later. The separate permissive notice
   on `fftw3.h` applies only to that header, not the implementation.

This is concrete evidence of GPL-covered implementation in an upstream-labelled
LGPL archive. The audit cannot certify LGPL-only redistribution. Resolve it
through upstream clarification plus a verified build/license inventory, or a
reviewed FFmpeg build/distribution change. This patch preserves codec behavior;
it does not silently rebuild FFmpeg or remove Chromaprint. Adding GPL text does
not resolve the source-delivery or whole-build licensing questions.

### Obligations and present status

| Item | Evidence / action | Status |
|---|---|---|
| Preserve FFmpeg licensing terms | Original LGPLv3 retained; GPLv3 terms incorporated by LGPLv3 added verbatim from the exact FFmpeg commit | Corrected |
| Preserve known GPL component terms | Exact FFTW GPLv2 text and copyright/source notice added | Corrected for this known component |
| Copyright attribution | Unmodified FFmpeg `LICENSE.md` and IJG attribution accompany the binaries | Corrected |
| Exact source and compilation identification | Full FFmpeg/BtbN revisions and embedded configure line shipped | Recorded |
| Complete dependency licenses/notices | Archive carries only one LGPL file; static dependencies and Rust/vendor trees require a complete inventory | Unresolved |
| Corresponding source | GPLv3 §6 requires an applicable source-delivery route; the generic upstream project links and build-script archive do not by themselves supply all corresponding source | Unresolved |
| LGPL replacement/relinking | Shared FFmpeg DLLs and separate process preserved; static LGPL dependencies inside them still need applicable corresponding application/relink materials under LGPLv3 §4 | Unresolved for dependencies |
| H.264 patents | Separate from copyright licenses; Media Foundation `h264_mf` export contract unchanged | Outside this copyright audit |

The [FFmpeg compliance checklist](https://ffmpeg.org/legal.html) calls for exact
source, build instructions, retained notices and review of external libraries.
It describes library linking and is not itself an exemption for separate-process
binary redistribution. [LGPLv3](https://www.gnu.org/licenses/lgpl-3.0.html) incorporates
[GPLv3](https://www.gnu.org/licenses/gpl-3.0.html); consult those full shipped texts.
FLAMORIS has not modified the FFmpeg binaries, links no application library to
them, adds no reverse-engineering restriction, and permits selection of another
compatible executable. Those boundaries do not cancel binary-distribution duties.

## Corresponding-source recovery and next implementation

The pinned BtbN release has binary/checksum assets and the automatically generated
build-repository archive. There is no complete FFmpeg/dependency source release
asset or written source offer in that release. BtbN's documented retention keeps
only the last 14 daily builds (month-end builds for two years), so this September
28 daily URL is also unsuitable as a durable dependency/source-delivery policy.

The matching [upstream workflow run 36420971261](https://github.com/BtbN/FFmpeg-Builds/actions/runs/36420971261)
has `download-cache`, artifact ID `10970035369`, 2,191,425,858 bytes at audit time.
Its [workflow](https://github.com/BtbN/FFmpeg-Builds/blob/16523e260106182950d7072b6ea1401808f68a50/.github/workflows/build.yml)
and [download script](https://github.com/BtbN/FFmpeg-Builds/blob/16523e260106182950d7072b6ea1401808f68a50/download.sh)
show this is a dependency-download cache, including prepared/vendored sources.
This is a recovery lead, not a verified complete corresponding-source bundle;
artifact expiration and authenticated download also prevent treating its URL as
a durable, recipient-accessible FLAMORIS source offer.

Two source snapshots were successfully downloaded for this audit:

| Exact download | SHA256 |
|---|---|
| `https://api.github.com/repos/FFmpeg/FFmpeg/tarball/45f3fecca9f800a4432a6e3cfb3a76ef47f9d07a` | `b992ee00b78e423f4d764d58ef198e5862f8d92da351987b4a9a813bc42d17d7` |
| `https://api.github.com/repos/BtbN/FFmpeg-Builds/tarball/16523e260106182950d7072b6ea1401808f68a50` | `5897bcc4bd6b7ccf84f5d0ee66abc5d031e0809dedeaf9f6aba5802ff88e8183` |

These identify the exact source/build roots but exclude the full dependency
source payload. A practical next change should collect recipe-pinned source
snapshots, patches (including BtbN's aribb24 patches/version edit), generated build
inputs and vendored Rust crates into an audited **source sidecar**, not a 2 GB
opaque cache committed to Git. Record input hashes and dependency licenses,
resolve the FFTW conclusion, verify rebuilding/relinking instructions, and publish
the source sidecar with access equivalent to the corresponding binary download.
Keeping it outside the runtime ZIP preserves zero-install export and limits the
ordinary user's download size. Source URLs alone must not be labelled completion.
For publication by download, GPLv3 §6(d) describes source access at the same place
or another server with clear directions and equivalent copying facilities; the
distributor retains responsibility for availability.

## Runtime dependency closure and selection

`ffmpeg.exe` and `ffprobe.exe` each directly import all seven shipped FFmpeg DLLs.
The DLLs also import one another. GNU binutils `objdump -p <file>` or Visual Studio
`dumpbin /dependents <file>` reproduces this table from the exact verified archive:

| File | Direct FFmpeg DLL imports / reason |
|---|---|
| `ffmpeg.exe` | All seven below; Product capability probe and MP4 encoder |
| `ffprobe.exe` | All seven below; existing packaged smoke verifies the actual H.264/240-frame/8-second result |
| `avcodec-63.dll` | `avutil-61.dll`, `swresample-7.dll` |
| `avdevice-63.dll` | `avcodec-63.dll`, `avfilter-12.dll`, `avformat-63.dll`, `avutil-61.dll` |
| `avfilter-12.dll` | `avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`, `swscale-10.dll` |
| `avformat-63.dll` | `avcodec-63.dll`, `avutil-61.dll` |
| `avutil-61.dll` | No other FFmpeg DLL; Windows system/API-set imports |
| `swresample-7.dll` | `avutil-61.dll` |
| `swscale-10.dll` | `avutil-61.dll` |

All remaining ordinary imports are Windows system/UCRT API-set DLLs. Optional
driver-dependent capabilities remain as before. **No DLL is removed**: the selector
copies every upstream `bin/*.dll` and requires the seven audited names. The pinned
archive hash fixes this dependency graph; a future archive change needs a fresh
audit. The existing Windows smoke remains the actual runtime/export check.

| Other archive files | Decision |
|---|---|
| `ffplay.exe` (18,819,072 bytes) | Omit: editor previews use the native compositor; no Product or smoke call invokes this SDL player |
| `doc/` (35 HTML/CSS files, 11,841,675 bytes) | Omit: manuals are not runtime inputs or license notices; exact license/source notices supplied separately |
| `presets/` (5 files, 1,127 bytes) | Omit: VPx/IPod presets are not used by the explicit `h264_mf` argument contract |
| `include/`, `lib/` | Continue omitting development headers/import libraries, as before |
| `LICENSE.txt` | Retain original LGPLv3 bytes |
| `COPYING.GPLv3.txt`, `COPYING.GPLv2.txt`, `FFMPEG-LICENSE.md`, `FFTW-NOTICE.md`, `SOURCE-ACCESS.md`, `BUILD-CONFIG.txt` | Add required known terms, source/config references and explicit unresolved audit status |

## Size measurements

Measured the FFmpeg subtree independently using PowerShell 7.5.4 / .NET's
`ZipFile.CreateFromDirectory(..., CompressionLevel.Optimal, false)`, the same
compression API as production packaging. Before uses the previous selection
(everything except `include/` and `lib/`); after uses `Copy-FfmpegRuntime`, including
the added license/source notices. ZIP sizes are for this **subtree**, not a claim
that the entire editor package was built on Linux. All binary hashes match upstream.

| Selection | File count | Uncompressed bytes | ZIP bytes |
|---|---:|---:|---:|
| Previous FFmpeg subtree | 51 | 188,912,341 | 79,371,797 |
| New FFmpeg subtree | 16 | 158,314,892 | 68,442,423 |

The FFmpeg subtree saves 30,597,449 uncompressed bytes (29.18 MiB) and
10,929,374 ZIP bytes (10.42 MiB) with the added notices included.

The full archive download during packaging remains 77,705,024 bytes: slimming
reduces the distributed editor package, not this build prerequisite download.
The self-contained .NET/WPF runtimes, native core, ICU and other package content
remain separate size contributors. Full Windows candidate ZIP/inventory are
produced by the existing package workflow; the final H.264 smoke must pass there.

## Distribution strategy

| Strategy | User / package behavior | Maintenance and acceptance |
|---|---|---|
| Bundled selected runtime + audited source sidecar | Keep zero-install MP4 export and pinned DLLs; ordinary ZIP gains known notices but loses player/manuals | Preferred product behavior once GPL/source obligations are resolved; maintain exact source, dependency notices, hashes and packaged smoke |
| External compatible FFmpeg/ffprobe | Smaller editor; user installs/selects encoder and provides ffprobe for the current smoke contract | Avoid editor redistribution of FFmpeg bytes, but less reproducible setup and greater support friction; package/default-path/smoke changes need separate review |

This patch retains the bundled candidate behavior while accurately recording its
release blocker. It does not switch codecs, weaken the LGPL-compatible runtime
capability policy, or claim that the pinned package meets that policy's transitive
licensing intent merely because its configuration passes.

Validation: local runtime-selection and portable integrity tests pass; pinned
archive hash, import closure and file-byte preservation were inspected directly.
Windows real H.264 export is covered by the unchanged packaged WPF production smoke.
