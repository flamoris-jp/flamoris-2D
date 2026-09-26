# ADR 0010: Live Native MCP attachment and local capability boundary

Status: historical Issue #102 decision; MCP transport superseded by [ADR 0011](0011-mcp-core-migration.md).
The original decision below is preserved as historical context.
Baseline: main f717f282 (merged #101). No Project/schema/timebase change.

## Protocol and implementation

Official sources checked before implementation:
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- https://ts.sdk.modelcontextprotocol.io/v2/clients/connect.html

Use official TypeScript SDK v2, pinned dependencies, stateless Streamable HTTP.
The SDK owns wire validation, request metadata/version negotiation and legacy
2025 initialize compatibility. Modern 2026-07-28 clients use per-request metadata;
an initialize handshake is not required in that era. No GET SSE transport,
protocol sessions, sampling, roots, elicitation or subscriptions are needed.
The SDK creates disposable protocol server objects, never Product sessions.
No stdio forwarder is currently required; do not launch another Product Host.

## Single authority

Move serialization from the stdio entry into ProductHostService.handle. Both
entry points use that queue, including queries, so revision tags describe the
state actually read. The live facade closes over the existing service only.
Commands/transactions call session.execute/executeTransaction; Undo/Redo call
session.undo/redo including the Native source-artwork history wrapper. The
existing document.changed event is written to WPF's control channel.

Every edit requires documentToken and expectedRevision; no silent rebase.
Queue entry checks cancellation, deadline, capability generation and document
identity before dispatch. Product mutation is synchronous; check its deadline
again immediately before committing a prepared transaction. Cancellation
observed before commit prevents mutation; cancellation after commit cannot
retroactively undo a committed edit. Callers must query after ambiguous network
failure. Disable revokes immediately, even while a long Host operation awaits.
Replacement revokes before installing the new document. Host loss/shutdown
closes HTTP connections and revokes all requests. Tokens are never persisted.
The WPF control channel is also an authority lease: a parse/read/write failure
terminates the still-running Product Host before WPF publishes authority loss,
and a Product Host event-write failure revokes MCP and shuts the Host down. MCP
therefore cannot remain as a sole editor after the Native shell is detached.

## Exposure and permissions

Default disabled. WPF alone enables, disables, rotates or changes permission.
Read only permits schema discovery and typed queries/evaluation/validation.
Edit additionally permits ordinary commands, bounded atomic transactions and
shared Undo/Redo. Product schemas deterministically generate named tools and a
complete disposition resource. Public commands are explicitly audited; unknown
future commands fail closed until assigned a disposition.

source.apply_psd_reimport and headless import are excluded: the Native review,
asset retention, document replacement and save acknowledgement cannot be
bypassed. No Save/Open/import/export-to-path/binary handle/process/eval API is
published. Evaluation/export planning queries only compute Product values.

## Local security and resource limits

Bind exclusively to 127.0.0.1 with an OS-selected port. Validate exact Host
including that port; reject any Origin header, including empty/null. Require a
cryptographically random 256-bit bearer capability, compared in constant time.
Separate from internal binary credentials; never expose those credentials via
MCP discovery. A capability grants access to this document only, not OS files.

This is an explicitly provisioned local capability, not an OAuth authorization
server: clients supply the copied Authorization header. OAuth-only or remote
clients are intentionally unsupported. No browser exceptions/CORS or LAN bind.
Connection information includes the secret only in the explicit copy action;
status/activity never includes secrets, arguments, artwork or whole Projects.

Bound body size, nesting, transaction length, active requests, connections and
deadline. Errors/logs expose bounded codes/status, not private payload dumps.
WPF displays enabled/permission/endpoint and request activity, never a fabricated
connected-client count for stateless HTTP. Changing permission rotates credentials.

## Proof and packaging

Official client SDK integration tests exercise current metadata and legacy
initialize, security rejection, shared revision/history, transaction rollback,
stale concurrent writes, cancellation, replacement and restart. The packaged
WPF production smoke adds external HTTP edits and shared Undo/Redo to its actual
PSD → Mesh → Rig → Animation → Save/Open proof. Full Product regression remains
a gate. Runtime inputs include only reviewed locked production dependencies;
client SDK/tests/fixtures are excluded from the Windows candidate.

Physical Windows/DPI/real-artwork acceptance remains a separately reported
hands-on check. This ADR does not retire Electron or approve release cutover.
