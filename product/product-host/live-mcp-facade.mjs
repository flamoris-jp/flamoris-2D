import { commandSchemas, querySchemas, importSchemas, MCP_SCHEMA_VERSION } from '../src/mcp/schemas.js';
import { validateValue } from '../src/commands/schemas.js';
import { projectQueries } from '../src/queries/project.js';
import { LIVE_COMMANDS, LIVE_QUERIES, EXCLUDED_COMMANDS } from './live-mcp-policy.mjs';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const envelope = name => object({ type: { const: name, type: 'string' }, payload: commandSchemas[name] });
export const liveTools = [
  { name: 'live.context', description: 'Read the current Native workspace and shared history.', inputSchema: object({}), method: 'session.workspace', readOnly: true },
  { name: 'live.dispositions', description: 'Audited Product operation dispositions; excluded lifecycle operations remain Native-only.', inputSchema: object({}), readOnly: true },
  ...[...LIVE_QUERIES].sort().map(name => ({ name: `query.${name}`, description: `Product query ${name}.`, inputSchema: object({ input: querySchemas[name] }), method: 'session.query', operation: name, readOnly: true })),
  ...[...LIVE_COMMANDS].sort().map(name => ({ name: `command.${name}`, description: `Product command ${name}. One shared undo unit.`, inputSchema: object({ payload: commandSchemas[name] }), method: 'session.execute', operation: name, readOnly: false })),
  { name: 'live.transaction', description: 'Apply 1–64 typed Product commands atomically as one shared history unit.', inputSchema: object({ commands: { type: 'array', minItems: 1, maxItems: 64, items: { oneOf: [...LIVE_COMMANDS].sort().map(envelope) } }, label: { type: 'string', minLength: 1, maxLength: 160 } }), method: 'session.executeTransaction', readOnly: false },
  ...['undo', 'redo'].map(name => ({ name: `live.${name}`, description: `${name} the shared Native/source-art history.`, inputSchema: object({}), method: `session.${name}`, readOnly: false })),
];
const toolByName = new Map(liveTools.map(tool => [tool.name, tool]));
const reject = () => { throw Object.assign(new Error('Invalid Product tool input.'), { code: 'invalid_request' }); };
export function resolveLiveTool(name, input) {
  const tool = toolByName.get(name);
  if (!tool) reject();
  const issues = [];
  const validationSchema = name === 'live.transaction' ? { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, commands: { type: 'array', minItems: 1, maxItems: 64 } } } : tool.inputSchema;
  validateValue(input, validationSchema, '$', issues);
  if (issues.length) reject();
  if (name === 'live.transaction') {
    if (input.label.length > 160) reject();
    // Product's validator intentionally does not implement JSON Schema oneOf.
    for (const command of input.commands) {
      if (!LIVE_COMMANDS.has(command?.type)) reject();
      const errors = [];
      validateValue(command, envelope(command.type), '$', errors);
      if (errors.length) reject();
    }
  }
  let payload = {};
  if (tool.method === 'session.query') payload = { name: tool.operation, input: input.input };
  if (tool.method === 'session.execute') payload = { command: { type: tool.operation, payload: input.payload }, label: `MCP: ${tool.operation}` };
  if (tool.method === 'session.executeTransaction') payload = input;
  return { ...tool, payload };
}

export function dispositions() {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    commands: Object.keys(commandSchemas).sort().map(name => ({ name, disposition: LIVE_COMMANDS.has(name) ? 'edit' : 'excluded', reason: EXCLUDED_COMMANDS[name] || (!LIVE_COMMANDS.has(name) ? 'Not yet audited for live use' : undefined) })),
    queries: Object.keys(projectQueries).sort().map(name => ({ name, disposition: LIVE_QUERIES.has(name) ? 'read' : 'excluded', reason: !LIVE_QUERIES.has(name) ? 'No public MCP query schema; use sequence/transition evaluation or Native export' : undefined })),
    imports: Object.keys(importSchemas).sort().map(name => ({ name, disposition: 'excluded', reason: 'Native document lifecycle and embedded artwork ownership required' })),
    lifecycle: ['open', 'new', 'save', 'import', 'export-to-path', 'binary-transfer'].map(name => ({ name, disposition: 'excluded', reason: 'Native-only capability' })),
  };
}
