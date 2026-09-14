# ADR 0007: Native Recovery lineage and revision-qualified save acknowledgement

Status: **proposed — requires maintainer decision; not implementation authority**

Decision issue: [#97](https://github.com/flamoris-jp/flamoris-2D/issues/97).
Parent migration: [#96](https://github.com/flamoris-jp/flamoris-2D/issues/96).
Related asset/renderer gate: [#98](https://github.com/flamoris-jp/flamoris-2D/issues/98).

## Context

The accepted native migration design requires this decision before document lifecycle.
The existing browser Recovery store has one Storage key, timestamp/projectId/document
entries, a default maximum of three versions, and global `clear()`. It has no stable
snapshot identity or scoped deletion. Carrying that deletion policy into native Save
can erase unrelated recovery data. Phase 1 Host serialization also drops envelope
assets/metadata; accepting this ADR alone does not close that independent blocker.

The Project schema, stable IDs, command history, migration and serialization semantics
must remain unchanged. Native dialogs and storage coordinate intent; they do not become
a second editable Project or a second Undo stack.

## Proposed contract

### Identity and ownership

- Store Recovery metadata outside Project and outside `.fl2d` schema. Give each recovery
  lineage and snapshot an opaque stable ID; never identify them by display name alone.
- A snapshot records its lineage, timestamp, source association, source document token
  and EditorSession revision identity, plus the full validated document envelope/assets.
  Host monotonic protocol revision is not interchangeable with Undo history identity.
- Recovered sessions receive a new live document token and start dirty. Keep the old
  snapshot immutable until an explicit successful action permits scoped deletion.
- Native storage owns immutable snapshot bytes; Product owns parse/migration/validation.
  Do not share mutable Project objects across the boundary.
- Import legacy browser recovery through an explicit migration action. Never delete
  legacy storage merely because the native shell launched or migration was attempted.

### User actions

| Action | Live session / association | Recovery disposition |
| --- | --- | --- |
| Restore latest / selected snapshot | Validate complete candidate, then replace only after unsaved-work decision; new token, dirty | Retain snapshot until successful save or explicit discard |
| Dismiss reminder | No document change; suppress reminder for this app session | Retain all bytes |
| Discard selected recovery | No implicit live document replacement | Confirm exact lineage/snapshots; never global clear |
| Save | Associate/mark saved only after durable write and matching Host receipt | Clean up only acknowledged lineage/state, never newer or unrelated snapshots |
| Save As / Incremental | Same receipt rule, new association only after success; Incremental remains no-overwrite | Same scoped rule as Save |
| Save Copy | No current association or dirty-state change | Retain recovery |
| Cancel / write failure | Preserve live document, association and saved identity | Retain recovery; show actionable error |
| Host failure | Invalidate WPF projections; do not serialize them | Offer only previously durable validated snapshots; no false recovery promise |

New/Open/import/close must ask about dirty work before replacement. Save-and-continue
requires successful matching save acknowledgement; cancel/failure cancels replacement.
Discarding unsaved live work is a distinct decision from deleting durable recovery.
For import/re-import, build and validate the entire candidate and its asset ownership
before committing; ambiguous re-import review remains explicit.

### Save receipt and races

1. The Host issues an opaque serialization receipt associated with the exact document
   token, EditorSession revision identity, envelope/assets and serialized bytes.
2. The native typed writer performs same-directory temporary write, flush and atomic
   replace (or exclusive Incremental creation). No generic filesystem API is exposed.
3. Only durable success acknowledges that receipt back to the Host. A different live
   token or failed/cancelled write cannot mark a document clean or clear its recovery.
4. If newer edits exist, the current session remains dirty relative to the saved state.
   WPF never infers cleanliness by assigning its latest visible revision to `markSaved`.
5. Cleanup applies only to the acknowledged lineage and covered state. Concurrent newer
   snapshots survive. Save Copy never acknowledges a current-document save point.

The exact receipt expiry, consumption and saved-history lookup need implementation
design review against `EditorSession.markSaved`; do not add a second history to solve it.

### Corruption and storage bounds

- List unreadable/corrupt/future-version entries with diagnostics. Do not silently erase
  them or replace the live session. Offer an explicitly chosen readable alternative.
- Propose preserving the existing three-version default **per lineage**, not globally.
  Exclude dismissed/corrupt snapshots from automatic destructive cleanup until reviewed.
- Aggregate byte budget, cross-lineage eviction order and treatment of corrupt entries
  remain decisions in #97, informed by representative embedded-art documents. No invented
  numeric budget becomes Product policy through this proposal.
- On quota/write failure, keep the previous durable snapshots and warn that the newest
  work is not recoverable. Never delete the last good snapshot before its replacement
  has been durably committed.

## Alternatives and decision still required

Global clear is rejected as unsafe for multiple documents. Project ID alone conflates
copies, forks and recoveries. Path alone cannot represent unnamed or moved documents.
Automatic deletion on dismiss contradicts the distinction between reminder and recovery.

Maintainer review must settle lineage continuity for Save As/forks, exact cleanup scope,
retention/eviction and receipt lifetime. This proposal deliberately does not accept itself.
After acceptance, implement lifecycle together with the envelope/bulk ownership proof;
do not enable native Open/Save in the meantime.

## Required proof

Test two unrelated lineages, unnamed/renamed files, Save Copy, exclusive Incremental,
Undo/Redo around a save, edits while writing, late acknowledgement after replacement,
cancel/failure/crash at each persistence boundary, corrupt/future snapshots, quota
failure, scoped discard and preserved embedded artwork. Then perform Windows native
dialog/dirty-close/recovery hands-on. Product-only tests cannot establish that UX pass.
