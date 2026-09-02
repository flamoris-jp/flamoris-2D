# FLAMORIS 2D Animation Data Model

Status: draft for Phase 2 design review

## 1. Purpose

This document defines the persistent time-based data model shared by Key-Art transitions and the later general animation system.

The core design goal is simple at the product surface:

```text
POSE   = what the character looks like
MOTION = how the character changes over time
SHOT   = when poses, transitions, and motions happen
```

Internally, FLAMORIS 2D still needs deterministic typed data for transforms, mesh deformation, appearance, visibility, draw order, camera motion, events, and easing. The model below keeps those details editable and testable without exposing them as one large user-facing control surface.

This model is intentionally introduced before the full timeline UI. Phase 2 needs enough temporal infrastructure to evaluate Key-Art transitions correctly. Phase 6 can then build reusable clips, timeline authoring, looping, mixing, and graph editing on the same primitives instead of replacing the project schema.

## 2. Empirical basis

A September 2026 motion study used five short generated reference clips: lipstick application, looking toward a window, hair tuck, subtle idle, and a back-to-front turn. The clips were analyzed frame by frame for motion activity, local non-rigid deformation, contour change, approximate camera motion, timing phases, and occlusion/contact events.

The study produced several design conclusions:

1. Natural-looking motion is not described well by one global `easeInOut` curve. Actions commonly contain anticipation, action, contact, settle, and hold regions with different velocity profiles.
2. Large view changes should not be represented as one enormous deformation. A turn is better represented as a sequence such as `Back -> Back3Q -> Side -> Front3Q -> Front`.
3. Contact and occlusion must not be mistaken for mesh deformation. A hand crossing hair or a face can create large optical-flow and contour changes that are actually compositing/depth events.
4. `opacity = 0`, `occluded`, and `absent` are different semantic states.
5. Appearance change is not always a linear A/B texture blend. Intermediate view artwork may be required.
6. Camera motion should be modeled separately from subject motion even when most generated reference clips use a locked camera.
7. The persistent editor state should store deterministic tracks and keyframes, not opaque motion-analysis output.

The generated reference data is research input only. Accepted suggestions must compile into ordinary project data through normal commands.

## 3. High-level domain model

```text
Project
├── KeyArt[]
├── Transition[]
│   └── TemporalProgram
├── Rig
├── Animation
│   ├── Clip[]
│   │   └── TemporalProgram
│   ├── PoseState[]
│   └── DeformationSample[]
└── Sequence
    ├── ViewLane
    ├── ClipInstance[]
    ├── ShotTrack[]
    └── Marker/Event metadata
```

The critical architectural rule is:

> `Transition` and `AnimationClip` share the same temporal primitives.

A transition and a clip have different semantic purposes, but both represent typed values changing over a finite time interval.

## 4. Key Art vs Pose State

A `KeyArt` is a major authored visual state. It may contain different artwork, topology keyforms, visibility, draw order, clipping, and optional rig pose.

Examples:

```text
Front
Front3Q
Side
Back3Q
Back
```

A `PoseState` is a lightweight reusable override that does not imply a new source drawing.

Examples:

```text
EyesClosed
Smile
LookLeft
HandOpen
```

Large viewpoint or silhouette changes belong in Key Arts. Small reusable form/expression changes may be Pose States.

## 5. Timebase

Persistent animation time must not depend on UI frame numbering or floating-point seconds.

Proposed project timebase:

```text
TIMEBASE_TICKS_PER_SECOND = 120000
```

This makes common production frame rates exact integer tick durations, including:

```text
24 fps       = 5000 ticks/frame
25 fps       = 4800 ticks/frame
30 fps       = 4000 ticks/frame
60 fps       = 2000 ticks/frame
23.976 fps   = 5005 ticks/frame   (24000/1001)
29.97 fps    = 4004 ticks/frame   (30000/1001)
59.94 fps    = 2002 ticks/frame   (60000/1001)
```

The UI may display seconds, timecode, or frame numbers. Persistent commands and evaluation use integer ticks.

Render/display frame rates are stored as reduced rational values:

```text
FrameRate
├── numerator
└── denominator
```

