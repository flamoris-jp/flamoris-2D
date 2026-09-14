import test from "node:test";
import assert from "node:assert/strict";
import { ProductHostService } from "../product-host/session-service.mjs";
import { RasterAssets } from "../product-host/raster-assets.mjs";

let sequence = 0;
async function send(host, method, payload = {}, overrides = {}) {
  return (await host.handle({ protocolVersion: 1, requestId: `mesh-${++sequence}`,
    documentToken: host.documentToken, expectedRevision: host.revision, method, payload, ...overrides })).response;
}
async function proof() {
  const host = new ProductHostService();
  await send(host, "session.create");
  const reserved = await send(host, "assets.reserve", { name: "右目", width: 32, height: 32 });
  host.assets.entries.get(reserved.payload.id).bytes = Buffer.alloc(32 * 32 * 4, 255);
  const opened = await send(host, "handsOn.open", { assetIds: [reserved.payload.id] });
  assert.equal(opened.ok, true, JSON.stringify(opened.error));
  const nodeId = [...host.document.bindings.keys()][0];
  return { host, nodeId };
}
async function projection(host, nodeId) {
  const result = await send(host, "mesh.projection", { nodeId });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.payload.state;
}
async function tool(host, nodeId, name, input, context = "structure") {
  return send(host, "mesh.tool", { nodeId, context, tool: name, input });
}

test("binary raster delivery is authenticated, bounded, revision tagged and cleaned up", async t => {
  let current = { token: "document-a", revision: 0 };
  const assets = new RasterAssets(() => current, { dimension: 32, pixels: 1024, bytes: 4096,
    count: 2, reservationMs: 1000 });
  const endpoint = await assets.start();
  t.after(() => assets.close());
  const item = assets.reserve({ name: "eye", width: 32, height: 32 }, current.token, 0);
  assert.throws(() => assets.reserve({ name: "overflow", width: 1, height: 1 }, current.token, 0), /budget/);
  assert.throws(() => assets.reserve({ name: "wide", width: 33, height: 1 }, current.token, 0), /dimensions/);
  const url = `${endpoint.url}/raster/${item.id}`;
  const headers = { Authorization: `Bearer ${endpoint.secret}`, "X-Document-Token": current.token, "X-Revision": "0" };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: "http://example.test" } })).status, 403);
  const bytes = Buffer.alloc(4096, 127);
  assert.equal((await fetch(url, { method: "PUT", headers, body: bytes })).status, 204);
  const download = await fetch(url, { headers });
  assert.equal(download.headers.get("x-revision"), "0");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  current = { token: "document-a", revision: 1 };
  assert.equal((await fetch(url, { headers })).status, 409);
  assets.clear();
  assert.equal(assets.entries.size, 0);
  const cancel = assets.reserve({ name: "cancel", width: 1, height: 1 }, current.token, 1);
  assert.equal((await fetch(`${endpoint.url}/raster/${cancel.id}`, { method: "DELETE",
    headers: { ...headers, "X-Revision": "1" } })).status, 204);
  assert.equal(assets.entries.size, 0);
  const expiry = assets.reserve({ name: "expire", width: 1, height: 1 }, current.token, 1);
  assets.entries.get(expiry.id).created -= 2000;
  assets.sweep();
  assert.equal(assets.entries.size, 0);
});

test("hands-on raster association survives mesh revisions but not replacement; save is not claimed", async () => {
  const { host, nodeId } = await proof();
  const asset = [...host.assets.entries.values()][0];
  assert.equal(asset.token, host.documentToken);
  const state = await projection(host, nodeId);
  assert.equal(state.activeKeyform.positions.length, 18);
  assert.equal((await send(host, "session.serialize")).ok, false);
  const token = host.documentToken;
  await send(host, "session.create");
  assert.equal(host.assets.entries.size, 0);
  assert.equal((await send(host, "mesh.projection", { nodeId }, { documentToken: token })).ok, false);
});

test("native topology Add / Remove / Triangle / Subdivide retain Product identity and exact undo", async () => {
  const { host, nodeId } = await proof();
  let state = await projection(host, nodeId);
  const ids = state.topology.vertexIds;
  const before = structuredClone(host.document.session.project);
  assert.equal((await tool(host, nodeId, "topology.add", { position: { x: 40, y: 40 }, uv: { x: 1, y: 1 } })).ok, true);
  state = await projection(host, nodeId);
  assert.deepEqual(state.topology.vertexIds.slice(0, ids.length), ids);
  const added = state.topology.vertexIds.at(-1);
  assert.equal((await tool(host, nodeId, "topology.connect", { vertexIds: [ids[2], ids[8], added] })).ok, true);
  const connected = structuredClone(host.document.session.project);
  assert.equal((await tool(host, nodeId, "topology.subdivide", { vertexIds: [ids[2], added] })).ok, true);
  await send(host, "session.undo");
  assert.deepEqual(host.document.session.project, connected);
  await send(host, "session.redo");
  assert.equal((await tool(host, nodeId, "topology.remove", { vertexId: added })).ok, true);
  for (let n = 0; n < 4; n++) await send(host, "session.undo");
  assert.deepEqual(host.document.session.project, before);
});

test("one Layout drag precedes visibility history, preserves UVs, exact Undo/Redo; no-op/cancel writes nothing", async () => {
  const { host, nodeId } = await proof();
  await send(host, "headless.execute", { command: { type: "scene.set_visibility", payload: { nodeId, visible: true } } });
  const before = structuredClone(host.document.session.project);
  const count = host.document.session.history.length;
  const state = await projection(host, nodeId);
  const positions = [...state.activeKeyform.positions];
  // A cancelled native preview sends no request; read-only redraw must not alter history.
  await projection(host, nodeId);
  assert.equal(host.document.session.history.length, count);
  assert.equal((await tool(host, nodeId, "deform.move", { positions }, "layout")).ok, true);
  assert.equal(host.document.session.history.length, count);
  positions[0] += 3;
  assert.equal((await tool(host, nodeId, "deform.move", { positions }, "layout")).ok, true);
  assert.equal(host.document.session.history.length, count + 1);
  const after = structuredClone(host.document.session.project);
  assert.deepEqual(after.meshKeyforms[0].uvs, before.meshKeyforms[0].uvs);
  await send(host, "session.undo");
  assert.deepEqual(host.document.session.project, before);
  await send(host, "session.redo");
  assert.deepEqual(host.document.session.project, after);
  const stale = await send(host, "mesh.tool", { nodeId, context: "layout", tool: "deform.move", input: { positions } },
    { expectedRevision: 0 });
  assert.equal(stale.error.code, "revision.conflict");
  assert.equal((await tool(host, nodeId, "topology.remove", {}, "layout")).ok, false);
  assert.equal((await tool(host, nodeId, "deform.move", { positions }, "deform")).ok, false);
});

test("Grid and Contour use preview then explicit ordinary Product apply", async () => {
  const { host, nodeId } = await proof();
  for (const kind of ["grid", "contour"]) {
    const before = structuredClone(host.document.session.project);
    const revision = host.revision;
    const preview = await send(host, "mesh.generatePreview", { nodeId, kind, columns: 3, rows: 4 });
    assert.equal(preview.ok, true);
    assert.ok(preview.payload.candidate.positions.length >= 6);
    assert.equal(host.revision, revision);
    assert.deepEqual(host.document.session.project, before);
    const applied = await tool(host, nodeId, "topology.automesh", { candidate: preview.payload.candidate, replaceExisting: true });
    assert.equal(applied.ok, true, JSON.stringify(applied.error));
    await send(host, "session.undo");
    assert.deepEqual(host.document.session.project, before);
  }
});
