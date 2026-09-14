# Issue #94 Phase 1 native foundation audit and acceptance

Date: 2026-09-14  
Baseline: `main` at `86f8b5003c5b122fde9bac32eee8721dd1d2f701`  
Cutwork reference: `main` at `7359db7538d9dc34f349715b1c8325537aaf5996`

## Outcome

Phase 1 establishes a .NET 10 WPF shell, a supervised Node 24 Product Host, and one
revisioned control boundary over the existing JavaScript `EditorSession`. It does not port
the editor model, renderer, import lifecycle, or feature authoring tools.

The implemented invariant is:

```text
WPF gesture
  -> typed Product Command / Transaction
  -> Product Host
  -> EditorSession
  -> Project / history
```

The WPF process stores a document token, monotonic host revision, transient editing context,
active tool, and disposable projections. It has no Project model, serialization authority,
or Undo/Redo stack.

## Audited current boundaries

| Boundary | Finding | Phase 1 treatment |
| --- | --- | --- |
| `model/project.js`, validation and migrations | Project schema 15 and stable IDs are authoritative | preserve; instantiate only in Product Host |
| `commands/editor.js` | one transaction/history/Undo/Redo authority; its state revision can move backward on Undo | preserve; add a separate monotonic protocol ordering tag |
| `queries/project.js` | typed projections include project summary and scene tree | interop; WPF consumes only tagged projections |
| `mcp/adapter.js`, schemas v18 | headless adapter already delegates to `EditorSession` | construct against the exact Host-owned session |
| `io/project-json.js` | parse/migrate/validate/serialize plus Storage-based recovery adapter | parse/serialize interop; browser recovery transport deferred |
| Electron Main/preload | dialogs, atomic paths, IPC, package lifecycle | keep for released Electron shell; native replacement later |
| `app.js` and UI controllers | browser bootstrap owns lifecycle, selection, input, overlays and workflow projection | do not import into Host; port responsibilities incrementally |

The protocol revision deliberately differs from `EditorSession.currentRevision`. The latter
identifies a history state and returns to an older value on Undo. The Product Host revision is
an ordering token and increments for every successful Command, Transaction, Undo, and Redo.
That makes stale asynchronous response rejection well-defined without changing Product history.

## Current Blender web audit

The shell interaction was checked against the current Blender 5.2 LTS official manual rather
than reconstructed from memory:

