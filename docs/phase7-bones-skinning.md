# Phase 7: Bones and Skinning

Status: proposed for implementation

## 1. Goal

Phase 7 adds the minimum skeletal rigging needed to pose limbs and other large articulated forms efficiently while preserving FLAMORIS 2D's Key-Art-first, deterministic workflow.

Phase 7 has three product responsibilities:

1. **FK bones** — stable bone hierarchy, bind/rest setup, Key-Art-specific pose keyforms, and rigid part attachment.
2. **Weighted skinning** — stable per-vertex bone influences with deterministic linear blend skinning and practical weight authoring.
3. **Convenience** — rotation limits, analytic two-bone IK as an authoring helper, and explicit mirror helpers.

The target is not a full character-animation package. Bones complement existing Mesh and Warp authoring; they do not replace them.

## 2. Architectural constraints

Reuse the existing path:

~~~text
Human UI / AI-MCP / Tests
        -> Query / Command / Transaction
        -> Project
        -> Transition Evaluation Core
        -> Warp
        -> Bone / Skinning
        -> Form correction
        -> node/world transform
        -> resolved clipping
        -> EvaluatedFrame
        -> Shared Renderer
        -> Preview / Export
~~~

Rules:

- all persistent mutations go through Commands;
- Scene remains the only ownership/tree hierarchy;
- a Bone capability and its BoneNode share one stable ID;
- skin and rigid bindings are explicit influence relationships, not a second Scene hierarchy;
- MeshTopology stable vertex IDs are authoritative for weights and corrections;
- bone playback never rewrites MeshKeyform, WarpDeformerKeyform, or source artwork;
- the renderer receives final evaluated geometry and remains unaware of Bone/Skinning domain state;
- preview and export use the identical evaluated result;
- no parallel Transition evaluator, time model, renderer, or UI-only persistent rig state is introduced;
- BoneTrack remains a reserved Phase 8 animation concept; Phase 7 uses Key-Art-specific pose keyforms and existing Transition timing only.

## 3. Implementation split

Implement as five independently reviewable stages:

1. **7-1 Bone and FK Domain Foundation**
2. **7-2 FK Authoring, Rigid Attachment, and Transition Integration**
3. **7-3 Weighted Skinning Foundation**
4. **7-4 Weight Authoring, Form Correction, and End-to-End Integration**
5. **7-5 Rotation Constraints, Two-Bone IK, and Mirror Helpers**

Phase 7-5 is convenience work and must not destabilize the completed FK/Skinning evaluator.

## 4. Bone identity and hierarchy

A Bone is a rig capability attached to a BoneNode with the same stable ID.

~~~text
Scene
└── ArmRig
    └── BoneNode: upper_arm
        └── BoneNode: forearm
            └── BoneNode: hand
~~~

The Scene node owns parentId and children[]. Bone data must not persist a competing parent/child graph. A BoneNode may be rooted under an ordinary GroupNode or DeformerNode. A child BoneNode may have only a BoneNode as its nearest skeletal parent.

Initial persistent capability:

~~~text
Bone
├── id                    same stable ID as BoneNode
├── parentNodeId          mirrors SceneNode.parentId
├── restLocalTransform
│   ├── x
│   ├── y
│   └── rotation
├── length
└── enabled
~~~

The bone's local +X axis points from head to tip. Length must be finite and greater than zero. Scale and shear are excluded from the initial bind model so the rest frame remains unambiguous.

Changing bone hierarchy, rest transform, or length after dependent bindings/keyforms exist must either migrate all dependent data deterministically or be rejected. The initial implementation should reject unsafe changes rather than silently reinterpret authored work.

## 5. Bind/Edit mode vs Pose mode

Bone authoring has two semantic modes.

### Bone Edit mode

Changes skeleton structure or rest data:

- create/remove Bone;
- reparent Bone;
- move the rest head;
- change rest rotation or length;
- rename/display metadata.

These changes can invalidate bindings and must use structural Commands with full validation.

### Bone Pose mode

Changes the active Key Art's pose only:

~~~text
BonePoseKeyform
├── boneId
├── keyArtId
└── localDelta
    ├── x
    ├── y
    └── rotation
~~~

The delta is relative to the Bone rest-local transform. An absent pose keyform has the defined identity delta and does not cause runtime Project mutation. The first explicit pose edit creates the keyform through the normal Command boundary.

Root translation is supported. Non-root translation may be retained in the model for authored correction but the initial UI should emphasize rotation.

Selection, hover, drag preview, active mode, active Key Art, ghost pose, and IK targets are transient editor state.

## 6. FK evaluation

Bind matrices are evaluated parent-first from Bone rest-local transforms. Pose matrices are evaluated parent-first from the same rest transforms plus Key-Art pose deltas.

