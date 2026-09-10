# Phase 8: Multi-Key-Art Animation and Clip Sequencing

Status: design reviewed against `main` at `710879fac1eed76ee87abf2c1b096a99ca609dd4`; ready for implementation review

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

### 2.1 Baseline evaluator seams verified by design review

The merged Phase 6/7 implementation already evaluates each Transition render
instance in this order:

```text
MeshKeyform / Transition interpolation
-> create/evaluate Warp stages
-> constrained Bone pose -> projected FK -> rigid attachment or Skinning
-> MeshFormCorrectionKeyform
-> node/world transform on the render instance
-> resolveEvaluatedClipping
-> evaluatedParts / compositeGroups
-> SharedCompositionRenderer
```

The current evaluator reaches those stages through
`transition-evaluator.js`, `warp-deformer-evaluator.js`,
`bone-fk-evaluator.js`, `rigid-bone-evaluator.js`,
`skin-mesh-evaluator.js`, and `mesh-form-correction-evaluator.js`.
`evaluateBoneFk` already accepts a transient `poseForBone` provider, but the
Transition wrappers do not yet thread a Phase 8 provider through. Warp cage
construction likewise has no animation-control-point provider yet. These are
shared-stage extension seams, not permission to create a Sequence-only Warp,
Bone, Skinning, form, or Transition evaluator.

The baseline `TemporalProgram` typed union already reserves TransformTrack,
CameraTrack, and MeshDeformationTrack. BoneTrack and DeformerTrack are not yet
production definitions and must be added to that same union in Phase 8-3.

## 3. Product concepts

Phase 8 separates three concepts that were already anticipated by the earlier animation model:

```text
POSE   = authored Key Art / rig state
MOTION = reusable time-varying delta
SHOT   = when poses, transitions, and motions happen
```

The Phase 8 persistent collection shape becomes:

```text
Project
├── KeyArt[]
├── Transition[]
├── TemporalProgram[]
├── animation
│   ├── clips: AnimationClip[]
│   └── deformationSamples: MeshDeformationSample[]
└── sequences: Sequence[]
```

`TemporalProgram` stays the one typed finite-time primitive shared by Transition, AnimationClip, and the Sequence's shot-level program.

Schema 12's `animation` object (including `clips`, `tracks`, and `keyframes`)
and singular `sequence` array are untyped future placeholders. They are not an
alternate animation authority. Phase 8 retains the `animation.clips` collection
name, adds `animation.deformationSamples` and typed `sequences`, and removes the
obsolete parallel `animation.tracks`, `animation.keyframes`, and `sequence`
fields. As with the earlier untyped Warp/Bone placeholders, migration resets
untyped placeholder entries to empty collections instead of promoting them;
schema 12 had no Phase 8 authoring or evaluation contract to preserve.

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

That program provides the Sequence duration and may initially contain one
absolute CameraTrack plus shot-level events/regions. It does not contain
ClipInstances or reusable character motion tracks; those remain in the
Sequence and AnimationClip collections respectively. Sequence does not
duplicate `durationTicks`.

Ownership rules match Transition ownership:

- one Sequence owns exactly one TemporalProgram;
- one TemporalProgram may not be multiply owned by Transition, AnimationClip, or Sequence;
- ownership is explicit and validated;
- creation/removal that affects both objects is transactional and one Undo/Redo unit.

The existing Transition-only program-owner check must become one project-wide
ownership check covering Transition, AnimationClip, and Sequence. Owner-aware
validation also constrains legal track kinds/targets. In particular,
`transitionDefault` remains valid only in a Transition-owned program,
CameraTrack is valid only in a Sequence-owned program initially, and a
Sequence program may not smuggle in clip motion or a second ViewLane.

The Sequence's program duration defines the legal shot domain:

```text
0 <= sequenceTick <= sequenceProgram.durationTicks
```

Schema 12 also persists `project.renderSettings.durationTicks`, but production
Transition export already ignores it and plans from the Transition-owned
program. Phase 8 removes that field during schema migration rather than leaving
an ambiguous second shot clock. It has no Phase 8 replacement:

- `renderSettings.frameRate` and `renderSettings.alpha` remain render settings;
- every Transition, AnimationClip, and Sequence duration comes only from its
  exclusively owned `TemporalProgram`;
- creation commands require an explicit `durationTicks`; an editor may suggest
  a non-persistent eight-second default, but that suggestion is not Project
  authority;
