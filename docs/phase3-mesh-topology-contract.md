# Phase 3-1 Mesh Identity and Topology Mutation Contract

Issue #39 is authoritative for Phase 3. This document fixes the Phase 3-1
contract at the existing `Project` / `Command` / `Transaction` / `Query`
boundaries. It does not introduce another mesh model or history stack.

## Persistent identity

- `MeshTopology.vertexIds[index]` maps a representation index to a stable
  vertex ID. The index may change when an earlier vertex is removed; the ID
  does not.
- A stable vertex ID is globally unique among live project topologies.
  `mesh_topology.create` rejects cross-topology reuse before mutation, and
  Project validation reports the same violation during import or migration.
- `MeshTopology.nextVertexSequence` is a monotonic persisted allocation cursor
  for generated `vtx_NNNN` IDs. Removing a vertex does not rewind it.
- `MeshTopology.vertexMetadata[vertexId].semanticLabel` is optional,
  topology-owned metadata. A non-empty label is unique within its topology and
  never replaces the stable ID.
- Project schema 3 migrates to schema 4 with empty `vertexMetadata` and a
  cursor derived from existing `vtx_NNNN` IDs. No existing ID is rewritten.

## Mode and tool boundary

- Deform Mode tools may select vertices and commit positions only to the active
  `MeshKeyform`. The controller rejects every Topology tool in this mode.
- Topology Edit Mode tools mutate the shared `MeshTopology`. The editor shows
  the complete set of affected keyforms before mutation.
- `MeshToolRegistry` owns tool-to-mode dispatch. Future tools register one
  descriptor and execution function instead of adding application-wide mode
  branches.
- Mode, active tool, selection, hover, overlay visibility, and drag preview are
  transient workspace state. A committed drag is one ordinary command.

## Atomic mutations

All public mutations enter `EditorSession` as commands and are validated in the
same transaction as their resulting project state.

### Add Vertex

The caller supplies a newly allocated stable ID, one finite position, and one
finite UV. The command appends the ID without changing existing IDs and appends
the supplied position and UV to every keyform that references the topology.
This explicit same-value initialization is deterministic across all keyforms.

### Remove Vertex

The command removes the stable ID, its optional metadata, every incident
triangle, and the corresponding position/UV pair from every affected keyform.
Surviving IDs are never renumbered. Representation indices above the removed
entry shift only so indexed triangles remain valid. Removal is rejected when it
would leave fewer than three vertices or remove every triangle.

### Create Triangle

Three distinct stable IDs are resolved to current representation indices at
command execution. Missing references, duplicate faces, repeated vertices, and
zero-area or near-degenerate geometry in any affected keyform are rejected.

### Subdivide Edge

Two stable IDs must describe an existing edge. One new stable ID is appended.
Every triangle incident to the edge is split into two with winding preserved.
For every affected keyform:

```text
positionN = (positionA + positionB) / 2
uvN       = (uvA + uvB) / 2
```

## Restoration and validation

Topology mutations capture the topology plus every affected keyform in one
inverse snapshot. Undo restores the exact IDs, allocation cursor, connectivity,
positions, UVs, and metadata; Redo restores the exact post-mutation state.
Serialization preserves the same state across Save/Open.

Validation reports reason-specific diagnostics for duplicate IDs or labels,
missing metadata/triangle references, repeated triangle vertices, invalid or
near-degenerate triangles, and position/UV count mismatches. Validation never
repairs, reorders, or reassigns identity. Generic whole-topology replacement is
rejected when keyforms exist; callers must use the atomic mutation commands.

## Query boundary

`mesh.get_topology` and `mesh.list_topologies` expose stable IDs, semantic
labels, representation indices, the next generated ID, and connectivity.
`mesh.get_vertex` returns one stable-ID projection. These queries and all mesh
commands are DOM-independent and are available through the headless adapter.
