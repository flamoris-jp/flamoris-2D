# FLAMORIS 2D

FLAMORIS 2D is a PSD-native, Key-Art-transition and clip-first 2D rigging/animation editor for short MV shots.

## Phase 0 baseline

Phase 0 integrates the runnable v0.3 prototype with the reviewed design/operation baseline.

Current runnable capability:

- direct layered PSD import with `ag-psd`
- reconstruction using PSD document coordinates and stacking order
- per-part Grid Mesh generation/editing
- A/B deformation keyframes and silent preview
- viewport zoom/pan and selected-part fit
- 12 deterministic Node tests

The product direction is broader than the current prototype. Multi-Key-Art A→B→C transitions, Mesh Layout vs Deform separation, Group/Tree, clipping, deformers, bones, timeline clips, persistence, and MCP-ready commands are specified in `docs/` and implemented in later phases.

## Run

From the repository root after Phase 0 integration:

```powershell
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173`.

## Repository boundaries

```text
product/   current editor/runtime implementation
staging/   manual/visual acceptance setup and non-production fixtures
test/      integration/system/staging checks outside Product runtime
history/   superseded prototypes and historical material
docs/      current design, research, ADRs
```

Product must not depend on Staging, integration-test helpers, History, or private acceptance artwork. Production artifacts use an explicit allowlist or equivalent build boundary.

See `AGENTS.md` and `docs/repository-boundaries.md`.

## Core design decisions

- PSD is a first-class source format.
- Multiple Key Arts are first-class project states.
- Shared mesh topology can have different per-Key-Art layout/keyforms.
- Mesh Layout (位置決め) and Deform (変形) are separate semantic modes.
- Key Art B can align/transform the whole shared mesh before vertex refinement.
- Coarse meshes can be subdivided later without breaking existing A/B keyforms.
- UI, tests, scripts, and MCP share one deterministic Command/Transaction core.
- AI proposes; deterministic commands commit.

## Current authority

After the Phase 0 integration PR is merged, `main` is the current implementation and design baseline.

The exact uploaded v0.3 snapshot remains preserved on `prototype/psd-import-zoom-pan-v0.3` for history/reference. It is not the branch for continuing Product development.

Current design index: `docs/README.md`.
Current roadmap: `docs/roadmap.md`.
Phase 0 review: `docs/reviews/phase0-review-20260830.md`.

## Next phase

Phase 1 is Editor Core + MCP-ready architecture:

- versioned Project model and stable IDs
- headless query/command core
- transactions and Undo/Redo
- save/load and autosave/recovery
- hierarchical Scene Tree and Group transforms
- Inspector, selection, Pivot/Gizmo
- PSD re-import reconciliation
- typed MCP-facing schemas

Do not bypass these foundations to add later rig features directly to the v0.3 monolithic UI state.
