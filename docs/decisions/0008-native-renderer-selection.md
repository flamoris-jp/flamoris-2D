# ADR 0008: Native evaluated renderer selection

Status: proposed; candidate implementation and measurement only. Not final renderer authority.

Parent #96; decision/proof #98. Existing evaluator order/time/mesh semantics are preserved.

## Comparison contract

Both candidates consume `createEvaluatedRenderPlan` and the Product-generated clipping
raster dependency order. Neither evaluates Project, Bone, Warp, Skin or animation.
Native input and overlay remain WPF. Preview and export must share the selected backend.

Candidate S: bounded C# software triangle rasterization with premultiplied-texture bilinear
sampling, weighted-premultiplied appearance mixing, resolved alpha clipping, weighted
composite groups, source-over output and a WPF bitmap presenter.

Candidate D: Direct3D 11 shaders and offscreen BGRA targets, with WPF bitmap presentation.
Vortice.Direct3D11/D3DCompiler 3.8.3 bindings (MIT) wrap Windows D3D11 and the system
shader compiler; no browser or new domain model. Compare hardware and WARP explicitly.
Both implement linear sampling of premultiplied textures, two independently mapped UV
sets, alpha masks and additive weighted groups. CPU readback is included in measurements.
Reference: [binding source/version](https://github.com/amerkoleci/Vortice.Windows/blob/main/Directory.Build.props),
[device contract](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-d3d11createdevice). A WPF render tier value or fast bitmap blit alone is not a
comparison of rendering backends and cannot be used to accept this ADR.

Measure representative production sizes/mesh density, multiple appearances, clipping,
Warp/Bone/Skin/form correction, camera, playback and DPI. Record timings and allocation
budgets separately from human visual acceptance. Use synthetic shareable artwork with
existing Product production-shot evaluation fixtures. Never package benchmark fixtures
as editor bootstrap. Disqualify an incomplete candidate explicitly; do not call it parity.

No renderer has been accepted yet. Electron remains the release backend. Candidate code
may support measurement and semantic conformance, but cannot be represented as a final
native compositor until #98's comparison/evidence requirement is met.
