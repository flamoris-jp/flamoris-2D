# FLAMORIS 2D Documentation

## Current design set

- [`basic-design.md`](basic-design.md) — foundational domain/product design. Its browser/WebGL shell notes are historical where they conflict with the accepted native migration; current shell/rendering authority is the WPF migration design plus ADRs 0006–0009.
- [`feature-matrix.md`](feature-matrix.md) — early prioritized feature inventory and backlog reference, not current implementation status. Use the native capability ledger and roadmap for shipped/migrated/deferred disposition.
- [`roadmap.md`](roadmap.md) — current dependency-driven implementation phases, native migration checkpoint, and acceptance criteria
- [`phase6-clipping-group-deformer.md`](phase6-clipping-group-deformer.md) — Phase 6 clipping, Warp/Lattice Deformer, evaluation order, and authoring contract
- [`phase7-bones-skinning.md`](phase7-bones-skinning.md) — Phase 7 FK Bone, rigid attachment, weighted skinning, form correction, and convenience-tool contract
- [`phase8-animation-sequencing.md`](phase8-animation-sequencing.md) — Phase 8 Sequence/ViewLane, reusable clips, deterministic mixer, and canonical evaluation-stage contract
- [`cutwork-flimg-import.md`](cutwork-flimg-import.md) — Cutwork `.flimg` v1 external source-art import contract
- [`phase3-mesh-topology-contract.md`](phase3-mesh-topology-contract.md) — Phase 3-1 stable identity, mode, mutation, restoration, and query contract
- [`phase3-key-state-editing-ux.md`](phase3-key-state-editing-ux.md) — Phase 3-2 State Strip, playhead/evaluator, duration, playback, and transient-state contract
- [`phase3-contour-automesh.md`](phase3-contour-automesh.md) — Phase 3-3 deterministic sparse contour generation, preview/apply, and destructive replacement contract
- [`phase3-correspondence-assistance.md`](phase3-correspondence-assistance.md) — Phase 3-4 Stable-ID pins, deterministic solve, preview/apply, and persistence boundary
- [`key-art-transition.md`](key-art-transition.md) — multi-Key-Art A→B→C transition model
- [`mcp-design.md`](mcp-design.md) — MCP-ready command/transaction architecture
- [`repository-boundaries.md`](repository-boundaries.md) — Product / Staging / Test / History separation, testing and CI boundary
- [`csharp-wpf-ui-migration.md`](csharp-wpf-ui-migration.md) — accepted WPF shell / JavaScript Product Host migration design; Phase 1 foundation is complete and Issue #96 / PR #101 carries the Source-through-Export production candidate
- [`native-capability-map.md`](native-capability-map.md) — Issue #96 migration completion ledger and remaining release acceptance; this is the current capability-status authority for native migration
- [`native-production-workflow.md`](native-production-workflow.md) — Nativeの素材読込から書き出し・保存再開までの制作手順と最終Windows確認
- [`native-mesh-hands-on.md`](native-mesh-hands-on.md) — historical PR #100 proof boundary; superseded as the normal workflow by the production guide
- [`research/rigging-tools.md`](research/rigging-tools.md) — reference research from Inochi2D/Inochi Creator, Live2D Cubism, Stretchy Studio, Iki, Godot, and Synfig
- [`research/key-art-transition-research.md`](research/key-art-transition-research.md) — correspondence/morphing research notes
- [`reviews/phase1c-implementation-20260831.md`](reviews/phase1c-implementation-20260831.md) — historical Phase 1C implementation coverage and manual acceptance record
- [`reviews/issue-94-native-foundation.md`](reviews/issue-94-native-foundation.md) — Phase 1 Product Host/WPF foundation review; later production migration state is tracked by #96 / PR #101

Repository-wide AI/automation rules live at [`../AGENTS.md`](../AGENTS.md).

## Architecture decisions

- [`decisions/0001-key-art-and-mcp-foundations.md`](decisions/0001-key-art-and-mcp-foundations.md) — Key Art transitions and MCP-ready core as product foundations
- [`decisions/0002-coarse-to-fine-key-art-mesh.md`](decisions/0002-coarse-to-fine-key-art-mesh.md) — start with a coarse shared mesh, align it over each Key Art, then refine topology without breaking existing keyforms
- [`decisions/0003-mesh-layout-vs-deform-mode.md`](decisions/0003-mesh-layout-vs-deform-mode.md) — separate Mesh Layout (位置決め) from Deform (変形), including topology/Key-Art/MCP implications
- [`decisions/0004-project-files-recovery-and-psd-reimport.md`](decisions/0004-project-files-recovery-and-psd-reimport.md) — `.fl2d`, save points, Preferences/Recovery, reviewed PSD re-import, and the minimal headless boundary
- [`decisions/0005-windows-desktop-shell.md`](decisions/0005-windows-desktop-shell.md) — Electron Windows shell, native file semantics, Recovery storage, Recent Files, and security boundary; remains release history until native cutover
- [`decisions/0006-csharp-wpf-shell-product-host.md`](decisions/0006-csharp-wpf-shell-product-host.md) — accepted WPF shell with a versioned out-of-process JavaScript Product Host
- [`decisions/0007-native-recovery-lifecycle.md`](decisions/0007-native-recovery-lifecycle.md) — accepted native Recovery lineage/save acknowledgement implementation contract; final PR/Windows acceptance remains open
- [`decisions/0008-native-renderer-selection.md`](decisions/0008-native-renderer-selection.md) — measured D3D11 hardware/WARP native renderer choice and bounded artifact policy
- [`decisions/0009-native-mesh-animation-identity.md`](decisions/0009-native-mesh-animation-identity.md) — expose the existing mesh animation identity through ordinary Commands
- [`reviews/phase1-desktop-implementation-20260901.md`](reviews/phase1-desktop-implementation-20260901.md) — historical Electron Desktop implementation coverage and Windows manual acceptance

## Current status authority

For questions such as “is this feature implemented now?”, prefer documents in this order:

1. [`native-capability-map.md`](native-capability-map.md) for native migration capability disposition and evidence;
2. [`roadmap.md`](roadmap.md) for current phase/gate status;
3. accepted ADRs 0006–0009 for current native architectural decisions;
4. phase-specific normative design documents for domain semantics;
5. older reviews/drafts only as historical context.

Open PR #101 is still a candidate until review/merge. Electron remains the default installed/released shell until the explicit retirement/cutover criteria pass.

## Earlier draft

- [`design.md`](design.md) — original prototype-era design draft

The original draft remains useful as project history, but it predates the successful direct PSD import prototype and the expanded rigging/editor requirements. When documents disagree, use the authority order above rather than assuming the oldest file is current.

## Documentation workflow

Design decisions should be recorded in GitHub before or together with implementation changes. Large architectural choices are captured as ADRs under `docs/decisions/`.

Current proposals remain draft until reviewed/merged. Prototype branches are runnable snapshots and do not automatically override current design authority.

- [ADR 0010 — Native live MCP transport/security](decisions/0010-native-live-mcp.md): current external attachment contract under Issue #102.
