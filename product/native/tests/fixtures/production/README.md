# Native production test fixtures

These four fixed, synthetic fixtures replace the output side effects of the
retired JavaScript `native-render-projection` and `native-source-host` tests.
They are test inputs only. The editor and Windows package do not include them.

- `production-render-projections.json`: five evaluated frames from the Phase 8
  production proof at ticks 0, 150000, 350000, 450000 and 599999. The fixed render
  plans preserve transitions, dual appearances, clipping, nested Warp, Bone,
  form correction, animation and camera evaluation. They were recovered from
  the reference implementation at commit `741b0170eada23cb612e31dcbf2741c657a0b31e`.
- `production-render-textures.json`: the proof's 13 part textures, each a 2x2
  straight-BGRA raster with opaque, translucent and transparent pixels.
- `native-production-source.psd`: a 64x64 RGB PSD with one layer (ID 12,
  `Production part`) containing the same synthetic 48x48 gradient and circular
  alpha as the former generator, positioned at (8, 8). Stored channels use raw
  PSD compression rather than the former writer's RLE; decoded pixels match.
- `native-production-source.flimg`: the former Cutwork sample with a white 2x2
  original, an `eye_left` part mask and a base layer. Raster content and manifest
  semantics match the former generator; ZIP and PNG encoding may differ.

The artwork is procedural test data, with no private acceptance artwork or
third-party assets. These fixtures are distributed under the repository's
Apache-2.0 license.

CI copies all four inputs to `out/render-fixtures` before testing, leaving the
committed inputs intact. `FLAMORIS_RENDER_FIXTURE_DIR` points to that writable
directory for both the native renderer comparison and packaged WPF production
smoke. A missing input fails staging immediately; neither check is skipped.

For local Windows validation, copy these four files to a writable directory and
set `FLAMORIS_RENDER_FIXTURE_DIR` to that directory before running the native
client tests and `Flamoris2D.exe --smoke-test`.
