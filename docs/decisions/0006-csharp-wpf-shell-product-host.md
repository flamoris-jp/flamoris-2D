# ADR 0006: C# WPF shell with a versioned JavaScript Product Host

Status: proposed for Issue #92

## Context

FLAMORIS 2D has a mature JavaScript Product implementation: Project schema v15, stable identity, validation/migration, typed Query/Command/Transaction operations, `EditorSession` Undo/Redo, deterministic rig/transition/sequence evaluation, importers, and MCP schemas. The Electron/DOM shell is replaceable, but those semantics are not disposable.

The current shell also concentrates workflow projection, document lifecycle, selection, controller switching, pointer routing, Canvas overlays, and native bridge coordination in the browser bootstrap. Hands-on testing has shown that preserving that component structure would preserve its interaction ambiguity.

The target is a Windows-native C# user interface that follows the FLAMORIS-wide grammar established by Cutwork. The migration must stay incremental and must never create two persistent Product truths.

Options considered:

1. continue Electron and restyle/restructure the DOM UI;
2. build a WPF shell around a WebView2-hosted editor;
3. embed a JavaScript engine inside the WPF process;
4. use a WPF shell with an out-of-process JavaScript Product Host;
5. rewrite Product/Core completely in C# before replacing the shell; or
6. use WinUI 3 instead of WPF.

## Decision

### Desktop technology

Use C# on the repository's supported .NET LTS baseline, initially aligned with Cutwork's .NET 10 WPF stack. WPF owns the window, menus, toolbars, workflow navigation, panels, focus/keyboard routing, native dialogs, file association, application preferences, and viewport host.

WPF is preferred over WinUI 3 because FLAMORIS currently needs mature desktop controls, reliable routed input/focus behavior, custom drawing hosts, conventional Windows menus, flexible packaging choices, and sibling-product consistency more than it needs WinUI-specific presentation features. Reconsideration requires a concrete blocker demonstrated by a spike, not styling preference.

### Product authority

Keep the existing JavaScript Product/Core authoritative during the shell migration. Run it in a child Product Host process launched and supervised by the WPF app. The Product Host owns exactly one live `EditorSession` per opened document and serializes all mutations.

The Product Host exposes a versioned local protocol with:

- explicit Query, Command, Transaction, Undo, Redo, validation, evaluation, import, and serialization operations;
- the existing command and MCP schemas as the payload authority;
- revision-tagged responses and change notifications;
- stable IDs and domain coordinates only;
- structured errors and diagnostics;
- cancellation for evaluation/import/export work where safe; and
- a separate framed binary channel or asset-handle mechanism for large raster payloads.

It exposes no generic `eval`, arbitrary property-path mutation, shell execution, or general filesystem API. User-selected filesystem operations remain typed host capabilities.

The control envelope is conceptually:

```json
{
  "protocolVersion": 1,
  "requestId": "req-42",
  "documentToken": "document-1",
  "method": "session.executeTransaction",
  "expectedRevision": 17,
  "payload": {}
}
```

Every success response includes the resulting/current revision. C# discards stale asynchronous projections. Revision conflicts are reported and refreshed; they are never resolved by overwriting the Product Host from a C# copy.

### Human UI and MCP

The WPF client and MCP adapter converge inside the same Product Host on the same live `EditorSession`. MCP continues to expose approved schemas and compiles semantic requests to ordinary commands. It must not open a shadow Project, keep a second history, or bypass the Product Host mutation queue.

Live MCP transport/discovery may be delivered later, but the authority rule is part of this decision: when the desktop document is the target, both clients attach to that document token and receive the same revision/change stream.

### Viewport and rendering

WPF owns pointer capture, camera/display transforms, hit testing, interaction previews, overlay rendering, and refresh scheduling. Persistent coordinates remain Product domain coordinates.

