# FLAMORIS 2D Basic Design v1 Draft

Status: draft for review

## 1. Product purpose

FLAMORIS 2D is a PSD-native 2D rigging and animation editor for producing short character animation clips for music-video production.

The defining workflow is not limited to deforming one illustration. A shot may use multiple authored Key Arts, especially a start drawing and an end drawing:

```text
PSD Key Art A
  -> Rig / Mesh / Mapping
  -> Editable Transition
  -> PSD Key Art B
  -> optional B -> C -> D transitions
  -> Short Animation Clip
  -> PNG/WebM/Video or Bridge
  -> After Effects / Blender / Editing Pipeline
```

FLAMORIS 2D is not intended to reproduce every Live2D Cubism feature or become a full real-time VTuber tracking suite.

The product identity is:

> A PSD-native, key-art-transition and clip-first 2D rigging editor optimized for expressive short MV shots.

## 2. Design principles

1. **PSD is a first-class source format.** Preserve hierarchy, layer order, coordinates, names, opacity, and supported masks/blend information.
2. **Multiple Key Arts are first-class.** Start/end drawings are project data, not flattened reference images.
3. **Non-destructive editing.** Source artwork, base mesh topology, per-Key-Art mesh keyforms, rig state, and animation state remain logically separate.
4. **Stable IDs, editable names.** Permanent identity never depends on Japanese/English display names.
5. **Semantic identity can span drawings.** A logical part such as `eye.left.iris` may map to different PSD layers in different Key Arts.
6. **Scene hierarchy is real data.** Groups own transforms and may be animated.
7. **Rig and animation are separate layers.** Rig defines how content can move; animation defines when controls move.
8. **Clip-first authoring.** Reusable actions such as Blink, HairSway, Breath, HeadTilt, LookLeft, RaiseArm are first-class clips.
9. **AI/MCP readiness starts at the core.** UI, tests, scripts, and MCP use one headless command/query model.
10. **AI proposes; deterministic commands commit.** No opaque AI-only project state.
11. **Open, versioned project data.** Projects are recoverable, migratable, testable, and version-control friendly.
12. **Source-art updates must preserve authored work where possible.** PSD re-import and Key-Art updates should not destroy meshes/rig/animation silently.

## 3. High-level architecture

```text
Human UI ───────┐
                │
AI / MCP ───────┼──> Query / Command API
                │         ↓
Tests/Scripts ──┘    Project Model
                         ↓
                    Evaluation Core
                         ↓
                      Renderer
```

Core domain/model/commands must not depend on DOM pointer events.

Suggested module boundaries:

```text
model       versioned schema + validation
core        scene, geometry, rig, transition, animation evaluation
commands    deterministic mutations + undo/redo + transactions
io          PSD/project import/export
renderer    WebGL rendering
ui          browser editor shell
mcp         typed adapter over queries/commands
```

These may begin as folders/modules in one package and split later only if useful.

## 4. Core domain model

```text
Project
├── schemaVersion
├── Canvas
├── SourceAsset[]
├── SemanticSlot[]
├── KeyArt[]
│   ├── sourceAssetId
│   └── SceneState / PartAppearance[]
├── Scene
│   └── SceneNode tree
├── Rig
│   ├── Deformer[]
│   ├── Bone[]
│   └── Constraint[]
├── Transition[]
│   ├── fromKeyArtId
│   ├── toKeyArtId
│   ├── program: TemporalProgram
│   └── PartTransition[]
├── Animation
│   ├── Clip[] -> TemporalProgram
│   └── ClipInstance[]
├── Sequence
└── RenderSettings
```

Detailed Key-Art behavior is defined in `docs/key-art-transition.md` and
`docs/transition-evaluation.md`. The shared temporal schema and evaluated
frame contract are defined in `docs/animation-data-model.md`.
Detailed AI/MCP behavior is defined in `docs/mcp-design.md`.

## 5. Stable identity and semantic mapping

### 5.1 SceneNode identity

Common properties:

```text
id              stable internal ID
sourceRef       PSD source mapping if any
displayName     user-editable Unicode/Japanese name
parentId
children[]
visible
locked
opacity
blendMode
transform
```

