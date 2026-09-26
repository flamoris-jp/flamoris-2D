# FLAMORIS 2D

FLAMORIS 2D is a deterministic 2D animation editor for producing short moving-picture and MV shots from layered or flat artwork.

The current production workflow is:

```text
PSD / PNG / Cutwork `.flimg` artwork
  -> Scene / Mesh / Semantic Mapping
  -> Clipping / Warp / Bones / Skinning where needed
  -> Key Art A -> B -> C ...
  -> reusable AnimationClips such as Blink / Breath / HairSway
  -> deterministic Sequence preview
  -> deterministic PNG / MP4 export
  -> MV shot
```

FLAMORIS 2D is intentionally focused. It is not intended to reproduce every Live2D feature or become a general DAW/NLE.

## Current status

The Phase 1-8 production core is implemented.

The native WPF production candidate in [PR #101](https://github.com/flamoris-jp/flamoris-2D/pull/101) now supports Source through Export, Recovery, PSD/Cutwork import, textured Mesh authoring, Rig/Deform, Sequence animation, Preview, PNG/MP4 export, and save/reopen/resume. See the [Japanese native workflow](docs/native-production-workflow.md) and [completion ledger](docs/native-capability-map.md). Electron remains the default installed/released shell until final Windows acceptance and a reviewed release cutover.

Current checkpoint:

- Phase 1 Editor Core + Windows Desktop shell — complete
- Phase 2 deterministic Key-Art Transition foundation and authoring — complete
- Phase 3 production mesh topology / Contour AutoMesh / correspondence assistance — complete
- Phase 4 deterministic PNG / Windows MP4 export — implementation complete
- Phase 6 clipping + Warp/Lattice Deformer — complete
- Phase 7 Bones / FK / rigid and weighted skinning / form correction / constraints / IK — complete
- Phase 8 Multi-Key-Art Sequence / AnimationClip / deterministic mixer / timeline authoring — complete
- Phase 9 Production Robustness / Internal Beta — active hardening stage
- Native WPF migration (#96 / PR #101) — Source-through-Export implementation candidate complete; final real-art Windows acceptance and release cutover remain

The immediate gate is the final Windows hands-on pass for the native production candidate under Issue #96 / PR #101 using real FLAMORIS artwork and projects. Issue #78 remains the broader post-Phase-8 packaged-Windows QA checklist, and Issue #79 remains the Phase 9 hardening umbrella. Issues #97/#98 have implementation in PR #101 but stay open until review and final acceptance are complete.

Phase 5 flat-image part decomposition remains an experimental/deferred input-simplification track and does not block the current PSD/Cutwork production workflow.

## Current capabilities

### Project and editor core

- versioned `.fl2d` Project model
- stable Scene / mesh / rig identities
- deterministic Query / Command / Transaction / EditorSession architecture
- Undo / Redo and grouped history
- Save / Save As / Incremental Save / Save Copy
- dirty/save-point tracking, lineage-scoped native Recovery, Recent Files, and native Windows dialogs
- PSD import/re-import and Cutwork `.flimg` v1 source-art import with document-coordinate placement
- native WPF production candidate plus the currently released Electron Windows shell
- installed `.fl2d` file association remains owned by the Electron release until cutover; the portable native candidate does not change system association
- typed MCP-ready command/query boundaries with one shared EditorSession authority

### Mesh and Key Art authoring

- separate Mesh Structure / Layout and Deform authoring semantics
- stable mesh vertex IDs and optional semantic labels
- add / remove / connect / subdivide topology operations
- Grid Mesh and deterministic Contour AutoMesh
- per-Key-Art MeshKeyforms over shared topology
- textured native Layout preview and commit
- whole-mesh position / rotation / scale alignment and explicit UV editing
- deterministic correspondence assistance and pins
- explicit SemanticSlot correspondence across Key Arts

### Transition, deformation, and rigging

- canonical 120000 ticks/sec integer timebase
- rational FPS conversion and deterministic sampling
- Morph / Hold / Replace / Appear / Disappear / Occlusion
- clipping with final evaluated geometry/alpha
- Warp/Lattice Deformer with nested parent-first evaluation
- Bones and deterministic FK
- rigid Bone attachment
- weighted skinning using stable mesh vertex IDs
- weight painting/numeric editing and normalization
- MeshFormCorrection after skeletal deformation
- rotation constraints
- analytic two-bone IK as an authoring helper
- mirror helpers
- reusable MeshDeformation samples for animation

### Sequence and reusable motion

- persistent multi-Key-Art Sequence / ViewLane
- KeyArtHold and retimed TransitionInstance placement
- reusable AnimationClip / ClipInstance
- Once / Loop playback semantics
- TransformTrack / BoneTrack / DeformerTrack / MeshDeformationTrack / CameraTrack plus existing opacity/presence/draw-order/clipping channels
- reusable Blink / Breath / HairSway-style motion
- deterministic typed contribution mixer
- native Sequence timeline, scrub, playback, clip placement/trim, zoom/scroll, and keyframe editing
- explicit Bezier interpolation with authoring ease presets

### Preview and export

- one canonical evaluated-frame/render-plan path for native Preview and Export
- D3D11 hardware renderer with WARP fallback, selected by measured ADR 0008 evidence
- deterministic frame planning from rational FPS
- deterministic PNG frame sequence export
- Windows MP4/H.264 export using pinned LGPL FFmpeg and Media Foundation `h264_mf`
- progress, cancellation, conflict handling, diagnostics, and explicit partial-output policy
- packaged automated eight-second workflow verifies 240 PNGs and an H.264 MP4, then Save/Open/resumed editing

The remaining real-device validation work is perceptual/operational acceptance: real artwork, DPI/focus/input feel, dense timeline usability, output inspection, and release cutover policy. It is not a missing Source-to-Export architecture stage.

## Run the native Windows candidate

PR #101 publishes `flamoris2d-native-production-candidate-win-x64` from the Native Shell Boundary workflow. Extract the whole artifact and run `Flamoris2D.exe` on Windows x64.

The candidate bundles the self-contained .NET 10 runtime, Node 24.21.0, the reviewed Product Host graph, PSD decoder, and pinned LGPL shared FFmpeg. Keep the package directory intact. It does not install itself or replace the current Electron file association.

For development builds and the full native workflow, see [`product/native/README.md`](product/native/README.md) and [`docs/native-production-workflow.md`](docs/native-production-workflow.md).

## Run the current Electron Windows Desktop

From the repository root:

```powershell
npm install
npm test
npm run desktop
```

Create an unpacked Windows app:

```powershell
npm run desktop:pack
```

Create an NSIS installer:

```powershell
npm run desktop:dist
```

Electron remains the default release until the native retirement/cutover criteria pass.

## Run browser shell

From the repository root:

```powershell
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173`.

The browser shell remains a development-compatible adapter, not the native production target.

## Repository boundaries

```text
product/   current editor/runtime implementation
staging/   manual/visual acceptance setup and non-production fixtures
test/      integration/system/staging checks outside Product runtime
history/   superseded prototypes and historical material
docs/      current design, research, ADRs, and production proof
```

Product code must not depend on Staging, integration-test helpers, History, or private acceptance artwork. Production artifacts use an explicit allowlist or equivalent build boundary.

See `AGENTS.md` and `docs/repository-boundaries.md`.

## Architecture principles

- GitHub `main` is the reviewed source of truth; open migration PRs are candidates until merged.
- Persistent animation time uses one canonical integer tick domain: 120000 ticks/sec.
- `TemporalProgram` is shared by Transitions, Sequences, and AnimationClips rather than duplicated into parallel timing models.
- Stable IDs, not display names or array positions, are authoritative for Scene, mesh, rig, and animation targets.
- Major visual changes are represented by Key Arts; reusable ordinary motion is layered through AnimationClips.
- WPF gestures, headless/MCP operations, and tests converge on one authoritative JavaScript `EditorSession` through the Product Host.
- Preview, PNG, and MP4 source frames share the same evaluated semantics and native compositor in the production candidate.
- The renderer consumes final evaluated geometry/compositing state and remains unaware of Sequence/Clip/Bone authoring semantics.
- Persistent mutations go through deterministic Commands / Transactions and remain Undo/Redo-safe.
- Transient UI state such as selection, playhead, hover, drag preview, and playback state does not become Project authority.
- AI may propose edits in future phases, but accepted output must become ordinary deterministic Project data.

## Documentation

Current design index: `docs/README.md`

Current roadmap: `docs/roadmap.md`

Native migration completion ledger: `docs/native-capability-map.md`

Native production workflow: `docs/native-production-workflow.md`

Phase 8 sequencing design: `docs/phase8-animation-sequencing.md`

Phase 8 production proof: `docs/phase8-production-proof.md`

Documentation may mix Japanese and English. Use translation tools or AI translation where useful. Technical clarity and development continuity take priority over language uniformity.

## Development workflow

Use focused Issues and reviewable branches. Keep implementation commits small enough that interrupted work can resume safely.

Typical flow:

```text
Issue
  -> design / acceptance contract when needed
  -> feature branch
  -> small purpose-driven commits
  -> focused + full regression tests
  -> Pull Request review
  -> merge to main
```

Non-trivial defects found during Production QA should become focused Issues rather than being hidden inside broad Phase umbrellas.

## Current follow-up work

- #96 / PR #101 — final native Source-to-Export review and real Windows acceptance; release cutover remains open
- #97 — native Recovery decision/acceptance; implementation is in PR #101
- #98 — native bulk artwork/renderer proof; implementation and measured renderer decision are in PR #101
- #78 — broader packaged Windows end-to-end Production QA checklist
- #79 — Phase 9 Production Robustness / Internal Beta umbrella
- #58 — production UX cleanup and Japanese-first labels
- #6 — dependency lockfile / reproducibility
- #43 — public repository release preparation

The public-release and licensing work in #43 is intentionally separate from current product hardening. Do not infer licensing of FLAMORIS creative assets from the software repository until that release work is completed.

## Historical reference

The original v0.3 prototype snapshot remains preserved on `prototype/psd-import-zoom-pan-v0.3` for history/reference. It is not the branch for continuing Product development.

### Native live MCP

Issue #107 migrates live MCP to Core 1.1.0 and a packaged stdio bridge over an authenticated same-user named pipe, attached to the running Native
editor's **same EditorSession and Undo/Redo history**. `MCP / AI` offers Read only /
Edit, connection copy, activity and revocation. Current protocol 2026-07-28 uses
official SDK 2.0.0; file/import/save capabilities stay Native-only.
See [connection and hands-on guide](docs/native-production-workflow.md),
[MCP design](docs/mcp-design.md), and [ADR 0011](docs/decisions/0011-mcp-core-migration.md).


## License, support, and philosophy

The software source code in this repository is licensed under the [Apache License 2.0](LICENSE), unless otherwise noted.

Commercial use is welcome and does not require permission. If you'd like, we'd be happy to hear what you used FLAMORIS for. This is completely optional.

FLAMORIS software is provided as-is. We do not provide guaranteed individual support. If you run into trouble, we encourage you to let your AI assistant read the repository, documentation, Issues, tests, logs, and source code and help you solve it.

If FLAMORIS helps you or you find it interesting, your support helps fund development and keeps the project growing. 🌱  
<sub>Mostly GPU bills.</sub>

FLAMORIS characters, character designs, artwork, illustrations, PSD source assets, music, audio, logos, trademarks, branding, video, and other creative assets are **not automatically licensed under Apache-2.0**. Their applicable licenses or rights statements must be provided separately.

### 方針

このリポジトリのソフトウェアソースコードは、特に明記がない限り [Apache License 2.0](LICENSE) で提供されます。

勝手に使ってください。改造しても、組み込んでも、商用利用してもOKです。

商用作品や製品で使う場合も、許可は不要です。もしよければ「こんなのに使ったよ」と教えてもらえるとうれしいです。もちろん強制ではありません。

FLAMORISのソフトウェアは現状のまま提供されます。個別サポートや動作保証はありません。困ったときは、README、ドキュメント、Issue、テスト、ログ、ソースコードをあなたのAIに読ませて、自己サポートしてもらってください。

もし、あなたのお役に立てたり、面白いと思っていただけたなら、開発費用をご支援いただけるとうれしいです。  
FLAMORISは元気になって育ちます。🌱  
<sub>主にGPU代とか。</sub>

FLAMORISのキャラクター、キャラクターデザイン、イラスト、PSD素材、音楽・音声、ロゴ、商標・ブランド、映像その他のクリエイティブ素材は、**Apache-2.0によって自動的にライセンスされるものではありません**。各素材に適用されるライセンスや権利表示を別途確認してください。
