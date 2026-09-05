# Issue #50 repository-wide architecture audit

Baseline: `dfc5af659c20604d6aecf085bdb02818568d92ac`

## Initial findings

| Severity | Finding | Evidence | Recommended action | Scope |
| --- | --- | --- | --- | --- |
| High-value | The production allowlist is not import-closure complete. `src/core/export-frame-renderer.js` and `src/core/frame-sequence-export.js` import `export-frame-evaluator.js`, which imports `export-frame-planner.js`, but neither module is listed. Existing tests only spot-check selected entries. | `product/production-files.txt`; static imports in the export core | Add both entries and a deterministic regression test that verifies every relative production import resolves to another allowlisted file. | In scope |
| High-value | `product/src/app.js` owns bootstrap, camera geometry, canvas resizing, project attachment/lifecycle, preferences, file actions, and event wiring. Camera policy is independently testable and has a clear UI boundary. | `app.js` camera functions and direct canvas/viewport manipulation | Extract a viewport camera controller with injected state/elements/render callbacks; preserve behavior and leave project lifecycle extraction deferred unless regression coverage can be added safely. | In scope |
| High-value | Production packaging uses `src/**/*` while repository policy describes an explicit production allowlist. The text allowlist currently documents/tests boundaries but does not drive electron-builder. | `product/package.json` build files; `docs/repository-boundaries.md`; `production-files.txt` | Keep packaging behavior unchanged in this refactor. Document the distinction and enforce allowlist closure now; consider generating packaging inputs from the manifest separately. | Documentation in scope; packaging redesign deferred |
| Optional | `product/desktop/main.mjs` combines app lifecycle, recent files/storage, protocol serving, menus, and project IPC. Security settings and sender validation are present, and export IPC is already split. | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `assertTrusted`, dedicated export IPC modules | Avoid a broad main-process rewrite before real Windows QA. Extract only with dedicated integration tests after the production checkpoint. | Deferred |
| Optional | Several UI views/controllers are large, but current controller boundary tests protect transient state and Command/Query routing. Size alone does not justify splitting them. | UI boundary tests; no direct filesystem/process imports in renderer UI | Defer until a concrete responsibility seam or defect appears. | Deferred |
| Optional | No lockfile is committed, so transitive dependencies used by Windows packaging are not reproducible even though direct versions are exact. | root/product package manifests and repository tree | Add a reviewed lockfile in a dependency-maintenance change with license/provenance verification. | Deferred; dependency resolution change |

## Confirmed healthy boundaries

- The canonical `TIMEBASE_TICKS_PER_SECOND = 120000`, rational FPS helpers, Transition evaluator, and ExportFramePlanner remain shared rather than duplicated.
- Preview and export both pass evaluated state through `shared-composition-renderer.js`.
- Renderer-side modules contain no direct Node filesystem or child-process imports. Native file dialogs, project writes, temporary frame ownership, and FFmpeg spawning remain in the Desktop main-process boundary.
- Electron enables context isolation, disables Node integration, enables sandboxing and web security, rejects window opening/navigation, and validates IPC senders.
- Project mutations continue through EditorSession commands/transactions. No schema or `.fl2d` migration is required.

## Regression tests required before refactor

1. Production allowlist relative-import closure and missing-file detection.
2. Viewport camera fit, zoom anchor, pan, resize, and transformed selection bounds after extraction.
3. Existing full Product suite for Save/Open, migration, history, mesh, Transition, preview/export, PNG/MP4 and Desktop IPC boundaries.

## Implementation order and risk

1. Add the production manifest closure regression and repair the two omissions.
2. Extract viewport camera responsibility without changing state shape or rendering semantics.
3. Run the full Product suite and static Desktop checks.
4. Update the responsibility map and perform a final repository/diff review.

The highest-risk areas are `app.js` wiring, Desktop IPC/session ownership, and shared preview/export rendering. This pass intentionally avoids changing evaluator, persistence schema, export job orchestration, IPC contracts, or packaging mechanics.

## Final review

- No blocker finding was identified. The production-manifest omission was the
  only concrete high-value packaging-boundary defect and is fixed with
  import-closure regression coverage.
- The viewport camera extraction reduces `app.js` responsibility without
  changing Project state, commands, persistence, evaluator, rendering, or
  Desktop contracts. Camera behavior is now covered directly rather than only
  through bootstrap wiring.
- No new circular dependency was introduced: the camera controller depends
  only on mesh coordinate helpers and affine transforms, while `app.js`
  remains the composition root.
- Preview/export continue to share the canonical evaluator output and
  `shared-composition-renderer.js`; no export-only time or render semantics
  were added.
- Renderer modules still have no direct filesystem or child-process access.
  Preload exposes purpose-specific operations and main-process handlers retain
  trusted-sender/session validation.
- CI remains unchanged. Product CI protects deterministic behavior on Linux;
  Windows Desktop Package deliberately repeats Product tests on Windows before
  packaging because platform-specific filesystem/process/package behavior is
  a distinct risk, not accidental duplication.
- Direct production dependencies remain `ag-psd 31.0.2`, `electron 44.1.0`,
  and `electron-builder 26.15.7`. No dependency or license changed in this
  refactor. Runtime FFmpeg remains externally supplied and guarded by the
  existing LGPL-only capability policy. Lockfile/provenance hardening remains
  deferred.

## Manual QA remaining

Real Windows production QA from Phase 4 remains intentionally outstanding:
Save/Open and PSD re-import, viewport fit/zoom/pan at device scale, PNG
sequence export, direct MP4 export, cancellation/temp cleanup, packaged
`ag-psd` loading, and FFmpeg diagnostics.
