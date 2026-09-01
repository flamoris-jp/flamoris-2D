# ADR 0005: Windows Desktop shell

Status: proposed for Phase 1 Desktop acceptance

## Context

Phase 1 already has one persistent Project model, Query API, Command/Transaction
layer, EditorSession history, `.fl2d` serialization, Recovery semantics, and a
browser Editor shell. Manual acceptance showed that the product needs native
Windows file dialogs, durable file association, close interception, Recent
Files, and application-data Recovery before Phase 2 begins.

## Decision

FLAMORIS 2D uses Electron 44 as a thin Windows Desktop shell. Electron was
selected because the existing editor is browser-native JavaScript and Canvas,
so it can be hosted without a frontend rewrite or a second Desktop state model.
Electron Builder produces the Windows package and registers `.fl2d` as a
FLAMORIS 2D project file.

The architecture remains:

```text
Browser shell ─┐
Desktop shell ─┼─> Editor UI adapter ─> Query / Command / Transaction ─> Project
Headless / MCP ┘
```

The Desktop Main process owns OS-only state and capabilities:

- the absolute associated `.fl2d` path;
- Windows Open/Save/message dialogs and application menu;
- filesystem reads/writes;
- Recent Files;
- close/application-exit interception;
- Preferences and Recovery files under Electron `userData`.

The Renderer continues to own the existing EditorSession and calls the same
ProjectDocumentController. The controller gained an optional file-path field,
but the path is document context, not Project data, and is never serialized in
`.fl2d`. Save As and Incremental update the context; Save Copy does not.

## File semantics

- **Save** writes the associated path and marks the current EditorSession
  revision clean. Without an association it uses Save As.
- **Save As** uses a native dialog, changes the association, and marks clean.
- **Save Incremental** selects the next unused sibling name and uses exclusive
  creation so an external race cannot silently overwrite a file.
- **Save Copy** uses a native dialog while leaving association and dirty state
  unchanged.
- Overwriting saves write and flush a uniquely-created temporary file in the
  destination directory, close it, then replace the destination with a
  same-directory rename. A failed write or replace leaves the previous project
  intact; Incremental retains exclusive no-overwrite creation.
- Opened projects are parsed and validated before the selected path becomes the
  current association.
- `projectId` remains Project identity and is preserved by every save mode.
- PSD layer renders are stored as PNG data URLs in the `.fl2d` document
  envelope and restored by the UI adapter. They are deliberately not inserted
  into the Project model, so Core queries, commands, transactions, and
  headless/MCP state remain serializable and renderer-independent. Older files
  without this optional envelope field remain valid and can rehydrate missing
  renders through PSD Re-import.

## Recovery and Recent Files

Browser mode retains its localStorage adapter. Desktop mode maps only the two
approved Preferences/Recovery keys to files under:

```text
<Electron userData>/flamoris-state/preferences.json
<Electron userData>/flamoris-state/recovery/snapshots.json
<Electron userData>/flamoris-state/recent-files.json
```

Recovery remains separate from `.fl2d`. Snapshot availability does not attach
or dirty a Project. Restore Latest explicitly creates a dirty, Recovered
session; intentional Save clears Recovery and the Recovered label.

Recent Files is capped at ten entries. Missing paths are removed when the list
is loaded or used, and the Main process returns a typed, user-facing failure
instead of leaking Electron IPC wrapper text into the status bar.

## Security boundary

The BrowserWindow uses context isolation, disabled Node integration, Chromium
sandboxing, a restrictive Content Security Policy, denied permission requests,
blocked new windows, and blocked external navigation. A preload bridge exposes
specific file, dialog, title-state, and allowlisted storage operations only.
The Renderer receives no Node.js object and no generic filesystem API.

The application content and `ag-psd` bundle are served from a private secure
custom protocol. File writes, path selection, Recent Files validation, and
Windows-opened project validation stay in the Main process.

## Consequences

- Phase 1 Core, Browser shell, and headless/MCP adapter remain shared.
- Native dialogs themselves remain manual acceptance items; deterministic file
  naming, save semantics, title, Recent Files, close decisions, and payload
  adapters have OS/dialog-independent unit coverage.
- Windows CI runs the Product tests and creates an unpacked Electron package,
  protecting the Desktop dependency and packaging boundary separately from the
  deterministic Linux Product job.
- Bones, masks, proportional mesh editing, animation timeline, Key Art
  transitions, and export work remain Phase 2+ and are not introduced here.
