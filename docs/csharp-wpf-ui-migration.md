# C# / WPF editor shell migration design

Status: accepted by PR #93; Phase 1 implementation tracked by Issue #94  
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

Not every file outside `ui/` is automatically Node-hostable. Current PSD decode is entered through browser-global `window.agPsd`; PNG inflation uses Web APIs; and export rasterization explicitly requires `OffscreenCanvas`. The Product Host proof must audit the transitive runtime graph and separate portable Product semantics from browser-bound decode/render adapters. “Preserve Core” does not mean pretending browser globals work in a plain child process.

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
| `window.agPsd`, Web codec APIs, `OffscreenCanvas` adapters | interop proof then port/replace environment adapter | preserve parse/resource/composition contracts; prove Node compatibility or supply typed native adapter without moving semantics into WPF views |
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

## 6. Proposed desktop architecture

The WPF application is a typed client of one local Product Host. It owns the interaction workspace; the Product Host owns the document.

```mermaid
flowchart TD
    Shell["WPF shell + WorkspaceContext"] --> Input["InputRouter + tool controllers"]
    Input --> Client["Product Host client"]
    MCP["MCP adapter"] --> Host["JavaScript Product Host"]
    Client --> Host
    Host --> Session["EditorSession + Project + evaluators"]
    Host --> Plan["revisioned render plan + assets"]
    Plan --> Viewport["native viewport / export backend"]
    Shell --> Viewport
```

### 6.1 C# application components

| Component | Owns | Must not own |
| --- | --- | --- |
| `AppShell` | window lifetime, menus, toolbar, locale, focus scopes, native dialogs, close handling | Project mutations, evaluator rules |
| `WorkspaceContext` | workflow, active local context/tool, stable-ID selections, playhead, transient panel state | serialized project fields, history |
| `ProductHostClient` | protocol negotiation, request correlation, revision tracking, events, cancellation, bulk-asset channel | command meaning, conflict auto-overwrite |
| `CommandRouter` | menu/shortcut/tool command availability and dispatch | an alternative undo stack |
| `InputRouter` | pointer capture, modifier mapping, camera-versus-tool routing, cancel/lost-capture behavior | persistent edits or localized domain rules |
| feature tool controllers | gesture snapshots, local preview, typed command construction | direct Project mutation, file I/O |
| `ViewportControl` | camera, device/document transforms, hit-test request coordination, frame scheduling | authoritative geometry or evaluation order |
| overlay presenters | transient handles/guides/selection/diagnostics derived from a revision | saved mesh, rig, or animation data |
| target/property projections | right-side tree/list and contextual property editors | copies that can be saved independently |
| timeline surface | virtualized/custom-drawn ruler, lanes, blocks, keyframes, local drag previews | a second timebase or clip model |
| `DocumentLifecycleService` | path association, recent files, atomic-write coordination, Recovery UI/session policy | format migration or Project validation |
| `ExportProcessService` | destination dialog, progress/cancel UI, FFmpeg process lifetime | frame/evaluation semantics |

### 6.2 Product Host contract

The Product Host runs as a supervised child process with a versioned, length-framed local protocol. Routine control messages are UTF-8 JSON; large PSD/PNG/`.flimg` content and decoded render assets use binary frames or opaque asset handles. Exact framing belongs to the boundary-proof issue, but these properties are mandatory:

- one document token identifies one live `EditorSession`;
- every response and change event includes `revision`;
- mutations are serialized and may include `expectedRevision`;
- validation failures and conflicts leave Project and revision unchanged;
- queries return immutable projections rather than mutable Project references;
- command/query names and payloads come from the existing schemas;
- no generic JavaScript evaluation, arbitrary property path, filesystem, or process method exists;
- health, graceful shutdown, crash detection, and protocol mismatch have typed errors; and
- a Product Host crash cannot cause WPF to save a client-side projection as if it were authoritative.

Only modules proven free of DOM/Canvas globals may be loaded directly into the plain Product Host. Stage 1 records the transitive module audit. Browser-dependent decode or raster adapters are either replaced by Node-compatible adapters with identical contracts or moved to a typed native service; they never leak into WPF view code or redefine Project/import/render semantics.

