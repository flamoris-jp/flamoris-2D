# Issue #58 — Native presentation cleanup

Baseline: current main after merged PR #113 (`f66d0b1`). Scope follows #58 and
existing observations in #81; it does not claim a new Windows hands-on result.

## Evidence and scope

| Existing observation | Current Native implementation | Focused response |
| --- | --- | --- |
| First action is unclear | Seven workflow modes already exist; empty projects show authoring fields | Keep modes; show a Japanese next-action hint above the canvas |
| English/domain terms dominate | Most actions are Japanese, but Bone/Warp/Key State and raw interpolation names remain | Japanese-first display labels; stable IDs and command values unchanged |
| Inspector is dense | Key Art and transition tools share Source/Mesh/Deform; long timeline controls are flat | Collapsed advanced sections and task sections; retain all operations |
| Canvas is cramped | Fixed 320px inspector and 190px animation timeline | Bounded splitters and reset-layout command; session-only sizes |
| Recovery prompt repeats | Native Recovery has an accepted lineage/snapshot contract (ADR 0007, #97) | No recovery semantics change in this presentation pass |

## Boundaries

Reuse the existing `EditingContextCatalog`, WPF controls, typed clients, Host
projections and Command/Transaction path. No new persisted schema, evaluation
order, transport contract, editor authority, docking framework or layout settings
file. Panel expansion and sizes are disposable UI state. Existing advanced
operations remain reachable. Workflow hints do not automatically change selection
or edit the project. The canvas stays free of instruction overlays.

## Verification and remaining acceptance

Extend the existing packaged WPF smoke for contextual visibility, advanced-section
reachability across refresh, local layout reset and unchanged selection/revision.
Use existing Product regressions for mutation/history behavior. No new CI workflow.

Issue #58 remains open for human acceptance under #78: use a real PSD/`.flimg`,
check the import → mesh → motion → preview → export path without documentation,
confirm terms and advanced controls are discoverable, resize beside Cutwork, and
check 100/125/150/200% DPI, focus and pointer feel. Include representative Undo/Redo
and Save/Open. #96/#97/#98 keep their existing real-art Windows/release gates.

## Implemented and locally checked

- Source/Mesh advanced groups and timeline task sections preserve expansion across
  projection refreshes. Timeline item selection opens the matching task section.
- Selected-object controls are limited to Source/Mesh/Rig/Deform, initially folded
  on empty projects but still available for root/group edits. Advanced rig,
  empty sequence, group and resource setup remain available without source parts.
- Current task/empty-project guidance lives above the canvas; no instruction overlay.
- Inspector width, target/property split and Animation timeline height are resizable
  with minimum sizes; View resets sizes. No persisted layout or new dependency.
- Japanese-first bone/warp/interpolation labels retain original command IDs and values.
- Local Product regression: 802 passed; XAML XML parsing and `git diff --check` passed.
- Native build and the extended packaged WPF smoke require the existing Windows CI;
  this Linux workspace has no .NET SDK/WPF runtime. Final CI results are recorded on
  the PR, separately from human visual acceptance.