- migration drops legacy `renderSettings.durationTicks` after existing
  TemporalPrograms have been migrated; it does not copy that value over an
  already-authored program duration;
- validation rejects the removed field in the new exact schema shape so it
  cannot silently regain authority.

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

The evaluator must extract/share the Key-Art base-state resolution used by the
existing Transition evaluator rather than introducing a second Key-Art
rendering model. The current Project does not store a canonical MeshKeyform ID
on each KeyArt member, while a Transition's PartTransition does. Therefore the
initial standalone hold rule is strict:

- resolve members through confirmed SemanticSlot mappings, never names;
- no compatible MeshKeyform for a present member uses the same bounds fallback
  as an endpoint without an authored keyform;
- exactly one compatible MeshKeyform for `(keyArtId, semanticSlotId)` uses that
  keyform;
- more than one candidate topology/keyform is structurally ambiguous and emits
  `SEQUENCE_KEYART_BASE_AMBIGUOUS` rather than choosing by array order.

This restriction may later be replaced by an explicit canonical KeyArt mesh
binding, but no adjacency or display-name heuristic may silently become that
authority.

### 5.4 TransitionInstance

A TransitionInstance references one existing Transition. It does not copy SemanticSlot, PartTransition, track, Warp, Bone, or clipping semantics.

Instance-local transition time is derived directly from placement:

```text
localTransitionTick =
  roundHalfUpRatio(
    (sequenceTick - startTicks) * transitionDurationTicks,
    endTicks - startTicks
  )
```

with exact endpoint rules:

```text
sequenceTick == startTicks -> 0
sequenceTick == endTicks   -> transitionDurationTicks
```

for terminal evaluation only. At an internal ViewLane boundary, the next item owns the Sequence tick and must be semantically compatible with the Transition endpoint.

This gives deterministic per-instance retiming without persisting floating-point speed. The multiplication/division uses exact integer arithmetic before the existing non-negative round-half-up rule; it must not pass through a JavaScript `Number` product that may exceed the safe integer range. `roundHalfUpRatio` denotes one shared temporal helper extracted from the existing `temporal.js` convention, not a Sequence-specific rounding implementation.

### 5.5 View continuity validation

For adjacent ViewLane items, validate endpoint continuity structurally and at
the existing evaluated endpoint boundary.

Examples:

```text
Hold(A) -> Transition(A,B) -> Hold(B)
Transition(A,B) -> Transition(B,C)
```

are valid.

Matching KeyArt IDs are necessary but not sufficient. The outgoing item's
terminal base state and the incoming item's initial base state must resolve to
compatible source-node/SemanticSlot membership, selected MeshTopology and
MeshKeyform, Warp/Bone/form state, appearance, presence, draw order, and
clipping intent. This catches, for example, two Transitions that both name
KeyArt B but select different B MeshKeyforms. A mismatch emits
`SEQUENCE_VIEW_ENDPOINT_INCOMPATIBLE` and the Sequence is non-authoritative.

Mismatched chains diagnose before render-authority is claimed. Validation may
reuse deterministic endpoint evaluation; it must not raster-compare pixels.

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

Clip placement remains half-open even when `endTicks` equals Sequence
duration. Terminal Sequence inspection resolves the last ViewLane endpoint and
Sequence camera, but an instance ending there is inactive; no special terminal
clip sample is invented.

## 8. Clip local-time projection

For an active ClipInstance:

```text
elapsed = sequenceTick - startTicks

rawLocal = sourceOffsetTicks
  + roundHalfUpRatio(elapsed * rateNumerator, rateDenominator)
```

The product and division use exact integer arithmetic before conversion back to
a safe integer tick. No accumulated floating-point delta is allowed.

### 8.1 once

For `loopMode = once`, `sourceOffsetTicks` is in
`[0, clipDurationTicks]`. The instance is valid only while every active
Sequence tick maps to the inclusive clip program domain.

Because placement is half-open, the last active Sequence tick is
`endTicks - 1`. Validation uses the exact bound:

```text
lastRawLocal = sourceOffsetTicks
  + roundHalfUpRatio(
      (endTicks - startTicks - 1) * rateNumerator,
      rateDenominator
    )

lastRawLocal <= clipDurationTicks
```

An instance whose authored range violates that bound is invalid rather than
silently holding or wrapping.

Trimming shorter than the source clip is valid.