The C# shell may cache projections and rasters by `(documentToken, revision, assetId)`. Cache invalidation is presentation behavior. It never changes Product state.

### 6.3 Threads, ordering, and stale work

WPF controls are updated only on the UI dispatcher. Product Host I/O, decode, evaluation, and export requests run asynchronously. A single host mutation queue defines edit order across WPF and MCP. Long read/evaluation jobs operate on an immutable revision snapshot and may be cancelled or discarded when a newer revision arrives.

A projection with revision lower than the client's accepted revision is ignored. A gesture begun at revision 17 cannot commit over an MCP edit that produced revision 18: the host reports a conflict. The tool cancels its preview, refreshes, and explains the conflict. Automatic rebase is permitted only for a future tool whose command contract explicitly proves it safe.

### 6.4 Save/open boundary

WPF owns the native picker, current path, recent-file list, overwrite confirmation, and same-directory atomic-write adapter. Product Host owns `.fl2d` parse/migration/validation and serialization. Save uses a revision-qualified handshake:

1. request serialized document for revision R;
2. atomically write the returned stream to the user-selected path;
3. confirm the successful save of R to the Product Host;
4. mark clean only if R is still the current/saved revision under existing `EditorSession` rules.

Open/import sends user-authorized content through explicit methods. The Product Host fully parses, materializes, validates, and builds the candidate before replacing the live session. Current memory/resource limits for PSD and `.flimg` remain enforced.

## 7. FLAMORIS common UI grammar

The common family grammar is structural, not a shared domain library:

> Left = which tool am I using?  
> Top = how is this tool configured?  
> Right = what am I editing, and what are its properties?  
> Bottom = when does it happen?

The WPF visual resources may be shared later as a small FLAMORIS theme/control package only after Cutwork and FLAMORIS 2D prove the same contract. Product models and sessions remain separate.

```mermaid
flowchart TB
    Menu["Windows menu + global commands + workflow steps"]
    Options["active tool options"]
    Tools["left: tools"]
    Canvas["center: viewport"]
    Target["right: targets above / properties below"]
    Time["bottom: key-state strip or timeline only when needed"]
    Menu --> Options
    Options --> Tools
    Options --> Canvas
    Options --> Target
    Canvas --> Time
```

### 7.1 Stable regions

- **Menu row:** `ファイル / 編集 / 表示 / ヘルプ`, plus workflow-specific menus only where useful.
- **Global command strip:** Save, Undo, Redo and non-contextual status; it does not accumulate every playback or editing option.
- **Workflow strip:** persistent top-level tabs in production order. It stays outside the artwork.
- **Tool options row:** only options for the active tool/context. Commit/cancel controls for modal tools also live here.
- **Left rail:** compact icons plus Japanese tooltip/name for operations in the active workflow.
- **Center:** artwork, evaluated result, direct manipulation, and transient overlays.
- **Right upper (`対象`):** Parts/Objects remain the stable anchor; workflow-specific rig/clip targets appear as a secondary view when needed.
- **Right lower (`プロパティ`):** the selected target and active editing context. Names are directly editable where safe.
- **Bottom:** absent in non-temporal work, a compact Key State strip in Deform, a full Timeline in Animation, and a read-only scrub/transport strip in Preview.

Panel sizes, last selected workflow, theme, locale, and viewport preferences are application preferences. They are not Project data and do not enter Undo/Redo.

### 7.2 Naming

Production labels are Japanese-first and task-oriented. Internal types may appear in diagnostics or optional detail text, never as the only explanation. In particular:

- `MeshTopology` becomes `構造` or `メッシュ構造`;
- `MeshKeyform` layout becomes `配置`;
- authored pose/offset work becomes `変形` or `キー状態`;
- `TemporalProgram` is not shown as a top-level noun;
- `ClipInstance` may be described as `配置したクリップ`; and
- stable IDs are available in diagnostics/detail views, not substituted for human names.

## 8. Workflow and editing-context model

Issue #88's task workflow is retained but refined. `変形` is separated from `アニメーション` so Mesh Layout, rig construction, key-state posing, and time-based motion cannot silently share one meaning.

