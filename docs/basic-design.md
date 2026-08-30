# FLAMORIS 2D Basic Design v0

Status: draft for review

## 1. Product purpose

FLAMORIS 2D is a lightweight 2D rigging and animation editor for producing short character animation clips for music-video production.

Primary workflow:

```text
Photoshop PSD
  -> FLAMORIS 2D Rig
  -> Short Animation Clip
  -> PNG/WebM/Video or Bridge
  -> After Effects / Blender / Editing Pipeline
```

FLAMORIS 2D is not intended to reproduce every feature of Live2D Cubism or become a full real-time VTuber tracking suite.

The editor should nevertheless provide the rigging foundations required for production-quality short clips. "Lightweight" means focused workflow, not fragile data structures.

## 2. Design principles

1. **PSD is a first-class source format.**
   Preserve source hierarchy, layer order, coordinates, names, opacity, and supported masks/blend information.
2. **Non-destructive editing.**
   Source artwork, base mesh, rig state, and animation state remain logically separate.
3. **Stable IDs, editable names.**
   Internal IDs never depend on Japanese/English display names.
4. **Scene hierarchy is real data.**
   Groups are not UI-only folders; they can own transforms and animation.
5. **Rig and animation are separate layers.**
   A rig defines how things can move. Animation defines when/how those controls move.
6. **Clip-first authoring for MV work.**
   Reusable actions such as Blink, HairSway, Breath, HeadTilt, LookLeft, and RaiseArm are first-class animation clips.
7. **Semantic parameters are optional drivers.**
   Parameter-style control can be added where useful without making the whole editor parameter-centric.
8. **All mutations go through commands.**
   UI, Undo/Redo, scripting, and future MCP call the same deterministic command layer.
9. **Open, versioned project data.**
   Projects must be recoverable, testable, migratable, and suitable for version control.
10. **Production changes must survive source-art updates.**
    PSD re-import should update textures/positions without discarding rig and animation work whenever matching is possible.

## 3. Core domain model

```text
Project
├── schemaVersion
├── Canvas
├── SourceAsset[]
├── Scene
│   └── SceneNode tree
├── Rig
│   ├── Deformer[]
│   ├── Bone[]
│   └── Constraint[]
├── Animation
│   ├── Clip[]
│   ├── Track[]
│   └── Keyframe[]
└── RenderSettings
```

### 3.1 SceneNode

Common properties:

```text
id              stable internal ID
sourceRef       PSD source mapping if any
displayName     user-editable, Unicode/Japanese allowed
parentId
children[]
visible
locked
opacity
blendMode
transform
```

Node kinds:

```text
GroupNode
PartNode
DeformerNode
BoneNode
```

A GroupNode has meaningful transform inheritance and can be animated.

### 3.2 PartNode

```text
PartNode
├── TextureReference
├── SourceBounds
├── Transform
├── Mesh
├── Mask/Clipping relationships
├── Deformation state
└── Render properties
```

A part keeps a source-space reference to the PSD so source updates can be reconciled later.

### 3.3 IDs and names

Never use layer names as permanent identity.

Recommended shape:

```json
{
  "id": "part_01...",
  "source": {
    "documentId": "source_01...",
    "path": "03_face/eye_left/eye_left_iris"
  },
  "displayName": "左目・虹彩"
}
```

`source.path` is useful for re-import matching but is not the primary identity.

## 4. Transform model

Every transform-capable node has:

```text
position x/y
rotation
scale x/y
pivot x/y
```

World transform is inherited through the scene tree.

Typical hierarchy:

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

Moving `LeftEye` moves all eye children. Moving `Head` moves the complete head hierarchy.

## 5. Geometry and deformation model

### 5.1 Immutable base mesh

```text
Mesh
├── baseVertices
├── uvs
└── indices
```

The base mesh is not destructively overwritten by animation.

### 5.2 Evaluated deformation pipeline

Conceptual evaluation order:

