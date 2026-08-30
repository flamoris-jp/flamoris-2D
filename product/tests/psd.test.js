import test from "node:test";
import assert from "node:assert/strict";
import { collectPsdParts, visiblePsdParts } from "../src/psd.js";

test("collectPsdParts preserves hierarchy, coordinates, and stacking order", () => {
  const fakeCanvas = { width: 10, height: 20 };
  const parts = collectPsdParts([
    {
      name: "back",
      children: [
        { name: "hair_back", left: 5, top: 7, right: 15, bottom: 27, canvas: fakeCanvas },
      ],
    },
    {
      name: "front",
      children: [
        { name: "bang", left: 20, top: 30, right: 30, bottom: 50, canvas: fakeCanvas },
      ],
    },
  ]);

  assert.deepEqual(parts.map((part) => part.path), ["back/hair_back", "front/bang"]);
  assert.equal(parts[1].left, 20);
  assert.equal(parts[1].height, 20);
});

test("visiblePsdParts removes hidden or empty layers", () => {
  const canvas = { width: 4, height: 4 };
  const parts = collectPsdParts([
    { name: "shown", left: 0, top: 0, right: 4, bottom: 4, canvas },
    { name: "hidden", hidden: true, left: 0, top: 0, right: 4, bottom: 4, canvas },
    { name: "empty", left: 0, top: 0, right: 0, bottom: 0, canvas },
  ]);
  assert.deepEqual(visiblePsdParts(parts).map((part) => part.name), ["shown"]);
});
