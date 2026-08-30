# FLAMORIS 2D

透明PNGのグリッドメッシュ編集に加え、PSDを直接読み込んでパーツ構造・座標・重なり順を復元する実験版です。
Milestone 2の単一PNG編集機能を維持したまま、PSD Importの入口を追加しています。

## セットアップ

```bash
npm install
npm start
```

ブラウザで `http://127.0.0.1:4173` を開きます。

## PSD Import

1. 「PNG / PSDを開く」からPSDを選ぶ、またはViewportへPSDをドロップ
2. PSD内の表示中レイヤーを元座標・元レイヤー順で復元
3. 「PSDパーツ」で編集したいパーツを選択
4. 選択パーツだけ既存のGrid Mesh編集へ接続
5. 選択パーツより下と上のレイヤーを別Canvasに描くため、元の重なり順を維持したまま変形を確認可能

Akino検証PSDでは 5000×8000 / 70パーツの直接読込を想定しています。

## 既存機能

- 透明PNGの読み込み
- Alpha領域の検出
- X/Yグリッドメッシュ生成
- WebGL 2によるindexed textured mesh描画
- 単一・複数頂点の選択とドラッグ
- base verticesを変更しないoffset変形
- 変形リセット
- キーフレームA/Bの記録
- 線形補間によるA→B→Aループ
- タイムスライダーと無音プレビュー

## PSD Import 現在の範囲

- ag-psdによるブラウザ内PSD解析
- Layer hierarchy / left / top / right / bottom の利用
- 表示レイヤーのCanvas画像読込
- opacity / 基本Blend Modeの描画
- PSDの重なり順を保った全体表示
- 選択した1パーツをMesh Editorへ接続

Photoshop固有の複雑なLayer Effect、Clipping、特殊Mask表現は今後の検証対象です。

## テスト

```bash
npm test
```

## Viewport navigation

PSDパーツ編集時は選択したパーツへ自動ズームします。

- マウスホイール: ズーム
- Space + 左ドラッグ: パン
- 中ボタンドラッグ: パン
- `全体`: ドキュメント全体へフィット
- `パーツ`: 選択パーツへフィット
