# Native Product capability map

Status: unified C++ production candidate for #118/#142. Final Windows CI and
physical artwork/interaction acceptance remain gates; implementation evidence
below is not a claim that human acceptance or installer release has passed.

## One editing authority

WPF `MainWindow` → `NativeSessionClient` → `NativeWorkspace` → C++ `NativeSession`.
`NativeMcpHost` enters that exact workspace lane. C++ owns Project, validation,
commands, transactions, revision identities and Undo/Redo. C# owns dialogs,
atomic OS writes, immutable raster capabilities, projections and UI state.

All 155 existing command handlers and 72 readonly Product queries have native
implementations. Additional `native.*` queries compile UI intent, preview
prepared candidates and produce render/export plans. JSON is interchange and
inspection, never an independently editable C# Project.

## Implementation and evidence

Paths below are relative to `product/native/`. Native C++/managed tests and retained JSON fixtures are the regression authority. The retired JavaScript/Product Host/Electron implementation is no longer present.

| Capability | Production owner | Regression evidence |
| --- | --- | --- |
| Project/stable IDs/validation | `core/src/project_snapshot.cpp`, `native_validation.h` | `core_tests`; Project conformance/admission fixtures |
| Typed commands/transactions, prepared commits, revision, Undo/Redo | `core/src/editor_session.cpp`, `native_commands.cpp` and domain command units | Session/rig/hierarchy/temporal/transition/mesh/source conformance in `core_tests` |
| Readonly queries, exact ticks and locale lists | `core/src/native_queries.cpp`, native evaluators, pinned ICU | Query conformance in `core_tests` |
| `.fl2d` format-v1, schemas 1–14 → 15, asset envelopes | `core/src/native_document.cpp`, `Core.Interop/NativeDocument.cs` | `document_tests`; managed document round-trip/failure tests |
| Atomic save/receipts, dirty state, Recovery and Preferences | `Session/NativeWorkspace.cs`, `Native.Client/DocumentClient.cs`, `AtomicDocumentFile.cs`, recovery/preferences adapters | `Session.Tests`; `Native.Client.Tests/DocumentTests.cs` |
| PSD/PSB, `.flimg` v1/v2, PNG raster decode | `Source.Codecs/`; immutable decoded candidates | `Source.Codecs.Tests`; PSD and source-codec fixtures |
| Source conversion, reviewed reimport and source-art history | `core/src/native_source.cpp`, `native_source_review.cpp`; `Session/NativeWorkspace.SourceReview.cs` | `source_tests`; `Session.Tests` reimport/Undo/Redo/save/reopen |
| Mesh Layout/Structure, Grid/Contour, correspondence | `core/src/native_mesh_authoring.cpp`, `native_mesh_generation.cpp`, `native_key_state_authoring.cpp` | Mesh/Key State authoring conformance/tests; managed workflow |
| Bone/FK/IK, rigid/Skin, Warp, weights and form correction | `core/src/native_rig_authoring.cpp`, `native_rig_evaluation.cpp`; domain commands | Rig conformance/authoring tests; managed preview and shared history |
| Key Arts, Transition modes/diagnostics and mapping | `core/src/native_key_state_authoring.cpp`, `native_transition_evaluation.cpp` | Key State/frame query fixtures |
| Sequence/Clip/Track/Keys, canonical 120000 ticks/s, playback | `core/src/native_timeline_authoring.cpp`, temporal/sequence evaluation | Timeline authoring/session/query fixtures |
| Preview, masks, clipping and compositing | `core/src/native_render_plan.cpp`, `renderer/src/d3d11_renderer.cpp` | Render-plan conformance; Windows hardware/WARP smoke |
| PNG/MP4 export planning and frame semantics | `core/src/native_export_authoring.cpp`; `Native.Client` PNG/FFmpeg adapters | Export-authoring fixtures; managed tests; Windows 240-frame/H.264 smoke |
| Existing WPF tools/panels/gestures | `src/Flamoris2D.App/`; typed `Native.Client` adapters | Native desktop authority tests; packaged WPF workflow |
| Live MCP, permissions, guards, cancellation/revocation | `Session/NativeMcpHost.cs`; `Native.Client/McpClient.cs`; MCP Core/Wpf 1.2.0 | Session and desktop authority tests; Windows bridge transport tests |
| Native-only portable package | explicit App/Bridge project graph; `../packaging/publish-windows.ps1` | Package boundary test plus published launch without developer runtimes |

