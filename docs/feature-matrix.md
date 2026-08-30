# FLAMORIS 2D Feature Matrix

Status: draft

Priority meanings:

- **P0**: required for the first production-usable beta
- **P1**: core capability expected soon after foundation
- **P2**: important extension after the core workflow is reliable
- **Later**: useful but should not block MV production

## Foundation and project

| Feature | Priority | Notes |
|---|---:|---|
| PSD direct import | P0 | Prototype already proven with Akino PSD |
| PSD hierarchy/order preservation | P0 | Scene tree source |
| Multiple PSD source assets | P0 | Required for multi-Key-Art shots |
| Stable internal IDs | P0 | Nodes, meshes, vertices, Key Arts, transitions, clips |
| Display name editing | P0 | Japanese/Unicode independent from identity |
| SemanticSlot identity | P0 | Map logical parts across different drawings |
| Project save/load | P0 | Versioned non-destructive project |
| Undo/Redo | P0 | Shared command layer |
| Transaction/grouped commands | P0 | Needed for safe AI and bulk edits |
| Autosave/recovery | P0 | Production safety |
| PSD re-import | P0 | Preserve rig/transition/animation where compatible |
| Project schema validation | P0 | Detect broken refs/cycles/topology mismatch |
| Project migration by schema version | P1 | Needed as format evolves |

## MCP / AI architecture

| Feature | Priority | Notes |
|---|---:|---|
| Headless editor core | P0 | Core model/commands must not depend on DOM |
| Typed query API | P0 | UI/tests/MCP can inspect state consistently |
| Typed command API | P0 | One mutation path for UI/MCP/scripts |
| Explicit coordinate spaces | P0 | Avoid viewport-dependent AI edits |
| Structured change summaries | P0 | Debugging, history, AI reliability |
| Validation API | P0 | Machine-readable errors/warnings |
| Dry-run / preview for high-impact edits | P1 | Re-import, mapping, auto-rig, correspondence |
| Minimal MCP smoke adapter | P1 | Proves architecture early |
| Production MCP adapter/server | P2 | Built over stable core, not parallel path |
| Semantic MCP operations | P2 | `blink`, `tilt_head`, `connect_key_arts`, etc. |
| Confidence metadata for suggestions | P2 | AI suggestions must expose ambiguity |
| Mandatory cloud/AI dependency | Never | Manual deterministic editor must work offline |

## Scene and selection

| Feature | Priority | Notes |
|---|---:|---|
| Hierarchical scene tree | P0 | Replace select box |
| Visibility / lock | P0 | Per node |
| Search/filter | P0 | Necessary for large PSDs |
| Canvas click selection | P0 | Tree + viewport selection |
| Group nodes | P0 | Real transform/animation hierarchy |
| Reparent via tree | P1 | Validate cycles |
| Solo | P1 | Editing convenience |
| Multi-select nodes | P1 | Bulk transforms / organization |

## Transform controls

| Feature | Priority | Notes |
|---|---:|---|
| Position/rotation/scale | P0 | Group and Part |
| Pivot/anchor | P0 | Head/arm/hair roots |
| Viewport transform gizmo | P0 | Move/rotate/scale |
| Numeric Inspector editing | P0 | Precise values |
| Local/world transform modes | P1 | Useful for hierarchy |
| Constraints/limits | P2 | Before advanced IK workflows |

## Key Art transition

| Feature | Priority | Notes |
|---|---:|---|
| KeyArt object | P0 | Authored visual state backed by layered source |
| Start/End two-Key-Art workflow | P0 | Core product behavior |
| Semantic part mapping A ↔ B | P0 | Different layer names/counts allowed |
| Shared stable mesh topology across Key Arts | P0 | Generate on A, place same vertices on B |
| Per-Key-Art mesh positions | P0 | Target keyform editing |
| Per-Key-Art UV sets | P0 | Redrawn target textures |
| Geometry interpolation A → B | P0 | Deterministic morph |
| Dual-texture mesh morph | P0 | Sample A and B through their own UVs |
| Morph transition mode | P0 | Compatible topology |
| Hold mode | P0 | Keep state unchanged |
| Crossfade/Replace mode | P0 | Incompatible redraw fallback |
| Appear / Disappear | P0 | New/lost parts |
| Presence: present/occluded/absent | P0 | Required for turns and occlusion logic |
| Swap mode | P1 | View-specific replacement parts |
| Per-Key-Art draw order | P0 | Different view composition |
| Transition visibility/opacity | P0 | Entrances/exits/replacements |
| Draw-order step event | P1 | Explicit crossing point where needed |
| Multi-Key-Art chain A→B→C | P0 | Generalize without redesign |
| Key Art strip / thumbnails | P1 | Timeline authoring UI |
| Branching view-state graph | Later | Reusable rig/state graph |

## Mesh editing and correspondence

| Feature | Priority | Notes |
|---|---:|---|
| Grid automesh | P0 | Already proven |
| Configurable mesh density | P0 | Per part |
| Point/multi-point edit | P0 | Existing base |
| Proportional Editing | P0 | Smooth/Linear/Sharp falloff |
| Radius via wheel | P0 | Blender-like interaction |
| Connected-only proportional mode | P1 | Prevent separate islands moving |
| Box/lasso selection | P1 | Large meshes |
| Brush selection/edit | P1 | Weight-like workflows |
| Add/remove/connect vertex | P1 | Topology correction |
| Mirror mesh editing | P1 | Eyes/body symmetry |
| Correspondence anchors A ↔ B | P0 | Sparse manual target mapping |
| Smooth target-mesh solve from anchors | P1 | Piecewise affine/TPS/ARAP research |
| Contour automesh | P2 | Irregular parts |
| Path deformation tool | P2 | Hair/string/ribbon |
| Folded/inverted-cell diagnostics | P2 | Mesh quality check |
| Optical-flow correspondence suggestion | P2 | Good for visually continuous change |
| Semantic correspondence suggestion | P2 | Larger pose/view change assistance |