```mermaid
flowchart LR
    Source["1 素材"] --> Mesh["2 メッシュ"] --> Rig["3 リグ"] --> Deform["4 変形"]
    Deform --> Animation["5 アニメーション"] --> Preview["6 プレビュー"] --> Export["7 書き出し"]
```

The workflow is transient navigation, not a wizard and not a persisted completion state. Expert users may jump to any available step with `Ctrl+1` through `Ctrl+7`. Unavailable commands explain the missing target instead of silently changing context.

| Workflow | Local context/tools | Canvas click | Right upper | Right lower | Bottom |
| --- | --- | --- | --- | --- | --- |
| `素材` | select, move/transform, import/re-import | select visible Part/Object; drag only with transform tool | Parts/Objects | source, name, visibility/lock, transform, mapping | hidden |
| `メッシュ` | `構造` (add/remove/connect/subdivide/automesh) and `配置` (Key Art layout) | select vertex/edge/face according to active tool; empty click follows tool contract | Parts plus mesh selector | topology/layout, selected stable vertex, labels, validation | hidden |
| `リグ` | create/edit Warp lattice and Bone rest structure, bind/weights, clipping, constraints | select rig element/handle; select tool remains explicit | Parts with Rig view | selected rig element/binding/constraint | hidden |
| `変形` | Key State target plus mesh offsets, Warp controls, Bone pose, form correction, IK pose tool | manipulate the active pose target only | Parts with Key State target | pose/deformation properties and reset | compact Key State strip |
| `アニメーション` | Sequence, clips, instances, typed tracks/keyframes | select animated target or manipulate supported animation handle | Parts/targets with Clip view | selected clip/track/key properties | full Timeline with its own zoom/transport controls |
| `プレビュー` | playback, loop/once, quality/overlay viewing options | read-only inspect/pan; no authoring commit | optional compact shot/sequence selector | preview diagnostics | compact read-only scrub/transport |
| `書き出し` | format, size, alpha, range, destination, start/cancel | no authoring meaning | export target/sequence | export settings and diagnostics | hidden |

### 8.1 Mesh Layout versus Deform

The UI enforces ADR 0003:

- `メッシュ > 構造` changes stable identity/connectivity and propagates compatible states transactionally.
- `メッシュ > 配置` changes where stable vertices belong on the active Key Art; it writes `MeshKeyform` layout through the existing layout-compatible command boundary.
- `変形` writes pose/form/animation offsets relative to authored layout and cannot add/remove/subdivide topology.

The current internal `DEFORM` compatibility name for MeshKeyform placement must not leak into the new UI. Renaming or splitting that internal API is a follow-up ADR/implementation decision; the WPF client may initially map `配置` to the existing command while preserving its semantics.

### 8.2 Rig versus Deform

Rig defines what can move: lattice structure/bind state, Bone rest hierarchy/length, SkinBinding weights, clipping relations, and constraint definitions. Deform defines a state of those controls on a Key Art/Key State: Warp keyform points, Bone pose deltas, mesh/form offsets, and IK-authored pose results. A tool that creates an IK constraint belongs to Rig; dragging its target to author a pose belongs to Deform.

This separation is a UI/context projection over existing domains. If an existing command does not state whether it changes rest/bind data or pose/keyform data, migration pauses for an ADR instead of guessing.

### 8.3 Required screen-state specifications

These are the acceptance wireframes expressed as region contracts. They all use the fixed grammar from Section 7; a mode may change a region's contents or collapse it, but may not move its responsibility elsewhere.

**A. Object / Part selection (`素材`)**

- Left contains Select and Transform tools only.
- Top shows transform/pivot options only when Transform is active.
- Right upper shows Parts/Objects with row selection plus separate eye and lock affordances.
- Right lower shows the selected source/object properties.
- Bottom is absent and the center remains the visual priority.

**B. Mesh Layout (`メッシュ`)**

