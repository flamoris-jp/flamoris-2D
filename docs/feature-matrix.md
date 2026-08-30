# FLAMORIS 2D Feature Matrix

Status: draft

Priority meanings:

- **P0**: required for the first production-usable beta
- **P1**: core rigging/animation capability expected soon after foundation
- **P2**: important extension after the core workflow is reliable
- **Later**: useful but should not block MV production

## Foundation and project

| Feature | Priority | Notes |
|---|---:|---|
| PSD direct import | P0 | Prototype already proven with Akino PSD |
| PSD hierarchy/order preservation | P0 | Scene tree source |
| Stable internal IDs | P0 | Names may be Japanese/renamed |
| Display name editing | P0 | Separate from source identity |
| Project save/load | P0 | Versioned non-destructive project |
| Undo/Redo | P0 | Must use command layer |
| Autosave/recovery | P0 | Production safety |
| PSD re-import | P0 | Preserve rig/animation where compatible |
| Project schema validation | P0 | Detect broken references/cycles |
| Project migration by schema version | P1 | Needed as format evolves |

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

## Mesh editing

| Feature | Priority | Notes |
|---|---:|---|
| Grid automesh | P0 | Already proven |
| Configurable mesh density | P0 | Per part |
| Point/multi-point edit | P0 | Existing base |
| Proportional Editing | P0 | Smooth/Linear/Sharp falloff |
| Radius via wheel | P0 | Blender-like interaction |
| Connected-only proportional mode | P1 | Prevent nearby separate islands moving |
| Box/lasso selection | P1 | Large meshes |
| Brush selection/edit | P1 | Weight-like workflows |
| Add/remove/connect vertex | P1 | Topology correction |
| Mirror mesh editing | P1 | Eyes/body symmetry |
| Contour automesh | P2 | Irregular parts |
| Path deformation tool | P2 | Hair/string/ribbon |
| Folded/inverted-cell diagnostics | P2 | Mesh quality check |

## Masking and compositing

| Feature | Priority | Notes |
|---|---:|---|
| Source alpha/mask preservation | P0 | PSD and Part behavior |
| Part-to-part clipping | P0 | Iris/pupil within eye region |
| Multiple targets per clipping source | P0 | Eye contents |
| Clipping visualization | P1 | Editor overlay |
| Inverted clipping | P2 | If production cases require it |
| Advanced blend modes | P2 | After normal alpha/clipping is solid |

## Deformers and rig

| Feature | Priority | Notes |
|---|---:|---|
| Group transform hierarchy | P0 | Lowest-cost rig control |
| Warp/Lattice Deformer | P1 | Sparse controls deform children |
| Deformer hierarchy | P1 | Parenting/order validation |
| Bone hierarchy FK | P1 | Arms/legs/head controls |
| Rigid part-to-bone attachment | P1 | Early bone proof |
| Per-vertex bone weights | P1 | Production skinning target |
| Weight editing/painting | P1 | Needed to author skinning |
| Weight normalization | P1 | Multiple bone influence |
| Simple 2-bone IK | P2 | Arms/legs |
| Rotation constraints | P2 | Rig safety |
| Glue / vertex binding | P2 | Seam continuity across parts |
| Physics/sway | P2 | Secondary motion after animation core |

## Animation

| Feature | Priority | Notes |
|---|---:|---|
| Multi-track timeline | P0 | Transform, mesh, group, bone |
| Keyframe CRUD | P0 | Add/move/delete/copy |
| Linear interpolation | P0 | Existing concept |
| Ease In/Out | P0 | Production motion |
| Bezier/graph curve editing | P1 | Fine timing |
| Reusable Animation Clips | P0 | Blink, Breath, HairSway, HeadTilt |
| Clip looping | P0 | Idle/sway reuse |
| Clip instances in shot timeline | P0 | MV-centric workflow |
| Pose/Form states | P1 | Smile, EyesClosed, LookLeft |
| Blendable shape/form states | P1 | Shape-key-like behavior |
| Onion/ghost view | P2 | Helpful for pose comparison |
| Visibility/opacity tracks | P1 | Animation convenience |
| Optional semantic parameters | P2 | Reusable driver layer, MCP-friendly |

## Output and integration

| Feature | Priority | Notes |
|---|---:|---|
| PNG sequence export | P0 | Reliable baseline |
| Transparent WebM export | P1 | Convenient AE/Premiere workflow where supported |
| Silent video export | P1 | Preview/delivery |
| Render size/FPS/duration settings | P0 | Per project/shot |
| After Effects bridge | P2 | Layer/transform reconstruction + baked deformation where required |
| Blender importer | P2 | Planes/materials/shape data |
| Spine-compatible export | Later | Only if production need appears |

## Automation and AI

| Feature | Priority | Notes |
|---|---:|---|
| Command layer | P0 | Foundation, not merely automation feature |
| Deterministic command tests | P0 | UI and MCP share behavior |
| MCP low-level commands | P2 | After editor model stabilizes |
| Semantic MCP commands | P2 | `blink`, `tilt_head`, `sway_hair`, etc. |
| Auto eye clipping suggestion | P2 | Infer from names/hierarchy/geometry |
| Auto group mapping | P2 | Eye/mouth/body structure suggestions |
| Auto pivot suggestions | P2 | Should be user-reviewable |
| Auto bone rig | Later | Heuristic/DWPose after manual rig is solid |
| AI layer decomposition | Later | Not a dependency of the core editor |

## Explicit non-goals for first production beta

- realtime face tracking
- realtime full-body tracking
- lip-sync/audio analysis
- complete Live2D model compatibility
- full physics/rigid-body simulation
- plugin marketplace
- mandatory cloud/AI services

## Beta success condition

The first production-usable beta succeeds when a user can:

1. import an updated multi-layer PSD,
2. organize/select/rename/lock parts in a tree,
3. create groups, pivots, clipping, meshes, and basic rig controls,
4. animate multiple parts over a short timeline using reusable clips,
5. undo/redo and save/reopen without losing authored work,
6. re-import changed PSD artwork without rebuilding the entire rig,
7. export a transparent PNG sequence reliably.