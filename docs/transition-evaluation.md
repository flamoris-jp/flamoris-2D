# FLAMORIS 2D Transition Evaluation

Status: draft for Phase 2 design review

## 1. Purpose

This document defines how FLAMORIS 2D deterministically evaluates a transition between two adjacent Key Arts at an arbitrary time.

It resolves the design space covered by:

- texture blending and final-frame pop risk;
- semantic correspondence between Key Arts;
- visibility, occlusion, opacity, and draw-order changes;
- transition feasibility and when an intermediate Key Art is required.

The renderer should not contain hidden transition rules. Transition semantics are evaluated by the core into ordinary renderer-ready part state.

## 2. Core rule: one Transition connects two adjacent Key Arts

A single `Transition` connects exactly two authored Key Arts:

```text
Key Art A
  -> Transition AB
Key Art B
```

Large viewpoint changes should be decomposed into several adjacent transitions rather than forced through one extreme mesh morph.

Preferred turn example:

```text
Back
  -> Back3Q
  -> Side
  -> Front3Q
  -> Front
```

This makes each transition smaller, more diagnosable, and more editable.

The sequence may still feel like one continuous eight-second action; internally it is several simple adjacent transitions plus ordinary motion clips/secondary animation.

## 3. Transition domain object

Conceptual model:

```text
Transition
├── id
├── fromKeyArtId
├── toKeyArtId
├── program: TemporalProgram
├── partTransitions[]
└── diagnosticOverrides[]
```

Per semantic part:

```text
PartTransition
├── semanticSlotId
├── mode
├── geometry policy
├── appearance policy
├── opacity policy
├── presence policy
├── draw-order policy
└── clipping policy
```

`TemporalProgram` and its typed tracks are defined in
`docs/animation-data-model.md`. `program.durationTicks` is the sole duration;
the Transition must not persist a second duration field. Diagnostics are derived
from current project data. Only scoped user acknowledgments are persistent.

## 4. Semantic correspondence is a prerequisite

A transition does not match parts by display/source names at evaluation time.

It relies on persistent confirmed semantic correspondence:

```text
Key Art A node
  -> SemanticSlot
  <- Key Art B node
```

Examples:

```text
eye.left.iris
hair.front.center
body.arm.right.forearm
```

A confirmed mapping may have been created manually, heuristically, or by an AI suggestion, but evaluation uses only saved deterministic project data.

When correspondence is unresolved or ambiguous, transition diagnostics must report it. The evaluator must not silently infer identity from names.

## 5. Initial transition modes

Keep the persistent mode set small.

```text
Morph
Hold
Replace
Appear
Disappear
Occlusion
```

A UI may offer convenience operations such as `Swap`, but these may compile to combinations of the core modes rather than creating a new persistent semantic.

### Morph

Same semantic object and compatible shared topology.

May interpolate geometry and optionally blend compatible appearances.

### Hold

Keep the selected source/base appearance/state unchanged for a configured interval or the whole transition.

### Replace

Use when A and B represent the same concept but geometry/texture correspondence is not safe enough for Morph.

A and B render instances may overlap briefly using an opacity handoff.

### Appear

A part is absent in A and becomes present in B.

### Disappear

A part is present in A and absent in B.

### Occlusion

The semantic object continues to exist but becomes hidden by viewpoint/depth/compositing.

`occluded` is distinct from `absent`.

## 6. Normalized transition time

For local transition time `localTicks`:

```text
u = clamp(localTicks / program.durationTicks, 0, 1)
```

The endpoints are inclusive: tick `0` evaluates Key Art A and tick
`program.durationTicks` evaluates Key Art B. Persistent sampling uses integer
ticks; normalized floating-point `u` is an evaluation intermediate and must
not be accumulated from frame to frame.

Individual tracks may use independent keyframe timing and curves. `u` is only the common normalized position through the transition.

There is no requirement that geometry, appearance, opacity, or visibility change with the same curve.

## 7. EvaluatedPartState

For each semantic part, transition evaluation produces a renderer-ready intermediate state.

```text
EvaluatedPartState
├── semanticSlotId
├── presence
└── renderInstances[]
    ├── renderInstanceId
    ├── node/source reference
    ├── transform
    ├── meshPositions
    ├── appearance/texture source
    ├── uv source
    ├── opacity
    ├── drawOrder
    └── clipping state
```

A list is required because `Replace` and handoff intervals can contain
independent A and B instances at the same tick. Each instance carries its own
geometry, UV, appearance, opacity, order, and clipping state; these values must
not be flattened into one ambiguous part payload.

