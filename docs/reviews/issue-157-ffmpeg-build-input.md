# Issue #157 — retained, verified FFmpeg build input

2026-10-24 implementation candidate. The September 28 daily archive returned
404 during Windows packaging. BtbN retains only the last 14 daily builds and the
last build of each month for two years:
https://github.com/BtbN/FFmpeg-Builds#release-retention-policy .
A floating `latest` URL would change the build input, so it is not used.

## Current pin

| Input | Value |
|---|---|
| Retained month-end release | `autobuild-2026-09-30-13-08` |
| Archive | `ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip` |
| Size | 78,636,802 bytes |
| SHA256 | `2cc3dd0baf74ebd68a3fceaf771df8351a7a6d69694d05f43b16bb0c966ec909` |
| FFmpeg revision | `e0c94b2d1c96c2548645d00690f26dc5178d4855` |
| BtbN recipes | `6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b` |

Release: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08 .
The actual downloaded ZIP hash matches both the release asset API digest and the
pinned build input. The SHA256 is reviewed in source, not fetched dynamically at
build time. Nothing automatically selects a newer release or relaxes verification.

The default persistent build cache is
`artifacts/downloads/ffmpeg/<sha256>.zip`, outside the portable output. Every use
rehashes it; corrupt caches fail with a repair instruction. Only a completed,
verified download is moved into the cache. Failed/truncated/wrong-hash downloads
are removed. CI caches the same directory under the exact archive hash.

`-FfmpegArchivePath` accepts a retained offline copy, with the same mandatory
hash check. `-FfmpegCacheDirectory` moves the cache (relative paths are resolved
against the repository root). Input verification precedes removal of an existing
portable package. Normal packaging does not delete the build cache.

Two-year upstream retention is not permanent hosting. Retain this verified ZIP
in local/organization backups for builds beyond the upstream retention window,
and review/update the pin before September 2028. An empty cache after upstream
expiry requires a retained copy or a reviewed new pin; it must fail clearly.

## Runtime and notice refresh

The September 30 archive still ships exactly the seven required FFmpeg DLL names.
`objdump -p` shows the encoder/probe and DLL import closure remains those seven
FFmpeg DLLs plus Windows system/UCRT/API-set dependencies. All upstream DLLs are
retained. Existing `h264_mf`, self-contained package and ffprobe smoke contracts
remain the acceptance boundary for the two-day upstream update.

`BUILD-CONFIG.txt`, `SOURCE-ACCESS.md` and the portable third-party notices now
identify the new exact revisions. The embedded configure string adds
`--enable-libcurl`; it still selects version3/shared/static pkg-config dependencies
and has no enable-gpl/nonfree/libx264/libx265 flag. The exact FFmpeg `LICENSE.md`
and GPLv3 text match the previously retained copies.

The new `avformat-63.dll` still contains FFTW 3.3.11 implementation strings.
At the new BtbN revision, `25-fftw3.sh` and `50-chromaprint.sh` retain the same FFTW
and Chromaprint source revisions/static-link recipes recorded in the earlier
audit. **Issue #149 remains open**: this fixes build input availability, not
whole-archive licensing, a complete dependency inventory or corresponding-source
publication. The September 28 size/source recovery measurements remain historical
in [the earlier audit](issue-149-ffmpeg-redistribution.md).

## Validation

- Offline synthetic PowerShell tests: cold fetch, warm cache without network,
  explicit offline input, corrupt cache/provided archive rejection, wrong-hash
  download rejection and cleanup after 404/partial downloads.
- Existing runtime-selection and portable-integrity tests.
- Download the actual retained archive and verify its SHA256/import closure.
- Windows package CI: real download, build, package, official MCP client and WPF
  production smoke with H.264/240-frame export. Final result is recorded in the PR.
