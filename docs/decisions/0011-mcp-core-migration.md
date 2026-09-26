# ADR 0011: Native MCP Core and Product Host reservation

Status: proposed implementation for #107; supersedes ADR 0010's MCP transport.

## Topology and ownership

External official MCP client → packaged `Flamoris.Mcp.Bridge` stdio launcher →
Core 1.1.0 authenticated same-user local pipe → Native `IMcpHost` adapter → the
existing Node Product Host / EditorSession / source-art history.

Core owns MCP protocol, capability, permission, framing, admission and status.
2D retains its audited tool registry, exact Product schemas, commands, queries,
transactions, artwork history and document lifecycle. No second editor is created.
Manual connection is the baseline; managed providers are outside this change.

## Cross-process commit boundary

Core requires synchronous atomic callbacks on the authority's serialization lane.
The adapter reserves that lane through the existing private control channel. A
reservation returns the actual Product snapshot while holding subsequent WPF and
MCP work. Core then validates that snapshot and invokes one synchronous callback.
The callback forwards a named, schema-checked Product tool under the reservation;
it does not execute domain logic in C#. Completion/release resumes the same queue.

Reservations are bounded and cancellation is signalled out of queue. Product Host
rechecks reservation identity, runtime, document, revision, permission, expiry and
revocation at the existing EditorSession beforeCommit hook (including history).
Disable/replacement/control loss invalidate pending reservations. No callback may
enqueue behind its own reservation. Lost responses are never automatically retried.
Cancellation after an atomic commit does not undo committed user work.

## Connection and packaging

Each enable rotates pipe and capability. Copy uses the packaged bridge path and
`FLAMORIS_MCP_CAPABILITY` environment entry only. Credentials never enter argv,
application preferences, logs, project or provider profile files. The clipboard
is an explicit transient disclosure for the user's manual client configuration.

Ship the self-contained bridge under `mcp/`; it references the same Core 1.1.0
package and contains no Product Host files. Remove Node MCP HTTP server/runtime
dependencies. The separate private raster/document bulk channel is unchanged.
ADR 0010 remains historical context. Core tool calls use `{ guard, input }` and
`mcp.context`; the previous HTTP protocol/configuration is intentionally retired.

## Validation

Protect Node reservation/commit semantics with deterministic tests, and exercise
the official client through the built bridge in the existing Native integration
gate. Preserve the packaged WPF Mesh transaction and shared Undo/Redo smoke.
Physical Windows cursor, DPI, clipboard and real-artwork checks remain hands-on.
