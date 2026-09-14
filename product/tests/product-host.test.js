import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ControlFrameDecoder, encodeControlFrame } from "../product-host/protocol.mjs";
import { ProductHostService } from "../product-host/session-service.mjs";
import {
  assertNodeRuntimeCapabilities,
  auditModuleGraph,
} from "../product-host/runtime-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hostPath = join(here, "..", "product-host", "main.mjs");
let requestSequence = 0;

function request(method, payload = {}, overrides = {}) {
  return {
    protocolVersion: 1,
    requestId: `request-${++requestSequence}`,
    method,
    payload,
    ...overrides,
  };
}

async function send(service, method, payload = {}, overrides = {}) {
  return (await service.handle(request(method, payload, overrides))).response;
}

async function createService() {
  let tokenSequence = 0;
  const service = new ProductHostService({
    createToken: () => `document-proof-${++tokenSequence}`,
  });
  const opened = await send(service, "session.create", {
    id: "project-proof",
    name: "Boundary proof",
    width: 1280,
    height: 720,
  });
  assert.equal(opened.ok, true);
  return service;
}

async function sceneTree(service) {
  const result = await send(service, "session.query", {
    name: "scene.get_tree",
    input: { includeHidden: true },
  }, { documentToken: service.documentToken });
  assert.equal(result.ok, true);
  return result.payload;
}

test("protocol handshake and health disclose reviewed versions", async () => {
  const service = new ProductHostService();
  const handshakeRequest = request("protocol.handshake");
  const handshake = (await service.handle(handshakeRequest)).response;
  assert.equal(handshake.ok, true);
  assert.equal(handshake.requestId, handshakeRequest.requestId);
  assert.equal(handshake.payload.protocolVersion, 1);
  assert.equal(handshake.payload.productSchemaVersion, 15);
  assert.equal(handshake.payload.mcpSchemaVersion, 18);
  const health = await send(service, "host.health");
  assert.deepEqual(health.payload, {
    status: "healthy", documentOpen: false, documentToken: null,
  });
  const mismatch = (await service.handle({
    ...request("protocol.handshake"),
    protocolVersion: 2,
  })).response;
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, "protocol.version_unsupported");
});

