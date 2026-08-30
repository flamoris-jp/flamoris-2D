import test from "node:test";
import assert from "node:assert/strict";
import { createIdFactory } from "../src/model/project.js";
import {
  createProjectFromPsd,
  reconcilePsdProject,
} from "../src/io/psd-project.js";
import { queryProject } from "../src/queries/project.js";

const psd = {
  width: 1000,
  height: 1200,
  children: [
    {
      id: 10,
      name: "顔",
      children: [
        {
          id: 11,
          name: "左目",
          left: 10,
          top: 20,
          right: 110,
          bottom: 80,
        },
        {
          id: 12,
          name: "下書き",
          hidden: true,
          left: 0,
          top: 0,
          right: 20,
          bottom: 20,
        },
      ],
    },
  ],
};

test("PSD import preserves groups, hidden nodes, source identity, and Unicode names", () => {
  const project = createProjectFromPsd(psd, {
    fileName: "愛乃.psd",
    idFactory: createIdFactory("import"),
  });
  const tree = queryProject(project, "scene.get_tree");
  assert.equal(tree.children[0].displayName, "顔");
  assert.equal(
    tree.children[0].children[1].displayName,
    "下書き",
  );
  assert.equal(tree.children[0].children[1].visible, false);
  assert.equal(
    queryProject(project, "project.validate").valid,
    true,
  );
  assert.equal(
    Object.values(project.scene.nodes)
      .find((node) => node.displayName === "左目")
      .sourceRef.sourceKey,
    "layer:11",
  );
});

test("PSD reconciliation reports compatible IDs and removed layers", () => {
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("old"),
  });
  const renamed = structuredClone(psd);
  renamed.children[0].children[0].name = "左眼";
  renamed.children[0].children.pop();
  const result = reconcilePsdProject(project, renamed, {
    idFactory: createIdFactory("new"),
  });
  assert.ok(
    result.review.matched.some(
      (entry) => entry.sourceKey === "layer:11",
    ),
  );
  assert.deepEqual(
    result.review.removed.map((entry) => entry.sourceKey),
    ["layer:12"],
  );
  assert.equal(result.review.canApplyAutomatically, false);
});
