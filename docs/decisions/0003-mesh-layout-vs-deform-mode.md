# ADR 0003 — Separate Mesh Layout mode from Deform mode

Status: proposed

## Context

FLAMORIS 2D needs two different kinds of vertex editing that look superficially similar in the viewport but mean very different things in project data.

1. The user needs to decide where the mesh vertices belong on the artwork itself.
2. The user then needs to deform that authored mesh to create poses, forms, and animation.

If both actions write to the same vertex state, it becomes unclear whether an edit changes the authored Key Art correspondence or the animation. Undo, save/load, Key Art morphing, topology refinement, and MCP automation all become ambiguous.

## Decision

Vertex editing is divided into two explicit semantic modes.

## 1. Mesh Layout mode (位置決めモード)

Purpose:

> Define the mesh topology and the neutral/keyform placement of stable vertices on the active Key Art artwork.

For Key Art A and B, this means the same stable topology may have different authored positions and UVs:

```text
Shared MeshTopology
├── stableVertexIds[]
└── indices[]

Keyform A
├── layoutPositions[]
└── uvs[]

Keyform B
├── alignmentTransform
├── layoutPositions[]
└── uvs[]
```

Allowed operations include:

- move layout vertex
- move multiple layout vertices
- proportional layout edit
- split edge
- subdivide face/region
- add/remove/dissolve/connect topology where compatibility rules permit
- edit UV/keyform correspondence
- reset vertex to interpolated/default layout position

Topology-changing commands are available only in Layout mode.

### B-side authoring order

For a second Key Art:

```text
show Key Art B
  -> transform/align the whole mesh
  -> enter Mesh Layout mode
  -> move coarse vertices to fit B
  -> subdivide only where more detail is needed
  -> refine new vertices
```

The whole-mesh alignment transform is not itself a vertex deformation. It is an authoring transform used before/during target keyform fitting.

## 2. Deform mode (変形モード)

Purpose:

> Pose or animate a mesh whose topology and authored Key Art placement are already defined.

Deform mode writes deformation/form/animation state relative to the current evaluated base/keyform.

Conceptually:

```text
active Key Art layout/keyform
  -> rig deformation
  -> authored Deform offsets / form state
  -> animation interpolation
  -> render
```

Allowed operations include:

- move deformation vertex/vertices
- proportional deformation
- create/update a form/shape state
- write mesh deformation keyframe data
- correction after bone/deformer pose
- reset selected deformation to zero/base

Not allowed in Deform mode:

- add/remove vertices
- split/subdivide/dissolve topology
- silently rewrite the Key Art layout positions
- change stable vertex identity

## 3. Data separation

Do not store both concepts in one mutable `vertices[]` position array.

Suggested model:

```text
MeshTopology
  stableVertexIds
  indices

MeshKeyform[keyArtId]
  alignmentTransform
  layoutPositions
  uvs

MeshDeformation[state/clip/keyframe]
  vertexOffsets or equivalent form representation
```

A rendered/evaluated vertex is derived from these layers. The exact evaluation order is defined/tested elsewhere.

## 4. Topology refinement propagation

When topology changes in Layout mode, every compatible Key Art keyform must receive the new stable vertex using deterministic interpolation as defined by ADR 0002.

Any existing deformation/form state that references the shared topology must also be updated safely.

Initial rule:

- edge split: initialize new deformation offset by interpolating endpoint offsets;
- triangle insertion: initialize with the same barycentric weights used for layout/keyform propagation.

Therefore subdivision should not visually change an existing pose/transition at the instant it is applied.

If a topology operation cannot preserve authored states safely, validation must reject it or require an explicit destructive/bake operation.

## 5. UI

The current editing mode must always be visible.

Suggested top-level interaction:

```text
[Transform] [Mesh Layout] [Deform] [Bone Edit] [Pose] ...
```

For vertices specifically:

- Mesh Layout: neutral/correspondence vertex color/style
- Deform: deformation vertex color/style
- mode switch changes Inspector/tool options
- topology tools disappear/disable in Deform mode

A user should never have to infer from timeline position whether they are editing layout or deformation.

## 6. Key Art transition implication

For A→B morphing:

- Layout mode defines where shared stable vertices live on A and B.
- The A/B transition interpolates those authored Key Art keyforms.
- Deform mode is additional pose/animation applied without destroying the A/B correspondence.

This keeps the statement "where did this point go between the two drawings?" separate from "how do I animate this point now?".

## 7. MCP / Command implication

Use different commands. Do not overload a generic `move_vertex` mutation.

Examples:

```text
mesh.layout.move_vertices
mesh.topology.split_edge
mesh.topology.subdivide_faces
mesh.keyart.set_alignment

mesh.deform.move_vertices
mesh.deform.reset_vertices
mesh.form.set_state
```

Queries should also expose which state is being inspected.

AI must specify the intended mode explicitly so a correspondence task cannot accidentally write animation deformation and an animation task cannot rewrite Key Art layout.

## 8. Undo/Redo implication

Layout and Deform actions create different history entries, for example:

```text
Layout: move 4 vertices on Key Art B
Topology: subdivide 2 faces
Deform: move 8 vertices at 1.20s
```

Topology operations remain atomic transactions because they may update multiple Key Arts and deformation states at once.

## 9. Acceptance criteria

1. Create/choose a mesh on Key Art A.
2. In Mesh Layout mode, move a vertex and verify the A keyform changes but no animation deformation is created.
3. Switch to Key Art B, align the whole mesh, then move B layout vertices without changing A.
4. Subdivide in Layout mode and verify all compatible keyforms/states gain stable interpolated vertices without visual discontinuity.
5. Switch to Deform mode and move a vertex; verify layout/keyform data remains unchanged.
6. Attempt topology change in Deform mode and verify the editor refuses/disables it.
7. Undo/redo Layout, Topology, and Deform operations independently.
8. Execute equivalent Layout and Deform edits through separate headless commands.