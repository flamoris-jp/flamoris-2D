# FLAMORIS 2D

Turn layered artwork into short animated shots for music videos. FLAMORIS 2D is a Windows 2D rigging and animation editor: arrange parts, shape meshes, connect key poses, and layer reusable motion before exporting your shot.

PSD・Cutworkの素材から、メッシュとリグで動きを付けてMVの短いカットを作る2Dアニメーションエディターです。

## What you can do today

- **Bring in your artwork:** import layered PSDs or Cutwork `.flimg` v1/v2 projects, then select and arrange parts.
- **Build poses and transitions:** generate/edit meshes, add bones and warp deformers, and connect artwork states (Key Arts).
- **Animate a shot:** author reusable clips for motions such as blinking, breathing, or hair sway; place them on a sequence timeline and preview playback.
- **Export and keep editing:** write PNG frame sequences or Windows MP4/H.264, save a `.fl2d` project, and reopen it with artwork and authored motion. Edits support Undo/Redo.

**Native WPF status:** the Source → Mesh → Rig → Deform → Animation → Preview → Export workflow is implemented as a production candidate. Final real-art Windows acceptance and release cutover remain open; **Electron is still the default installed/released shell**. Automatic flat-image part decomposition remains experimental/deferred.

[Native制作ガイド（日本語）](docs/native-production-workflow.md) · [Try/build the native candidate](#run-the-native-windows-candidate) · [Capabilities and status](docs/product-status.md) · [Implementation evidence](docs/native-capability-map.md) · [Design docs](docs/README.md)

FLAMORIS 2D focuses on short animated shots, rather than the full scope of a DAW or video editor.

## Run the native Windows candidate

The [Native Shell Boundary workflow](https://github.com/flamoris-jp/flamoris-2D/actions/workflows/native-shell-ci.yml) uploads `flamoris2d-native-production-candidate-win-x64` only for successful manual (`workflow_dispatch`) runs, with three-day artifact retention. PR checks build and test the candidate but do not publish a download. If an artifact is available, extract the whole directory and run `Flamoris2D.exe` on Windows x64; otherwise use the [Windows development build instructions](product/native/README.md#build-and-tests).

The candidate bundles the self-contained .NET 10 runtime, Node 24.21.0, the reviewed Product Host graph, PSD decoder, and pinned LGPL shared FFmpeg. Keep the package directory intact. It does not install itself or replace the current Electron file association.

For development builds and the full native workflow, see [`product/native/README.md`](product/native/README.md) and [`docs/native-production-workflow.md`](docs/native-production-workflow.md).

## Run the current Electron Windows Desktop

From the repository root:

```powershell
npm ci
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
npm ci
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
- AI edits through live MCP use the same Commands / Transactions and Undo/Redo history as the editor; accepted output is ordinary deterministic Project data.

## Documentation

- [Capabilities, status, and remaining acceptance](docs/product-status.md)
- [Native production workflow (日本語)](docs/native-production-workflow.md)
- [Native migration completion ledger](docs/native-capability-map.md)
- [Roadmap](docs/roadmap.md) and [current design index](docs/README.md)
- [Phase 8 sequencing design](docs/phase8-animation-sequencing.md) and [production proof](docs/phase8-production-proof.md)
- [Release audit evidence and remaining gates](docs/reviews/issue-43-release-hygiene.md)

Documentation may mix Japanese and English. Use translation tools or AI translation where useful. Technical clarity and development continuity take priority over language uniformity.

## Development workflow

Use focused Issues and reviewable branches. Keep implementation commits small enough that interrupted work can resume safely.

This public repository inherits the organization's [contribution policy](https://github.com/flamoris-jp/.github/blob/main/CONTRIBUTING.md) and [security policy](https://github.com/flamoris-jp/.github/blob/main/SECURITY.md). Issues are welcome; pull requests are accepted from repository collaborators. Do not report sensitive vulnerabilities or credentials in public Issues.

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

## Historical reference

The original v0.3 prototype snapshot remains preserved on `prototype/psd-import-zoom-pan-v0.3` for history/reference. It is not the branch for continuing Product development.

## Native live MCP

Native live MCP uses Core 1.1.0 and a packaged stdio bridge over an authenticated same-user named pipe, attached to the running Native
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

FLAMORIS characters, character designs, artwork, illustrations, PSD source assets, music, audio, logos, trademarks, branding, video, and other creative assets are **not covered by Apache-2.0; all rights reserved unless separately licensed**. Their applicable licenses or rights statements must be provided separately.

### 方針

このリポジトリのソフトウェアソースコードは、特に明記がない限り [Apache License 2.0](LICENSE) で提供されます。

勝手に使ってください。改造しても、組み込んでも、商用利用してもOKです。

商用作品や製品で使う場合も、許可は不要です。もしよければ「こんなのに使ったよ」と教えてもらえるとうれしいです。もちろん強制ではありません。

FLAMORISのソフトウェアは現状のまま提供されます。個別サポートや動作保証はありません。困ったときは、README、ドキュメント、Issue、テスト、ログ、ソースコードをあなたのAIに読ませて、自己サポートしてもらってください。

もし、あなたのお役に立てたり、面白いと思っていただけたなら、開発費用をご支援いただけるとうれしいです。  
FLAMORISは元気になって育ちます。🌱  
<sub>主にGPU代とか。</sub>

FLAMORISのキャラクター、キャラクターデザイン、イラスト、PSD素材、音楽・音声、ロゴ、商標・ブランド、映像その他のクリエイティブ素材は、**Apache-2.0の対象外です。別途ライセンスが明記されていない限り、すべての権利を留保します**。各素材に適用されるライセンスや権利表示を別途確認してください。
