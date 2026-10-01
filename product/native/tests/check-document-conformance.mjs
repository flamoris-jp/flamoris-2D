import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createProject, createIdFactory } from '../../src/model/project.js';
import { parseProjectDocument, createFl2dDocument } from '../../src/io/project-json.js';
import { validateProject } from '../../src/model/validation.js';

const path = new URL('./document-conformance.json', import.meta.url);
const now = '2026-10-01T03:00:00.000Z';
const basic = createProject({name:'愛乃',width:64,height:64,idFactory:createIdFactory('native-document')});
const cases=[];
function add(name, source) {
  try { cases.push({name,source,expected:parseProjectDocument(source)}); }
  catch(error) {cases.push({name,source,error:error.code || 'project.invalid',details:error.details ?? null});}
}
add('bare-current',basic);
for(let schema=1;schema<=15;schema++) {
  const p=structuredClone(basic);p.schemaVersion=schema;
  if(schema===1)p.renderSettings={fps:29.97,duration:8,alpha:false};
  add(`schema-${schema}`,p);
}
const assets=[{nodeId:basic.scene.rootId,width:1,height:1,dataUrl:'data:image/png;base64,AQIDBA=='}];
const envelope=createFl2dDocument(basic,{now:()=>new Date(now),renderAssets:assets});
add('current-envelope',envelope);
add('format-zero',{format:'flamoris-2d-project',formatVersion:0,project:basic});
for(const [name,change] of [
  ['newer',d=>d.formatVersion=2],['missing-version',d=>delete d.formatVersion],
  ['wrong-format',d=>d.format='unknown'],['identity-blank',d=>d.name='\u3000'],
  ['invalid-date',d=>d.modifiedAt='yesterdayish'],['unsupported-schema',d=>d.project.schemaVersion=99],
  ['invalid-project',d=>d.project.canvas.width=0],['nonarray-assets',d=>d.renderAssets={}],
]) {const d=structuredClone(envelope);change(d);add(name,d);}
const malformed13=structuredClone(basic);malformed13.schemaVersion=13;malformed13.sequences=null;add('malformed-13-sequences',malformed13);
const malformed14=structuredClone(basic);malformed14.schemaVersion=14;malformed14.animation.deformationSamples=[{}];add('malformed-14-samples',malformed14);
const serialize=[];
const options={now,createdAt:now,modifiedAt:now,renderAssets:assets};
serialize.push({name:'basic',project:basic,options,expected:createFl2dDocument(basic,{...options,now:()=>new Date(now)})});
const seen=new Set([JSON.stringify(basic)]);
for(const filename of ['project-conformance.json','rig-conformance.json','hierarchy-conformance.json','mesh-session-conformance.json','temporal-session-conformance.json','transition-session-conformance.json','query-conformance-3.json']) {
  const input=JSON.parse(await readFile(new URL(filename,import.meta.url),'utf8'));let count=0;
  function collect(value) {
    if(!value || typeof value!=='object')return;
    if(value.schemaVersion===15 && value.scene && !validateProject(value).some(i=>i.severity==='error')) {
      const key=JSON.stringify(value);if(seen.has(key) || count>=1)return;seen.add(key);count++;
      const p=structuredClone(value);const expected=createFl2dDocument(p,{...options,now:()=>new Date(now)});
      serialize.push({name:`${filename}-${count}`,project:p,options,expected});
      add(`${filename}-${count}-reopen`,expected);
      if(p.temporalPrograms?.length) {
        const old=structuredClone(p);old.schemaVersion=14;old.animation.deformationSamples=[];
        add(`${filename}-${count}-schema14`,old);
      }
      return;
    }
    for(const child of Object.values(value))collect(child);
  }
  collect(input);
}
const result={parse:cases,serialize};
if(process.argv.includes('--write'))await writeFile(path,JSON.stringify(result)+'\n');
else assert.deepEqual(JSON.parse(await readFile(path,'utf8')),result);
console.log(`Document conformance: ${cases.length} parse and ${serialize.length} save cases match current JS.`);