For frame index `f`, the exact tick position is
`f * TIMEBASE_TICKS_PER_SECOND * denominator / numerator`. The common rates
listed above produce integers. If a future arbitrary rate does not land on an
integer tick, conversion uses non-negative round-half-up and the UI must report
that the frame grid is approximate. Conversion must use integer/rational
arithmetic rather than accumulating floating-point frame durations.

Required rules:

- all persistent keyframe/event times are integer ticks;
- sequence FPS is render/display configuration, not the fundamental storage unit;
- frame-rate numerator and denominator must be positive and reduced;
- conversion between ticks and frames must use the explicit rule above;
- frame zero is tick zero and a program evaluates both endpoints `0` and
  `durationTicks`;
- negative persistent timeline time is invalid unless explicitly introduced by a future pre-roll feature.

## 6. TemporalProgram

`TemporalProgram` is the common finite-time container used by transitions and clips.

```text
TemporalProgram
├── durationTicks
├── tracks[]
├── events[]
└── regions[]
```

The owning object does not duplicate `durationTicks`. A `Transition` or
future `AnimationClip` obtains its duration from `program.durationTicks`,
which is the single source of truth. `durationTicks` must be a positive
integer. Track keys and events must lie in `0..durationTicks`; regions use
`0 <= startTicks <= endTicks <= durationTicks`.

Example:

```json
{
  "durationTicks": 720000,
  "tracks": [],
  "events": [],
  "regions": []
}
```

A six-second program at the proposed timebase has `720000` ticks.

`TemporalProgram` itself has no special knowledge of UI widgets, generated video, or AI helpers.

## 7. Keyframes and interpolation

A continuous keyframe stores a time, value, and interpolation definition for the interval leading to the next keyframe.

Conceptual form:

```text
Keyframe<T>
├── id
├── timeTicks
├── value
└── interpolationToNext
```

Initial interpolation kinds:

```text
step
linear
bezier
```

Bezier persistence should store numeric control points rather than labels such as `easeInOut`:

```json
{
  "kind": "bezier",
  "x1": 0.25,
  "y1": 0.10,
  "x2": 0.25,
  "y2": 1.00
}
```

UI presets such as Ease In, Ease Out, and Ease In/Out compile to explicit Bezier control points. This prevents a later graph editor from requiring a project-format redesign.

Validation requirements:

- keyframes within one channel must have unique times;
- keyframes are sampled in ascending time order;
- Bezier x control points must preserve a single-valued time mapping;
- discrete values use step interpolation only;
- malformed interpolation fails before mutation.

## 8. Typed track model

Do not use an unrestricted string property path such as `"foo.bar.anything"` as the primary persistent track model.

Tracks are a versioned typed union so UI, commands, MCP, validation, and tests can discover exact behavior.

Versioned track kinds:

```text
GeometryBlendTrack
AppearanceTrack
OpacityTrack
PresenceTrack
DrawOrderTrack
ClippingTrack
TransformTrack
CameraTrack
MeshDeformationTrack
BoneTrack
DeformerTrack
ParameterTrack
```

Each track has a stable `trackId`, a literal `kind`, an explicit typed
target, and kind-specific channels/keyframes. `GeometryBlendTrack` targets a
Transition default or one `semanticSlotId`; its scalar value is the endpoint
geometry weight `0..1`. `ClippingTrack` is discrete and selects an explicit
validated clipping state/reference.

Phase 2 implements the Transition subset: GeometryBlend, Appearance, Opacity,
Presence, DrawOrder, and Clipping. The Clipping track initially selects and
evaluates endpoint clipping references only; mask authoring, mask morphing, and
the clipping-aware render pass remain Phase 4. Transform and Camera may be
serialized only when required by Transition evaluation; general animation
authoring for those
tracks, plus MeshDeformation/Bone/Deformer/Parameter, belongs to Phase 6 or its
own later feature phase. Defining the union now does not put all track editors
into Phase 2.

Two broad categories are sufficient conceptually:

### Continuous tracks

Numerical values sampled through interpolation:

- position x/y
- rotation
- scale x/y
- bone/deformer values
- mesh deformation weights/samples
- opacity
- appearance weights
- camera transform
- semantic parameters

### Discrete tracks

State changes sampled by step:

- presence
- draw order
- clipping-state selection
- discrete appearance state selection where blending is disabled
- mode/state switches

## 9. TransformTrack

