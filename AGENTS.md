# AGENTS.md

This file defines repository-wide rules for AI agents and automated development tools operating in `flamoris-jp/flamoris-2D`.

The rules adapt the useful Product / Staging / Test / History and milestone-test discipline from `flamoris-net/flamoris-george` to FLAMORIS 2D. George-specific runtime policy is not inherited.

## 1. Repository purpose and authority

FLAMORIS 2D is a PSD-native, Key-Art-transition and clip-first 2D rigging/animation editor for short MV shots.

`main` is the reviewed current baseline. Chat attachments, local ZIPs, prototype branches, old docs, issue text, and LLM output are not current authority unless explicitly adopted through reviewed repository changes.

The exact v0.3 handoff remains preserved on `prototype/psd-import-zoom-pan-v0.3` as historical/reference material.

## 2. Absolute boundary rules

1. Product, Staging, Test, History, and current Docs responsibilities remain explicit and dependency-separated.
2. Product runtime must never depend on staging, integration-test, rehearsal, evidence, handoff, history-only code/assets, or private acceptance artwork.
3. Staging may depend on Product. Product must never depend on Staging.
4. Production/release artifacts are assembled from an explicit allowlist or equally explicit build-input boundary.
5. Historical/prototype material does not become Product authority automatically.
6. Safeguards should replace/simplify older mechanisms where possible. Do not accumulate duplicate gates, validators, evidence packages, checkpoints, or handoff frameworks.
7. Do not duplicate validation of the same risk without an explicit reason.
8. CI is a regression boundary, not a development orchestration system.
9. Add/expand CI only at meaningful milestones when a stable behavior or boundary exists to protect.
10. Do not automatically rerun identical CI after merge to `main` unless the post-merge run verifies a distinct risk.
11. Expensive browser/GPU/visual/release checks stay explicit/manual until automation has a clear benefit.
12. UI, MCP, scripts, and AI mutate persistent Product state through the same Command/Transaction layer. No parallel hidden AI editing path.
13. Persistent Product behavior uses stable IDs and domain coordinates, not viewport pixels, DOM events, or display names as primary identity.
14. When a requirement is ambiguous, record the uncertainty or create a proposed ADR. Do not invent authority.

## 3. Repository boundaries

```text
product/   current editor/runtime implementation and deterministic local unit tests
staging/   manual/visual acceptance setup and non-production fixtures
test/      integration/system/staging tests outside Product runtime
history/   superseded prototypes/migration/history notes
docs/      current design, research, ADRs and reviews
```

See `docs/repository-boundaries.md`.

## 4. Development order

Unless an accepted ADR changes it:

1. Confirm the current requirement and affected boundary.
2. Update design/ADR first when changing persistent data, coordinate systems, topology semantics, rendering/evaluation order, MCP contracts, or repository boundaries.
3. Implement the smallest understandable Product change.
4. Add/run the smallest deterministic local tests for the changed behavior.
5. At a milestone, identify stable behavior/boundary risks that must not regress.
6. Add integration/staging tests only when those environments are actually required.
7. Add CI only after stating which stable risk it protects.
8. Review through a PR before merging to `main`.

Do not skip Editor Core foundations to bolt later rig features directly onto prototype UI state.

## 5. Change discipline

- Prefer small understandable changes over framework-building.
- Do not add abstractions, state machines, validators, manifests, workflows, or services unless Product requirements justify them.
- Keep development-process state out of Product project/runtime data.
- Test helpers and staging configuration must not become Product bootstrap dependencies.
- A UI feature is not complete until persistence, Undo/Redo, validation, coordinate-space, and MCP/command implications are considered where applicable.
- Topology changes must explicitly preserve or reject incompatible Key Art keyforms/deformation states.
- Source PSD updates must never silently discard authored rig/transition/animation work.

## 6. Mesh authoring invariant

Vertex editing has two distinct semantic modes. See `docs/decisions/0003-mesh-layout-vs-deform-mode.md`.

