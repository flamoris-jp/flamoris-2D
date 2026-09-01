# FLAMORIS 2D

FLAMORIS 2D is a PSD-native, Key-Art-transition and clip-first 2D rigging/animation editor for short MV shots.

## Phase 1 editor foundation

Phase 1 connects the PSD prototype to a persistent, undoable Editor Core shared
by the Windows Desktop shell, browser UI, and minimal headless/MCP-facing
adapter. Windows Desktop is the production target; the browser shell remains a
development-compatible adapter.

Current runnable capability:

- direct layered PSD import with `ag-psd`
- reconstruction using PSD document coordinates and stacking order
- per-part Grid Mesh generation/editing
- A/B deformation keyframes and silent preview
- viewport zoom/pan and selected-part fit
- `.fl2d` project open/save, Save As, Incremental Save, and Save Copy
- dirty/save-point tracking and unsaved-change guards
- separate Preferences and bounded Recovery snapshots
- reviewed/manual PSD re-import applied as one Undo step
- deterministic headless Query/Command smoke coverage
- native Windows Open/Save dialogs, close handling, Recent Files, Recovery
  storage, window title, and `.fl2d` file association

Multi-Key-Art A→B→C transitions, clipping, deformers, bones, and the production
timeline remain later phases.

## Run Windows Desktop

```powershell
npm install
npm test
npm run desktop
```

Create an unpacked Windows app with `npm run desktop:pack`, or an NSIS installer
with `npm run desktop:dist`.

## Run browser shell

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

`main` is the reviewed current implementation and design baseline.

The exact uploaded v0.3 snapshot remains preserved on `prototype/psd-import-zoom-pan-v0.3` for history/reference. It is not the branch for continuing Product development.

Current design index: `docs/README.md`.
Current roadmap: `docs/roadmap.md`.
Phase 0 review: `docs/reviews/phase0-review-20260830.md`.

Phase 2 begins only after the Phase 1 manual Akino acceptance pass is complete.
Do not bypass these foundations to add later rig features directly to prototype
UI state.
