# FLAMORIS 2D Documentation

## Current design set

- [`basic-design.md`](basic-design.md) — current basic architecture and domain model
- [`key-art-transition.md`](key-art-transition.md) — multi-Key-Art A→B→C transition model, mesh correspondence, appear/disappear/occlusion
- [`mcp-design.md`](mcp-design.md) — MCP-first headless core, typed commands/queries, transactions, preview/commit model
- [`feature-matrix.md`](feature-matrix.md) — prioritized feature inventory
- [`roadmap.md`](roadmap.md) — dependency-driven implementation phases and acceptance criteria
- [`research/rigging-tools.md`](research/rigging-tools.md) — reference research from Inochi2D/Inochi Creator, Live2D Cubism, Stretchy Studio, Iki, Godot, and Synfig
- [`research/key-art-transition-research.md`](research/key-art-transition-research.md) — mesh morphing, optical flow, semantic correspondence, TPS research directions

## Earlier draft

- [`design.md`](design.md) — original prototype-era design draft

The original draft remains useful as project history, but it predates the successful direct PSD import prototype, the expanded rigging/editor requirements, and the decision to make multi-Key-Art transitions and MCP-readiness first-class design constraints. When the documents disagree, the current design set above should be reviewed first.

## Documentation workflow

Design decisions should be recorded in GitHub before or together with implementation changes. Large architectural choices can later be captured as ADRs under `docs/adr/`.
