# Decision 0001: Key Art transitions and MCP-ready core are foundational

Status: proposed

## Context

Hands-on use of the PSD/mesh prototype exposed two requirements that materially change the product architecture:

1. FLAMORIS 2D should be designed so AI/MCP can inspect and edit the same deterministic model as the human UI from the beginning.
2. The primary MV workflow should support two or more authored images, especially a start Key Art and end Key Art, rather than assuming all motion deforms one source illustration.

## Decision

- Build a headless Project/Command/Validation core before advanced rig features.
- Treat MCP as an adapter over the same typed query/command API used by UI/tests/scripts.
- Introduce KeyArt, SemanticSlot, Transition, shared MeshTopology, and per-Key-Art MeshKeyform concepts as core project data.
- Support deterministic A→B geometry interpolation and dual-texture morphing for compatible parts.
- Treat appearance/disappearance/occlusion/view-specific replacement as explicit transition states.
- AI may suggest semantic mappings, transition modes, anchors, or target keyforms, but committed project state remains ordinary editable deterministic data.

## Consequences

- The roadmap moves MCP-ready architecture to Phase 1 and Key Art transitions to Phase 2.
- Bone/skin/advanced animation work follows these foundations rather than preceding them.
- Project schema must support multiple source PSDs and stable semantic identity across drawings.
- Renderer must eventually support two UV/texture sources on interpolated transition geometry.
- Large viewpoint changes should use additional authored Key Arts instead of forcing one source texture to represent unseen content.

## References

- `docs/basic-design.md`
- `docs/key-art-transition.md`
- `docs/mcp-design.md`
- `docs/feature-matrix.md`
- `docs/roadmap.md`
- `docs/research/key-art-transition-research.md`
