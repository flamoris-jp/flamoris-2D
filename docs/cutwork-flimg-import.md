# Cutwork `.flimg` v1/v2 import

Status: implemented for Issue #86

FLAMORIS 2D consumes the documented Cutwork `.flimg` v1 and v2 contracts as external
source art. `.flimg` is not a native Project format and does not replace `.fl2d`
or PSD import.

```text
.flimg archive bytes
  -> CutworkFlimgReader (ZIP / strict JSON / checksum / PNG validation)
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

UI and the headless `import.cutwork_flimg` operation call the same domain
importer. They construct and validate the complete candidate plus render assets
before session replacement, so a failed import leaves the current Project and
history unchanged.

Full re-import/reconciliation, Cutwork editing tools, `.flimg` export, and
future schema migration remain out of scope.
