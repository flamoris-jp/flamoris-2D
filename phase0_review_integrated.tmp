# Phase 0 Integration Review — 2026-08-30

Status: reviewed baseline for integration

## Scope reviewed

This review covers:

- exact uploaded v0.3 prototype preserved on `prototype/psd-import-zoom-pan-v0.3` / PR #3
- design and roadmap work on `docs/basic-design-v0` / PR #2
- repository boundary/testing/CI precedent from `flamoris-net/flamoris-george`
- new requirements discussed during prototype use: multi-Key-Art transitions, coarse-to-fine shared meshes, Mesh Layout vs Deform modes, and MCP-first command architecture

## Verification performed

The uploaded `flamoris-2D-psd-import-zoom-pan(1).zip` was extracted and its Node test suite was rerun independently.

Result:

```text
tests 12
pass 12
fail 0
```

The product-boundary workspace restructuring was also tested locally with the same 12 tests passing from the repository-root `npm test` wrapper.

## What v0.3 proves

The prototype successfully proves these technical assumptions:

1. A layered PSD can be parsed directly in the browser using `ag-psd`.
2. Leaf layer image data can be reconstructed at original PSD document coordinates and stacking order.
3. A selected PSD part can be used as a texture for an indexed WebGL2 Grid Mesh.
4. Mesh base vertices remain separate from deformation offsets.
5. A/B deformation offset snapshots can be interpolated and previewed deterministically.
6. Document/image/screen coordinate transforms support zoom, pan, whole-document fit, and selected-part fit.
7. The current architecture is small enough to refactor into a proper Product core before larger rigging features are added.

## Important prototype limitations

These are accepted as prototype limitations, not silently treated as completed Product features.

### PSD model

- `collectPsdParts` flattens groups into leaf parts; Group nodes are not persistent Product objects yet.
- hidden PSD layers are filtered out by `visiblePsdParts`; a future importer must preserve hidden nodes and visibility state even when not rendered.
- source masks/clipping metadata may be collected, but current rendering does not implement general PSD masks/clipping/group effects.
- stable identity currently derives from layer path in prototype logic; Phase 1 requires real stable IDs independent from names/paths.

### Editing state

- only one selected part owns an active Mesh at a time; switching parts does not preserve multiple authored meshes.
- A/B keyframes are prototype-local deformation snapshots for one active Mesh.
- Project save/load, autosave/recovery, Undo/Redo, Scene Tree, Group transforms, Inspector, and PSD re-import reconciliation are not implemented.
- Mesh Layout and Deform are not yet separate runtime modes in v0.3; ADR 0003 defines the target separation.

### Rendering

- the selected part is rendered through WebGL while other PSD parts are composited through 2D canvases.
- full compositing fidelity for Photoshop group blend behavior, clipping, masks, and effects is not guaranteed.
- visual acceptance currently depends on manual inspection; there is no broad browser/GPU screenshot harness by design.

### Dependency/release discipline

- the original handoff used `ag-psd` with a caret range and no lockfile.
- Phase 0 integration pins the direct Product dependency to `ag-psd` 31.0.2 and establishes an explicit Product production-file allowlist.
- a repository lockfile is still desirable after a clean local `npm install` and should be committed once generated/verified in the normal development environment.

## Design decisions accepted as the working direction

### Multi-Key-Art is foundational

The Product is not limited to animating one illustration. Start/end drawings are first-class Key Arts connected by editable transitions, later generalized to A→B→C→D.

### Shared topology, per-Key-Art keyforms

Compatible parts share stable mesh topology while each Key Art stores its own layout positions/UVs.

### Coarse-to-fine mesh authoring

A transition can begin with a very small cage such as four vertices. Key Art B first receives whole-mesh translation/rotation/scale alignment; only then are individual layout vertices refined. Subdivision propagates deterministically to all compatible keyforms without changing the existing transition at the instant of refinement.

### Mesh Layout and Deform are separate

Layout answers “where does this stable point belong on this artwork?” Deform answers “how is this already-authored point posed/animated now?” Topology edits exist only in Layout mode.

### MCP readiness is a core constraint

UI, scripts, tests, and future MCP/AI share one headless Query/Command/Transaction layer. AI may suggest mappings/edits, but persistent state is ordinary deterministic Product data.

### Repository boundaries are architectural

Product, Staging, Test, History, and Docs have explicit responsibilities. Product cannot depend on Staging/Test/History. CI is a milestone regression boundary, not a development orchestration framework.

## Phase 0 integration structure

```text
flamoris-2D/
├── product/       v0.3 runnable implementation + deterministic local unit tests
├── staging/       manual/visual acceptance boundary
├── test/          future integration/system/staging tests
├── history/       historical-reference boundary
├── docs/          design/research/ADRs/reviews
├── AGENTS.md
├── README.md
└── package.json   thin npm workspace wrapper
```

The exact original uploaded prototype remains preserved on its prototype branch even though Product code is reorganized in the integrated baseline.

## Phase 1 entry criteria

Phase 1 should begin only from the integrated `main` baseline and should prioritize:

1. versioned Project model and stable IDs;
2. separation of persistent Product state from transient UI state;
3. headless queries, commands, transactions, validation, and Undo/Redo;
4. save/load and autosave/recovery;
5. Scene Tree, GroupNode transforms, selection, Inspector, Pivot/Gizmo;
6. PSD importer representation that preserves hierarchy and hidden nodes;
7. minimal PSD re-import reconciliation;
8. typed MCP-facing schemas that use the same Product commands.

Do not implement bones, advanced clipping, or AI auto-rig directly inside the current monolithic `app.js` state before this foundation exists.

## Overall assessment

Phase 0 is technically successful. The prototype validates the hardest early uncertainty, direct PSD-to-editable-part reconstruction, while the design work now gives the project a differentiated Product direction rather than a generic miniature Live2D clone.

The largest risk from this point is not missing rendering technology. It is allowing prototype UI state, tests, staging fixtures, and future AI automation to grow without clear domain/command boundaries. The Phase 0 integration specifically establishes those boundaries before feature growth resumes.
