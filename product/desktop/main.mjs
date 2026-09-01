import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
} from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  documentTitle,
  nextIncrementalFilePath,
  resolveUnsavedDecision,
  updateRecentFiles,
} from "../src/desktop/shell-logic.js";
import {
  atomicWriteFile,
  atomicWriteFileSync,
  exclusiveWriteFile,
} from "../src/desktop/atomic-write.js";

protocol.registerSchemesAsPrivileged([{
  scheme: "flamoris",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}]);

const require = createRequire(import.meta.url);
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const productRoot = resolve(desktopRoot, "..");
const agPsdBundle = resolve(dirname(require.resolve("ag-psd")), "bundle.js");
const allowedStorageKeys = new Map([
  ["flamoris2d.preferences.v1", "preferences.json"],
  ["flamoris2d.recovery.v1", join("recovery", "snapshots.json")],
]);
const maximumStorageBytes = 50 * 1024 * 1024;
const maximumProjectBytes = 100 * 1024 * 1024;

let mainWindow = null;
let closingApproved = false;
let closingInFlight = false;
let recentFiles = [];
let requestCounter = 0;
const pendingRequests = new Map();
const pendingExternalProjects = new Set();
const pendingAssociations = new Set();
const documentState = {
  filePath: null,
  fileName: null,
  displayName: "Untitled",
  dirty: false,
  recovered: false,
};

function stateRoot() {
  return join(app.getPath("userData"), "flamoris-state");
}

function storagePath(key) {
  const relative = allowedStorageKeys.get(key);
  if (!relative) throw new Error("Unsupported desktop storage key.");
  return join(stateRoot(), relative);
}

function readStorage(key) {
  const target = storagePath(key);
  try {
    return readFileSync(target, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeStorage(key, value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximumStorageBytes) {
    throw new Error("Desktop storage value is invalid or too large.");
  }
  const target = storagePath(key);
  mkdirSync(dirname(target), { recursive: true });
  atomicWriteFileSync(target, value);
}

function removeStorage(key) {
  const target = storagePath(key);
  try {
    unlinkSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function recentFilesPath() {
  return join(stateRoot(), "recent-files.json");
}

function loadRecentFiles() {
  try {
    const parsed = JSON.parse(readFileSync(recentFilesPath(), "utf8"));
    return updateRecentFiles(parsed, null, { exists: existsSync });
  } catch {
    return [];
  }
}

function saveRecentFiles() {
  mkdirSync(stateRoot(), { recursive: true });
  atomicWriteFileSync(
    recentFilesPath(),
    JSON.stringify(recentFiles, null, 2),
  );
}

function rememberRecent(filePath) {
  recentFiles = updateRecentFiles(recentFiles, filePath, { exists: existsSync });
  saveRecentFiles();
  installMenu();
}

function forgetMissingRecentFiles() {
  const next = updateRecentFiles(recentFiles, null, { exists: existsSync });
  if (JSON.stringify(next) !== JSON.stringify(recentFiles)) {
    recentFiles = next;
    saveRecentFiles();
    installMenu();
  }
}

function setAssociation(filePath) {
  documentState.filePath = filePath ? resolve(filePath) : null;
  documentState.fileName = filePath ? basename(filePath) : null;
  updateTitle();
}

function updateTitle() {
  const title = documentTitle(documentState);
  mainWindow?.setTitle(title);
}

function assertTrusted(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Untrusted desktop IPC sender.");
  }
}

function safeSuggestedName(value) {
  const raw = basename(String(value || "Untitled.fl2d").trim());
  const name = raw.toLocaleLowerCase().endsWith(".fl2d") ? raw : `${raw}.fl2d`;
  return name === ".fl2d" ? "Untitled.fl2d" : name;
}

function ensureFl2dPath(filePath) {
  return filePath.toLocaleLowerCase().endsWith(".fl2d")
    ? filePath
    : `${filePath}.fl2d`;
}

function associatedDirectory() {
  return documentState.filePath
    ? dirname(documentState.filePath)
    : app.getPath("documents");
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:menu-action", action);
  }
}

function installMenu() {
  const recentSubmenu = recentFiles.length
    ? recentFiles.map((filePath) => ({
      label: basename(filePath),
      sublabel: filePath,
      click: () => sendMenuAction({ type: "open-recent", filePath }),
    }))
    : [{ label: "No Recent Files", enabled: false }];
  const template = [{
    label: "File",
    submenu: [
      { label: "New", accelerator: "Ctrl+N", click: () => sendMenuAction("new") },
      { label: "Open…", accelerator: "Ctrl+O", click: () => sendMenuAction("open") },
      { label: "Recent Files", submenu: recentSubmenu },
      { type: "separator" },
      { label: "Save", accelerator: "Ctrl+S", click: () => sendMenuAction("save") },
      { label: "Save As…", accelerator: "Ctrl+Shift+S", click: () => sendMenuAction("save-as") },
      { label: "Save Incremental", click: () => sendMenuAction("save-incremental") },
      { label: "Save Copy…", click: () => sendMenuAction("save-copy") },
      { type: "separator" },
      { label: "Import PSD…", click: () => sendMenuAction("import-psd") },
      { label: "Re-import PSD…", click: () => sendMenuAction("reimport-psd") },
      { type: "separator" },
      { label: "Preferences…", click: () => sendMenuAction("preferences") },
      { type: "separator" },
      { label: "Exit", click: () => mainWindow?.close() },
    ],
  }, {
    label: "Edit",
    submenu: [
      { label: "Undo", click: () => sendMenuAction("undo") },
      { label: "Redo", click: () => sendMenuAction("redo") },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function rendererRequest(action, payload = null, timeoutMs = 60_000) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.reject(new Error("The editor window is not available."));
  }
  const id = ++requestCounter;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      rejectRequest(new Error("The editor did not answer the desktop request."));
    }, timeoutMs);
    pendingRequests.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolveRequest(value);
      },
      reject(error) {
        clearTimeout(timer);
        rejectRequest(error);
      },
    });
    mainWindow.webContents.send("desktop:request", { id, action, payload });
  });
}

