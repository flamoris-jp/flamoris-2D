import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  atomicWriteFile,
  atomicWriteFileSync,
  exclusiveWriteFile,
} from "../src/desktop/atomic-write.js";

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
  const pngFile = desktopFileFromPayload({
    name: "Akino.png",
    filePath: "C:\\Art\\Akino.png",
    mimeType: "image/png",
    bytes: Uint8Array.from([1, 2, 3]),
  });
  assert.equal(pngFile instanceof File, true);
  assert.equal(pngFile instanceof Blob, true);
  assert.equal(pngFile.filePath, "C:\\Art\\Akino.png");
  assert.deepEqual(new Uint8Array(await pngFile.arrayBuffer()), Uint8Array.from([1, 2, 3]));
  const objectUrl = URL.createObjectURL(pngFile);
  assert.match(objectUrl, /^blob:/);
  URL.revokeObjectURL(objectUrl);
});

test("atomic writes preserve the previous file when replace fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flamoris-atomic-"));
  const target = join(directory, "Akino.fl2d");
  try {
    await writeFile(target, "old", "utf8");
    await atomicWriteFile(target, "new");
    assert.equal(await readFile(target, "utf8"), "new");

    await assert.rejects(
      atomicWriteFile(target, "broken", {
        replace: async () => { throw new Error("replace failed"); },
      }),
      /replace failed/,
    );
    assert.equal(await readFile(target, "utf8"), "new");
    assert.deepEqual(await readdir(directory), ["Akino.fl2d"]);

    atomicWriteFileSync(target, "sync");
    assert.equal(await readFile(target, "utf8"), "sync");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exclusive writes never overwrite an incremental file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flamoris-exclusive-"));
  const target = join(directory, "Akino_001.fl2d");
  try {
    await writeFile(target, "existing", "utf8");
    await assert.rejects(
      exclusiveWriteFile(target, "replacement"),
      (error) => error.code === "EEXIST",
    );
    assert.equal(await readFile(target, "utf8"), "existing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