Without an upstream Warp:

~~~text
skinMatrix(bone) = globalPoseMatrix(bone) * inverse(globalBindMatrix(bone))
~~~

At identity pose, skinMatrix is identity.

Parent rotation moves all descendant bone frames. Sibling order and object insertion order must not affect evaluation.

### Warp before Bone

Phase 6 reserved this compatibility-critical order:

~~~text
MeshKeyform base
-> Transition geometry interpolation
-> Warp/Lattice Deformer
-> Bone/Skinning
-> form correction
-> node/world transform
~~~

Phase 7 must not change it.

When a skeleton is under one or more Warp ancestors, the evaluator projects each Bone bind frame through the already-evaluated Warp stages. It projects the bind head, tip, and a perpendicular reference point, then derives a deterministic post-Warp affine bind frame. Child bind relations are derived from these projected frames and FK pose deltas are composed parent-first in that post-Warp rig space.

Conceptually:

~~~text
projectedBind(bone) =
  affineFrame(
    warp(bindHead),
    warp(bindTip),
    warp(bindNormalPoint)
  )

projectedPose(root) =
  projectedBind(root) * poseDelta(root)

projectedPose(child) =
  projectedPose(parent)
  * inverse(projectedBind(parent))
  * projectedBind(child)
  * poseDelta(child)
~~~

This is a deterministic local affine interpretation after a non-affine Warp. Degenerate projected frames produce a diagnostic; evaluation must not fall back silently to a different order.

## 7. Rigid part attachment

Rigid attachment is an explicit one-bone influence relationship:

~~~text
RigidBoneBinding
├── id
├── targetNodeId
├── boneId
└── enabled
~~~

It does not reparent the target Scene node and therefore does not alter draw order, clipping relationships, or Warp ancestry. The target geometry is transformed by the selected Bone skin matrix before the ordinary node/world transform.

One target may have at most one enabled rigid binding and cannot simultaneously have an enabled weighted SkinBinding.

This stage provides a production proof before weighted skinning: upper arm, forearm, and hand parts can each follow their respective bones.

## 8. Weighted skinning model

Weighted skinning binds stable mesh vertices to stable Bone IDs.

~~~text
SkinBinding
├── id
├── targetNodeId
├── meshTopologyId
├── enabled
└── vertexWeights[]
    ├── vertexId
    └── influences[]
        ├── boneId
        └── weight
~~~

Rules:

- weights address MeshTopology vertexId, never array index;
- one target has at most one enabled SkinBinding;
- each vertex has one to four non-zero influences;
- every weight is finite and within 0..1;
- canonical normalized weights sum to 1 within the documented numeric tolerance;
- influence lists serialize in stable Bone ID order;
- duplicate Bone influences are invalid;
- referenced Bones exist and belong to one compatible skeleton space;
- the SkinBinding topology must match every evaluated MeshKeyform used by that target;
- topology mutation must deterministically extend/migrate weights or be rejected before mutation;
- deleting a referenced Bone is rejected until bindings are reassigned or removed.

Initial runtime evaluation uses deterministic 2D linear blend skinning:

~~~text
skinnedPosition(vertex) =
  sum(weight_i * skinMatrix(bone_i) * warpedPosition(vertex))
~~~

The pure evaluator is DOM-independent. CPU evaluation is sufficient for Phase 7; the Shared Renderer must not gain a second Bone-aware geometry path.

## 9. Key Art and Transition semantics

Bone rest topology, Bone stable IDs, rigid bindings, and SkinBindings are Project rig structure. BonePoseKeyform and post-skin form correction may differ per Key Art.

Morph uses the existing sampled geometryWeight:

- interpolate compatible endpoint mesh geometry;
- evaluate the existing interpolated Warp cages;
- interpolate compatible Bone pose deltas;
- use shortest-arc rotation interpolation;
- use linear translation interpolation;
- evaluate FK and skinning;
- interpolate compatible post-skin correction offsets;
- continue to node/world transform and clipping.

Hold, Appear, Disappear, and Occlusion use the selected endpoint's Bone pose/correction state. Replace preserves its existing dual-render-instance contract and evaluates each endpoint instance using that endpoint's pose/correction state.

Bone evaluation does not create persistent keyforms. Incompatible Bone identity, hierarchy, binding topology, or non-finite pose state emits deterministic diagnostics rather than inventing a pose.

Phase 7 does not add general BoneTrack authoring. Phase 8 may apply time-varying BoneTrack deltas after the Key-Art/Transition pose base using the same Bone IDs and FK evaluator.

## 10. Post-skin form correction

