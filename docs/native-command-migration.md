# Native command/query migration (#127)

The #118/#142 production candidate routes WPF/MCP through one NativeWorkspace and C++ NativeSession (ADR 0012). JS Product Host is now compatibility reference only. WPF/MCP never dual-write. Native commands run in the same session, candidate validator, prepared commit and history path introduced by #123.

## Command contract

Validate every command envelope/payload in a batch before invoking its first domain handler, matching JS error precedence. Public execution rejects history-only command types; native Undo may replay them. A command returns one inverse plus an ordered list of affected stable IDs. The transaction deduplicates those IDs in first-seen order. Hierarchy changes synchronize a matching WarpDeformer parent. Binding and rig deletion/restoration preserves collection index. Bone rest/reparent operations reject dependent IK, authored poses, rigid/Skin bindings in Product order; Bone deletion also rejects rotation constraints. Warp topology changes reject authored keyforms. Warp removal lifts children and its inverse restores their ordered hierarchy and indexed points/keyforms. The existing candidate-admission rejection for a Warp with a Bone child remains atomic. Ordinary candidate validation owns cycle/reference rejection and failure is atomic. No generic property-path editing API is added.

The Temporal/Clip/Sequence checkpoint validates Project admission and then the before/after ownership lifecycle at the prepared transaction boundary, including Undo/Redo. Existing Sequence/AnimationClip owners cannot reassign programs, a new owner cannot adopt a program present before the transaction, and deleting an owner cannot retain its program. Creating/removing the owner and its program together is atomic; removing and recreating the same stable owner ID cannot bypass ownership immutability. Transition ownership keeps its current distinct Product contract. Failed prepare leaves Project/history/revisions unchanged; full project replacement remains admission rather than a transaction lifecycle change. Source replacement commands share this cross-state check. Scene hierarchy and clipping cannot alter owner/program relationships. Source decode/import belongs with persistence/ingest; typed source replacement now shares the ordinary guard.

The Transition authoring checkpoint preserves typed KeyArt/SemanticSlot/Topology/Keyform/Transition lifecycle commands. Normalizers fill current Product defaults without adding a new persistent schema. Stable identity, mapping exclusivity, Skin/form topology locks and atomic topology mutation requirements retain Product error precedence. Transition part/diagnostic inverses preserve indices; candidate validation owns endpoint/topology/reference compatibility. Transition removal keeps its current independent program lifecycle contract.

The mesh editing checkpoint uses typed Layout mutation contracts. Add/remove/subdivide/generated replacement update every associated Keyform position/UV array atomically and store a topology/keyform snapshot inverse. Skin locks vertex identity changes; form corrections lock destructive vertex removal/replacement. Labels, issued vtx_ IDs, triangle duplicates/area and explicit generated-mesh replacement consent keep current Product precedence. Omitted optional vertex metadata/sequence fields remain valid and defaults appear only when Product edits introduce them. Invalid intermediate domain objects may exist within a batch: checked geometry access and the domain exception boundary reject uncoded Product errors as project.invalid while preserving atomicity; they do not introduce validation between individual commands.

PSD re-import keeps its current typed Project replacement contract: preserve logical Project ID, snapshot inverse, first-seen old/new scene node affected IDs, final admission and before/after Temporal ownership validation. JSON property order is observable in this contract and queries. The bounded private JSON value retains insertion order and ECMAScript numeric-key enumeration through parse/copy/mutation/serialization; this replaces the validation-only pointer order map. The vendored parser patch keeps the existing depth/size/UTF-8 boundary, including object depth, and its original license. These are private representation details, not new Project fields or a runtime JS dependency.

## Completion order

1. Scene hierarchy and Clipping.
2. Mesh/topology/keyforms, Bone/Warp/Skin/constraints/corrections and deformation samples.
3. Temporal, Transition, AnimationClip, Sequence and remaining queries.
4. Native evaluated-frame/render/compositor; persistence/import; one-session WPF/MCP cutover.
5. Physical Windows artwork/DPI/pointer/playback/export acceptance, then JS/Node/Electron retirement. CI smoke is not physical acceptance.

## Current handler inventory

155 JS handlers: 155 native, 0 pending. Status means native coverage; JS remains production authority for every handler. Internal/public classification comes from current commandSchemas/internalCommandSchemas.

