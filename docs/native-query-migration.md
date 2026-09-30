# NativeSession Query migration

Issue #127 follows the command milestone with the same readonly Product Query
surface as `product/src/queries/project.js`. NativeSession remains experimental;
the Product Host is the production authority until queries, evaluation, source
ingest, persistence and the physical Windows acceptance are complete.

## Boundary

ABI 1.4 adds `fl2d_session_query_json` on the existing session. The bounded UTF-8
request is `{ "name": "scene.get_node", "input": { "nodeId": "part" } }`.
Only `name` and optional `input` are accepted at the request root; `name` is a
string and `input` is an object (omission means `{}`). This is an interchange
envelope, not a second property-path API or persistent Project field. The sealed
query names are the existing Product names. Domain-specific selectors retain
Product behavior, including nullable lookups and missing-selector errors.

Successful interchange returns caller-owned, NUL-terminated UTF-8 JSON:
`{ "value": ... }`, or `{ "error": { "name": "Error", "message": ... } }`
for a Product query exception. Unknown query names use the existing JS error.
Known queries awaiting implementation return `FL2D_QUERY_UNSUPPORTED`; they must
never silently fall back to a second authority. Malformed interchange returns a
C status. Query outputs can be larger than the admitted 1 MiB Project; consumers
use the reported buffer length, with the existing serialized-call requirement.

Queries never write Project, revisions, saved revision, undo/redo/history,
prepared-handle generation or the session's mutation error. This includes
domain failures, rejected interchange and buffer sizing calls. Managed callers
decode the envelope and retain the Product exception name and message.

## Compatibility

Getters and projections copy existing data; they do not normalize the stored
Project. Canonical temporal/view/clip lists sort their returned copies. ID
comparisons which use JS relational operators retain UTF-16 order. Lists using
`localeCompare`, and locale-sensitive scene search, remain pending until their
collation contract is preserved. Ordinal sorting is not a substitute for ICU.

Scene world matrices use the existing affine multiplication order, pivot and
ancestor visibility rules. Geometry conformance permits a relative numerical
tolerance of 1e-12 for platform math; all other values and array ordering are
exact. Query fixtures are derived from current JS, exercise populated histories
and outstanding prepared edits, and assert that successful and failed queries
leave all session state intact. The existing native CI checks this boundary;
no separate overlapping workflow is added.

The first checkpoint implements 48/72 queries: readonly getters, domain validation,
scene tree/world matrix projection, canonical temporal lists, Clip/Sequence duration
and Transition authoring. Full Project validation shares admission and retains
zero-area/near-degenerate triangle and loop seam warnings, including message and
details. The sealed inventory marks the remaining 24 names explicitly pending.
