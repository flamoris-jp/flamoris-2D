# FLAMORIS 2D Phase 3-3 Contour AutoMesh

Status: Phase 3-3 implementation contract

Issue #39 remains the Phase 3 authority. This phase adds a production-oriented,
sparse contour generator without introducing a second persistent mesh model.
Its applied result is an ordinary `MeshTopology` plus the existing related
`MeshKeyform` objects.

## Pipeline and coordinate contract

`ContourAutoMeshGenerator` is a pure, DOM-free geometry pipeline:

```text
RGBA alpha -> binary mask -> outer pixel-edge contour
  -> deterministic simplification -> corner retention / edge resampling
  -> sparse interior candidates -> constrained ear-clipping triangulation
  -> positions / UVs -> candidate diagnostics
```

The alpha threshold is converted deterministically to an integer byte value.
At threshold 0, every non-zero alpha is visible while alpha 0 remains fully
transparent; zero never turns a transparent canvas into a visible rectangle.
Four-connected visible components are counted before contour tracing. The
initial implementation accepts one outer contour and reports reason-specific
diagnostics for no alpha, tiny contours, disconnected visible regions, and
holes. Those inputs are never silently converted to a grid.

Contour edges are traced on the pixel boundary, normalized to one winding, and
rotated to a deterministic lexicographic start. Ramer-Douglas-Peucker-style
simplification removes pixel noise. Turn angle marks retained corners, and a
density-derived maximum edge length adds boundary support without changing
corner identity. Interior support uses a deterministic coarse grid filtered by
point-in-polygon and distance-to-boundary tests. No random sampling is used.

The boundary polygon is triangulated by deterministic ear clipping. Interior
points split the first containing triangle only when all resulting faces pass
the topology near-area threshold. Faces use one winding and the generator
emits no repeated references or duplicate faces.

Generated positions use the selected artwork's existing local coordinate
contract; viewport zoom, pan, and screen size are not inputs. UVs derive only
from the part-local bounds:

```text
u = (x - left) / width
v = (y - top) / height
```

## Settings and determinism

The transient settings are `alphaThreshold`, `density`, `cornerSensitivity`,
and `interiorDensity`, each normalized to 0..1. Given the same RGBA bytes,
bounds, and normalized settings, contour order, retained/sampled vertices,
interior vertices, temporary candidate IDs, UVs, and triangle indices are
identical.

The grid/matrix generator remains unchanged for rectangle-like artwork,
fallback, regression, and debugging. Choosing Grid is explicit; Contour does
not silently fall back to it.

## Preview and Apply

`AutoMeshPreviewController` owns only transient settings, candidate geometry,
counts, and diagnostics. Preview reads PSD render alpha and draws candidate
contour-derived triangles and vertex kinds in the viewport. It does not touch
Project state, dirty state, or history.

Apply is registered as the Topology Edit tool `topology.automesh`. Candidate
identities are local until Apply. At Apply, the controller allocates fresh
`vtx_NNNN` IDs after the Project-global live maximum and the topology's
monotonic allocation cursor.

For an existing topology, `mesh_topology.apply_generated_mesh` requires
`replaceExisting: true`. Without it, the command rejects with
`AUTOMESH_DESTRUCTIVE_REPLACEMENT_REQUIRED` and reports affected keyforms. The
command replaces topology connectivity, clears topology-owned labels whose
vertices no longer exist, initializes every attached keyform to the same
generated positions/UVs, and advances (never rewinds) the allocation cursor.

For an endpoint with no topology, the existing
`EndpointMeshController.createSharedTopologyAndKeyforms` transaction creates
the topology, A/B keyforms, and Morph references atomically. No AutoMesh-only
persistent object or settings record is created.

## Restoration, persistence, and headless boundary

Existing-topology Apply captures the Phase 3-1 topology/keyform snapshot as its
inverse. Undo restores the exact prior topology, IDs, metadata, cursor,
connectivity, positions, and UVs. Redo replays the same payload, restoring the
same generated IDs rather than issuing new ones. New-topology creation already
uses the existing multi-command semantic transaction and has the same one-step
Undo/Redo behavior.

Save/Open requires no Project schema migration: only ordinary topology and
keyform data are serialized. Preview settings, candidate IDs, diagnostics,
hover, and overlay state are absent. The MCP schema is version 6 because the
atomic generated-mesh command is available through the existing headless
command adapter; geometry generation and its controller remain DOM-independent.

Phase 3-4 correspondence pins/solve, deformation brushes, advanced editing,
AI/optical-flow generation, timeline expansion, and export remain out of scope.
