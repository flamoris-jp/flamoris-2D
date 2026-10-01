import {readFileSync,writeFileSync} from 'node:fs';
import {liveTools,dispositions} from '../../product-host/live-mcp-facade.mjs';
const text=JSON.stringify({tools:liveTools,dispositions:dispositions()})+'\n';
const target=new URL('../src/Flamoris2D.Session/live-catalog.json',import.meta.url);
if(process.argv.includes('--write')) writeFileSync(target,text);else if(readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text) throw Error('Native MCP catalog differs from audited Product contracts');
console.log(`Audited live catalog: ${liveTools.length} tools`);
