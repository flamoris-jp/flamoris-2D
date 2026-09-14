import { randomUUID } from "node:crypto";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { MCP_SCHEMA_VERSION } from "../src/mcp/schemas.js";
import { createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { parseProjectDocument, serializeProject } from "../src/io/project-json.js";
import { RasterAssets } from "./raster-assets.mjs";
import { createHandsOnProject, meshContext, executeMeshTool, generateMeshPreview } from "./mesh-hands-on.mjs";
import {
  PRODUCT_HOST_PROTOCOL_VERSION,
  ProductHostProtocolError,
} from "./protocol.mjs";

const MUTATING_METHODS = new Set([
  "session.execute",
  "session.executeTransaction",
  "session.undo",
  "session.redo",
  "headless.execute",
  "headless.executeTransaction",
  "mesh.tool",
]);

const METHODS = new Set([
  "protocol.handshake",
  "host.health",
  "host.shutdown",
  "session.create",
  "session.open",
  "session.query",
  "session.execute",
  "session.executeTransaction",
  "session.undo",
  "session.redo",
  "session.serialize",
  "session.history",
  "session.workspace",
  "headless.capabilities",
  "headless.query",
  "headless.execute",
  "headless.executeTransaction",
  "assets.reserve",
  "handsOn.open",
  "mesh.projection",
  "mesh.tool",
  "mesh.generatePreview",
]);

function structuredError(error) {
  return {
    code: error?.code || "product.operation_failed",
    message: error?.message || "Product Host operation failed.",
    details: error?.details || (error?.issues ? { issues: error.issues } : {}),
    retryable: error?.code === "revision.conflict",
  };
}

function assertEnvelope(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ProductHostProtocolError("Request must be an object.");
  }
  if (request.protocolVersion !== PRODUCT_HOST_PROTOCOL_VERSION) {
    throw new ProductHostProtocolError(
      "Unsupported Product Host protocol version.",
      "protocol.version_unsupported",
      { supported: [PRODUCT_HOST_PROTOCOL_VERSION], received: request.protocolVersion },
    );
  }
  if (typeof request.requestId !== "string" || !request.requestId.trim()) {
    throw new ProductHostProtocolError("requestId is required.", "protocol.request_id_required");
  }
  if (typeof request.method !== "string" || !METHODS.has(request.method)) {
    throw new ProductHostProtocolError(
      "Unknown Product Host method.",
      "protocol.method_unknown",
      { method: request.method },
    );
  }
}

export class ProductHostService {
  constructor({ createToken = () => `document-${randomUUID()}` } = {}) {
    this.createToken = createToken;
    this.document = null;
    this.shutdownRequested = false;
    this.assets = new RasterAssets(() => ({ token: this.documentToken, revision: this.revision }));
    this.bulkEndpoint = null;
  }

  get revision() {
    return this.document?.revision ?? null;
  }

  get documentToken() {
    return this.document?.token ?? null;
  }