```text
Base Mesh
  -> Rig deformation
       bone skinning
       warp/lattice deformation
       optional path/deformer effects
  -> Animation/form corrections
       keyformed vertex offsets / shape states
  -> Node/world transform
  -> Render Mesh
```

The exact mathematical order must be covered by tests because changing it later can invalidate authored rigs.

### 5.3 Direct mesh editing

Direct vertex editing remains supported.

Editor tools should include over time:

- point selection
- multi-selection
- box/lasso/brush selection
- vertex move
- add/remove/connect
- reset selected/all
- proportional editing
- optional connected-only proportional editing
- mirror editing

Proportional Editing is an editor operation. It writes ordinary vertex changes using a falloff and does not require a special runtime deformation type.

Initial falloffs:

- Smooth
- Linear
- Sharp

## 6. Deformers and grouping

### 6.1 Group transform

Lowest-cost way to move related content together.

Use cases:

- complete left eye
- head
- hand and attached accessory
- mouth contents

### 6.2 Warp/Lattice Deformer

A sparse control grid deforms one or more child parts.

Use cases:

- head tilt correction
- hair block sway
- cloth
- face-wide deformation

A deformer is different from the part's own render mesh. Its purpose is to provide a low-resolution control surface for multiple children.

### 6.3 Bone rig

Bones form a parent-child skeletal hierarchy.

Minimum properties:

```text
id
parentBoneId
origin
length/direction
rotation
scale
```

Production target:

- per-vertex bone weights
- multiple bone influence per vertex
- weight normalization
- weight editing/painting

Development can start with rigid part attachment for proof, but weighted mesh skinning is the intended design.

Bone workflow:

```text
move/rotate bones for large pose
  -> evaluate skinning
  -> apply mesh/form correction for silhouette and clothing quality
```

Later constraints:

- rotation limits
- simple 2-bone IK
- optional target controls

## 7. Mask and clipping model

Keep two concepts separate.

### 7.1 Source mask

Modifies the alpha/content of the part itself.

Examples:

- imported PSD layer mask
- explicit user-authored mask asset

### 7.2 Clipping relationship

Restricts a rendered part to the visible region of another mask source.

Example:

```text
iris
pupil
highlights
  Clip To -> eye_white / eye_area
```

Expected capabilities:

- one clipping source can affect multiple targets
- support inversion later if needed
- clipping remains valid while both source and target deform

Eye clipping is a P0 production requirement because it is needed immediately for gaze animation.

## 8. PSD import and re-import

PSD is now part of the core workflow rather than a future optional import path.

Initial import already proves that FLAMORIS 2D can recover:

- document dimensions
- hierarchy
- layer names
- document-space bounds
- layer order
- image data

Re-import design:

```text
Existing Project + Updated PSD
  -> parse source
  -> match existing nodes
  -> report added/removed/renamed/changed layers
  -> update source textures/bounds
  -> preserve stable IDs, meshes, rig, clips where compatible
```

Matching strategy, in order:

1. stored source identity/path
2. source metadata/fingerprint where available
3. name + hierarchy + geometry heuristic
4. explicit user mapping when ambiguous

Re-import must show a review result instead of silently discarding rig data.

## 9. Editor UI architecture

Recommended production layout:

```text
+-----------+----------------------+-------------+
| Scene     |                      | Inspector   |
| Tree      |      Viewport        |             |
|           |                      |             |
+-----------+----------------------+-------------+
|               Timeline                         |
+------------------------------------------------+
```

### 9.1 Scene Tree

Replaces the prototype select box.

Features:

- PSD hierarchy
- expand/collapse
- selection
- drag-to-reparent where valid
- visibility
- lock
- rename/display name
- search/filter
- type icons for Group, Part, Warp, Bone
- optional Solo

### 9.2 Viewport

Current zoom/pan becomes foundation.

Future tools:

