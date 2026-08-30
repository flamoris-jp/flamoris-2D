# FLAMORIS 2D Documentation

## Current design set

- [`basic-design.md`](basic-design.md) — current basic architecture and domain model
- [`feature-matrix.md`](feature-matrix.md) — prioritized feature inventory
- [`roadmap.md`](roadmap.md) — dependency-driven implementation phases and acceptance criteria
- [`key-art-transition.md`](key-art-transition.md) — multi-Key-Art A→B→C transition model
- [`mcp-design.md`](mcp-design.md) — MCP-ready command/transaction architecture
- [`research/rigging-tools.md`](research/rigging-tools.md) — reference research from Inochi2D/Inochi Creator, Live2D Cubism, Stretchy Studio, Iki, Godot, and Synfig
- [`research/key-art-transition-research.md`](research/key-art-transition-research.md) — correspondence/morphing research notes

## Architecture decisions

- [`decisions/0001-key-art-and-mcp-foundations.md`](decisions/0001-key-art-and-mcp-foundations.md) — Key Art transitions and MCP-ready core as product foundations
- [`decisions/0002-coarse-to-fine-key-art-mesh.md`](decisions/0002-coarse-to-fine-key-art-mesh.md) — start with a coarse shared mesh, align it over each Key Art, then refine topology without breaking existing keyforms

## Earlier draft

- [`design.md`](design.md) — original prototype-era design draft

The original draft remains useful as project history, but it predates the successful direct PSD import prototype and the expanded rigging/editor requirements. When the documents disagree, the current design set above should be reviewed first.

## Documentation workflow

Design decisions should be recorded in GitHub before or together with implementation changes. Large architectural choices are captured as ADRs under `docs/decisions/`.
