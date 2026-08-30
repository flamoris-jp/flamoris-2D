# Research Notes: Key Art Transition and Correspondence

Status: research notes, not implementation commitments

## Purpose

Investigate techniques that can help FLAMORIS 2D connect two or more authored illustrations while keeping the result editable and deterministic.

Core requirement:

```text
Start Key Art A
  -> shared/editable mesh correspondence
  -> End Key Art B
```

The saved project should contain normal mesh/keyform/mapping data. AI or learned models may suggest that data, but should not become opaque persistent state.

## 1. Classical mesh-based image morphing

Reference examples:

- `Robys01/Face-Morphing`
  - MediaPipe landmarks
  - Delaunay triangulation
  - piecewise affine warping
- `rivanshugoyal/Image-Morphing---Delaunay-Triangulation`
  - image morphing using corresponding control points and Delaunay triangles

Relevant lesson:

If two images have corresponding points and compatible triangle topology, each triangle can be interpolated geometrically and the two source images can be warped/blended into the intermediate triangle.

This strongly matches the FLAMORIS concept of:

```text
one stable MeshTopology
+ positions/UVs for Key Art A
+ positions/UVs for Key Art B
```

The face-specific landmark detection in these repositories is not directly applicable to arbitrary anime body parts, but the geometric morph model is.

## 2. Optical flow

Reference:

- `princeton-vl/RAFT`
  - dense optical-flow estimation between frames/images

Possible use:

- initialize target locations for vertices when A and B have relatively continuous appearance/motion
- suggest correspondence for cloth/hair/body regions when viewpoint change is modest

Risk:

Optical flow assumes useful visual continuity. It may fail or become misleading when:

- pose changes are large
- a part is redrawn with different shape
- viewpoint changes expose new content
- occlusion/disocclusion is significant

Therefore it should be an optional suggestion source, not the persistent representation.

## 3. Semantic correspondence

Reference:

- `Junyi42/sd-dino`
  - Stable Diffusion + DINO feature fusion for zero-shot semantic correspondence
- other DINO/SAM semantic-correspondence research repositories

Possible use:

Find semantically corresponding locations across images even when appearance or viewpoint changes more than optical flow can comfortably handle.

Potential FLAMORIS workflow:

```text
source mesh vertex / anchor
  -> extract source feature
  -> search target feature map
  -> suggest target location
  -> confidence + ambiguity review
  -> user accepts/refines
  -> save ordinary target vertex position
```

This may be useful for head turns, changed hand poses, or redrawn clothing contours.

## 4. Thin-plate spline motion models

Reference:

- `yoyo-nb/Thin-Plate-Spline-Motion-Model`
  - CVPR 2022 image animation using thin-plate spline motion representation

Relevant lesson:

Sparse motion/control structure can generate smooth non-rigid deformation.

For FLAMORIS, a non-neural TPS solve may already be useful as a deterministic target-mesh helper from user anchors.

A learned motion model could later be evaluated as an assist/reference generator, but should not replace editable mesh keyforms.

## 5. Existing 2D rigging tools

### Inochi2D / Inochi Creator

Relevant concepts already recorded elsewhere:

- indexed meshes
- base/deformed separation
- lattice deformers
- mesh deformers
- bone weighting
- PSD import
- action history
- timeline/editor separation

These are useful foundations for rigging once the A/B Key Art relationship is established.

### Stretchy Studio

Relevant concepts:

- PSD-first workflow
- scene hierarchy/groups
- mesh deformation
- eye clipping
- limb skinning
- shape-key-like deformation states
- timeline-first editor structure

The project appears closer to a single rigged source plus animation than to FLAMORIS's proposed multi-authored-Key-Art transition model, so FLAMORIS should borrow editor/rig ideas without losing its Key Art distinction.

### Iki

Relevant concepts:

- open/versioned format
- WebGL engine
- editor-core separated from UI
- commands/undo-redo
- deformers/keyforms

Especially useful as an architecture reference for keeping a headless core that AI/MCP can operate without DOM driving.

## 6. Recommended FLAMORIS progression

### Stage A: deterministic manual mapping

- same stable topology A/B
- user positions target keyform
- dual-texture morph
- explicit appear/disappear/hold modes

### Stage B: deterministic anchor solver

- user pins sparse correspondences
- system propagates smoothly using piecewise affine / TPS / ARAP-style approaches
- user refines result

### Stage C: AI suggestions

- semantic part mapping
- optical-flow target hints
- semantic-correspondence target hints
- confidence scoring
- review before commit

### Stage D: optional generated intermediate references

A generative/video model may produce reference frames for difficult transitions.

Those frames should be treated as:

- reference layers
- optional new Key Arts
- suggestion material

not as invisible state that the project cannot reproduce/edit.

## 7. Licensing/engineering caution

No external research repository is automatically approved as a dependency.

Before adopting code or models, review:

- software license
- model/checkpoint license
- redistribution terms
- GPU/runtime requirements
- browser/local integration cost
- maintenance status

It is acceptable to study algorithms and design concepts while implementing independent deterministic geometry code where appropriate.