Presence is semantic state, while `renderInstances` is the complete raster
instruction. `absent` emits no instances. `occluded` preserves semantic
identity but must already evaluate to no visible contribution (for example no
instance, zero effective alpha, validated clipping, or ordinary coverage by
other evaluated instances). The renderer does not invent how occlusion happens.

The renderer consumes evaluated render instances. It rasterizes and composites
them in explicit order, but does not decide whether a part is Morph, Replace,
or Occlusion. Transition diagnostics remain evaluator/query metadata rather
than renderer input.

## 8. Geometry evaluation

For `Morph`, shared topology is required.

```text
MeshTopology
├── stableVertexIds[]
└── indices[]
```

Each Key Art stores its own keyform:

```text
MeshKeyform A: positionsA[], uvA[]
MeshKeyform B: positionsB[], uvB[]
```

Geometry sampling:

```text
p_i(u) = lerp(
  positionA_i,
  positionB_i,
  geometryWeight(u)
)
```

`geometryWeight(u)` is sampled from the transition's temporal tracks/curves.

Required safety checks before/while authoring Morph:

- equal compatible topology and stable vertex identity;
- no missing keyform for required vertices;
- triangle inversion detection;
- excessive edge/area stretch and compression diagnostics;
- invalid/degenerate triangles;
- optional silhouette mismatch diagnostics.

If topology is incompatible, Morph is invalid rather than best-effort.

## 9. Geometry vs animation deformation

Transition geometry describes the changing base/key-art form.

Normal animation/rig deformation is separate and applies through the shared evaluation pipeline.

Conceptually:

```text
Transition base geometry
  -> rig/bone/deformer evaluation
  -> animation/form correction
  -> node/world transform
```

Do not bake reference-video optical flow directly into the transition keyforms as opaque state.

## 10. Appearance timing is independent from geometry timing

A common bad transition is:

```text
geometry: A ----------------------> B
texture:  A A A A A A A A A A A B
```

The final texture swap creates a visible pop.

Instead, geometry and appearance have independent temporal behavior.

Example:

```text
0%                           100%
|-------------------------------|

Geometry:
A ----------------------------> B

Appearance blend window:
A -------------\
                \-----------> B
              45%          80%
```

Per-part appearance timing is allowed. Hair, face, eyes, mouth, clothes, and accessories may need different windows.

## 11. Dual-texture Morph

For compatible Morph parts, A and B may be sampled simultaneously on the current interpolated geometry.

```text
Texture A + UV A ----┐
                     ├-> current interpolated mesh
Texture B + UV B ----┘
```

Conceptually:

```text
color = sampleA * alphaA + sampleB * alphaB
alphaA = 1 - appearanceWeight
alphaB = appearanceWeight
```

Important rules:

- UV A and UV B may differ;
- appearance weight is not required to equal geometry weight;
- alpha/appearance curves may cover only a sub-range of the transition;
- the blend must be deterministic at arbitrary `t`;
- source artwork is never replaced only on the final frame unless explicitly authored as a step.

## 12. Appearance state is broader than A/B texture blend

Large view changes may require authored intermediate appearances rather than a mathematical blend between two textures.

For example:

```text
Back
Back3Q
Side
Front3Q
Front
```

A Side face is not assumed to be reconstructible as `50% Back + 50% Front`.

When a direct blend produces double features, ghosting, or severe silhouette mismatch, use one of:

1. `Replace`;
2. an intermediate Key Art;
3. a compatible authored appearance state;
4. a user-approved generated reference imported as normal project art.

The editor should diagnose the problem rather than hiding it behind an opaque quality score.

## 13. Opacity and presence are independent

Presence enum:

```text
present
occluded
absent
```

Opacity remains a numeric render property.

Examples:

- a left eye hidden during a side view is `occluded`;
- a decorative part that does not exist in a target drawing may be `absent`;
- a present part may temporarily use opacity 0 during a handoff.

This distinction preserves semantic identity through viewpoint changes.

## 14. Occlusion transition

A naive step from visible to hidden can pop.

Preferred authored pattern:

```text
present + opacity 1
        ↓
short opacity/clipping handoff
        ↓
occluded
```

Example timeline:

```text
0.00        0.45      0.55         1.00
|------------|----------|-------------|

opacity
1.0 -----------\
                \----> 0

presence
present ----------------> occluded
                          ^
                       discrete event/step
```

The exact handoff interval is editable per part.

Occlusion is not required to use opacity if clipping/masking gives a better deterministic result, but the state change must remain explicit.

## 15. Draw-order transition

Key Arts may require different part ordering.

Draw order is discrete and evaluated from explicit transition state. Within a
compositing scope, authored draw-order values must be unique at a sampled tick
or validation must provide an explicit stable tie-break key. Accidental array or
insertion order is not a valid tie-break.

A raw one-frame swap may pop when two parts cross. The minimum deterministic model permits:

