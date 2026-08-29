# flamoris-2D

FLAMORIS向けの軽量2Dキャラクターアニメーションエンジン。
Photoshopなどで事前に分離した透明PNGパーツを読み込み、
各パーツにMeshを生成して変形・キーフレームアニメーションを行います。
フル機能のLive2D代替を目指すのではなく、
MV制作で使う短い2Dアニメーションカットを素早く作ることを目的とします。

## Concept

基本ワークフロー:

```text
Photoshop
→ PNG Parts
→ Mesh
→ Deformation
→ Keyframes
→ Short Silent Clip
→ After Effects / Blender
```

主な用途:

- 髪の揺れ
- 顔や頭の軽い動き
- 衣装やアクセサリの変形
- 瞬き
- 短いループアニメーション
- MV用の数秒程度のカット制作

## Scope

### In Scope

- 透明PNGパーツの読み込み
- パーツ単位のMesh生成
- Mesh頂点編集
- Mesh Deformation
- Keyframe Animation
- Layer Order
- Project Save / Load
- Short Clip Preview
- PNG Sequence Export

### Out of Scope for MVP

- Audio
- Lip Sync
- Lyrics Sync
- Full-body realtime animation
- Physics simulation
- Motion tracking
- Full Live2D-compatible parameter system

## Mesh Architecture

各パーツは独立したMeshを持ちます。

```text
Part
├── Texture
├── Transform
├── Mesh
│   ├── baseVertices
│   ├── uvs
│   └── indices
└── Deformation
    └── vertexOffsets
```

基本変形:

```text
deformedPosition = basePosition + vertexOffset
```

描画では、三角形ごとに画像を分割して合成するのではなく、

```text
Texture
+ Shared Vertex Buffer
+ UV Buffer
+ Index Buffer
```

を使用してIndexed Meshとして描画します。

これにより、三角形境界のシームを避けることを目指します。

## MVP Mesh Generation

最初のMesh生成方式はGrid Meshとします。

```text
PNG Alpha
→ Non-transparent Bounds
→ Grid
→ Triangulation
→ UV Generation
```

将来的にはAlpha Contourを使ったContour Meshも追加予定です。

## Editor Architecture

編集用Meshと描画用Meshを分離します。

```text
EditableMesh
MeshVertex
├── position
└── connections[]

↓ compile

RenderMesh
vertices
uvs
indices
```

最初に必要な編集操作:

- Select Vertex
- Multi Select
- Move Vertex
- Add Vertex
- Remove Vertex
- Connect Vertex
- Reset Vertex

## Animation

MVPでは複雑なParameterシステムを作らず、
Mesh deformationを直接Keyframeとして保存します。

Example:

```text
0s   Neutral
2s   Hair Left
4s   Neutral
6s   Hair Right
8s   Neutral
```

各Keyframe間のvertexOffsetsを補間します。

最初はLinear Interpolationから開始し、
将来的にEase / Bezierへ拡張します。

## Project Structure

```text
Project
├── Canvas
├── Parts[]
│   ├── Texture
│   ├── Transform
│   ├── Mesh
│   └── Deformation
├── Timeline
└── RenderSettings
```

ProjectデータはJSONベースの非破壊形式を予定しています。

各PartやObjectにはstable IDを持たせ、
将来的なMCP / After Effects / Blender連携で利用します。

## MCP

将来的にはEditor操作をMCPから制御できるようにします。

Low-level commands:

```text
load_project
select_part
move_vertex
set_keyframe
render_preview
export_frames
```

将来的にはSemantic commandも追加予定です。

```text
blink
tilt_head
bend_hair
sway_cloth
breathe
```

UI操作、Undo / Redo、MCP操作は
同じCommand Layerを利用する設計を目指します。

Example:

```text
MoveVertices
AddVertex
RemoveVertex
SetKeyframe
SetLayerOrder
```

## External Integration

### After Effects

想定方式:

```text
Project JSON
+ Assets
+ JSX
```

TransformやLayer構造、Keyframeを生成します。

Mesh deformationそのものは必要に応じて
PNG / EXR SequenceとしてBakeします。

### Blender

想定方式:

```text
Project JSON
→ Blender Python Importer
```

Mesh、Material、Shape Key、Keyframe、
Orthographic Cameraなどを生成します。

## References

主な設計参考:

- Inochi2D / inochi2d
- Inochi2D / inochi-creator
- zhangzhensong / arap

特にInochi2Dの

- MeshData
- DeformedMesh
- Deformation
- MeshDeformer
- LatticeDeformer

およびInochi Creatorの

- Grid AutoMesh
- Editable Mesh
- Mesh Point Tool
- Deformation Editing

を参考にしています。

ARAPは将来研究対象とし、
MVPでは必須としません。

## First Goal

最初の成功条件は非常に小さく設定します。

透明な前髪PNGを読み込み、
Grid Meshを生成し、
頂点をドラッグすると、
三角形の境界線を出さずリアルタイムに変形できる。

これがflamoris-2Dの最初の一歩です。
