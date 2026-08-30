# ADR 0002 — Coarse-to-fine shared mesh authoring for Key Art transitions

Status: proposed

## Context

FLAMORIS 2D treats a transition between two authored Key Arts as a first-class workflow. A mesh created on Key Art A must be reusable and editable over Key Art B.

Starting with a dense mesh makes large pose alignment unnecessarily difficult. The user should be able to establish the broad relationship between A and B with very few control vertices, then add detail only where the artwork requires it.

The target workflow should feel closer to Blender modeling than to placing every correspondence point in advance.

## Decision

### 1. Start coarse

A Key Art transition mesh may begin with a minimal topology, commonly a quad with four corner vertices or another small user-defined cage.

Example:

```text
v0 -------- v1
|            |
|            |
v3 -------- v2
```

The user first solves large translation, rotation, scale, and silhouette changes with this coarse topology.

### 2. B-side whole-mesh alignment happens before detailed vertex editing

When switching from Key Art A to Key Art B, the same topology is displayed over B.

The B keyform has an alignment transform separate from the per-vertex positions:

```text
MeshKeyform B
├── alignmentTransform
│   ├── position
│   ├── rotation
│   └── scale
└── vertexPositions[]
```

Authoring order:

```text
show B artwork
  -> drag the whole mesh into place
  -> rotate / scale if needed
  -> edit individual B vertices
  -> refine topology only where necessary
```

This avoids moving dozens of vertices merely to account for a global pose/location difference.

The alignment transform is editable and undoable. A command may later bake it into vertex positions when useful, but the authored representation should preserve the distinction while editing.

### 3. Topology refinement is shared across Key Arts

Subdivide/add-vertex operations modify `MeshTopology`, not just one Key Art.

```text
MeshTopology
├── stableVertexIds[]
└── indices[]

MeshKeyform A -> positions for every stable vertex
MeshKeyform B -> positions for every stable vertex
MeshKeyform C -> positions for every stable vertex
```

If an edge or face is subdivided after A and B keyforms already exist, every keyform receives positions for the newly created stable vertices.

### 4. New vertex positions are initialized by interpolation

Topology refinement must not destroy an existing transition.

When a new vertex is inserted into an existing edge/triangle, its position and UV are initialized independently for every Key Art using the same local interpolation coordinates.

Examples:

#### Edge split

For an edge `(v0, v1)` split at fraction `s`:

```text
newPosition[keyArt] = lerp(position0[keyArt], position1[keyArt], s)
newUV[keyArt]       = lerp(uv0[keyArt],       uv1[keyArt],       s)
```

#### Triangle insertion

For a vertex inserted with barycentric weights `(a, b, c)`:

```text
newPosition[keyArt] = a*p0 + b*p1 + c*p2
newUV[keyArt]       = a*uv0 + b*uv1 + c*uv2
```

Therefore a coarse A-to-B morph remains visually equivalent immediately after subdivision. The user then adjusts the new vertices only where additional detail is required.

### 5. Refinement levels are authoring history, not separate incompatible meshes

The intended mental model is:

```text
4 vertices
  -> refine
9 vertices
  -> refine local region
14 vertices
  -> ...
```

not:

```text
Mesh A version 1
Mesh A version 2
Mesh B unrelated mesh
```

All Key Arts participating in a compatible morph continue to share one topology identity.

### 6. Suggested editor tools

Initial tools:

- Move whole mesh
- Rotate whole mesh
- Scale whole mesh
- Move vertex
- Split edge
- Subdivide selected face(s)
- Add vertex in triangle
- Undo subdivision

Later tools:

- loop-style subdivision where topology permits
- local grid refinement
- dissolve vertex/edge while preserving keyforms
- proportional editing
- automatic refinement suggestion based on A/B residual error

### 7. AI / MCP implications

AI should operate on the same coarse-to-fine representation.

Useful MCP operations include:

```text
transition.set_alignment
mesh.split_edge
mesh.subdivide_faces
mesh.move_vertices
transition.suggest_refinement
transition.solve_keyform_from_anchors
```

An AI can first align the whole mesh, then propose only the few regions that need more topology. This is preferable to generating a dense opaque correspondence field that is difficult for a human to correct.

All operations must use the normal Command/Transaction layer and remain undoable.

## Consequences

### Benefits

- large pose changes are easy to establish with only a few points,
- the transition remains understandable to a human,
- detail can be added only where necessary,
- refinement does not invalidate existing A/B/C keyforms,
- AI correspondence can work progressively rather than solving everything at once,
- the workflow naturally extends from two Key Arts to multiple Key Arts.

### Costs

- topology-edit commands must update every compatible keyform,
- stable vertex IDs become mandatory,
- subdivision must preserve UV/keyform interpolation deterministically,
- deleting/dissolving topology requires validation because authored detail may exist in other Key Arts.

## Acceptance example

1. Import Key Art A and B.
2. Create a four-vertex mesh over a part in A.
3. Switch to B.
4. Drag/rotate/scale the entire mesh over the B artwork.
5. Move the four B vertices to establish the broad destination shape.
6. Subdivide one region.
7. Confirm the new vertices appear in both A and B without changing the transition before manual adjustment.
8. Adjust only the newly added B vertices for detail.
9. Scrub A-to-B and preserve a continuous editable morph.