```text
before crossing:
  Arm behind Body

crossing interval:
  optional opacity/clipping handoff

after crossing:
  Arm in front of Body
```

A `depth_crossing` event may label the semantic crossing time, but the visual result is still produced by ordinary draw-order/opacity/clipping state.

No renderer-only hidden z-order heuristic is allowed.

## 16. Replace evaluation

`Replace` does not require compatible topology.

During the replacement window, A and B may be separate render instances:

```text
A opacity: 1 --------\____ 0
B opacity: 0 ____/-------- 1
```

Each instance retains its own geometry, UV, texture, mask/clipping, and draw order as needed.

The overlap window is explicit and may be shortened to reduce ghosting.

For highly incompatible silhouettes, a hard step can be explicitly authored, but the editor should warn when the step is likely visible.

## 17. Appear and Disappear

### Appear

Conceptual state sequence:

```text
absent
  -> present with opacity 0
  -> opacity 0..1
```

### Disappear

```text
opacity 1..0
  -> absent
```

Optional position/scale/mask reveal may be added through ordinary temporal tracks; they are not special hidden behaviors of the mode.

## 18. Clipping state

Clipping relationships may differ by Key Art.

Example:

```text
Front: iris -> ClipTo eye_white_front
Side:  iris -> ClipTo eye_white_side
```

Phase 2 minimum behavior:

- each endpoint can define its clipping relationship;
- a transition may explicitly step/handoff between valid clipping states;
- evaluated clipping is deterministic and inspectable.

Mask/clipping morphing beyond this minimum belongs to the later clipping/deformer phase.

## 19. Transition evaluation order

For each active part at transition time `t`:

```text
1. Resolve confirmed semantic correspondence
2. Resolve transition mode
3. Sample transition tracks/curves
4. Evaluate base geometry / endpoint render instances
5. Resolve appearance/texture/UV contribution
6. Resolve opacity
7. Resolve presence
8. Resolve draw order
9. Resolve clipping state
10. Emit EvaluatedPartState with zero or more complete render instances
```

The complete frame pipeline then layers rig/animation/camera according to `docs/animation-data-model.md`.

## 20. Example: Back-to-Front turn

A generated eight-second turn showed a natural sequence approximating:

```text
Back
 -> Back3Q
 -> Side
 -> Front3Q
 -> Front
 -> settle
```

A FLAMORIS 2D shot should represent this as adjacent transitions rather than `Back -> Front` in one edge.

Illustrative timing:

```text
0.0s          1.3     2.2     3.2     4.4     5.7          8.0
|--------------|-------|-------|-------|-------|-------------|
Back hold
               Back -> Back3Q
                       Back3Q -> Side
                               Side -> Front3Q
                                       Front3Q -> Front
                                                Front settle
```

The exact timing is authored, not hard-coded.

Ordinary animation may overlay:

```text
BodyTurnCorrection
HairFollow
Blink
Breath
```

This separates large authored view state from reusable secondary motion.

## 21. Transition diagnostics

The product must not assume every Key-Art pair is suitable for direct interpolation.

Diagnostics should be deterministic and reason-specific where practical.

Candidate codes:

```text
TRANSITION_MISSING_CORRESPONDENCE
TRANSITION_TOPOLOGY_INCOMPATIBLE
TRANSITION_TRIANGLE_INVERSION
TRANSITION_GEOMETRY_STRETCH_HIGH
TRANSITION_GEOMETRY_COMPRESSION_HIGH
TRANSITION_UV_DISTORTION_HIGH
TRANSITION_SILHOUETTE_MISMATCH
TRANSITION_TEXTURE_GHOSTING_RISK
TRANSITION_MULTIPLE_OCCLUSION_CHANGES
TRANSITION_DRAW_ORDER_CROSSING
TRANSITION_PART_PRESENCE_MISMATCH
TRANSITION_INTERMEDIATE_KEYART_RECOMMENDED
```

Avoid one opaque `qualityScore` as the sole decision mechanism.

A summary may still classify severity:

```text
safe
warning
unsafe
```

but the underlying reasons must be inspectable.

## 22. Intermediate Key Art recommendation

When direct A -> B is risky, the system may recommend an intermediate authored state.

Example:

```text
Front -> Side
```

may become:

```text
Front -> Front3Q -> Side
```

or:

```text
Back -> Back3Q -> Side -> Front3Q -> Front
```

Recommendation rules may consider:

- severe silhouette change;
- extreme geometry displacement/stretch;
- multiple simultaneous occlusion changes;
- unstable semantic correspondence;
- texture ghosting risk;
- major viewpoint change;
- user-defined transition policy.

The system does not automatically commit generated artwork as a Key Art.

