import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Export dialog stays a thin Desktop/UI composition over existing export foundations", async () => {
  const source = await readFile(
    new URL("../src/ui/export-dialog-view.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /ExportJobController/);
  assert.match(source, /FrameSequenceExportJob/);
  assert.match(source, /DesktopMp4ExportJob/);
  assert.match(source, /transitionRenderAssetStatus/);
  assert.doesNotMatch(source, /node:fs|node:child_process|\bspawn\s*\(/);
  assert.doesNotMatch(source, /session\.execute|executeTransaction|Undo|Redo/);

  const productionFiles = await readFile(
    new URL("../production-files.txt", import.meta.url),
    "utf8",
  );
  assert.match(productionFiles, /^src\/core\/export-settings\.js$/m);
  assert.match(productionFiles, /^src\/ui\/export-dialog-view\.js$/m);
});
