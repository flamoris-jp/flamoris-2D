import { LiveMcpEndpoint } from "./live-mcp-transport.mjs";
import { randomUUID } from "node:crypto";
import { normalizePreferences } from '../src/preferences.js';
import { incrementalFilename } from '../src/io/project-files.js';
import { keyStateProjection, executeKeyStateTool, correspondence, registerSourceParts } from './key-state-authoring.mjs';
import { initializeSourceHistory, collectSourceAssets, beginSourceReview, changeSourceReview, applySourceReview } from './source-reimport.mjs';
import { Worker } from "node:worker_threads";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { MCP_SCHEMA_VERSION } from "../src/mcp/schemas.js";
import { createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { parseProjectDocument, serializeProject } from "../src/io/project-json.js";
import { nativeExportSettings, nativeExportPlan, nativeExportFrame, nativeEncoderContract } from "./native-export.mjs";
import { timelineProjection, executeTimelineTool, playbackTick } from "./timeline-authoring.mjs";
import { rigProjection, executeRigTool } from "./rig-authoring.mjs";
import { evaluatedProjection } from "./evaluated-projection.mjs";
import { prepareDocumentArtwork, attachDocumentArtwork, NATIVE_ARTWORK_LIMITS } from "./document-artwork.mjs";
import { DocumentTransfers } from "./document-transfer.mjs";
import { initializeDocumentLifecycle, serializeDocument, prepareDocumentSave, acknowledgeDocumentSave } from "./document-lifecycle.mjs";
import { RasterAssets } from "./raster-assets.mjs";
import { createHandsOnProject, meshContext, executeMeshTool, generateMeshPreview } from "./mesh-hands-on.mjs";
import {
  PRODUCT_HOST_PROTOCOL_VERSION,
  ProductHostProtocolError,
} from "./protocol.mjs";

const MUTATING_METHODS = new Set([
  "keyState.tool",
  "source.applyReview",
  "session.execute",
  "session.executeTransaction",
  "session.undo",
  "session.redo",
  "headless.execute",
  "headless.executeTransaction",
  "mesh.tool",
  "rig.tool",
  "timeline.tool",
]);

const METHODS = new Set([
  "mcp.enable", "mcp.disable", "mcp.status",
  "native.preferences", "document.incrementalName",
  "keyState.projection", "keyState.tool", "keyState.correspondence",
  "source.analyzeReimport", "source.changeReview", "source.applyReview", "source.discardReview",
  "protocol.handshake",
  "host.health",
  "host.shutdown",
  "session.create",
  "document.new",
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
  "render.project",
  "export.settings",
  "export.plan",
  "export.frame",
  "export.encoder",
  "document.reserve",
  "document.open",
  "source.import",
  "source.cancel",
  "document.prepareSave",
  "document.acknowledgeSave",
  "document.release",
  "assets.reserve",
  "handsOn.open",
  "mesh.projection",
  "rig.projection",
  "timeline.projection",
  "timeline.tool",
  "rig.tool",
  "mesh.tool",
  "mesh.generatePreview",
  "mesh.cancelPreview",
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
    this.queue = Promise.resolve();
    this.commitGuard = null;
    this.mcpControlEpoch = 0;
    this.onExternalEvents = null;
    this.mcp = new LiveMcpEndpoint(this);
    this.document = null;
    this.shutdownRequested = false;
    this.assets = new RasterAssets(() => ({ token: this.documentToken, revision: this.revision }), NATIVE_ARTWORK_LIMITS);
    this.transfers = new DocumentTransfers(() => ({ token: this.documentToken, revision: this.revision }));
    this.assets.documentTransfers = this.transfers;
    this.bulkEndpoint = null;
    this.generation = null;
    this.importJob = null;
  }

  cancelImport(request) {
    if (request?.protocolVersion === PRODUCT_HOST_PROTOCOL_VERSION && request.method === "source.cancel" &&
        request.documentToken === this.documentToken && request.payload?.jobId === this.importJob?.id)
      this.importJob.cancel();
  }
  async importSource(payload, bytes) {
    if (this.importJob || typeof payload.jobId !== "string" || payload.jobId.length > 80) throw new Error("Invalid import job.");
    const worker = new Worker(new URL("./source-import-worker.mjs", import.meta.url), {
      workerData: { bytes, kind: payload.kind, fileName: payload.fileName },
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        this.importJob = { id: payload.jobId, cancel: () => reject(new Error("素材の読み込みを中止しました。")) };
        timeout = setTimeout(() => reject(new Error("素材の読み込みが60秒の上限を超えました。")), 60000);
        worker.once("message", m => m.error ? reject(Object.assign(new Error(m.error.message), m.error)) : resolve(m.result));
        worker.once("error", reject);
        worker.once("exit", code => { if (code) reject(new Error("素材の読み込みWorkerが終了しました。")); });
      });
    } finally { clearTimeout(timeout); this.importJob = null; await worker.terminate(); }
  }

  cancelMeshPreview(request) {
    if (request?.protocolVersion === PRODUCT_HOST_PROTOCOL_VERSION && request.method === "mesh.cancelPreview" &&
        request.documentToken === this.documentToken && request.payload?.previewId === this.generation?.id)
      this.generation?.cancel();
  }

  async generateBoundedPreview(asset, input) {
    if (this.generation || typeof input.previewId !== "string" || input.previewId.length > 80)
      throw new Error("Generation already running or missing preview ID.");
    const token = this.documentToken, revision = this.revision;
    const worker = new Worker(new URL("./mesh-generation-worker.mjs", import.meta.url), {
      workerData: { asset: { width: asset.width, height: asset.height, left: asset.left, top: asset.top, bytes: asset.bytes }, input },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    });
    let timeout;
    try {
      const result = await new Promise((resolve, reject) => {
        this.generation = { id: input.previewId, cancel: () => reject(new Error("生成を中止しました。")) };
        timeout = setTimeout(() => reject(new Error("生成が10秒の体験版上限を超えました。")), 10000);
        worker.once("message", message => message.error ? reject(new Error(message.error)) : resolve(message.result));
        worker.once("error", reject);
        worker.once("exit", code => { if (code) reject(new Error("生成Workerが終了しました。密度や画像サイズを下げてください。")); });
      });
      this.assets.assertCurrent(token, revision);
      return result;
    } finally {
      clearTimeout(timeout); this.generation = null; await worker.terminate();
    }
  }

  get revision() {
    return this.document?.revision ?? null;
  }

  get documentToken() {
    return this.document?.token ?? null;
  }

  #openProject(project, envelope = {}, prepared = null) {
    const session = new EditorSession(project, { beforeCommit: () => this.commitGuard?.() });
    this.mcp.revoke();
    this.assets.clear();
    this.transfers.clear();
    this.document = {
      token: this.createToken(),
      revision: 0,
      session,
      headless: new HeadlessProductAdapter(session),
    };
    initializeDocumentLifecycle(this.document, envelope);
    if (prepared) attachDocumentArtwork(this.document, this.assets, prepared);
    initializeSourceHistory(this.document, this.assets);
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
      this.mcp.revoke();
      this.shutdownRequested = true;
      return { accepted: true };
    }
    if (request.method === "session.create" || request.method === "document.new") {
      if (request.method === "document.new") this.#assertExpectedRevision(request, this.#requireDocument(request));
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
      const parsed = parseProjectDocument(payload.document);
      return this.#openProject(parsed.project, parsed, await prepareDocumentArtwork(parsed, this.assets));
    }

    const document = this.#requireDocument(request);
    if (MUTATING_METHODS.has(request.method)) {
      this.#assertExpectedRevision(request, document);
    }

    switch (request.method) {
      case "mcp.enable":
        this.#assertExpectedRevision(request, document);
        return this.mcp.enable(payload.permission);
      case "mcp.disable": return this.mcp.status();
      case "mcp.status": return this.mcp.status();
      case 'native.preferences':return normalizePreferences(payload.preferences);
      case 'document.incrementalName':
        if(!Array.isArray(payload.existingFileNames)||payload.existingFileNames.length>10000||!payload.existingFileNames.every(n=>typeof n==='string'&&n.length<=260))throw new Error('Invalid incremental filename list.');
        return {fileName:incrementalFilename(payload.fileName,payload.existingFileNames,normalizePreferences(payload.preferences).incrementalSaveWidth)};
      case 'keyState.projection':return keyStateProjection(document.session,payload);
      case 'keyState.tool':return executeKeyStateTool(document.session,payload);
      case 'keyState.correspondence':this.#assertExpectedRevision(request,document);return correspondence(document.session,payload.context,payload.input);
      case "source.analyzeReimport": {
        this.#assertExpectedRevision(request, document);
        document.sourceReview = null; collectSourceAssets(document, this.assets);
        if (payload.kind !== 'psd') throw new Error('既存Productの再取込はPSDに対応しています。');
        const parsed = await this.importSource(payload, this.transfers.uploaded(payload.id, document.token, document.revision));
        this.#assertExpectedRevision(request, document);
        return beginSourceReview(document, this.assets, parsed, await prepareDocumentArtwork(parsed, this.assets));
      }
      case "source.changeReview":
        this.#assertExpectedRevision(request, document); return changeSourceReview(document, payload);
      case "source.applyReview": return applySourceReview(document, this.assets, payload.id);
      case "source.discardReview":
        if (document.sourceReview?.id === payload.id) document.sourceReview = null;
        collectSourceAssets(document, this.assets); return { discarded: true };
      case "export.settings":return nativeExportSettings(document.session);
      case "export.plan":this.#assertExpectedRevision(request,document);return nativeExportPlan(document.session,payload);
      case "export.frame":this.#assertExpectedRevision(request,document);return nativeExportFrame(document,this.assets,payload);
      case "export.encoder":return nativeEncoderContract(payload);
      case "timeline.projection":return timelineProjection(document.session,payload);
      case "timeline.tool":return executeTimelineTool(document.session,payload);
      case "rig.projection":return rigProjection(document.session,payload);
      case "rig.tool":return executeRigTool(document.session,payload);
      case "render.project":
        if (payload.layoutPreview || payload.rigPreview) this.#assertExpectedRevision(request, document);
        if(payload.playback) {
          const clock=playbackTick(document.session,payload);
          return {...evaluatedProjection(document,this.assets,{...payload,timeTicks:clock.timeTicks}),playing:clock.playing};
        }
        return evaluatedProjection(document, this.assets, payload);
      case "source.cancel":
        this.cancelImport(request); return { cancelled: true };
      case "source.import": {
        this.#assertExpectedRevision(request, document);
        const bytes = this.transfers.uploaded(payload.id, document.token, document.revision);
        const parsed = await this.importSource(payload, bytes);
        this.#assertExpectedRevision(request, document);
        const prepared = await prepareDocumentArtwork(parsed, this.assets);
        const opened = this.#openProject(parsed.project, { ...parsed, dirty: true }, prepared);
        registerSourceParts(this.document.session);
        return opened;
      }
      case "document.reserve":
        this.#assertExpectedRevision(request, document);
        return this.transfers.reserve(payload.byteLength, "upload", document.token, document.revision);
      case "document.release":
        this.transfers.get(payload.id, document.token, payload.revision);
        this.transfers.release(payload.id);
        return { released: true };
      case "document.open": {
        this.#assertExpectedRevision(request, document);
        const bytes = this.transfers.uploaded(payload.id, document.token, document.revision);
        const parsed = parseProjectDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const recovery = payload.recovery;
        if (recovery && (![recovery.lineageId, recovery.snapshotId].every(id =>
          typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)))) throw new Error("Invalid Recovery identity.");
        return this.#openProject(parsed.project, { ...parsed, lineageId: recovery?.lineageId,
          restoredSnapshotId: recovery?.snapshotId, dirty: Boolean(recovery) }, await prepareDocumentArtwork(parsed, this.assets));
      }
      case "document.prepareSave":
        this.#assertExpectedRevision(request, document);
        if (document.bindings && !document.renderAssets) throw new Error("PNG proof sessions cannot be saved.");
        return prepareDocumentSave(document, this.transfers, payload.operation);
      case "document.acknowledgeSave":
        // Edits while bytes were being written are allowed. The opaque receipt captures history identity.
        return acknowledgeDocumentSave(document, this.transfers, payload.receiptId);

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
        const session = new EditorSession(project, { beforeCommit: () => this.commitGuard?.() });
        // Bootstrap through ordinary Product transactions, then attach this validated session.
        for (const [nodeId, id] of bindings) {
          const asset = assets.find(a => a.id === id);
          const preview = generateMeshPreview(asset, { kind: "grid", columns: 2, rows: 2 });
          executeMeshTool(session, { nodeId, context: "structure", tool: "topology.automesh",
            input: { candidate: preview.candidate } });
        }
        const token = this.createToken();
        this.assets.adopt(payload.assetIds, document.token, document.revision, token);
        this.mcp.revoke();
        this.document = { token, revision: 0, session, headless: new HeadlessProductAdapter(session), bindings };
        return { documentToken: token, revision: 0, proofOnly: true,
          summary: session.query("project.get_summary", {}) };
      }
      case "mesh.projection": {
        const state = payload.nodeId ? meshContext(document.session, payload, false).preparation.getState() : null;
        const artwork = [...(document.bindings || [])].filter(([nodeId]) => document.session.project.scene.nodes[nodeId]).map(([nodeId, id]) => {
          const asset = this.assets.get(id, document.token, document.revision);
          const node = document.session.query("scene.get_node", { nodeId });
          return { id, nodeId, width: asset.width, height: asset.height, byteLength: asset.byteLength,
            visible: node.effectiveVisible, locked: node.locked, bounds: node.bounds,
            worldTransform: node.worldTransform, left: asset.left ?? 0, top: asset.top ?? 0 };
        });
        return { state, artwork, proofOnly: Boolean(document.bindings && !document.renderAssets), diagnostics: document.artworkDiagnostics || [] };
      }
      case "mesh.tool":
        return executeMeshTool(document.session, payload);
      case "mesh.generatePreview": {
        this.#assertExpectedRevision(request, document);
        const id = document.bindings?.get(payload.nodeId);
        return this.generateBoundedPreview(this.assets.get(id, document.token, document.revision), payload);
      }
      case "mesh.cancelPreview":
        this.cancelMeshPreview(request);
        return { cancelled: true };
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
          lineageId: document.lineageId,
          keyArts: document.session.query("keyart.list", {}),
          transitions: document.session.query("transition.list", {}),
          sequences: document.session.query("sequence.list", {}),
        };
      case "session.execute":
        return document.session.execute(payload.command, { label: payload.label });
      case "session.executeTransaction":
        return document.session.executeTransaction(payload.commands, { label: payload.label });
      case "session.undo":
        return document.sourceHistory ? document.sourceHistory.undo() : document.session.undo();
      case "session.redo":
        return document.sourceHistory ? document.sourceHistory.redo() : document.session.redo();
      case "session.serialize":
        if (document.bindings && !document.renderAssets) throw new Error("Hands-on artwork sessions cannot be saved. Production persistence is not implemented.");
        return { document: serializeDocument(document, payload.spacing ?? 2) };
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

  handle(request, { guard = null, external = false } = {}) {
    const epoch = ['mcp.enable', 'mcp.disable'].includes(request?.method) ? ++this.mcpControlEpoch : null;
    const admissionGuard = () => {
      guard?.();
      if (request?.method === 'mcp.enable' && epoch !== this.mcpControlEpoch)
        throw Object.assign(new Error('MCP permission request superseded.'), { code: 'mcp.revoked' });
    };
    // Signal cancellation/revocation at admission, not behind a worker job.
    this.cancelMeshPreview(request);
    this.cancelImport(request);
    if (request?.protocolVersion === PRODUCT_HOST_PROTOCOL_VERSION &&
        request.method === "mcp.disable" && request.documentToken === this.documentToken)
      this.mcp.revoke();
    const operation = this.queue.then(async () => {
      this.commitGuard = admissionGuard;
      try {
        const result = await this.#handle(request, admissionGuard);
        if (external && result.events.length) await this.onExternalEvents?.(result.events);
        return result;
      } finally { this.commitGuard = null; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async close() {
    this.mcp.revoke();
    this.generation?.cancel(); this.importJob?.cancel();
    await this.queue;
    await this.mcp.close();
    await this.assets.close();
  }

  async #handle(request, guard) {
    const requestId = typeof request?.requestId === "string" ? request.requestId : null;
    const previousRevision = this.revision;
    try {
      guard?.();
      assertEnvelope(request);
      const payload = await this.#dispatch(request);
      const mutated = MUTATING_METHODS.has(request.method) && payload !== null;
      if (mutated) this.document.revision += 1;
      if (this.document) collectSourceAssets(this.document, this.assets);
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
