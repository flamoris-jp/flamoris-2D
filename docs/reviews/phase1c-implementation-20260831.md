# Phase 1C implementation and acceptance status — 2026-08-31

## Implemented

- `.fl2d` UTF-8 JSON format identity/version envelope and legacy Phase 1A/1B
  migration.
- Clear rejection for an unknown newer format version.
- Save, Save As, Save Incremental, and Save Copy with preserved logical
  `projectId` and distinct current-file/dirty semantics.
- Revision-based dirty/save-point behavior across Undo/Redo.
- New/Open/Import and browser-close unsaved-change guards.
- Application Preferences stored separately from Project state.
- Bounded Recovery snapshots and interval/major-operation checkpoints that
  never overwrite the intentional `.fl2d`.
- Safe PSD source display metadata without a required absolute path or embedded
  PSD.
- PSD re-import Analyze/Review/Apply table, match explanations, manual mapping,
  one-to-one protection, side-by-side preview when canvases exist, summary, and
  unresolved-ambiguity Apply blocking.
- Re-import Apply through one validated `source.apply_psd_reimport` Command and
  one undoable transaction.
- Minimal in-process headless adapter over the same Query API, Command schemas,
  `EditorSession`, validation, and state used by the browser UI.

## Automated acceptance

The Product suite passes 44 deterministic Node tests. Phase 1C coverage includes:

- format/version validation, migration, and newer-version rejection;
- filename generation and all four save semantics;
- `projectId` preservation and revision-based dirty status;
- Preferences defaults/serialization;
- bounded Recovery and separation from intentional output;
- re-import classification, unresolved ambiguity, manual mapping, Apply, and
  whole-operation Undo;
- headless query/edit/validation through normal Product boundaries.

## Manual acceptance still required

Issue #5 should remain open until the complete browser acceptance pass is run
with the private Akino PSD and a known changed copy. In particular, verify:

1. browser picker/download behavior for Save, Save As, Incremental, and Copy on
   the target browser/OS;
2. Recovery notification and restoration choice in the real application flow;
3. side-by-side previews and at least one manually changed Akino mapping;
4. Apply, rendering, and whole-operation Undo with the real PSD assets;
5. reload equivalence and the UI/headless hierarchy comparison for Akino.

No Phase 2 rigging, masks, timeline, Key Art correspondence, or transition work
is included in this change.
