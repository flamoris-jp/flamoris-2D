import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
// Compile the trusted Product schema definitions as test input, without importing
// their runtime or maintaining a second set of handwritten native payload rules.
const source = (await readFile(new URL('../../src/commands/schemas.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]+\n/, '').replace(/^export /gm, '');
const schemas = JSON.parse(vm.runInNewContext(source + '\nJSON.stringify({public: commandSchemas, internal: internalCommandSchemas});', {}, { timeout: 1000 }));
const rows = Object.entries(schemas).flatMap(([access, values]) => Object.entries(values)
  .map(([type, schema]) => `    {"${type}", ${access === 'internal'}, R"fl2d(${JSON.stringify(schema)})fl2d"},`));
const text = '// Generated from Product command schemas; run check-command-schemas.mjs --write.\n' +
  '// Compiled input contracts only; this is not command implementation or runtime JS.\n' +
  'static const struct SchemaSource { const char* type; bool internal; const char* json; } schema_sources[] = {\n' + rows.join('\n') + '\n};\n';
const path = new URL('../core/src/command_schemas.inc', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Native compiled command schemas differ from current JS');