`endTicks` is not an implicit Clip sample. Therefore a half-open one-shot
instance does not promise to sample the source terminal key automatically. The
terminal key remains directly inspectable through inclusive TemporalProgram
sampling, and it is sampled by a Sequence instance only when an active mapped
tick equals `clipDurationTicks`.

### 8.2 loop

For `loopMode = loop`, `sourceOffsetTicks` uses the canonical range
`[0, clipDurationTicks)`. Repetition uses the clip program duration as the
period:

```text
phase = euclideanModulo(rawLocal, clipDurationTicks)
```

The repeating phase domain is:

```text
[0, clipDurationTicks)
```

Therefore an exact positive multiple of the clip duration maps to phase 0, not to the terminal keyframe.

This avoids duplicate seam samples.

The terminal clip key at `clipDurationTicks` remains directly inspectable in clip editing and may be sampled by a valid one-shot instance, but it is never sampled as a loop phase.

A loop whose render-affecting channel values differ between tick 0 and
`durationTicks` is legal but surfaces `ANIMATION_LOOP_ENDPOINT_MISMATCH`.
Numeric channel comparison uses the explicit `1e-9` tolerance already used by
temporal validation conventions; discrete/reference values use canonical deep
equality. Events/regions are metadata and are not seam-compared. Seam
correction is never silently invented.

## 9. Typed animation contribution model

Phase 8 general animation tracks describe motion contributions relative to the currently resolved Key-Art/Transition base state.

The initial reusable-motion model intentionally prefers deltas over absolute overrides.

This makes one Blink/Breath/HairSway clip usable across compatible Key Arts without rewriting their authored base pose.

Continuous clip contributions are mixed in ascending canonical
`(layer, clipInstanceId, trackId, channel, targetStableId)` order before
numeric accumulation. IDs are stable Project identities and track/keyframe IDs
remain globally registered as in the existing validator. The mathematical
rules below are designed to be commutative where practical; canonical ordering
additionally fixes floating-point accumulation order.

Track meaning is owner-aware but never inferred from UI context. For example,
a Transition-owned OpacityTrack retains its existing absolute-opacity meaning,
while an AnimationClip-owned OpacityTrack is validated/evaluated as an opacity
multiplier around identity. Exclusive TemporalProgram ownership makes that
scope unambiguous in persistent data.

### 9.1 Typed angular sampling

Phase 8 extends the one shared temporal sampler; it does not add a Bone-only,
Clip-only, or Sequence-only sampling path. `TEMPORAL_TRACK_DEFINITIONS` gains
per-channel value-interpolation metadata, and `sampleTemporalProgram()` selects
the value interpolator by `(track.kind, channelName)` while continuing to use
the existing key ordering, boundary behavior, step handling, and linear/Bezier
time progress.

Initial angular channels are:

```text
BoneTrack.rotation       -> angle-shortest-arc-bone-compatible
TransformTrack.rotation  -> angle-shortest-arc-bone-compatible
CameraTrack.rotation     -> angle-shortest-arc-bone-compatible
```

All existing Transition numeric channels and all other numeric channels retain
ordinary scalar interpolation. For an angular interval, the sampler first
computes progress with the existing linear or Bezier time curve, then applies:

```text
delta = (to - from) remainder (2 * PI)
if delta > PI:  delta -= 2 * PI
if delta < -PI: delta += 2 * PI
value = from + delta * progress
```

This is the exact existing Phase 7 `shortestBoneRotationDelta()` boundary:
`to - from == +PI` remains `+PI`, and `to - from == -PI` remains `-PI`.
Implementation may extract that function into a shared angular utility, but it
must preserve the Phase 7 result and use it from both Bone pose interpolation
and the typed temporal sampler.

The existing Transition endpoint-transform helper currently uses a different
`[-PI, PI)` tie and maps an exact positive half-turn to `-PI`. That legacy
endpoint interpolation remains unchanged and authoritative for Transition
base transforms. TransformTrack/CameraTrack key sampling uses the
Bone-compatible signed half-turn rule above; applying a TransformTrack delta
does not redefine Transition endpoint interpolation. The two deterministic tie
contracts are intentionally explicit rather than being called one universal
repository convention.

Authored and sampled angles remain finite radians and are not forcibly
normalized afterward. A deliberate turn greater than `PI` must use
intermediate keys whose individual arcs express the intended direction; at
exactly `PI`, the sign of the authored difference selects the direction. A
future explicit turns/unwrapped-angle type must not change this shipped channel
meaning.