- [Object Modes](https://docs.blender.org/manual/en/latest/editors/3dview/modes.html):
  Object Mode changes whole objects, Edit Mode changes geometry, and Pose Mode changes an
  armature pose. A mode therefore changes what a canvas click targets and which operations apply.
- [Tool System](https://docs.blender.org/manual/en/latest/interface/tool_system.html):
  one active tool is selected from the Toolbar; the tool remains a distinct concept from the
  selected object or component.
- [Regions and Tool Settings](https://docs.blender.org/manual/en/latest/interface/window_system/regions.html):
  the left Toolbar can be hidden, while the horizontal Tool Settings region presents settings
  for the current tool near the editor header.
- [Selecting Outliner Items](https://docs.blender.org/manual/en/latest/editors/outliner/selecting.html):
  the Outliner distinguishes active selection from extended/range selection and synchronizes
  scene targets without turning the operation itself into selection state.
- [Properties Editor](https://docs.blender.org/manual/en/latest/editors/properties_editor.html):
  properties follow the active data/context; the Active Tool and Workspace tab exposes tool
  settings without making the Properties editor the input owner.
- [Timeline](https://docs.blender.org/manual/en/latest/editors/timeline.html):
  Timeline is a dedicated frame/key/playback editor, not permanent chrome required by every task.
- [Status Bar](https://docs.blender.org/manual/en/latest/interface/window_system/status_bar.html):
  the active tool's mouse/key expectations are surfaced contextually.

Adopted behavior:

- a high-contrast current editing context is always visible;
- each context owns a small tool set and explicit click meaning;
- the left rail selects an operation while the right target list selects an object/part;
- tool settings sit immediately above the viewport;
- Ctrl+1 through Ctrl+7 switches context and returns focus to the viewport;
- only Animation allocates the bottom Timeline surface; and
- the implementation keeps regions fixed and restrained instead of importing Blender's
  configurable editor complexity.

The seven FLAMORIS contexts are a production path, not direct aliases of Blender modes:
`Source -> Mesh -> Rig -> Deform -> Animation -> Preview -> Export`.

## Cutwork family grammar audit

Cutwork `MainWindow.xaml` and its tool/layer partials at the reference commit show:

- a conventional WPF `Menu` and locked `ToolBarTray`;
- a compact pale left tool rail around a dark canvas;
- active-tool controls in the top toolbar;
- dark right-side Parts/Layers target panels;
- focus returned to the canvas after tool/commit actions;
- command bindings for Ctrl+Z/Ctrl+Y; and
- presentation rows explicitly kept separate from document/history authority.

FLAMORIS adopts those shell relationships, accent treatment, compact controls, Japanese-first
labels, focus return, and projection-only target rows. It does not copy Cutwork's document,
pixel tools, layer model, or imaging code.

## Product Host protocol and authority

Control messages use 4-byte big-endian length framing followed by UTF-8 JSON. Frames are limited
to 8 MiB; raster bulk transfer is intentionally not placed on this channel.

| Field | Contract |
| --- | --- |
| `protocolVersion` | exactly 1 for this phase; mismatch fails closed |
| `requestId` | required unique correlation ID |
| `documentToken` | required for document-scoped operations; rotated on create/open |
| `revision` | monotonic document ordering tag on every response/event |
| `expectedRevision` | required on every mutation; mismatch returns `revision.conflict` |
| `method` | explicit allowlist only; no eval, property paths, shell, process, or filesystem API |

Implemented methods cover handshake, health, graceful shutdown, create/open, Query, Command,
Transaction, Undo, Redo, serialization, history inspection, and the headless adapter proof.
The Host's single serialized request queue is the edit-order boundary. Successful mutations emit
`document.changed`; failed validation and stale requests do not change revision or state.

For the shared-authority proof, `HeadlessProductAdapter` is constructed with the same
`EditorSession` instance used by UI methods. A WPF-labelled command followed by an MCP-labelled
headless command appears in one history, and Host Undo removes the latter first.

## Browser dependency classification

The machine-readable inventory is
`product/product-host/browser-dependencies.json`. The exercised Host import graph is traversed
by test and rejected if it gains unowned `window`, DOM, localStorage, OffscreenCanvas, HTML
Canvas, or WebGL markers.

| Dependency | Classification | Result |
| --- | --- | --- |
| Project/Query/Command/Transaction/validation/evaluator imports exercised by Host | plain Node-compatible Product code | loaded directly |
| `Blob`, `DecompressionStream`, `TextDecoder` in Cutwork PNG materialization | plain Node-compatible Product code on reviewed Node 24 | startup capability check; fail closed |
| `window.agPsd`, browser picker and browser recovery Storage | environment adapter required | excluded from Host graph |
| Electron dialog/atomic-save/export IPC | native adapter candidate | retain until typed WPF lifecycle adapters exist |
| `OffscreenCanvas`, Canvas/WebGL viewport and export rasterization | deferred renderer concern | excluded; later renderer ADR/parity proof |

This classification does not claim that every file under `core/` or `io/` is automatically
portable. It records the actual transitive entry graph and runtime prerequisites.

## Recovery and failure UX

Phase 1 implements process-failure recovery, not project-recovery migration:

1. an unexpected Host exit invalidates the C# document token;
2. Parts/Object projections, Properties, Undo/Redo, refresh, editing, and Save remain disabled;
3. a persistent banner states that stale WPF state is not authoritative; and
4. restart creates a new Host/session and does not claim the lost projection was recovered.

Snapshot discovery, retention, discard, lineage, corrupt-snapshot fallback, and native atomic Save
remain gated by the Recovery ADR described in the accepted migration design.

## Tests and Windows acceptance

Locally exercised on Node 24:

- protocol handshake and version/schema disclosure;
- health, child startup, framed round-trip, graceful shutdown, and forced process death;
- Query, Command, multi-command Transaction, validation atomicity;
- Undo/Redo with monotonic host revision;
- stale mutation rejection;
- shared WPF/headless history ordering;
- representative schema-15 `.fl2d` serialize/reopen;
- transitive browser-global audit; and
- machine-readable coverage of all four browser-dependency dispositions.

The Windows-native CI job additionally:

- builds the .NET 10 solution and WPF XAML;
- runs C# framing/stale-projection/client/crash-invalidation tests;
- constructs the WPF shell and runs Query/Transaction/Undo/Redo in `--smoke-test`;
- switches all seven contexts and asserts Timeline visibility; and
- publishes a framework-dependent win-x64 hands-on artifact.

Interactive visual/focus checks cannot be honestly performed in the Linux authoring environment.
The uploaded Windows artifact and the checklist in `product/native/README.md` prepare that pass.
CI smoke results and any manual findings are recorded in the PR; no manual result is fabricated.

## Deliberately deferred

- full Mesh, Bone, Warp, Weight, Deform, key-state and Timeline authoring;
- final native renderer, Preview parity, PNG/MP4 export;
- native PSD decode and bulk raster channel;
- native Open/Save/atomic write and full Recovery;
- bundled Node runtime/installer/file association;
- live desktop MCP discovery/transport beyond the same-session authority adapter proof;
- Electron retirement and deletion of browser UI; and
- any Project schema change or Product/Core rewrite.

## Next phase gates

1. complete Windows visual/focus/DPI hands-on and correct shell-specific defects;
2. decide and implement the typed bulk asset channel before PSD/native viewport work;
3. accept the Recovery contract before native document lifecycle;
4. add live desktop MCP attachment/discovery without creating another session;
5. measure native raster backends and record the renderer ADR; and
6. keep Electron as the released shell until every retirement criterion in the migration design
   passes.