- Left contains Select, Add, Remove, Connect/Triangle, Subdivide, and AutoMesh as appropriate to `構造`; `配置` exposes move/selection tools instead.
- Top names the active Key Art, Part, mesh, and local context, then shows only that tool's options.
- Right upper retains Parts and mesh target selection; right lower shows topology/layout, stable vertex details, labels, and diagnostics.
- The mesh stays visible with high contrast in both `構造` and `配置`.
- Bottom is absent; a Sequence Timeline must not consume Mesh space.

**C. Rig (`リグ`)**

- Left contains Warp, Bone, Bind/Weight, Clipping, and Constraint construction tools.
- Top shows active rig target and operation settings.
- Right upper keeps the owning Part/Object visible and adds the relevant rig hierarchy/target view.
- Right lower shows selected rig element, binding, or constraint properties.
- Bottom is absent.

**D. Deform / Key State (`変形`)**

- Left contains mesh-deform, Warp-control, Bone-pose, form-correction, and IK pose tools that are valid for the chosen target.
- Top always identifies the active Key Art/Key State and active pose target.
- Right retains Parts/targets above and pose/deformation properties below.
- Bottom shows the compact Key State strip, never the full Sequence Timeline.
- Canvas styling makes this state visually distinct from Mesh `配置`; topology operations are unavailable.

**E. Animation (`アニメーション`)**

- Left/top contain animation selection and authoring tools, not rig-construction tools.
- Right upper exposes Parts/animated targets and Clip context; right lower exposes the selected clip/instance/track/keyframe.
- Bottom intentionally shows the full Timeline.
- Timeline play, time display, snap, unit, and horizontal scale controls live in the Timeline header.

**F. Preview / Export**

- Preview hides authoring tool rails and properties that cannot affect viewing; it keeps only sequence choice, transport, scrub, display quality, and diagnostics.
- Export hides the Timeline and authoring overlays and shows output target, range, size, alpha/format, destination, progress, cancel, and diagnostics.
- Neither state changes Project authoring data merely by entering or leaving it.

## 9. Selection, Parts, and Properties authority

`WorkspaceContext` is the one transient selection authority for the WPF client. It stores stable IDs in scoped slots rather than one overloaded selection:

- `PrimaryObjectId` for the Part/Object anchor;
- `ActiveRigElementId` for Bone/Deformer/constraint focus;
- stable vertex/control-point selections owned by the active feature controller;
- `ActiveKeyArtId` / Key State editing target;
- selected Sequence/Clip/track/keyframe IDs; and
- hover/hit candidates separately from selection.

Context switching preserves valid selections. It never toggles visibility, silently chooses a different Part, or discards a valid target merely because its panel is hidden. If a retained target is unusable in the new context, the UI shows why and offers a valid next action.

Parts/Objects are projected from Product queries. Row click selects. The eye glyph changes persistent visibility through the ordinary scene visibility command and does not select. Lock is a separate affordance. A hidden selected row remains highlighted and marked hidden; canvas handles are suppressed because it is not pickable. Direct name edits use the rename command.

Canvas picking uses the evaluated draw order and stable IDs for the accepted revision. When several visible parts overlap, the initial behavior chooses the topmost unlocked candidate; a context menu/list exposes other candidates. The stored result is an ID, never a pixel coordinate or display name.

Properties are generated from the selected stable ID plus workflow/context. Editing a property sends a typed command, or a transaction for an atomic multi-field change. Validation messages remain machine-coded from Product and localized by WPF.

## 10. Viewport, input, gesture, and overlay authority

### 10.1 Coordinate and camera rules

`ViewportCamera` owns screen/DPI/zoom/pan transforms only. Product positions remain document, node-local, mesh-local, or other explicitly named domain coordinates. Tool code converts pointer coordinates once at the viewport boundary and includes the declared coordinate space in the command.

Handle radius and line thickness are device-independent and zoom-aware for legibility; they are not saved. Mesh uses a dual-stroke/high-contrast overlay with distinct selected/hover handles so light artwork does not erase it visually.

### 10.2 Input priority

One central input map resolves:

1. active modal gesture and pointer capture;
2. universal cancel/help shortcuts;
3. pan/zoom chords;
4. the active tool in the active workflow/context; and
5. explicit object selection fallback where that context permits it.