### Mesh Layout / 位置決め

Defines topology and where stable vertices belong on the active Key Art artwork.

Allowed examples:

- move layout/keyform vertices
- whole-mesh Key Art alignment
- split/subdivide/add/dissolve/connect topology with compatibility validation
- edit per-Key-Art UV/keyform correspondence

### Deform / 変形

Poses or animates an already-authored mesh without redefining topology/layout.

Allowed examples:

- deformation/form offsets
- proportional deformation
- animation keyframes
- correction after bone/deformer pose

Topology edits are disabled/rejected in Deform mode.

Do not overload one generic `move_vertex` command. Use separate Layout and Deform commands.

## 7. MCP / AI invariant

MCP is an adapter over Product queries/commands, not a second editor.

- query and mutation capabilities are separate;
- mutating operations are typed and use stable IDs/domain coordinates;
- multi-step AI edits use transactions;
- high-impact automatic operations support validation and, where useful, dry-run/preview;
- AI suggestions expose ambiguity/confidence when applicable;
- saved projects contain normal deterministic mappings, keyforms, rigs, clips, and commands, not opaque AI-only state;
- the editor remains usable without cloud/AI services.

Principle: **AI proposes; deterministic commands commit.**

## 8. Testing policy

During active implementation:

- run the smallest checks relevant to changed code;
- prefer deterministic unit tests for geometry, transforms, topology propagation, interpolation, serialization, commands, Undo/Redo, and migration;
- do not build a broad browser/system harness prematurely.

At milestones:

- define the stable risks to protect;
- add the smallest regression suite for those risks;
- use integration tests for cross-module behavior;
- use Staging/manual visual acceptance only for risks requiring real PSDs, WebGL/browser behavior, visual comparison, or export inspection.

Product runtime must not require tests or staging fixtures to exist.

## 9. CI policy

- PR CI may protect stable Product behavior.
- Prefer path-scoped Product CI.
- Prefer one check per distinct risk over overlapping checks.
- No CI is required merely because a feature branch exists.
- Do not duplicate identical PR validation on `main` without a distinct purpose.
- Keep expensive visual/GPU/browser/release checks manual or explicitly triggered until proven valuable.

## 10. GitHub workflow

```text
main          reviewed current baseline
feature/*     implementation work
docs/*        design/research/ADR work
prototype/*   preserved runnable snapshots, not current Product authority
integration/* temporary reconciliation work
```

For meaningful capabilities:

1. Issue or documented acceptance criteria.
2. Feature/docs branch.
3. Small purpose-driven commits.
4. Relevant local tests.
5. PR review.
6. Merge only when acceptance criteria and required checks pass.
7. Tag meaningful milestones when useful.

Never leave the latest working implementation only in chat, Downloads, or a local folder.

## 11. Current design authority

The current design set is indexed by `docs/README.md`.

Important documents include:

- `docs/basic-design.md`
- `docs/key-art-transition.md`
- `docs/mcp-design.md`
- `docs/repository-boundaries.md`
- `docs/roadmap.md`
- accepted ADRs under `docs/decisions/`

`docs/design.md` is prototype-era history/reference when it conflicts with newer design.

## 12. Source precedent

The repository-boundary, testing, and CI philosophy is adapted from the current `flamoris-net/flamoris-george` README/AGENTS rules, especially physical responsibility separation, production allowlisting, milestone-based testing, and CI-as-regression-boundary discipline.


## Shared FLAMORIS repository policy

Organization-wide repository, licensing, security, contribution, and public-release principles are defined in:

- `flamoris-jp/flamoris-commons/docs/repository-policy.md`
- `flamoris-jp/flamoris-commons/AGENTS.md`

This repository-specific `AGENTS.md` remains authoritative for product/domain rules. Where the shared policy and repository-specific rules differ, preserve the more specific product rule unless an explicit FLAMORIS-wide policy change says otherwise.
