# Native Product capability map

Status: unified C++ production candidate for #118/#142. Final Windows CI and
physical artwork/interaction acceptance remain gates; implementation evidence
below is not a claim that human acceptance or installer release has passed.

## One editing authority

WPF `MainWindow` → `NativeSessionClient` → `NativeWorkspace` → C++ `NativeSession`.
`NativeMcpHost` enters that exact workspace lane. C++ owns Project, validation,
commands, transactions, revision identities and Undo/Redo. C# owns dialogs,
atomic OS writes, immutable raster capabilities, projections and UI state.

All 155 existing command handlers and 72 readonly Product queries have native
implementations. Additional `native.*` queries compile UI intent, preview
prepared candidates and produce render/export plans. JSON is interchange and
inspection, never an independently editable C# Project.

## Implementation and evidence

Paths below are relative to `product/native/`. JS conformance generators and
fixtures under `tests/` remain a development-only oracle; production does not
load JS, fixture files, Node, Product Host or Electron.

| Capability | Production owner | Regression evidence |
| --- | --- | --- |
| Project/stable IDs/validation | `core/src/project_snapshot.cpp`, `native_validation.h` | `core_tests`; Project conformance/admission fixtures |
| Typed commands/transactions, prepared commits, revision, Undo/Redo | `core/src/editor_session.cpp`, `native_commands.cpp` and domain command units | Session/rig/hierarchy/temporal/transition/mesh/source conformance in `core_tests` |
| Readonly queries, exact ticks and locale lists | `core/src/native_queries.cpp`, native evaluators, pinned ICU | Query conformance in `core_tests` |
| `.fl2d` format-v1, schemas 1–14 → 15, asset envelopes | `core/src/native_document.cpp`, `Core.Interop/NativeDocument.cs` | `document_tests`; managed document round-trip/failure tests |
| Atomic save/receipts, dirty state, Recovery and Preferences | `Session/NativeWorkspace.cs`, `Native.Client/DocumentClient.cs`, `AtomicDocumentFile.cs`, recovery/preferences adapters | `Session.Tests`; `Native.Client.Tests/DocumentTests.cs` |
| PSD/PSB, `.flimg` v1/v2, PNG raster decode | `Source.Codecs/`; immutable decoded candidates | `Source.Codecs.Tests`; PSD and source-codec fixtures |
| Source conversion, reviewed reimport and source-art history | `core/src/native_source.cpp`, `native_source_review.cpp`; `Session/NativeWorkspace.SourceReview.cs` | `source_tests`; `Session.Tests` reimport/Undo/Redo/save/reopen |
| Mesh Layout/Structure, Grid/Contour, correspondence | `core/src/native_mesh_authoring.cpp`, `native_mesh_generation.cpp`, `native_key_state_authoring.cpp` | Mesh/Key State authoring conformance/tests; managed workflow |
| Bone/FK/IK, rigid/Skin, Warp, weights and form correction | `core/src/native_rig_authoring.cpp`, `native_rig_evaluation.cpp`; domain commands | Rig conformance/authoring tests; managed preview and shared history |
| Key Arts, Transition modes/diagnostics and mapping | `core/src/native_key_state_authoring.cpp`, `native_transition_evaluation.cpp` | Key State/frame query fixtures |
| Sequence/Clip/Track/Keys, canonical 120000 ticks/s, playback | `core/src/native_timeline_authoring.cpp`, temporal/sequence evaluation | Timeline authoring/session/query fixtures |
| Preview, masks, clipping and compositing | `core/src/native_render_plan.cpp`, `renderer/src/d3d11_renderer.cpp` | Render-plan conformance; Windows hardware/WARP smoke |
| PNG/MP4 export planning and frame semantics | `core/src/native_export_authoring.cpp`; `Native.Client` PNG/FFmpeg adapters | Export-authoring fixtures; managed tests; Windows 240-frame/H.264 smoke |
| Existing WPF tools/panels/gestures | `src/Flamoris2D.App/`; typed `Native.Client` adapters | Native desktop authority tests; packaged WPF workflow |
| Live MCP, permissions, guards, cancellation/revocation | `Session/NativeMcpHost.cs`; `Native.Client/McpClient.cs`; MCP Core/Wpf 1.2.0 | Session and desktop authority tests; Windows bridge transport tests |
| Native-only portable package | explicit App/Bridge project graph; `../packaging/publish-windows.ps1` | Package boundary test plus published launch without developer runtimes |

## Limits and remaining acceptance

Encoded documents remain bounded to 128 MiB; raster/source residency to the
existing 512 MiB policy. Native contour generation also has explicit work/edge
bounds (ADR 0012). Expanded limits require measured evidence. No format/schema
or timebase change is part of renovation.

Human Windows acceptance covers real FLAMORIS PSD/`.flimg`/`.fl2d`, reopen and
reimport, dense meshes/rigs/timelines, DPI 100/125/150/200%, pointer feel, GPU and
playback, paths/dialogs, manual external MCP and PNG/MP4 visual output. Installer,
signing, update/uninstall and default association remain a separate release decision.
The portable application does not modify an existing installed association.

Legacy JS/Electron/Host code remains available for compatibility/reference only
until the relevant parity and Windows evidence permits deletion. It receives no
new production responsibilities and is never a native runtime fallback.

See [renovation map](repository-renovation.md), [ADR 0012](decisions/0012-native-session-cutover.md),
[production guide](native-production-workflow.md) and
[historical #96 evidence](../history/migrations/issue-96-host-capability-map.md).