test("mutation response and change event carry the same authority tags", async () => {
  const service = await createService();
  const root = await sceneTree(service);
  const envelope = request("session.execute", {
    command: {
      type: "scene.rename_node",
      payload: { nodeId: root.id, displayName: "Event proof" },
    },
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  const result = await service.handle(envelope);
  assert.equal(result.response.requestId, envelope.requestId);
  assert.equal(result.response.documentToken, service.documentToken);
  assert.equal(result.response.revision, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event, "document.changed");
  assert.equal(result.events[0].documentToken, result.response.documentToken);
  assert.equal(result.events[0].revision, result.response.revision);
});

test("query, command and transaction round-trip through one EditorSession", async () => {
  const service = await createService();
  const summary = await send(service, "session.query", {
    name: "project.get_summary", input: {},
  }, { documentToken: service.documentToken });
  assert.equal(summary.payload.id, "project-proof");
  assert.equal(summary.revision, 0);
  const root = await sceneTree(service);

  const command = await send(service, "session.execute", {
    command: {
      type: "scene.rename_node",
      payload: { nodeId: root.id, displayName: "WPF name" },
    },
    label: "WPF rename",
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  assert.equal(command.ok, true);
  assert.equal(command.revision, 1);

  const transaction = await send(service, "session.executeTransaction", {
    commands: [
      { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Transaction A" } },
      { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Transaction B" } },
    ],
    label: "Two edits atomically",
  }, { documentToken: service.documentToken, expectedRevision: 1 });
  assert.equal(transaction.ok, true);
  assert.equal(transaction.payload.applied, 2);
  assert.equal(transaction.revision, 2);
  assert.equal((await sceneTree(service)).displayName, "Transaction B");
});

test("validation failure is atomic and leaves host revision unchanged", async () => {
  const service = await createService();
  const root = await sceneTree(service);
  const failure = await send(service, "session.executeTransaction", {
    commands: [
      { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Would apply" } },
      { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "   " } },
    ],
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  assert.equal(failure.ok, false);
  assert.equal(failure.revision, 0);
  assert.equal((await sceneTree(service)).displayName, "Boundary proof");
});

test("undo and redo retain EditorSession history with monotonic host revisions", async () => {
  const service = await createService();
  const root = await sceneTree(service);
  await send(service, "session.execute", {
    command: { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Changed" } },
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  const undo = await send(service, "session.undo", {}, {
    documentToken: service.documentToken, expectedRevision: 1,
  });
  assert.equal(undo.revision, 2);
  assert.equal((await sceneTree(service)).displayName, "Boundary proof");
  const redo = await send(service, "session.redo", {}, {
    documentToken: service.documentToken, expectedRevision: 2,
  });
  assert.equal(redo.revision, 3);
  assert.equal((await sceneTree(service)).displayName, "Changed");
});

test("stale mutations are rejected without replacing authoritative state", async () => {
  const service = await createService();
  const root = await sceneTree(service);
  await send(service, "session.execute", {
    command: { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Current" } },
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  const stale = await send(service, "session.execute", {
    command: { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "Stale" } },
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "revision.conflict");
  assert.equal(stale.revision, 1);
  assert.equal((await sceneTree(service)).displayName, "Current");
});

test("WPF and headless commands share one ordered history", async () => {
  const service = await createService();
  const root = await sceneTree(service);
  await send(service, "session.execute", {
    command: { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "From WPF" } },
    label: "WPF command",
  }, { documentToken: service.documentToken, expectedRevision: 0 });
  await send(service, "headless.execute", {
    command: { type: "scene.rename_node", payload: { nodeId: root.id, displayName: "From MCP" } },
    label: "MCP command",
  }, { documentToken: service.documentToken, expectedRevision: 1 });
  const history = await send(service, "session.history", {}, {
    documentToken: service.documentToken,
  });
  assert.deepEqual(history.payload.entries.map((entry) => entry.label), [
    "WPF command", "MCP command",
  ]);
  await send(service, "session.undo", {}, {
    documentToken: service.documentToken, expectedRevision: 2,
  });
  assert.equal((await sceneTree(service)).displayName, "From WPF");
});

test("representative .fl2d content reopens without schema change", async () => {
  const service = await createService();
  const serialized = await send(service, "session.serialize", { spacing: 0 }, {
    documentToken: service.documentToken,
  });
  const parsed = JSON.parse(serialized.payload.document);
  assert.equal(parsed.project.schemaVersion, 15);
  const previousToken = service.documentToken;
  const reopened = await send(service, "session.open", {
    document: serialized.payload.document,
  });
  assert.equal(reopened.ok, true);
  assert.notEqual(reopened.documentToken, previousToken);
  assert.equal(reopened.payload.summary.schemaVersion, 15);
});

test("Product Host entry graph is free of unowned DOM and Canvas globals", async () => {
  assert.doesNotThrow(assertNodeRuntimeCapabilities);
  const audit = await auditModuleGraph(new URL("../product-host/session-service.mjs", import.meta.url));
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations, null, 2));
  const portablePaths = audit.modules.map((file) => file.replaceAll("\\", "/"));
  assert.ok(portablePaths.some((file) => file.endsWith("commands/editor.js")));
  assert.ok(portablePaths.some((file) => file.endsWith("io/png-raster.js")));
});

test("browser dependency inventory covers every required disposition", async () => {
  const inventory = JSON.parse(await readFile(
    new URL("../product-host/browser-dependencies.json", import.meta.url),
    "utf8",
  ));
  const classifications = new Set(inventory.entries.map((entry) => entry.classification));
  assert.deepEqual(classifications, new Set([
    "plain Node-compatible Product code",
    "environment adapter required",
    "native adapter candidate",
    "deferred renderer concern",
  ]));
  const sources = inventory.entries.flatMap((entry) => entry.sources);
  for (const required of [
    "src/app.js",
    "src/io/png-raster.js",
    "src/core/export-offscreen-renderer.js",
    "src/renderer.js",
    "src/ui/desktop-project-files.js",
  ]) {
    assert.ok(sources.includes(required), `Missing dependency classification for ${required}.`);
  }
  assert.match(await readFile(new URL("../src/app.js", import.meta.url), "utf8"), /window\.agPsd/);
  assert.match(await readFile(new URL("../src/io/png-raster.js", import.meta.url), "utf8"),
    /DecompressionStream/);
  assert.match(
    await readFile(new URL("../src/core/export-offscreen-renderer.js", import.meta.url), "utf8"),
    /OffscreenCanvas/,
  );
});

test("framed child process starts, responds, shuts down, and surfaces crash", async (context) => {
  const start = () => spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"] });
  const child = start();
  context.after(() => { if (!child.killed) child.kill(); });
  const decoder = new ControlFrameDecoder();
  child.stdout.pipe(decoder);
  const responses = [];
  decoder.on("data", (value) => responses.push(value));
  child.stdin.write(encodeControlFrame(request("protocol.handshake")));
  while (responses.length === 0) await once(decoder, "data");
  assert.equal(responses[0].ok, true);
  child.stdin.write(encodeControlFrame(request("host.shutdown")));
  while (!responses.some((entry) => entry.payload?.accepted)) await once(decoder, "data");
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0);

  const crashed = start();
  crashed.kill("SIGKILL");
  const [crashCode, signal] = await once(crashed, "exit");
  assert.ok(crashCode !== 0 || signal === "SIGKILL");
});
