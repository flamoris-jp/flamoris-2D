# Repository renovation (#142)

## Baseline and reuse

Reviewed baseline: `17ef746d` (PR #140). The existing candidate in PR #141
(`c55d1d11`) already ports persistence, source reconciliation, UI intent
compilation and the WPF/MCP session lane. Renovation continues that candidate;
it does not add a parallel core. Candidate changes remain subject to PR review.

## Responsibility map

| Location | Disposition | Responsibility |
| --- | --- | --- |
| `product/native/core/` | Keep | C++ Project/session, commands, queries, history, validation, persistence, source conversion/reconciliation, authoring, evaluation and render plans |
| `product/native/renderer/` | Keep | C++ D3D11 compositor, textures and readback |
| `product/native/src/Flamoris2D.Core.Interop/` | Keep | Opaque native handles, C ABI and immutable JSON interchange |
| `product/native/src/Flamoris2D.Session/` | Adapt | One serialized native session lane; immutable artwork capabilities, save receipts and MCP adapter |
| `product/native/src/Flamoris2D.Source.Codecs/` | Keep | Bounded PSD, `.flimg` and raster decoding to immutable candidates; no editable Project |
| `product/native/src/Flamoris2D.Native.Client/` | Adapt | Typed WPF client, projection guards, filesystem/encoder adapters and MCP lifecycle on the same workspace |
| `product/native/src/Flamoris2D.App/` | Adapt | Existing WPF UI, gestures, dialogs and transient selection/playhead |
| `product/native/src/Flamoris2D.Rendering/` | Keep | Serialized C++ renderer interop; viewport/output mapping |
| `product/native/src/Flamoris2D.Bridge/` | Keep | Shared MCP Core stdio/named-pipe transport; no document/session ownership |
| `product/packaging/` | Adapt | Native-only package allowlist and packaged launch check |
| `product/native/tests/` | Keep | Native/managed tests and deterministic compatibility fixtures |
| `product/src/`, `product/product-host/`, `product/desktop/`, `product/index.html` | Legacy reference | JS model/session, controllers, Host and Electron/browser shell; no production inputs or feature development |
| `product/native/src/Flamoris2D.ProductHost.Client/`, `product/native/tests/Flamoris2D.ProductHost.Client.Tests/` | Legacy reference | Previous IPC client/tests; excluded from native solution and package |
| `product/tests/`, `product/scripts/`, npm manifests | Compatibility tests | Old JS oracle and package-boundary checks, development only |
| `staging/`, `test/`, `history/` | Preserve boundaries | Acceptance fixtures, integration tests and historical material; never runtime dependencies |

Keep legacy source at its existing paths until physical Windows acceptance: moving
its entire relative-import graph adds no authority separation and risks losing
the compatibility oracle. `product/LEGACY.md` marks that boundary. The production
solution's project references and native packaging inputs enforce separation.
Delete legacy implementations only after their parity and artwork evidence passes.

## Authority and lifetime

`MainWindow` owns one `NativeSessionClient`, which owns one `NativeWorkspace`.
WPF calls and `NativeMcpHost` enter that workspace's serialized lane. Its one
`NativeSession` owns editable Project, native history and revision identities.
Prepared edits/preview candidates are disposable and cannot create a live second
authority. JSON projections and decoded raster snapshots are immutable interchange.
Managed artwork retention follows native revision identities; it cannot undo or
redo independently of C++ history.

The workspace revision is a monotonic attachment/guard revision; native
`currentRevision` identifies the selected history/save state. Neither is a
second editable Project. MCP Core owns capabilities, permissions and revocation;
document replacement revokes attachment to the old document.

## Remaining work and verification

1. Audit the candidate's session, receipts, assets and shared MCP lifetime.
2. Fix missing behavior rather than repeating completed ports.
3. Replace stale current-authority documentation (README, native README,
   capability map, status, roadmap, MCP, repository boundaries and migration ADRs).
4. Run native/managed builds and focused checks while making fixes.
5. At the unified-path milestone run all native conformance, source/managed
   session tests, JS oracle regression and the available package boundary checks.
6. Windows CI proves WPF/D3D11 build, named-pipe transport and packaged smoke.
   Human acceptance still covers actual artwork, DPI, pointer feel, GPU/playback,
   file dialogs, manual external MCP and PNG/MP4 visual output.

No schema/timebase/stable-ID redesign, UI redesign or new repository is needed.
Retain format-v1 `.fl2d`, schema 15 and 120000 ticks/second. ADR 0012 specifies
the cutover; older Host-shell ADRs describe the previous architecture.
