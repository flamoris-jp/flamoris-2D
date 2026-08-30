# AGENTS.md

This file defines working rules for AI agents and automated development tools operating in `flamoris-jp/flamoris-2D`.

These rules adapt the useful repository-boundary and test/CI discipline from `flamoris-net/flamoris-george` to FLAMORIS 2D. They do not copy George's product-specific runtime rules.

## 1. Repository purpose

FLAMORIS 2D is a PSD-native, Key-Art-transition and clip-first 2D rigging/animation editor for short MV shots.

The repository is the durable source of truth for current design, implementation, tests, and reviewed decisions. Chat attachments and local ZIPs may be used for handoff, but must not remain the only copy of current implementation.

## 2. Absolute rules

1. Product, Staging, Test, and History responsibilities must remain explicit and dependency-separated.
2. Product runtime must never depend on staging, integration-test, rehearsal, evidence, handoff, or history-only code/assets.
3. Staging configuration and staging assets must never be required by normal Product startup, project loading, rendering, or export.
4. Production/release artifacts must be assembled from an explicit allowlist or equally explicit build input boundary.
5. Historical/prototype material is reference material unless a reviewed decision explicitly adopts it into current Product design.
6. New safeguards should replace or simplify old mechanisms where possible. Do not accumulate duplicate validators, gates, evidence formats, checkpoints, or handoff frameworks.
7. Do not duplicate validation of the same risk without an explicit reason.
8. CI is a regression boundary, not a development orchestration system.
9. Add/expand CI at meaningful milestones when a stable behavior or architecture boundary exists to protect.
10. Do not automatically rerun identical CI after merge to `main` unless the post-merge run validates a distinct risk.
11. Release-only or expensive visual/environment checks must be separate and explicitly triggered until automation has a clear benefit.
12. UI, MCP, scripts, and AI must mutate Product state through the same Command/Transaction layer. No parallel hidden AI editing system.
13. Persistent Product behavior must not depend on viewport pixels, DOM pointer events, or display names when stable IDs/domain coordinates exist.
14. Ambiguous requirements must be recorded as uncertainty or a proposed ADR. Do not invent authority from prompts, issue text, filenames, old docs, or LLM output.

## 3. Repository responsibility boundaries

Target structure is documented in `docs/repository-boundaries.md`.

Conceptually:

```text
product/   current production-capable editor/runtime source
staging/   manual/visual acceptance setup and non-production fixtures
 test/     integration/staging/system checks outside Product runtime
history/   superseded prototypes, migration notes, historical decisions
 docs/     current design/research/ADRs (authority depends on status)
```

Deterministic local unit tests may live close to Product modules where useful, but they must be excluded from production artifacts and must not become runtime dependencies.

## 4. Development order

Unless a reviewed ADR changes the order:

1. Define/confirm current requirement and boundary.
2. Update design/ADR when the change affects persistent data, architecture, coordinate systems, topology semantics, rendering order, MCP contract, or repository boundaries.
3. Implement the smallest Product change that satisfies the requirement.
4. Add/run the smallest deterministic local tests needed for the changed behavior.
5. At a milestone, identify stable behaviors/boundaries that must not regress.
6. Add integration/staging tests only for risks that require those environments.
7. Add CI only after stating what risk the CI protects.
8. Review through a PR before merging to `main`.

## 5. Change discipline

- Prefer small understandable changes over framework-building.
- Do not add a new abstraction, state machine, manifest, validator, workflow, or service unless Product requirements justify it.
- Keep development-process state out of Product project files/runtime behavior.
- Do not make test helpers part of Product bootstrap for convenience.
- Do not make staging PSDs/reference images a Product dependency.
- Preserve deterministic, headless Product commands whenever UI behavior is added.
- A feature is not complete merely because the UI works; persistent state, undo/redo, save/load, and validation implications must be considered when applicable.
- Topology-changing operations require explicit compatibility handling for every Key Art/keyform/deformation state that shares the topology.

## 6. Mesh authoring mode invariant

Vertex editing has two distinct semantic modes. See `docs/decisions/0003-mesh-layout-vs-deform-mode.md`.

### Mesh Layout mode (位置決め)

Defines topology and where stable vertices belong on the active Key Art artwork.

Allowed examples:

- move rest/keyform vertices to fit artwork
- split edge / subdivide / add / dissolve topology with compatibility validation
- edit per-Key-Art UV/keyform placement

### Deform mode (変形)

Animates or poses an already-authored mesh without redefining topology/rest placement.

Allowed examples:

- write deformation offsets / form state / keyframe data
- proportional deformation
- bone/deformer correction results

Topology edits are not allowed in Deform mode.

Whole-mesh alignment for Key Art B is a transform operation that normally happens before Layout vertex refinement.

## 7. Testing policy

During active implementation:

- run the smallest checks relevant to changed code;
- prefer deterministic unit tests for geometry, transforms, topology propagation, serialization, interpolation, and command undo/redo;
- avoid building a broad browser/system harness prematurely.

At milestones:

- identify stable behavior and boundary risks;
- add the smallest regression suite that protects them;
- use integration tests for cross-module behavior;
- use staging/manual visual acceptance for risks that genuinely require real PSDs, WebGL rendering, browser interaction, or export inspection.

Tests validate Product from outside the production dependency graph. Product runtime must not require the test suite or staging fixtures to exist.

## 8. CI policy

- PR CI may protect stable Product behavior.
- Prefer path-scoped Product CI when practical.
- Prefer one check per distinct risk over overlapping duplicate checks.
- Do not add CI simply because a feature branch exists.
- Do not automatically duplicate the same PR validation on `main` without a separate reason.
- Keep expensive GPU/browser/visual/release checks manual or explicitly triggered until there is a demonstrated need to automate them.

## 9. GitHub workflow

Use GitHub as durable project memory:

```text
main          reviewed stable state
feature/*     implementation work
docs/*        design/research/ADR work
prototype/*   preserved runnable snapshots, not current Product authority
```

For meaningful capabilities:

1. Issue or documented acceptance criteria.
2. Feature/docs branch.
3. Small commits with understandable purpose.
4. Local relevant tests.
5. PR review.
6. Merge only when acceptance criteria and required checks pass.
7. Tag meaningful milestones when useful.

Do not leave the latest working implementation only in chat, Downloads, or a local working folder.

## 10. Current authority

Until the design PR is merged, authority is intentionally split:

- `main` is the last reviewed baseline.
- Draft design work is under `docs/basic-design-v0` and PR #2.
- Runnable PSD-import + zoom/pan prototype is preserved under `prototype/psd-import-zoom-pan-v0.3` and PR #3.
- `docs/basic-design.md`, `docs/key-art-transition.md`, `docs/mcp-design.md`, and accepted ADRs define proposed next architecture on the design branch.
- `docs/design.md` and prototype-era material are historical/reference material when they conflict with newer reviewed design.

Before implementation proceeds beyond prototype work, reconcile the accepted design and chosen Product source into `main` so there is one current baseline.

## 11. Source precedent

The boundary/test/CI philosophy above was adapted from the current `flamoris-net/flamoris-george` README and AGENTS.md, especially its Product/Staging/Test/History separation, production allowlist principle, milestone-based testing, and CI-as-regression-boundary policy.

FLAMORIS 2D keeps those principles while using its own product architecture and terminology.