Node kinds include:

```text
GroupNode
PartNode
DeformerNode
BoneNode
```

Layer names are never permanent IDs.

### 5.2 SemanticSlot

A SemanticSlot identifies meaning across different drawings.

Examples:

```text
eye.left.white
eye.left.iris
hair.front.center
body.arm.left.upper
```

Each Key Art maps concrete nodes/layers to semantic slots.

This allows:

```text
Key Art A: eye_left_iris
Key Art B: 左目_虹彩
      ↓
semanticSlotId: eye.left.iris
```

The mapping may be manual, rule-assisted, or AI-suggested, but the saved result is deterministic project data.

## 6. Transform and hierarchy model

Every transform-capable node has:

```text
position x/y
rotation
scale x/y
pivot x/y
```

World transforms inherit through the scene tree.

Example:

```text
Akino
└── Head
    ├── Face
    │   ├── LeftEye
    │   │   ├── eye_white
    │   │   ├── iris
    │   │   └── pupil
    │   └── Mouth
    └── FrontHair
```

Moving `LeftEye` moves all eye children; moving `Head` moves the whole head hierarchy.

GroupNode is therefore a real rig primitive, not a UI-only folder.

## 7. Geometry model

### 7.1 Shared topology

A compatible logical part can share mesh topology across Key Arts:

```text
MeshTopology
├── stableVertexIds[]
└── indices[]
```

Each Key Art stores its own mesh keyform:

```text
MeshKeyform
├── keyArtId
├── positions[]
└── uvs[]
```

The start drawing can define the initial topology. The same stable vertices are then positioned over the end drawing.

### 7.2 Immutable base data

Topology and source keyforms should not be destructively overwritten by animation playback.

Direct edits create ordinary keyform/deformation changes through commands.

### 7.3 Evaluation pipeline

Conceptually:

```text
Sequence/ViewLane at integer timeTicks
  -> Active Key Art / Transition base evaluation
  -> Animation control values (Phase 6)
  -> Rig deformation
       bone skinning
       warp/lattice deformation
       optional path effects
  -> Animation/form corrections
  -> Node/world transform
  -> Appearance / opacity / presence / draw order / clipping resolution
  -> EvaluatedFrame with complete renderInstances[]
  -> Renderer rasterization/compositing
```

The mathematical order must be tested because changing it later can invalidate authored work.

## 8. Key Art transition model

A Transition connects two authored states:

```text
A -> Transition AB -> B
```

For a compatible part:

```text
position_i(t) = lerp(positionA_i, positionB_i, curve(t))
```

When the artwork itself differs, the Evaluation Core can emit two explicit
texture/UV render instances on the interpolated triangles:

```text
Texture A / UV A ----┐
                     ├-> evaluated render instances -> renderer compositing
Texture B / UV B ----┘
```

Minimum transition modes:

```text
Morph
Hold
Replace
Appear
Disappear
Occlusion
```

Presence is not binary. Distinguish:

```text
present
occluded
absent
```

This matters for turns where an eye/arm/hair section still exists logically but is hidden.

Major viewpoint changes should be represented as several Key Arts when needed:

```text
Front -> 3/4 -> Side -> Back
```

Do not pretend that unseen art can always be reconstructed from one source
drawing. “Crossfade” and “Swap” may remain UI presets, but they compile to the
core modes and typed tracks rather than becoming additional persistent modes.

## 9. Mesh editing

Required production tools over time:

- point/multi-select
- box/lasso/brush selection
- vertex move
- add/remove/connect
- reset selected/all
- configurable mesh density
- proportional editing
- connected-only proportional editing
- mirror editing
- topology diagnostics

Initial proportional falloffs:

```text
Smooth
Linear
Sharp
```

Proportional Editing is an editor operation that writes ordinary vertex changes. It does not require a special runtime deformation type.

## 10. Correspondence assistance

The target mesh on Key Art B may initially be authored manually.

A useful deterministic helper is sparse correspondence anchors:

```text
A shoulder -> B shoulder
A elbow    -> B elbow
A wrist    -> B wrist
```

The system then solves remaining vertices smoothly, followed by manual correction.

