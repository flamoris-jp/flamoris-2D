# Phase 8: Multi-Key-Art Animation and Clip Sequencing

Status: proposed design for Issue #70

## 1. Goal

Phase 8 turns the existing deterministic two-Key-Art Transition workflow into a reusable short-shot animation system.

The production target is intentionally narrow:

```text
Key Art A
  -> Transition A/B
Key Art B
  -> Transition B/C
Key Art C

+ Blink
+ Breath
+ HairSway
+ node / Warp / Bone / form motion

-> deterministic scrub/play
-> existing PNG / MP4 export
```

Phase 8 is not a DAW/NLE replacement and does not introduce a second animation architecture.

The defining rule is:

> Sequence selects the major visual state. AnimationClip adds reusable motion. Both reuse the existing integer timebase, TemporalProgram, typed tracks, evaluation stages, and shared renderer boundary.

## 2. Existing architecture that remains authoritative

Phase 8 reuses, rather than replaces:

- Project / Scene stable identity;
- Query / Command / Transaction / EditorSession / Undo-Redo;
- the canonical `120000 ticks/sec` integer timebase;
- reduced rational FPS conversion and round-half-up conventions;
- `TemporalProgram`, typed keyframes, step / linear / Bezier sampling;
- KeyArt / SemanticSlot / Transition;
- MeshTopology / MeshKeyform and stable vertex IDs;
- Warp/Lattice Deformer and stable control-point identity;
- Bone / BonePoseKeyform / rotation constraints / FK / SkinBinding;
- MeshFormCorrectionKeyform;
- clipping evaluation;
- EvaluatedFrame;
- SharedCompositionRenderer and common Preview / PNG / MP4 source-frame semantics.

Phase 8 must not add:

- a second clock or frame-number-owned timeline;
- a second Scene or skeleton hierarchy;
- a second Transition evaluator;
- a renderer-owned animation mixer;
- UI-only persistent animation data;
- hidden AI-only animation state.

## 3. Product concepts

Phase 8 separates three concepts that were already anticipated by the earlier animation model:

```text
POSE   = authored Key Art / rig state
MOTION = reusable time-varying delta
SHOT   = when poses, transitions, and motions happen
```

Persistent top-level concepts become:

```text
Project
├── KeyArt[]
├── Transition[]
├── TemporalProgram[]
├── AnimationClip[]
└── Sequence[]
```

`TemporalProgram` stays the one typed finite-time primitive shared by Transition, AnimationClip, and the Sequence's shot-level program.

## 4. Sequence domain

A Sequence is one finite shot timeline.

Conceptual persistent model:

```text
Sequence
├── id
├── displayName
├── temporalProgramId
├── viewLaneItems[]
├── clipInstances[]
└── metadata
```

The Sequence owns exactly one existing `TemporalProgram` through `temporalProgramId`.

That program provides the Sequence duration and may contain shot-level tracks/events/regions, initially including CameraTrack. Sequence does not duplicate `durationTicks`.

Ownership rules match Transition ownership:

- one Sequence owns exactly one TemporalProgram;
- one TemporalProgram may not be multiply owned by Transition, AnimationClip, or Sequence;
- ownership is explicit and validated;
- creation/removal that affects both objects is transactional and one Undo/Redo unit.

The Sequence's program duration defines the legal shot domain:

```text
0 <= sequenceTick <= sequenceProgram.durationTicks
```

Export remains half-open in frame planning as already defined by Phase 4. The inclusive terminal Sequence tick exists for deterministic scrub/end-state evaluation, not as an extra exported frame.

## 5. ViewLane

ViewLane is the single major-visual-state lane.

It contains only:

```text
KeyArtHold
TransitionInstance
```

Conceptual shapes:

```text
KeyArtHold
├── id
├── keyArtId
├── startTicks
└── endTicks

TransitionInstance
├── id
├── transitionId
├── startTicks
└── endTicks
```

### 5.1 Coverage rule

A renderable Sequence has exactly one ViewLane item active across its entire duration.

Initial Phase 8 rules are deliberately strict:

- first item starts at tick 0;
- last item ends at Sequence duration;
- adjacent items are contiguous;
- no gaps;
- no overlaps;
- every item has `startTicks < endTicks`;
- canonical order is `(startTicks, endTicks, stableId)` and never insertion order.

Pauses are represented explicitly by KeyArtHold rather than by timeline gaps.