- canvas picking
- transform gizmo
- pivot editing
- mesh edit mode
- proportional editing radius/falloff
- bone edit/pose mode
- clipping visualization
- weight visualization

### 9.3 Inspector

Contextual properties for selected node/tool.

Do not place all future controls permanently in the left sidebar.

### 9.4 Timeline

Tracks can target:

- node transform
- bone transform
- deformer control points
- mesh/form offsets
- visibility/opacity where useful
- clip instances

## 10. Animation model

### 10.1 Clip-first model

```text
Clip: Blink
  LeftEye track
  RightEye track

Clip: HairSway
  FrontHair warp track
  SideHair warp track
```

Clips have:

```text
id
displayName
duration
loopMode
tracks[]
```

A clip can be reused multiple times in a shot timeline.

### 10.2 Keyframes

Keyframes should eventually support:

- Linear
- Ease In/Out
- Bezier/custom curve
- Hold/step where useful

### 10.3 Pose / Form / Shape state

Reusable deformation states are useful for:

- EyesClosed
- Smile
- LookLeft
- HandPose

These states can be blended or referenced by animation clips later.

### 10.4 Optional semantic drivers

Semantic controls such as:

```text
EyeOpenLeft
EyeOpenRight
LookX
LookY
HeadAngle
Breath
```

may be layered on top later for reusable rigs and MCP. They are not required to be the primary timeline authoring UI.

## 11. Command and Undo architecture

All model changes must eventually be commands.

Examples:

```text
RenameNode
ReparentNode
SetTransform
MoveVertices
GenerateMesh
SetClippingSource
AddBone
SetBoneWeights
AddKeyframe
MoveKeyframe
```

Command contract:

```text
apply(project)
undo(project)
serialize? (where useful)
```

Benefits:

- Undo/Redo
- action history
- deterministic tests
- macro operations
- future MCP
- safer automation

## 12. Persistence

Suggested development representation:

```text
project/
├── project.json
└── optional cached/generated assets
```

Later packaged form:

```text
*.flamoris2d
```

which may be a ZIP container.

Project data must contain:

- schema version
- source PSD reference metadata
- stable IDs
- scene tree
- meshes
- rig/deformer definitions
- clipping relationships
- animation clips/timeline
- render settings

Transient editor state such as current panel width or hover should not pollute core project data unless explicitly desired as workspace preferences.

## 13. Rendering

Continue using indexed GPU meshes.

Render pipeline must support over time:

- scene hierarchy transform evaluation
- stable draw order
- alpha blending
- clipping masks
- selected-part overlay/gizmos
- multiple deformed parts in one frame

Advanced blend modes are optional after core alpha/clipping correctness.

## 14. Reliability requirements

Production-facing editor requirements:

- Undo/Redo
- autosave/recovery
- project schema validation
- safe load failure with useful diagnostics
- no silent source re-import data loss
- deterministic serialization where practical
- tests for geometry evaluation and hierarchy cycles
- tests for project migration/version loading

## 15. Non-goals for the first production beta

Keep these out until the editor can reliably make and export a short MV shot:

- real-time face tracking
- full VTuber runtime
- audio-driven lip sync
- complex rigid-body simulation
- full Live2D compatibility
- arbitrary plugin ecosystem
- automatic AI segmentation as a dependency

## 16. Long-term integration

Once the command/model layers are stable:

- MCP exposes the same commands as the UI.
- semantic MCP operations compile into deterministic commands/clips.
- After Effects bridge can reconstruct layers/transforms or consume baked output.
- Blender importer can reconstruct planes/meshes/shape data where useful.
- automated rig helpers can infer groups, clipping, pivots, bones, or common clips without changing the underlying project format.

## 17. Product identity

FLAMORIS 2D should aim to be:

> A PSD-native, clip-first 2D rigging editor optimized for quickly creating expressive short character animation shots for music-video production.

That focus allows the tool to use proven rigging foundations without inheriting the complete complexity of a real-time avatar suite.