## Limits and remaining acceptance

Encoded documents remain bounded to 128 MiB; raster/source residency to the
existing 512 MiB policy. Native contour generation also has explicit work/edge
bounds (ADR 0012). Expanded limits require measured evidence. No format/schema
or timebase change is part of renovation.

Human Windows acceptance covers real FLAMORIS PSD/`.flimg`/`.fl2d`, reopen and
reimport, dense meshes/rigs/timelines, DPI 100/125/150/200%, pointer feel, GPU and
playback, paths/dialogs, manual external MCP and PNG/MP4 visual output. Installer,
signing, update/uninstall and default association remain a separate release decision.
The portable application does not modify an existing installed association.

The legacy JavaScript/Electron/Product Host implementation was removed after the native application built and launched successfully on physical Windows. Regressions are fixed directly in the native product.

See [renovation map](repository-renovation.md), [ADR 0012](decisions/0012-native-session-cutover.md),
[production guide](native-production-workflow.md) and
[historical #96 evidence](../history/migrations/issue-96-host-capability-map.md).

## Cutover decision gates

| Gate | Status / evidence |
| --- | --- |
| G1 — Document/Recovery | Native format migration, revision-qualified receipts and atomic writes; managed tests |
| G2 — Source/assets | Immutable codecs and native conversion/reimport; source/history/reopen tests |
| G3 — Renderer | C++ evaluated plans and D3D11 hardware/WARP; Windows packaged smoke |
| G4 — Package/physical acceptance | Native-only package checks; human artwork/DPI/GPU and release policy remain |
| G5 — Live MCP | Same native workspace/history, Core guards and revocation; native/Windows transport tests |

## Public command/query disposition

The oracle column is compatibility reference only. Native entry points are the
production handlers; additional evaluator units are listed above. `superseded`
means the old UI route was replaced, not that the native query is absent.
Source replacement remains native-only, excluded from live MCP.

| Kind | Name | Legacy oracle | Native production entry | Workflow / disposition | Status |
| --- | --- | --- | --- | --- | --- |
| Command | `animation.deformation_sample.create` | `src/commands/mesh-deformation-sample-command-handlers.js` | `core/src/native_commands.cpp` | Deform / Animation > Shape | migrated |
| Command | `animation.deformation_sample.update` | `src/commands/mesh-deformation-sample-command-handlers.js` | `core/src/native_commands.cpp` | Deform / Animation > Shape | migrated |
| Command | `animation.deformation_sample.remove` | `src/commands/mesh-deformation-sample-command-handlers.js` | `core/src/native_commands.cpp` | Deform / Animation > Shape | migrated |
| Command | `animation.clip.create` | `src/commands/animation-clip-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.clip.update` | `src/commands/animation-clip-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.clip.remove` | `src/commands/animation-clip-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.create` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.add_view_item` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update_view_item` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove_view_item` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.add_clip_instance` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update_clip_instance` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove_clip_instance` | `src/commands/sequence-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `bone.create_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_two_bone_ik_enabled` | `src/commands/two-bone-ik-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_two_bone_ik_bend_direction` | `src/commands/two-bone-ik-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.create_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rotation_constraint_enabled` | `src/commands/bone-constraint-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rotation_constraint_bounds` | `src/commands/bone-constraint-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `mesh_form.create_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | `core/src/native_commands.cpp` | Deform > Correction | migrated |
| Command | `mesh_form.set_vertex_offsets` | `src/commands/mesh-form-correction-command-handlers.js` | `core/src/native_commands.cpp` | Deform > Correction | migrated |
| Command | `mesh_form.reset_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | `core/src/native_commands.cpp` | Deform > Correction | migrated |
| Command | `skin.create_binding` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `skin.remove_binding` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `skin.set_enabled` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `skin.set_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `skin.set_weights_bulk` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `skin.clear_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Weight | migrated |
| Command | `bone.create_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rigid_binding_bone` | `src/commands/rigid-bone-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rigid_binding_enabled` | `src/commands/rigid-bone-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.create` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.rename` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rest` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_enabled` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.reparent` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_keyform` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Deform > Pose | migrated |
| Command | `bone.reset_keyform` | `src/commands/bone-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Deform > Pose | migrated |
| Command | `deformer.create_warp` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp | migrated |
| Command | `deformer.remove` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp | migrated |
| Command | `deformer.rename` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp | migrated |
| Command | `deformer.set_grid` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp | migrated |
| Command | `deformer.set_keyform` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Deform > Warp pose | migrated |
| Command | `deformer.move_control_points` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp move/reset via equivalent deformer.set_keyform | superseded |
| Command | `deformer.reset_control_points` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp move/reset via equivalent deformer.set_keyform | superseded |
| Command | `deformer.reparent_node` | `src/commands/warp-deformer-command-handlers.js` | `core/src/rig_hierarchy_commands.cpp` | Rig > Warp | migrated |
| Command | `clipping.create` | `src/commands/clipping-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Clipping | migrated |
| Command | `clipping.set_source` | `src/commands/clipping-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Clipping | migrated |
| Command | `clipping.set_enabled` | `src/commands/clipping-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Clipping | migrated |
| Command | `clipping.remove` | `src/commands/clipping-command-handlers.js` | `core/src/native_commands.cpp` | Rig > Clipping | migrated |
| Command | `keyart.create` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `keyart.update` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `keyart.remove` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Key State > delete unreferenced state; dependent data is preserved/rejected | migrated |
| Command | `semantic_slot.create` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.update` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.remove` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.map_node` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.unmap_node` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `mesh_topology.create` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.update` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > Structure/generation commands replace raw topology replacement | superseded |
| Command | `mesh_topology.remove` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_topology.add_vertex` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.remove_vertex` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.create_triangle` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.subdivide_edge` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.set_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.clear_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_topology.apply_generated_mesh` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Structure | migrated |
| Command | `mesh_keyform.create` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > Layout | migrated |
| Command | `mesh_keyform.update` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_keyform.remove` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_keyform.move_vertices` | `src/commands/mesh-topology-command-handlers.js` | `core/src/mesh_commands.cpp` | Mesh > Layout | migrated |
| Command | `transition.create` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.update` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.remove` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.set_part_mode` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.set_part_topology` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.set_diagnostic_override` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `transition.clear_diagnostic_override` | `src/commands/transition-command-handlers.js` | `core/src/transition_commands.cpp` | Deform > Key State / Transition | migrated |
| Command | `animation.temporal.create_program` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_program` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.set_duration` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_track` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_track` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_keyframe` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.update_keyframe` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_keyframe` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_event` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Reserved Core events/regions; no existing production controller (feature ledger) | intentionally deferred |
| Command | `animation.temporal.add_region` | `src/commands/temporal-command-handlers.js` | `core/src/temporal_commands.cpp` | Reserved Core events/regions; no existing production controller (feature ledger) | intentionally deferred |
| Command | `source.apply_psd_reimport` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `animation.mesh_target.create` | `src/commands/mesh-deformation-sample-command-handlers.js` | `core/src/native_commands.cpp` | Deform > reusable sample | migrated |
| Command | `animation.mesh_target.remove` | `src/commands/mesh-deformation-sample-command-handlers.js` | `core/src/native_commands.cpp` | Deform > reusable sample | migrated |
| Command | `scene.rename_node` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `scene.set_transform` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `scene.set_visibility` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `scene.set_locked` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `scene.create_group` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Command | `scene.reparent_node` | `src/commands/scene-command-handlers.js` | `core/src/native_commands.cpp` | Source > Object / Document | migrated |
| Query | `project.get_render_settings` | `src/queries/project.js` | `core/src/native_queries.cpp` | Source > Object / Document | migrated |
| Query | `project.get_summary` | `src/queries/project.js` | `core/src/native_queries.cpp` | Source > Object / Document | migrated |
| Query | `project.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `clipping.get_for_node` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Clipping | migrated |
| Query | `clipping.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Clipping | migrated |
| Query | `clipping.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `deformer.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Warp | migrated |
| Query | `deformer.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Warp | migrated |
| Query | `deformer.get_keyform` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Warp pose | migrated |
| Query | `deformer.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_keyform` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Pose | migrated |
| Query | `bone.get_evaluated_pose` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Pose | migrated |
| Query | `bone.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list_rotation_constraints` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rotation_constraint` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rotation_constraint_for_bone` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_rotation_constraints` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list_two_bone_ik` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_two_bone_ik` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_two_bone_ik` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.get_two_bone_ik_pose` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.solve_two_bone_ik` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Pose | migrated |
| Query | `bone.list_rigid_bindings` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rigid_binding` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rigid_binding_for_target` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_rigid_bindings` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `skin.list_bindings` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Weight | migrated |
| Query | `skin.get_binding` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Weight | migrated |
| Query | `skin.get_binding_for_target` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Weight | migrated |
| Query | `skin.get_vertex_weights` | `src/queries/project.js` | `core/src/native_queries.cpp` | Rig > Weight | migrated |
| Query | `skin.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `skin.evaluate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh_form.list_keyforms` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Correction | migrated |
| Query | `mesh_form.get_keyform` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Correction | migrated |
| Query | `mesh_form.get_for_context` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Correction | migrated |
| Query | `mesh_form.validate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh_form.evaluate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `scene.get_tree` | `src/queries/project.js` | `core/src/native_queries.cpp` | Source > Object / Document | migrated |
| Query | `scene.get_node` | `src/queries/project.js` | `core/src/native_queries.cpp` | Source > Object / Document | migrated |
| Query | `scene.search` | `src/queries/project.js` | `core/src/native_queries.cpp` | Source > Object / Document | migrated |
| Query | `animation.get_program` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.list_tracks` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.sample_program` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `animation.clip.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.clip.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.deformation_sample.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform / Animation > Shape | migrated |
| Query | `animation.deformation_sample.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform / Animation > Shape | migrated |
| Query | `keyart.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `keyart.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.get_mapping` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `mesh.get_topology` | `src/queries/project.js` | `core/src/native_queries.cpp` | Mesh > Structure | migrated |
| Query | `mesh.list_topologies` | `src/queries/project.js` | `core/src/native_queries.cpp` | Mesh > Structure | migrated |
| Query | `mesh.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Mesh > Structure | migrated |
| Query | `mesh.get_vertex` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh.get_keyform` | `src/queries/project.js` | `core/src/native_queries.cpp` | Mesh > Structure | migrated |
| Query | `mesh.list_keyforms` | `src/queries/project.js` | `core/src/native_queries.cpp` | Mesh > Structure | migrated |
| Query | `transition.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `transition.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `transition.get_authoring` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `transition.evaluate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `transition.get_diagnostics` | `src/queries/project.js` | `core/src/native_queries.cpp` | Deform > Key State / Transition | migrated |
| Query | `sequence.get` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.list` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.get_diagnostics` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.evaluate` | `src/queries/project.js` | `core/src/native_queries.cpp` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.project_clip_instances` | `src/queries/project.js` | `core/src/native_queries.cpp` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `export.get_frame_plan` | `src/queries/project.js` | `core/src/native_queries.cpp` | Export > Output | migrated |
| Query | `export.evaluate_frame` | `src/queries/project.js` | `core/src/native_queries.cpp` | Export > Output | migrated |
