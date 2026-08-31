# ADR 0004: Project files, Recovery, and reviewed PSD re-import

Status: proposed for Phase 1C

## Context

Phase 1A established the persistent Project, Command/Transaction layer,
validation, PSD identity, and reconciliation. Phase 1B connected the browser UI
to that Core. Phase 1C needs a user-facing project file without making browser
file APIs, Preferences, Recovery, or PSD review dialogs into new mutation
authorities.

## Decision

### `.fl2d` format

`.fl2d` is UTF-8 JSON in format version 1. Its top-level document contains:

- `format: "flamoris-2d-project"`;
- `formatVersion: 1`;
- `projectId` and `name`, mapped to the existing in-memory Project identity and
  display name rather than duplicated inside the nested Project payload;
- `createdAt` and `modifiedAt` file metadata;
- the validated persistent Project payload.

The loader accepts the current Phase 1A/1B bare Project JSON as an explicit
legacy migration. A newer unknown `formatVersion` is rejected. Migration stays
in `io/project-json.js`, outside browser UI code. `.fl2d` remains inspectable
JSON and is not a container in Phase 1C.

Save, Save As, Save Incremental, and Save Copy all preserve `projectId`. Save
As and Incremental change the current file association and establish a clean
save point. Save Copy changes neither. The default incremental suffix width is
three digits and the highest matching known version is incremented.

### Dirty state

`EditorSession` owns monotonic history revision identities and a saved revision.
Commands advance the current revision; Undo and Redo move between the recorded
before/after revisions. A successful intentional save moves only the saved
revision. Transient UI state never enters this model.

### Preferences and Recovery

Application Preferences are stored separately from Project files. Phase 1C
supports autosave enablement/interval, bounded Recovery versions, a major-
operation checkpoint, Recovery notification, and incremental number width.

Recovery snapshots use separate browser storage and never write the associated
`.fl2d`. Intentional save and Recovery therefore remain distinct operations.

### PSD re-import

Re-import is `Select → Analyze → Review → Apply`. Analysis produces rows with
`matched`, `changed`, `added`, `missing`, `ambiguous`, or `unmatched` semantics.
Ambiguous rows begin unresolved and block Apply. Manual selection is one-to-one
and records whether the match is automatic or manual plus an explanation.

Review does not mutate the Project. Apply builds a complete validated next
Project while preserving the logical `projectId` and authored state for matched
nodes. It commits through the typed `source.apply_psd_reimport` Command as one
transaction/history entry. Undo restores the complete previous Project.

Raster parts carry a deterministic content fingerprint in source provenance.
A part is classified unchanged only when both structural properties and raster
fingerprints agree; missing fingerprint evidence is treated conservatively as
changed. Browser render assets remain transient, but a dedicated UI history
adapter switches reviewed canvas bindings before Apply/Undo/Redo notifications,
so every render observes assets whose node IDs exist in the current Project.
Keep Existing preserves its prior canvas. One-to-one imported-part mapping is a
review-wide invariant checked after every row mutation and again before Apply.

### Headless boundary

The in-process headless adapter exposes the existing Query API and delegates
commands/transactions to `EditorSession`. It publishes the same command schemas
as the UI path and does not implement a second mutation route or a networked MCP
service.

## Consequences

- Browser pickers/downloads and dialogs stay adapters; deterministic semantics
  are testable without browser plumbing.
- A future packaged `.fl2d` can retain the extension while introducing a later
  explicit format version/migration.
- Opening a Project does not require the original PSD. Re-import asks for the
  PSD again, and visual comparison is available when render canvases exist.
- Embedded PSD/assets, rigging, animation timeline, Key Art correspondence, and
  general networked MCP infrastructure remain out of Phase 1C.
