# Issue #43 — post-public release hygiene audit

Baseline: `40e8197ec0e952ffd98319fc4f8d72ab66170fda` (2026-09-26).
This records evidence and remaining gates; it is not a legal opinion or a claim
that every historical GitHub surface is free of sensitive data. Keep #43 open
until the remaining evidence below is reviewed.

## Disposition of the original acceptance criteria

| Requirement | Disposition / evidence |
| --- | --- |
| Apache-2.0 software license | Already satisfied by root `LICENSE`; package manifests and both lock metadata now identify Apache-2.0. The old MPL comment on #43 is obsolete. |
| Separate creative-asset rights | README now explicitly reserves rights unless separately licensed. No artwork is added by this change. |
| Mixed Japanese/English documentation | Already explained in README; translation/AI translation is welcome. |
| Contribution/security policy | Inherit `flamoris-jp/.github` root policies; README links them. No duplicated local policies. AGENTS retains its specific rules and Commons references. |
| Reproducible npm graph | Both lockfiles existed, but the root graph retained the superseded Node MCP stack. Refreshed root lock to match standalone Product package identities/versions/integrities/licenses; installation layout may differ. Windows packaging now uses `npm ci`. |
| Dependency license inventory | All 286 third-party npm lock entries classified below. Native NuGet/runtime redistribution review remains open. |
| Preserve notices | Native assembly already retains Node/FFmpeg/npm provenance. Both package paths now include the project's Apache license. Electron also copies verbatim production npm license texts and metadata outside ASAR. |
| Actual Windows package verification | Electron package command now inspects the actual ASAR versions, external notices and excluded content. Windows CI must pass this new check. Native notice completeness is still a gate below. |
| Future license changes | Existing Product CI checks both lock graphs and fails on missing/unrecognized license expressions. Documented exceptional development packages are pinned by name/version/expression and logged for manual review. This does not approve those licenses. |
| Secrets/private-data/history | Limited reachable-history scan described below; complete metadata/asset-rights clearance remains open. |
| Setup/hygiene | README uses locked install; `.gitignore` covers local environment files and PFX/P12 containers. Windows workflow now cancels superseded PR runs. |
| Visibility switch | Obsolete: repository is already public. Do not change visibility. |
| Existing behavior | No Product state, commands, renderer, evaluator, or UI authority changed. |

## Locked npm inventory

Production: `ag-psd@31.0.2` (MIT), `base64-js@1.5.1` (MIT),
`pako@2.1.0` (MIT AND Zlib). Their installed license files are copied verbatim,
including pako's combined notice. Electron `44.1.0` supplies its separate
`LICENSE.electron.txt` and `LICENSES.chromium.html` in the packaged distribution;
`electron-builder@26.15.7` is a development tool (MIT).

The standalone lock contains 286 third-party entries: MIT 214, ISC 36,
BSD-2-Clause 6, BSD-3-Clause 9, Apache-2.0 6, BlueOak-1.0.0 8,
Python-2.0 1, MIT AND Zlib 1, WTFPL OR ISC 1, WTFPL 1, 0BSD 1,
MIT OR CC0-1.0 1, WTFPL OR MIT 1. No missing license metadata or
GPL/AGPL expression was found in this npm graph. This excludes downloaded
Electron/Chromium components, NuGet, .NET and FFmpeg, which have their own notices.

The following **development-only** exceptions remain visible for human review:

| Package/version | Declared expression / observation |
| --- | --- |
| isexe 3.1.5, 4.0.0; chownr 3.0.0; minimatch 10.2.6; minipass 7.1.3; sax 1.6.1; tar 7.5.22; yallist 5.0.0 | BlueOak-1.0.0; upstream LICENSE.md present in installed packages |
| argparse 2.0.1 | Python-2.0; upstream LICENSE present |
| sanitize-filename 1.6.4 | WTFPL OR ISC; upstream LICENSE.md present |
| truncate-utf8-bytes 1.0.2 | WTFPL; **no standalone license file in installed package**; retain as explicit review item, not a compatibility conclusion |
| type-fest 0.13.1 | MIT OR CC0-1.0; upstream license present |
| utf8-byte-length 1.0.5 | WTFPL OR MIT; both upstream license texts present |

`product/scripts/release-hygiene.mjs` checks exact exceptions, rejects an
exception promoted to the production graph, and blocks new unknown/restrictive
expressions until reviewed. It is build tooling, not part of Product runtime.

Reproduce:

```sh
npm ci --prefix product --workspaces=false --ignore-scripts
node product/scripts/release-hygiene.mjs check
node product/scripts/release-hygiene.mjs prepare
npm test
```

On Windows, `npm ci` then `npm run desktop:pack` (or `desktop:dist`) also
checks the assembled `product/dist/win-unpacked` output. Do not distribute an
artifact whose notice or dependency-version checks fail. The NSIS command
checks its unpacked input directory; installation of the final NSIS artifact
and inspection after installation remain part of #78.

## Source and history scan scope

The clone of advertised branches/tags at the baseline contained 191 reachable
commits and 1,187 distinct blobs (13,305,206 bytes). Every reachable blob was
scanned for known GitHub/OpenAI/AWS credential formats, private-key headers,
common private IPv4/local-user-path patterns, and known private host references.
No matches were found for those patterns. This is a **limited pattern scan**, not
entropy analysis or proof that arbitrary passwords/private content cannot exist.

Tracked names in current main and those reachable refs contained no PSD/PSB,
PNG/JPG/WebP, MP3/MP4, `.env*`, PFX or private-key files in the inspected extension
set. Source-generated test fixtures remain separate from private artwork.
The package dependency supplies Chipsy; its asset terms remain separate from
Apache-2.0 and must accompany the native distribution as appropriate.

The check did not fetch deleted/unadvertised refs, cached GitHub objects, all PR
review/comment bodies, release attachments, or Actions logs/artifacts. Do not
use this scan as evidence to close the full public-data audit. No history was
rewritten and no sensitive matching values were published.

## Remaining release gates

- Review the listed development-license exceptions, including the package with
  no standalone license text. Do not silently treat scanner metadata as approval.
- Review the **actual native Windows output**, including both app and MCP bridge
  `.deps.json` graphs, every redistributed NuGet license/notice, .NET desktop
  runtime notices, Chipsy asset terms, Node notices and the complete LGPL FFmpeg
  distribution/source obligations. Existing prose provenance and successful
  runtime smoke tests do not prove these obligations are all satisfied. Resolve
  any missing texts before release; retain an artifact identifier/hash as evidence.
- Record Windows Electron package-check CI evidence and perform final installed
  NSIS contents/notice inspection. Reject unintended private or production assets.
- Complete human review of potentially private historical material and GitHub
  metadata (Issue/PR/review text, attachments, releases and logs), including any
  earlier privacy-audit evidence not independently available in this checkout.
- #78: real-art packaged Windows workflow, DPI/focus/input, export inspection.
  #96: Source-through-Export acceptance and reviewed release cutover.
  #97: recovery isolation, restore/discard and save acknowledgement in real use.
  #98: large real-art memory/renderer behavior and save/reopen artwork retention.
  These are acceptance gates; this PR does not reimplement them or close them.

#108 starts only after this PR is merged into main; #58 follows the same rule.
No automatic merge is requested.