async function askUnsavedChoice() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Unsaved Changes",
    message: "現在のProjectには保存されていない変更があります。",
    detail: "終了またはProjectの置換前に保存しますか？",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return ["save", "discard", "cancel"][response] || "cancel";
}

async function handleWindowClose() {
  try {
    const latest = await rendererRequest("get-document-state", null, 5_000);
    if (typeof latest?.dirty === "boolean") documentState.dirty = latest.dirty;
    if (typeof latest?.recovered === "boolean") {
      documentState.recovered = latest.recovered;
    }
  } catch {
    // Fall back to the last pushed state if the Renderer is already unavailable.
  }
  const choice = documentState.dirty ? await askUnsavedChoice() : "discard";
  let saveSucceeded = false;
  if (choice === "save") {
    try {
      saveSucceeded = Boolean(await rendererRequest("save"));
    } catch {
      saveSucceeded = false;
    }
  }
  const decision = resolveUnsavedDecision({
    dirty: documentState.dirty,
    choice,
    saveSucceeded,
  });
  if (!decision.proceed) return;
  closingApproved = true;
  mainWindow?.close();
}

function fileDialogFilters(purpose) {
  if (purpose === "import-psd" || purpose === "reimport-psd") {
    return [{ name: "Adobe Photoshop", extensions: ["psd"] }];
  }
  return [
    { name: "FLAMORIS 2D / Source", extensions: ["fl2d", "psd", "png"] },
    { name: "FLAMORIS 2D Project", extensions: ["fl2d"] },
    { name: "Adobe Photoshop", extensions: ["psd"] },
    { name: "PNG Image", extensions: ["png"] },
  ];
}

async function filePayload(filePath) {
  const extension = extname(filePath).toLocaleLowerCase();
  if (extension === ".fl2d") {
    return {
      name: basename(filePath),
      filePath,
      mimeType: "application/x-flamoris-2d+json",
      contents: await readFile(filePath, "utf8"),
    };
  }
  const mimeType = extension === ".psd"
    ? "image/vnd.adobe.photoshop"
    : "image/png";
  return {
    name: basename(filePath),
    filePath,
    mimeType,
    bytes: new Uint8Array(await readFile(filePath)),
  };
}