## Masking and compositing

| Feature | Priority | Notes |
|---|---:|---|
| Source alpha/mask preservation | P0 | PSD and Part behavior |
| Part-to-part clipping | P0 | Iris/pupil within eye region |
| Multiple targets per clipping source | P0 | Eye contents |
| Clipping through Key-Art transitions | P0 | Must remain correct while morphing |
| Clipping visualization | P1 | Editor overlay |
| Inverted clipping | P2 | If production cases require it |
| Advanced blend modes | P2 | After alpha/clipping is solid |
| User-authored occlusion masks | P2 | Advanced turn/crossing transitions |

## Deformers and rig

| Feature | Priority | Notes |
|---|---:|---|
| Group transform hierarchy | P0 | Lowest-cost rig control |
| Warp/Lattice Deformer | P1 | Sparse controls deform children |
| Deformer hierarchy | P1 | Parenting/order validation |
| Bone hierarchy FK | P1 | Arms/legs/head controls |
| Rigid part-to-bone attachment | P1 | Early bone proof |
| Per-vertex bone weights | P1 | Production skinning |
| Weight editing/painting | P1 | Author skinning |
| Weight normalization | P1 | Multiple influences |
| Per-Key-Art rig pose | P1 | Same logical rig, different authored states |
| Simple 2-bone IK | P2 | Arms/legs |
| Rotation constraints | P2 | Rig safety |
| Glue / vertex binding | P2 | Seam continuity |
| Physics/sway | P2 | Secondary motion later |

## Animation

| Feature | Priority | Notes |
|---|---:|---|
| Multi-track timeline | P0 | Transform, mesh, group, bone, transition |
| Keyframe CRUD | P0 | Add/move/delete/copy |
| Linear interpolation | P0 | Baseline |
| Ease In/Out | P0 | Production motion |
| Bezier/graph curve editing | P1 | Fine timing |
| Reusable Animation Clips | P0 | Blink, Breath, HairSway, HeadTilt |
| Clip looping | P0 | Idle/sway reuse |
| Clip instances in shot timeline | P0 | MV-centric workflow |
| Pose/Form states | P1 | Smile, EyesClosed, LookLeft |
| Blendable shape/form states | P1 | Shape-key-like behavior |
| Key-Art transition tracks | P0 | A→B timing/curve |
| Visibility/opacity tracks | P0 | Appear/disappear/occlusion |
| Onion/ghost view | P1 | Compare A/B or adjacent states |
| Optional semantic parameters | P2 | Driver layer, not primary authoring model |

## Output and integration

| Feature | Priority | Notes |
|---|---:|---|
| PNG sequence export | P0 | Reliable baseline |
| Render size/FPS/duration settings | P0 | Per shot/project |
| Transparent WebM export | P1 | Convenient downstream workflow |
| Silent video export | P1 | Preview/delivery |
| After Effects bridge | P2 | Layers/transforms + baked deformation where needed |
| Blender importer | P2 | Planes/materials/shape data |
| Spine-compatible export | Later | Only if production need appears |

## AI assistance

| Feature | Priority | Notes |
|---|---:|---|
| Semantic layer mapping suggestion | P2 | A/B layer trees to SemanticSlots |
| Transition-mode suggestion | P2 | Morph/Hold/Appear/Disappear/Swap |
| Anchor/vertex correspondence suggestion | P2 | Saved as ordinary target keyforms |
| Auto eye clipping suggestion | P2 | Names/hierarchy/geometry |
| Auto group mapping | P2 | Eye/mouth/body structure |
| Auto pivot suggestion | P2 | Reviewable |
| Auto bone rig | Later | Heuristic/DWPose after manual rig is solid |
| Generative intermediate frame suggestion | Later | Reference/assist only, not core state |
| AI layer decomposition | Later | Not required by editor core |

## Explicit non-goals for first production beta

- realtime face tracking
- realtime full-body tracking
- lip-sync/audio analysis
- complete Live2D compatibility
- full rigid-body simulation
- plugin marketplace
- mandatory cloud/AI services
- pretending one image deterministically contains unseen back/side artwork

## Beta success condition

The first production-usable beta succeeds when a user can:

1. import two or more layered Key Art PSDs,
2. organize/select/rename/lock parts in a tree,
3. map semantic parts across Key Arts,
4. create a mesh on A and reuse its topology on B,
5. edit B's target keyform comfortably,
6. preview a deterministic A→B geometry + texture transition,
7. handle appearing/disappearing/occluded parts explicitly,
8. create groups, pivots, clipping, meshes, and basic rig controls,
9. animate multiple controls and chain multiple Key Arts on a short timeline,
10. undo/redo and save/reopen without losing authored work,
11. re-import changed PSD artwork without rebuilding everything,
12. export a transparent PNG sequence reliably,
13. execute the same core edits through a headless command API suitable for MCP.
