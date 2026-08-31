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
