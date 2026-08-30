# FLAMORIS 2D Key Art Transition Design

Status: draft

## 1. Core idea

FLAMORIS 2D should not assume that one illustration is the only visual source for a shot.

The primary MV workflow should support at least two authored images:

```text
Start Key Art (A)
  -> editable transition
  -> End Key Art (B)
```

The start and end images may each be layered PSDs. The user should be able to rig the start image, then reuse the same logical mesh topology and controls while positioning that mesh over the end image to describe where each point arrives.

Long term, a shot is a sequence or graph of Key Arts:

```text
A -> B -> C -> D
```

This enables pose changes, turns, entrances/exits, expression redraws, and art-directed transitions that are difficult to express as deformation of one texture alone.

## 2. Product distinction

The editor is therefore better described as:

> A PSD-native, key-art-transition and clip-first 2D rigging editor for short MV animation shots.

A traditional single-art rig remains supported, but multi-key-art authoring is a first-class workflow rather than an export trick.

## 3. Domain model

```text
Project
├── SourceAsset[]
├── SemanticSlot[]
├── KeyArt[]
│   ├── sourceAssetId
│   ├── SceneState
│   └── PartAppearance[]
├── Transition[]
│   ├── fromKeyArtId
│   ├── toKeyArtId
│   ├── duration
│   ├── PartTransition[]
│   └── curves
└── Sequence
    └── KeyArt/Transition instances
```

### 3.1 SemanticSlot

A SemanticSlot identifies the meaning of a thing independently of a particular PSD layer.

Examples:

```text
body.head
body.arm.left.upper
eye.left.white
eye.left.iris
hair.front.center
```

Each Key Art maps its actual scene nodes/layers to these slots.

This is required because the layer name or even the layer count may differ between drawings.

### 3.2 KeyArt

A KeyArt is an authored visual state, not merely a flattened image.

It may contain:

- source PSD reference
- scene hierarchy
- texture assignment
- node transform state
- mesh keyform for compatible parts
- visibility/presence state
- clipping relationships
- draw order/depth state
- optional bone/deformer pose

### 3.3 Transition

A Transition is an editable relationship between two Key Arts.

Each semantic part can choose a transition mode instead of forcing one global interpolation method.

## 4. Shared mesh topology with per-Key-Art keyforms

For a part that exists in both A and B, prefer shared mesh topology:

```text
MeshTopology
├── stableVertexIds[]
└── indices[]

MeshKeyform A
├── positionsA[]
└── uvA[]

MeshKeyform B
├── positionsB[]
└── uvB[]
```

The user may generate the topology on A, then switch to B and move the same stable vertices over the target artwork.

This directly answers the core authoring need:

> Create the mesh on the first illustration, then reuse that mesh over the last illustration so the destination of every vertex is visible and editable.

### 4.1 Geometry interpolation

For compatible topology:

```text
position_i(t) = lerp(positionA_i, positionB_i, curve(t))
```

The interpolation curve may initially be Linear or Ease and later Bezier.

### 4.2 Dual-texture morph

Geometry interpolation alone is insufficient when the end drawing contains a genuinely redrawn shape or shading.

For compatible topology, the renderer should support two texture/UV sets during a transition:

```text
Texture A + UV A
Texture B + UV B
       ↓
intermediate triangle geometry
       ↓
blend A/B by transition weight
```

Conceptually:

```text
color(t) = (1-w) * sample(textureA, uvA)
         +    w  * sample(textureB, uvB)
```

Each source texture is mapped through its own UVs onto the same interpolated triangle geometry. This is the mesh-based image-morphing model.

Do not require UV A and UV B to be identical.

## 5. Transition modes

Not every part should be morphed. Minimum modes:

### Morph

Same semantic object, compatible topology.

Examples:

- face from front to slight 3/4
- hand from one pose drawing to another
- redraw of front hair

Uses geometry interpolation and optionally dual-texture blend.

### Hold

Keep one appearance/pose unchanged for all or part of the transition.

### Crossfade / Replace

Use when A and B represent the same concept but topology/correspondence is not trustworthy.

### Appear

Part exists in B but not A.

Initial implementation can animate opacity and optional scale/position/mask reveal.

### Disappear

Reverse of Appear.

### Occlusion

The semantic object still exists but is hidden in one Key Art by another part.

This must be distinct from `absent` so a limb, eye, or hair section can continue to exist logically while becoming invisible.

Suggested presence enum:

```text
present
occluded
absent
```

### Swap

A-only and B-only visual parts replace each other, useful when a turn changes which drawing layers are appropriate.

## 6. Turns and major viewpoint changes

A front-to-side or front-to-back turn should not be forced into one enormous deforming mesh.

