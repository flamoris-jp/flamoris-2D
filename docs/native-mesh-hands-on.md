# Native Mesh hands-on checkpoint

> Historical PR #100 proof. Production work supersedes its checkpoint limits; use [native-production-workflow.md](native-production-workflow.md) and [native-capability-map.md](native-capability-map.md).

Baseline: main `63372daa44ddf6c862cac7c47a34ca388437a104`, merged #99.
Scope: user-authorized #96 Mesh-first proof, not production Open/Save/Recovery.

## Boundary decisions for this checkpoint

The explicit Mesh-first request permits a replaceable WPF-native reference-art renderer
before final renderer selection. ADR 0006 is not marked superseded or accepted anew.
ADR 0007 / #97 remain proposed/deferred. No recovery storage is touched.

Users explicitly select PNG artwork (including transparent Part PNGs) for a disposable
hands-on session. These are user inputs, not a Product dependency on staging/private
fixtures. Multiple PNGs share document origin; this is not PSD/.flimg layer/bounds import.
The shell warns that edits cannot be saved and confirms replacement/close. No production
file association, recent-file, persistence or Recovery completion is claimed.

The Host owns immutable straight BGRA8 raster bytes outside Project. The existing Project
owns normal nodes, Key Art membership, topology/keyforms and history. A per-process
loopback binary endpoint accepts only bounded, reserved raster handles; it exposes no
paths or filesystem operations. A random bearer secret is disclosed only in the private
stdio handshake. Browser Origin requests are rejected. Reservation, upload, read and
release use opaque IDs and document/revision tags; replacement/crash drops old ownership.
Aborted/expired uploads release their budget. PNG decode is a native WPF environment
adapter, after encoded-size/dimension checks, not a claim of browser-free PSD decoding.

Control JSON never carries raster/base64. Raster budget is deliberately a proof limit,
not a production asset policy: at most 4096 per dimension, 4,194,304 pixels per raster,
16 rasters and 64 MiB total Host raster storage (including reservations). Native decoding
and rendering retain only the same bounded set, with one in-flight decode/upload.

## Provisional rendering seam

`MeshViewport` draws immutable source bitmaps plus independently visible geometry from
revision-tagged Product projections. It owns DIP camera transforms, hit testing and
transient gestures only. A future canonical render-plan compositor replaces its raster
presentation, not Mesh commands, target identity, history or coordinate semantics.

This path does **not** guarantee textured-triangle, clipping, rig, opacity-composition,
Transition, Preview/Export or final GPU/colour parity. It is reference-art Mesh authoring,
not a substitute evaluator. No renderer ADR is accepted from a smoke test.

Audit: `MeshToolController.commitDeformPositions` is an old compatibility name that calls
`mesh_keyform.move_vertices`. That command replaces keyform positions, leaves UVs intact,
and writes no animation/form offsets. A textured renderer therefore may visibly stretch
artwork after this layout edit; that alone does not prove misrouting to Deform. The
provisional reference-art view intentionally leaves artwork stationary so placement is
legible. It does not silently rewrite UVs or claim to preview that textured consequence.

## Operation authority

The Host reuses MeshPreparationController and MeshToolController over its one
EditorSession. Native Structure maps to topology mode; Layout maps to the legacy
keyform-placement mode. Deform never exposes these mutation tools. Grid/Contour helpers
produce ordinary candidates, preview first, explicit Apply through existing transactions.
No legacy mesh writer is used; Grid's generated arrays are immediately projected into
ordinary candidate positions/UVs/indices.

A drag records document token, revision, target, stable vertex IDs and starting positions.
Moves change only its local overlay; release commits once, no-op/cancel/lost capture
commits nothing. New revisions, targets or contexts cancel a pending gesture/preview.
Undo/Redo uses the same EditorSession as WPF and headless commands.

Contour/Grid previews run in one replaceable Worker: 128 MiB old-generation / 16 MiB
young-generation JS heap, 10 seconds, and at most 10,000 candidate vertices. These
are proof safety caps, not final production performance budgets. The immutable input
raster copy and runtime overhead are additional bounded allocations, not included in
the JS heap limit. Cancel signals only the matching preview ID/document token; the
Worker terminates before another preview is admitted. Failed previews write no history.

The binary endpoint permits at most sixteen connections, with a one-second idle
keep-alive timeout so pooled clients do not exhaust the socket cap. All attached assets
and upload reservations share the 64 MiB Host raster budget. Native presentation caches
only these immutable bitmaps; one input decode/upload runs at a time. Replacing a large
session may exceed the shared budget: explicitly choose New (discard confirmation)
first, then load the new artwork. Never evict live assets implicitly to make space.

