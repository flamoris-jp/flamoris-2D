# FLAMORIS 2D Documentation

## Current design set

- [`basic-design.md`](basic-design.md) — current basic architecture and domain model
- [`feature-matrix.md`](feature-matrix.md) — prioritized feature inventory
- [`roadmap.md`](roadmap.md) — dependency-driven implementation phases and acceptance criteria
- [`key-art-transition.md`](key-art-transition.md) — multi-Key-Art A→B→C transition model
- [`mcp-design.md`](mcp-design.md) — MCP-ready command/transaction architecture
- [`repository-boundaries.md`](repository-boundaries.md) — Product / Staging / Test / History separation, testing and CI boundary
- [`research/rigging-tools.md`](research/rigging-tools.md) — reference research from Inochi2D/Inochi Creator, Live2D Cubism, Stretchy Studio, Iki, Godot, and Synfig
- [`research/key-art-transition-research.md`](research/key-art-transition-research.md) — correspondence/morphing research notes
- [`reviews/phase1c-implementation-20260831.md`](reviews/phase1c-implementation-20260831.md) — Phase 1C implementation coverage and remaining real-Akino manual acceptance

Repository-wide AI/automation rules live at [`../AGENTS.md`](../AGENTS.md).

## Architecture decisions

- [`decisions/0001-key-art-and-mcp-foundations.md`](decisions/0001-key-art-and-mcp-foundations.md) — Key Art transitions and MCP-ready core as product foundations
- [`decisions/0002-coarse-to-fine-key-art-mesh.md`](decisions/0002-coarse-to-fine-key-art-mesh.md) — start with a coarse shared mesh, align it over each Key Art, then refine topology without breaking existing keyforms
- [`decisions/0003-mesh-layout-vs-deform-mode.md`](decisions/0003-mesh-layout-vs-deform-mode.md) — separate Mesh Layout (位置決め) from Deform (変形), including topology/Key-Art/MCP implications
- [`decisions/0004-project-files-recovery-and-psd-reimport.md`](decisions/0004-project-files-recovery-and-psd-reimport.md) — `.fl2d`, save points, Preferences/Recovery, reviewed PSD re-import, and the minimal headless boundary
- [`decisions/0005-windows-desktop-shell.md`](decisions/0005-windows-desktop-shell.md) — Electron Windows shell, native file semantics, Recovery storage, Recent Files, and security boundary
- [`reviews/phase1-desktop-implementation-20260901.md`](reviews/phase1-desktop-implementation-20260901.md) — Desktop implementation coverage and Windows manual acceptance

## Earlier draft

- [`design.md`](design.md) — original prototype-era design draft

The original draft remains useful as project history, but it predates the successful direct PSD import prototype and the expanded rigging/editor requirements. When documents disagree, review status and the current design/accepted ADRs rather than assuming the oldest file is authoritative.

## Documentation workflow

Design decisions should be recorded in GitHub before or together with implementation changes. Large architectural choices are captured as ADRs under `docs/decisions/`.

Current proposals remain draft until reviewed/merged. Prototype branches are runnable snapshots and do not automatically override current design authority.