Menus, text boxes, the timeline, and the canvas define focus scopes so Space/Delete/arrows do not leak between them. Shortcut definitions are centralized and exposed in menu/tooltips.

### 10.3 One gesture, one undo unit

Every persistent direct-manipulation gesture follows the same lifecycle:

1. pointer down captures stable targets, starting domain values, and revision R;
2. pointer moves update only a local preview/overlay from that immutable snapshot;
3. pointer up constructs the smallest typed command or transaction from start to final value;
4. Product Host validates and commits once against R;
5. the authoritative revision/event replaces the preview; or
6. pointer cancel, Escape, lost capture, conflict, or failure clears the preview without history.

Brush/weight strokes may contain sampled points internally but commit as one semantic transaction. Tools may coalesce pointer input for smooth previews; event frequency never becomes history frequency.

### 10.4 Rendering and overlays

The Product Host returns an evaluated render plan and asset references for a specific revision/tick. The native backend performs rasterization/compositing without reinterpreting Transition, presence, draw-order, clipping, rig, or mixer semantics. Overlays are a separate top layer, derived from Product projections plus current gesture preview, and are never included in normal export.

The native backend choice must prove:

- mesh and affine rendering parity with canonical plans;
- opacity, presence, draw order, clipping, and premultiplied-alpha parity;
- responsive pan/zoom and pointer preview at representative canvas sizes;
- correct 100/125/150/200% DPI projection;
- resource disposal and bounded cache behavior; and
- preview/export agreement for the same revision, tick, and render settings.

## 11. Timeline ownership and performance

The full Timeline exists only in `アニメーション`. Its header contains play/pause, loop/once, current time, snap, display units, and horizontal zoom; these controls do not live in a distant global toolbar. The Key State strip in `変形` is a separate compact projection over existing Key Art/Transition state, not a second timeline model.

Ticks remain integers at 120000 per second. Pixel/time conversion is transient. The WPF timeline uses a custom-drawn or virtualized lane surface so duration and zoom do not create one control per tick/keyframe. Drag previews are transient; drop/resize/move commits one existing Sequence/Clip/track command or transaction.

## 12. MCP authority sharing

The Product Host exposes one service facade to both WPF and the MCP adapter:

```text
query -> immutable projection
execute -> one typed command
executeTransaction -> atomic typed commands
undo/redo -> shared EditorSession history
evaluate -> canonical revision/tick result
```

MCP never drives WPF controls or viewport pixels. WPF never implements a hidden mutation because a command is inconvenient. Semantic AI operations return/propose ordinary commands and diagnostics, then commit through the same transaction queue. A visible change event lets WPF update Parts, Properties, canvas, and history when MCP edits the active document.

## 13. Recovery UX and required Product contract

Recovery is offered on the startup/empty-document surface as a clear card, not as a modal that repeatedly blocks launch. The card identifies the project/display name, snapshot time, and whether more versions exist. `ファイル > 復元` opens the same surface later.

The three actions have deliberately different semantics:

| Action | Result | Snapshot retention | Future prompting |
| --- | --- | --- | --- |
| `復元して開く` | validate first, then replace the live document with a dirty `Recovered` session | retain until a successful intentional Save/Save As or explicit discard | no repeated prompt for the same open session |
| `今回は復元しない` | continue without opening Recovery | retain all snapshots | suppress the blocking/card emphasis for this app session; show the card again on a later launch and keep `ファイル > 復元` available |
| `復元データを破棄` | after a destructive confirmation, delete the selected recovery lineage/versions | delete | do not prompt again unless a new snapshot is created |

Closing the card is equivalent to `今回は復元しない`, never to deletion. Save failure retains Recovery. A corrupt newest snapshot does not trap startup: validation reports it, the UI offers an older valid version where available, and deletion remains explicit.

The current ADR 0004/0005 behavior establishes separation from `.fl2d`, dirty-on-restore, and clear-on-intentional-save, but it does not fully define lineage, per-session dismissal, or discard granularity. Before native document lifecycle is implemented, a Recovery ADR must define:

- stable snapshot and lineage identity;
- metadata safe to show before restore;
- latest-versus-specific-version restore;
- retention after session dismissal, successful Save, Save Copy, and failed Save;
- deletion scope and confirmation;
- bounds/eviction and behavior for corrupt or future-version snapshots; and
- Product Host methods that manipulate snapshots without making WPF parse Project payloads.

WPF stores only the current app-session dismissal state. It does not mark a snapshot as restored or discarded by rewriting Project content.

## 14. Packaging and deployment direction

The native application targets Windows x64 and the repository-supported .NET LTS baseline, initially .NET 10 to align with Cutwork. Packaging is built from an explicit Product allowlist and contains only:

- the WPF application and required .NET runtime when self-contained;
- the version-matched Product Host JavaScript bundle and runtime;
- native renderer dependencies selected by the renderer ADR;
- the approved FFmpeg binary/process support where export requires it;
- localization/resources, icons, licenses, and `.fl2d` association metadata; and
- no tests, staging/private artwork, browser UI assets, or historical sources.

During migration the Electron build remains the default production artifact. Native preview packages do not claim the `.fl2d` association by default, preventing two shells from racing for document ownership. The release switch occurs only after parity closure. At that point the production workflow stops packaging Electron, Chromium, `index.html`, DOM views, and browser-only adapters.

The installer/update decision remains separate: choose MSIX or a signed installer/portable pair based on file association, update, code-signing, and distribution requirements. A self-contained WPF package plus bundled Product Host is the test baseline; “single executable” is not a goal if it obscures runtime provenance or update safety.

Product Host and WPF versions declare a supported protocol range. Startup fails clearly on incompatibility; it never silently falls back to reduced command semantics. Crash logs exclude Project/raster contents unless the user explicitly exports a diagnostic package.

## 15. Staged migration plan

Every stage is a separate issue and one or more reviewable PRs. Each PR keeps commits purpose-driven (contract/foundation, controller, UI, tests, review fixes). The Electron editor remains runnable until Stage 9.

| Stage | Scope | Exit evidence |
| --- | --- | --- |
| 0. accept design | review this document and ADR 0006; open pending ADR issues | approved authority map; no Product implementation |
| 1. Product Host boundary proof | transitive Node-runtime audit, protocol/schema handshake, one `EditorSession`, query/command/transaction/Undo/Redo, revision events, one PSD/PNG raster transfer, process supervision | browser-global dependencies have explicit adapters; ADR 0006 boundary checks pass; existing JS tests stay green |
| 2. native shell foundation | WPF solution, menu/global commands, workflow strip, common panel grid, localization, focus/shortcut map, empty state | shell hands-on matches common grammar; no document copy in C# |
| 3. document + Source/Object | Open/Save/Save As, atomic write, recent files, accepted Recovery contract, PSD/`.flimg`, Parts/Object selection, visibility/lock/name/properties | round-trip and recovery tests; packaged DPI/file-dialog pass |
| 4. viewport + Mesh | native read-only render plan first, camera/picking/overlay, then Mesh structure/layout tools and one-gesture history | render parity fixtures; topology/layout/Undo/Redo/save-open hands-on pass; legacy writable mesh absent |
| 5. Rig | Warp/Bone rest editing, SkinBinding/weights, clipping, constraints and helpers | existing rig commands/evaluators reused; gesture and overlay acceptance |
| 6. Deform / Key State | Key State strip, Warp keyforms, Bone pose, mesh/form offsets, IK pose authoring | Layout remains unchanged by Deform; per-tool one-undo tests |
| 7. Animation | Sequence/Clip/ClipInstance/typed-track authoring, virtualized Timeline, transport/zoom near Timeline | 120000-tick parity; drag/drop/resize/keyframe edits commit once |
| 8. Preview + Export parity | native preview, read-only scrub, render diagnostics, frame/video export, FFmpeg process service | preview/export agree on canonical fixtures; cancellation and failure tests |
| 9. production cutover | full production-shot acceptance, make WPF package default, remove Electron build inputs and browser shell from Product artifact, preserve history docs | all retirement criteria pass and cutover PR is reviewed |