The Product Host remains authoritative for evaluation and render-plan creation. The native viewport consumes revision-tagged `EvaluatedFrame`/render-plan projections and immutable raster asset handles. Pointer-move previews may be drawn locally from a gesture snapshot, but pointer-up commits one typed Product command/transaction; cancellation writes nothing.

WebView2 may be used only as a short-lived comparison/proof adapter if a later issue explicitly approves it. A WebView or DOM surface that owns production input, selection, authoring state, or final overlays does not satisfy shell-retirement criteria.

The final native raster backend is intentionally not selected in this ADR. WPF `WriteableBitmap`/software and Direct3D-compatible candidates must be measured against representative mesh, clipping, DPI, playback, and export fixtures. That backend choice receives its own ADR before native viewport implementation.

### Document and OS services

The WPF shell owns user intent and OS lifecycle: dialogs, current path association, recent files, close interception, app-data locations, atomic storage coordination, and presentation of Recovery choices. Format parse/migration/validation and Project serialization remain Product Host operations.

Large input/output uses typed streaming/bulk operations so routine queries do not base64-copy full PSD/PNG payloads. The public MCP surface cannot turn those internal channels into arbitrary filesystem access.

### Transition and retirement

ADR 0005 remains the description of the currently shipped Electron shell while migration is incomplete. Once this ADR is accepted and every retirement criterion in the Issue #92 design passes, ADR 0005 becomes superseded for the active desktop shell; it remains historical evidence of the previous implementation.

## Consequences

### Positive

- Mature Product semantics remain available immediately.
- WPF can evolve workflow and interaction independently of DOM structure.
- Human and MCP edits share one command/history authority.
- Process isolation makes crashes, protocol violations, and stale projections explicit.
- A complete Core rewrite is no longer on the critical path to a native shell.
- Product Host conformance tests can protect both WPF and future clients.

### Costs and constraints

- The release temporarily contains both .NET and a bundled JavaScript runtime.
- Protocol versioning, process supervision, asset streaming, and revision conflict handling are Product responsibilities.
- High-frequency gestures cannot synchronously round-trip on every pointer event; tools need local transient previews and one semantic commit.
- Native renderer parity must be demonstrated before Electron is removed.
- A later C# Core port, if ever justified, must replace the Product Host behind the same contracts and pass conformance tests; it cannot coexist as an independently editable Project implementation.

## Rejected alternatives

### Electron-only restructure

It could improve the current screen, but it does not meet the Windows-native/Cutwork-family direction and retains the browser focus/input/layout failure surface.

### Permanent WebView2 editor

It replaces Electron packaging but leaves DOM input and overlay authority intact and creates awkward focus, DPI, accessibility, and panel-boundary behavior. It is not the target architecture.

### Embedded JavaScript engine

It removes a process boundary but couples the WPF process to engine hosting, ES module loading, native runtime crashes, and deployment details. The product gains little because requests must remain typed either way.

### Full C# Core rewrite first

It creates the longest dual-implementation period across schema migration, rigging, animation, evaluation, and history. It also risks changing behavior before the new UI can be tested by users.

### WinUI 3

No current requirement outweighs WPF's established controls, custom input/render hosting, testability, deployment flexibility, or direct consistency with Cutwork.

## Acceptance checks for the boundary proof

Before feature migration starts, a follow-up implementation issue must prove:

1. WPF can launch, health-check, stop, and recover from Product Host failure.
2. WPF and the headless adapter discover the same protocol/schema version.
3. A WPF-issued command and an MCP-issued command enter the same `EditorSession` history in order.
4. Undo/Redo from either client affects that shared history.
5. A multi-command transaction is atomic and validation failures leave the revision unchanged.
6. Projections and events carry revisions; a stale response cannot overwrite newer UI state.
7. One representative `.fl2d` opens, queries, serializes, and round-trips without schema change.
8. A representative raster asset crosses the bulk boundary without routine JSON/base64 amplification.
9. Killing the Product Host does not cause the WPF shell to write or present a fabricated Project state.

