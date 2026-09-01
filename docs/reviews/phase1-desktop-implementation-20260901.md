# Phase 1 Windows Desktop implementation and manual acceptance

## Implementation coverage

- Electron Desktop Main/Preload shell over the existing Editor Renderer
- native Open for `.fl2d`, `.psd`, and `.png`
- native Save, Save As, Incremental, and Copy semantics
- `.fl2d` file association and Windows second-instance/open handling
- native unsaved-change handling for Project replacement and application close
- app-data Preferences/Recovery storage
- bounded native Recent Files menu
- native File menu and required file shortcuts
- filename, dirty, and Recovered window title
- isolated preload bridge with no Renderer Node integration

The Project model, EditorSession, Query API, commands, transactions,
Undo/Redo, PSD import/re-import, and headless/MCP adapters are unchanged as the
Product mutation authority.

## Run on Windows

From the repository root:

```powershell
npm install
npm test
npm run desktop
```

Optional unpacked Windows build:

```powershell
npm run desktop:pack
```

Optional NSIS installer:

```powershell
npm run desktop:dist
```

## Manual acceptance

1. Start FLAMORIS 2D with `npm run desktop`.
2. Use **File > Import PSD…** and select the Akino PSD.
3. Confirm Scene Tree, stacking, canvas rendering, and Inspector.
4. Rename a node or change Transform and confirm `*` in both editor and window
   title.
5. Use **Save As…** to create `Akino.fl2d`; confirm `*` disappears.
6. Exit, restart, and use **Open…** to open `Akino.fl2d`.
7. Confirm hierarchy, transforms, identity, and Project state match.
8. Edit, press Ctrl+S, and confirm dirty clears.
9. Use **Save Incremental** and confirm `Akino_001.fl2d` is created and becomes
   current. Repeat if a numbered sibling already exists.
10. Edit, use **Save Copy…**, and confirm the window still names the incremental
    file and remains dirty.
11. With a dirty Project, test New, Open, Import PSD, and window Close with Save,
    Don't Save, and Cancel.
12. Create a Recovery snapshot, restart, choose Not Now, and confirm the current
    Project is not dirtied. Restart/restore and confirm `* · Recovered`; save and
    confirm both labels clear.
13. Open the native **Recent Files** submenu. Confirm a deleted entry fails
    safely and is removed.
14. Re-import the Akino PSD, Review and Apply, then confirm whole-operation Undo
    and Redo keep Scene Tree and render assets synchronized.
15. In an Inspector input, confirm Ctrl+Z edits text rather than Project history.
16. Build/install with `npm run desktop:dist`, double-click an `.fl2d`, and
    confirm Windows opens it in the existing or new FLAMORIS 2D process.

Real Akino artwork, Windows dialogs, installer registration, and GPU/Canvas
rendering remain manual because they are staging/OS/visual risks rather than
deterministic Product logic.
