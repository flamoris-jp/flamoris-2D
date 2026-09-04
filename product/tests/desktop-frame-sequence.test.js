import test from "node:test";
import assert from "node:assert/strict";

import {
  DesktopFrameSequenceSessionRegistry,
  assertFrameSequenceFileName,
  createFrameSequenceDirectory,
  safeExportDirectoryName,
  writeFrameSequenceFile,
} from "../src/desktop/frame-sequence-files.js";
import { createDesktopFrameSequenceSink } from "../src/ui/desktop-frame-sequence-sink.js";

test("export directory names are sanitized for Windows path safety", () => {
  assert.equal(safeExportDirectoryName(" Shot:01? "), "Shot_01_");
  assert.equal(safeExportDirectoryName(".."), "FLAMORIS-export");
  assert.equal(safeExportDirectoryName("a/b\\c"), "a_b_c");
});

test("existing output directory conflict is explicit", async () => {
  const exists = new Error("exists");
  exists.code = "EEXIST";
  await assert.rejects(
    () => createFrameSequenceDirectory("C:/exports", "shot", {
      makeDirectory: async () => { throw exists; },
    }),
    (error) => error.code === "EXPORT_OUTPUT_CONFLICT",
  );
});

test("frame writes accept only deterministic PNG names and use exclusive writer", async () => {
  const calls = [];
  const result = await writeFrameSequenceFile(
    "C:/exports/shot",
    "frame_000001.png",
    new Uint8Array([1, 2, 3]),
    {
      writeFile: async (path, bytes) => calls.push({ path, bytes: [...bytes] }),
    },
  );
  assert.match(result.filePath.replaceAll("\\", "/"), /C:\/exports\/shot\/frame_000001\.png$/);
  assert.deepEqual(calls[0].bytes, [1, 2, 3]);
  assert.deepEqual(assertFrameSequenceFileName("frame_000042.png"), {
    fileName: "frame_000042.png",
    ordinal: 42,
  });
  await assert.rejects(() => writeFrameSequenceFile(
    "C:/exports/shot",
    "evil.png",
    new Uint8Array([1]),
    { writeFile: async () => {} },
  ), /frame_000001/);
});

test("desktop session registry owns destination paths and closes transient sessions", async () => {
  const writes = [];
  const registry = new DesktopFrameSequenceSessionRegistry({
    createDirectory: async (_parent, name) => ({
      directoryName: name,
      directoryPath: "C:/exports/shot",
    }),
    writeFrame: async (directoryPath, fileName, bytes) => {
      writes.push({ directoryPath, fileName, bytes: [...bytes] });
      return { fileName, filePath: `${directoryPath}/${fileName}` };
    },
  });
  const session = await registry.begin("C:/exports", { suggestedName: "shot" });
  assert.equal(session.destination, "C:/exports/shot");
  await registry.write(session.sessionId, {
    fileName: "frame_000001.png",
    bytes: new Uint8Array([1]),
  });
  const ended = registry.end(session.sessionId);
  assert.equal(ended.writtenFrames, 1);
  await assert.rejects(() => registry.write(session.sessionId, {
    fileName: "frame_000002.png",
    bytes: new Uint8Array([2]),
  }), /Unknown or completed/);
  assert.equal(writes.length, 1);
});

test("renderer-side desktop sink passes only session token, filename, and bytes", async () => {
  const calls = [];
  const sink = createDesktopFrameSequenceSink({
    async beginFrameSequenceExport(request) {
      calls.push(["begin", request]);
      return { sessionId: "s1", destination: "C:/exports/shot" };
    },
    async writeFrameSequenceFrame(request) {
      calls.push(["write", request]);
      return { ok: true };
    },
    async endFrameSequenceExport(request) {
      calls.push(["end", request]);
      return { ok: true };
    },
  });
  const session = await sink.begin({ suggestedName: "shot" });
  await sink.write(session, {
    fileName: "frame_000001.png",
    bytes: new Uint8Array([1, 2]),
  });
  await sink.end(session, { status: "completed" });

  assert.equal(calls[1][1].sessionId, "s1");
  assert.equal("destination" in calls[1][1], false);
  assert.equal(calls[1][1].fileName, "frame_000001.png");
  assert.equal(calls[2][1].status, "completed");
});