Algorithms to evaluate:

- piecewise affine / triangle propagation
- barycentric propagation
- thin-plate spline
- ARAP-style deformation

AI can later suggest anchors or dense correspondence using visual/semantic matching, but the persistent result remains ordinary target vertex positions and mappings.

## 11. Deformers and grouping

### Group transform

Lowest-cost way to move related content together.

### Warp/Lattice Deformer

Sparse control grid affecting one or more child nodes.

Useful for:

- face/head corrections
- hair block sway
- cloth
- grouped deformation

### Bone rig

Bones form a parent-child hierarchy.

Production target:

- per-vertex bone weights
- multiple influences
- normalization
- weight visualization/editing
- later 2-bone IK and limits

Typical workflow:

```text
bone pose for large motion
  -> skinning
  -> mesh/form correction
```

## 12. Mask and clipping model

Keep source masks and clipping relationships separate.

### Source mask

Changes the alpha/content of the part itself, including imported PSD masks where supported.

### Clipping

Restricts one part to the visible region of another.

Example:

```text
iris
pupil
highlights
  Clip To -> eye_white / eye_area
```

Clipping must remain correct while both source and target deform and while transitioning between Key Arts.

## 13. PSD import and re-import

PSD is core workflow.

Import should preserve as much as practical:

- dimensions
- hierarchy
- names
- document-space bounds
- layer order
- image data
- opacity
- supported masks/blending metadata

Raster placement uses one PSD document-space contract. A layer raster canvas
contains the complete pixel rectangle described by its
`left/top/right/bottom` bounds, including negative coordinates or pixels beyond
the PSD document edges. Import, Save/Open, and re-import preserve that complete
raster and those bounds; rendering applies `left/top` exactly once after the
Scene world transform.

Normal composition clips final pixels to the Project canvas rectangle
`0 <= x < project.canvas.width`, `0 <= y < project.canvas.height`. The viewport
derives that clip rectangle through its camera transform, while export obtains
the same boundary from its exact-size render target. Source rasters are not
destructively cropped, so later Object, Mesh, or Warp deformation can move
formerly off-canvas pixels into the visible document.

Re-import flow:

```text
Existing Key Art + Updated PSD
  -> parse
  -> match existing source nodes
  -> report added/removed/renamed/changed layers
  -> update textures/bounds
  -> preserve stable IDs, semantic mapping, meshes, rig, transitions, clips where compatible
```

Ambiguous matches require explicit review rather than silent data loss.

Fallback source identities may use occurrence-qualified hierarchy paths when a
PSD layer has no native ID. This can make keys unique, but not necessarily safe
for automatic identity matching. If same-name siblings make a fallback path
order-dependent, re-import must report the match as ambiguous and must not
automatically transfer existing mesh, rig, transition, or animation state.

## 14. Editor UI architecture

Recommended layout:

```text
+-----------+----------------------+-------------+
| Scene /   |                      | Inspector   |
| Key Art   |      Viewport        |             |
| Tree      |                      |             |
+-----------+----------------------+-------------+
| Key Art Strip + Timeline                       |
+------------------------------------------------+
```

### Scene Tree

- PSD hierarchy
- expand/collapse
- selection
- visibility/lock
- rename/display name
- search/filter
- type icons
- drag reparent with validation
- optional solo

### Key Art controls

- A/B/C thumbnails or strip
- active Key Art
- overlay/ghost compare
- correspondence status
- transition mode per selected semantic part
- jump to Start / End keyform

### Viewport

- zoom/pan
- canvas picking
- transform gizmo
- pivot edit
- mesh edit
- target-Key-Art mesh edit
- proportional radius/falloff
- bone edit/pose
- clipping visualization
- weight visualization
- optional A/B onion/ghost overlay

### Inspector

Contextual properties for selected node, mesh, Key Art, transition, bone, clip, or tool.

### Timeline

The Phase 2 Transition inspector/scrubber edits Transition-owned typed tracks
without requiring the general timeline. In Phase 6, the timeline reuses the
same `TemporalProgram`, keyframes, and sampling rules.

Tracks may target:

