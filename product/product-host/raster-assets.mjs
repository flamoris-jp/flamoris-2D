import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const RASTER_LIMITS = Object.freeze({ dimension: 4096, pixels: 4194304,
  bytes: 64 * 1024 * 1024, count: 16, reservationMs: 60000 });
function fail(message, code = "asset.invalid") { throw Object.assign(new Error(message), { code }); }

export class RasterAssets {
  constructor(current, limits = RASTER_LIMITS) {
    this.current = current;
    this.limits = limits;
    this.entries = new Map();
    this.secret = randomBytes(32).toString("hex");
  }
  assertCurrent(token, revision) {
    const current = this.current();
    if (!token || token !== current.token || revision !== current.revision)
      fail("Artwork belongs to an old document/revision.", "asset.stale");
  }
  sweep() {
    for (const [id, asset] of this.entries)
      if (!asset.attached && Date.now() - asset.created > this.limits.reservationMs) this.release(id);
  }
  reserve({ width, height, name }, token, revision) {
    this.sweep();
    this.assertCurrent(token, revision);
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= this.limits.dimension) ||
        width * height > this.limits.pixels || typeof name !== "string" || !name.trim() || name.length > 200)
      fail("PNG dimensions/name exceed the hands-on limits.");
    const byteLength = width * height * 4;
    const used = [...this.entries.values()].reduce((sum, a) => sum + a.byteLength, 0);
    if (this.entries.size >= this.limits.count || used + byteLength > this.limits.bytes)
      fail("Artwork memory budget exceeded.", "asset.budget");
    const id = randomUUID();
    this.entries.set(id, { id, width, height, name, byteLength, token, revision,
      created: Date.now(), attached: false, bytes: null, uploading: false, abort: null });
    return { id, width, height, byteLength, format: "bgra8-straight" };
  }
  get(id, token, revision, ready = true) {
    this.sweep();
    this.assertCurrent(token, revision);
    const asset = this.entries.get(id);
    if (!asset || asset.token !== token || (!asset.attached && asset.revision !== revision))
      fail("Unknown or stale artwork handle.", "asset.stale");
    if (ready && !asset.bytes) fail("Artwork upload has not completed.", "asset.not_ready");
    return asset;
  }
  adopt(ids, oldToken, oldRevision, newToken) {
    const assets = ids.map(id => this.get(id, oldToken, oldRevision));
    if (new Set(ids).size !== ids.length) fail("Duplicate artwork handle.");
    for (const id of [...this.entries.keys()]) if (!ids.includes(id)) this.release(id);
    for (const asset of assets) { asset.token = newToken; asset.revision = 0; asset.attached = true; }
  }
  release(id) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    entry?.abort?.();
    if (entry) entry.bytes = null;
  }
  clear() { for (const id of [...this.entries.keys()]) this.release(id); }
  async start() {
    this.server = createServer((req, res) => this.serve(req, res));
    this.server.maxConnections = 2;
    this.server.requestTimeout = 30000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
    return { url: `http://127.0.0.1:${this.server.address().port}`, secret: this.secret,
      format: "bgra8-straight", limits: this.limits };
  }
  async serve(req, res) {
    let uploading = null;
    try {
      const authorization = Buffer.from(req.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${this.secret}`);
      if (req.headers.origin || authorization.length !== expected.length ||
          !timingSafeEqual(authorization, expected)) { res.writeHead(403).end(); req.resume(); return; }
      const match = /^\/raster\/([a-f0-9-]{36})$/.exec(req.url);
      if (!match || !["GET", "PUT", "DELETE"].includes(req.method)) {
        res.writeHead(404).end(); req.resume(); return;
      }
      const token = req.headers["x-document-token"];
      const revision = Number(req.headers["x-revision"]);
      const asset = this.get(match[1], token, revision, req.method === "GET");
      if (req.method === "DELETE") {
        if (asset.attached) fail("Attached artwork lives with its document.");
        this.release(asset.id); res.writeHead(204).end(); return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": asset.byteLength,
          "Cache-Control": "no-store", "X-Document-Token": token, "X-Revision": String(revision) });
        res.end(asset.bytes); return;
      }
      if (asset.attached || asset.uploading || asset.bytes || req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"]) !== asset.byteLength)
        fail("Raster upload must have the exact reserved length and be single-use.");
      uploading = asset;
      asset.uploading = true;
      asset.abort = () => req.destroy();
      const bytes = Buffer.alloc(asset.byteLength);
      let offset = 0;
      for await (const chunk of req) {
        if (offset + chunk.length > bytes.length) fail("Raster exceeds reservation.");
        chunk.copy(bytes, offset); offset += chunk.length;
      }
      this.get(asset.id, token, revision, false);
      if (offset !== bytes.length) fail("Raster is incomplete.");
      asset.bytes = bytes; asset.uploading = false; asset.abort = null;
      uploading = null;
      res.writeHead(204).end();
    } catch (error) {
      if (uploading) this.release(uploading.id);
      if (!res.headersSent) res.writeHead(error.code === "asset.stale" ? 409 : 400);
      res.end(); req.resume();
    }
  }
  async close() {
    clearInterval(this.timer);
    this.clear();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
  }
}
