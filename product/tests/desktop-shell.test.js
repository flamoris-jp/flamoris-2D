import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createIdFactory, createProject } from "../src/model/project.js";
import { EditorSession } from "../src/commands/editor.js";
import { ProjectDocumentController } from "../src/io/project-files.js";
import { parseProjectDocument } from "../src/io/project-json.js";
import {
  documentTitle,
  filePickerConfiguration,
  nextIncrementalFilePath,
  resolveUnsavedDecision,
  updateRecentFiles,
} from "../src/desktop/shell-logic.js";

test("Desktop source-art picker keeps Cutwork .flimg separate from native project Open", () => {
  const cutwork = filePickerConfiguration("import-cutwork-flimg");
  assert.equal(cutwork.requiredExtension, ".flimg");
  assert.deepEqual(cutwork.filters, [{ name: "Cutwork Image", extensions: ["flimg"] }]);
  const open = filePickerConfiguration("open");
  assert.equal(open.requiredExtension, null);
  assert.equal(open.filters.some((filter) => filter.extensions.includes("flimg")), false);
});
import {
  createDesktopProjectWriter,
  desktopFileFromPayload,
} from "../src/ui/desktop-project-files.js";
import {
  hydratePsdRenderAssets,
  serializePsdRenderAssets,
} from "../src/ui/psd-render-assets.js";
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
  const projectPath = join(resolve("work"), "Akino.fl2d");
  const target = nextIncrementalFilePath({
    currentFilePath: projectPath,
    existingFileNames: ["Akino_001.fl2d", "Akino_002.fl2d"],
  });
  assert.equal(target, join(resolve("work"), "Akino_003.fl2d"));
});

test("Recent Files are bounded, deduplicated, and missing-safe", () => {
  const projectDirectory = resolve("projects");
  const projectA = join(projectDirectory, "A.fl2d");
  const projectB = join(projectDirectory, "B.fl2d");
  const missingProject = join(projectDirectory, "missing.fl2d");
  const existing = new Set([projectA, projectB]);
  const recent = updateRecentFiles(
    [projectA, missingProject, projectB],
    projectB,
    { exists: (filePath) => existing.has(filePath), limit: 2 },
  );
  assert.deepEqual(recent, [projectB, projectA]);
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

test("desktop file payload exposes safe Recent Files errors without IPC text", () => {
  assert.throws(
    () => desktopFileFromPayload({
      desktopError: {
        code: "recent.missing",
        message: "Recent Fileが見つからないため、一覧から削除しました。",
      },
    }),
    (error) => error.name === "DesktopFileOpenError" &&
      error.code === "recent.missing" &&
      !error.message.includes("Error invoking remote method"),
  );
});

test("PSD render assets serialize and hydrate outside Project Core", async () => {
  const project = projectFixture();
  const nodeId = project.scene.rootId;
  const secondNodeId = "node_desktop_render_0002";
  project.scene.nodes[secondNodeId] = {
    ...structuredClone(project.scene.nodes[nodeId]),
    id: secondNodeId,
    kind: "part",
    parentId: nodeId,
    children: [],
  };
  project.scene.nodes[nodeId].children.push(secondNodeId);
  const validDataUrl = "data:image/png;base64,AA==";
  const brokenDataUrl = "data:image/png;base64,AQ==";
  const records = serializePsdRenderAssets([{
    nodeId,
    sourceKey: "layer:1",
    name: "Akino",
    path: "Akino",
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
    width: 1,
    height: 1,
    canvas: { toDataURL: () => validDataUrl },
  }, {
    nodeId: secondNodeId,
    sourceKey: "layer:2",
    name: "Broken",
    path: "Broken",
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
    width: 1,
    height: 1,
    canvas: { toDataURL: () => brokenDataUrl },
  }]);
  assert.equal(records[0].dataUrl, validDataUrl);
  const image = { width: 1, height: 1 };
  const hydration = await hydratePsdRenderAssets(records, project, {
    loadImage: async (source) => {
      if (source === brokenDataUrl) throw new Error("decode failed");
      assert.equal(source, validDataUrl);
      return image;
    },
  });
  assert.equal(hydration.totalCount, 2);
  assert.equal(hydration.failedCount, 1);
  assert.equal(hydration.parts.length, 1);
  assert.equal(hydration.parts[0].canvas, image);
  assert.equal(hydration.parts[0].nodeId, nodeId);
  assert.equal(hydration.parts[0].dataUrl, validDataUrl);
});

test("Project saves include render assets without adding them to Project state", async () => {
  const project = projectFixture();
  const session = new EditorSession(project);
  let savedContents = null;
  const renderAssets = [{
    nodeId: project.scene.rootId,
    sourceKey: "layer:1",
    dataUrl: "data:image/png;base64,AA==",
  }];
  const controller = new ProjectDocumentController(session, {
    writer: {
      write: async ({ contents }) => {
        savedContents = contents;
        return { fileName: "Akino.fl2d" };
      },
    },
    getRenderAssets: () => renderAssets,
  });
  await controller.saveAs("Akino.fl2d");
  const document = JSON.parse(savedContents);
  assert.deepEqual(document.renderAssets, renderAssets);
  assert.deepEqual(parseProjectDocument(savedContents).renderAssets, renderAssets);
  assert.equal(Object.hasOwn(session.project, "renderAssets"), false);
});

test("a completed Save marks only the revision that was serialized", async () => {
  const project = projectFixture();
  const session = new EditorSession(project);
  let finishWrite;
  let savedContents;
  let recoveryClears = 0;
  const controller = new ProjectDocumentController(session, {
    writer: {
      write: async ({ contents }) => {
        savedContents = contents;
        await new Promise((resolve) => { finishWrite = resolve; });
        return { fileName: "Akino.fl2d", filePath: "/work/Akino.fl2d" };
      },
    },
    recovery: { clear: () => { recoveryClears += 1; } },
  });

  session.execute({
    type: "scene.rename_node",
    payload: { nodeId: project.scene.rootId, displayName: "Saved revision" },
  });
  const save = controller.saveAs("Akino.fl2d");
  await Promise.resolve();

  session.execute({
    type: "scene.rename_node",
    payload: { nodeId: project.scene.rootId, displayName: "Newer edit" },
  });
  finishWrite();
  await save;

  assert.equal(parseProjectDocument(savedContents).project.scene.nodes[
    project.scene.rootId
  ].displayName, "Saved revision");
  assert.equal(session.savedRevision, 1);
  assert.equal(session.currentRevision, 2);
  assert.equal(session.isDirty, true);
  assert.equal(recoveryClears, 0);

  session.undo();
  assert.equal(session.currentRevision, 1);
  assert.equal(session.isDirty, false);
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
