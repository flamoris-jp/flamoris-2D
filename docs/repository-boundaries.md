# FLAMORIS 2D Repository Boundaries

Status: proposed

This document adapts the useful Product / Staging / Test / History separation used by `flamoris-net/flamoris-george` to FLAMORIS 2D.

The goal is not to copy George's repository structure mechanically. The goal is to keep production/editor code from becoming entangled with test harnesses, visual acceptance fixtures, prototype handoff files, and historical experiments.

## 1. Boundary model

```text
flamoris-2D/
├── product/        current editor/runtime implementation
├── staging/        manual/visual acceptance setup and non-production assets
├── test/           integration/system/staging checks outside Product runtime
├── history/        historical prototypes and superseded implementation notes
├── docs/           current design, research, ADRs
├── AGENTS.md       repository-wide AI/automation rules
└── README.md       product purpose, authority map, development entry point
```

The directories may be introduced incrementally, but their dependency direction is fixed.

## 2. Product

`product/` contains everything required to run/build the actual FLAMORIS 2D editor and its production-capable headless core.

Expected internal shape:

```text
product/
├── package.json
├── production-files.txt      # or equivalent explicit build allowlist
├── src/
│   ├── model/
│   ├── core/
│   ├── commands/
│   ├── io/
│   ├── renderer/
│   ├── ui/
│   └── integrations/
│       └── mcp/              # when MCP becomes a Product feature
└── tests/                    # deterministic local unit tests if kept close
```

Product rules:

- Product runtime must not import `staging/`, root `test/`, or `history/`.
- Browser editor startup must not require staging PSDs or reference screenshots.
- MCP is Product only when it is a supported integration over the normal command/query core.
- AI/MCP may not bypass project validation or mutate project state outside the Command/Transaction API.
- Product unit tests, if colocated, are development-only and excluded from production artifacts.

## 3. Production artifact allowlist

Release/build inputs should be explicit.

George uses `product/production-files.txt` as an allowlist. FLAMORIS 2D should use the same principle, though the exact mechanism may be a file list or a build system with equally explicit inputs.

Reason:

```text
repository contains
  Product
  tests
  staging fixtures
  screenshots
  historical prototype data

release artifact contains
  only Product-required content
```

This prevents accidental packaging of real PSD fixtures, test-only code, local handoff files, or historical assets.

Before the first distributable build, add an automated check that the production artifact is derived only from the approved Product boundary.

## 4. Staging

`staging/` is for acceptance scenarios that intentionally resemble real production work but are not part of Product runtime.

FLAMORIS 2D examples:

- Akino acceptance PSD metadata/reference (only when repository storage/privacy permits)
- non-sensitive small PSD fixtures for browser acceptance
- expected reference screenshots or render hashes
- manual WebGL/browser acceptance instructions
- export acceptance settings
- test project files exercising A→B Key Art transitions

Staging rules:

- Staging assets are never required for normal Product startup.
- Staging may depend on Product; Product must never depend on Staging.
- Large/private production artwork should not be committed merely to make staging convenient.
- Environment-specific staging setup stays outside Product configuration.

## 5. Test

Root `test/` is for checks that cross Product module boundaries or require an external environment.

Suggested shape:

```text
test/
├── integration/
│   ├── psd-import/
│   ├── project-roundtrip/
│   └── transition-evaluation/
└── staging/
    ├── browser-smoke/
    ├── visual-acceptance/
    └── export-acceptance/
```

Use unit tests for deterministic local behavior such as:

- mesh generation
- coordinate conversion
- shared-topology subdivision propagation
- Mesh Layout vs Deform state separation
- command apply/undo
- A/B keyform interpolation
- serialization/migration

Use integration tests only when several Product components must cooperate.

Use staging/visual tests only when the risk actually requires WebGL/browser/realistic PSD/export behavior.

## 6. History

`history/` contains material useful for understanding how the product evolved but which must not become current execution authority automatically.

Examples:

- superseded prototype architecture notes
- migration records
- prior implementation snapshots that are no longer Product
- retrospective notes
- old decisions that have been replaced

Current runnable prototype branches such as `prototype/psd-import-zoom-pan-v0.3` are preserved snapshots. Once a Product baseline is established on `main`, prototype snapshots are reference/history, not the source to continue editing by default.

## 7. Docs and authority

`docs/` may contain both current proposals and historical material, so status matters.

Current design set should be indexed from `docs/README.md`.

ADRs must state status such as:

```text
proposed
accepted
superseded
```

A historical file, issue, chat prompt, or old prototype must not silently override accepted current design.

## 8. Dependency rules

Allowed conceptual direction:

```text
staging ─┐
         ├──> Product public interfaces
 test ───┘

MCP/UI ──> Product command/query core
```

Forbidden direction:

```text
Product -> staging
Product -> integration test helper
Product -> historical prototype code
Product -> private acceptance PSD
Product -> MCP-only hidden mutation path
```

## 9. CI boundary

Do not build a large CI system now.

When a coherent Product milestone becomes stable, add the smallest PR CI that protects it.

A likely first Product CI milestone:

- install Product dependencies
- deterministic unit tests
- static/lint checks only if they protect an agreed quality boundary

Trigger primarily on PR changes to Product/CI configuration.

Do not automatically duplicate identical validation on merge to `main` without a distinct risk.

Browser/GPU/large-PSD/export acceptance remains explicit/manual until it is stable enough and valuable enough to automate.

## 10. Phase 0 repository migration

Before new architecture implementation accelerates:

1. keep the exact v0.3 prototype preserved in its prototype branch/PR;
2. merge/review the current design baseline;
3. establish Product/Staging/Test/History directories on the chosen implementation branch;
4. move/adapt current prototype code into Product rather than treating prototype layout as permanent architecture;
5. preserve deterministic unit tests while removing accidental Product dependencies on test/prototype scaffolding;
6. add the production allowlist before the first distributable build.

This is intended to avoid the class of cleanup where development harnesses, staging mechanisms, and Product runtime become indistinguishable and later have to be separated by large deletion/reconstruction work.