import { randomUUID } from 'node:crypto';
import { Server, fromJsonSchema, ProtocolError, ResourceNotFoundError } from '@modelcontextprotocol/server';
import { commandSchemas, querySchemas, importSchemas, MCP_SCHEMA_VERSION } from '../src/mcp/schemas.js';
import { projectQueries } from '../src/queries/project.js';
import { LIVE_COMMANDS, LIVE_QUERIES, EXCLUDED_COMMANDS } from './live-mcp-policy.mjs';

const InvalidParamsError = class extends ProtocolError { constructor(message) { super(-32602, message); } };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const token = { type: 'string', minLength: 1, maxLength: 128 };
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const context = { documentToken: token, expectedRevision: revision };
const envelope = name => object({ type: { const: name, type: 'string' }, payload: commandSchemas[name] });
const tools = [
  { name: 'live.context', description: 'Read active document token/revision, shared history availability and permission.', inputSchema: object({}), method: 'session.workspace', readOnly: true },
  ...[...LIVE_QUERIES].sort().map(name => ({ name: `query.${name}`, description: `Product query ${name}. Returns current revision; coordinates and ticks follow Product schema.`, inputSchema: object({ documentToken: token, input: querySchemas[name] }), method: 'session.query', operation: name, readOnly: true })),
  ...[...LIVE_COMMANDS].sort().map(name => ({ name: `command.${name}`, description: `Product command ${name}. One shared undo unit; stale revision rejects.`, inputSchema: object({ ...context, payload: commandSchemas[name] }), method: 'session.execute', operation: name, readOnly: false })),
  { name: 'live.transaction', description: 'Apply up to 64 typed Product commands atomically as one shared undo unit.', inputSchema: object({ ...context, commands: { type: 'array', minItems: 1, maxItems: 64, items: { oneOf: [...LIVE_COMMANDS].sort().map(envelope) } }, label: { type: 'string', minLength: 1, maxLength: 160 } }), method: 'session.executeTransaction', readOnly: false },
  ...['undo', 'redo'].map(name => ({ name: `live.${name}`, description: `${name} the shared Native history, including source artwork.`, inputSchema: object(context), method: `session.${name}`, readOnly: false })),
];
const validators = new Map(tools.map(tool => [tool.name, fromJsonSchema(tool.inputSchema)]));
const toolByName = new Map(tools.map(tool => [tool.name, tool]));
const visibleTool = ({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false } });
export const DISPOSITION_URI = 'flamoris://live/dispositions';
const schemaUri = name => `flamoris://schema/${name}`;
const resources = [{ uri: DISPOSITION_URI, name: 'Product operation dispositions', mimeType: 'application/json' }, ...tools.map(t => ({ uri: schemaUri(t.name), name: t.name, mimeType: 'application/schema+json' }))];

export function dispositions() {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    commands: Object.keys(commandSchemas).sort().map(name => ({ name, disposition: LIVE_COMMANDS.has(name) ? 'edit' : 'excluded', reason: EXCLUDED_COMMANDS[name] || (!LIVE_COMMANDS.has(name) ? 'Not yet audited for live use' : undefined) })),
    queries: Object.keys(projectQueries).sort().map(name => ({ name, disposition: LIVE_QUERIES.has(name) ? 'read' : 'excluded', reason: !LIVE_QUERIES.has(name) ? 'No public MCP query schema; use sequence/transition evaluation or Native export' : undefined })),
    imports: Object.keys(importSchemas).sort().map(name => ({ name, disposition: 'excluded', reason: 'Native document lifecycle and embedded artwork ownership required' })),
    lifecycle: ['open', 'new', 'save', 'import', 'export-to-path', 'binary-transfer'].map(name => ({ name, disposition: 'excluded', reason: 'Native-only capability' })),
  };
}
function page(entries, cursor) {
  if (cursor !== undefined && !/^(0|[1-9][0-9]*)$/.test(cursor)) throw new InvalidParamsError('Invalid discovery cursor.');
  const offset = Number(cursor || 0);
  if (!Number.isSafeInteger(offset) || offset > entries.length) throw new InvalidParamsError('Invalid discovery cursor.');
  return { entries: entries.slice(offset, offset + 32), ...(offset + 32 < entries.length ? { nextCursor: String(offset + 32) } : {}) };
}
const failure = code => ({ isError: true, content: [{ type: 'text', text: code }], structuredContent: { error: { code } } });

// Protocol instances hold no Project/session/history. All reads and edits enter the service queue.
export function createLiveMcpServer(service, attachment, scope) {
  const server = new Server({ name: 'flamoris-2d-native', version: '0.4.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler('tools/list', request => {
    scope.guard();
    const p = page(tools.filter(t => t.readOnly || attachment.permission === 'edit'), request.params?.cursor);
    return { tools: p.entries.map(visibleTool), ...(p.nextCursor ? { nextCursor: p.nextCursor } : {}) };
  });
  server.setRequestHandler('resources/list', request => {
    scope.guard(); const p = page(resources, request.params?.cursor);
    return { resources: p.entries, ...(p.nextCursor ? { nextCursor: p.nextCursor } : {}) };
  });
  server.setRequestHandler('resources/read', request => {
    scope.guard(); const uri = request.params.uri;
    const tool = tools.find(t => schemaUri(t.name) === uri);
    if (uri !== DISPOSITION_URI && !tool) throw new ResourceNotFoundError('Unknown schema resource.');
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(tool ? visibleTool(tool) : dispositions()) }] };
  });
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) throw new InvalidParamsError('Unknown live Product tool.');
    if (!tool.readOnly && attachment.permission !== 'edit') return failure('mcp.read_only');
    const args = request.params.arguments ?? {};
    const valid = await validators.get(tool.name)['~standard'].validate(args);
    if (valid.issues) throw new InvalidParamsError('Arguments do not match the Product tool schema.');
    const guard = () => { scope.guard(); if (ctx.mcpReq.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'mcp.cancelled' }); };
    let payload = {};
    if (tool.method === 'session.query') payload = { name: tool.operation, input: args.input };
    if (tool.method === 'session.execute') payload = { command: { type: tool.operation, payload: args.payload }, label: `MCP: ${tool.operation}` };
    if (tool.method === 'session.executeTransaction') payload = { commands: args.commands, label: args.label };
    const { response } = await service.handle({ protocolVersion: 1, requestId: `mcp-${randomUUID()}`, method: tool.method,
      documentToken: tool.name === 'live.context' ? attachment.documentToken : args.documentToken,
      expectedRevision: args.expectedRevision, payload }, { guard, external: true });
    if (!response.ok) return failure(response.error.code);
    const result = { documentToken: response.documentToken, revision: response.revision,
      permission: attachment.permission, result: response.payload };
    // A successful edit response remains tiny; do not turn a committed edit into an ambiguous size error.
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) return failure('mcp.result_too_large');
    return { content: [{ type: 'text', text }], structuredContent: result };
  });
  return server;
}
