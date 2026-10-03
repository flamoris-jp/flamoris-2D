# Cutwork `.flimg` v1/v2 import

Status: implemented for Issue #86

FLAMORIS 2D consumes the documented Cutwork `.flimg` v1 and v2 contracts as external
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
`flamoris-cutwork/docs/flimg-schema-v2.md`. Cutwork currently writes v2; old
v1 archives remain readable. Unknown versions fail explicitly.

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