AI/generative workflow:

```text
Diagnostics
  -> suggest intermediate view
  -> optionally generate reference
  -> user reviews/imports
  -> normal CreateKeyArt / mapping commands commit it
```

## 23. User override

A user may explicitly accept a risky transition.

The project should store the ordinary authored transition plus an explicit
scoped acknowledgment. An acknowledgment identifies at least the diagnostic
code, affected semantic slot/transition scope, and an evidence revision or
fingerprint. It becomes stale when relevant geometry, mapping, appearance, or
policy changes. Accepting a warning does not convert an unsafe transition into
safe status; it changes review state only.

Potential command semantics:

```text
transition.accept_diagnostic(transitionId, diagnosticKey)
transition.clear_diagnostic_override(...)
```

The exact command naming and fingerprint representation may be decided during
implementation, but code-only global suppression is not allowed.

## 24. MCP/query surface

Suggested deterministic queries:

```text
transition.get
transition.evaluate
transition.get_diagnostics
transition.preview_info
```

Suggested mutations:

```text
transition.create
transition.set_part_mode
transition.set_curve
transition.set_presence_key
transition.set_draw_order_key
transition.set_appearance_window
transition.accept_diagnostic
```

Higher-level semantic operations may include:

```text
connect_key_arts
suggest_intermediate_key_art
prepare_turn_sequence
```

They compile to normal transition/key-art commands and never create opaque persistent state.

## 25. Relationship to existing design issues

This document is intended to provide the shared evaluation model for:

- Issue #8: Key-Art transition rendering / final-frame texture jump;
- Issue #9: semantic part correspondence;
- Issue #10: occlusion, visibility, and layer-order changes;
- Issue #11: transition feasibility and intermediate Key Art.

Those issues remain useful as focused acceptance/checklist discussions. This
document supplies the common model that connects them.

| Issue | Retained responsibility | Supplied here / not redesigned there |
| --- | --- | --- |
| #8 | prove no final-frame texture pop for representative parts | independent geometry/appearance tracks, dual-source render instances, Replace fallback |
| #9 | correspondence authoring, confirmation, split/merge/missing cases, re-import behavior | evaluator consumes confirmed `SemanticSlot` mappings only |
| #10 | authoring and QA of presence, occlusion, clipping handoffs, and crossings | typed Presence/DrawOrder/Clipping state and deterministic sampling |
| #11 | thresholds, fixtures, severity policy, override UX, intermediate-Key-Art workflow | reason-specific diagnostic contract and non-authoritative recommendation flow |

#19 owns the shared Temporal Core and evaluator contract. #8-#11 should not
introduce alternate timing containers, runtime name matching, renderer-only
transition rules, or a second feasibility score model.

## 26. Phase 2 implementation boundary

In scope for the first transition foundation:

- adjacent two-Key-Art `Transition` object;
- explicit semantic correspondence dependency;
- Morph/Hold/Replace/Appear/Disappear/Occlusion modes;
- shared-topology geometry interpolation;
- independent geometry and appearance curves;
- dual-texture sampling with per-Key-Art UVs for compatible Morph parts;
- opacity and `present/occluded/absent` state;
- explicit draw-order state/events;
- deterministic clipping-state handoff minimum;
- machine-readable feasibility diagnostics;
- save/load/undo/redo/validation;
- deterministic arbitrary-time evaluation.

Deferred to Phase 6:

- reusable AnimationClip authoring and ClipInstance sequencing;
- general multi-track timeline, mixer, looping, retiming, and graph editor;
- production bone/deformer/mesh animation authoring;
- combining multiple reusable clips with Transition output.

Deferred beyond the Phase 2 foundation:

- automatic generated intermediate artwork as committed state;
- advanced mask morphing;
- continuous true depth model;
- neural correspondence as required runtime;
- full animation timeline/mixer UI;
- advanced graph-based view-state authoring.

## 27. Acceptance criteria

The transition evaluator is ready when automated tests can prove:

1. the same saved project evaluates identically before and after reload;
2. Morph uses stable shared topology and endpoint keyforms;
3. incompatible topology fails validation instead of silently morphing;
4. geometry and appearance are independently sampled;
5. a dual-texture transition does not require an instantaneous final-frame texture replacement;
6. opacity, `present`, `occluded`, and `absent` are distinguishable in evaluated state;
7. draw-order changes are explicit and deterministic;
8. Replace can overlap independent A/B render instances without requiring shared topology;
9. Appear/Disappear transitions explicitly change presence rather than only opacity;
10. diagnostic codes expose why a direct transition is risky;
11. the system can recommend an intermediate Key Art without automatically committing one;
12. UI, tests, and MCP obtain transition results from the same headless evaluation core.
