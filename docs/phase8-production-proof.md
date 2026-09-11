# Phase 8 production proof

This document records the deterministic short-shot proof used to complete Issue #70 Phase 8-6.
The fixture is deliberately small and generated from explicit IDs in
`product/tests/helpers/phase8-production-proof.js`; it adds no binary artwork and requires no
network, cloud, or AI runtime.

## Shot

The one 600-tick Sequence is authored through `SequenceTimelineController`, existing Commands,
and the ordinary owned `TemporalProgram` lifecycle.

| Sequence ticks | ViewLane item | Source duration | Production state |
| --- | --- | ---: | --- |
| `[0, 100)` | Hold A | — | Open pose |
| `[100, 200)` | Transition A/B | 80 ticks | Retimed A to forward pose |
| `[200, 300)` | Hold B | — | Forward pose |
| `[300, 400)` | Transition B/C | 120 ticks | Retimed B to settled pose |
| `[400, 600]` | Hold C | — | Settled pose; terminal tick is inspectable |

A, B, and C use distinct mesh positions, Bone poses, Warp keyforms, and form corrections. The
internal boundaries belong to the later item. The Sequence terminal is inclusive for inspection;
ClipInstance placements remain half-open.

## Reusable motion

There is no preset-specific evaluator, renderer behavior, track type, or persistent schema.

| Clip | Existing typed tracks | Target and authored motion | Placement |
| --- | --- | --- | --- |
| Blink | `TransformTrack.scaleY` | Semantic slot `slot_eye`; `1 -> 0.08 -> 1` at local ticks `0, 20, 40` | The same Clip ID is placed at `[80, 220)` and `[420, 460)`; the first crosses Hold A, Transition A/B, and Hold B |
| Breath | `TransformTrack.positionY`, `BoneTrack.rotation`, `MeshDeformationTrack.deformation` | Semantic body motion, constrained chest rotation, and ordinary deformation sample; endpoints match | One looping placement `[0, 600)` |
| HairSway | Two `DeformerTrack.deltaX` tracks | Stable control-point IDs in nested `warp_outer -> warp_inner`; endpoints match | One looping placement `[0, 600)` |
| Shot Accent | `TransformTrack.positionX` | Stable node target `background` | One once placement `[200, 400)` |

At exact periods, looping instances resolve to local phase zero. At Sequence tick 600 all ending
instances are inactive. The authored KeyArt, BonePose, WarpDeformer, and form-correction keyforms
are deep-compared before and after evaluation to prove playback does not mutate them.

## Ease convenience

The UI convenience compiles immediately to the existing explicit `interpolationToNext` value.
Only the four Bezier numbers persist, and the existing numeric editor remains authoritative.

| UI label | Explicit cubic Bezier `(x1, y1, x2, y2)` |
| --- | --- |
| Ease In | `(0.42, 0, 1, 1)` |
| Ease Out | `(0, 0, 0.58, 1)` |
| Ease In Out | `(0.42, 0, 0.58, 1)` |

The convenience is rejected for discrete channels. Save/Open tests verify that no preset name or
preset identity is serialized.

## Combined evaluator and renderer proof

The shot combines KeyArt/Transition base motion, node and SemanticSlot transforms, Deformer/Warp,
Bone constraints/FK/rigid binding, form correction, mesh deformation, and clipping in the canonical
Phase 8 evaluation order. The nested cage changes both the visible hair mesh and the rigid-bound
body projection. The eye is clipped by the final deformed mask while Blink and HairSway are active.

One production regression was exposed by this composition: a Morph transition's internal mesh lost
its known `topologyId` before `MeshDeformationTrack` processing. The evaluator now carries that
existing topology identity internally; the public `EvaluatedFrame` shape and renderer boundary are
unchanged.

| Representative tick | Expected activity |
| ---: | --- |
| 0 | Hold A; loop phase zero |
| 50 | Hold A; Breath Bone/form peak approaching; HairSway peak |
| 150 | A/B midpoint maps exactly to source tick 40; cross-boundary Blink is closing/opening |
| 250 | Hold B; node Shot Accent plus Breath and HairSway |
| 350 | B/C midpoint maps exactly to source tick 60 |
| 450 | Hold C; second Blink active; Breath and HairSway active; clipping uses final geometry |
| 600 | Final C state inspectable; no ending ClipInstance is active |

Save/Open compares stable semantic evaluation at all representative categories: Sequence start,
both transition midpoints, Hold B, active Blink, active loop, and terminal. Undo/Redo exercises a
coordinated ViewLane boundary edit, ClipInstance move and resize, track/keyframe authoring, and ease
application as one history unit each. Scrub and drag previews are verified history-free and absent
from serialized Project state.

Preview, PNG-frame export, and MP4 source-frame export are driven by the same
`sequence.evaluate -> EvaluatedFrame -> shared render plan` path and compared at every exported
source tick. Export uses the existing rational frame planner at 24 fps and therefore emits ticks
`0, 50, ... 550`; terminal tick 600 remains an inspection tick rather than an exported half-open
frame.

## Validation boundary

Automated tests cover the production data, Commands/Queries, timeline controller, evaluator,
shared renderer, PNG encoding boundary, and desktop MP4 source-frame job fully offline. Local
validation completed `npm --offline test` with 699/699 passing tests. A Windows x64 unpacked package
was produced with `npm --offline run desktop:pack`; inspection of its `app.asar` confirmed the
desktop entry, shell, timeline controller/view, and ease-preset module are packaged. Product CI and
Windows Desktop Package workflows provide the independent hosted checks after the pull request is
opened.

Interactive launch, scrub, Save/reopen, PNG output review, and actual FFmpeg-backed MP4 encoding in
a packaged Windows GUI require a Windows desktop runner and are reported separately in the pull
request; they are not represented as completed by Linux automation.
