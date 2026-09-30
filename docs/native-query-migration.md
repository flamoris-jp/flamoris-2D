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
`localeCompare` and locale-sensitive scene search use pinned native ICU as
specified below. Ordinal sorting is not a substitute for ICU.

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

## Temporal evaluation checkpoint

Temporal sampling is shared native math for later Transition/Sequence evaluation:
step/linear/60-step Bezier, sparse object interpolation and signed shortest-arc
Bone/Transform/Camera rotation retain Product semantics. Canonical track/channel,
event and inclusive region ordering remain observable in returned projections.
Sampled channel numbers use the same 1e-12 relative platform-math tolerance as
world matrices; IDs, ticks, frame counts, other data and all array order are exact.

Clip inspection uses half-open placement, enabled flags, rational playback,
source offsets and round-half-up ticks. Export planning uses rational timestamps
and excludes trailing frames which round onto the end boundary. Intermediate
integer products can exceed 64 bits even though every input/output is a JS safe
integer. A bounded private unsigned 128-bit helper supports these products on
both MSVC and GCC without platform-specific arithmetic or floating rounding.
The largest required frame product is below 2^123; this is fixed tick arithmetic,
not a persistent format or general arbitrary-precision runtime. Admission's
existing Clip last-active-tick check shares this exact calculation, replacing its
long-double approximation. Tests include half-tick ties and safe-range extremes.

Very high valid frame rates expose an existing planner performance defect: its
trailing-frame loop can discard billions of frames one at a time. Both Product
and native planning replace that loop with the exact bound
`ceil((2 * durationTicks - 1) * numerator / (2 * 120000 * denominator))`.
The initial candidate count's safe-range check still occurs first. This preserves
all planned values and exception priority while making planning independent of
the number of discarded sub-tick frames.

The Temporal checkpoint raises coverage to 51/72 queries. All eleven typed track
families, all three interpolation kinds, signed half-turns, sparse weight maps,
empty channels, events and inclusive regions are sampled. Tick/frame results are
exact at safe-integer extremes; sampled channels and matrices retain the stated
platform-math tolerance. Production authority and physical acceptance remain pending.

## Locale reads

The twelve locale-sensitive list/search queries preserve their existing Product
semantics through ICU 78.3, matching the pinned Node 24 runtime. Windows uses the
official ICU Win64 MSVC2022 archive, pinned by SHA-256; other development platforms
link an exact-version ICU installation. This is a native library/data dependency,
not a runtime Node/V8 bridge. The native C API avoids passing ICU C++ objects across
the DLL boundary. The three ICU DLLs and upstream license accompany experimental
interop builds; App/portable packages still have no dependency on the experimental
interop project at this checkpoint.

Collation uses the default ICU locale with V8's `en_US_POSIX`/`c` → `en-US` fallback,
normalization enabled and the default variant sensitivity. Sorting is stable when
ICU regards distinct IDs as equivalent. Scene search preserves locale-sensitive
lowercasing and substring matching, effective visibility and ECMAScript node
enumeration. Ordinal queries keep their existing UTF-16 comparisons.

Fixtures declare their oracle locale; the test harness supplies that locale to
current JS query methods and ICU without changing Product state. Locale regressions
include en-US, ja-JP, sv-SE and tr-TR, accents/combining characters, Turkish dotted
and dotless I, Greek final sigma, sharp S and hidden ancestors. The native test
process resets ICU's locale after each locale group. Product does not expose a
new locale override or save a locale in Project data.

This checkpoint implements 63/72 queries. The corpus contains 99 admitted Project
fixtures and 16,351 reads, including stable collation ties between composed and
decomposed IDs, disabled bindings, filter coercion, embedded NUL, astral text,
POSIX/C fallback and numeric-key node enumeration. Every locale group also retains
the existing buffer, history, pending-edit and mutation-error immutability checks.
The nine remaining queries evaluate rig/skin/form, Transition, Sequence and
individual export frames; production authority and physical acceptance remain pending.

Upstream references: [ICU 78.3](https://github.com/unicode-org/icu/releases/tag/release-78.3),
[collation](https://unicode-org.github.io/icu/userguide/collation/), and
[V8 default locale](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/execution/isolate.cc).
