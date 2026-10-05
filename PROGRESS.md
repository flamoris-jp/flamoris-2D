# FLAMORIS 2D — Production acceptance progress

Updated: 2026-10-06 (JST).

## Current checkpoint

Baseline: `e556d7b` on `main`. Source → Mesh → Rig → Deform → Animation →
Preview → Export is implemented in the native candidate. WPF and MCP share
one C++ NativeSession. The old JavaScript/Electron/Product Host source has
already been removed. Open #96/#97/#98 are acceptance gates, not a request
to repeat the migration.

Accepted production choices:

- Recovery cleanup stays scoped to the captured document and lineage.
- Save As associates the successful destination; Save Copy preserves the
  current path, dirty state and Recovery.
- Preserve existing production capabilities; refine UI from actual use.
- Choose technical changes from current design and measured evidence.

## This pass

| Work | State |
| --- | --- |
| Current main, Issue comments and native capability audit | Complete |
| Save / Recovery contract review | Found #154: save capture expires after one minute instead of ten; retained captures lack the accepted admission cap |
| Fix #154 and focused regression tests | In progress |
| Artwork preservation / source ownership review | In progress |
| Native C++ and portable managed regressions | In progress |
| Independent review and Windows package CI | Pending |
| Reconcile historical Issue bodies with the current native candidate | In progress |

## Remaining physical acceptance

Use the [native production guide](docs/native-production-workflow.md) with
an actual approximately eight-second FLAMORIS shot on Windows.

1. Import a real PSD or Cutwork `.flimg`, create/edit mesh, rig, deformation
   and animation, and exercise representative Undo/Redo.
2. Save, close, restart, reopen and continue editing; inspect retained artwork
   and motion, then test a reviewed PSD reimport.
3. Check Recovery restore/dismiss/scoped discard, Save As/Copy/incremental,
   cancellation/failure and isolation between two projects.
4. Compare Preview, representative PNG frames and the actual H.264 MP4 in a
   normal player. Check cancellation, output conflicts and continued editing.
5. Check 100/125/150/200% DPI, pointer capture/cancel, focus/shortcuts, dense
   mesh/rig/timeline, GPU/playback and the actual file destinations.
6. Connect an external MCP client and confirm shared editing/history,
   read-only rejection and old connection-key revocation.

Record results in #78 and focused defects via #81. #97 covers document /
Recovery acceptance, #98 artwork / renderer acceptance, #96 the end-to-end
native workflow, and #79 the Internal Beta checkpoint. Automated regressions
and package smoke do not claim human artwork/DPI/GPU acceptance.

FFmpeg redistribution #149 and installer/signing/update/file association
remain separate release work.
