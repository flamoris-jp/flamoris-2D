const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("flamorisDesktop", Object.freeze({
  isDesktop: true,
  openFile: (options) => invoke("desktop:open-file", options),
  openRecent: (filePath) => invoke("desktop:open-recent", { filePath }),
  openExternalProject: (filePath) =>
    invoke("desktop:open-external-project", { filePath }),
  acceptOpenedProject: (filePath) =>
    invoke("desktop:accept-opened-project", { filePath }),
  writeProject: (request) => invoke("desktop:write-project", request),
  beginFrameSequenceExport: (request) =>
    invoke("desktop:begin-frame-sequence-export", request),
  writeFrameSequenceFrame: (request) =>
    invoke("desktop:write-frame-sequence-frame", request),
  endFrameSequenceExport: (request) =>
    invoke("desktop:end-frame-sequence-export", request),
  projectFileExists: (request) =>
    invoke("desktop:project-file-exists", request),
  listSiblingProjectFiles: () =>
    invoke("desktop:list-sibling-project-files"),
  getRecentFiles: () => invoke("desktop:get-recent-files"),
  confirmUnsaved: (details) => invoke("desktop:confirm-unsaved", details),
  clearAssociation: () => invoke("desktop:clear-association"),
  updateWindowState: (state) => ipcRenderer.send("desktop:window-state", state),
  onMenuAction(callback) {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("desktop:menu-action", listener);
    return () => ipcRenderer.removeListener("desktop:menu-action", listener);
  },
  onRequest(callback) {
    const listener = async (_event, request) => {
      try {
        const result = await callback(request.action, request.payload);
        ipcRenderer.send("desktop:response", { id: request.id, result });
      } catch (error) {
        ipcRenderer.send("desktop:response", {
          id: request.id,
          error: error?.message || String(error),
        });
      }
    };
    ipcRenderer.on("desktop:request", listener);
    return () => ipcRenderer.removeListener("desktop:request", listener);
  },
  storage: Object.freeze({
    getItem: (key) => ipcRenderer.sendSync("desktop:storage-get", key),
    setItem: (key, value) =>
      ipcRenderer.sendSync("desktop:storage-set", { key, value }),
    removeItem: (key) => ipcRenderer.sendSync("desktop:storage-remove", key),
  }),
}));