### 5.2 Boundary ownership

Ordinary ViewLane items use half-open placement:

```text
[startTicks, endTicks)
```

At an exact internal boundary, the later item owns the Sequence tick.

This avoids two active major visual states at one tick.

The terminal Sequence tick is special only for inspection:

```text
timeTicks == sequenceDurationTicks
```

resolves the last ViewLane item at its authored terminal state.

### 5.3 KeyArtHold

A KeyArtHold evaluates one existing KeyArt as the base visual state. It does not create a fake zero-duration Transition.

The evaluator should share the same Key-Art base-state resolution helpers used by Transition rather than introducing a second Key-Art rendering model.

### 5.4 TransitionInstance

A TransitionInstance references one existing Transition. It does not copy SemanticSlot, PartTransition, track, Warp, Bone, or clipping semantics.

Instance-local transition time is derived directly from placement:

```text
localTransitionTick =
  roundHalfUp(
    (sequenceTick - startTicks)
    * transitionDurationTicks
    / (endTicks - startTicks)
  )
```

with exact endpoint rules:

```text
sequenceTick == startTicks -> 0
sequenceTick == endTicks   -> transitionDurationTicks
```

for terminal evaluation only. At an internal ViewLane boundary, the next item owns the Sequence tick and must be semantically compatible with the Transition endpoint.

This gives deterministic per-instance retiming without persisting floating-point speed.

### 5.5 View continuity validation

For adjacent ViewLane items, validate endpoint continuity where it can be known structurally.

Examples:

```text
Hold(A) -> Transition(A,B) -> Hold(B)
Transition(A,B) -> Transition(B,C)
```

are valid.

Mismatched chains diagnose before render-authority is claimed.

No automatic name-based KeyArt matching is allowed.

## 6. AnimationClip

Reusable motion is represented by AnimationClip.

```text
AnimationClip
├── id
├── displayName
├── temporalProgramId
├── defaultLoopMode
└── metadata
```

Each clip owns exactly one existing `TemporalProgram`.

Examples:

```text
Blink
Breath
HairSway
HeadTilt
RaiseArm
```

A clip definition contains authored reusable motion only. Timeline placement belongs to ClipInstance.

Nested ClipInstances inside AnimationClip are out of scope for initial Phase 8. This prevents recursive clip graphs and keeps the first mixer finite and inspectable.

## 7. ClipInstance

Conceptual persistent model:

```text
ClipInstance
├── id
├── clipId
├── startTicks
├── endTicks
├── sourceOffsetTicks
├── playbackRate
│   ├── numerator
│   └── denominator
├── loopMode: once | loop
├── weight
├── layer
└── enabled
```

Rules:

- `startTicks` and `endTicks` are integer Sequence ticks;
- placement is half-open `[startTicks, endTicks)`;
- `0 <= startTicks < endTicks <= sequenceDurationTicks`;
- playback rate is a positive reduced rational;
- no floating-point authoritative speed is persisted;
- `sourceOffsetTicks` is an integer clip-local tick;
- `weight` is finite in `0..1`;
- `layer` is an explicit integer priority for discrete override resolution;
- canonical evaluation order never depends on array insertion order.

## 8. Clip local-time projection

For an active ClipInstance:

```text
elapsed = sequenceTick - startTicks

rawLocal = sourceOffsetTicks
  + roundHalfUp(elapsed * rateNumerator / rateDenominator)
```

No accumulated floating-point delta is allowed.

### 8.1 once

For `loopMode = once`, the instance is valid only while its active placement maps to the clip program domain.

An instance whose authored range runs beyond the available clip source time is invalid rather than silently holding or wrapping.

Trimming shorter than the source clip is valid.

### 8.2 loop

For `loopMode = loop`, repetition uses the clip program duration as the period:

```text
phase = rawLocal mod clipDurationTicks
```

The repeating phase domain is:

```text
[0, clipDurationTicks)
```

Therefore an exact positive multiple of the clip duration maps to phase 0, not to the terminal keyframe.

This avoids duplicate seam samples.

The terminal clip key at `clipDurationTicks` remains directly inspectable in clip editing and one-shot playback.

A loop whose values differ materially between tick 0 and `durationTicks` may be legal but must surface a loop-seam diagnostic for affected continuous channels. Seam correction is never silently invented.

## 9. Typed animation contribution model