async function openProjectPath(filePath) {
  const absolute = resolve(filePath);
  if (extname(absolute).toLocaleLowerCase() !== ".fl2d") {
    throw new Error("Only .fl2d projects can be opened from this list.");
  }
  if (!existsSync(absolute)) {
    recentFiles = recentFiles.filter((entry) => resolve(entry) !== absolute);
    saveRecentFiles();
    installMenu();
    throw new Error("The project file no longer exists.");
  }
  const payload = await filePayload(absolute);
  pendingAssociations.add(absolute);
  return payload;
}

async function handleWriteProject(request) {
  const operations = new Set(["save", "save-as", "save-incremental", "save-copy"]);
  const operation = String(request?.operation || "");
  if (!operations.has(operation)) throw new Error("Unsupported save operation.");
  if (typeof request?.contents !== "string" ||
      Buffer.byteLength(request.contents) > maximumProjectBytes) {
    throw new Error("Project data is invalid or too large.");
  }
  const suggestedName = safeSuggestedName(request.suggestedName);
  let target = null;
  let effectiveOperation = operation;
  if (operation === "save" && documentState.filePath) {
    target = documentState.filePath;
  } else if (operation === "save-incremental") {
    const directory = associatedDirectory();
    const existingFileNames = await readdir(directory).catch(() => []);
    target = documentState.filePath
      ? nextIncrementalFilePath({
        currentFilePath: documentState.filePath,
        directory,
        suggestedName,
        existingFileNames,
      })
      : join(directory, suggestedName);
    if (!documentState.filePath && existsSync(target)) {
      target = nextIncrementalFilePath({
        directory,
        suggestedName,
        existingFileNames,
      });
    }
  } else {
    if (operation === "save") effectiveOperation = "save-as";
    const defaultPath = join(associatedDirectory(), suggestedName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: effectiveOperation === "save-copy"
        ? "Save Copy"
        : "Save FLAMORIS 2D Project",
      defaultPath,
      filters: [{ name: "FLAMORIS 2D Project", extensions: ["fl2d"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = ensureFl2dPath(result.filePath);
  }

  const allowOverwrite = effectiveOperation !== "save-incremental";
  try {
    if (allowOverwrite) await atomicWriteFile(target, request.contents);
    else await exclusiveWriteFile(target, request.contents);
  } catch (error) {
    if (error.code === "EEXIST" && effectiveOperation === "save-incremental") {
      return handleWriteProject(request);
    }
    throw error;
  }

  if (effectiveOperation !== "save-copy") {
    setAssociation(target);
    rememberRecent(target);
  }
  return { canceled: false, fileName: basename(target), filePath: target };
}

function projectArgument(argv) {
  return argv.find((value) =>
    typeof value === "string" &&
    isAbsolute(value) &&
    value.toLocaleLowerCase().endsWith(".fl2d") &&
    existsSync(value));
}

function queueExternalProject(filePath) {
  if (!filePath) return;
  const absolute = resolve(filePath);
  pendingExternalProjects.add(absolute);
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendMenuAction({ type: "open-external", filePath: absolute });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function registerIpc() {
  ipcMain.handle("desktop:open-file", async (event, options) => {
    assertTrusted(event);
    const purpose = ["open", "import-psd", "reimport-psd"].includes(options?.purpose)
      ? options.purpose
      : "open";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: purpose === "open" ? "Open" : "Select PSD",
      defaultPath: associatedDirectory(),
      properties: ["openFile"],
      filters: fileDialogFilters(purpose),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const extension = extname(filePath).toLocaleLowerCase();
    if (purpose !== "open" && extension !== ".psd") {
      throw new Error("A .psd file is required.");
    }
    const payload = await filePayload(filePath);
    if (purpose === "open" && extension === ".fl2d") {
      pendingAssociations.add(resolve(filePath));
    }
    return payload;
  });

  ipcMain.handle("desktop:accept-opened-project", async (event, { filePath } = {}) => {
    assertTrusted(event);
    const absolute = resolve(String(filePath || ""));
    if (!pendingAssociations.delete(absolute)) {
      throw new Error("This project was not selected by the desktop shell.");
    }
    setAssociation(absolute);
    rememberRecent(absolute);
    return true;
  });

  ipcMain.handle("desktop:open-recent", async (event, { filePath } = {}) => {
    assertTrusted(event);
    const absolute = resolve(String(filePath || ""));
    if (!recentFiles.some((entry) => resolve(entry) === absolute)) {
      throw new Error("This path is not in Recent Files.");
    }
    return openProjectPath(absolute);
  });

  ipcMain.handle("desktop:open-external-project", async (event, { filePath } = {}) => {
    assertTrusted(event);
    const absolute = resolve(String(filePath || ""));
    if (!pendingExternalProjects.delete(absolute)) {
      throw new Error("This project was not requested by Windows.");
    }
    return openProjectPath(absolute);
  });

  ipcMain.handle("desktop:write-project", async (event, request) => {
    assertTrusted(event);
    return handleWriteProject(request);
  });

  ipcMain.handle("desktop:project-file-exists", async (event, request) => {
    assertTrusted(event);
    const name = safeSuggestedName(request?.fileName);
    return existsSync(join(associatedDirectory(), name));
  });

  ipcMain.handle("desktop:list-sibling-project-files", async (event) => {
    assertTrusted(event);
    return (await readdir(associatedDirectory()).catch(() => []))
      .filter((name) => name.toLocaleLowerCase().endsWith(".fl2d"));
  });

  ipcMain.handle("desktop:get-recent-files", async (event) => {
    assertTrusted(event);
    forgetMissingRecentFiles();
    return [...recentFiles];
  });

  ipcMain.handle("desktop:confirm-unsaved", async (event) => {
    assertTrusted(event);
    return askUnsavedChoice();
  });

  ipcMain.handle("desktop:clear-association", async (event) => {
    assertTrusted(event);
    setAssociation(null);
    return true;
  });

  ipcMain.on("desktop:window-state", (event, value) => {
    assertTrusted(event);
    documentState.fileName = typeof value?.fileName === "string"
      ? basename(value.fileName).slice(0, 260)
      : documentState.fileName;
    documentState.displayName = typeof value?.displayName === "string"
      ? value.displayName.slice(0, 260)
      : "Untitled";
    documentState.dirty = value?.dirty === true;
    documentState.recovered = value?.recovered === true;
    updateTitle();
  });

  ipcMain.on("desktop:response", (event, response) => {
    assertTrusted(event);
    const pending = pendingRequests.get(response?.id);
    if (!pending) return;
    pendingRequests.delete(response.id);
    if (response.error) pending.reject(new Error(response.error));
    else pending.resolve(response.result);
  });

  ipcMain.on("desktop:storage-get", (event, key) => {
    assertTrusted(event);
    event.returnValue = readStorage(key);
  });
  ipcMain.on("desktop:storage-set", (event, { key, value } = {}) => {
    assertTrusted(event);
    writeStorage(key, value);
    event.returnValue = true;
  });
  ipcMain.on("desktop:storage-remove", (event, key) => {
    assertTrusted(event);
    removeStorage(key);
    event.returnValue = true;
  });
}

async function registerProductProtocol() {
  await protocol.handle("flamoris", (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Not found", { status: 404 });
    const pathname = decodeURIComponent(url.pathname);
    let target;
    if (pathname === "/vendor/ag-psd.js") {
      target = agPsdBundle;
    } else {
      target = resolve(productRoot, `.${pathname}`);
      if (target !== productRoot && !target.startsWith(`${productRoot}${sep}`)) {
        return new Response("Forbidden", { status: 403 });
      }
    }
    if (!existsSync(target)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "FLAMORIS 2D",
    webPreferences: {
      preload: join(desktopRoot, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith("flamoris://app/")) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (closingApproved) return;
    event.preventDefault();
    if (closingInFlight) return;
    closingInFlight = true;
    handleWindowClose().finally(() => { closingInFlight = false; });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL("flamoris://app/index.html");
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => queueExternalProject(projectArgument(argv)));
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    queueExternalProject(filePath);
  });
  app.whenReady().then(async () => {
    app.setName("FLAMORIS 2D");
    recentFiles = loadRecentFiles();
    installMenu();
    registerIpc();
    await registerProductProtocol();
    await createWindow();
    const initialProject = projectArgument(process.argv);
    if (initialProject) pendingExternalProjects.add(resolve(initialProject));
    for (const filePath of pendingExternalProjects) {
      sendMenuAction({ type: "open-external", filePath });
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