  #openProject(project) {
    const session = new EditorSession(project);
    this.assets.clear();
    this.document = {
      token: this.createToken(),
      revision: 0,
      session,
      headless: new HeadlessProductAdapter(session),
    };
    return {
      documentToken: this.document.token,
      revision: this.document.revision,
      summary: session.query("project.get_summary", {}),
    };
  }

  #requireDocument(request) {
    if (!this.document) {
      throw new ProductHostProtocolError("No document is open.", "document.not_open");
    }
    if (request.documentToken !== this.document.token) {
      throw new ProductHostProtocolError(
        "The document token is not current.",
        "document.token_stale",
        { currentDocumentToken: this.document.token },
      );
    }
    return this.document;
  }

  #assertExpectedRevision(request, document) {
    if (!Number.isSafeInteger(request.expectedRevision)) {
      throw new ProductHostProtocolError(
        "A mutating request requires expectedRevision.",
        "revision.expected_required",
      );
    }
    if (request.expectedRevision !== document.revision) {
      throw new ProductHostProtocolError(
        "The client projection is stale.",
        "revision.conflict",
        { expectedRevision: request.expectedRevision, currentRevision: document.revision },
      );
    }
  }

  async #dispatch(request) {
    const payload = request.payload || {};
    if (request.method === "protocol.handshake") {
      return {
        protocolVersion: PRODUCT_HOST_PROTOCOL_VERSION,
        productSchemaVersion: PROJECT_SCHEMA_VERSION,
        mcpSchemaVersion: MCP_SCHEMA_VERSION,
        runtime: { name: "node", minimumMajor: 24, actual: process.versions.node },
        bulk: this.bulkEndpoint,
      };
    }
    if (request.method === "host.health") {
      return {
        status: "healthy",
        documentOpen: Boolean(this.document),
        documentToken: this.documentToken,
      };
    }
    if (request.method === "host.shutdown") {
      this.shutdownRequested = true;
      return { accepted: true };
    }
    if (request.method === "session.create") {
      const width = Number(payload.width ?? 1920);
      const height = Number(payload.height ?? 1080);
      if (!Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0) {
        throw new ProductHostProtocolError(
          "Canvas dimensions must be positive integers.",
          "document.canvas_invalid",
        );
      }
      return this.#openProject(createProject({
        id: typeof payload.id === "string" && payload.id.trim() ? payload.id : undefined,
        name: typeof payload.name === "string" && payload.name.trim() ? payload.name : "Untitled",
        width,
        height,
      }));
    }
    if (request.method === "session.open") {
      if (typeof payload.document !== "string") {
        throw new ProductHostProtocolError(
          "session.open requires serialized .fl2d content.",
          "document.content_required",
        );
      }
      return this.#openProject(parseProjectDocument(payload.document).project);
    }

    const document = this.#requireDocument(request);
    if (MUTATING_METHODS.has(request.method)) {
      this.#assertExpectedRevision(request, document);
    }

    switch (request.method) {
      case "assets.reserve":
        this.#assertExpectedRevision(request, document);
        return this.assets.reserve(payload, document.token, document.revision);
      case "handsOn.open": {
        this.#assertExpectedRevision(request, document);
        if (!Array.isArray(payload.assetIds) || payload.assetIds.length > 16 ||
            new Set(payload.assetIds).size !== payload.assetIds.length)
          throw new Error("Invalid artwork selection.");
        const assets = payload.assetIds.map(id => this.assets.get(id, document.token, document.revision));
        const { project, bindings } = createHandsOnProject(assets);
        const session = new EditorSession(project);
        // Bootstrap through ordinary Product transactions, then attach this validated session.
        for (const [nodeId, id] of bindings) {
          const asset = assets.find(a => a.id === id);
          const preview = generateMeshPreview(asset, { kind: "grid", columns: 2, rows: 2 });
          executeMeshTool(session, { nodeId, context: "structure", tool: "topology.automesh",
            input: { candidate: preview.candidate } });
        }
        const token = this.createToken();
        this.assets.adopt(payload.assetIds, document.token, document.revision, token);
        this.document = { token, revision: 0, session, headless: new HeadlessProductAdapter(session), bindings };
        return { documentToken: token, revision: 0, proofOnly: true,
          summary: session.query("project.get_summary", {}) };
      }
      case "mesh.projection": {
        const state = payload.nodeId ? meshContext(document.session, payload, false).preparation.getState() : null;
        const artwork = [...(document.bindings || [])].map(([nodeId, id]) => {
          const asset = this.assets.get(id, document.token, document.revision);
          const node = document.session.query("scene.get_node", { nodeId });
          return { id, nodeId, width: asset.width, height: asset.height, byteLength: asset.byteLength,
            visible: node.effectiveVisible, locked: node.locked, bounds: node.bounds,
            worldTransform: node.worldTransform };
        });
        return { state, artwork, proofOnly: Boolean(document.bindings) };
      }
      case "mesh.tool":
        return executeMeshTool(document.session, payload);
      case "mesh.generatePreview": {
        this.#assertExpectedRevision(request, document);
        const id = document.bindings?.get(payload.nodeId);
        return generateMeshPreview(this.assets.get(id, document.token, document.revision), payload);
      }
      case "session.query":
        return document.session.query(payload.name, payload.input || {});
      case "session.workspace":
        // One serialized read: do not combine tree/history from different revisions in WPF.
        return {
          summary: document.session.query("project.get_summary", {}),
          tree: document.session.query("scene.get_tree", { includeHidden: true }),
          canUndo: document.session.undoStack.length > 0,
          canRedo: document.session.redoStack.length > 0,
          isDirty: document.session.isDirty,
          editorRevision: document.session.currentRevision,
          savedRevision: document.session.savedRevision,
        };
      case "session.execute":
        return document.session.execute(payload.command, { label: payload.label });
      case "session.executeTransaction":
        return document.session.executeTransaction(payload.commands, { label: payload.label });
      case "session.undo":
        return document.session.undo();
      case "session.redo":
        return document.session.redo();
      case "session.serialize":
        if (document.bindings) throw new Error("Hands-on artwork sessions cannot be saved. Production persistence is not implemented.");
        return { document: serializeProject(document.session.project, payload.spacing ?? 2) };
      case "session.history":
        return {
          entries: document.session.history,
          canUndo: document.session.undoStack.length > 0,
          canRedo: document.session.redoStack.length > 0,
          editorRevision: document.session.currentRevision,
        };
      case "headless.capabilities":
        return document.headless.capabilities();
      case "headless.query":
        return document.headless.query(payload.name, payload.input || {});
      case "headless.execute":
        return document.headless.execute(payload.command, { label: payload.label });
      case "headless.executeTransaction":
        return document.headless.executeTransaction(payload.commands, { label: payload.label });
      default:
        throw new ProductHostProtocolError("Unknown Product Host method.", "protocol.method_unknown");
    }
  }

  async handle(request) {
    const requestId = typeof request?.requestId === "string" ? request.requestId : null;
    const previousRevision = this.revision;
    try {
      assertEnvelope(request);
      const payload = await this.#dispatch(request);
      const mutated = MUTATING_METHODS.has(request.method) && payload !== null;
      if (mutated) this.document.revision += 1;
      const response = {
        protocolVersion: PRODUCT_HOST_PROTOCOL_VERSION,
        type: "response",
        requestId,
        documentToken: this.documentToken,
        revision: this.revision,
        ok: true,
        payload,
      };
      const events = mutated ? [{
        protocolVersion: PRODUCT_HOST_PROTOCOL_VERSION,
        type: "event",
        event: "document.changed",
        documentToken: this.documentToken,
        revision: this.revision,
        payload: { method: request.method },
      }] : [];
      return { response, events };
    } catch (error) {
      return {
        response: {
          protocolVersion: PRODUCT_HOST_PROTOCOL_VERSION,
          type: "response",
          requestId,
          documentToken: this.documentToken,
          revision: this.revision ?? previousRevision,
          ok: false,
          error: structuredError(error),
        },
        events: [],
      };
    }
  }
}