- node/group transforms
- bones
- deformers
- mesh/form states
- visibility/opacity
- clip instances
- Key Art transitions
- transition curves
- draw-order step events where needed

## 15. Animation model

Animation clips and Transitions share the versioned `TemporalProgram` defined
in `docs/animation-data-model.md`. Project time uses 120000 integer ticks per
second; render FPS remains a separate rational display/output setting.

### Clip-first

Reusable clips:

```text
Blink
Breath
HairSway
HeadTilt
LookLeft
RaiseArm
```

Clips are reusable instances on a shot timeline.

### Pose/Form/Shape state

Reusable states such as:

```text
EyesClosed
Smile
LookLeft
HandPose
```

may be blended or referenced by clips.

### Key Art sequence

Animation and Key-Art transitions coexist:

```text
rig animation on A
  -> Transition A/B
  -> rig animation on B
  -> Transition B/C
```

The sequence model should generalize from two Key Arts to multiple without redesigning the project format.

## 16. Command, transactions, Undo/Redo

Every persistent mutation is a command.

Examples:

```text
RenameNode
ReparentNode
SetTransform
MoveVertices
GenerateMesh
SetMeshKeyform
MapSemanticSlot
CreateKeyArt
CreateTransition
SetPartTransitionMode
SetClippingSource
AddBone
SetBoneWeights
AddKeyframe
```

Commands support:

- apply
- undo
- validation
- grouping/transaction
- structured change summary

Multi-step AI edits should be atomic or rollback on failure.

High-impact automatic operations should support dry-run/preview before commit.

## 17. MCP-first requirements

MCP uses stable IDs and domain coordinates, not display names or viewport pixels as primary addressing.

Separate query and mutation capabilities.

Example queries:

```text
scene.get_tree
keyart.list
keyart.compare
transition.get
mesh.get_summary
project.validate
```

Example mutations:

```text
scene.set_transform
mesh.set_keyform
keyart.map_semantic_slot
transition.create
transition.set_correspondence
animation.create_clip
```

Semantic AI operations such as `blink`, `tilt_head`, or `connect_key_arts` compile to the same low-level commands the UI uses.

The deterministic editor must work offline without AI.

## 18. Persistence

Suggested development representation:

```text
project/
├── project.json
└── optional generated/cache assets
```

Later packaged form:

```text
*.flamoris2d
```

Project data includes:

- schema version
- source asset metadata
- stable IDs
- semantic slots
- Key Arts
- scene hierarchy
- mesh topology and per-Key-Art keyforms
- rig/deformers/bones
- clipping
- transitions
- clips/timeline/sequence
- render settings

Transient panel sizes/hover state should remain workspace/editor preferences, not core project state.

## 19. Rendering

Continue using indexed GPU meshes.

The Evaluation Core emits a renderer-ready `EvaluatedFrame`. The renderer
does not interpret Transition modes, infer correspondence, or invent timing.
It must grow to rasterize/composite:

- hierarchy transforms
- multiple deformed parts
- stable draw order
- clipping masks
- dual-texture transition sampling
- per-Key-Art UVs
- selected-part overlays/gizmos
- transition preview/scrub

Advanced blend modes come after alpha/clipping/transition correctness.

## 20. Reliability requirements

Production-facing requirements:

- Undo/Redo
- transactions
- autosave/recovery
- schema validation
- safe load failures
- no silent re-import loss
- no silent correspondence loss
- deterministic serialization where practical
- hierarchy-cycle tests
- geometry/keyform compatibility tests
- project migration tests
- transition render tests

## 21. Non-goals for first production beta

- real-time face tracking
- full VTuber runtime
- audio-driven lip-sync
- complete Live2D compatibility
- advanced rigid-body simulation
- arbitrary plugin marketplace
- mandatory AI/cloud service
- magical reconstruction of truly unseen artwork from one image

## 22. Long-term integrations

Once model/commands are stable:

- full MCP server over existing query/command API
- AI correspondence and rig suggestions
- After Effects bridge
- Blender importer/bridge
- optional generative intermediate-frame suggestions as reference/assist layers
- optional semantic parameter/driver layer

The core project must remain editable even when all AI helpers are unavailable.