## 10. TransformTrack

Initial general TransformTrack supports either one stable Scene node or one
stable SemanticSlot, always in the resolved node's local space.

```text
TransformTrack
├── target
│   ├── { nodeId, coordinateSpace: node-local }
│   └── { semanticSlotId, coordinateSpace: node-local }
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

Target resolution is part of Sequence evaluation, not clip authoring UI state:

- a `nodeId` target applies only to that exact Scene node;
- a node-targeted ClipInstance is compatible only when that same node is the
  active mapped source for every present ViewLane state intersected by the
  instance; crossing a Transition to a different mapped node emits
  `ANIMATION_CLIP_TARGET_INCOMPATIBLE` and makes evaluation non-authoritative;
- a reusable clip intended to span A/B/C Key Arts targets a `semanticSlotId`;
- on a KeyArtHold or single-endpoint Transition mode, a semantic target resolves
  to the present mapped node for that Key Art;
- on Morph, the same sampled local delta is applied independently to both
  endpoint mapped nodes before their world transforms are resolved, after
  which the existing endpoint-transform interpolation remains authoritative;
- on Replace, the delta is applied independently to every active endpoint
  render instance for the slot, including the dual-instance interval;
- on Appear/Disappear/Occlusion/Hold, it applies to the endpoint node selected
  by the existing Transition mode;
- an absent semantic endpoint contributes no render instance and therefore no
  transform, while an unknown or structurally ambiguous mapping diagnoses.

In every case the contribution applies before descendant world transforms are
resolved. Applying one matrix to a completed render instance would lose
parent/group semantics and is not allowed.

Absolute Transform override tracks are deferred until production evidence requires them.

## 11. BoneTrack

BoneTrack targets one existing stable Bone ID and animates a delta relative to the active Key-Art Bone pose.

```text
BoneTrack
├── target: { boneId }
└── local-delta channels
    ├── x
    ├── y
    └── rotation
```

The base pose is the already-authored Key-Art/Transition `BonePoseKeyform`
result. For Morph it is the existing shortest-arc endpoint interpolation; for
Hold/Appear/Disappear/Occlusion it is the selected endpoint; for Replace each
endpoint render instance receives the same mixed clip delta over its own
endpoint base pose.

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

Implementation threads the mixed transient pose through the existing
`evaluateBoneFk(..., { poseForBone })` seam and through the existing
rigid/Skinning wrappers. It does not write BonePoseKeyform or clamp each clip
before mixing. The single existing constraint clamp runs once on the final
mixed local delta immediately before FK.

Keyframe interpolation of a Bone rotation channel uses the shared typed
shortest-arc rule in section 9.1. Clip-to-clip mixing adds the resulting local
rotation deltas after sampling.

## 12. DeformerTrack

DeformerTrack targets stable Warp control-point identity.

Initial conceptual target:

```text
DeformerTrack
├── target: { deformerId, controlPointId }
└── deltaX / deltaY channels
```

Values are additive deltas in the Warp Deformer's authored local lattice space.
For nested Warp, the delta is added to the child cage before that cage is
projected through its parent Warp stages.

Evaluation order:

```text
Key-Art/Transition WarpDeformerKeyform
+ mixed DeformerTrack control-point deltas
-> existing deterministic Warp evaluator
```

Playback never rewrites WarpDeformerKeyform.

The same transient overlaid cage must be used both for mesh deformation and
for the existing post-Warp Bone bind-frame projection. Supplying the overlay to
only one path would make skin matrices disagree with the warped mesh and is an
evaluation error.

If a target control point does not exist in the active compatible deformer state, evaluation diagnoses the incompatibility rather than guessing by array index or geometry proximity.

## 13. MeshDeformationTrack

Reusable mesh/form animation remains separate from MeshKeyform and MeshFormCorrectionKeyform.

Initial persistent sample form:

```text
MeshDeformationSample
├── id
├── meshId
├── topologyId
└── offsets[]
    ├── vertexId
    ├── dx
    └── dy