Phase 8 general animation tracks describe motion contributions relative to the currently resolved Key-Art/Transition base state.

The initial reusable-motion model intentionally prefers deltas over absolute overrides.

This makes one Blink/Breath/HairSway clip usable across compatible Key Arts without rewriting their authored base pose.

Continuous clip contributions are mixed in a deterministic canonical order such as `(layer, clipInstanceId, trackId, channel)` before numeric accumulation. The mathematical rules below are designed to be commutative where practical; canonical ordering additionally fixes floating-point accumulation order.

## 10. TransformTrack

Initial general TransformTrack targets one stable Scene node in node-local space.

```text
TransformTrack
├── targetNodeId
├── coordinateSpace: node-local
└── delta channels
    ├── positionX
    ├── positionY
    ├── rotation
    ├── scaleX
    └── scaleY
```

Semantics:

- position values are additive deltas;
- rotation is an additive local-angle delta;
- scale values are multiplicative factors around identity `1`;
- scale factors must be finite and greater than zero.

ClipInstance weight applies relative to identity:

```text
weightedPositionDelta = positionDelta * weight
weightedRotationDelta = rotationDelta * weight
weightedScaleFactor   = pow(scaleFactor, weight)
```

Multiple contributions combine as:

```text
position = basePosition + sum(weighted deltas)
rotation = baseRotation + sum(weighted deltas)
scale    = baseScale * product(weighted factors)
```

Absolute Transform override tracks are deferred until production evidence requires them.

## 11. BoneTrack

BoneTrack targets one existing stable Bone ID and animates a delta relative to the active Key-Art Bone pose.

```text
BoneTrack
├── boneId
└── localDelta channels
    ├── x
    ├── y
    └── rotation
```

The base pose is the already-authored Key-Art/Transition `BonePoseKeyform` result.

Phase 8 adds reusable clip motion on top:

```text
mixedBoneDelta =
  transitionResolvedBonePoseDelta
  + sum(weighted BoneTrack deltas)
```

Then the existing Phase 7 order remains authoritative:

```text
mixed local pose
-> rotation constraint clamp
-> existing parent-first FK
-> existing rigid / SkinBinding evaluation
```

BoneTrack does not persist IK targets and does not create runtime IK solver state. Existing analytic IK remains an authoring helper that bakes ordinary pose data.

Keyframe interpolation of a Bone rotation channel uses shortest-arc interpolation between authored keys. Clip-to-clip mixing adds the resulting local rotation deltas after sampling.

## 12. DeformerTrack

DeformerTrack targets stable Warp control-point identity.

Initial conceptual target:

```text
DeformerTrack
├── deformerId
├── controlPointId
└── deltaX / deltaY channels
```

Values are additive deltas in the Warp Deformer's authored local lattice space.

Evaluation order:

```text
Key-Art/Transition WarpDeformerKeyform
+ mixed DeformerTrack control-point deltas
-> existing deterministic Warp evaluator
```

Playback never rewrites WarpDeformerKeyform.

If a target control point does not exist in the active compatible deformer state, evaluation diagnoses the incompatibility rather than guessing by array index or geometry proximity.

## 13. MeshDeformationTrack

Reusable mesh/form animation remains separate from MeshKeyform and MeshFormCorrectionKeyform.

Initial persistent sample form:

```text
MeshDeformationSample
├── id
├── topologyId
└── offsets[]
    ├── vertexId
    ├── dx
    └── dy
```

A MeshDeformationTrack references compatible samples and optional weights using stable vertex IDs only.

Phase 8 evaluation order is:

```text
Transition mesh geometry
-> Warp
-> Bone / Skinning
-> Key-Art/Transition MeshFormCorrection
-> mixed MeshDeformationTrack offsets
-> node/world transform
```

This keeps animation correction non-destructive and after skeletal deformation.

If later production requires a distinct pre-skin mesh animation layer, it must be introduced explicitly as a different typed track rather than changing this shipped order silently.

## 14. CameraTrack

Initial Phase 8 CameraTrack is Sequence-owned shot motion, not a reusable Clip target.

It lives in the Sequence-owned TemporalProgram and evaluates absolute 2D camera state:

```text
CameraTrack
├── positionX
├── positionY
├── rotation
└── scale
```

Only one authoritative CameraTrack set may resolve for one Sequence tick. Same-scope conflicting camera tracks are validation errors.

Reusable camera clips and camera-layer mixing are deferred.

