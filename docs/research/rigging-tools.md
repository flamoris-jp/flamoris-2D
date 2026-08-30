# 2D Rigging Tool Research

Status: research note for FLAMORIS 2D basic design

## Purpose

This document records architectural and feature references from existing 2D rigging and animation tools. It is not a specification to copy any product. The goal is to identify proven concepts, avoid feature omissions, and decide what belongs in FLAMORIS 2D for short-form MV production.

## 1. Inochi2D / Inochi Creator

Repositories:

- `Inochi2D/inochi2d`
- `Inochi2D/inochi-creator`

Relevant findings from the current repositories:

- Indexed textured meshes with vertices, UVs, and triangle indices.
- Base mesh and deformed mesh are separated.
- Deformation is represented as point/vertex deltas.
- Hierarchical node architecture.
- `LatticeDeformer` provides grid control points and subdivisions.
- `MeshDeformer` can deform child nodes and maps child points through source triangles using barycentric coordinates.
- Current Inochi2D contains actual bone nodes. Bones form skeletal hierarchies and deform targets using per-point bone weights.
- Inochi Creator contains a command/action architecture and an action stack.
- Inochi Creator contains node, parameter, timeline, inspector, and history panels.
- Inochi Creator has PSD import, autosave, image/video export, grid automesh, contour automesh, and multiple mesh editor tools such as point, brush, lasso, connect, path deformation, and selection.

### Lessons for FLAMORIS 2D

1. Keep immutable base geometry separate from evaluated/deformed geometry.
2. Treat hierarchy and deformers as first-class model objects, not only UI folders.
3. Introduce a command layer before editor operations become numerous.
4. Undo/redo, autosave, scene hierarchy, timeline, and PSD import are editor foundations rather than polish.
5. Grid mesh can remain the fast default, but contour-based mesh generation should be an optional later tool.
6. Bones and lattice/mesh deformers can coexist. They solve different classes of editing problems.

## 2. Live2D Cubism

Reference: current official Cubism Editor documentation.

Relevant concepts:

- PSD import and PSD re-import are part of the production workflow.
- The Parts palette provides hierarchical organization, visibility, lock, filtering, and selection.
- Deformer hierarchy is managed separately and can be inspected as parent-child relationships.
- Warp deformers provide group-like geometric deformation.
- Rotation deformers provide pivot-based movement and are also used by skinning workflows.
- Clipping masks are commonly used to keep an iris inside the eye-white area.
- Automatic mesh generation and manual mesh editing coexist.
- Manual mesh editing includes multiple editing modes rather than only single-point dragging.
- Glue binds overlapping ArtMesh vertices and can use per-vertex influence.
- Skinning provides bone-like deformation for hair and other connected parts.
- Parameters express reusable semantic motion states such as angle or mouth-open values.
- Blend Shapes store reusable form differences and can be blended by weight.
- Form Animation adds direct timeline-driven object/deformer transforms.
- Timeline editing includes tracks, keyframes, dope-sheet-style editing, and graph/easing workflows.
- Physics and automatic sway generation address secondary motion.
- Automatic deformer generation reduces repetitive humanoid rig setup.

### Lessons for FLAMORIS 2D

- A tree is necessary once a PSD contains dozens of parts.
- Masking and clipping are distinct concepts and should not be conflated.
- Pivot/transform editing should be available before full skeletal rigging.
- Reusable poses/forms and timeline clips are complementary.
- FLAMORIS 2D does not need to reproduce Cubism's complete parameter-centric authoring model. For MV production, clips can be the primary authoring model while semantic parameters remain optional drivers.

## 3. Stretchy Studio

Repository:

- `MangoLion/stretchystudio`

The project is especially relevant because it is a web-based JavaScript 2D character animation editor with direct PSD workflows.

Documented features and structure include:

- Native PSD import.
- Hierarchical draw order and grouping.
- Pivot adjustment.
- WebGL viewport and picking.
- Mesh generation and direct vertex deformation.
- Automatic eye clipping.
- Limb skinning.
- Blender-style shape keys.
- Timeline-first animation clips and keyframes.
- Project, animation, and editor state stores separated by responsibility.
- A four-zone editor concept: canvas, layers, inspector, timeline.
- AI/heuristic auto-rigging as a later productivity layer.

### Lessons for FLAMORIS 2D

This is strong evidence that the current FLAMORIS direction is technically coherent for a web editor. In particular, separating project state, animation state, renderer, mesh tools, and PSD I/O should happen before the prototype grows into one large editor module.

## 4. Iki

Repository:

- `zeikar/iki`

Interesting architectural choices:

- Open, versioned model format.
- WebGL runtime separated from editor logic.
- `format`, `engine`, and DOM-free `editor-core` packages are distinct.
- Editor core owns commands and undo/redo without depending on UI.
- Rotation deformers, pivots, parent hierarchies, warp meshes, group warp deformers, and 2D parameter grids are modeled explicitly.
- Validation and serialization round-trips are part of the model architecture.

### Lessons for FLAMORIS 2D

- Keep persisted model format separate from transient UI state.
- Keep editor commands usable without DOM/UI so future MCP calls can use the same operations.
- Validate references, parent cycles, and project schema at boundaries.
- Version project files from the beginning.

## 5. Godot 2D Skeletons

Reference: Godot 2D skeletal deformation documentation.

Useful concept:

- A skeleton deforms polygon/mesh vertices through painted bone weights.
- Bone weights are visualized and edited independently from the bone transform itself.

### Lesson

FLAMORIS bones should not simply rotate whole image rectangles. A production-quality implementation should support weighted influence on mesh vertices, even if the first bone milestone starts with simpler rigid attachment.

## 6. Synfig

Reference: Synfig bone and skeleton distortion documentation.

Useful concepts:

- Hierarchical bones for cutout animation.
- Skeleton distortion for bitmap/vector deformation.
- Linked controls and reusable transformations.

### Lesson

Rig controls, geometry deformation, and animation channels should remain separable. A bone can be a control object rather than the texture itself.

## 7. Feature patterns that repeatedly appear

Across the references, the following features appear repeatedly enough to treat them as foundational patterns:

- hierarchical scene tree
- stable object identity
- transforms and pivots
- mesh deformation
- group/warp deformation
- clipping/masking
- skeletal hierarchy and weights
- reusable form/shape states
- timeline/keyframes/easing
- undo/redo
- project serialization and versioning
- autosave/recovery
- selection/picking and lock/visibility
- re-import/update of source art
- export pipeline

The major differentiator for FLAMORIS 2D should therefore not be omission of these foundations. It should be workflow focus: fast authoring of short silent MV clips from PSD artwork, with reusable animation clips and later AI/MCP automation.