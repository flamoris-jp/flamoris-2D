import test from "node:test";
import assert from "node:assert/strict";
import { createIdFactory, createProject } from "../src/model/project.js";
import { EditorSession } from "../src/commands/editor.js";
import {
  FL2D_FORMAT,
  FL2D_FORMAT_VERSION,
  ProjectFormatError,
  createRecoveryStore,
  deserializeProject,
  parseProjectDocument,
  serializeProject,
} from "../src/io/project-json.js";
import {
  ProjectDocumentController,
  incrementalFilename,
} from "../src/io/project-files.js";
import {
  DEFAULT_PREFERENCES,
  createAutosaveScheduler,
  createPreferencesStore,
} from "../src/preferences.js";
import { createProjectFromPsd } from "../src/io/psd-project.js";
import { createPsdReimportReview } from "../src/io/psd-reimport-review.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { collectPsdParts } from "../src/psd.js";
import {
  bindPsdPartsToProject,
  EditorUiAdapter,
} from "../src/ui/editor-adapter.js";
import {
  buildReviewedRenderParts,
  ReimportRenderHistory,
} from "../src/ui/reimport-render-history.js";

const fixedNow = () => new Date("2026-08-31T00:00:00.000Z");

function projectFixture() {
  return createProject({
    name: "愛乃",
    width: 1920,
    height: 1080,
    idFactory: createIdFactory("phase1c"),
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function canvasWithPixels(...pixels) {
  const data = Uint8ClampedArray.from(pixels);
  return {
    width: 1,
    height: Math.max(1, Math.ceil(data.length / 4)),
    getContext: () => ({
      getImageData: () => ({ data }),
    }),
  };
}

function renderParts(psd, project) {
  return bindPsdPartsToProject(
    collectPsdParts(psd.children).filter((part) => part.canvas),
    project,
  );
}

test(".fl2d identifies its format, preserves projectId, and rejects newer files", () => {
  const project = projectFixture();
  const serialized = serializeProject(project, 2, { now: fixedNow });
  const document = JSON.parse(serialized);
  assert.equal(document.format, FL2D_FORMAT);
  assert.equal(document.formatVersion, FL2D_FORMAT_VERSION);
  assert.equal(document.projectId, project.id);
  assert.equal(document.name, "愛乃");
  assert.equal(document.createdAt, "2026-08-31T00:00:00.000Z");
  assert.deepEqual(deserializeProject(serialized), project);

  assert.equal(parseProjectDocument(project).metadata.migratedFrom, 0);
  document.formatVersion = FL2D_FORMAT_VERSION + 1;
  assert.throws(
    () => deserializeProject(document),
    (error) => error instanceof ProjectFormatError &&
      error.code === "project.format_newer",
  );
});

test("incremental filenames use the highest matching version", () => {
  assert.equal(incrementalFilename("Akino.fl2d"), "Akino_001.fl2d");
  assert.equal(
    incrementalFilename("Akino_test_009.fl2d", [
      "Akino_test_010.fl2d",
      "Unrelated_999.fl2d",
    ]),
    "Akino_test_011.fl2d",
  );
  assert.equal(incrementalFilename("Akino_999.fl2d"), "Akino_1000.fl2d");
});

test("Save, Save As, Incremental, and Copy keep their distinct semantics", async () => {
  const project = projectFixture();
  const session = new EditorSession(project);
  const files = new Map();
  const writer = {
    exists: async (fileName) => files.has(fileName),
    write: async ({ fileName, contents, allowOverwrite }) => {
      if (!allowOverwrite && files.has(fileName)) throw new Error("collision");
      files.set(fileName, contents);
    },
  };
  let recoveryClears = 0;
  const controller = new ProjectDocumentController(session, {
    writer,
    now: fixedNow,
    recovery: { clear: () => { recoveryClears += 1; } },
  });
  await controller.saveAs("Akino");
  assert.equal(controller.currentFileName, "Akino.fl2d");
  assert.equal(session.isDirty, false);
  assert.equal(recoveryClears, 1);

  session.execute({
    type: "scene.rename_node",
    payload: { nodeId: project.scene.rootId, displayName: "編集後" },
  });
  assert.equal(session.isDirty, true);
  await controller.saveCopy("Akino_backup.fl2d");
  assert.equal(controller.currentFileName, "Akino.fl2d");
  assert.equal(session.isDirty, true);
  assert.equal(recoveryClears, 1);

  await controller.save();
  assert.equal(session.isDirty, false);
  assert.equal(recoveryClears, 2);
  session.undo();
  assert.equal(session.isDirty, true);
  session.redo();
  assert.equal(session.isDirty, false);

  files.set("Akino_001.fl2d", "existing");
  await controller.saveIncremental(["Akino_001.fl2d"]);
  assert.equal(controller.currentFileName, "Akino_002.fl2d");
  for (const contents of files.values()) {
    if (contents === "existing") continue;
    assert.equal(deserializeProject(contents).id, project.id);
  }
});

test("Preferences stay separate and Recovery keeps bounded snapshots", () => {
  const storage = memoryStorage();
  const preferences = createPreferencesStore(storage);
  assert.deepEqual(preferences.load(), DEFAULT_PREFERENCES);
  const saved = preferences.save({
    autosaveEnabled: false,
    autosaveIntervalSeconds: 30,
    recoveryVersions: 5,
    incrementalSaveWidth: 4,
  });
  assert.equal(saved.autosaveEnabled, false);
  assert.equal(saved.incrementalSaveWidth, 4);

  const project = projectFixture();
  const recovery = createRecoveryStore(storage, {
    maxVersions: 2,
    now: fixedNow,
  });
  recovery.save(project);
  project.displayName = "二版";
  recovery.save(project);
  project.displayName = "三版";
  recovery.save(project);
  assert.equal(recovery.list().length, 2);
  assert.equal(recovery.load().displayName, "三版");
});

test("Recovery availability stays outside current dirty state until explicit restore", () => {
  const storage = memoryStorage();
  const snapshot = projectFixture();
  snapshot.displayName = "前回の未保存Project";
  const recovery = createRecoveryStore(storage, { now: fixedNow });
  recovery.save(snapshot);

  const currentSession = new EditorSession(projectFixture());
  assert.equal(recovery.list().length, 1);
  assert.equal(currentSession.isDirty, false);

  const restoredSession = new EditorSession(recovery.load());
  restoredSession.savedRevision = -1;
  assert.equal(restoredSession.isDirty, true);
  assert.equal(restoredSession.project.displayName, "前回の未保存Project");
});

test("Autosave writes Recovery only and never invokes intentional file output", () => {
  const project = projectFixture();
  const session = new EditorSession(project);
  let intervalCallback;
  let recoverySaves = 0;
  const scheduler = createAutosaveScheduler({
    session,
    recovery: { save: () => { recoverySaves += 1; } },
    preferences: { autosaveEnabled: true, autosaveIntervalSeconds: 30 },
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearIntervalFn: () => {},
  });
  intervalCallback();
  assert.equal(recoverySaves, 0);
  session.execute({
    type: "scene.rename_node",
    payload: { nodeId: project.scene.rootId, displayName: "Recovery only" },
  });
  intervalCallback();
  assert.equal(recoverySaves, 1);
  scheduler.stop();
});

test("re-import classifies changes and applies the reviewed result as one undo step", () => {
  const first = {
    width: 100,
    height: 100,
    children: [
      { id: 1, name: "目", left: 0, top: 0, right: 10, bottom: 10 },
      { id: 2, name: "耳飾り", left: 20, top: 0, right: 30, bottom: 10 },
    ],
  };
  const next = {
    width: 120,
    height: 100,
    children: [
      { id: 1, name: "目", left: 1, top: 0, right: 12, bottom: 10 },
      { id: 3, name: "リボン", left: 40, top: 0, right: 60, bottom: 20 },
    ],
  };
  const project = createProjectFromPsd(first, {
    idFactory: createIdFactory("review-old"),
  });
  const session = new EditorSession(project);
  const review = createPsdReimportReview(project, next, {
    idFactory: createIdFactory("review-new"),
  });
  assert.ok(review.rows.some((row) => row.status === "changed"));
  assert.ok(review.rows.some((row) => row.status === "added"));
  assert.ok(review.rows.some((row) => row.status === "missing"));
  assert.equal(review.canApply, true);
  review.apply(session);
  assert.equal(session.history.length, 1);
  assert.equal(session.history[0].commandTypes[0], "source.apply_psd_reimport");
  assert.equal(session.project.canvas.width, 120);
  assert.ok(Object.values(session.project.scene.nodes)
    .some((node) => node.displayName === "リボン"));
  session.undo();
  assert.deepEqual(session.project, project);
});

test("ambiguous re-import mappings remain unresolved until manually confirmed", () => {
  const psd = {
    width: 100,
    height: 100,
    children: [
      { name: "影", left: 0, top: 0, right: 10, bottom: 10 },
      { name: "影", left: 20, top: 0, right: 30, bottom: 10 },
    ],
  };
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("ambiguous-old"),
  });
  const review = createPsdReimportReview(project, psd, {
    idFactory: createIdFactory("ambiguous-new"),
  });
  const ambiguous = review.rows.filter((row) => row.status === "ambiguous");
  assert.equal(review.canApply, false);
  assert.throws(() => review.buildProject(), /Resolve every ambiguous/);
  review.setMatch(ambiguous[0].id, ambiguous[0].candidateImportedNodeIds[0]);
  review.keepExisting(ambiguous[1].id);
  assert.equal(review.canApply, true);
  assert.equal(review.summary.update, 1);
});

test("a pixel-only PSD change is conservatively classified as changed", () => {
  const first = {
    width: 1,
    height: 1,
    children: [{
      id: 1,
      name: "目",
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      canvas: canvasWithPixels(0, 0, 0, 255),
    }],
  };
  const next = {
    ...first,
    children: [{
      ...first.children[0],
      canvas: canvasWithPixels(255, 0, 0, 255),
    }],
  };
  const project = createProjectFromPsd(first, {
    idFactory: createIdFactory("raster-old"),
  });
  const review = createPsdReimportReview(project, next, {
    idFactory: createIdFactory("raster-new"),
  });
  assert.equal(review.rows[0].status, "changed");
  assert.equal(review.rows[0].action, "update");
  assert.notEqual(
    project.scene.nodes[review.rows[0].currentNodeId].sourceRef.rasterFingerprint,
    review.importedProject.scene.nodes[review.rows[0].importedNodeId]
      .sourceRef.rasterFingerprint,
  );
  const equalPixels = {
    ...first,
    children: [{
      ...first.children[0],
      canvas: canvasWithPixels(0, 0, 0, 255),
    }],
  };
  const unchanged = createPsdReimportReview(project, equalPixels, {
    idFactory: createIdFactory("raster-equal"),
  });
  assert.equal(unchanged.rows[0].status, "matched");
});

test("manual mapping invariant covers Reset to Auto, Mark as New, and Apply", () => {
  const first = {
    width: 10,
    height: 10,
    children: [
      { id: 1, name: "A", left: 0, top: 0, right: 1, bottom: 1 },
      { id: 2, name: "B", left: 1, top: 0, right: 2, bottom: 1 },
    ],
  };
  const next = {
    width: 10,
    height: 10,
    children: [{ id: 1, name: "A", left: 0, top: 0, right: 1, bottom: 1 }],
  };
  const createReview = () => {
    const project = createProjectFromPsd(first, {
      idFactory: createIdFactory("mapping-old"),
    });
    return createPsdReimportReview(project, next, {
      idFactory: createIdFactory("mapping-new"),
    });
  };

  const resetReview = createReview();
  const resetAuto = resetReview.rows.find((row) => row.currentNodeId && row.importedNodeId);
  const resetMissing = resetReview.rows.find((row) => row.status === "missing");
  const claimedImportedId = resetAuto.importedNodeId;
  resetReview.keepExisting(resetAuto.id);
  resetReview.setMatch(resetMissing.id, claimedImportedId);
  assert.throws(
    () => resetReview.resetToAuto(resetAuto.id),
    /only be matched once/,
  );
  assert.equal(resetAuto.importedNodeId, null);

  const newReview = createReview();
  const newAuto = newReview.rows.find((row) => row.currentNodeId && row.importedNodeId);
  const newMissing = newReview.rows.find((row) => row.status === "missing");
  newReview.keepExisting(newAuto.id);
  newReview.setMatch(newMissing.id, newAuto.candidateImportedNodeIds[0]);
  assert.throws(() => newReview.markAsNew(newAuto.id), /only be matched once/);

  // Apply also protects the invariant if a caller mutates exposed review data.
  newAuto.importedNodeId = newMissing.importedNodeId;
  newAuto.action = "add";
  assert.equal(newReview.canApply, false);
  assert.throws(() => newReview.buildProject(), /at most one reviewed destination/);
});

test("re-import render parts follow reviewed actions through Apply, Undo, and Redo", () => {
  const oldEyeCanvas = canvasWithPixels(0, 0, 0, 255);
  const newEyeCanvas = canvasWithPixels(255, 0, 0, 255);
  const removedCanvas = canvasWithPixels(0, 255, 0, 255);
  const addedCanvas = canvasWithPixels(0, 0, 255, 255);
  const first = {
    width: 10,
    height: 10,
    children: [
      { id: 1, name: "目", left: 0, top: 0, right: 1, bottom: 1, canvas: oldEyeCanvas },
      { id: 2, name: "耳飾り", left: 1, top: 0, right: 2, bottom: 1, canvas: removedCanvas },
    ],
  };
  const next = {
    width: 10,
    height: 10,
    children: [
      { id: 1, name: "目", left: 0, top: 0, right: 1, bottom: 1, canvas: newEyeCanvas },
      { id: 3, name: "リボン", left: 2, top: 0, right: 3, bottom: 1, canvas: addedCanvas },
    ],
  };
  const project = createProjectFromPsd(first, {
    idFactory: createIdFactory("render-old"),
  });
  const session = new EditorSession(project);
  let parts = renderParts(first, project);
  let editor;
  editor = new EditorUiAdapter(session, {
    onChange(reason) {
      if (reason !== "project") return;
      assert.ok(parts.every((part) => session.project.scene.nodes[part.nodeId]));
    },
  });
  const review = createPsdReimportReview(project, next, {
    idFactory: createIdFactory("render-new"),
  });
  const importedParts = renderParts(next, review.importedProject);
  review.removeExisting(review.rows.find((row) => row.status === "missing").id);
  const history = new ReimportRenderHistory(editor, {
    getParts: () => parts,
    setParts: (nextParts) => { parts = nextParts; },
  });

  history.apply(review, importedParts);
  assert.equal(parts.some((part) => part.sourceKey === "layer:2"), false);
  assert.equal(parts.find((part) => part.sourceKey === "layer:1").canvas, newEyeCanvas);
  assert.equal(parts.find((part) => part.sourceKey === "layer:3").canvas, addedCanvas);

  history.undo();
  assert.equal(parts.find((part) => part.sourceKey === "layer:1").canvas, oldEyeCanvas);
  assert.equal(parts.find((part) => part.sourceKey === "layer:2").canvas, removedCanvas);
  assert.equal(parts.some((part) => part.sourceKey === "layer:3"), false);

  history.redo();
  assert.equal(parts.find((part) => part.sourceKey === "layer:1").canvas, newEyeCanvas);
  assert.equal(parts.some((part) => part.sourceKey === "layer:2"), false);
  assert.equal(parts.find((part) => part.sourceKey === "layer:3").canvas, addedCanvas);
});

test("Keep Existing preserves the current canvas after reviewed re-import", () => {
  const oldCanvas = canvasWithPixels(1, 2, 3, 255);
  const newCanvas = canvasWithPixels(4, 5, 6, 255);
  const first = {
    width: 1,
    height: 1,
    children: [{ id: 1, name: "目", left: 0, top: 0, right: 1, bottom: 1, canvas: oldCanvas }],
  };
  const next = {
    width: 1,
    height: 1,
    children: [{ id: 1, name: "目", left: 0, top: 0, right: 1, bottom: 1, canvas: newCanvas }],
  };
  const project = createProjectFromPsd(first, {
    idFactory: createIdFactory("keep-old"),
  });
  const review = createPsdReimportReview(project, next, {
    idFactory: createIdFactory("keep-new"),
  });
  const row = review.rows[0];
  review.keepExisting(row.id);
  const result = review.buildResult();
  const parts = buildReviewedRenderParts(
    renderParts(first, project),
    renderParts(next, review.importedProject),
    review,
    result,
  );
  assert.equal(parts[0].canvas, oldCanvas);
});

test("re-import Apply rejects a review analyzed at a stale revision", () => {
  const psd = {
    width: 1,
    height: 1,
    children: [{
      id: 1,
      name: "目",
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      canvas: canvasWithPixels(0, 0, 0, 255),
    }],
  };
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("stale-old"),
  });
  const session = new EditorSession(project);
  const review = createPsdReimportReview(session.project, psd, {
    idFactory: createIdFactory("stale-new"),
    baseRevision: session.currentRevision,
  });
  session.execute({
    type: "scene.rename_node",
    payload: {
      nodeId: session.project.scene.rootId,
      displayName: "Review中の編集",
    },
  });

  assert.throws(
    () => review.apply(session),
    /Project changed after Analyze/,
  );
  assert.equal(
    session.project.scene.nodes[session.project.scene.rootId].displayName,
    "Review中の編集",
  );
  assert.equal(session.history.length, 1);
});