No stage ports a lower Product layer merely because its JavaScript implementation feels inconvenient. If interoperability itself becomes the measured bottleneck, propose a bounded replacement behind the same conformance contract.

## 16. Test and acceptance strategy

Issue #92 changes documentation only, so it requires Markdown/link review rather than a broad test run. Follow-up implementation stages use four layers:

1. **Product conformance:** existing JavaScript tests remain green and canonical Query/Command/evaluation fixtures are versioned.
2. **Protocol tests:** schema mismatch, transaction atomicity, revision conflict, process death, cancellation, large asset transfer, and structured errors.
3. **C# unit/component tests:** workspace/context transitions, command availability/routing, coordinate conversion, gesture lifecycle, projection invalidation, Recovery decisions, and timeline pixel/tick mapping.
4. **Packaged Windows acceptance:** real pointer/focus/DPI behavior, representative artwork, file dialogs, save/reopen, recovery, timeline feel, preview, and export inspection.

Automated image comparison protects renderer semantics, but does not replace hands-on assessment of pointer latency, overlay legibility, timeline navigation, or first-time comprehension.

## 17. Risk register

| Risk | Impact | Mitigation / stop condition |
| --- | --- | --- |
| C# projection becomes a second Project truth | data loss and MCP divergence | immutable revisioned projections; all writes through Product Host; architecture tests reject C# serialization as authority |
| JS/C# protocol drift | missing or misinterpreted commands | schema/version handshake, generated/validated DTOs where useful, compatibility tests, fail closed |
| interop latency harms dragging | broken editing feel | local gesture previews; one commit on release; do not round-trip every pointer move |
| MCP edits during a human gesture | lost update | expected revision and serialized queue; cancel/refresh on conflict |
| raster/bulk IPC copies exhaust memory | crashes on large PSD/`.flimg` | framed streaming or handles, size budgets, cancellation, bounded caches, representative stress test |
| native renderer changes compositing | preview/export mismatch | canonical render plans, golden fixtures, premultiplied-alpha/clipping tests, retain Electron until parity |
| browser-only decode/render dependency is mistaken for portable Core | Product Host cannot open or render real projects | transitive runtime audit in Stage 1; explicit adapter ownership for `window.agPsd`, Web codecs, and `OffscreenCanvas`; fail the proof before feature migration |
| WPF DPI/focus/pointer capture bugs | wrong hit tests or shortcuts | one coordinate service/input router, multi-DPI packaged tests, lost-capture cancellation |
| Timeline creates too many WPF elements | poor scroll/zoom performance | custom drawing/virtualization, viewport-range realization, benchmark dense sequences |
| Recovery UI deletes or repeatedly nags | work loss or loss of trust | explicit three-action contract, session-only dismissal, destructive confirmation, corrupted-snapshot fallback |
| dual shell period confuses file association | wrong app opens or saves | Electron remains default; native preview does not register association until cutover |
| bundled runtimes increase package/security burden | size and update complexity | explicit allowlist/SBOM/licenses, pinned versions, signed release, no generic Product Host surface |
| feature-by-feature port preserves accidental DOM structure | native UI stays confusing | workflow/context acceptance is semantic; retire views rather than translating components |
| migration stalls indefinitely | permanent double maintenance | capability ledger, stage exit gates, no new Electron-only feature without WPF migration disposition |

## 18. Electron/JS shell retirement criteria

Electron may be removed from the production artifact only when all of the following are true:

### Authority and compatibility

- WPF and MCP edit the same live `EditorSession` through the Product Host.
- No C# persistent Project model, alternate history, UI-only mesh, or generic property mutation exists.
- `.fl2d` schema v15 and supported legacy documents parse, migrate, save, and reopen without semantic change.
- Stable IDs, validation diagnostics, 120000-tick time, evaluator order, and command/transaction behavior pass conformance fixtures.
- PSD and Cutwork `.flimg` imports preserve current validation and resource boundaries.

### Workflow capability

