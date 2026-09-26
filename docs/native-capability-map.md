# Issue #96 Native migration completion ledger

Status: Source-through-Export implementation candidate in [PR #101](https://github.com/flamoris-jp/flamoris-2D/pull/101).
Final human Windows acceptance and release cutover remain open; this is not an Electron-retirement approval.
Baseline: merged PR #100 on `main` (`3fc17bdea3747e9f6e8765c5e380754124d1ae6a`).
The old proof branch was already merged, so production work continues on
`feature/issue-96-native-production-migration`. [Issue #96](https://github.com/flamoris-jp/flamoris-2D/issues/96)
remains open until its full acceptance conditions are met. Issues #97/#98 are implemented, subject to review.

## Reading the ledger

- `migrated`: the stated native action is reachable, uses existing Product semantics, and has the bounded evidence named in the row.
- `superseded`: a named replacement provides the capability; an old DOM/proof interaction is not duplicated.
- `intentionally deferred`: a named release/architecture gate or pre-existing roadmap boundary; never an unexplained missing feature.

Paths in the owner column are relative to `product/src/`. Native implementations are under
`product/native/src/Flamoris2D.App/`, the typed clients under `Flamoris2D.ProductHost.Client/`,
and the adapters under `product/product-host/`. A generic Host command route by itself is not a native UI.
Tests prove the contracts stated; no CI result substitutes for physical Windows visual acceptance.

## Decisions and remaining release gates

| Gate | Disposition | Evidence / remaining acceptance |
| --- | --- | --- |
| G1 — Native document / Recovery contract | Implemented; ADR 0007 settled under explicit user authorization | Full envelope, save receipts, atomic writer, exact lineage/snapshot cleanup, corrupt/future preservation, replacement guards and native Recovery UI; review remains open |
| G2 — Bulk assets / envelope ownership | Implemented | PSD/flimg decode workers, authenticated binary document/raster handles, artwork round-trip and reimport/history retention; 128 MiB document, 256 MiB transfer pool, 512 MiB artwork admission including decode/history/candidate residency |
| G3 — Native renderer choice | Implemented; ADR 0008 measured decision | D3D11 hardware + WARP fallback, shared Preview/Export; software reference; full-HD measurement and error tolerances below |
| G4 — Production acceptance / packaging | Portable candidate implemented; final human/release gate open | Self-contained .NET 10 + Node 24.21.0 + pinned shared FFmpeg; exact Host/worker allowlist and packaged smoke with developer runtimes absent from PATH. Physical DPI/focus/feel, private production artwork, signed installer/update/association/default release still require acceptance |
| G5 — Live MCP transport | Migrated under #107; PR / Windows acceptance required | ADR 0011; Core 1.1.0 stdio bridge/local pipe, Native permission menu, same Host queue/session/source history, revocation and protocol/security tests, packaged WPF external-edit smoke. No filesystem capability. |

ADR 0009 exposes identity-only Commands for the existing Phase 8 mesh animation target,
allowing fresh PSD/flimg projects to author MeshDeformation samples/tracks. It does not
change schema version, writable geometry, evaluation order or time semantics.

The authority remains **WPF gesture -> typed Command/Transaction -> Product Host -> one
EditorSession -> Project/history**. C# owns OS files/settings, immutable projections,
transient selection/gesture drafts and rendering only. Immediate local handles never wait
for IPC. Coalesced image previews evaluate a disposable Product command draft, cancel stale
requests, and do not alter history or revision; one semantic command commits on release.

## Workflow and implementation locations

| Workflow | Sub-context / tools | Main native implementation and Product adapter |
| --- | --- | --- |
| Source | Document, Part/Object, import/update, Properties | MainWindow.Document/Source/Preferences/KeyState; document-lifecycle/transfer/artwork, source-import/reimport, key-state-authoring |
| Mesh | Structure vs Layout; Select/Add/Remove/Connect/Subdivide/Generate/Move | MainWindow.Mesh/KeyState, MeshViewport; mesh-hands-on, key-state-authoring |
| Rig | Bone / Warp / Weight; actual Select/Add/Move/Delete/Paint tools where applicable | MainWindow.Rig, MeshViewport.Rig; rig-authoring and existing controllers |
| Deform | Key State, post-rig correction, reusable animation shape | MainWindow.Rig/KeyState; FormCorrectionAuthoringController, key-state-authoring |
| Animation | Sequence/ViewLane/Clip/Track/Keys; Transition time authoring | MainWindow.Animation, TimelineViewport; timeline-authoring/transition-timeline and existing controllers |
| Preview | State selector, scrub, play, Once/Loop | MainWindow.Render/Animation; evaluated-projection, canonical evaluators and D3D11 |
| Export | PNG/MP4, dimensions/FPS, destination/progress/cancel | MainWindow.Export; native-export, PngFrameWriter, NativeVideoEncoder, same D3D11 renderer |

Left tools, top contextual controls, right targets/properties and the Animation-only bottom
Timeline remain distinct. Empty placeholder tools were removed; Warp creation/deletion is
explicit in Properties. The [Japanese production guide](native-production-workflow.md)
provides the complete import-to-reopen path and final Windows checklist.

## Feature ledger

| Capability | Current owner | Command / Query / evaluator | Native workflow | Sub-context | Native UI location | Status | Protecting tests | Disposition / remaining acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New document | `app.js`, `model/project.js` | `session.create` | Source | Document | menu | migrated | `product-host.test.js`; native-document-host.test.js; C# DocumentTests | Native New with revision-qualified unsaved replacement; fresh lineage/token (ADR 0007). |
| Open .fl2d + legacy migration | `io/project-json.js`, `desktop/main.mjs` | `parseProjectDocument` | Source | Document | menu/dialog | migrated | `phase1c.test.js`, `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Binary document upload; full existing parser/migrations and envelope retained; candidate admitted before replacement. |
| Save / Save As | `io/project-files.js` | `serializeProject`, `EditorSession.markSaved` | Source | Document | menu/dialog | migrated | `phase1c.test.js`, `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Native dialogs; immutable save receipt; durable atomic write precedes acknowledgement and path association. |
| Save Incremental | `io/project-files.js` | `incrementalFilename`, exclusive writer | Source | Document | menu/dialog | migrated | `phase1c.test.js`, `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Existing incrementalFilename helper; highest existing suffix, configured width, exclusive no-overwrite writer. |
| Save Copy | `io/project-files.js` | `saveCopy` | Source | Document | menu/dialog | migrated | `phase1c.test.js`; native-document-host.test.js; C# DocumentTests | Writes a snapshot without changing current association, lineage or saved history identity. |
| Atomic write / failure | `desktop/atomic-write.js` | same-directory temp/flush/replace | Source | Document | storage adapter | migrated | `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Same-directory temporary file, WriteThrough + Flush(true), replace/exclusive move; failures preserve destination and dirty state. |
| Dirty / saved revision | `commands/editor.js` | `isDirty`, `savedRevision` | Source | Document | title/status | migrated | `phase1c.test.js`; native-document-host.test.js; C# DocumentTests | EditorSession history identity is authoritative; edits during write stay dirty; Undo to the acknowledged history state is clean. |
| Current path / Recent | `desktop/main.mjs`, `desktop/shell-logic.js` | typed desktop file IPC | Source | Document | menu/title | migrated | `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Current path and ten recent files live in native settings; Save Copy does not re-associate. OS registration is separately deferred under G4. |
| Unsaved close / replace | `app.js`, `desktop/main.mjs` | document controller | Source | Document | dialog | migrated | `desktop-shell.test.js`; native-document-host.test.js; C# DocumentTests | Save, discard live edits, or cancel; recheck exact token/revision before New/Open/import/restore/close. Discard does not erase Recovery. |
| Recovery restore/dismiss/discard | `io/project-json.js`, `app.js` | recovery store + session replace | Source | Recovery | startup card/menu | migrated | `phase1c.test.js`; native-document-host.test.js; C# DocumentTests | NativeRecoveryStore + ADR 0007; immutable checksum snapshots; lineage-scoped cleanup; session-only dismissal; corrupt/future candidates retained. |
| PSD import / negative bounds | `psd.js`, `io/psd-project.js`, `app.js` | `window.agPsd.readPsd`, `createProjectFromPsd` | Source | Import | menu/dialog | migrated | `psd.test.js`, `psd-project.test.js`, `psd-document-clipping.test.js`; native-source-host.test.js; packaged WPF production smoke | Pinned ag-psd worker; existing PSD project/fingerprint logic; cropped/negative raster bounds retained; canonical unprepared-Part composition. |
| Cutwork .flimg import | `io/cutwork-flimg-reader.js`, `io/cutwork-flimg-project.js` | `importCutworkFlimg` | Source | Import | menu/dialog | migrated | `cutwork-flimg-import.test.js`; native-source-host.test.js; packaged WPF production smoke | Existing archive reader/materialization limits; bounded decode worker; native source dialog and canonical render projection. |
| PSD re-import analyze/review/apply | `io/psd-reimport-review.js`, `ui/reimport-render-history.js` | `source.apply_psd_reimport` | Source | Update | menu/review dialog | migrated | `phase1c.test.js`, `psd-project.test.js`; native-source-host.test.js; packaged WPF production smoke | Analyze and explicit review; ambiguity rejected; normal source.apply_psd_reimport; old/new artwork follows the same EditorSession Undo/Redo. |
| Parts hierarchy / row selection | `ui/editor-adapter.js`, `ui/scene-editor-view.js` | `scene.get_tree` | Source | Object / Part | right Targets | migrated | `editor-ui-adapter.test.js`; product-host.test.js; C# client tests / WPF smoke | Stable-ID tree and selection; selecting a row does not change visibility or persistent Project. |
| Name | `ui/scene-editor-view.js` | `scene.rename_node` | Source | Object / Part | right Properties | migrated | `editor-core.test.js`, native client tests; product-host.test.js; C# client tests / WPF smoke | Revision-qualified Properties transaction with visibility/lock; unfocused drafts retain starting revision. |
| Visibility vs selection | `ui/scene-editor-view.js` | `scene.set_visibility` | Source | Object / Part | right Targets / Properties | migrated | `editor-ui-adapter.test.js`; product-host.test.js; C# client tests / WPF smoke | Row eye addresses that row; independent selected target; hidden geometry is not pickable. |
| Lock | `ui/scene-editor-view.js` | `scene.set_locked` | Source | Object / Part | right Targets / Properties | migrated | `editor-core.test.js`; product-host.test.js; C# client tests / WPF smoke | Independent row/property operation; native geometry/helper tools reject locked targets. |
| Group / reparent | `ui/editor-adapter.js` | `scene.create_group`, `scene.reparent_node` | Source | Hierarchy | right Targets | migrated | `editor-ui-adapter.test.js`; product-host.test.js; C# client tests / WPF smoke | Source > 配置・グループ; create group, explicit parent and order; ordinary scene commands. |
| Transform / pivot | `ui/editor-adapter.js`, `ui/canvas-interaction.js` | `scene.set_transform` complete node-local replacement | Source | Object | left Move / right Properties | migrated | `editor-ui-adapter.test.js`, `mcp-schemas.test.js`; product-host.test.js; C# client tests / WPF smoke | Source properties edit complete node-local position/rotation/scale/pivot through scene.set_transform; canonical renderer supplies the result. |
| Stable-ID search / target details | `queries/project.js` | `scene.search`, `scene.get_node` | Source | Object | right Targets / Properties | migrated | `editor-core.test.js`; product-host.test.js; C# client tests / WPF smoke | Targets name/ID filter over authoritative projection; target details retained independently; animation target lists reuse scene.search. |
| Host handshake / lifecycle | `product-host/main.mjs`, native client | version/requestId/token/health | all | Session | status | migrated | `product-host.test.js`, native client tests; product-host.test.js; C# client tests / WPF smoke | Version/request/token negotiation; one supervised Node Host; protocol mismatch fails closed. |
| Undo / Redo / Transaction | `commands/editor.js` | one `EditorSession` | all | History | menu/toolbar | migrated | `product-host.test.js`, native client tests; product-host.test.js; C# client tests / WPF smoke | One authoritative EditorSession and history shared by all native tools; no persistent C# Project or alternate history. |
| Headless shared history | `mcp/adapter.js` | same session commands | all | Session | Host | migrated | `product-host.test.js`; product-host.test.js; C# client tests / WPF smoke | Existing MCP adapter and native requests use the same session; ordering/transaction/Undo/Redo tests. External live attachment is implemented under G5 / ADR 0011. |
| Host crash / stale rejection | native client and shell | token/revision invalidation | all | Session | banner/status | migrated | native client tests; product-host.test.js; C# client tests / WPF smoke | Authority invalidation clears projections and cancels editing; explicit restart/Recovery; no WPF projection serialized as a document. |
| PNG hands-on raster delivery | `product-host/raster-assets.mjs`, native `ArtworkLoader` | token/revision-qualified binary handles | Source | Disposable proof | menu / viewport | superseded | `native-mesh-host.test.js`, native binary client test; product-host.test.js; C# client tests / WPF smoke | Superseded as the primary workflow by PSD/flimg/Open. Retained only under File > 開発用, explicitly disposable and unsavable. |
| Mesh vertex picking / drag | native `MeshViewport`, `ViewportGeometry` | local preview then existing typed Product tool/command | Mesh | Structure / Layout | canvas | migrated | native geometry/gesture tests, Host history tests; native-mesh-host.test.js; native geometry tests; WPF production smoke | WPF DIP hit testing, capture/Esc cancellation, stable vertex IDs; one Layout/Form command on release. |
| Cross-Key-Art endpoint / correspondence workspace | `ui/endpoint-mesh-controller.js` | keyform / semantic-slot queries | Mesh | Layout | top state selector / right Properties | migrated | `endpoint-mesh.test.js`; native-key-state-host.test.js; WPF production smoke | Top render-owner selector, Key State duplicate, explicit A/B endpoint buttons, shared topology/keyform selectors. |
| Whole-mesh rotation/scale alignment | `ui/endpoint-mesh-controller.js` | keyform positions | Mesh | Layout | top state selector / right Properties | migrated | `endpoint-mesh.test.js`; native-key-state-host.test.js; WPF production smoke | Mesh > 位置決め > メッシュ全体の位置決め; translation, rotation, XY scale and explicit pivot; UVs stay unchanged. |
| Mesh Save/reopen parity | `io/project-json.js` | serialization + source envelope | Mesh | Document | menu | migrated | Product persistence tests; native-mesh-host.test.js; native geometry tests; WPF production smoke | Full .fl2d envelope includes artwork and stable topology/keyforms; native production smoke compares rendered pixels after reopen and subsequent Undo. |
| Raster/bulk transfer + lifetime | `ui/psd-render-assets.js`, `ui/cutwork-render-assets.js` | source assets / render instances | Source | Artwork | viewport | migrated | `cutwork-flimg-import.test.js`, `psd-document-clipping.test.js`; native-document-host.test.js; C# DocumentTests | Authenticated loopback binary handles; bounded transfer/decode/cache/history residency; no base64-in-control workaround. See G2 limits. |
| Zoom / pan / fit / DPI | `ui/viewport-camera-controller.js` | document/display transforms | all | Viewport | canvas / View menu | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; product-host.test.js; C# client tests / WPF smoke | WPF camera in DIPs; wheel/pan/fit; coordinate tests at 1/1.25/1.5/2 scale. Human monitor/DPI/feel acceptance remains G4. |
| Picking / overlap / overlays | `ui/viewport-input-controller.js`, `ui/viewport-renderer.js` | evaluated stable-ID targets | all | Viewport | canvas | migrated | `editor-ui-adapter.test.js`, `ui-controller-boundaries.test.js`; product-host.test.js; C# client tests / WPF smoke | Source picking uses canonical evaluated triangles and draw order; Alt cycles overlaps; unprepared references use bounds. It is geometric picking, not per-pixel alpha-mask picking. |
| Capture/cancel/local preview | `ui/canvas-interaction.js`, feature controllers | one command on completion | all | Gesture | canvas | migrated | `editor-ui-adapter.test.js`, `sequence-timeline-controller.test.js`; product-host.test.js; C# client tests / WPF smoke | Immediate local handles and coalesced, cancellable Product draft render plans; no persistent pointer-move writes; generation/revision rejection; one commit on release. |
| Mesh target / active keyform | `ui/mesh-editing-controller.js`, `ui/endpoint-mesh-controller.js` | `mesh.get_topology`, `mesh.get_keyform` | Mesh | Layout | right Targets / top Options | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Production Part selector plus explicit Key Art and mesh/keyform choices; ambiguous/missing contexts reject rather than guessing. |
| Add Vertex | `ui/mesh-tool-controller.js` | `mesh_topology.add_vertex` | Mesh | Structure | left Add | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Stable isolated vertex; UI explains that three selected vertices must be connected into a face to cover additional image area. |
| Remove / dissolve | `ui/mesh-tool-controller.js` | `mesh_topology.remove_vertex` | Mesh | Structure | left Remove | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Existing remove-with-incident-faces behavior; not a new retriangulating dissolve algorithm; dependency validation retained. |
| Connect / triangle | `ui/mesh-tool-controller.js` | `mesh_topology.create_triangle` | Mesh | Structure | left Connect | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Select three stable vertices and explicitly create a triangle; winding/degeneracy validation remains Product-owned. |
| Subdivide edge | `ui/mesh-tool-controller.js` | `mesh_topology.subdivide_edge` | Mesh | Structure | left Subdivide | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Select two edge endpoints; existing stable-ID and compatible-keyform propagation; incompatible rig/deformation dependencies reject. |
| Vertex IDs / semantic labels | `ui/mesh-tool-controller.js` | topology label commands | Mesh | Structure | overlay / right Properties | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Optional high-contrast stable-ID overlay; selected vertex label/clear controls. |
| Grid / Contour AutoMesh | `ui/mesh-preparation-controller.js`, `core/contour-automesh.js` | `mesh_topology.apply_generated_mesh` | Mesh | Generate | left Generate / top Options | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Part bounds/alpha, configurable Grid and Contour; cancellable bounded worker; preview before ordinary command apply. |
| Correspondence / pins | `ui/correspondence-preview-controller.js`, `core/correspondence-solver.js` | normal MeshKeyform output | Mesh | Layout | top state selector / right Properties | migrated | `correspondence-preview.test.js`, `correspondence-solver.test.js`; native-key-state-host.test.js; WPF production smoke | Direction/preset, stable vertex pin add/update/remove, deterministic solve, actual image preview/cancel and apply at captured revision. |
| Layout vertex / whole mesh alignment | `ui/endpoint-mesh-controller.js` | `mesh_keyform.move_vertices` | Mesh | Layout | left Move / top Options | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Textured image follows Product Layout preview/commit; selected/all vertex translation and whole-mesh rotation/scale; Deform remains separate. |
| Mesh overlay visibility / contrast | `ui/viewport-renderer.js`, `ui/mesh-authoring-view.js` | topology/keyform projections | Mesh | Structure / Layout | canvas / top Options | migrated | `native-mesh-host.test.js`, native geometry/client tests, WPF mesh smoke; native-mesh-host.test.js; native geometry tests; WPF production smoke | Independent overlay/ID/contrast controls; hidden/locked target handles suppressed; final legibility requires G4 artwork checks. |
| Legacy writable mesh cache | `mesh.js`, compatibility renderer | `state.mesh/baseVertices/vertexOffsets` | Mesh | none | none | superseded | `editor-ui-adapter.test.js`; native-mesh-host.test.js; native geometry tests; WPF production smoke | Replaced by Product MeshTopology/MeshKeyform and read-only render plans; no legacy geometry writer in WPF. |
| Bone creation / rest / hierarchy | `ui/bone-authoring-controller.js` | Bone commands + FK | Rig | Bone | left Add/Move / right Properties | migrated | `bone-authoring-controller.test.js`, `phase7-bone-fk-domain.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Bone: Select/Add/Move/Delete; numeric rest/name/length, enabled state and parent; Product ancestor-Warp authoring-space projection. |
| Bone pose / reset / ghost | `ui/bone-authoring-controller.js` | `bone.set_keyform`, `bone.reset_keyform` | Rig | Pose | canvas / right Properties | migrated | `bone-authoring-controller.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Bone > 原画のポーズを編集: posed versus dashed rest frame, drag/numeric pose and reset; distinct from rest edits. |
| Rigid attachment | `ui/bone-authoring-controller.js` | rigid-binding commands | Rig | Bind | right Properties | migrated | `phase7-rigid-binding-domain.test.js`, `phase7-rigid-transition.test.js`; native-rig-host.test.js; WPF production smoke | Bind/change Bone, enable/disable and remove; post-Warp FK remains Product authority. Disabled bindings can also be removed. |
| Warp lattice / nesting | `ui/deformer-authoring-controller.js` | Warp commands | Rig | Warp | left Add / right Properties | migrated | `deformer-authoring-controller.test.js`, `phase6-warp-domain.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Warp: create/attach/reparent/rename/remove, 2/3/4 grid; local lattice and ancestor-projected document handles; nested coordinate tests. |
| Warp control-point keyform | `ui/deformer-authoring-controller.js` | `deformer.move_control_points` | Rig | Warp pose | canvas / right Properties | migrated | `phase6-warp-transition.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Warp with selected Key Art: multi-select move/reset/all reset and actual image preview; inverse ancestor-Warp mapping remains Product-owned. |
| SkinBinding / weights / normalize / clear | `ui/weight-authoring-controller.js` | skin commands / deterministic LBS | Rig | Weight | left Paint / right Properties | migrated | `phase7-weight-form-authoring.test.js`, `phase7-skin-binding-domain.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Weight: initialize, paint/subtract, numeric/normalize, explicit 1–4 influence replacement, enable/remove; clear all weights requires disabled Skin as in Product validation. |
| Weight visualization | `ui/weight-viewport-overlay.js` | `skin.get_vertex_weights` | Rig | Weight | overlay | migrated | `phase7-weight-form-authoring.test.js`; native-rig-host.test.js; WPF production smoke | WPF color overlay at canonical evaluated vertices; stable IDs and selected Bone; one history unit per stroke. |
| Rotation constraints | `ui/bone-authoring-controller.js` | Bone constraint commands | Rig | Constraints | right Properties | migrated | `phase7-constraint-domain.test.js`, `phase7-constraint-evaluator.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Bone: bounds, enabled state and removal; Product clamps before FK. |
| Two-bone IK definition | `ui/two-bone-ik-authoring-controller.js` | IK constraint commands | Rig | IK | right Properties | migrated | `phase7-ik-domain.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Bone: root/middle/end IDs, bend direction, enabled state and removal; same Product constraints. |
| IK pose gesture | `ui/two-bone-ik-authoring-controller.js` | solver then Bone keyforms transaction | Rig | IK pose | canvas / right Properties | superseded | `phase7-ik-authoring-solver.test.js`, `phase7-ik-authoring-controller.test.js`; native-rig-host.test.js; WPF production smoke | Replaced canvas-target entry with explicit document XY fields, read-only image preview/cancel and apply. Existing solver bakes ordinary Bone keyforms; no runtime IK. |
| Bone mirror helper | `ui/bone-mirror-authoring-controller.js` | `core/bone-mirror-helper.js` -> ordinary commands | Rig / Deform | Bone / Pose | top Options | migrated | `phase7-bone-mirror-authoring.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Bone: explicit target Bone/axis and rest/pose mode; read-only image preview/cancel, ordinary transaction apply; locked targets reject. |
| Clipping | `ui/clipping-authoring-controller.js` | clipping commands / final-geometry evaluator | Rig | Clipping | right Properties | migrated | `clipping-authoring.test.js`, `phase6-clipping-domain.test.js`; native-rig-host.test.js; WPF production smoke | Rig > Weight: source, enabled and remove; dynamic ClippingTrack in Animation; canonical final-geometry clipping and cycle validation. |
| Key Art / semantic mapping | `ui/transition-authoring-controller.js` | Key Art / semantic-slot commands | Deform | Key State | top target / right Properties | migrated | `transition-authoring.test.js`; native-key-state-host.test.js; WPF production smoke | Source/Mesh/Deform panels: duplicate/name, opacity/presence/order, slot create/name/map/unmap/remove; unreferenced Key Art deletion; existing reference rejection retained. |
| Key State strip / endpoint selection | `ui/key-state-strip-controller.js` | KeyArt/Transition projections | Deform | Key State | top state selector / right endpoint buttons | superseded | `key-state-strip.test.js`; native-key-state-host.test.js; WPF production smoke | Compact strip replaced by top render-owner selector and A/B endpoint buttons; full Timeline remains only in Animation. |
| Form correction / reset | `ui/form-correction-authoring-controller.js` | `mesh_form.set_vertex_offsets` | Deform | Correction | left Move/Reset | migrated | `phase7-form-correction-domain.test.js`, `phase7-form-correction-evaluator.test.js`; native-rig-host.test.js; WPF production smoke | Deform: selected-vertex drag/numeric correction and reset; canonical post-Warp/Bone/Skin correction positions used for picking and image preview. |
| Mesh deformation sample | `ui/sequence-timeline-controller.js` | animation deformation-sample commands | Deform / Animation | Shape / Track | properties / Timeline | migrated | `phase8-mesh-deformation-sample.test.js`; native-key-state-host.test.js; WPF production smoke | Deform: stable-vertex sample create/update/remove and reuse; Animation MeshDeformationTrack; identity-only registration via ordinary commands (ADR 0009). |
| Transition mode / topology refs / diagnostics | `ui/transition-authoring-controller.js`, diagnostics controller | transition commands / `transition.evaluate` | Deform | Transition | right Properties / diagnostics | migrated | `transition-authoring.test.js`, `transition-core.test.js`; native-key-state-host.test.js; WPF production smoke | Deform > 遷移・パーツ対応: endpoints, duration, all existing modes, shared topology, diagnostics and evidence-qualified acknowledgement/revoke. |
| Transition typed keys / timing / endpoint preview | `ui/transition-preview-controller.js` | TemporalProgram commands | Deform / Preview | Transition | bottom strip | migrated | `transition-preview.test.js`, `temporal-core.test.js`; native-key-state-host.test.js; WPF production smoke | Choose Transition then Animation: GeometryBlend/Appearance/display typed tracks and keys/easing; canonical ticks and endpoints; Preview transport. |
| Sequence create/update/remove | `ui/sequence-timeline-controller.js` | sequence commands | Animation | Sequence | bottom Timeline header | migrated | `sequence-command-query.test.js`; native-timeline-host.test.js; WPF production smoke | Animation properties: name/duration/create/remove; existing owned TemporalProgram lifecycle. |
| ViewLane holds / transitions / retime | `ui/sequence-timeline-controller.js` | view-item commands | Animation | ViewLane | bottom Key Art lane | migrated | `sequence-timeline-controller.test.js`, `sequence-evaluator.test.js`; native-timeline-host.test.js; WPF production smoke | Animation > ViewLane properties: hold/transition insert, edit bounds/reference, reorder/remove with explicit neighbor absorption; contiguous coverage validation. |
| Clip library create/update/remove | `ui/sequence-timeline-controller.js` | animation.clip commands | Animation | Clips | right secondary targets | migrated | `animation-clip-command-query.test.js`; native-timeline-host.test.js; WPF production smoke | Animation properties: reusable clip name/duration/Once/Loop; create/update/remove with owned program; references prevent unsafe removal. |
| ClipInstance place/trim/rate/layer/weight | `ui/sequence-timeline-controller.js` | sequence clip-instance commands | Animation | Clips | bottom Timeline / Properties | migrated | `clip-instance-foundation.test.js`, `sequence-timeline-controller.test.js`; native-timeline-host.test.js; WPF production smoke | Animation properties and Timeline drag: interval, source offset, rational speed, loop, enabled, weight/layer; ordinary placement command. |
| Typed track/owner/target selection | `ui/sequence-timeline-controller.js` | TemporalProgram tracks | Animation | Tracks | bottom / right Properties | migrated | `phase8-animation-tracks.test.js`; native-timeline-host.test.js; WPF production smoke | Sequence or clip owner; Transform/Bone/Deformer/MeshDeformation/Opacity/Presence/DrawOrder/Clipping/Camera with Product-projected targets and allowed channels. |
| Keyframe add/update/remove / easing | `ui/sequence-timeline-controller.js`, `ui/ease-presets.js` | temporal keyframe commands | Animation | Keys | bottom / Tool Options | migrated | `ease-presets.test.js`, `sequence-timeline-controller.test.js`; native-timeline-host.test.js; WPF production smoke | Channel/time/value keys; presets, step/linear/cubic-Bezier controls; discrete channel constraints remain Product-owned. |
| Timeline drag / cancel / no-op | `ui/sequence-timeline-controller.js` | one transaction | Animation | Timeline | bottom | migrated | `sequence-timeline-controller.test.js`; native-timeline-host.test.js; WPF production smoke | Custom WPF drawing rather than per-key controls; key/clip drag, click selection, scroll/zoom, capture/Esc/revision cancellation; one command on release. |
| Scrub/playback/playhead/Once/Loop | `ui/sequence-timeline-controller.js`, `core/clip-time.js` | `sequence.evaluate` | Animation / Preview | Transport | bottom local controls | migrated | `timeline-primitives.test.js`, `clip-instance-foundation.test.js`; native-timeline-host.test.js; WPF production smoke | Product TransientPlaybackClock maps elapsed samples to canonical 120000-tick/rational semantics; WPF presents the result and skips overlapping frame work. |
| Sequence camera / CameraTrack | `core/sequence-mixer.js` | typed CameraTrack / Sequence camera | Animation / Preview | Camera | properties / Timeline | migrated | `phase8-sequence-mixer.test.js`; native-timeline-host.test.js; WPF production smoke | Sequence-owned CameraTrack values and keys; no Camera clip or second camera evaluator. Constant camera settings are single-key tracks. |
| Deterministic preview | `core/evaluated-render.js`, `core/shared-composition-renderer.js` | canonical evaluated frame | Preview | Shot | viewport | migrated | `phase8-production-proof.test.js`, `phase8-sequence-rig-mixer.test.js`; product-host.test.js; C# client tests / WPF smoke | Canonical evaluator -> render/clipping plan -> shared D3D11 backend; measured hardware/WARP selection in ADR 0008. |
| PNG sequence | `core/frame-sequence-export.js`, `core/png-frame-encoder.js` | export frame planner/evaluator | Export | PNG | dialog | migrated | `frame-sequence-export.test.js`, `export-frame-renderer.test.js`; native-export-host.test.js; C# ExportTests; packaged WPF export | Native PBGRA-to-RGBA PNG encoder; canonical frame plan, naming and geometry; same D3D11 source frames as Preview. |
| MP4 H.264 / FFmpeg | `core/video-encoder.js`, `desktop/ffmpeg-video-encoder.mjs` | approved encoder process contract | Export | MP4 | dialog | migrated | `video-encoder.test.js`, `ffmpeg-video-encoder.test.js`; native-export-host.test.js; C# ExportTests; packaged WPF export | Separate LGPL shared FFmpeg process, existing h264_mf probe/arguments; pinned packaged encoder; real ffprobe checks 240 decoded H.264 frames / eight seconds. |
| Export destination/progress/cancel/diagnostics | `ui/export-dialog-view.js`, `core/export-job-controller.js` | job controller / typed sinks | Export | Job | dialog/status | migrated | `export-job-controller.test.js`, `desktop-frame-sequence.test.js`; native-export-host.test.js; C# ExportTests; packaged WPF export | New/empty destination, frozen token/revision, progress and cancellation; completed PNGs retained; atomic no-overwrite frame/video publication. |
| Preview/PNG/MP4 source-frame parity | `core/export-frame-evaluator.js` | canonical time/render settings | Preview / Export | Shot | viewport/dialog | migrated | `phase8-production-persistence-export.test.js`; native-export-host.test.js; C# ExportTests; packaged WPF export | Same canonical ticks and D3D11 renderer; host plan comparisons, native pixel checks, PNG codec tests and real MP4 decode metadata. Lossy MP4 is not byte-identical to PNG. |
| Full graph editor / runtime IK / brush-proportional mesh | roadmap future work | not current production capability | later | later | none yet | intentionally deferred | no production claim; Existing semantic tests only; no future-feature claim | Pre-existing roadmap work, not current production authoring. Numeric Bezier, baked IK and existing correction tools remain available; no new domain invented. |
| Native portable package | app project / Electron build | explicit artifact boundary | all | Release | installer | migrated | native CI / `production-manifest.test.js`; product-host.test.js; C# client tests / WPF smoke | Self-contained portable candidate with exact Node runtime, reviewed Host/worker graph, decoder and pinned shared encoder. Installer/signing/association/default-shell cutover remains G4. |
| Per-Key-Art UV editing and mesh cleanup | ui/endpoint-mesh-controller.js | mesh_keyform.update/remove; mesh_topology.remove | Mesh | Layout / resources | right 画像の割当・メッシュの削除 | migrated | native-key-state-host.test.js; Product mesh tests | Explicit stable-vertex UV fields; unreferenced keyform/topology removal. Referenced rig/transition data is not cascaded away. |
| Save/Recovery preferences | preferences.js; native MainWindow.Preferences.cs | normalizePreferences; incrementalFilename | Source | Settings | Edit menu | migrated | native-document-host.test.js; C# DocumentTests | Autosave enable/interval, retained versions, major-import checkpoint, startup notification, incremental suffix width. OS preferences stay outside Project. |
| Live desktop MCP discovery/authentication/multi-client attachment | mcp/adapter.js; ADR 0006 | existing shared-session adapter | all | Session | Core bridge / local pipe | migrated | official-client and packaged WPF smoke | G5 / ADR 0011: one authenticated client at a time; reconnect shares the existing authority. |
| Installer/signing/update/file association and Electron retirement | desktop build; migration design §18 | release cutover | all | Release | installer | intentionally deferred | portable package smoke is not an installer test | G4: human production/DPI acceptance and reviewed release policy are prerequisites. Electron stays as the default production release. |
| Temporal events and regions authoring | commands/temporal-command-handlers.js | animation.temporal.add_event/add_region | Animation | reserved Core data | no current production UI | intentionally deferred | temporal-core.test.js | Reserved generic TemporalProgram API; not exposed by the existing Sequence/Transition production controllers. Preserve and round-trip existing data; do not invent event playback semantics. |
| Documents/output beyond native admission limits | document-transfer/artwork; native-export; ADR 0008 | explicit resource admission | Source / Export | large workloads | diagnostics | intentionally deferred | native-document/source/export tests | Expansion beyond the stated 128 MiB encoded document / 512 MiB artwork admission / 4096-edge export policy requires measured memory evidence. Rejection preserves the current document; Electron remains available during cutover. |

## Acceptance evidence and limits

The packaged WPF production smoke imports an actual synthetic PSD, generates a 4×4 mesh,
changes Layout and checks changed texture pixels plus exact Undo/Redo, authors Bone/Skin,
Warp and form correction, registers a reusable MeshDeformation sample/track, builds an
eight-second Sequence/clip, scrubs and compares Animation/Preview, exports 240 PNG frames
and H.264, checks ffprobe codec/frame count/duration, atomically saves, opens a new session,
reopens and resumes editing/Undo, reviews PSD reimport/Undo/Redo, duplicates a Key State,
authors a shared-mesh Transition, and imports an actual synthetic Cutwork archive.

Independent canonical production fixtures cover nested Warp, rigid Bone, constraints,
correction, dual appearances, clipping and camera. Full-HD renderer measurement at remote
commit `0c7824c8959d168cb5d682f2f6f939a70337c412`: 1920×1080, 720 evaluated triangles,
13 synthetic 512×512 textures; software 816.89 ms (one frame), WARP median 25.34 ms,
hardware-device median 27.08 ms (five warm frames each, CPU readback included). Mean channel
error against software: 0.0006/255, isolated edge max 255 on less than 0.00005% of channels.
Those are runner measurements, not a guarantee for a user's GPU or a full interop frame.
See [ADR 0008](decisions/0008-native-renderer-selection.md) for exact methodology/limits.

Preview presentation is at most 2048 pixels on the long edge while retaining document
coordinates. Native export is at most 4096 pixels per edge and 8294400 pixels; MP4 requires
even dimensions. These are explicit native resource policies, not silent project resizing.
Preview/export use the same canonical source-frame semantics; lossy H.264 cannot be
byte-identical to PNG. Per-pixel alpha-mask picking is not implemented; geometric picking
and overlap cycling plus the stable target list remain available. Reference-protected
entity deletion rejects rather than cascading through authored data. General graph-editor,
runtime IK and proportional-brush work remains the pre-existing roadmap scope.

Final acceptance uses real user artwork and 100/125/150/200% DPI for focus, hit testing,
latency, overlay contrast, first-time discoverability, dialogs and save/reopen feel.
Synthetic fixtures are test inputs only and are absent from the runtime package.
Electron stays until every retirement stop condition in `csharp-wpf-ui-migration.md` §18
passes and a cutover PR is reviewed. This ledger does not claim installer/signing/file
association or live MCP transport acceptance.

## Exact public contract coverage

Each entry inherits its workflow row's tests and limitations. Queries may be exposed by
bundled immutable projections or canonical evaluation rather than a standalone button.
Raw topology replacement is superseded by validated Structure/generation tools; Warp
move/reset uses an equivalent complete keyform command so the first pose is also valid.
Validation/sample queries marked superseded are enforced or presented by the canonical
open/commit/render pipeline. Internal inverse commands are not public native tools.

| Kind | Contract | Current implementation owner | Native route | Status |
| --- | --- | --- | --- | --- |
| Command | `animation.deformation_sample.create` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | migrated |
| Command | `animation.deformation_sample.update` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | migrated |
| Command | `animation.deformation_sample.remove` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform / Animation > Shape | migrated |
| Command | `animation.clip.create` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.clip.update` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.clip.remove` | `src/commands/animation-clip-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.create` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.add_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove_view_item` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.add_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.update_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `sequence.remove_clip_instance` | `src/commands/sequence-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `bone.create_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_two_bone_ik` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_two_bone_ik_enabled` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_two_bone_ik_bend_direction` | `src/commands/two-bone-ik-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.create_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_rotation_constraint` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rotation_constraint_enabled` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rotation_constraint_bounds` | `src/commands/bone-constraint-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `mesh_form.create_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | migrated |
| Command | `mesh_form.set_vertex_offsets` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | migrated |
| Command | `mesh_form.reset_keyform` | `src/commands/mesh-form-correction-command-handlers.js` | Deform > Correction | migrated |
| Command | `skin.create_binding` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `skin.remove_binding` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `skin.set_enabled` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `skin.set_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `skin.set_weights_bulk` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `skin.clear_vertex_weights` | `src/commands/skin-binding-command-handlers.js` | Rig > Weight | migrated |
| Command | `bone.create_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rigid_binding_bone` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rigid_binding_enabled` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove_rigid_binding` | `src/commands/rigid-bone-binding-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.create` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.remove` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.rename` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_rest` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_enabled` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.reparent` | `src/commands/bone-command-handlers.js` | Rig > Bone / Bind / Constraints | migrated |
| Command | `bone.set_keyform` | `src/commands/bone-command-handlers.js` | Deform > Pose | migrated |
| Command | `bone.reset_keyform` | `src/commands/bone-command-handlers.js` | Deform > Pose | migrated |
| Command | `deformer.create_warp` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | migrated |
| Command | `deformer.remove` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | migrated |
| Command | `deformer.rename` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | migrated |
| Command | `deformer.set_grid` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | migrated |
| Command | `deformer.set_keyform` | `src/commands/warp-deformer-command-handlers.js` | Deform > Warp pose | migrated |
| Command | `deformer.move_control_points` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp move/reset via equivalent deformer.set_keyform | superseded |
| Command | `deformer.reset_control_points` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp move/reset via equivalent deformer.set_keyform | superseded |
| Command | `deformer.reparent_node` | `src/commands/warp-deformer-command-handlers.js` | Rig > Warp | migrated |
| Command | `clipping.create` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | migrated |
| Command | `clipping.set_source` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | migrated |
| Command | `clipping.set_enabled` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | migrated |
| Command | `clipping.remove` | `src/commands/clipping-command-handlers.js` | Rig > Clipping | migrated |
| Command | `keyart.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `keyart.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `keyart.remove` | `src/commands/transition-command-handlers.js` | Key State > delete unreferenced state; dependent data is preserved/rejected | migrated |
| Command | `semantic_slot.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.remove` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.map_node` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `semantic_slot.unmap_node` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `mesh_topology.create` | `src/commands/transition-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.update` | `src/commands/transition-command-handlers.js` | Mesh > Structure/generation commands replace raw topology replacement | superseded |
| Command | `mesh_topology.remove` | `src/commands/transition-command-handlers.js` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_topology.add_vertex` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.remove_vertex` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.create_triangle` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.subdivide_edge` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.set_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.clear_vertex_label` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_topology.apply_generated_mesh` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Structure | migrated |
| Command | `mesh_keyform.create` | `src/commands/transition-command-handlers.js` | Mesh > Layout | migrated |
| Command | `mesh_keyform.update` | `src/commands/transition-command-handlers.js` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_keyform.remove` | `src/commands/transition-command-handlers.js` | Mesh > 画像の割当・メッシュの削除; references reject unsafe deletion | migrated |
| Command | `mesh_keyform.move_vertices` | `src/commands/mesh-topology-command-handlers.js` | Mesh > Layout | migrated |
| Command | `transition.create` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.update` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.remove` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.set_part_mode` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.set_part_topology` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.set_diagnostic_override` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `transition.clear_diagnostic_override` | `src/commands/transition-command-handlers.js` | Deform > Key State / Transition | migrated |
| Command | `animation.temporal.create_program` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_program` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.set_duration` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_track` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_track` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.update_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.remove_keyframe` | `src/commands/temporal-command-handlers.js` | Animation > Sequence / Clip / Tracks | migrated |
| Command | `animation.temporal.add_event` | `src/commands/temporal-command-handlers.js` | Reserved Core events/regions; no existing production controller (feature ledger) | intentionally deferred |
| Command | `animation.temporal.add_region` | `src/commands/temporal-command-handlers.js` | Reserved Core events/regions; no existing production controller (feature ledger) | intentionally deferred |
| Command | `source.apply_psd_reimport` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `animation.mesh_target.create` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform > reusable sample | migrated |
| Command | `animation.mesh_target.remove` | `src/commands/mesh-deformation-sample-command-handlers.js` | Deform > reusable sample | migrated |
| Command | `scene.rename_node` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.set_transform` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.set_visibility` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.set_locked` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.create_group` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Command | `scene.reparent_node` | `src/commands/scene-command-handlers.js` | Source > Object / Document | migrated |
| Query | `project.get_render_settings` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `project.get_summary` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `project.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `clipping.get_for_node` | `src/queries/project.js` | Rig > Clipping | migrated |
| Query | `clipping.list` | `src/queries/project.js` | Rig > Clipping | migrated |
| Query | `clipping.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `deformer.list` | `src/queries/project.js` | Rig > Warp | migrated |
| Query | `deformer.get` | `src/queries/project.js` | Rig > Warp | migrated |
| Query | `deformer.get_keyform` | `src/queries/project.js` | Deform > Warp pose | migrated |
| Query | `deformer.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_keyform` | `src/queries/project.js` | Deform > Pose | migrated |
| Query | `bone.get_evaluated_pose` | `src/queries/project.js` | Deform > Pose | migrated |
| Query | `bone.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list_rotation_constraints` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rotation_constraint` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rotation_constraint_for_bone` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_rotation_constraints` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.list_two_bone_ik` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_two_bone_ik` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_two_bone_ik` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.get_two_bone_ik_pose` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `bone.solve_two_bone_ik` | `src/queries/project.js` | Deform > Pose | migrated |
| Query | `bone.list_rigid_bindings` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rigid_binding` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.get_rigid_binding_for_target` | `src/queries/project.js` | Rig > Bone / Bind / Constraints | migrated |
| Query | `bone.validate_rigid_bindings` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `skin.list_bindings` | `src/queries/project.js` | Rig > Weight | migrated |
| Query | `skin.get_binding` | `src/queries/project.js` | Rig > Weight | migrated |
| Query | `skin.get_binding_for_target` | `src/queries/project.js` | Rig > Weight | migrated |
| Query | `skin.get_vertex_weights` | `src/queries/project.js` | Rig > Weight | migrated |
| Query | `skin.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `skin.evaluate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh_form.list_keyforms` | `src/queries/project.js` | Deform > Correction | migrated |
| Query | `mesh_form.get_keyform` | `src/queries/project.js` | Deform > Correction | migrated |
| Query | `mesh_form.get_for_context` | `src/queries/project.js` | Deform > Correction | migrated |
| Query | `mesh_form.validate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh_form.evaluate` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `scene.get_tree` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `scene.get_node` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `scene.search` | `src/queries/project.js` | Source > Object / Document | migrated |
| Query | `animation.get_program` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.list_tracks` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.sample_program` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `animation.clip.get` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.clip.list` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `animation.deformation_sample.get` | `src/queries/project.js` | Deform / Animation > Shape | migrated |
| Query | `animation.deformation_sample.list` | `src/queries/project.js` | Deform / Animation > Shape | migrated |
| Query | `keyart.get` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `keyart.list` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.get` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.list` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `semantic_slot.get_mapping` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `mesh.get_topology` | `src/queries/project.js` | Mesh > Structure | migrated |
| Query | `mesh.list_topologies` | `src/queries/project.js` | Mesh > Structure | migrated |
| Query | `mesh.list` | `src/queries/project.js` | Mesh > Structure | migrated |
| Query | `mesh.get_vertex` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `mesh.get_keyform` | `src/queries/project.js` | Mesh > Structure | migrated |
| Query | `mesh.list_keyforms` | `src/queries/project.js` | Mesh > Structure | migrated |
| Query | `transition.get` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `transition.list` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `transition.get_authoring` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `transition.evaluate` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `transition.get_diagnostics` | `src/queries/project.js` | Deform > Key State / Transition | migrated |
| Query | `sequence.get` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.list` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.get_diagnostics` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.evaluate` | `src/queries/project.js` | Animation > Sequence / Clip / Tracks | migrated |
| Query | `sequence.project_clip_instances` | `src/queries/project.js` | Canonical open/commit validation or bundled authoring/evaluated projection; no second evaluator | superseded |
| Query | `export.get_frame_plan` | `src/queries/project.js` | Export > Output | migrated |
| Query | `export.evaluate_frame` | `src/queries/project.js` | Export > Output | migrated |

## Live MCP disposition authority

`product/product-host/live-mcp-policy.mjs` is the audited, fail-closed operation list.
`live.dispositions` deterministically accounts for **every** public
Command/Query/import from current schemas/implementations. Safe commands have
individual typed tools; queries without a public MCP schema are explicitly excluded,
not silently dropped. Native reviewed reimport and internal restore commands are
excluded even in Edit mode. Native file/binary capabilities remain Native-only.
See [MCP design](mcp-design.md) for paging, revisions, limits and compatibility.