## 15. Existing opacity and discrete tracks in clips

Phase 8 may expose node/semantic targets for existing Opacity / Presence / DrawOrder / Clipping track families where required by production.

Initial composition semantics are explicit:

### Opacity

Clip opacity is a multiplier around identity `1`.

For sampled multiplier `m` and ClipInstance weight `w`:

```text
weightedMultiplier = 1 + w * (m - 1)
finalOpacity = baseOpacity * product(weightedMultipliers)
```

### Presence / DrawOrder / Clipping

These are discrete overrides.

Rules:

1. disabled or zero-weight ClipInstances do not contribute;
2. highest explicit `layer` wins;
3. same-layer identical values are compatible;
4. same-layer incompatible values produce a structured conflict diagnostic;
5. insertion order never resolves the conflict;
6. a ClipInstance containing active discrete overrides must use `weight = 1` in the initial model.

Appearance blending remains primarily Transition-owned in initial Phase 8. General reusable appearance clips are deferred until a concrete production use requires them.

## 16. Canonical Phase 8 evaluation order

This order is compatibility-critical.

```text
1. Validate Sequence references and tick
2. Resolve active ViewLane item
3. Resolve Key-Art/Transition semantic base state
4. Resolve active ClipInstances and deterministic local clip ticks
5. Sample Sequence/Clip TemporalPrograms
6. Mix typed animation contributions

7. MeshKeyform base + Transition geometry
8. Key-Art/Transition Warp keyform + DeformerTrack deltas
9. Existing Warp evaluation
10. Key-Art/Transition Bone pose + BoneTrack deltas
11. Existing Bone rotation constraints
12. Existing FK + rigid attachment / SkinBinding
13. Key-Art/Transition MeshFormCorrection
14. MeshDeformationTrack animation correction
15. Base node transform + TransformTrack deltas
16. Resolve node/world transforms
17. Resolve opacity / appearance / presence / draw order
18. Resolve clipping using final evaluated geometry/alpha
19. Evaluate Sequence CameraTrack
20. Emit ordinary EvaluatedFrame
21. Shared renderer consumes EvaluatedFrame unchanged
```

Important implementation constraint:

> Sequence evaluation must not take a fully flattened Transition render result and then invent post-hoc Bone/Warp semantics on top.

The existing Transition evaluator remains the semantic authority for Key-Art correspondence, PartTransition mode, endpoint interpolation, appearance, presence, draw order, and clipping intent. Phase 8 may refactor shared evaluation stages so Sequence can insert reusable animation contributions at the correct existing Warp/Bone/Form/Transform boundaries, but it must not create a parallel Transition implementation.

## 17. Deterministic mixer rules

Continuous contributions use fixed typed identities rather than generic property paths.

Initial rules:

| Type | Composition |
| --- | --- |
| node position delta | additive |
| node rotation delta | additive |
| node scale factor | multiplicative |
| Bone local delta | additive |
| Warp control-point delta | additive |
| post-skin mesh offset | additive |
| opacity multiplier | multiplicative |
| presence | highest-layer discrete override |
| draw order | highest-layer discrete override |
| clipping | highest-layer discrete override |
| camera | Sequence-owned absolute state |
| events | stable merge |

For continuous contributions, `layer` does not suppress lower layers in the initial model. It participates in canonical sort order and remains available for future explicit override modes.

No continuous `override` mode is added in initial Phase 8. Adding one later requires a typed persisted composition mode and migration review.

## 18. Events and regions

Existing MotionEvent and MotionRegion remain metadata/semantic editing primitives.

Sequence evaluation merges events from active programs in stable source order with explicit source identity.

Events do not directly mutate pixels.

Useful Phase 8 events may include:

```text
blink
contact
release
occlusion_change
depth_crossing
marker
```

Ease presets remain UI conveniences that compile to existing explicit Bezier control points.

## 19. Authoring UI boundary

The minimum Phase 8 UI is a focused short-shot editor.

### Sequence / ViewLane

- create/select Sequence;
- set Sequence duration through its owned TemporalProgram;
- Key Art strip;
- insert/remove/reorder KeyArtHold and TransitionInstance;
- resize holds/transitions;
- continuity diagnostics;
- deterministic scrub/play.

### Clip library / instances

- list/create/delete AnimationClips;
- add ClipInstance to Sequence;
- drag placement;
- trim range;
- rational speed/retime control;
- Once/Loop;
- weight;
- layer;
- enable/disable.

