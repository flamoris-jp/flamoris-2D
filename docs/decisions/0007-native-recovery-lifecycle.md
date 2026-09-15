# ADR 0007: Native Recovery lineage and revision-qualified save acknowledgement

Status: accepted for implementation by the 2026-09-15 production-migration instruction;
implementation and Windows acceptance remain subject to PR review.

Parent #96; decision #97; assets/renderer #98. This supersedes the proposed contract,
not the Project schema or EditorSession history. The user explicitly authorized settling
this existing ADR while completing migration, without intermediate hands-on gates.

## Decision

Product Host retains the full parsed `.fl2d` envelope: Project, renderAssets, createdAt
and modifiedAt. C# never serializes a Project projection. Control JSON stays at 8 MiB;
complete document bytes use typed, ephemeral, authenticated loopback handles beside
the existing raster channel. No path/process/eval capability is exposed.

Each New/Open/import starts a fresh opaque lineage and document token. Explicit Recovery
restore continues the selected lineage with a new token and dirty EditorSession.
Save As/incremental retain the live lineage; Save Copy never changes it. Reopening a
file normally starts a new lineage, so an old session's save cannot erase another's
snapshots of the same file. Paths and project IDs are display associations, not identity.

A prepared save contains a single-use opaque receipt bound to token, lineage, protocol
revision, EditorSession history revision, bytes, timestamps and operation. The native
writer streams to a same-directory temporary file, flushes to disk, then atomically
replaces the destination (exclusive move for incremental). Only durable success may
acknowledge that receipt. Host calls existing `markSaved(capturedHistoryRevision)`;
newer edits remain dirty, Undo to the saved history state is clean. Receipts from
another document, consumed receipts and expired receipts are rejected. Save Copy and
Recovery never acknowledge the current document's save point. Only one prepared
intentional save is permitted at a time; expiry is 10 minutes. Failure/cancel releases
its bytes and receipt without changing path, dirty identity or recovery.

A successful acknowledgement returns a cleanup scope, not a global clear: only the
same lineage AND source document token AND protocol revision <= the saved snapshot
are covered. Restored snapshots are also eligible only by their exact origin snapshot
ID, and only after a successful save of the restored document. Newer and unrelated
snapshots survive. No caller-supplied history revision is accepted as a save receipt.

## Dirty replacement table

| Action | Save | Discard live edits | Cancel/failure |
| --- | --- | --- | --- |
| New/Open/import/restore/close | continue only after matching durable acknowledgement and still-clean live session | continue; retain durable Recovery | leave live session/path/Recovery unchanged |
| Save As/incremental | associate destination after matching acknowledgement | n/a | preserve current association |
| Save Copy | write copy; preserve association/dirty/Recovery | n/a | preserve everything |
| Restore | validate complete candidate/assets before replacement; new token, dirty | retain origin snapshot until acknowledged save | preserve live session and every snapshot |

`今回は復元しない` dismisses the card for this app session only. `ファイル > 復元`
remains available. `復元データを破棄` confirms and deletes only selected immutable
snapshot IDs. Closing a card never deletes bytes. Legacy browser recovery is untouched.

## Storage and bounded resource policy

Native Recovery is immutable files in the application recovery directory, external to
Project/.fl2d. Snapshot metadata includes version, stable snapshot/lineage IDs, source
token/protocol/history revision, timestamps and optional source path. The full document
and metadata commit together by atomic move. List corrupt/future entries diagnostically;
never restore or silently delete them. Keep the last three readable snapshots per
lineage, evicting older readable snapshots only AFTER the replacement is durable.
No automatic cross-lineage eviction: reaching the aggregate 1 GiB disk quota fails the
new snapshot with a visible warning and preserves all existing bytes. Explicit discard
is the way to reclaim unrelated/corrupt data.

Initial native document transport: 128 MiB per encoded document; 256 MiB aggregate
reserved/transferring document bytes; at most two handles; two HTTP connections shared
with raster transport. These are admission limits, not measured peak-RSS claims.
Raster materialization separately checks dimensions, count and current+candidate bytes
before decode. Limit failures leave the current document intact; no hidden asset eviction.
Documents beyond this admission policy remain usable in Electron pending measured
production budget revision under #98. This is an explicitly remaining parity gap.

## Validation

Protect full-envelope round-trip, two unrelated lineages, copy, dirty restore, malformed
and future documents, Undo/Redo around save, edit-during-save, stale/duplicate receipt,
failed/cancelled write, bounded/aborted binary transfers, exclusive incremental creation,
corrupt/quota Recovery, scoped cleanup and artwork preservation. Windows UI/focus/DPI
acceptance stays at the final production pass. This ADR does not accept a renderer or
close #96/#97/#98 by itself.
