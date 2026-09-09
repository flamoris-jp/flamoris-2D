# FLAMORIS 2D Animation Data Model

Status: Phase 2 temporal foundation implemented; general animation contracts reconciled for Phase 8 design review

## 1. Purpose

This document defines the persistent time-based data model shared by Key-Art transitions and the later general animation system.

The core design goal is simple at the product surface:

```text
POSE   = what the character looks like
MOTION = how the character changes over time
SHOT   = when poses, transitions, and motions happen
```

Internally, FLAMORIS 2D still needs deterministic typed data for transforms, mesh deformation, appearance, visibility, draw order, camera motion, events, and easing. The model below keeps those details editable and testable without exposing them as one large user-facing control surface.

This model was intentionally introduced before the full timeline UI. Phase 2 implemented the temporal infrastructure required by Key-Art transitions. Phase 6 then implemented clipping and Warp/Lattice Deformers, and Phase 7 implemented Bones/Skinning and post-skin form correction. Phase 8 builds reusable clips, multi-Key-Art sequencing, looping, retiming, and deterministic mixing on those same primitives. A graph editor remains deferred until the Phase 8 typed track semantics are proven in production.

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
├── Transition[] -> temporalProgramId
├── TemporalProgram[]
├── Rig
├── Animation
│   ├── Clip[] -> temporalProgramId
│   └── DeformationSample[]
└── Sequence[] -> temporalProgramId
    ├── ViewLaneItem[]
    ├── ClipInstance[]
    └── shot-level CameraTrack / Event / Region data in its TemporalProgram
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

A `PoseState` was an early conceptual name for a lightweight reusable override that does not imply a new source drawing.

Examples:

```text
EyesClosed
Smile
LookLeft
HandOpen
```

Large viewpoint or silhouette changes belong in Key Arts. Phase 8 represents small reusable form/expression motion through typed `AnimationClip` contributions over Key-Art-specific Warp, Bone, and form state; it does not add a separate persistent `PoseState` schema in the initial implementation.

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

`TemporalProgram` is the common finite-time container used by Transitions, AnimationClips, and Sequences.

```text
TemporalProgram
├── durationTicks
├── tracks[]
├── events[]
└── regions[]
```

The owning object does not duplicate `durationTicks`. A `Transition`,
`AnimationClip`, or `Sequence` obtains its duration from `program.durationTicks`,
which is the single source of truth. `durationTicks` must be a positive
integer. Track keys and events must lie in `0..durationTicks`; regions use
`0 <= startTicks <= endTicks <= durationTicks`.

Ownership is by stable `temporalProgramId`. One TemporalProgram may have at
most one owner across all three owner kinds. Project-wide ownership validation
must centralize this rule rather than adding separate, potentially divergent
Transition/Clip/Sequence checks. Creation and removal of an owner and its
program are atomic transactions and one Undo/Redo unit.

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

Phase 2 implemented the Transition subset: GeometryBlend, Appearance, Opacity,
Presence, DrawOrder, and Clipping, plus the shared sampling/validation core.
Phase 6 implemented clipping rasterization and Warp/Lattice evaluation. Phase 7
implemented Bone/FK/Skinning and MeshFormCorrectionKeyform evaluation without a
general timeline. Phase 8 owns general Transform, Camera, MeshDeformation,
Bone, and Deformer animation authoring and deterministic clip mixing. The
existing typed union remains the extension point; Phase 8 adds missing typed
definitions and owner-aware validation rather than a parallel clip schema.

Program ownership constrains valid track families. Transition-owned programs
retain Transition semantic tracks. AnimationClip-owned programs contain
reusable motion contributions and may not use `transitionDefault` targets.
Sequence-owned programs initially contain at most one absolute CameraTrack,
plus events and regions; reusable camera mixing is not part of initial Phase 8.

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

Phase 8 Transform values are node-local contributions: position and rotation
are additive deltas and scale is a multiplicative factor around identity `1`.
Clip weight scales position/rotation and exponentiates scale toward identity as
specified by `docs/phase8-animation-sequencing.md`. Contributions are resolved
through the Scene hierarchy before final render-instance world transforms are
emitted; they are not multiplied onto already-flattened render output.

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
├── topologyId
└── offsets[]
    ├── vertexId
    ├── dx
    └── dy
```

Vertices with zero displacement may be omitted.

A mesh-deformation keyframe uses the already-reserved typed value and target:

```text
MeshDeformationTrack
├── target: { meshId }
└── deformation keyframes[]
    ├── timeTicks
    ├── deformationSampleId
    ├── weight
    └── interpolationToNext
