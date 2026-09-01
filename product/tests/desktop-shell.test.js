import test from "node:test";
import assert from "node:assert/strict";
import { createIdFactory, createProject } from "../src/model/project.js";
import { EditorSession } from "../src/commands/editor.js";
import { ProjectDocumentController } from "../src/io/project-files.js";
import {
  documentTitle,
  nextIncrementalFilePath,
  resolveUnsavedDecision,
  updateRecentFiles,
} from "../src/desktop/shell-logic.js";
import {
  createDesktopProjectWriter,
  desktopFileFromPayload,
} from "../src/ui/desktop-project-files.js";

function projectFixture() {
  return createProject({
    name: "Akino",
    width: 1920,
    height: 1080,
    idFactory: createIdFactory("desktop"),
  });
}

test("desktop title keeps file identity, dirty, and Recovery distinct", () => {
  assert.equal(
    documentTitle({ filePath: "/MV/Akino.fl2d" }),
    "Akino.fl2d",
  );
  assert.equal(
    documentTitle({ fileName: "Akino.fl2d", dirty: true, recovered: true }),
    "Akino.fl2d * · Recovered",
  );
});

test("incremental targets stay beside the associated project", () => {
  const target = nextIncrementalFilePath({
    currentFilePath: "/work/Akino.fl2d",
    existingFileNames: ["Akino_001.fl2d", "Akino_002.fl2d"],
  });
  assert.equal(target, "/work/Akino_003.fl2d");
});

test("Recent Files are bounded, deduplicated, and missing-safe", () => {
  const existing = new Set(["/projects/A.fl2d", "/projects/B.fl2d"]);
  const recent = updateRecentFiles(
    ["/projects/A.fl2d", "/projects/missing.fl2d", "/projects/B.fl2d"],
    "/projects/B.fl2d",
    { exists: (filePath) => existing.has(filePath), limit: 2 },
  );
  assert.deepEqual(recent, ["/projects/B.fl2d", "/projects/A.fl2d"]);
});

test("dirty close proceeds only after discard or a successful Save", () => {
  assert.deepEqual(
    resolveUnsavedDecision({ dirty: false, choice: "cancel" }),
    { proceed: true, save: false },
  );
  assert.equal(resolveUnsavedDecision({ dirty: true, choice: "cancel" }).proceed, false);
  assert.equal(resolveUnsavedDecision({ dirty: true, choice: "discard" }).proceed, true);
  assert.equal(resolveUnsavedDecision({
    dirty: true,
    choice: "save",
    saveSucceeded: false,
  }).proceed, false);
  assert.equal(resolveUnsavedDecision({
    dirty: true,
    choice: "save",
    saveSucceeded: true,
  }).proceed, true);
});

test("desktop writer updates association for Save As but not Save Copy", async () => {
  const writes = [];
  const desktopApi = {
    projectFileExists: async () => false,
    listSiblingProjectFiles: async () => [],
    writeProject: async (request) => {
      writes.push(request);
      const filePath = request.operation === "save-copy"
        ? "/work/Akino-copy.fl2d"
        : "/work/Akino.fl2d";
      return { fileName: filePath.split("/").at(-1), filePath };
    },
  };
  const project = projectFixture();
  const projectId = project.id;
  const session = new EditorSession(project);
  const controller = new ProjectDocumentController(session, {
    writer: createDesktopProjectWriter(desktopApi),
  });

  await controller.saveAs("Akino.fl2d");
  assert.equal(controller.currentFilePath, "/work/Akino.fl2d");
  assert.equal(session.isDirty, false);
  session.execute({
    type: "scene.rename_node",
    payload: { nodeId: project.scene.rootId, displayName: "Edited" },
  });
  await controller.saveCopy("Akino-copy.fl2d");
  assert.equal(controller.currentFilePath, "/work/Akino.fl2d");
  assert.equal(session.isDirty, true);
  assert.equal(session.project.id, projectId);
  assert.deepEqual(writes.map((entry) => entry.operation), ["save-as", "save-copy"]);
});

test("desktop file payload provides browser-compatible text and bytes", async () => {
  const projectFile = desktopFileFromPayload({
    name: "Akino.fl2d",
    contents: "{\"ok\":true}",
  });
  assert.equal(await projectFile.text(), "{\"ok\":true}");
  const psdFile = desktopFileFromPayload({
    name: "Akino.psd",
    bytes: Uint8Array.from([1, 2, 3]),
  });
  assert.deepEqual(new Uint8Array(await psdFile.arrayBuffer()), Uint8Array.from([1, 2, 3]));
});