test("manual re-import mappings require compatible node kinds", () => {
  const psd = {
    width: 1,
    height: 1,
    children: [{
      id: 1,
      name: "顔",
      children: [{
        id: 2,
        name: "目",
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
        canvas: canvasWithPixels(0, 0, 0, 255),
      }],
    }],
  };
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("kind-old"),
  });
  const review = createPsdReimportReview(project, psd, {
    idFactory: createIdFactory("kind-new"),
  });
  const partRow = review.rows.find((row) =>
    review.currentProject.scene.nodes[row.currentNodeId]?.kind === "part");
  const originalImportedNodeId = partRow.importedNodeId;
  const importedGroup = Object.values(review.importedProject.scene.nodes)
    .find((node) => node.kind === "group" &&
      node.id !== review.importedProject.scene.rootId);

  assert.equal(
    review.isCompatibleImportedNode(partRow, importedGroup.id),
    false,
  );
  assert.throws(
    () => review.setMatch(partRow.id, importedGroup.id),
    /matching node kinds/,
  );
  assert.equal(partRow.importedNodeId, originalImportedNodeId);

  // The Apply boundary still rejects an invalid mapping if exposed row data
  // is changed without using the review mutation methods.
  partRow.importedNodeId = importedGroup.id;
  partRow.action = "update";
  assert.equal(review.canApply, false);
  assert.throws(() => review.buildProject(), /compatible node kinds/);
});

