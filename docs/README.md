# FLAMORIS 2D Documentation

## Current design set

- [`basic-design.md`](basic-design.md) — current basic architecture and domain model
- [`feature-matrix.md`](feature-matrix.md) — prioritized feature inventory
- [`roadmap.md`](roadmap.md) — dependency-driven implementation phases and acceptance criteria
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
- [`csharp-wpf-ui-migration.md`](csharp-wpf-ui-migration.md) — accepted native WPF shell and JavaScript Product Host migration design
- [`research/rigging-tools.md`](research/rigging-tools.md) — reference research from Inochi2D/Inochi Creator, Live2D Cubism, Stretchy Studio, Iki, Godot, and Synfig
- [`research/key-art-transition-research.md`](research/key-art-transition-research.md) — correspondence/morphing research notes
- [`reviews/phase1c-implementation-20260831.md`](reviews/phase1c-implementation-20260831.md) — Phase 1C implementation coverage and remaining real-Akino manual acceptance
- [`reviews/issue-94-native-foundation.md`](reviews/issue-94-native-foundation.md) — Phase 1 Product Host, WPF shell, browser audit, and Windows acceptance record

Repository-wide AI/automation rules live at [`../AGENTS.md`](../AGENTS.md).

## Architecture decisions

- [`decisions/0001-key-art-and-mcp-foundations.md`](decisions/0001-key-art-and-mcp-foundations.md) — Key Art transitions and MCP-ready core as product foundations
- [`decisions/0002-coarse-to-fine-key-art-mesh.md`](decisions/0002-coarse-to-fine-key-art-mesh.md) — start with a coarse shared mesh, align it over each Key Art, then refine topology without breaking existing keyforms
- [`decisions/0003-mesh-layout-vs-deform-mode.md`](decisions/0003-mesh-layout-vs-deform-mode.md) — separate Mesh Layout (位置決め) from Deform (変形), including topology/Key-Art/MCP implications
- [`decisions/0004-project-files-recovery-and-psd-reimport.md`](decisions/0004-project-files-recovery-and-psd-reimport.md) — `.fl2d`, save points, Preferences/Recovery, reviewed PSD re-import, and the minimal headless boundary
- [`decisions/0005-windows-desktop-shell.md`](decisions/0005-windows-desktop-shell.md) — Electron Windows shell, native file semantics, Recovery storage, Recent Files, and security boundary
- [`decisions/0006-csharp-wpf-shell-product-host.md`](decisions/0006-csharp-wpf-shell-product-host.md) — accepted WPF shell with a versioned out-of-process JavaScript Product Host
- [`reviews/phase1-desktop-implementation-20260901.md`](reviews/phase1-desktop-implementation-20260901.md) — Desktop implementation coverage and Windows manual acceptance

## Earlier draft

- [`design.md`](design.md) — original prototype-era design draft

The original draft remains useful as project history, but it predates the successful direct PSD import prototype and the expanded rigging/editor requirements. When documents disagree, review status and the current design/accepted ADRs rather than assuming the oldest file is authoritative.

## Documentation workflow

Design decisions should be recorded in GitHub before or together with implementation changes. Large architectural choices are captured as ADRs under `docs/decisions/`.

Current proposals remain draft until reviewed/merged. Prototype branches are runnable snapshots and do not automatically override current design authority.
