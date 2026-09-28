import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeFrameRate } from "../../src/core/temporal.js";

const fixturePath = fileURLToPath(new URL("./temporal-conformance.json", import.meta.url));
const inputs = [
  [24, 1], [25, 1], [30000, 1001], [60000, 2002],
  [7, 7], [1, 9007199254740991],
  [9007199254740991, 9007199254740991],
  [9007199254740991, 3], [0, 1], [-1, 1], [1, 0],
  [9007199254740992, 1], [1, 9007199254740992],
];
const fixtures = inputs.map(([numerator, denominator]) => {
  try {
    return { numerator, denominator, expected: normalizeFrameRate({ numerator, denominator }) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { numerator, denominator, error: "invalid_argument" };
  }
});
const serialized = JSON.stringify(fixtures, null, 2) + "\n";
if (process.argv.includes("--write")) {
  await writeFile(fixturePath, serialized);
} else {
  assert.equal((await readFile(fixturePath, "utf8")).replaceAll("\r\n", "\n"), serialized,
    "Temporal fixtures differ from current Product JS; regenerate deliberately with --write");
}