```

A MeshDeformationTrack preserves the already-reserved typed target/value shape:
`target: { meshId }` and a deformation value containing
`{ deformationSampleId, weight }`. The referenced sample adds the required
`topologyId` and sparse stable-vertex offsets. The active evaluated topology
must equal the sample topology; array-index, position, and name matching are
forbidden.

For each referenced offset, the contribution is
`offset * sampledDeformationWeight * clipInstanceWeight`. Multiple compatible
contributions add in the canonical mixer order. Continuous interpolation may
retain the existing rule that both endpoint values reference the same sample;
changing `deformationSampleId` requires a step or a separately authored
compatible typed morph contract.

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
├── target: { cameraId: main }
├── positionX
├── positionY
├── rotation
└── scale
```

Only one CameraTrack may exist in a Sequence-owned TemporalProgram. Same-scope
conflicts are validation errors. Missing channels use the identity shot camera
defaults `(positionX=0, positionY=0, rotation=0, scale=1)`; scale must be finite
and greater than zero.

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
3. Resolve Key-Art/Transition semantic intent and unflattened rig base state
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
17. Resolve opacity / appearance / presence / draw order and clip discrete intent
18. Run the existing clipping resolver using final evaluated geometry/alpha
19. Evaluate Sequence CameraTrack
20. Emit ordinary EvaluatedFrame
21. Shared renderer consumes EvaluatedFrame unchanged
```

Important implementation constraint:

> Sequence evaluation must not take a fully flattened Transition render result and then invent post-hoc Bone/Warp semantics on top.

The existing Transition evaluator remains the semantic authority for Key-Art correspondence, PartTransition mode, endpoint interpolation, appearance, presence, draw order, and clipping intent. Phase 8 may refactor shared evaluation stages so Sequence can insert reusable animation contributions at the correct existing Warp/Bone/Form/Transform boundaries, but it must not create a parallel Transition implementation.

Required shared seams are explicit:

| Existing stage | Phase 8 transient input | Required behavior |
| --- | --- | --- |
| KeyArt/Transition base | active ViewLane item | reuse correspondence, mode, endpoint, and appearance rules |
| Warp stage creation | mixed control-point deltas | overlay before nested parent projection and reuse for mesh plus Bone-frame projection |
| Bone pose resolution | mixed local Bone delta provider | one constraint clamp after mixing, then existing projected FK |
| Skin/rigid wrappers | the same evaluated Bone poses | no Sequence-only skin path |
| Form correction | existing Key-Art/Transition correction | apply first, then post-skin MeshDeformationTrack |
| Scene transform resolution | mixed node-local Transform deltas | resolve ancestry before emitting final world transforms |
| Clipping resolver | final parts plus mixed discrete clipping intent | resolve sourceRenderInstanceId only after all deformation/transforms |

This refactor may introduce an internal, typed unflattened evaluation context,
but that context is transient and shared by Transition and Sequence evaluation.
It is not persisted and is not a second semantic model.

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

For continuous contributions, `layer` does not suppress lower layers in the initial model. It participates in the ascending canonical accumulation order and remains available for future explicit override modes.

No continuous `override` mode is added in initial Phase 8. Adding one later requires a typed persisted composition mode and migration review.

## 18. Events and regions

Existing MotionEvent and MotionRegion remain metadata/semantic editing primitives.

Sequence evaluation reports exact-tick events from active programs in stable
`(sequenceTick, sourceScope, clipInstanceId, programId, eventId)` order with
explicit source identity. `sourceScope` is the fixed literal order `sequence`
then `clip`; Sequence events have no clipInstanceId. Playback side-effect/event
dispatch across a time interval is separate from pure frame evaluation and may
not mutate Project/history.

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
SEQUENCE_KEYART_BASE_AMBIGUOUS
SEQUENCE_VIEW_ENDPOINT_INCOMPATIBLE
SEQUENCE_TRANSITION_REFERENCE_INVALID
SEQUENCE_TRANSITION_ENDPOINT_MISMATCH

ANIMATION_CLIP_REFERENCE_INVALID
ANIMATION_CLIP_PROGRAM_OWNERSHIP_INVALID
ANIMATION_INSTANCE_RANGE_INVALID
ANIMATION_INSTANCE_SOURCE_RANGE_INVALID
ANIMATION_PLAYBACK_RATE_INVALID
ANIMATION_LOOP_ENDPOINT_MISMATCH
ANIMATION_TRACK_TARGET_INVALID
ANIMATION_CLIP_TARGET_INCOMPATIBLE
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
- schema 12's untyped `animation`/`sequence` placeholder entries are not
  reinterpreted as Phase 8 authored state;
- schema 12's `renderSettings.durationTicks` is removed without replacing or
  overriding any owned TemporalProgram duration;
- canonical serialization orders AnimationClips, Sequences, ViewLane items,
  ClipInstances, deformation samples, and nested stable-ID entries explicitly;
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

At the reviewed baseline, preview/export adapters and result properties are
Transition-named (`evaluateTransitionExportFrame`, `evaluatedTransition`) even
though the shared renderer consumes only `evaluatedParts`/`compositeGroups`.
Phase 8 may generalize that adapter/envelope to an ordinary EvaluatedFrame, but
the frame planner, render plan, offscreen renderer, PNG writer, and MP4
source-frame path remain shared. Preview and every export format must call the
same `sequence.evaluate` source-frame function; format-specific evaluators are
not allowed.

The same Project + Sequence + tick must produce equivalent EvaluatedFrame output before/after Save/Open and in preview/export paths.

## 24. Implementation split

### 8-1 Sequence and ViewLane Domain Foundation

- Sequence + owned TemporalProgram;
- KeyArtHold / TransitionInstance;
- strict contiguous ViewLane validation;
- deterministic standalone KeyArtHold resolution and ambiguity diagnostics;
- evaluated endpoint compatibility validation between adjacent ViewLane items;
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
7. TransitionInstance exact rational local mapping and internal later-item boundary ownership;
8. terminal Sequence tick behavior;
9. AnimationClip stable identity and owned-program persistence;
10. ClipInstance Save/Open and Undo/Redo;
11. rational playback-rate mapping without accumulated drift;
12. one-shot trimming;
13. one-shot last-active-tick bound and source-overrun rejection;
14. loop exact-period wrap maps to phase zero;
15. loop endpoint mismatch diagnostic;
16. multiple active clip resolution independent of insertion order;
17. TransformTrack additive/multiplicative numeric proof, including a
    SemanticSlot target across A/B/C and Replace dual instances;
18. ClipInstance weight identity behavior;
19. BoneTrack over Key-Art pose;
20. Bone rotation constraints after clip mixing;
21. DeformerTrack before Warp;
22. MeshDeformationTrack after skin/form base correction;
23. stable vertex/control-point identity and topology compatibility after save/reload;
24. opacity multiplicative composition;
25. highest-layer discrete override;
26. same-layer discrete conflict diagnostic;
27. Transition base + clip overlay exact evaluation order;
28. clipping after final deformation;
29. camera applied at shot stage;
30. repeated same Sequence/tick -> equivalent EvaluatedFrame;
31. scrub does not mutate Project/history;
32. Save/Open preserves equivalent Sequence evaluation;
33. Sequence export frame planning uses only the Sequence-owned program even
    when loading a schema 12 fixture with a different legacy
    `renderSettings.durationTicks`;
34. Preview / PNG evaluated-plan parity;
35. Preview / MP4 source-frame parity;
36. headless sequence evaluation without DOM;
37. standalone KeyArtHold ambiguity rejection;
38. same-KeyArt/different-keyform ViewLane endpoint incompatibility rejection;
39. node-targeted TransformTrack crossing a differently mapped Key Art emits
    `ANIMATION_CLIP_TARGET_INCOMPATIBLE` independent of insertion order;
40. shared typed temporal sampling uses shortest-arc interpolation for
    BoneTrack, TransformTrack, and CameraTrack rotation while preserving
    existing Transition scalar samples and Bezier time curves;
41. exact `+PI`/`-PI` typed-channel ties preserve the Phase 7 Bone result,
    while existing Transition endpoint-transform `-PI` tie remains unchanged;
42. full existing Phase 1-7 regression suite remains green.

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

The repository review resolved the previously open architecture questions:

- Sequence duration authority is its exclusively owned TemporalProgram;
- ViewLane and ClipInstance boundary rules are explicit and different where required;
- Transition retiming and clip playback use exact rational projection;
- Warp, Bone, form, transform, clipping, camera, and renderer stages have fixed insertion points;
- canonical mixer order and same-layer discrete conflicts do not use insertion order;
- schema 12 placeholders are not silently promoted into typed Phase 8 state;
- renderer and Preview/PNG/MP4 source-frame parity remain downstream of one shared evaluation result.

No unresolved architecture question remains for Phase 8-1. If implementation
discovers a contradiction with the actual Phase 6/7 merged architecture,
update this design explicitly before inventing a compatibility-breaking
behavior in code.