## Windows hands-on — Japanese quick path

Prerequisites: Windows, .NET 10 SDK and Node 24. No Node/runtime installer change is claimed.
From the repository checkout:

```powershell
git fetch origin
git switch --track origin/feature/issue-96-native-mesh-hands-on
dotnet run --project product/native/src/Flamoris2D.App -c Release
```

If the branch already exists locally, switch to it and update normally without discarding
local changes. Alternatively use the PR's Native Shell Boundary artifact
`flamoris2d-native-mesh-hands-on-win-x64`; it requires the .NET 10 Desktop Runtime and
Node 24 in PATH (or `FLAMORIS_NODE_PATH`), then launch `Flamoris2D.exe`.

1. `PNGでMesh体験…` で本物のPNGを選ぶ。透明な目などのパーツPNGを複数選択可。
   自動で粗い2×2 Gridを作る。読み込みは保存不可の体験セッションで、元ファイルは変更しない。
2. 右上で目などのPartを選ぶ。複数PNGは共通原点で重なるため、表示ボタンで不要なPartを隠す。
   このPNG経路はPSD/.flimgのレイヤー配置・切り出し座標をインポートしない。
3. Meshで `構造` と `位置決め` を切替。どちらでもメッシュ表示は維持される。
4. `構造 > 頂点を追加` は空いている位置をクリック。`頂点を削除` は頂点をクリック。
   削除は既存仕様どおり接続面も削除する。Undoで戻して確認する。
5. `面を作成` で3頂点を選び、上の作成ボタン。既存の面と重複しない3点を使う。
   `辺を分割` で既存辺の両端2点を選び、上の分割ボタン。
6. `位置決め > 移動` で頂点をドラッグ。Shiftで複数選択、全頂点を選択すれば全体を平行移動。
   ドラッグ中のEsc／capture lossは取消。Ctrl+Zは直前のMesh操作、Ctrl+Yは同じ操作を復元。
7. `構造 > 生成` でGridの横／縦（1〜32）または輪郭の設定（各0〜1）を調整する。
   `Gridを試す`／`輪郭から試す` は橙色プレビューのみ。`プレビューを適用` で確認して確定する。
   `取消`／Escは履歴を増やさない。輪郭は既存Productの連結成分・穴などの制約を維持する。
8. ホイールでカーソル位置中心のzoom、右／中ドラッグまたはSpace+左ドラッグでpan。
   `全体表示` でfit。頂点ハンドルはzoomに依存しないDIPサイズ。
9. 頂点ID／高コントラスト／メッシュ表示は上の独立した設定。選択頂点の位置・ラベルは右下。
   TextBox内のCtrl+Zは文字編集に使われ、Project Undoには漏れない。
10. 他workflowへ移動してMeshへ戻る。選択Partと有効な頂点選択を維持し、非AnimationではTimelineを隠す。

Changes are disposable: production Open/Save/Recovery and source `.fl2d` artwork retention
are not implemented by this path. Export is not enabled. Close/replacement warns about
loss of these edits. Keep real work in the existing Electron editor until parity closes.

## Verification record

Product tests cover authenticated binary delivery, stale/budget/abort/expiry cleanup,
ordinary topology operations and labels, exact Layout/history/UV semantics, headless
shared history and generation preview/apply/cancel. Native tests cover BGRA round-trip,
coordinate/DPI/zoom/pan/hit-test invariants and disposable drag cancellation.

The Windows smoke now shows/arranges the WPF window, displays a synthetic raster, switches
Structure/Layout without losing overlay, commits Mesh moves and Grid generation, and
checks exact Undo/Redo and target retention across all seven workflows. This is not a
human mouse session or real artwork visual acceptance.

Diagnostic observation from Windows CI run 34862062043: one RenderTargetBitmap smoke
render took 5.72 ms, WPF reported tier 2, on synthetic 64×32 input. This is **not** a
software/Direct3D candidate comparison, latency budget or renderer-selection evidence.
Final representative renderer benchmarks and the user's Windows hands-on remain open.

## Remaining gates

#98 remains open for full `.fl2d` metadata/assets retention, PSD/.flimg decode/import,
bulk production-scale proof and measured final renderer choice. #97 is intentionally
not a dependency of this disposable Mesh proof. Electron and Issue #96 remain open.
Windows visual acceptance belongs to the user's hands-on pass, not Linux or CI.