### Track authoring

- TransformTrack;
- BoneTrack;
- DeformerTrack;
- MeshDeformationTrack;
- CameraTrack;
- supported opacity/discrete tracks as needed;
- keyframe CRUD;
- step/linear/Bezier;
- ease presets compiled to Bezier;
- selected target displayed by stable identity.

One persistent gesture produces one Command/history unit. Drag/scrub previews remain transient.

A graph editor is explicitly deferred until track semantics prove stable in production.

## 20. Commands and queries

Exact names follow repository conventions, but the headless surface should cover semantic operations equivalent to:

```text
sequence.create
sequence.update
sequence.remove
sequence.add_view_item
sequence.update_view_item
sequence.remove_view_item
sequence.add_clip_instance
sequence.update_clip_instance
sequence.remove_clip_instance
sequence.evaluate
sequence.get_diagnostics

animation.clip.create
animation.clip.update
animation.clip.remove
animation.clip.get
animation.clip.list
```

Existing `animation.temporal.*` commands remain the authority for TemporalProgram track/keyframe/event/region mutation.

Do not add a second clip-specific keyframe mutation family when the existing temporal commands can express the edit.

Multi-object operations such as Sequence + TemporalProgram creation and AnimationClip + TemporalProgram creation are atomic transactions.

## 21. Diagnostics

Initial machine-readable Phase 8 diagnostics should include equivalents of:

```text
SEQUENCE_INVALID_TIME
SEQUENCE_VIEW_GAP
SEQUENCE_VIEW_OVERLAP
SEQUENCE_VIEW_CONTINUITY_MISMATCH
SEQUENCE_TRANSITION_REFERENCE_INVALID
SEQUENCE_TRANSITION_ENDPOINT_MISMATCH

ANIMATION_CLIP_REFERENCE_INVALID
ANIMATION_CLIP_PROGRAM_OWNERSHIP_INVALID
ANIMATION_INSTANCE_RANGE_INVALID
ANIMATION_INSTANCE_SOURCE_RANGE_INVALID
ANIMATION_PLAYBACK_RATE_INVALID
ANIMATION_LOOP_ENDPOINT_MISMATCH
ANIMATION_TRACK_TARGET_INVALID
ANIMATION_TRACK_CONFLICT
ANIMATION_DISCRETE_WEIGHT_INVALID
ANIMATION_TOPOLOGY_INCOMPATIBLE
```

Structural invalidity marks preview non-authoritative. Diagnostics do not silently rewrite persistent state.

## 22. Persistence, migration, and identity

All new persistent objects use stable IDs and existing deterministic serialization conventions.

Rules:

- no transient playhead/selection state is serialized;
- no array index is an animation target identity;
- BoneTrack targets stable Bone ID;
- DeformerTrack targets stable Deformer/control-point ID;
- MeshDeformationTrack targets stable topology/vertex IDs;
- old projects load with empty/default Sequence/AnimationClip collections;
- migrations never synthesize authored motion from names or geometry heuristics;
- Save/Open preserves evaluation-equivalent state.

## 23. Preview and export parity

Sequence becomes another caller of the existing deterministic frame pipeline.

The frame planner remains authoritative for export frame ticks.

At an export tick:

```text
planned frame tick
-> sequence.evaluate
-> EvaluatedFrame
-> SharedCompositionRenderer
-> Preview / PNG / MP4 source frame
```

The renderer remains Sequence/Clip/BoneTrack/DeformerTrack unaware.

The same Project + Sequence + tick must produce equivalent EvaluatedFrame output before/after Save/Open and in preview/export paths.

## 24. Implementation split

### 8-1 Sequence and ViewLane Domain Foundation

- Sequence + owned TemporalProgram;
- KeyArtHold / TransitionInstance;
- strict contiguous ViewLane validation;
- deterministic local Transition tick mapping;
- Commands / Queries / persistence / migration / Undo-Redo;
- headless base-state resolution.

### 8-2 AnimationClip and ClipInstance Foundation

- AnimationClip + owned TemporalProgram;
- ClipInstance placement;
- rational playback rate;
- source offset;
- Once / Loop semantics;
- Commands / Queries / persistence / migration / Undo-Redo;
- no mixer yet beyond local-time sampling proof.

### 8-3 General Animation Typed Tracks