Large bends often need a small elbow, shoulder, clothing, or silhouette correction after linear blend skinning. This must not overwrite the source MeshKeyform.

~~~text
MeshFormCorrectionKeyform
├── targetNodeId
├── meshTopologyId
├── keyArtId
└── offsets[]
    ├── vertexId
    ├── x
    └── y
~~~

The correction is an optional additive offset in the post-Skinning, pre-node-transform geometry space. Absence means zero correction.

Evaluation order:

~~~text
base MeshKeyform
-> Transition mesh interpolation
-> Warp
-> FK / rigid attachment / weighted skinning
-> MeshFormCorrectionKeyform
-> node/world transform
~~~

The existing Mesh Layout mode remains responsible for artwork/topology placement. A dedicated Form Correction submode edits this post-skin layer so the two meanings cannot be confused.

## 11. Authoring UI

### Scene Tree and Inspector

- BoneNode entries use the normal Scene Tree;
- create child Bone, rename, select, and validated reparent;
- Bone Inspector shows rest head/rotation/length or active Key-Art pose delta according to mode;
- explicit active Key Art follows the existing Key State selection;
- rigid attachment and SkinBinding status are visible for the selected target.

### Viewport Bone tools

- draw/create Bone from head to tip;
- visible joints, bone body, parent link, selected highlight, and rotation handle;
- Bone Edit / Bone Pose mode switch;
- transient pose drag with one command/history entry on commit;
- optional endpoint ghost pose;
- no persistent viewport coordinates.

### Weight mode

- selected Bone heatmap;
- per-vertex numeric influence editor;
- paint Add/Subtract for the selected Bone;
- deterministic Normalize operation;
- one brush stroke commits one explicit set of canonical vertex weights;
- selection, brush radius/strength, stroke preview, and heatmap are transient;
- paint helpers calculate proposed weights in the controller, while the authoritative Command receives explicit stable-ID weights.

### Form Correction mode

- displays the final skinned geometry;
- edits only MeshFormCorrectionKeyform offsets;
- one drag commits one history unit;
- never mutates MeshKeyform, Bone pose, or SkinBinding implicitly.

## 12. Commands and Queries

Candidate Commands:

- bone.create
- bone.remove
- bone.rename
- bone.set_rest
- bone.reparent
- bone.set_keyform
- bone.reset_keyform
- bone.create_rigid_binding
- bone.remove_rigid_binding
- skin.create_binding
- skin.remove_binding
- skin.set_vertex_weights
- skin.set_weights_bulk
- mesh_form.set_keyform
- mesh_form.move_vertices
- mesh_form.reset_vertices

Candidate Queries:

- bone.list
- bone.get
- bone.get_keyform
- bone.get_evaluated_pose
- bone.validate
- skin.get_binding
- skin.get_vertex_weights
- skin.validate
- mesh_form.get_keyform

Exact naming should follow current repository conventions. Query and MCP-facing projections use stable IDs and domain coordinates and remain DOM-independent.

## 13. Constraints, IK, and mirror helpers

### Rotation constraints

A Bone rotation constraint stores finite minimum and maximum local delta angles. Pose Commands and authoring helpers must honor it. Loaded out-of-range state is diagnosed rather than silently rewritten during evaluation.

### Two-bone IK

Initial two-bone IK is an analytic authoring helper, not a persistent runtime solver graph.

- transient target and bend direction;
- solve shoulder/elbow rotation deterministically;
- handle reachable, fully extended, and too-close targets;
- apply rotation constraints;
- commit ordinary BonePoseKeyforms in one transaction;
- no hidden iterative solver or playback-only state.

Phase 8 may later justify persistent/time-varying IK targets, but that is not part of Phase 7.

### Mirror helpers

Mirror is explicit preview/apply authoring:

- mirror selected Bone rest structure across a chosen rig-space axis;
- allocate new stable IDs;
- optionally mirror selected bindings/weights using explicit vertex correspondence;
- show unmapped/ambiguous vertices before Apply;
- commit through ordinary Commands/Transaction;
- never infer permanent identity from left/right display names alone.

## 14. Validation and diagnostics

Required structured diagnostics include:

- BONE_NODE_MISSING
- BONE_SCENE_IDENTITY_MISMATCH
- BONE_PARENT_INVALID
- BONE_HIERARCHY_CYCLE
- BONE_REST_INVALID
- BONE_LENGTH_INVALID
- BONE_POSE_INVALID
- BONE_PROJECTED_FRAME_DEGENERATE
- BONE_KEYART_REFERENCE_INVALID
- RIGID_BINDING_TARGET_INVALID
- RIGID_BINDING_CONFLICT
- SKIN_BINDING_TARGET_INVALID
- SKIN_BINDING_TOPOLOGY_MISMATCH
- SKIN_VERTEX_MISSING
- SKIN_BONE_MISSING
- SKIN_DUPLICATE_INFLUENCE
- SKIN_INFLUENCE_LIMIT_EXCEEDED
- SKIN_WEIGHT_INVALID
- SKIN_WEIGHT_NOT_NORMALIZED
- MESH_FORM_TOPOLOGY_MISMATCH
- BONE_TRANSITION_INCOMPATIBLE

