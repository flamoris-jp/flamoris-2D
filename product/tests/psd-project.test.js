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

test("fallback source identity is unique but order-dependent siblings are ambiguous", () => {
  const sameNamePsd = {
    width: 100,
    height: 100,
    children: [
      {
        name: "顔",
        children: [{ name: "目", left: 0, top: 0, right: 10, bottom: 10 }],
      },
      {
        name: "顔",
        children: [{ name: "目", left: 20, top: 0, right: 30, bottom: 10 }],
      },
    ],
  };
  const project = createProjectFromPsd(sameNamePsd, {
    idFactory: createIdFactory("fallback"),
  });
  const sourceKeys = Object.values(project.scene.nodes)
    .map((node) => node.sourceRef?.sourceKey)
    .filter(Boolean);
  assert.equal(new Set(sourceKeys).size, sourceKeys.length);
  assert.ok(sourceKeys.includes(
    "path:name:%E9%A1%94[1]/name:%E7%9B%AE[1]",
  ));
  assert.ok(sourceKeys.includes(
    "path:name:%E9%A1%94[2]/name:%E7%9B%AE[1]",
  ));

  const reconciliation = reconcilePsdProject(
    project,
    sameNamePsd,
    { idFactory: createIdFactory("fallback-next") },
  );
  assert.ok(
    reconciliation.review.ambiguous.some(
      (entry) =>
        entry.reasons.includes("order-dependent-fallback"),
    ),
  );
  assert.equal(reconciliation.review.canApplyAutomatically, false);
});

test("reordered same-name siblings never auto-reconcile fallback identity", () => {
  const sameNameLayers = {
    width: 100,
    height: 100,
    children: [
      { name: "影", left: 0, top: 0, right: 10, bottom: 10 },
      { name: "影", left: 20, top: 0, right: 30, bottom: 10 },
    ],
  };
  const project = createProjectFromPsd(sameNameLayers, {
    idFactory: createIdFactory("ordered"),
  });
  const reordered = structuredClone(sameNameLayers);
  reordered.children.reverse();

  const result = reconcilePsdProject(project, reordered, {
    idFactory: createIdFactory("reordered"),
  });
  assert.equal(result.review.canApplyAutomatically, false);
  assert.equal(result.review.matched.length, 0);
  assert.equal(result.review.ambiguous.length, 2);
  assert.ok(result.review.ambiguous.every(
    (entry) =>
      entry.reasons.includes("order-dependent-fallback"),
  ));
});

test("duplicate source identity blocks automatic reconciliation", () => {
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("unique"),
  });
  const duplicateIdPsd = structuredClone(psd);
  duplicateIdPsd.children[0].children.push({
    id: 11,
    name: "重複した左目",
    left: 120,
    top: 20,
    right: 220,
    bottom: 80,
  });
  const result = reconcilePsdProject(project, duplicateIdPsd, {
    idFactory: createIdFactory("duplicate"),
  });
  assert.equal(result.review.ambiguous.length, 1);
  assert.equal(result.review.ambiguous[0].sourceKey, "layer:11");
  assert.equal(result.review.canApplyAutomatically, false);
});
