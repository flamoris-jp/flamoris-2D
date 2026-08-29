# FLAMORIS Avatar - Design Draft

## 1. Purpose

FLAMORIS Avatar is a lightweight 2D character animation tool for creating short, silent animation clips from pre-separated character artwork.

This project is **not intended to clone Live2D** or provide full-body real-time avatar tracking.

Primary use case:

- Create short clips of roughly several seconds
- Animate selected character parts such as hair, face, eyes, mouth, clothing, and accessories
- Use manually separated parts exported from Photoshop
- Apply 2D mesh deformation per part
- Preview and render clips
- Later expose editing/animation operations through MCP
- Later export or bridge data to After Effects and Blender

---

## 2. Scope

### In Scope for MVP

- Load transparent PNG parts exported from Photoshop
- Preserve part names and layer order
- Generate a mesh for each part
- Display the textured mesh without visible triangle seams
- Select and move mesh vertices
- Store deformation as vertex offsets
- Create keyframes
- Interpolate between keyframes
- Preview a short animation clip
- Export PNG sequence and/or silent MP4
- Save project state in a non-destructive JSON-based format

### Out of Scope for MVP

- Audio analysis
- Lip-sync
- Lyrics synchronization
- Real-time face tracking
- Full-body tracking
- Physics
- Automatic character rigging
- ARAP deformation
- PSD import
- Direct After Effects integration
- Direct Blender integration
- MCP server implementation

These may be added later.

---

## 3. Input Workflow

Character parts are prepared manually in Photoshop.

Example:

```text
shot01_parts/
  hair_back.png
  face.png
  eye_l.png
  eye_r.png
  mouth.png
  hair_front.png
  cloth.png
```

Each file is:

- transparent PNG
- already separated into a meaningful animation unit
- named semantically
- exported in a shared coordinate system if possible

Optional layer metadata:

```json
{
  "layers": [
    {"file": "hair_back.png", "z": 0},
    {"file": "face.png", "z": 1},
    {"file": "eye_l.png", "z": 2},
    {"file": "eye_r.png", "z": 2},
    {"file": "mouth.png", "z": 3},
    {"file": "hair_front.png", "z": 4}
  ]
}
```

---

## 4. Core Data Model

```text
Project
 ├─ Canvas
 ├─ Parts[]
 │   ├─ Texture
 │   ├─ Transform
 │   ├─ Mesh
 │   └─ Deformation
 ├─ Timeline
 └─ RenderSettings
```

### 4.1 Mesh

A mesh contains:

```text
vertices
uvs
indices
```

- `vertices`: base XY coordinates
- `uvs`: texture coordinates
- `indices`: triangle indices

This follows the same fundamental model used by Inochi2D.

### 4.2 Deformation

Deformation should be stored as **vertex offsets relative to the base mesh**.

```text
deformed_position = base_position + vertex_offset
```

Example:

```json
{
  "vertexOffsets": [
    [0.0, 0.0],
    [1.2, -0.8],
    [3.1, -1.5]
  ]
}
```

Keeping the base mesh immutable makes:

- reset easy
- interpolation easy
- undo/redo easier
- project diffs smaller
- MCP manipulation safer later

---

## 5. Mesh Generation

Mesh generation is performed **per Photoshop part**, not across the complete character.

This prevents unrelated areas from deforming together.

### 5.1 MVP: Grid Mesh

First implementation:

1. Read PNG alpha channel
2. Detect non-transparent bounding box
3. Build a configurable X/Y grid over the active area
4. Divide each grid cell into two triangles
5. Generate UV coordinates

Example:

```text
Alpha Bounds
    ↓
5 x 5 Grid
    ↓
Triangulation
    ↓
Textured Mesh
```

This approach is inspired by the grid automesh implementation in Inochi Creator.

### 5.2 Future: Contour Mesh

Possible later addition:

- detect alpha contour
- place vertices along the visible boundary
- triangulate the interior

Useful for:

- eyes
- mouth
- thin hair strands
- accessories
- irregular shapes

---

## 6. Rendering

The renderer must use a proper indexed textured mesh.

Do **not** warp each triangle into a separate image and composite the triangles individually.

Desired pipeline:

```text
Texture
+
Vertex Buffer
+
UV Buffer
+
Index Buffer
    ↓
GPU Renderer
```

Candidate technologies:

- WebGL
- WebGPU

This should avoid visible seams between triangles when implemented correctly.

---

## 7. Mesh Editing

Minimum editor operations:

- select vertex
- multi-select vertices
- drag selected vertices
- add vertex
- remove vertex
- connect vertices
- reset deformation

Suggested separation:

```text
EditableMesh
  MeshVertex
    position
    connections[]

        ↓ compile

RenderMesh
  vertices
  uvs
  indices
```

This follows a useful pattern visible in Inochi Creator.

---

## 8. Animation Model

For the first version, parameter systems are unnecessary.

Use direct timeline keyframes.

Example:

```text
0.0s  neutral
2.0s  hair_left
4.0s  neutral
6.0s  hair_right
8.0s  neutral
```

Each keyframe stores deformation offsets for a part.

