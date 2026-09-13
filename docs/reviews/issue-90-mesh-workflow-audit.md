# Issue #90 — Mesh workflow integration audit

Status: implementation audit against current `main` (`07fb44a`)

## Authorities compared

This audit compares Issue #39, PRs #36/#40/#42/#44, Issues #58/#81/#88,
ADR 0003, and the current Product runtime. The Phase 3 `MeshTopology`,
`MeshKeyform`, stable vertex ID, Command/Transaction, and persistence
contracts remain present. The observed failures are at the production
workflow/context boundary.

## Findings

| Finding | Classification | Root cause / disposition |
| --- | --- | --- |
| Topology appears empty | workflow/UI projection regression + legacy UI leakage | Mesh workflow selected the low-level topology mode without establishing the Phase 3 endpoint/key-state context. The fallback legacy grid was then hidden by the non-mesh renderer gate, while production topology tools had no selected `MeshTopology`. |
| Technical `トポロジー` / `頂点位置` labels | workflow/UI projection regression | Issue #88 translated low-level concepts instead of presenting the mesh task. Use task labels and guidance. |
| Grid regeneration becomes visible only after mode change | legacy UI leakage | `createMesh()` rebuilt only transient `state.mesh`; PSD part selection and the grid controls did not create/update ordinary `MeshTopology` / `MeshKeyform` state. Overlay visibility was also coupled to editor mode. |
| Vertex drag not undone/redone | implementation bug caused by legacy UI leakage | In a real endpoint context pointer-up already calls `MeshToolController -> mesh_keyform.move_vertices`. Outside that context the same gesture mutates only `state.mesh.vertexOffsets`, so no history entry is created and Undo reaches the earlier visibility command. |
| Sequence Timeline remains visible | workflow/UI projection regression | Workflow projection sets `hidden`, but the later `.sequence-timeline-panel[open] { display:grid }` CSS rule wins the cascade. |
| Yellow mesh is hard to read | original specification gap | Phase 3 required an overlay and stable-ID display but did not specify a contrast treatment. Keep it transient and use a dual-stroke/high-contrast overlay with selected handles. |
| Part visibility control resembles selection | workflow/UI projection regression | `◉/○` is visually checkbox/radio-like. Use a familiar eye/hidden icon, an explicit accessible label, and keep row click as selection. |
| Large open action dominates loaded source | workflow/UI projection regression | The same primary import treatment remains in the populated Asset step. Reduce it to a secondary replace/open action after content exists. |
| Save/Open retains mesh | specification-compliant evidence | Existing serialization preserves production topology/keyform identity. Add coverage through the repaired grid bridge. |

## One mesh authority

The production Mesh workflow must not expose writable legacy mesh state.
The grid generator may remain as a geometry generator, but its Apply path must
create or replace ordinary `MeshTopology` and `MeshKeyform` objects through one
`EditorSession` transaction/command. `state.mesh`, `baseVertices`, and
`vertexOffsets` remain a transient renderer/gesture buffer materialized from
the selected persistent keyform; they are not an authoring authority.

A PSD import already creates a Key Art. Mesh preparation can therefore use the
existing SemanticSlot mapping plus `MeshTopology` / `MeshKeyform` model for the
selected Key Art part without requiring a Transition to be authored first.
No new persistent mesh concept is required.

## Layout versus deformation specification question

Issue #39 and PR #40 named active `MeshKeyform.positions` editing “Deform
Mode”. ADR 0003 later clarified that this operation is Key Art mesh layout
(`位置決め`), while animation deformation is additional state and must not
rewrite the layout. Current Product already has later deformation/form sample
domains, so Issue #90 must not add another persistent base-vertex model.

For this repair the production-facing Mesh labels are `構造を編集` and
`頂点を配置`; the internal compatibility mode and command remain unchanged.
A follow-up should reconcile the internal `DEFORM` name/API with ADR 0003 and
expose actual animation deformation authoring in its proper Rig/Motion context.

## Retained compliant behavior

- topology Add/Remove/Create Triangle/Subdivide and semantic labels already use
  ordinary commands and preserve stable IDs;
- endpoint keyform drag already commits one `mesh_keyform.move_vertices`
  command when a valid Phase 3 context exists;
- Undo/Redo, topology snapshots, validation, Query/MCP projections, and
  Save/Open contracts remain authoritative;
- selection, active tool, overlay visibility, and gesture previews remain
  transient.

## Manual packaged-Windows acceptance

1. Open a PSD and select a visible render part.
2. Enter `メッシュ`; confirm the next step and grid creation action are clear.
3. Create a grid and confirm it is immediately visible in both local mesh tools.
4. In `構造を編集`, verify Add/Remove/Create Triangle/Subdivide affordances.
5. In `頂点を配置`, drag one vertex; Ctrl+Z and Ctrl+Y must restore exact states.
6. Confirm an earlier visibility edit is not reached before the vertex move.
7. Save, close, and reopen; verify topology IDs, connectivity, and positions.
8. Confirm Sequence Timeline is absent from Mesh and the overlay is legible on
   light and dark artwork.
