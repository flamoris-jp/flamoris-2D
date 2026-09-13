import { cloneProject } from "../model/project.js";
import { commandSchemas } from "../commands/schemas.js";
import { querySchemas, MCP_SCHEMA_VERSION } from "./schemas.js";
import { importSchemas } from "./schemas.js";
import { importCutworkFlimg } from "../io/cutwork-flimg-project.js";

export class HeadlessProductAdapter {
  constructor(session, { onImported = null } = {}) {
    this.session = session;
    this.onImported = onImported;
    this.renderAssets = [];
  }

  capabilities() {
    return {
      schemaVersion: MCP_SCHEMA_VERSION,
      queries: cloneProject(querySchemas),
      commands: cloneProject(commandSchemas),
      imports: cloneProject(importSchemas),
    };
  }

  query(name, input = {}) {
    if (!querySchemas[name]) throw new Error(`Unknown headless query ${name}.`);
    return this.session.query(name, input);
  }

  execute(command, options = {}) {
    // EditorSession performs the same command-schema validation used by the UI.
    return this.session.execute(command, options);
  }

  executeTransaction(commands, options = {}) {
    return this.session.executeTransaction(commands, options);
  }

  async import(name, input = {}, options = {}) {
    if (!importSchemas[name]) throw new Error(`Unknown headless import ${name}.`);
    if (name !== "import.cutwork_flimg") throw new Error(`Unsupported headless import ${name}.`);
    if (typeof input.fileName !== "string" || !input.fileName.trim() ||
      !(input.bytes instanceof Uint8Array || Array.isArray(input.bytes))) {
      throw new TypeError("Cutwork import requires a fileName and archive bytes.");
    }
    const bytes = input.bytes instanceof Uint8Array
      ? input.bytes : Uint8Array.from(input.bytes);
    if (Array.isArray(input.bytes) && input.bytes.some((byte) =>
      !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new TypeError("Cutwork archive bytes must be integers in the range 0..255.");
    }
    // Read, materialize, convert, and validate the complete candidate before
    // the current EditorSession is replaced.
    const candidate = await importCutworkFlimg(bytes, {
      ...options,
      fileName: input.fileName,
      projectName: options.projectName || input.fileName,
    });
    this.session.replaceProject(candidate.project, { saved: false });
    this.renderAssets = candidate.renderAssets;
    this.onImported?.({
      project: cloneProject(candidate.project),
      renderAssets: candidate.renderAssets,
      result: cloneProject(candidate.result),
    });
    return cloneProject(candidate.result);
  }
}