test("raster fingerprints are cached on a shared PSD canvas", () => {
  let pixelReads = 0;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      getImageData: () => {
        pixelReads += 1;
        return { data: Uint8ClampedArray.from([1, 2, 3, 255]) };
      },
    }),
  };
  const psd = {
    width: 1,
    height: 1,
    children: [{
      id: 1,
      name: "目",
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      canvas,
    }],
  };
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("fingerprint-cache"),
  });
  const [part] = collectPsdParts(psd.children);
  const projectPart = Object.values(project.scene.nodes)
    .find((node) => node.kind === "part");

  assert.equal(pixelReads, 1);
  assert.equal(
    projectPart.sourceRef.rasterFingerprint,
    part.rasterFingerprint,
  );
});

test("headless adapter uses normal command schemas and exposes edits through queries", () => {
  const project = projectFixture();
  const session = new EditorSession(project);
  const headless = new HeadlessProductAdapter(session);
  const root = headless.query("scene.get_tree", { includeHidden: true });
  headless.execute({
    type: "scene.rename_node",
    payload: { nodeId: root.id, displayName: "Headless Edit" },
  });
  assert.equal(
    headless.query("scene.get_node", { nodeId: root.id }).displayName,
    "Headless Edit",
  );
  assert.equal(headless.query("project.validate").valid, true);
  assert.ok(headless.capabilities().commands["scene.rename_node"]);
});