A node transform track targets a stable scene node and states its coordinate space explicitly.

```text
TransformTrack
├── targetNodeId
├── coordinateSpace: node-local
└── channels
    ├── positionX
    ├── positionY
    ├── rotation
    ├── scaleX
    └── scaleY
```

Pivot is primarily Scene/Rig configuration and is not an ordinary animation channel in the initial model.

Each channel is independently keyframed so a simple Y movement does not require redundant X/rotation/scale keys.

Transform animation is evaluated on top of the appropriate Key-Art/rig base state according to the evaluation pipeline below.

## 10. MeshDeformationTrack

Key-Art mesh keyforms and animation deformation are separate concepts.

```text
MeshKeyform
= authored base shape for a Key Art

MeshDeformationTrack
= time-varying correction on top of evaluated base/rig geometry
```

Do not destructively rewrite `MeshKeyform` during playback.

Large arrays of full vertex positions should not be duplicated into every keyframe. Use reusable sparse deformation samples:

```text
DeformationSample
├── id
├── meshId
└── offsets[]
    ├── vertexId
    ├── dx
    └── dy
```

Vertices with zero displacement may be omitted.

A mesh-deformation keyframe references a sample and optionally a weight:

```text
MeshDeformationTrack
├── targetMeshId
└── keyframes[]
    ├── timeTicks
    ├── deformationSampleId
    ├── weight
    └── interpolationToNext
```

The exact order between bone skinning, deformer output, transition geometry, and mesh animation correction is a compatibility-critical evaluation rule and must be covered by tests.

## 11. AppearanceTrack

Appearance is broader than opacity or a mandatory A/B texture crossfade.

A semantic part may have several authored appearance states, especially across viewpoint changes:

```text
Front
Front3Q
Side
Back3Q
Back
```

`AppearanceTrack` can store weighted references to compatible appearances when blending is valid.

Conceptual keyframe:

```json
{
  "timeTicks": 336000,
  "weights": {
    "appearance_back3q": 0.25,
    "appearance_side": 0.75
  }
}
```

Rules:

- weights are finite, non-negative deterministic project data;
- weights in one weighted appearance key are normalized to sum to 1; invalid
  zero-sum keys fail validation rather than gaining an implicit fallback;
- appearance blending does not imply shared geometry unless the corresponding transition mode supports it;
- when ghosting or silhouette mismatch makes blending unsuitable, use Replace or an intermediate Key Art instead;
- an AI-generated intermediate image is only a suggestion until imported/accepted as ordinary Key-Art data.

## 12. OpacityTrack and PresenceTrack

Opacity and presence are independent.

```text
Opacity
0.0 .. 1.0
```

Presence:

```text
present
occluded
absent
```

Examples:

- an eye hidden by a head turn is `occluded`, not `absent`;
- a prop not belonging to a view may be `absent`;
- a present object may temporarily have opacity zero during a handoff.

`OpacityTrack` is continuous. `PresenceTrack` is discrete.

A transition may combine an opacity handoff with a later presence step to avoid a one-frame pop.

## 13. DrawOrderTrack

A DrawOrderTrack represents explicit depth/layer changes over time.

```text
DrawOrderTrack
├── targetNodeId or semanticSlotId
└── keyframes[]
    ├── timeTicks
    └── drawOrder
```

Draw-order values are sampled as discrete steps.

Because a raw one-frame order swap can visibly pop, authoring may pair the step with opacity/clipping handoff over a short crossing interval.

The renderer must not invent hidden order transitions that are absent from evaluated project state.

## 14. CameraTrack

Camera motion is separate from character/part motion.

Initial 2D camera channels:

```text
CameraTrack
├── positionX
├── positionY
├── rotation
└── scale
```

This is sufficient for locked camera, pan, small rotation, and zoom. Parallax/depth/focus are future extensions.

A locked camera is represented by the absence of changing camera keys, not by baking inverse camera motion into every character part.

## 15. MotionEvent

Events represent semantic moments, not renderable values.

```text
MotionEvent
├── id
├── timeTicks
├── type
├── participants[]
└── payload
```

Example:

```json
{
  "timeTicks": 204000,
  "type": "contact",
  "participants": [
    "semantic.hand.right",
    "semantic.hair.side.right"
  ]
}
```

