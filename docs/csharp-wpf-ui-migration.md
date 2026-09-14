# C# / WPF editor shell migration design

Status: proposed for Issue #92  
Baseline audited: `main` at `2d9dd7cc5ec2fd67f845a34a1a692ce07387346d`  
Decision record: [`decisions/0006-csharp-wpf-shell-product-host.md`](decisions/0006-csharp-wpf-shell-product-host.md)

## 1. Purpose and decision summary

FLAMORIS 2D will replace its Electron/DOM editor shell with a Japanese-first C#/.NET WPF desktop shell. The migration is a shell, viewport, input, and authoring-UX replacement; it is not a file-for-file translation of the JavaScript product.

The existing JavaScript Project model, validation, typed Query/Command/Transaction layer, `EditorSession` history, import/migration rules, deterministic evaluation, and MCP schemas remain the Product authority during migration. A versioned, local Product Host boundary exposes that authority to the WPF client. A native viewport and compositor are ported deliberately against the existing `EvaluatedFrame` / render-plan contracts. Electron remains the released shell until the retirement criteria in this document pass.

This preserves the central invariant:

```text
human gesture or MCP request
  -> typed Product Command/Transaction
  -> one authoritative EditorSession
  -> Project/history
```

No C# project model, second undo stack, viewport-only persistent mesh, or MCP-only mutation path is introduced.

## 2. Audit scope and evidence

The audit compared:

- `AGENTS.md`, the current documentation index, basic design, roadmap, MCP design, and repository boundaries;
- ADR 0003 (Mesh Layout versus Deform), ADR 0004 (project/recovery), and ADR 0005 (Electron Windows shell);
- Issues #39, #88, and #90 plus the Issue #90 audit on current `main`;
- the Electron Main/preload boundary, `app.js`, HTML/CSS shell, workflow projection, scene/mesh/rig/timeline controllers, viewport input and overlays;
- Project schema v15, validation/migration, `EditorSession`, queries, render/evaluation/export boundaries, and the headless MCP adapter; and
- the current Cutwork WPF shell and production architecture as a sibling-product UX reference.

The audit found a healthy separation in the lower layers and an overly concentrated browser bootstrap at the top. `product/src/app.js` currently coordinates document lifecycle, workflow, selection, controller choice, viewport synchronization, recovery, and rendering. UI controllers generally respect Command/Query authority, but several also own transient gesture previews and selection. `workflow-modes.js` is correctly transient, while the DOM projection and CSS cascade remain fragile. `viewport-input-controller.js` combines routing for object, mesh, deformer, bone, weight, form-correction, IK, camera, drag/drop, and keyboard modifiers. That is the primary migration seam.

Issue #90 is important evidence: the mature `MeshTopology` / `MeshKeyform` and history contracts survived, while legacy `state.mesh` and workflow projection made the production UI appear to have a second mesh truth. The WPF design must remove that ambiguity rather than recreate it.

Cutwork demonstrates the desired family resemblance: conventional Windows menu and toolbar, a compact left tool rail, a central document canvas, right-side editing targets, contextual tool options near the top, centralized input routing, and one gesture per undo unit. FLAMORIS 2D adopts that grammar without importing Cutwork domain code.

## 3. Current boundary inventory

| Current area | Observed responsibility | Migration concern |
| --- | --- | --- |
| `model/` | Project schema v15, stable identity, persistent scene/mesh/rig/animation state | Must remain the single persistent truth |
| `commands/`, `queries/` | Typed mutation/read boundary and validation | WPF and MCP must call the same surface |
| `commands/editor.js` | Transactional apply, validation, history revisions, Undo/Redo/save point | A C# history would split authority |
| `io/` | `.fl2d` parse/serialize/migration, PSD and Cutwork import, reconciliation | Native dialogs are shell work; format semantics are not |
| `core/` | deterministic transforms, rig, transitions, sequence mixer, render-plan/export orchestration | Porting semantics early creates parity risk |
| `mcp/` | schema discovery and adapter over `EditorSession` | Must connect to the live session, not a copied Project |
| `ui/editor-adapter.js` | transient selection plus authoring-controller composition | Split into WPF workspace state and feature controllers |
| `ui/*authoring-controller.js` | transient selection/gesture preview, queries, command commits | Port behavior; retain typed Product operations |
| `ui/workflow-*` | transient task projection over low-level editor modes | Preserve intent; redesign presentation |
| `ui/viewport-*` | camera, hit testing, pointer capture/routing, Canvas overlays | Port to native viewport/input architecture |
| `ui/sequence-timeline-*` | transient selection/preview and DOM timeline | Port controller UX; retain temporal commands/ticks |
| `renderer.js`, Canvas/WebGL UI rendering | interactive raster/mesh presentation | Native backend required before Electron retirement |
| shared evaluated render/export plan | canonical evaluated output and backend boundary | Preserve and expose through Product Host |
| `desktop/`, `src/desktop/` | Electron lifecycle, IPC allowlist, native dialogs, file association, recent files, atomic writes, FFmpeg | Port OS-facing behavior, then retire Electron host |
| `index.html`, styles, DOM views | current visual shell and workflow projection | Reference only; retire after parity |