```json
{
  "time": 2.0,
  "partId": "hair_front",
  "vertexOffsets": []
}
```

Between keyframes:

```text
offset(t) = lerp(offsetA, offsetB, normalized_time)
```

Start with linear interpolation.

Later:

- easing
- Bezier curves
- parameter tracks
- reusable animation presets

---

## 9. Project File

Use an open, non-destructive project format.

Example:

```text
project/
  project.json
  textures/
    face.png
    hair_front.png
  meshes/
    face.json
    hair_front.json
```

Suggested top-level structure:

```json
{
  "version": 1,
  "canvas": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 8.0
  },
  "parts": [],
  "timeline": [],
  "render": {}
}
```

Stable IDs should be used for parts, meshes, and tracks.

This will become important for:

- undo/redo
- automation
- MCP
- exporter bridges
- version control

---

## 10. Renderer / Editor Architecture

Recommended high-level architecture:

```text
Project Model
    ↓
Command Layer
    ↓
Mesh / Timeline Core
    ↓
Renderer
```

All editor actions should eventually go through a common command layer.

Example commands:

```text
MoveVertices
AddVertex
RemoveVertex
SetKeyframe
SetLayerOrder
```

The same command layer can later be used by:

- UI
- undo/redo
- MCP
- automated scripts

This avoids creating a separate AI-only code path.

---

## 11. MCP Direction

MCP should be designed conceptually from the start, but implemented after the core editor is stable.

Low-level examples:

```text
load_project
select_part
move_vertex
set_keyframe
render_preview
export_frames
```

Higher-level semantic commands are more useful long term:

```text
blink
tilt_head
bend_hair
sway_cloth
breathe
```

Semantic actions should compile down to deterministic mesh/timeline edits.

---

## 12. After Effects Bridge

Preferred future design:

```text
Project JSON
+
Assets
+
Generated JSX
```

The JSX script can:

- create composition
- import PNG parts
- create layers
- apply transforms
- create keyframes
- preserve layer names and order

For exact mesh deformation, safest options are:

- baked PNG/EXR sequence
- a dedicated Puppet/Mesh Warp bridge if practical

Do not assume arbitrary vertex mesh animation can be edited directly in AE without a script/effect-specific solution.

---

## 13. Blender Bridge

Blender integration is likely easier through a Python importer than through a generic interchange format alone.

Potential flow:

```text
Project JSON
    ↓
Blender Python Importer
    ↓
Planes
Materials
Shape Keys
Keyframes
Orthographic Camera
```

This preserves semantic names and gives direct control over:

- layer parts
- transparency
- shape keys
- timing
- camera

glTF may still be useful later for generic interoperability.

---

## 14. Research References

### Inochi2D

Relevant architectural findings:

- Mesh stores vertices, UVs, and triangle indices
- Deformed mesh is separated from base mesh
- Deformation can be represented as per-vertex offsets
- Mesh deformer uses barycentric mapping for child deformation
- Lattice deformer exists for grid-based control
- Renderer is draw-list based and expects indexed mesh data

Repositories:

- `Inochi2D/inochi2d`
- `Inochi2D/inochi-creator`

License:

- BSD 2-Clause

Useful source areas:

```text
inochi2d:
  source/inochi2d/core/mesh.d
  source/inochi2d/core/math/deform.d
  source/inochi2d/nodes/deformer/latticedeformer.d
  source/inochi2d/nodes/deformer/meshdeformer.d

inochi-creator:
  source/creator/viewport/common/automesh/grid.d
  source/creator/viewport/common/mesh.d
  source/creator/viewport/common/mesheditor/tools/point.d
  source/creator/viewport/model/deform.d
```

### ARAP Reference

Repository:

- `zhangzhensong/arap`

Purpose:

- Educational reference for 2D As-Rigid-As-Possible deformation

Notes:

- Implements only part of the original SIGGRAPH 2005 algorithm
- Repository does not clearly declare a license
- Study the algorithm, but avoid copying code directly

---

## 15. MVP Acceptance Criteria

The first milestone is intentionally small.

### Milestone 1

A user can:

1. load one transparent PNG part
2. generate a grid mesh
3. see the texture rendered through the mesh
4. select a vertex
5. drag the vertex
6. see the image deform in real time
7. see no visible triangle seams

Success condition:

> A front-hair PNG can be deformed cleanly by dragging mesh vertices.

### Milestone 2

Add:

- keyframe A
- keyframe B
- interpolation
- short preview playback

Success condition:

> The front hair can smoothly sway over a short silent clip.

### Milestone 3

Add:

- multiple parts
- layer order
- project save/load
- PNG sequence export

Only after these milestones should MCP and external bridges become implementation priorities.

---

## 16. Guiding Principle

FLAMORIS Avatar should remain a **short-form 2D animation engine**, not grow into a full Live2D replacement.

The core loop should remain:

```text
Photoshop Parts
    ↓
Mesh
    ↓
Deform
    ↓
Keyframes
    ↓
Short Clip
    ↓
After Effects / Blender / Video Pipeline
```

Keep the engine small enough that AI automation and MCP can become first-class features later.
