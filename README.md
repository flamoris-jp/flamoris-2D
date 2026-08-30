# FLAMORIS 2D

FLAMORIS 2D is a PSD-native 2D rigging and animation editor for producing short expressive character shots for music-video work.

The current design is not limited to deforming a single illustration. The core workflow treats authored Key Arts, especially a start image and an end image, as first-class states that can be connected by editable mesh/texture transitions.

```text
PSD Key Art A
  -> Rig / Mesh Layout / Semantic Mapping
  -> Editable A→B Transition
  -> PSD Key Art B
  -> optional B→C→D transitions
  -> Short MV Clip
  -> PNG/WebM/Bridge
  -> After Effects / Blender / Editing Pipeline
```

Product identity:

> A PSD-native, Key-Art-transition and clip-first 2D rigging editor optimized for short MV shots.

## Current status

The latest preserved runnable prototype is `v0.3` on:

```text
prototype/psd-import-zoom-pan-v0.3
```

It includes:

- direct PSD import via `ag-psd`
- PSD hierarchy/position reconstruction
- per-part Grid Mesh editing
- A/B deformation keyframes and preview
- viewport zoom/pan and selected-part fit
- deterministic Node tests

That prototype is a preserved implementation snapshot, not the final repository architecture.

The current proposed architecture/design is reviewed in Draft PR #2 on:

```text
docs/basic-design-v0
```

## Core design principles

- PSD is a first-class source format.
- Multiple Key Arts are first-class project data.
- Mesh topology, per-Key-Art layout/keyforms, rig state, and animation deformation are non-destructive separate layers.
- Mesh Layout (位置決め) and Deform (変形) are separate editing modes.
- Stable IDs are independent from user-editable Japanese/Unicode display names.
- Groups are real transform/animation hierarchy nodes.
- UI, scripts, tests, AI, and MCP share one headless Command/Transaction model.
- AI proposes; deterministic commands commit.
- The editor must remain usable without cloud/AI services.

## Repository boundaries

FLAMORIS 2D adopts explicit repository responsibility boundaries inspired by the successful reconstruction discipline used by FLAMORIS George:

```text
product/   current production-capable editor/runtime source
staging/   manual/visual acceptance setup and non-production fixtures
test/      integration/system/staging checks outside Product runtime
history/   superseded prototypes and historical material
docs/      current design/research/ADRs
```

Rules:

- Product runtime must not depend on Staging, integration-test helpers, History, or handoff-only assets.
- Staging may depend on Product; Product must never depend on Staging.
- Production artifacts must use an explicit allowlist or equally explicit build-input boundary.
- Historical/prototype material does not become current execution authority automatically.
- CI is added at meaningful milestones to protect stable behavior/boundaries, not as a growing development orchestration framework.
- Expensive visual/browser/release checks remain explicit until automation has a clear reason.

See:

- [`AGENTS.md`](AGENTS.md)
- [`docs/repository-boundaries.md`](docs/repository-boundaries.md)

## Mesh authoring modes

### Mesh Layout / 位置決め

Defines topology and where stable vertices belong on the active Key Art artwork.

```text
Key Art A: layoutPositions A
Key Art B: alignment + layoutPositions B
```

Topology editing such as split/subdivide belongs here.

### Deform / 変形

Poses or animates an already-authored mesh without changing its topology or Key Art correspondence.

```text
Key Art layout/keyform
  -> rig
  -> deformation/form/keyframe
  -> render
```

See ADR:

- [`docs/decisions/0003-mesh-layout-vs-deform-mode.md`](docs/decisions/0003-mesh-layout-vs-deform-mode.md)

## Documentation

Start with [`docs/README.md`](docs/README.md).

Current design set includes:

- `docs/basic-design.md`
- `docs/key-art-transition.md`
- `docs/mcp-design.md`
- `docs/feature-matrix.md`
- `docs/roadmap.md`
- `docs/repository-boundaries.md`
- `docs/decisions/*`

## GitHub workflow

GitHub is the durable project memory.

```text
main          reviewed stable state
feature/*     implementation work
docs/*        design/research/ADR work
prototype/*   preserved runnable snapshots, not current Product authority
```

For meaningful changes:

1. define requirement/acceptance criteria,
2. update design or ADR when architecture/persistent semantics change,
3. implement the smallest understandable Product change,
4. run the smallest relevant deterministic tests,
5. review via PR,
6. merge only after required acceptance/checks pass,
7. tag meaningful milestones where useful.

Do not leave the latest working implementation only in chat attachments, Downloads, or local ZIPs.

## First production goal

A user should be able to import two or more layered character Key Arts, map corresponding parts, author/edit a shared mesh from coarse to fine, connect the drawings with deterministic editable transitions, animate rig controls/clips, save/reopen safely, and export a transparent short shot for downstream MV production.