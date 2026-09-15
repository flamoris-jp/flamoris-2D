# ADR 0008: Native evaluated renderer selection

Status: accepted for implementation under the Issue #96 instruction; PR review and final native workflow acceptance remain open.

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

## Decision and measured evidence

Select Direct3D 11 with a hardware device and explicit WARP fallback if hardware device
creation fails. Use one shared evaluated renderer for native preview and export. Keep
the software implementation as a conformance reference, not an interactive fallback.
On device loss, stop rendering with a diagnostic; do not silently save altered content.
Electron remains available until the full migration retirement conditions are satisfied.

Windows runner measurements at commit `0c7824c8959d168cb5d682f2f6f939a70337c412`:
[Windows boundary run](https://github.com/flamoris-jp/flamoris-2D/actions/runs/34968321565).
1920×1080 output, 720 evaluated triangles, 13 synthetic 512×512 textures. The canonical
production fixture includes nested Warp, rigid Bone, rotation constraints, form correction,
animation, two appearances, clipping and camera. Test-only subdivision increases geometry
density after evaluation; it is not a new mesh topology in Product. Skin is separately
covered by Product/Host conformance and the integrated native eight-second workflow below.

| Candidate | Time including composition and CPU readback | Notes |
| --- | --- | --- |
| Software C# | 816.89 ms, one representative frame | Too slow for interaction; reference only |
| D3D11 WARP | median 25.34 ms, max 27.63 ms, five warm samples | Hardware-independent fallback |
| D3D11 hardware device | median 27.08 ms, max 28.40 ms, five warm samples | Runner device; not a claim about a user's physical GPU |

WARP and hardware matched the software reference to mean absolute channel error 0.0006
on a 0–255 scale. Maximum isolated edge error was 255; the fraction above 2 was below
0.00005% (rounded to 0.0000% in logs). Rasterizer subpixel edge rules differ, so do not
claim bit-exact parity. Five original 64×64 frames had maximum channel errors 1–2 and
mean errors 0.0020–0.0037. Reference edge and weighted-alpha tests also passed.

Observed process working sets were 372.0 MiB after WARP and 429.3 MiB with both D3D devices
alive. These are snapshots, not measured peak or admission guarantees. The 512 MiB
composition admission limit remains separate from asset/document and runtime allocations.
Warm timings exclude Host evaluation, initial decode/upload and WPF composition; the
viewport reports its measured frame path separately. The packaged Windows workflow now
passes PSD -> Mesh -> Bone/Skin -> Warp -> form correction + MeshDeformation -> eight-second
Sequence -> Preview -> 240 PNGs and H.264 -> atomic Save -> Open/resumed Undo -> reviewed PSD
update -> Key State/Transition -> Cutwork. One recorded run is
[34979394655](https://github.com/flamoris-jp/flamoris-2D/actions/runs/34979394655).
It launches the self-contained candidate with developer Node/.NET absent from PATH and
checks actual ffprobe output (H.264, 240 decoded frames, eight seconds).
Final acceptance still needs physical DPI, representative user artwork, and actual-device
visual/interaction review. This decision does not close #98 or approve Electron retirement.


## Authoring preview ownership

A Layout drag submits a disposable `mesh_keyform.move_vertices` preview through the
existing EditorSession command validation and draft preparation. Its callback evaluates
that draft with the ordinary Product evaluator. It does not install another session,
change revision/dirty state, push history or keep a draft Project in C#. Mouse release
submits the ordinary command once. Token/revision/context/gesture identity reject stale
frames; cancel removes only transient presentation. Topology is never previewed as Deform.

Bone/Warp/form-correction gesture previews use the same command-draft path. Existing
Product authoring-space helpers project/unproject nested Warp and Bone handles; C# does
not invert deformation fields or evaluate rig state. Source picking reads evaluated
triangles/draw order, with geometric overlap cycling; it is not alpha-mask pixel picking.

Preview raster presentation is bounded to a 2048-pixel long edge, preserving the original
document extent for camera/picking. Export uses the canonical canvas-to-output mapping
with at most 4096 pixels per edge / 8294400 pixels; H.264 requires even dimensions.
Both use the same D3D11 compositor. Native runtime assembly uses the reviewed Host/worker
allowlist and excludes tests, private artwork, Electron and DOM view modules.
