# ADR 0012: Native document and session cutover

Status: implemented and merged for #118/#142. Real-art Windows acceptance
remains separate. Supersedes ADR 0006's runtime authority.

The C++ session owns Project validation, commands, queries, history, revision,
schema migration and `.fl2d` serialization. WPF owns dialogs, same-directory atomic
writes and immutable decoded artwork. A document is parsed and validated as a
candidate before replacing the live session. A failed open leaves the live
Project, history and artwork unchanged.

The existing format version 1 and Project schema 15 remain unchanged. Native
persistence ports schemas 1–14, including rejection of incompatible schema 14
reserved tracks. The document envelope retains embedded PNG assets and identity
metadata. Save serializes the authoritative revision; successful filesystem
completion acknowledges that revision. Copy and recovery do not mark clean.

WPF and MCP must share one serialized native session lane. MCP Core continues to
own its transport, capabilities and permission checks. Preparation is separate
from commit so cancellation and revision guards are rechecked before mutation.
No mutable C# Project/history implementation or second MCP session is introduced.

C++ produces evaluated render batches, camera projection and the clipping alpha
surface dependency plan. WPF applies only viewport/DPI/output-resolution mapping
and hands immutable textures to the existing native D3D11 backend. Gesture
previews query a disposable native prepared candidate; they never replace or
commit the live Project while a pointer is moving.

Source decoders produce immutable candidates; source conversion/reconciliation
and typed commits belong to C++. Retained artwork follows native source history.
Production packaging excludes Product Host and Node. The full Windows packaged
workflow remains its automated acceptance gate. The old JS oracle, Electron
shell and Product Host source were removed in #146 after physical Windows launch.
They are not production fallbacks or editing authorities.

Windows visual/DPI/input/artwork acceptance remains human work. Code completion
must not claim that those checks were performed.

Mesh UI intent compilation, Grid and Contour AutoMesh are native readonly operations. The compiler produces ordinary transactions, never a second authority. Layout and topology contexts, stable global vertex IDs, keyform ownership, locked/hidden admission and explicit replacement remain the existing Product rules. Raster generation uses immutable RGBA8 inputs; cancellation and revision checks happen before apply. Native bounds replace the old worker termination safeguard: 262,144 contour edges, 16,384 boundary vertices, 32,768 support points and 50 million geometry work steps. Exceeding these limits reports an error and never changes the document.

Rig projections and UI intent compilation also execute in C++. The existing native FK/Warp/IK evaluators supply document-to-authoring coordinates, including analytic inverse bilinear Warp cages and the pose frame before the selected local delta. Bone rest/pose, explicit mirror pairs, rigid/skin bindings, weights, clipping, Warp lattices and form corrections compile to the existing typed transactions. Temporary previews query a validated candidate and do not edit live Project/history.