- TransformTrack;
- BoneTrack;
- DeformerTrack;
- MeshDeformationTrack;
- Sequence CameraTrack;
- required opacity/discrete target extensions;
- typed validation and pure sampling tests.

### 8-4 Deterministic Sequence / Clip Mixer

- active clip resolution;
- canonical contribution order;
- continuous composition;
- discrete override conflict handling;
- integration at Warp/Bone/Form/Transform boundaries;
- EvaluatedFrame output;
- preview/export parity.

### 8-5 Key Art Strip and Timeline Authoring

- Sequence/ViewLane UI;
- Clip library and placement;
- supported track lanes;
- keyframes and timing controls;
- scrub/play;
- one gesture -> one history unit.

### 8-6 Motion Authoring Polish and E2E Production Proof

- reusable Blink / Breath / HairSway;
- at least three Key Arts in one shot;
- ordinary node + Warp + Bone + form motion mixed with Key-Art transitions;
- loop proof;
- Save/Open and Undo/Redo proof;
- Windows production-style preview/export proof.

## 25. Regression requirements

Cover at least:

1. Sequence stable identity and owned-program persistence;
2. ViewLane full coverage validation;
3. gap rejection;
4. overlap rejection;
5. deterministic ViewLane resolution independent of insertion order;
6. A -> B -> C boundary continuity;
7. TransitionInstance exact start/end local mapping;
8. terminal Sequence tick behavior;
9. AnimationClip stable identity and owned-program persistence;
10. ClipInstance Save/Open and Undo/Redo;
11. rational playback-rate mapping without accumulated drift;
12. one-shot trimming;
13. invalid one-shot source overrun rejection;
14. loop exact-period wrap maps to phase zero;
15. loop endpoint mismatch diagnostic;
16. multiple active clip resolution independent of insertion order;
17. TransformTrack additive/multiplicative numeric proof;
18. ClipInstance weight identity behavior;
19. BoneTrack over Key-Art pose;
20. Bone rotation constraints after clip mixing;
21. DeformerTrack before Warp;
22. MeshDeformationTrack after skin/form base correction;
23. stable vertex/control-point identity after save/reload;
24. opacity multiplicative composition;
25. highest-layer discrete override;
26. same-layer discrete conflict diagnostic;
27. Transition base + clip overlay exact evaluation order;
28. clipping after final deformation;
29. camera applied at shot stage;
30. repeated same Sequence/tick -> equivalent EvaluatedFrame;
31. scrub does not mutate Project/history;
32. Save/Open preserves equivalent Sequence evaluation;
33. Preview / PNG evaluated-plan parity;
34. Preview / MP4 source-frame parity;
35. headless sequence evaluation without DOM;
36. full existing Phase 1-7 regression suite remains green.

## 26. Acceptance criteria

Phase 8 is complete when a production-style short shot can:

- chain at least three Key Arts;
- reuse existing Transitions between adjacent Key Arts;
- create and reuse at least Blink, Breath, and HairSway clips;
- combine clip motion with node, Warp, Bone/Skinning, form correction, clipping, and camera semantics;
- loop reusable clips deterministically;
- scrub/play deterministically;
- Save/Open without semantic loss;
- Undo/Redo all persistent authoring operations;
- export PNG/MP4 through the existing deterministic frame/render path;
- operate fully offline without AI/cloud runtime.

## 27. Explicitly out of scope

- full DAW/NLE workflow;
- audio editing;
- graph editor before production semantics stabilize;
- nested clip graphs;
- continuous clip blending with arbitrary masks;
- runtime physics/spring/ragdoll;
- CCD/FABRIK or general iterative IK;
- persistent runtime IK targets;
- arbitrary expression/driver graph;
- full Live2D parameter compatibility;
- generative frame interpolation;
- automatic AI motion generation;
- network MCP server unless separately scoped.

## 28. Design checkpoint

Before Phase 8-1 implementation begins, this document and the general-animation sections of `docs/animation-data-model.md` must agree on:

- Phase numbering;
- Sequence ownership;
- ClipInstance timing;
- loop endpoint behavior;
- additive/multiplicative contribution semantics;
- discrete conflict semantics;
- Bone constraint order;
- Deformer/Warp order;
- post-skin mesh animation order;
- renderer boundary.

If an implementation discovers a contradiction with the actual Phase 6/7 merged architecture, update the design explicitly before inventing a compatibility-breaking behavior in code.