Candidate event types:

```text
contact
release
blink
occlusion_change
depth_crossing
pose_switch
marker
```

Events do not directly move pixels. Tracks define render state. Events provide semantic structure for UI, MCP, analysis, synchronization, and editing.

## 16. MotionRegion

Regions label meaningful spans of a TemporalProgram without directly affecting rendering.

```text
MotionRegion
├── id
├── startTicks
├── endTicks
├── type
└── metadata
```

Initial semantic region types:

```text
idle
anticipation
action
contact
settle
hold
```

This allows semantic edits such as:

```text
"make the action 20% faster"
"leave two seconds of settle"
"move the contact later"
```

The resulting retime operation still commits ordinary keyframe/event time changes.

## 17. AnimationClip

Reusable animation is represented as a clip containing a TemporalProgram.

```text
AnimationClip
├── id
├── displayName
├── program
├── defaultLoopMode
└── metadata
```

Examples:

```text
Blink
Breath
HairSway
HeadTilt
LookLeft
RaiseArm
```

A clip definition is reusable. Timeline placement uses instances rather than duplicating the clip definition.

## 18. ClipInstance

```text
ClipInstance
├── id
├── clipId
├── startTicks
├── speed
├── weight
├── layer
├── loop
└── enabled
```

Multiple instances may overlap, for example:

```text
Idle
+ Breath
+ Blink
+ HairSway
```

The animation mixer resolves their contributions according to typed composition rules.

## 19. Composition rules

Initial composition semantics:

| Value type | Default composition |
| --- | --- |
| Position | additive |
| Rotation | additive |
| Scale | multiplicative |
| Mesh offset | additive |
| Bone/deformer delta | type-specific additive/weighted |
| Opacity | multiplicative unless explicit override mode is selected |
| Appearance | weighted blend |
| Presence | discrete override by priority |
| Draw order | discrete override by priority |
| Events | merge |

Override conflicts are not resolved by accidental insertion order.

Proposed priority rule:

1. higher `layer` wins for discrete override tracks;
2. same-layer incompatible overrides produce validation warning `ANIMATION_TRACK_CONFLICT`;
3. deterministic tie-break metadata may be introduced only if necessary and must be explicit.

## 20. Sequence model

Separate major visual state selection from ordinary motion layering.

```text
Sequence
├── ViewLane
│   ├── KeyArtHold
│   └── TransitionInstance
├── AnimationLayers
│   └── ClipInstance[]
├── ShotTrack[]
└── Camera
```

Example turn:

```text
ViewLane:
Back -> Back3Q -> Side -> Front3Q -> Front

Animation:
BodyTurnCorrection
HairFollow
Blink
Breath
```

This lets a view transition select/reshape artwork while reusable motion adds secondary life on top.

## 21. Evaluation pipeline

The evaluation core must return the same result for the same project state and time.

Conceptual pipeline:

```text
1. Resolve Sequence/ViewLane at time t
2. Evaluate active Key Art / Transition base state
3. Evaluate clip/shot TemporalPrograms
4. Mix node/bone/deformer animation
5. Evaluate rig deformation
6. Apply mesh animation/form corrections
7. Resolve node/world transforms
8. Resolve appearance and opacity
9. Resolve presence, draw order, and clipping
10. Evaluate camera transform
11. Produce renderer-ready evaluated state
```

The exact mathematical order is compatibility-critical. Once implemented and shipped, order changes require migration/version review.

Recommended headless query boundary:

```text
evaluateFrame(project, timeTicks)
```

The renderer consumes evaluated state rather than reinterpreting authored transition/animation semantics independently.

## 22. Deterministic evaluation output

An evaluated frame should expose typed state suitable for tests and MCP inspection, for example:

```text
EvaluatedFrame
├── timeTicks
├── camera
├── compositeGroups[]
│   ├── compositeGroupId
│   ├── mode: weighted-premultiplied
│   └── member renderInstanceIds + weights
└── parts[]
    ├── semanticSlotId
    ├── presence
    └── renderInstances[]
        ├── renderInstanceId
        ├── nodeId / source reference
        ├── worldTransform
        ├── meshPositions
        ├── appearanceSamples[]
        │   ├── texture/appearance + UV source
        │   └── normalized weight
        ├── opacity
        ├── drawOrder
        └── clipping state
```

