# ADR 0009 — Author the existing mesh-animation identity through Commands

Status: implementation decision for Issue #96; included in PR review.

## Evidence and decision

Accepted Phase 8 already defines `MeshDeformationTrack.target.meshId` and
`MeshDeformationSample { id, meshId, topologyId, offsets }`. Its tests create
`project.meshes` identity records (`{ id }`) directly when constructing fixtures.
Production PSD/Cutwork imports leave that collection empty. There is no public
Command that registers the existing identity, so a new document cannot author
the reserved track through either UI or MCP.

Add `animation.mesh_target.create/remove` for **identity-only** records in the
existing collection. A native sample creation may register a fresh identity and
create the sample in one ordinary transaction. Existing projects and target IDs
remain valid. No schema version, evaluator order, time mapping, node mapping or
sample semantics change. The existing sample topology/stable-vertex checks decide
where offsets apply, exactly as in the accepted Phase 8 mixer.

The Command accepts only an ID. It cannot create base vertices, UVs, indices,
offsets or an alternate mesh geometry. Layout remains MeshTopology/MeshKeyform;
animation offsets remain MeshDeformationSample. Legacy geometry-bearing records
are preserved but cannot be removed by this identity-only command. Removing a
referenced identity is rejected by Product validation. Undo restores the original
collection position and IDs; UI and headless share EditorSession history.

## Rejected alternatives and validation

Do not write `project.meshes` from WPF/Host, fabricate a legacy writable mesh, or
reinterpret meshId as a node/slot/topology ID. Those would bypass Commands or change
the shipped evaluator contract. No new persistent domain entity is introduced.

Protect fresh-import sample/Clip authoring, headless reachability, exact Undo/Redo,
referenced-identity rejection, serialization and evaluated mesh offsets.
