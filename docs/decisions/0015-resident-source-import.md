# ADR 0015: Source upload into the resident headless workspace

Status: implementation candidate requested by Akino, 2026-11-07.

## Requirement and acceptance

Transfer a Cutwork `.flimg` (or PSD/PSB) into the running Linux host without
reconfiguring or restarting it. Continue ordinary editing, preview, checkpoint,
and restart/reopen after import. LIME deployment is a separate, deferred action.

## Decision

Add four edit-only CLI tools: `cli.source_upload_begin`, `write`, `finish`, and
`cancel` (each name has the `cli.source_upload_` prefix). They accept bytes, never
remote paths or URLs. One process-local upload is bounded to 64 MiB, with 128 KiB
chunks, SHA-256 for the complete source and each chunk, strict canonical offsets,
and identical last-chunk retries. The caller supplies a UUID for retryable begin.
Incomplete uploads disappear on process exit and can be cancelled explicitly.

Import is an explicit **document replacement**, not append or source reconciliation.
Begin binds the current document token/revision; finish must still match. Finish
requires `replaceCurrent: true`, a clean checkpoint, and no running render JOB.
Before replacement, preserve that checkpoint as
`workspace/import-backups/<upload-id>.fl2d`; reject external checkpoint changes.
Backups remain available after the imported project is saved. No implicit save of
the imported project: `cli.project_save` remains the persistence operation.

Prepare a complete candidate through the ordinary NativeWorkspace importer in
an isolated temporary workspace. Codecs, native source conversion, source-part
inclusion, raster placement and validation are unchanged. Commit the validated
candidate through the target workspace's normal lifecycle replacement on Core's
guarded commit lane. Invalid/truncated uploads, failed candidate preparation,
dirty documents, concurrent edits and backup failures leave the live project
unchanged. Replacement resets the document/history; it is not Undo across files.

The CLI opts into Core's existing application-lifetime grant and NativeMcpHost
mode. Stdio context follows the current document, while every mutation still
requires a current document/revision guard. Windows tool catalogs are unchanged.
The Linux catalog adds four tools (188 total); deployment must regenerate the
Hub descriptor from the accepted CLI before connecting the new runtime.

## Regression boundary

Extend the existing actual-process official MCP client acceptance test: chunk
transfer/retry/cancel, read-only and stale-guard rejection, checksums, malformed
source, dirty/external checkpoint protection, successful replacement without
reconnect, old guards rejected, editing/Undo/Redo after import, backup preservation,
explicit checkpoint and source-independent restart/preview. Existing Linux and
Windows source/session checks remain the compatibility boundary.