- A first-time user can follow `素材 -> メッシュ -> リグ -> 変形 -> アニメーション -> プレビュー -> 書き出し` without internal type names.
- Object/Part selection, visibility, lock, and name editing are distinct and dependable.
- Mesh structure and Key Art layout are usable and semantically separate from Deform.
- Warp, Bone, weights, clipping, constraints, form correction, and IK capabilities required by current production are reachable.
- Sequence, reusable clips, instances, typed tracks/keyframes, playback, timeline zoom/scroll, Preview, and Export are reachable.
- Unrelated Timeline/authoring panels are absent from workflows that do not need them.

### Interaction and visual parity

- Each persistent gesture is one semantic Undo unit; cancel/lost capture commits nothing.
- Canvas picking, pan/zoom, overlays, keyboard focus, and shortcuts pass packaged Windows checks at 100/125/150/200% DPI.
- Mesh/rig overlays remain legible on light and dark artwork.
- Native preview and export match canonical evaluated/render fixtures within accepted exact or documented perceptual tolerances.
- Representative production-sized projects meet accepted pointer-preview, playback, memory, and timeline-navigation budgets established by the renderer/performance ADRs.

### Document lifecycle and release

- Open, Save, Save As, incremental/copy behavior retained where supported, recent files, unsaved close, file association, and atomic write are verified.
- Recovery offers Restore, session-only decline, and explicit discard with the documented retention behavior.
- Product Host crash/protocol mismatch produces a recoverable, non-destructive state.
- A complete representative short-shot pass succeeds: import -> Parts -> Mesh -> Rig -> Deform -> Animation -> Preview -> export -> save -> close -> reopen.
- The WPF package passes clean-machine installation/launch/uninstall and file-association checks.
- The release build allowlist contains no Electron/Chromium, DOM views, browser-only UI adapters, staging/private assets, or tests.
- A reviewed cutover PR updates CI/package ownership and records ADR 0005 as superseded; rollback remains possible through the last Electron release/tag.

Retiring the Electron shell does **not** require rewriting the authoritative JavaScript Product/Core. Retiring the JavaScript Product Host is a different future decision with its own ADR and complete conformance proof.

## 19. ADR-required questions

| Question | Status / gate |
| --- | --- |
| WPF versus WinUI and Product Host versus embedded/full rewrite | proposed decision in ADR 0006; must be accepted before Stage 1 |
| native preview/export renderer backend and measurable budgets | new ADR before Stage 4 |
| Recovery lineage, retention, discard, and corrupt-snapshot behavior | new or superseding ADR before Stage 3 |
| installer/update/signing strategy and bundled-runtime policy | ADR before Stage 9 release switch |
| live desktop MCP attachment, authentication/capability, and multi-client ownership | ADR before exposing live desktop MCP beyond local development |
| internal `DEFORM` compatibility naming versus an explicit Mesh Layout command rename | ADR only if persistent command/schema compatibility changes; otherwise document adapter mapping |
| eventual JavaScript Product Host replacement | no decision now; ADR required only if a future proposal ports authoritative Product semantics |

## 20. Design acceptance checklist

- The survival/replacement boundary is explicit in Sections 3–4.
- C# shell, Product Host, revision, file, and render responsibilities are explicit in Sections 6 and 14.
- The common FLAMORIS grammar and all required screen states are explicit in Sections 7–8.
- Selection, Parts/Properties, viewport/input/overlay, history, Timeline, and MCP authority are explicit in Sections 9–12.
- Recovery choices and missing Product contract are explicit in Section 13.
- Small migration stages, risks, and a concrete Electron stop condition are explicit in Sections 15–18.
- Long-lived unresolved choices are routed to ADRs in Section 19.
- This proposal changes no implementation file and does not pretend the Electron implementation never existed.

## Issue #102 live attachment update

ADR 0010 now owns external MCP transport/security. ProductHostService serializes
both WPF and live MCP; the stdio control protocol remains the internal WPF boundary.
Same-session typed mutations and source-history Undo/Redo emit the existing change
event. The separate loopback MCP capability never reveals the internal bulk secret.
The Native menu owns opt-in, permissions and credential rotation. Older sections
that describe public MCP as future work are historical migration staging, superseded
for this boundary by [ADR 0010](decisions/0010-native-live-mcp.md).