Treat each major view as a Key Art / View State:

```text
Front
  -> 3/4
  -> Side
  -> Back
```

Semantic slots connect related content across views.

During each edge:

- compatible parts morph,
- occluded parts hide,
- new-view parts appear,
- incompatible redraws crossfade/swap,
- clipping and draw order may change.

This gives the user explicit control over what a turn means visually instead of pretending unseen artwork can be reconstructed deterministically from the first image.

## 7. Draw order and occlusion changes

Key Arts may have different layer ordering.

V1 should support:

- per-Key-Art draw order
- transition-time visibility/opacity
- explicit step change of draw order at a user-selected point when necessary

Later options:

- continuous depth values
- clipping-aware transitions
- user-authored occlusion masks
- automatic crossing suggestions

A sudden layer-order change must be visible/editable in the timeline rather than hidden inside the renderer.

## 8. AI-assisted correspondence

Automatic correspondence is useful, but must remain a suggestion layer.

### 8.1 Layer/semantic mapping

AI can propose:

```text
A: eye_left_iris
B: 左目_虹彩
=> semantic slot: eye.left.iris
```

Signals can include:

- layer names
- hierarchy
- alpha-mask geometry
- relative body position
- visual features

### 8.2 Vertex correspondence

For a mesh created on A, AI can propose target positions on B.

Candidate assistance methods:

1. user landmarks / anchors
2. piecewise-affine mesh morphing
3. optical-flow estimates for small appearance/view changes
4. semantic dense correspondence for larger pose/view changes
5. hybrid: AI proposal + user-pinned anchors + smooth solve

The saved project stores the resulting target positions, not an opaque AI output.

### 8.3 Confidence

Every automatic mapping should report confidence and ambiguity.

Low-confidence correspondences should require user review instead of silently becoming rig data.

## 9. Deterministic first implementation

The first implementation should not depend on a neural model.

Suggested workflow:

1. Import Key Art A PSD.
2. Rig/mesh selected parts.
3. Add Key Art B PSD.
4. Map B layers to semantic slots.
5. Reuse A's stable mesh topology on B.
6. User positions mesh vertices over B, with proportional editing and anchors.
7. Preview geometry interpolation.
8. Enable dual-texture blend.
9. Mark unmatched parts as Appear/Disappear/Hold/Swap.
10. Save Transition as project data.

This is testable and production-safe before AI correspondence exists.

## 10. Assisted target-mesh solve

A useful intermediate feature before full AI matching is anchor-driven deformation.

The user pins a small number of corresponding points:

```text
A shoulder -> B shoulder
A elbow    -> B elbow
A wrist    -> B wrist
```

The system solves the remaining mesh positions smoothly.

Possible mathematical families to evaluate:

- piecewise affine interpolation
- barycentric propagation
- thin-plate spline
- ARAP-style deformation

The result is still ordinary editable mesh keyform data.

## 11. Research notes

Relevant concepts found during design research:

- Delaunay triangulation + piecewise affine warping is a standard deterministic approach for image morphing between corresponding landmarks/triangles.
- Optical-flow systems such as RAFT estimate dense pixel motion and may help initialize correspondence when changes are visually continuous.
- DINO/Stable-Diffusion feature based semantic correspondence research can match semantically related locations across larger appearance or viewpoint changes and may be useful for suggestions.
- Thin-Plate-Spline motion models demonstrate smooth image deformation from sparse motion structure, but learned image-animation models should remain optional helpers rather than the core editable representation.

These are research directions, not dependencies or code-copy commitments. Licenses and runtime requirements must be reviewed before adopting any implementation.

## 12. Multiple Key Arts

Once A -> B works, generalize without changing the model:

```text
A -> Transition AB -> B -> Transition BC -> C
```

The UI should eventually allow a Key Art strip above/beside the timeline.

Possible later graph form:

```text
          -> Smile B
Neutral A
          -> Turn B
```

Graph branching is useful for reusable character rigs but is not required for the first MV production beta.

## 13. Acceptance criteria for first Key Art transition milestone

A user can:

1. import two layered Akino PSDs,
2. map corresponding parts,
3. create a mesh on a part in A,
4. reuse the same stable mesh topology over B,
5. reposition B's mesh keyform,
6. scrub an interpolated A-to-B geometry transition,
7. blend the start and end part textures through their own UV mappings,
8. mark unmatched parts as appear/disappear/hold,
9. save/reload with exactly the same result,
10. undo/redo correspondence and target-keyform edits.

Success condition:

> A deliberately redrawn start pose and end pose can be connected by an editable, deterministic transition without requiring the user to animate every intermediate frame manually.