Structural invalidity cannot be overridden into validity.

## 15. Persistence and migration

Phase 7 should increment the Project schema only when persistent Bone/Skinning data lands.

Migration requirements:

- older projects receive empty Bone, pose-keyform, binding, weight, and correction collections;
- existing clipping and Warp data remain byte/semantic equivalent after migration;
- stable IDs and canonical order survive Save/Open;
- absent BonePoseKeyform means identity delta;
- absent MeshFormCorrectionKeyform means zero correction;
- no selection, mode, brush, hover, drag, IK target, or visualization state serializes.

## 16. Test strategy

### Domain and history

- stable Bone/BoneNode identity;
- Scene-owned hierarchy and cycle rejection;
- Edit vs Pose mutation separation;
- Key-Art pose keyform persistence;
- rigid/SkinBinding conflict rejection;
- stable vertex-ID weights;
- normalization and influence limit;
- topology mutation rejection/migration;
- Command/Transaction rollback;
- exact Undo/Redo;
- deterministic Save/Open and migration.

### Geometry

- identity FK at rest;
- root and child rotations;
- parent-first propagation;
- pivot/head correctness;
- rigid attachment;
- one-bone and multi-bone LBS;
- insertion-order independence;
- Warp-before-Bone ordering;
- projected bind-frame behavior under nested Warp;
- degenerate projected-frame diagnostic;
- post-skin correction ordering.

### Transition and renderer boundary

- exact A and B endpoints;
- deterministic midpoint pose;
- shortest-arc rotation interpolation;
- Hold and Replace endpoint behavior;
- compatible/incompatible skeleton diagnostics;
- clipping after final Bone deformation;
- preview/export evaluated plan parity;
- renderer remains Bone-unaware.

### Authoring

- first explicit pose edit creates one keyform;
- one gesture/stroke creates one history unit;
- active A/B Key Art independence;
- weight heatmap/editor projections;
- transient state does not serialize or dirty Project;
- IK commits ordinary FK keyforms;
- mirror preview does not mutate before Apply.

## 17. Acceptance criteria

Phase 7 is complete when a production-style arm rig can:

1. create shoulder, upper-arm, forearm, and hand Bones with stable identity;
2. pose the chain efficiently with FK;
3. attach a rigid hand or accessory without changing Scene draw order;
4. bind an arm mesh with normalized multi-Bone weights;
5. bend the elbow acceptably;
6. apply a post-skin elbow/silhouette correction without rewriting MeshKeyform;
7. author different compatible Bone poses for Key Arts A and B;
8. scrub A -> B deterministically;
9. coexist with ancestor Warp and downstream clipping;
10. Save/Open without semantic loss;
11. Undo/Redo all persistent operations;
12. export PNG/MP4 matching preview semantics;
13. work fully offline without AI/cloud services.

Phase 7-5 additionally proves constrained posing, analytic two-bone IK authoring, and an explicit mirror workflow.

## 18. Out of scope

- general Animation Clip/ClipInstance authoring;
- persistent BoneTrack timeline authoring;
- Multi-Key-Art sequence/mixer;
- runtime IK target tracks or iterative constraint graphs;
- physics, spring, ragdoll, or dynamics;
- dual-quaternion or nonlinear skinning;
- automatic AI rigging/weight generation;
- GPU-only Bone evaluator;
- path deformers and Glue;
- full Live2D compatibility;
- graph editor.

## 19. Recommended branches and commit discipline

Suggested implementation branches after the parent Issue is accepted:

~~~text
feature/issue-<n>-phase7-1-bone-fk-foundation
feature/issue-<n>-phase7-2-fk-authoring-transition-integration
feature/issue-<n>-phase7-3-weighted-skinning-foundation
feature/issue-<n>-phase7-4-weight-authoring-form-correction
feature/issue-<n>-phase7-5-bone-convenience
~~~

Commit by meaning, for example:

~~~text
phase7/bone-domain
phase7/fk-evaluator
phase7/bone-commands
phase7/fk-ui
phase7/skinning-domain
phase7/skinning-evaluator
phase7/weight-ui
phase7/form-correction
phase7/integration-tests
phase7/fixes
~~~

Do not leave the complete phase as one long uncommitted change.