| Command | Access | Native | JS source |
| --- | --- | --- | --- |
| `animation.clip.create` | public | native | `animation-clip-command-handlers.js` |
| `animation.clip.update` | public | native | `animation-clip-command-handlers.js` |
| `animation.clip.remove` | public | native | `animation-clip-command-handlers.js` |
| `animation.clip.remove_internal` | history | native | `animation-clip-command-handlers.js` |
| `animation.clip.restore` | history | native | `animation-clip-command-handlers.js` |
| `bone.create` | public | native | `bone-command-handlers.js` |
| `bone.remove` | public | native | `bone-command-handlers.js` |
| `bone.remove_internal` | history | native | `bone-command-handlers.js` |
| `bone.restore` | history | native | `bone-command-handlers.js` |
| `bone.rename` | public | native | `bone-command-handlers.js` |
| `bone.set_rest` | public | native | `bone-command-handlers.js` |
| `bone.set_enabled` | public | native | `bone-command-handlers.js` |
| `bone.reparent` | public | native | `bone-command-handlers.js` |
| `bone.set_keyform` | public | native | `bone-command-handlers.js` |
| `bone.reset_keyform` | public | native | `bone-command-handlers.js` |
| `bone.remove_keyform_internal` | history | native | `bone-command-handlers.js` |
| `bone.create_rotation_constraint` | public | native | `bone-constraint-command-handlers.js` |
| `bone.remove_rotation_constraint` | public | native | `bone-constraint-command-handlers.js` |
| `bone.remove_rotation_constraint_internal` | history | native | `bone-constraint-command-handlers.js` |
| `bone.restore_rotation_constraint` | history | native | `bone-constraint-command-handlers.js` |
| `bone.set_rotation_constraint_enabled` | public | native | `bone-constraint-command-handlers.js` |
| `bone.set_rotation_constraint_bounds` | public | native | `bone-constraint-command-handlers.js` |
| `clipping.create` | public | native | `clipping-command-handlers.js` |
| `clipping.set_source` | public | native | `clipping-command-handlers.js` |
| `clipping.set_enabled` | public | native | `clipping-command-handlers.js` |
| `clipping.remove` | public | native | `clipping-command-handlers.js` |
| `clipping.remove_internal` | history | native | `clipping-command-handlers.js` |
| `clipping.restore` | history | native | `clipping-command-handlers.js` |
| `animation.mesh_target.create` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.mesh_target.remove` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.mesh_target.restore_internal` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.deformation_sample.create` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.deformation_sample.update` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.deformation_sample.remove` | public | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.deformation_sample.remove_internal` | history | native | `mesh-deformation-sample-command-handlers.js` |
| `animation.deformation_sample.restore` | history | native | `mesh-deformation-sample-command-handlers.js` |
| `mesh_form.create_keyform` | public | native | `mesh-form-correction-command-handlers.js` |
| `mesh_form.set_vertex_offsets` | public | native | `mesh-form-correction-command-handlers.js` |
| `mesh_form.reset_keyform` | public | native | `mesh-form-correction-command-handlers.js` |
| `mesh_form.remove_keyform_internal` | history | native | `mesh-form-correction-command-handlers.js` |
| `mesh_form.restore_keyform` | history | native | `mesh-form-correction-command-handlers.js` |
| `mesh_keyform.move_vertices` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.set_vertex_label` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.clear_vertex_label` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.add_vertex` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.remove_vertex` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.create_triangle` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.subdivide_edge` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.apply_generated_mesh` | public | native | `mesh-topology-command-handlers.js` |
| `mesh_topology.restore_snapshot` | history | native | `mesh-topology-command-handlers.js` |
| `bone.create_rigid_binding` | public | native | `rigid-bone-binding-command-handlers.js` |
| `bone.set_rigid_binding_bone` | public | native | `rigid-bone-binding-command-handlers.js` |
| `bone.set_rigid_binding_enabled` | public | native | `rigid-bone-binding-command-handlers.js` |
| `bone.remove_rigid_binding` | public | native | `rigid-bone-binding-command-handlers.js` |
| `bone.remove_rigid_binding_internal` | history | native | `rigid-bone-binding-command-handlers.js` |
| `bone.restore_rigid_binding` | history | native | `rigid-bone-binding-command-handlers.js` |
| `source.apply_psd_reimport` | public | native | `scene-command-handlers.js` |
| `scene.rename_node` | public | native | `scene-command-handlers.js` |
| `scene.set_transform` | public | native | `scene-command-handlers.js` |
| `scene.set_visibility` | public | native | `scene-command-handlers.js` |
| `scene.set_locked` | public | native | `scene-command-handlers.js` |
| `scene.create_group` | public | native | `scene-command-handlers.js` |
| `scene.remove_empty_group` | history | native | `scene-command-handlers.js` |
| `scene.reparent_node` | public | native | `scene-command-handlers.js` |
| `sequence.create` | public | native | `sequence-command-handlers.js` |
| `sequence.update` | public | native | `sequence-command-handlers.js` |
| `sequence.remove` | public | native | `sequence-command-handlers.js` |
| `sequence.remove_internal` | history | native | `sequence-command-handlers.js` |
| `sequence.restore` | history | native | `sequence-command-handlers.js` |
| `sequence.add_view_item` | public | native | `sequence-command-handlers.js` |
| `sequence.update_view_item` | public | native | `sequence-command-handlers.js` |
| `sequence.remove_view_item` | public | native | `sequence-command-handlers.js` |
| `sequence.remove_view_item_internal` | history | native | `sequence-command-handlers.js` |
| `sequence.restore_view_item` | history | native | `sequence-command-handlers.js` |
| `sequence.add_clip_instance` | public | native | `sequence-command-handlers.js` |
| `sequence.update_clip_instance` | public | native | `sequence-command-handlers.js` |
| `sequence.remove_clip_instance` | public | native | `sequence-command-handlers.js` |
| `sequence.remove_clip_instance_internal` | history | native | `sequence-command-handlers.js` |
| `sequence.restore_clip_instance` | history | native | `sequence-command-handlers.js` |
| `skin.create_binding` | public | native | `skin-binding-command-handlers.js` |
| `skin.remove_binding` | public | native | `skin-binding-command-handlers.js` |
| `skin.remove_binding_internal` | history | native | `skin-binding-command-handlers.js` |
| `skin.restore_binding` | history | native | `skin-binding-command-handlers.js` |
| `skin.set_enabled` | public | native | `skin-binding-command-handlers.js` |
| `skin.set_vertex_weights` | public | native | `skin-binding-command-handlers.js` |
| `skin.set_weights_bulk` | public | native | `skin-binding-command-handlers.js` |
| `skin.clear_vertex_weights` | public | native | `skin-binding-command-handlers.js` |
| `animation.temporal.set_duration` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.create_program` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.remove_program` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.restore_program` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.add_track` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.remove_track` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.restore_track` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.add_keyframe` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.update_keyframe` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.remove_keyframe` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.restore_keyframe` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.add_event` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.remove_event` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.restore_event` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.add_region` | public | native | `temporal-command-handlers.js` |
| `animation.temporal.remove_region` | history | native | `temporal-command-handlers.js` |
| `animation.temporal.restore_region` | history | native | `temporal-command-handlers.js` |
| `keyart.create` | public | native | `transition-command-handlers.js` |
| `keyart.update` | public | native | `transition-command-handlers.js` |
| `keyart.remove` | public | native | `transition-command-handlers.js` |
| `keyArts.remove_internal` | history | native | `transition-command-handlers.js` |
| `keyart.restore` | history | native | `transition-command-handlers.js` |
| `semantic_slot.create` | public | native | `transition-command-handlers.js` |
| `semantic_slot.update` | public | native | `transition-command-handlers.js` |
| `semantic_slot.remove` | public | native | `transition-command-handlers.js` |
| `semanticSlots.remove_internal` | history | native | `transition-command-handlers.js` |
| `semantic_slot.restore` | history | native | `transition-command-handlers.js` |
| `semantic_slot.map_node` | public | native | `transition-command-handlers.js` |
| `semantic_slot.unmap_node` | public | native | `transition-command-handlers.js` |
| `semantic_slot.restore_mapping` | history | native | `transition-command-handlers.js` |
| `mesh_topology.create` | public | native | `transition-command-handlers.js` |
| `mesh_topology.update` | public | native | `transition-command-handlers.js` |
| `mesh_topology.remove` | public | native | `transition-command-handlers.js` |
| `meshTopologies.remove_internal` | history | native | `transition-command-handlers.js` |
| `mesh_topology.restore` | history | native | `transition-command-handlers.js` |
| `mesh_keyform.create` | public | native | `transition-command-handlers.js` |
| `mesh_keyform.update` | public | native | `transition-command-handlers.js` |
| `mesh_keyform.remove` | public | native | `transition-command-handlers.js` |
| `meshKeyforms.remove_internal` | history | native | `transition-command-handlers.js` |
| `mesh_keyform.restore` | history | native | `transition-command-handlers.js` |
| `transition.create` | public | native | `transition-command-handlers.js` |
| `transition.update` | public | native | `transition-command-handlers.js` |
| `transition.remove` | public | native | `transition-command-handlers.js` |
| `transitions.remove_internal` | history | native | `transition-command-handlers.js` |
| `transition.restore` | history | native | `transition-command-handlers.js` |
| `transition.set_part_mode` | public | native | `transition-command-handlers.js` |
| `transition.set_part_topology` | public | native | `transition-command-handlers.js` |
| `transition.remove_part` | history | native | `transition-command-handlers.js` |
| `transition.restore_part` | history | native | `transition-command-handlers.js` |
| `transition.set_diagnostic_override` | public | native | `transition-command-handlers.js` |
| `transition.clear_diagnostic_override` | public | native | `transition-command-handlers.js` |
| `bone.create_two_bone_ik` | public | native | `two-bone-ik-command-handlers.js` |
| `bone.remove_two_bone_ik` | public | native | `two-bone-ik-command-handlers.js` |
| `bone.remove_two_bone_ik_internal` | history | native | `two-bone-ik-command-handlers.js` |
| `bone.restore_two_bone_ik` | history | native | `two-bone-ik-command-handlers.js` |
| `bone.set_two_bone_ik_enabled` | public | native | `two-bone-ik-command-handlers.js` |
| `bone.set_two_bone_ik_bend_direction` | public | native | `two-bone-ik-command-handlers.js` |
| `deformer.create_warp` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.remove` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.remove_internal` | history | native | `warp-deformer-command-handlers.js` |
| `deformer.restore` | history | native | `warp-deformer-command-handlers.js` |
| `deformer.rename` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.set_grid` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.set_keyform` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.remove_keyform_internal` | history | native | `warp-deformer-command-handlers.js` |
| `deformer.move_control_points` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.reset_control_points` | public | native | `warp-deformer-command-handlers.js` |
| `deformer.reparent_node` | public | native | `warp-deformer-command-handlers.js` |

## Current query inventory

72 JS query handlers: 72 native and 0 pending. See the current
[Query migration boundary](native-query-migration.md) and sealed native inventory
for implementation status; JS remains production authority pending cutover.

- `project.get_render_settings`
- `project.get_summary`
- `project.validate`
- `clipping.get_for_node`
- `clipping.list`
- `clipping.validate`
- `deformer.list`
- `deformer.get`
- `deformer.get_keyform`
- `deformer.validate`
- `bone.list`
- `bone.get`
- `bone.get_keyform`
- `bone.get_evaluated_pose`
- `bone.validate`
- `bone.list_rotation_constraints`
- `bone.get_rotation_constraint`
- `bone.get_rotation_constraint_for_bone`
- `bone.validate_rotation_constraints`
- `bone.list_two_bone_ik`
- `bone.get_two_bone_ik`
- `bone.validate_two_bone_ik`
- `bone.get_two_bone_ik_pose`
- `bone.solve_two_bone_ik`
- `bone.list_rigid_bindings`
- `bone.get_rigid_binding`
- `bone.get_rigid_binding_for_target`
- `bone.validate_rigid_bindings`
- `skin.list_bindings`
- `skin.get_binding`
- `skin.get_binding_for_target`
- `skin.get_vertex_weights`
- `skin.validate`
- `skin.evaluate`
- `mesh_form.list_keyforms`
- `mesh_form.get_keyform`
- `mesh_form.get_for_context`
- `mesh_form.validate`
- `mesh_form.evaluate`
- `scene.get_tree`
- `scene.get_node`
- `scene.search`
- `animation.get_program`
- `animation.list_tracks`
- `animation.sample_program`
- `animation.clip.get`
- `animation.clip.list`
- `animation.deformation_sample.get`
- `animation.deformation_sample.list`
- `keyart.get`
- `keyart.list`
- `semantic_slot.get`
- `semantic_slot.list`
- `semantic_slot.get_mapping`
- `mesh.get_topology`
- `mesh.list_topologies`
- `mesh.list`
- `mesh.get_vertex`
- `mesh.get_keyform`
- `mesh.list_keyforms`
- `transition.get`
- `transition.list`
- `transition.get_authoring`
- `transition.evaluate`
- `transition.get_diagnostics`
- `sequence.get`
- `sequence.list`
- `sequence.get_diagnostics`
- `sequence.evaluate`
- `sequence.project_clip_instances`
- `export.get_frame_plan`
- `export.evaluate_frame`