A compatible Morph normally emits one geometry instance with multiple weighted
`appearanceSamples`. A Replace handoff may emit independent geometry instances;
when it promises a true crossfade rather than ordinary source-over overlap, the
evaluator also emits a generic `compositeGroup`. For a weighted-premultiplied
group, the renderer combines premultiplied color and alpha linearly by the
explicit weights. Array/draw order must not silently change that equation.

This enables assertions such as:

- frame evaluation is stable after save/reload;
- scrub and render agree;
- UI and MCP see the same state;
- transition and clip mixing are deterministic.

## 23. Motion analysis and AI boundary

Generated-video analysis, optical flow, pose estimation, or other AI helpers must not become opaque persistent animation state.

Recommended flow:

```text
Reference Video
  -> Motion Analyzer
  -> MotionSuggestion
  -> Preview / diagnostics
  -> User or agent accepts
  -> ordinary commands
  -> Track / Keyframe / Event / Region project data
```

A suggestion may contain confidence and provenance metadata, but accepted project state remains editable without the original model/service.

This preserves the project principle:

> AI proposes; deterministic commands commit.

## 24. MCP surface

Low-level deterministic operations may include:

```text
animation.create_clip
animation.delete_clip
animation.add_transform_keyframe
animation.add_mesh_deformation_keyframe
animation.set_curve
animation.add_event
animation.add_region
animation.add_clip_instance
animation.set_presence
animation.set_draw_order
animation.get_timeline
animation.evaluate_frame
```

Semantic operations compile to ordinary commands, for example:

```text
apply_motion(motion="hair_tuck", duration=6s)
blink_once(at=...)
retime_region(region="settle", factor=1.25)
```

Semantic commands must never create state that the normal editor cannot inspect/edit.

## 25. Validation

Minimum machine-readable diagnostics:

```text
ANIMATION_INVALID_TIME
ANIMATION_DUPLICATE_KEY_TIME
ANIMATION_INVALID_CURVE
ANIMATION_UNKNOWN_TARGET
ANIMATION_TRACK_CONFLICT
ANIMATION_MESH_SAMPLE_INCOMPATIBLE
ANIMATION_CLIP_CYCLE
ANIMATION_INVALID_INSTANCE_RANGE
ANIMATION_INVALID_PRESENCE_VALUE
ANIMATION_INVALID_DRAW_ORDER
```

Validation runs before mutation where possible and again at transaction/project boundaries.

## 26. Phase boundary

### Phase 2: implement temporal primitives required by Transition

In scope:

- integer project timebase
- Keyframe + step/linear/bezier interpolation
- `TemporalProgram`
- typed transition-relevant tracks
- GeometryBlend/Appearance/Opacity/Presence/DrawOrder/Clipping tracks
- events needed for explicit transition semantics
- deterministic transition/frame evaluation foundation
- serialization, validation, undo/redo commands for these objects

Out of scope for Phase 2:

- full multi-track timeline authoring UI
- reusable clip library UI
- clip looping/instance mixer UI
- graph editor
- production bone animation UI
- Runway/motion-analyzer integration

### Phase 6: build general Animation on the same primitives

Add:

- clip authoring and instances
- timeline layers/mixer
- reusable animation library
- looping/retiming UI
- graph editor after data model stability
- pose/form state authoring
- normal rig animation combined with Key-Art transitions

## 27. Initial acceptance criteria

The temporal data model is ready for Phase 2 implementation when tests can prove:

1. integer-tick times serialize/reload exactly;
2. step, linear, and Bezier sampling is deterministic;
3. a Transition and AnimationClip can both own a `TemporalProgram` without schema duplication;
4. Transition tracks for geometry blend, appearance, opacity, presence, draw
   order, and clipping are typed and validated; future track kinds cannot be
   smuggled in through arbitrary property paths;
5. mesh deformation remains separate from Key-Art mesh keyforms;
6. events/regions can be edited without directly changing renderer output;
7. evaluated state is identical before and after save/reload;
8. conflicting discrete tracks produce deterministic diagnostics;
9. MCP/headless callers can inspect the same evaluated state as the UI;
10. no AI/generated-video-specific state is required to load, edit, or render the project.
