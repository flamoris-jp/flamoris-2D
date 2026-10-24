# Cutwork `.flimg` v1/v2/v3 import

Status: implemented for Issue #86

FLAMORIS 2D consumes the documented Cutwork `.flimg` v1, v2 and v3 contracts as external
source art. `.flimg` is not a native Project format and does not replace `.fl2d`
or PSD import.

```text
.flimg archive bytes
  -> FlimgCodec (ZIP / strict JSON / checksum / PNG validation)
  -> normalized Cutwork import model
  -> deterministic Part / Base / Patch / Repair raster materialization
  -> ordinary Project / Scene / KeyArt + transient render assets
  -> existing authoring, shared renderer, and .fl2d persistence
```

The importer is independent of the Cutwork runtime. The cross-repository
authority is `flamoris-cutwork/docs/flimg-schema-v1.md` and
`flamoris-cutwork/docs/flimg-schema-v2.md` and
`flamoris-cutwork/docs/flimg-schema-v3.md`. Cutwork writes v2 without an artwork
work log and v3 when that log is nonempty; old v1 archives remain readable. Unknown versions fail explicitly.

## Conversion contract

- A Cutwork layer UUID remains the source identity authority as
  `sourceKey = "layer:<uuid>"`. Generated 2D entity IDs remain ordinary Project
  IDs. Cutwork document/layer identity and provenance are retained in
  `sourceAsset.metadata`, `sourceRef.cutwork`, and KeyArt/SemanticSlot metadata.
- Manifest order is top-to-bottom. KeyArt draw order is assigned in reverse
  numeric order so the existing bottom-to-top renderer preserves the stack.
- v2 Part `partOrder` and Repair `ownerPartId` are validated and retained in
  source provenance. Part semantic order does not change compositor draw order;
  owned Repair layers retain their own scene nodes and raster placement.
- Part artwork is cropped Original RGBA with alpha multiplied by the authored
  Gray8 mask. Gray values are not thresholded.
- Base artwork is full-canvas Original with alpha multiplied by the inverse of
  the maximum union of every authored Part mask. Part visibility never changes
  this union.
- Patch pixels stay local and unbaked. Cutwork center, scale, and degrees are
  converted to the existing node position/pivot/scale/radian transform.
- Repair pixels use their document-space bounds with an identity transform.
- Non-null Cutwork `semanticName` values become ordinary mapped SemanticSlots
  while also remaining in source provenance.

Imported RGBA render assets use the existing render-asset adapter and are
embedded in the next native `.fl2d` save. The original `.flimg` does not need to
remain available after import.

## v3 artwork work log

Acceptance criteria: import genuine Cutwork v3 output with unchanged v2 raster,
mask, ownership and stack semantics; retain the log through a source-independent
`.fl2d` save/reopen; reject malformed logs before replacing any live state.

The source codec validates `workLog` metadata and exact `work-log.jsonl` bytes:
canonical asset path, SHA-256, strict UTF-8 JSON Lines with a final newline,
nonempty contiguous records, unique nonempty UUIDs, UTC timestamps, document
tokens, nonnegative Int64 revisions, strict fields and producer quotas (4096
records, 32 KiB per line including newline, 4 MiB total). v1/v2 still forbid
work-log metadata/assets. Unknown future versions stay rejected.

The normalized source description adds `workLogJsonl` only after validation.
The C++ converter stores the manifest `workLog` descriptor and exact UTF-8 text
as `sourceAsset.metadata.workLog` and `sourceAsset.metadata.workLogJsonl`.
Keeping the JSONL as text preserves its byte checksum and Int64 revisions across
the C++ JSON model. These are editorial source records, never executable commands,
2D Undo/Redo entries or 2D document revision authority. No new Project schema,
MCP command, or Cutwork runtime dependency is needed. The original Cutwork file
is left untouched; 2D does not append to or export its log.

## Safety and replacement boundary

The archive is never extracted. Before a candidate Project can replace a live
session, the importer validates canonical paths, central/local ZIP bounds,
entry overlap, CRC, compression output bounds, entry counts and sizes, strict
manifest structure and duplicate properties, version/format, UUIDs, layer
bands, bounds/transforms, expected assets only, SHA-256, and canonical PNG
dimensions/formats.

The desktop import adapter and native workspace call the same source codec and
C++ source conversion. They construct and validate the complete candidate plus render assets
before session replacement, so a failed import leaves the current Project and
history unchanged.

Full re-import/reconciliation, Cutwork editing tools, `.flimg` export, and
future schema migration remain out of scope.


## Continuous compatibility boundary (#150)

| Producer format | 2D consumer | Regression boundary |
| --- | --- | --- |
| Cutwork v1 (frozen legacy contract) | Supported | Existing v1 codec and native-workspace archives in `source-codec-conformance.json` |
| Cutwork current writer, v2 | Supported | `fixtures/cutwork/cutwork-current-v2.flimg` through native import and `.fl2d` save/reopen |
| Cutwork writer with nonempty log, v3 | Supported | `cutwork-current-v3.flimg`, strict log rejection and exact log preservation through `.fl2d` save/reopen |
| Unknown newer version | Rejected before replacement | An actionable `flimg.schema_unsupported` diagnostic; live Project, history and artwork remain unchanged |

The compact current-writer fixture includes Base, multiple Parts with semantic
order different from compositor order, transformed Patch, owned and global
Repairs, hidden layers, graded masks and transparent pixels. The native session
regression compares source provenance, semantic mappings, stack/visibility,
placement and decoded RGBA bytes, then reopens `.fl2d` in a fresh workspace after
the source file is removed. Test fixtures and regeneration code are outside the
Product runtime dependency graph and portable package.

The existing **Windows Portable Package** PR check runs this regression as part
of `Flamoris2D.Session.Tests`. It also checks out public Cutwork `main` under
`out/`, records the exact producer SHA, regenerates the archive through the
actual Windows/WPF PNG writer, and runs the focused compatibility regression.
The offline corpus protects reviewed historical bytes; the producer step
protects drift in the current writer, including its PNG encoding. A future
incompatible Cutwork `main` makes this check fail until explicitly supported.
No additional workflow or duplicate renderer gate is needed. This check runs on
relevant 2D PRs and manual dispatch. A Cutwork-only commit does not trigger 2D CI;
writer changes must dispatch this workflow before the updated handoff is declared
supported. To run it locally with a built native library:

```sh
dotnet run --project product/native/tests/Flamoris2D.Session.Tests -c Release -- product/native/tests/source-codec-conformance.json product/native/tests/psd-codec-conformance.json
```

### Writer maintenance rule

Any Cutwork change to `.flimg` schema or writer serialization must regenerate
the current fixture, update its recorded producer SHA/schema/encoder provenance,
and run the 2D compatibility regression before declaring the handoff supported.
Keep the frozen v1 corpus. A new schema stays rejected until 2D explicitly
implements it and adds a matching producer fixture and matrix row. Updating a
fixture is not permission to relax existing preservation assertions.

See [fixture provenance and regeneration](../product/native/tests/fixtures/cutwork/README.md)
for the pinned source and regeneration commands. The recorded fixture protects
that reviewed producer output; current-producer CI establishes compatibility
only with its logged Cutwork SHA. It does not silently claim every later Cutwork
commit is compatible. Normal 2D builds and tests neither fetch Cutwork nor require
an installed Cutwork app.
