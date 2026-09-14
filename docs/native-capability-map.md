# Issue #96 Native capability parity map

Status: active migration contract; **not native production parity**.
Baseline: `main` at `defb46c28907c1262db1390c17bdaba00f9752a3` (merged PR #95).
Issue: [#96](https://github.com/flamoris-jp/flamoris-2D/issues/96).
Precedents: Issues #92/#94, merged PRs #93/#95, ADRs 0003–0006.

## Reading the ledger

`migrated` means the named, bounded UI action is connected and protected, not that its
entire workflow is complete. No unresolved `pending` rows are hidden in this checkpoint.
`deferred` requires the named gate below; it never means removed. `superseded` requires
an explicit replacement. A Product command reachable through the existing generic
Host facade is **not** a migrated native tool.

Paths below are relative to `product/`. Tests below are existing semantic safety
nets unless explicitly identified as native tests. A passing Product test does not
prove WPF interaction or visual parity. The exact public Command/Query ledger at
the end prevents future schema additions from disappearing into grouped prose.

## Genuine gates and baseline gaps

| Gate | Evidence | Required next evidence |
| --- | --- | --- |
| G1 — Native document / Recovery contract | accepted migration design §§4,13,19 explicitly require a Recovery ADR **before document lifecycle**; current `createRecoveryStore` is one Storage key with global `clear()`, no lineage or snapshot ID | reviewed lineage, safe retention/discard, corrupt/future snapshot and save semantics; do not silently make a proposed ADR accepted |
| G2 — Bulk assets / envelope ownership | `session.open` currently retains only `parseProjectDocument(...).project`; `session.serialize` passes no `renderAssets` or original metadata. ADR 0005 stores PSD rasters in the document envelope, outside Project. The 8 MiB JSON control boundary is not a large-artwork transport | preserve full envelope and original artwork; bounded binary transport/opaque handles, ownership across re-import and history, cancellation/lifetime review |
| G3 — Native renderer choice | ADR 0006 and migration design require measured software/Direct3D-compatible candidates before viewport implementation | Windows mesh/clipping/premultiplication/latency/DPI measurements and a reviewed backend ADR |
| G4 — Production acceptance / packaging | Linux authoring environment has no Windows desktop or .NET SDK; no real artwork/FFmpeg production pass available here | Windows CI for build/smoke, then real 8-second shot, focus/DPI, source-to-export, clean-machine runtime package |
| G5 — Live MCP transport | accepted design §19 defers desktop discovery/authentication/multi-client attachment | reviewed attachment capability; use same-session in-process proof meanwhile |

G2 is a concrete data-loss risk if the Phase 1 proof were simply wired to a native
Open/Save dialog. Its empty-document round-trip does **not** prove artwork round-trip.
Do not enable native file writes until that gap and G1 are closed.

G1 is tracked by [#97](https://github.com/flamoris-jp/flamoris-2D/issues/97) and
[proposed ADR 0007](decisions/0007-native-recovery-lifecycle.md). G2/G3 are tracked by
[#98](https://github.com/flamoris-jp/flamoris-2D/issues/98). Neither is self-approved.

The migrated target subset is protected by `product-host.test.js`, native client
`TestTargetWorkspace` / `TestTargetPropertiesAsync`, and WPF `RunSmokeProofAsync`.
The Host supplies tree/summary/history as one `session.workspace` projection. WPF
stores only disposable immutable projections, selection and uncommitted field drafts;
Apply uses the draft's starting revision and the existing three-command transaction.
Host loss invalidates the projection. The same existing EditorSession history remains
authoritative for WPF and headless/MCP operations.

## UI evidence and interaction hierarchy

Cutwork current main was rechecked at `7359db7538d9dc34f349715b1c8325537aaf5996`,
including `src/Cutwork.App/MainWindow.xaml`: locked ToolBarTray, contextual Mask/Patch/
Clone controls, separate Parts/Layer lists, one-way visibility controls and direct-name
editors. Adopt the relationships, not its imaging/document model.

Blender references already recorded by accepted PR #95:
[Modes](https://docs.blender.org/manual/en/latest/editors/3dview/modes.html),
[Tool System](https://docs.blender.org/manual/en/latest/interface/tool_system.html),
[Regions](https://docs.blender.org/manual/en/latest/interface/window_system/regions.html),
[Outliner selection](https://docs.blender.org/manual/en/latest/editors/outliner/selecting.html),
[Properties](https://docs.blender.org/manual/en/latest/editors/properties_editor.html),
[Timeline](https://docs.blender.org/manual/en/latest/editors/timeline.html).
Fresh direct requests in this run returned HTTP 402 and search yielded no usable official
results. No fresh visual inspection or Blender version verification is claimed. Retain
the accepted workflow/tab grammar; do not invent a new arrangement from those failed reads.

| Workflow | Sub-context (target domain) | Tool (operation) | Tool Options |
| --- | --- | --- | --- |
| Source | Object / Part | Select, Transform | target-local transform/pivot |
| Mesh | Structure / Layout | Select, Add, Remove, Connect, Subdivide / Move | active Key Art, snap, generation settings |
| Rig | Bone / Warp / Weight / Clipping | Select, Add, Move, Delete, Paint | rest/constraint, lattice, radius/influence, source |
| Deform | Key State / Correction / Pose | Select, Move, Reset, IK | active Key Art and explicit pose target |
| Animation | Sequence / Clip / Track | Select, Place, Trim, Key | time/snap/easing near Timeline |
| Preview | Shot | Inspect, Scrub, Play | sequence, read-only transport |
| Export | Output | Configure, Export, Cancel | size/FPS/format/destination |

Left = operation, top = options, upper-right = target, lower-right = target properties.
Bottom stays context-dependent. Bone/Warp/Weight placeholders are not operations.
No context switch changes persistent Project state. Selection and visibility are distinct.

## Feature ledger

Test names omit `tests/`; owner paths omit `src/` unless noted.

| Capability | Current owner | Command / Query / evaluator | Native workflow | Sub-context | Native UI location | Status | Protecting tests | Disposition / remaining work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New document | `app.js`, `model/project.js` | `session.create` | Source | Document | menu | deferred | `product-host.test.js` | Phase 1 creates empty session; unsaved replacement policy G1 |
| Open .fl2d + legacy migration | `io/project-json.js`, `desktop/main.mjs` | `parseProjectDocument` | Source | Document | menu/dialog | deferred | `phase1c.test.js`, `desktop-shell.test.js` | G1/G2; no native dialog yet |
| Save / Save As | `io/project-files.js` | `serializeProject`, `EditorSession.markSaved` | Source | Document | menu/dialog | deferred | `phase1c.test.js`, `desktop-shell.test.js` | G1/G2; Host save receipt missing |
| Save Incremental | `io/project-files.js` | `incrementalFilename`, exclusive writer | Source | Document | menu/dialog | deferred | `phase1c.test.js`, `desktop-shell.test.js` | preserve no-overwrite behavior; G1/G2 |
| Save Copy | `io/project-files.js` | `saveCopy` | Source | Document | menu/dialog | deferred | `phase1c.test.js` | must not change association or clean state; G1/G2 |
| Atomic write / failure | `desktop/atomic-write.js` | same-directory temp/flush/replace | Source | Document | storage adapter | deferred | `desktop-shell.test.js` | G1/G2; preserve old file on failure |
| Dirty / saved revision | `commands/editor.js` | `isDirty`, `savedRevision` | Source | Document | title/status | deferred | `phase1c.test.js` | Host monotonic revision is NOT saved history identity; G1 |
| Current path / Recent / association | `desktop/main.mjs`, `desktop/shell-logic.js` | typed desktop file IPC | Source | Document | menu/title | deferred | `desktop-shell.test.js` | OS state not Project; G1/G4 |
| Unsaved close / replace | `app.js`, `desktop/main.mjs` | document controller | Source | Document | dialog | deferred | `desktop-shell.test.js` | G1; do not discard automatically |
| Recovery restore/dismiss/discard | `io/project-json.js`, `app.js` | recovery store + session replace | Source | Recovery | startup card/menu | deferred | `phase1c.test.js` | G1, explicit new ADR required |
| PSD import / negative bounds | `psd.js`, `io/psd-project.js`, `app.js` | `window.agPsd.readPsd`, `createProjectFromPsd` | Source | Import | menu/dialog | deferred | `psd.test.js`, `psd-project.test.js`, `psd-document-clipping.test.js` | Node decode adapter and G2 |
| Cutwork .flimg import | `io/cutwork-flimg-reader.js`, `io/cutwork-flimg-project.js` | `importCutworkFlimg` | Source | Import | menu/dialog | deferred | `cutwork-flimg-import.test.js` | G2; preserve archive and materialized working-set limits |
| PSD re-import analyze/review/apply | `io/psd-reimport-review.js`, `ui/reimport-render-history.js` | `source.apply_psd_reimport` | Source | Update | menu/review dialog | deferred | `phase1c.test.js`, `psd-project.test.js` | G2; ambiguous match blocks; assets follow Undo |
| Parts hierarchy / row selection | `ui/editor-adapter.js`, `ui/scene-editor-view.js` | `scene.get_tree` | Source | Object / Part | right Targets | migrated | `editor-ui-adapter.test.js` | stable-ID transient selection; hidden row remains selected |
| Name | `ui/scene-editor-view.js` | `scene.rename_node` | Source | Object / Part | right Properties | migrated | `editor-core.test.js`, native client tests | typed Properties transaction; stale-draft rejection, including after focus leaves the form |
| Visibility vs selection | `ui/scene-editor-view.js` | `scene.set_visibility` | Source | Object / Part | right Targets / Properties | migrated | `editor-ui-adapter.test.js` | eye affects addressed row, never changes target |
| Lock | `ui/scene-editor-view.js` | `scene.set_locked` | Source | Object / Part | right Targets / Properties | migrated | `editor-core.test.js` | lock is distinct from visibility/selection |
| Group / reparent | `ui/editor-adapter.js` | `scene.create_group`, `scene.reparent_node` | Source | Hierarchy | right Targets | deferred | `editor-ui-adapter.test.js` | requires usable source workflow; G1/G2 |
| Transform / pivot | `ui/editor-adapter.js`, `ui/canvas-interaction.js` | `scene.set_transform` complete node-local replacement | Source | Object | left Move / right Properties | deferred | `editor-ui-adapter.test.js`, `mcp-schemas.test.js` | G2/G3; no partial generic property mutation |
| Stable-ID search / target details | `queries/project.js` | `scene.search`, `scene.get_node` | Source | Object | right Targets / Properties | deferred | `editor-core.test.js` | G1/G2; not a native search yet |
| Host handshake / lifecycle | `product-host/main.mjs`, native client | version/requestId/token/health | all | Session | status | migrated | `product-host.test.js`, native client tests | Phase 1 baseline |
| Undo / Redo / Transaction | `commands/editor.js` | one `EditorSession` | all | History | menu/toolbar | migrated | `product-host.test.js`, native client tests | Phase 1 primitive, not authoring parity |
| Headless shared history | `mcp/adapter.js` | same session commands | all | Session | Host | migrated | `product-host.test.js` | adapter proof only; live transport G5 |
| Host crash / stale rejection | native client and shell | token/revision invalidation | all | Session | banner/status | migrated | native client tests | no state saved from WPF projection |
| Raster/bulk transfer + lifetime | `ui/psd-render-assets.js`, `ui/cutwork-render-assets.js` | source assets / render instances | Source | Artwork | viewport | deferred | `cutwork-flimg-import.test.js`, `psd-document-clipping.test.js` | G2; no base64 workaround |
| Zoom / pan / fit / DPI | `ui/viewport-camera-controller.js` | document/display transforms | all | Viewport | canvas / View menu | deferred | `viewport-camera-controller.test.js` | G3/G4 |
| Picking / overlap / overlays | `ui/viewport-input-controller.js`, `ui/viewport-renderer.js` | evaluated stable-ID targets | all | Viewport | canvas | deferred | `editor-ui-adapter.test.js`, `ui-controller-boundaries.test.js` | G3; no viewport geometry authority |
| Capture/cancel/local preview | `ui/canvas-interaction.js`, feature controllers | one command on completion | all | Gesture | canvas | deferred | `editor-ui-adapter.test.js`, `sequence-timeline-controller.test.js` | G3; no pointer-move persistent commands |
| Mesh target / active keyform | `ui/mesh-editing-controller.js`, `ui/endpoint-mesh-controller.js` | `mesh.get_topology`, `mesh.get_keyform` | Mesh | Layout | right Targets / top Options | deferred | `endpoint-mesh.test.js`, `editor-modes.test.js` | G2/G3; stable IDs required |
| Add Vertex | `ui/mesh-tool-controller.js` | `mesh_topology.add_vertex` | Mesh | Structure | left Add | deferred | `phase3-mesh-topology.test.js` | G3; propagate compatible keyforms |
| Remove / dissolve | `ui/mesh-tool-controller.js` | `mesh_topology.remove_vertex` | Mesh | Structure | left Remove | deferred | `phase3-mesh-topology.test.js` | same compatibility/rejection semantics; G3 |
| Connect / triangle | `ui/mesh-tool-controller.js` | `mesh_topology.create_triangle` | Mesh | Structure | left Connect | deferred | `phase3-mesh-topology.test.js` | connect is triangle creation, not invented edge model; G3 |
| Subdivide edge | `ui/mesh-tool-controller.js` | `mesh_topology.subdivide_edge` | Mesh | Structure | left Subdivide | deferred | `phase3-mesh-topology.test.js` | G3; stable vertex propagation |
| Vertex IDs / semantic labels | `ui/mesh-tool-controller.js` | topology label commands | Mesh | Structure | overlay / right Properties | deferred | `phase3-mesh-topology.test.js` | G3; labels are not identity |
| Grid / Contour AutoMesh | `ui/mesh-preparation-controller.js`, `core/contour-automesh.js` | `mesh_topology.apply_generated_mesh` | Mesh | Generate | left Generate / top Options | deferred | `contour-automesh.test.js`, `mesh-preparation-controller.test.js` | G2/G3; preview then explicit apply |
| Correspondence / pins | `ui/correspondence-preview-controller.js`, `core/correspondence-solver.js` | normal MeshKeyform output | Mesh | Layout | top Options / overlay | deferred | `correspondence-preview.test.js`, `correspondence-solver.test.js` | G3; no opaque solver state |
| Layout vertex / whole mesh alignment | `ui/endpoint-mesh-controller.js` | `mesh_keyform.move_vertices` | Mesh | Layout | left Move / top Options | deferred | `endpoint-mesh.test.js`, `editor-ui-adapter.test.js` | G3; internal DEFORM compatibility name is Layout |
| Mesh overlay visibility / contrast | `ui/viewport-renderer.js`, `ui/mesh-authoring-view.js` | topology/keyform projections | Mesh | Structure / Layout | canvas / top Options | deferred | `workflow-view.test.js`, `editor-modes.test.js` | G3/G4; geometry never disappears with tool switch |
| Legacy writable mesh cache | `mesh.js`, compatibility renderer | `state.mesh/baseVertices/vertexOffsets` | Mesh | none | none | superseded | `editor-ui-adapter.test.js` | use Product MeshTopology/MeshKeyform; never revive as writer |
| Bone creation / rest / hierarchy | `ui/bone-authoring-controller.js` | Bone commands + FK | Rig | Bone | left Add/Move / right Properties | deferred | `bone-authoring-controller.test.js`, `phase7-bone-fk-domain.test.js` | G3 |
| Bone pose / reset / ghost | `ui/bone-authoring-controller.js` | `bone.set_keyform`, `bone.reset_keyform` | Deform | Pose | left Move / top Key Art | deferred | `bone-authoring-controller.test.js` | G3; rest and pose distinct |
| Rigid attachment | `ui/bone-authoring-controller.js` | rigid-binding commands | Rig | Bind | right Properties | deferred | `phase7-rigid-binding-domain.test.js`, `phase7-rigid-transition.test.js` | G3; post-Warp frames |
| Warp lattice / nesting | `ui/deformer-authoring-controller.js` | Warp commands | Rig | Warp | left Add / right Properties | deferred | `deformer-authoring-controller.test.js`, `phase6-warp-domain.test.js` | G3; 2x2/3x3/4x4 |
| Warp control-point keyform | `ui/deformer-authoring-controller.js` | `deformer.move_control_points` | Deform | Warp pose | canvas / top Key Art | deferred | `phase6-warp-transition.test.js` | G3; parent-first projection |
| SkinBinding / weights / normalize / clear | `ui/weight-authoring-controller.js` | skin commands / deterministic LBS | Rig | Weight | left Paint / right Properties | deferred | `phase7-weight-form-authoring.test.js`, `phase7-skin-binding-domain.test.js` | G3; stable vertex IDs, 1–4 influences |
| Weight visualization | `ui/weight-viewport-overlay.js` | `skin.get_vertex_weights` | Rig | Weight | overlay | deferred | `phase7-weight-form-authoring.test.js` | G3/G4 |
| Rotation constraints | `ui/bone-authoring-controller.js` | Bone constraint commands | Rig | Constraints | right Properties | deferred | `phase7-constraint-domain.test.js`, `phase7-constraint-evaluator.test.js` | G3; clamp before FK |
| Two-bone IK definition | `ui/two-bone-ik-authoring-controller.js` | IK constraint commands | Rig | IK | right Properties | deferred | `phase7-ik-domain.test.js` | G3; no runtime IK added |
| IK pose gesture | `ui/two-bone-ik-authoring-controller.js` | solver then Bone keyforms transaction | Deform | IK pose | canvas | deferred | `phase7-ik-authoring-solver.test.js`, `phase7-ik-authoring-controller.test.js` | G3; transformed/Warp-space semantics retained |
| Bone mirror helper | `ui/bone-mirror-authoring-controller.js` | `core/bone-mirror-helper.js` -> ordinary commands | Rig / Deform | Bone / Pose | top Options | deferred | `phase7-bone-mirror-authoring.test.js` | G3; preview/apply, no new domain |
| Clipping | `ui/clipping-authoring-controller.js` | clipping commands / final-geometry evaluator | Rig | Clipping | right Properties | deferred | `clipping-authoring.test.js`, `phase6-clipping-domain.test.js` | G3; cycles/absent target semantics preserved |
| Key Art / semantic mapping | `ui/transition-authoring-controller.js` | Key Art / semantic-slot commands | Deform | Key State | top target / right Properties | deferred | `transition-authoring.test.js` | G2/G3 |
| Key State strip / endpoint selection | `ui/key-state-strip-controller.js` | KeyArt/Transition projections | Deform | Key State | bottom compact strip | deferred | `key-state-strip.test.js` | G3; not full Sequence timeline |
| Form correction / reset | `ui/form-correction-authoring-controller.js` | `mesh_form.set_vertex_offsets` | Deform | Correction | left Move/Reset | deferred | `phase7-form-correction-domain.test.js`, `phase7-form-correction-evaluator.test.js` | G3; after skin, not Layout |
| Mesh deformation sample | `ui/sequence-timeline-controller.js` | animation deformation-sample commands | Deform / Animation | Shape / Track | properties / Timeline | deferred | `phase8-mesh-deformation-sample.test.js` | G3; ordinary offsets, not layout rewrite |
| Transition mode / topology refs / diagnostics | `ui/transition-authoring-controller.js`, diagnostics controller | transition commands / `transition.evaluate` | Deform | Transition | right Properties / diagnostics | deferred | `transition-authoring.test.js`, `transition-core.test.js` | G3; stale diagnostic override invalidation |
| Transition typed keys / timing / endpoint preview | `ui/transition-preview-controller.js` | TemporalProgram commands | Deform / Preview | Transition | bottom strip | deferred | `transition-preview.test.js`, `temporal-core.test.js` | G3; canonical ticks |
| Sequence create/update/remove | `ui/sequence-timeline-controller.js` | sequence commands | Animation | Sequence | bottom Timeline header | deferred | `sequence-command-query.test.js` | G3 |
| ViewLane holds / transitions / retime | `ui/sequence-timeline-controller.js` | view-item commands | Animation | ViewLane | bottom Key Art lane | deferred | `sequence-timeline-controller.test.js`, `sequence-evaluator.test.js` | G3; contiguous coverage |
| Clip library create/update/remove | `ui/sequence-timeline-controller.js` | animation.clip commands | Animation | Clips | right secondary targets | deferred | `animation-clip-command-query.test.js` | G3 |
| ClipInstance place/trim/rate/layer/weight | `ui/sequence-timeline-controller.js` | sequence clip-instance commands | Animation | Clips | bottom Timeline / Properties | deferred | `clip-instance-foundation.test.js`, `sequence-timeline-controller.test.js` | G3; once/loop, rational time |
| Typed track/owner/target selection | `ui/sequence-timeline-controller.js` | TemporalProgram tracks | Animation | Tracks | bottom / right Properties | deferred | `phase8-animation-tracks.test.js` | G3; transform/bone/warp/mesh/opacity/presence/order/clipping |
| Keyframe add/update/remove / easing | `ui/sequence-timeline-controller.js`, `ui/ease-presets.js` | temporal keyframe commands | Animation | Keys | bottom / Tool Options | deferred | `ease-presets.test.js`, `sequence-timeline-controller.test.js` | G3; explicit Bezier data |
| Timeline drag / cancel / no-op | `ui/sequence-timeline-controller.js` | one transaction | Animation | Timeline | bottom | deferred | `sequence-timeline-controller.test.js` | G3; one gesture one history |
| Scrub/playback/playhead/Once/Loop | `ui/sequence-timeline-controller.js`, `core/clip-time.js` | `sequence.evaluate` | Animation / Preview | Transport | bottom local controls | deferred | `timeline-primitives.test.js`, `clip-instance-foundation.test.js` | G3; no C# timebase |
| Sequence camera / CameraTrack | `core/sequence-mixer.js` | typed CameraTrack / Sequence camera | Animation / Preview | Camera | properties / Timeline | deferred | `phase8-sequence-mixer.test.js` | G3; no reusable Camera clips invented |
| Deterministic preview | `core/evaluated-render.js`, `core/shared-composition-renderer.js` | canonical evaluated frame | Preview | Shot | viewport | deferred | `phase8-production-proof.test.js`, `phase8-sequence-rig-mixer.test.js` | G3; renderer must not reinterpret modes |
| PNG sequence | `core/frame-sequence-export.js`, `core/png-frame-encoder.js` | export frame planner/evaluator | Export | PNG | dialog | deferred | `frame-sequence-export.test.js`, `export-frame-renderer.test.js` | G2/G3; OffscreenCanvas replacement |
| MP4 H.264 / FFmpeg | `core/video-encoder.js`, `desktop/ffmpeg-video-encoder.mjs` | approved encoder process contract | Export | MP4 | dialog | deferred | `video-encoder.test.js`, `ffmpeg-video-encoder.test.js` | G3/G4; real h264_mf acceptance |
| Export destination/progress/cancel/diagnostics | `ui/export-dialog-view.js`, `core/export-job-controller.js` | job controller / typed sinks | Export | Job | dialog/status | deferred | `export-job-controller.test.js`, `desktop-frame-sequence.test.js` | G3/G4; preserve partial output policy |
| Preview/PNG/MP4 source-frame parity | `core/export-frame-evaluator.js` | canonical time/render settings | Preview / Export | Shot | viewport/dialog | deferred | `phase8-production-persistence-export.test.js` | G3/G4; existing semantic tests != native pixels |
| Full graph editor / runtime IK / brush-proportional mesh | roadmap future work | not current production capability | later | later | none yet | deferred | no production claim | explicitly pre-existing roadmap deferral, not lost in migration |
| Native packaging / Electron retirement | app project / Electron build | explicit artifact boundary | all | Release | installer | deferred | native CI / `production-manifest.test.js` | G4 plus every capability gate; Electron stays |

## Checkpoint exit

Stage A: ledger + exact public contract coverage completed. Stage B: hierarchy/selection,
name, visibility and lock are the only migrated native Object/Part actions. Stages B document/import and C–H stay
gated as above. Stage I real Windows shot and Stage J retirement are not complete.
No Project schema, evaluator order, timebase or MCP schema changes are authorized here.

## Exact public contract coverage

Each entry inherits the feature row's UI location, tests and gate above. Internal inverse
commands are intentionally not native UI/MCP tools. Host reachability alone never changes
these dispositions. Query entries include Product-only export queries as well as MCP queries.

| Kind | Contract | Current implementation owner | Native route | Status |
| --- | --- | --- | --- | --- |
| Command | `animation.deformation_sample.create` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | deferred |
| Command | `animation.deformation_sample.update` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | deferred |
| Command | `animation.deformation_sample.remove` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | deferred |
| Command | `animation.clip.create` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.clip.update` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.clip.remove` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.create` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.update` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.remove` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.add_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.update_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.remove_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.add_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.update_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `sequence.remove_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `bone.create_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.remove_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_two_bone_ik_enabled` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_two_bone_ik_bend_direction` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.create_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.remove_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_rotation_constraint_enabled` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_rotation_constraint_bounds` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `mesh_form.create_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | deferred |
| Command | `mesh_form.set_vertex_offsets` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | deferred |
| Command | `mesh_form.reset_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | deferred |
| Command | `skin.create_binding` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `skin.remove_binding` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `skin.set_enabled` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `skin.set_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `skin.set_weights_bulk` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `skin.clear_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | deferred |
| Command | `bone.create_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_rigid_binding_bone` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_rigid_binding_enabled` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.remove_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.create` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.remove` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.rename` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_rest` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_enabled` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.reparent` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | deferred |
| Command | `bone.set_keyform` | `src/commands/bone-command-handlers.js` | Deform > Pose | deferred |
| Command | `bone.reset_keyform` | `src/commands/bone-command-handlers.js` | Deform > Pose | deferred |
| Command | `deformer.create_warp` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | deferred |
| Command | `deformer.remove` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | deferred |
| Command | `deformer.rename` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | deferred |
| Command | `deformer.set_grid` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | deferred |
| Command | `deformer.set_keyform` | `src/commands/warp-deformer-command-handlers.js` | Deform > Warp pose | deferred |
| Command | `deformer.move_control_points` | `src/commands/warp-deformer-command-handlers.js` | Deform > Warp pose | deferred |
| Command | `deformer.reset_control_points` | `src/commands/warp-deformer-command-handlers.js` | Deform > Warp pose | deferred |
| Command | `deformer.reparent_node` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | deferred |
| Command | `clipping.create` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | deferred |
| Command | `clipping.set_source` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | deferred |
| Command | `clipping.set_enabled` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | deferred |
| Command | `clipping.remove` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | deferred |
| Command | `keyart.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `keyart.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `keyart.remove` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `semantic_slot.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `semantic_slot.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `semantic_slot.remove` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `semantic_slot.map_node` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `semantic_slot.unmap_node` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `mesh_topology.create` | `src/commands/transition-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.update` | `src/commands/transition-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.remove` | `src/commands/transition-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.add_vertex` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.remove_vertex` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.create_triangle` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.subdivide_edge` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.set_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.clear_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_topology.apply_generated_mesh` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | deferred |
| Command | `mesh_keyform.create` | `src/commands/transition-command-handlers.js` | Mesh > Layout | deferred |
| Command | `mesh_keyform.update` | `src/commands/transition-command-handlers.js` | Mesh > Layout | deferred |
| Command | `mesh_keyform.remove` | `src/commands/transition-command-handlers.js` | Mesh > Layout | deferred |
| Command | `mesh_keyform.move_vertices` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Layout | deferred |
| Command | `transition.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.remove` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.set_part_mode` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.set_part_topology` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.set_diagnostic_override` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `transition.clear_diagnostic_override` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | deferred |
| Command | `animation.temporal.create_program` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.remove_program` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.set_duration` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.add_track` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.remove_track` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.add_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.update_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.remove_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.add_event` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `animation.temporal.add_region` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | deferred |
| Command | `source.apply_psd_reimport` | `src/commands/scene-command-handlers.js` | Source > Object / Document | deferred |
| Command | `scene.rename_node` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.set_transform` | `src/commands/scene-command-handlers.js` | Source > Object / Document | deferred |
| Command | `scene.set_visibility` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.set_locked` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.create_group` | `src/commands/scene-command-handlers.js` | Source > Object / Document | deferred |
| Command | `scene.reparent_node` | `src/commands/scene-command-handlers.js` | Source > Object / Document | deferred |
| Query | `project.get_render_settings` | `src/queries/project.js` | Source > Object / Document | deferred |
| Query | `project.get_summary` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `project.validate` | `src/queries/project.js` | Source > Object / Document | deferred |
| Query | `clipping.get_for_node` | `src/queries/project.js` | Rig > Clipping | deferred |
| Query | `clipping.list` | `src/queries/project.js` | Rig > Clipping | deferred |
| Query | `clipping.validate` | `src/queries/project.js` | Rig > Clipping | deferred |
| Query | `deformer.list` | `src/queries/project.js` | Rig > Warp | deferred |
| Query | `deformer.get` | `src/queries/project.js` | Rig > Warp | deferred |
| Query | `deformer.get_keyform` | `src/queries/project.js` | Deform > Warp pose | deferred |
| Query | `deformer.validate` | `src/queries/project.js` | Rig > Warp | deferred |
| Query | `bone.list` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_keyform` | `src/queries/project.js` | Deform > Pose | deferred |
| Query | `bone.get_evaluated_pose` | `src/queries/project.js` | Deform > Pose | deferred |
| Query | `bone.validate` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.list_rotation_constraints` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_rotation_constraint` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_rotation_constraint_for_bone` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.validate_rotation_constraints` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.list_two_bone_ik` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_two_bone_ik` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.validate_two_bone_ik` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_two_bone_ik_pose` | `src/queries/project.js` | Deform > Pose | deferred |
| Query | `bone.solve_two_bone_ik` | `src/queries/project.js` | Deform > Pose | deferred |
| Query | `bone.list_rigid_bindings` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_rigid_binding` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.get_rigid_binding_for_target` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `bone.validate_rigid_bindings` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | deferred |
| Query | `skin.list_bindings` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `skin.get_binding` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `skin.get_binding_for_target` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `skin.get_vertex_weights` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `skin.validate` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `skin.evaluate` | `src/queries/project.js` | Rig > Weight | deferred |
| Query | `mesh_form.list_keyforms` | `src/queries/project.js` | Deform > Correction | deferred |
| Query | `mesh_form.get_keyform` | `src/queries/project.js` | Deform > Correction | deferred |
| Query | `mesh_form.get_for_context` | `src/queries/project.js` | Deform > Correction | deferred |
| Query | `mesh_form.validate` | `src/queries/project.js` | Deform > Correction | deferred |
| Query | `mesh_form.evaluate` | `src/queries/project.js` | Deform > Correction | deferred |
| Query | `scene.get_tree` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `scene.get_node` | `src/queries/project.js` | Source > Object / Document | deferred |
| Query | `scene.search` | `src/queries/project.js` | Source > Object / Document | deferred |
| Query | `animation.get_program` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `animation.list_tracks` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `animation.sample_program` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `animation.clip.get` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `animation.clip.list` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `animation.deformation_sample.get` | `src/queries/project.js` | Deform / Animation > Shape | deferred |
| Query | `animation.deformation_sample.list` | `src/queries/project.js` | Deform / Animation > Shape | deferred |
| Query | `keyart.get` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `keyart.list` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `semantic_slot.get` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `semantic_slot.list` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `semantic_slot.get_mapping` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `mesh.get_topology` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `mesh.list_topologies` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `mesh.list` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `mesh.get_vertex` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `mesh.get_keyform` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `mesh.list_keyforms` | `src/queries/project.js` | Mesh > Structure | deferred |
| Query | `transition.get` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `transition.list` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `transition.get_authoring` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `transition.evaluate` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `transition.get_diagnostics` | `src/queries/project.js` | Deform > Key State / Transition | deferred |
| Query | `sequence.get` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `sequence.list` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `sequence.get_diagnostics` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `sequence.evaluate` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `sequence.project_clip_instances` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | deferred |
| Query | `export.get_frame_plan` | `src/queries/project.js` | Export > Output | deferred |
| Query | `export.evaluate_frame` | `src/queries/project.js` | Export > Output | deferred |
