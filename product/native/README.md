# FLAMORIS 2D native shell foundation

This directory contains the Phase 1 .NET 10 / WPF shell and its typed Product Host client.
The existing JavaScript Product remains the only persistent editing authority.

## Build and smoke proof

Prerequisites:

- Windows 10/11;
- .NET 10 SDK; and
- Node.js 24 (or set `FLAMORIS_NODE_PATH` to the reviewed Node executable).

```powershell
dotnet build product/native/Flamoris2D.Native.sln -c Release
dotnet run --project product/native/tests/Flamoris2D.ProductHost.Client.Tests -c Release --no-build -- product/product-host/main.mjs
dotnet run --project product/native/src/Flamoris2D.App -c Release --no-build -- --smoke-test
dotnet run --project product/native/src/Flamoris2D.App -c Release
```

The app project copies the reviewed Product Host entry and its JavaScript Product graph under
`ProductHost/` in the output directory. Phase 1 does not yet bundle `node.exe`, claim the
`.fl2d` file association, replace the Electron release, or implement native Save/Open.

## Authority boundary

```text
WPF gesture
  -> typed Product Command / Transaction
  -> framed Product Host request
  -> one JavaScript EditorSession
  -> Project / history
```

WPF retains only editing-context workspace state and revision-tagged projections. A host exit
clears the document token and projected Parts/Objects, disables mutation, and shows the restart
surface. It never serializes the projection as a substitute Project.

## Manual Windows pass

Run the app normally and verify:

1. menu/window keyboard focus follows Windows conventions;
2. Ctrl+1 through Ctrl+7 switches Source, Mesh, Rig, Deform, Animation, Preview, Export;
3. only Animation allocates the bottom Timeline surface;
4. left active tool, top tool meaning, right target selection, and Properties remain distinct;
5. renaming a selected target runs a Product Command and Undo/Redo follows Product history;
6. ending the Product Host process clears projected state and disables editing;
7. restart creates a new authoritative Phase 1 session and does not claim recovery of the lost one.

Full document recovery, native rendering, import, Save/Open, packaging of the Node runtime, and
Electron retirement are intentionally later phases.