```

The sample's `topologyId` must match the active evaluated topology. Offsets use
stable `vertexId`, never array index. A missing or incompatible topology is a
diagnostic rather than a geometry/name-based guess. The exact order is frozen:
Transition geometry -> Warp -> constrained Bone/FK/Skinning ->
MeshFormCorrectionKeyform -> MeshDeformationTrack -> node/world transform.

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

A locked camera is represented by the absence of changing camera keys, not by baking inverse camera motion into every character part. Initial Phase 8 CameraTrack is an absolute shot camera in the Sequence-owned TemporalProgram. AnimationClip-owned camera tracks and reusable camera mixing are out of scope.

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
├── temporalProgramId
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

A clip definition is reusable and owns exactly one existing TemporalProgram by
stable ID. Timeline placement uses instances rather than duplicating the clip
definition or its track/keyframe data.

## 18. ClipInstance

```text
ClipInstance
├── id
├── clipId
├── startTicks
├── endTicks
├── sourceOffsetTicks
├── playbackRate: { numerator, denominator }
├── weight
├── layer
├── loopMode: once | loop
└── enabled
```

Multiple instances may overlap, for example:

```text
Idle
+ Breath
+ Blink
+ HairSway
```

Placement uses integer Sequence ticks and half-open `[startTicks, endTicks)`
ranges. Playback rate is a positive reduced rational; local time is projected
from absolute elapsed ticks with non-negative round-half-up and no accumulated
floating-point delta. `once` source-range validation, loop modulo behavior, and
the fact that an instance endpoint is not an implicit sample are defined
normatively in `docs/phase8-animation-sequencing.md`.

The animation mixer resolves overlapping instances according to typed
composition rules and a canonical stable-ID order, never collection insertion
order.

## 19. Composition rules

Initial composition semantics:

| Value type | Default composition |
| --- | --- |
| Position | additive |
| Rotation | additive |
| Scale | multiplicative |
| Mesh offset | additive |
| Bone/deformer delta | type-specific additive/weighted |
| Opacity contribution | multiplicative |
| Appearance | Transition-owned initially; reusable appearance mixing deferred |
| Presence | highest-layer discrete override |
| Draw order | highest-layer discrete override |
| Clipping | highest-layer discrete override |
| Camera | Sequence-owned absolute state |
| Events | merge |

Override conflicts are not resolved by accidental insertion order.

Initial priority rule:

1. disabled and zero-weight instances do not contribute;
2. higher `layer` wins for discrete override tracks;
3. same-layer identical discrete values are compatible;
4. same-layer incompatible values produce a structured `ANIMATION_TRACK_CONFLICT` error and no winner is invented;
5. an instance with an active discrete contribution has weight exactly `1`;
6. continuous contributions accumulate in canonical `(layer, clipInstanceId, trackId, channel)` order to fix floating-point order.

## 20. Sequence model

Separate major visual state selection from ordinary motion layering.

```text
Sequence
├── id
├── displayName
├── temporalProgramId
├── ViewLane
│   ├── KeyArtHold
│   └── TransitionInstance
├── AnimationLayers
│   └── ClipInstance[]
└── shot-level CameraTrack / Event / Region data in the owned TemporalProgram
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

Canonical Phase 8 pipeline:

```text
1. Resolve Sequence/ViewLane and active ClipInstances at integer tick t
2. Resolve the active Key-Art/Transition semantic base without flattening rig stages
3. Sample the Sequence/Clip TemporalPrograms and mix typed contributions
4. Resolve MeshKeyform base + Transition geometry
5. Add DeformerTrack deltas to Key-Art/Transition Warp keyforms, then evaluate Warp
6. Add BoneTrack deltas to Key-Art/Transition BonePoseKeyforms
7. Apply existing rotation constraints, parent-first FK, rigid attachment/Skinning
8. Apply Key-Art/Transition MeshFormCorrectionKeyform
9. Apply post-skin MeshDeformationTrack offsets
10. Resolve TransformTrack deltas through node/world transforms
11. Resolve appearance, opacity, presence, and draw order
12. Resolve clipping from final evaluated geometry/alpha
13. Evaluate the Sequence-owned absolute camera
14. Produce ordinary renderer-ready EvaluatedFrame
```

The exact mathematical order is compatibility-critical. The existing Phase 6/7
Transition evaluator already performs Warp -> constrained Bone/FK/Skinning ->
form correction -> world transform -> clipping. Phase 8 must expose typed
inputs at those existing seams; it must not deform a completed render instance
or create a parallel Transition evaluator. Once implemented and shipped, order
changes require migration/version review.

Recommended headless query boundary:

```text
sequence.evaluate(project, sequenceId, timeTicks)
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

### Phase 8: build general Animation and sequencing on the same primitives

Add:

- clip authoring and instances
- Sequence-owned TemporalProgram and contiguous KeyArtHold/TransitionInstance ViewLane
- timeline layers/mixer
- reusable animation library
- looping/retiming UI
- Transform/Bone/Deformer/post-skin mesh contribution authoring
- normal rig animation combined with Key-Art transitions
- absolute Sequence camera and existing preview/PNG/MP4 source-frame parity

Deferred beyond initial Phase 8:

- graph editor until typed track semantics are stable in production
- parallel PoseState schema
- reusable camera clip mixing
- runtime IK/physics/AI motion generation

## 27. Initial acceptance criteria

The temporal data model is ready for Phase 2 implementation when tests can prove:

1. integer-tick times serialize/reload exactly;
2. step, linear, and Bezier sampling is deterministic;
3. a Transition, AnimationClip, and Sequence can each exclusively own a `TemporalProgram` without schema duplication or cross-owner sharing;
4. Transition tracks for geometry blend, appearance, opacity, presence, draw
   order, and clipping are typed and validated; future track kinds cannot be
   smuggled in through arbitrary property paths;
5. mesh deformation remains separate from Key-Art mesh keyforms;
6. events/regions can be edited without directly changing renderer output;
7. evaluated state is identical before and after save/reload;
8. conflicting discrete tracks produce deterministic diagnostics;
9. MCP/headless callers can inspect the same evaluated state as the UI;
10. no AI/generated-video-specific state is required to load, edit, or render the project.
