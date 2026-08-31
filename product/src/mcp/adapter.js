import { cloneProject } from "../model/project.js";
import { commandSchemas } from "../commands/schemas.js";
import { querySchemas, MCP_SCHEMA_VERSION } from "./schemas.js";

export class HeadlessProductAdapter {
  constructor(session) {
    this.session = session;
  }

  capabilities() {
    return {
      schemaVersion: MCP_SCHEMA_VERSION,
      queries: cloneProject(querySchemas),
      commands: cloneProject(commandSchemas),
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
}