## 4. Preserve / interop / port / retire matrix

“Preserve” means the current JavaScript implementation remains authoritative. “Interop” means WPF reaches it only through a typed Product Host boundary. “Port” means behavior is reimplemented in C# because it belongs to the desktop or interactive presentation layer. “Retire” means it cannot remain a production authority. “ADR required” identifies a long-lived choice that must be accepted before the dependent stage begins.

| Capability | Classification | Target treatment |
| --- | --- | --- |
| Project model, stable IDs, schema v15 | preserve + interop | Product Host owns the live Project; WPF consumes projections tagged with revision |
| validation and migrations | preserve + interop | Parse/migrate/validate in the existing Product code; never deserialize into an independently authoritative C# model |
| Query schemas and implementations | preserve + interop | Versioned request/response contract; projections are immutable client snapshots |
| Commands and command schemas | preserve + interop | WPF sends the same command payloads as headless/MCP clients |
| Transaction and `EditorSession` | preserve + interop | One serialized mutation queue and one history for UI and MCP |
| Undo/Redo and saved revision | preserve + interop | WPF routes commands; it displays availability but owns no document undo stack |
| `.fl2d` semantics | preserve + interop | Keep format and migration behavior; C# owns native dialog/association and atomic storage adapter |
| PSD and `.flimg` import semantics | preserve + interop | Keep validation/conversion; stream user-authorized input through typed import operations |
| source render assets | preserve semantics + interop | Transfer immutable/cached raster payloads by asset handle, not inside routine query JSON |
| MeshTopology/MeshKeyform and layout commands | preserve + interop | C# mesh tools commit typed topology/layout commands |
| legacy `state.mesh/baseVertices/vertexOffsets` authoring | retire | May exist only inside a temporary compatibility renderer; never writable Product authority |
| clipping, Warp, Bones/FK, SkinBinding, constraints | preserve + interop | Keep model/evaluator/commands; port only tool and overlay presentation |
| Key Art, Transition, TemporalProgram | preserve + interop | Keep 120000 ticks/sec and canonical evaluation |
| Sequence, AnimationClip, ClipInstance, typed tracks, mixer | preserve + interop | Native timeline edits through existing commands; no C# time model |
| render-plan creation and evaluation order | preserve + interop | Product Host returns canonical evaluated projections/render plans |
| Canvas/WebGL viewport backend | port | Native renderer consumes canonical plans; transient preview overlays stay in C# |
| export evaluator/planner | preserve + interop | Keep frame/tick planning and diagnostics |
| export raster backend | port after parity proof | Use the same native composition semantics as preview where practical |
| FFmpeg process/IPC host | port | C# process service preserves validated argument and cancellation semantics |
| transient workflow mode and editing context | port behavior | One WPF `WorkspaceContext`, never serialized into Project |
| scene/part selection, tool selection, hover, playhead | port behavior | One transient WPF authority, stable-ID based; publish context to feature controllers |
| JS authoring controllers | port behavior, then retire | Recreate focused C# gesture/tool controllers against Product Host; do not translate DOM structure |
| DOM views, `index.html`, CSS shell | retire | Visual reference only after equivalent workflow exists |
| Electron Main/preload/browser security shell | port behavior, then retire | WPF owns Windows lifecycle and exposes no generic filesystem surface to MCP |
| browser file adapters/localStorage | retire | Native application-data and file services replace them |
| WPF vs WinUI 3 | ADR required, resolved by ADR 0006 | WPF is the target shell |
| in-process JS engine vs sidecar Product Host vs full Core rewrite | ADR required, resolved by ADR 0006 | versioned local out-of-process Product Host |
| native renderer backend | ADR required before native viewport implementation | choose from measured WPF software/Direct3D-compatible candidates using parity and latency proof |
| Recovery retention/discard contract | ADR required before document-lifecycle implementation | accept/supersede ADR 0004/0005 semantics explicitly |
| installer/update and runtime bundling | ADR required before release switch | decide MSIX versus signed installer/portable policy using deployment requirements |

## 5. Non-goals

- No Product implementation or disposable spike is included in Issue #92.
- Do not translate JavaScript modules to C# file-for-file.
- Do not change `.fl2d`, stable IDs, timebase, evaluation order, animation semantics, or MCP schemas merely because the shell changes.
- Do not make workflow completion or panel layout persistent Project data.
- Do not keep WebView/DOM input as the final viewport authority.
- Do not remove Electron before the explicit stop conditions pass.

