// Test-only pinned decoder oracle; production does not depend on ag-psd.
import {readFileSync,writeFileSync} from 'node:fs';
import {writePsd,readPsd,initializeCanvas} from 'ag-psd';
import {rasterFingerprint} from '../../src/io/raster-fingerprint.js';
initializeCanvas(()=>{throw Error('Canvas is not part of this test');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const image=(width,height,data)=>({width,height,data:Uint8ClampedArray.from(data)});
const cases=[];
const source={width:3,height:2,children:[{name:'portrait',id:0,left:0,top:0,imageData:image(2,1,[1,2,3,255,4,5,6,128]),blendMode:'multiply',opacity:.5},{name:'日本語🌸',id:2,hidden:true,children:[{name:'leaf',id:3,left:1,top:1,imageData:image(1,1,[10,20,30,64])}]}]};
for(const compress of [false,true]) {
 const archive=new Uint8Array(writePsd(source,{generateThumbnail:false,compress}));
 const decoded=readPsd(archive,{useImageData:true,skipThumbnail:true,skipCompositeImageData:true,skipLinkedFilesData:true});
 function tree(layer){ const result={name:layer.name,id:layer.id,left:layer.left,top:layer.top,right:layer.right,bottom:layer.bottom,hidden:!!layer.hidden,opacity:layer.opacity,blendMode:layer.blendMode}; if(layer.children) result.children=layer.children.map(tree);else if(layer.imageData){const d=layer.imageData;result.rgba=[...new Uint8Array(d.data)];result.width=d.width;result.height=d.height;result.rasterFingerprint=rasterFingerprint({width:d.width,height:d.height,getContext:()=>({getImageData:()=>d})});} return result;}
 cases.push({name:compress?'ZIP PSD':'RLE PSD',archive:Buffer.from(archive).toString('base64'),children:decoded.children.map(tree)});
}
const output=JSON.stringify(cases)+'\n',path=new URL('./psd-codec-conformance.json',import.meta.url);
if(process.argv.includes('--write')) writeFileSync(path,output);else if(readFileSync(path,'utf8').replace(/\r\n/g,'\n')!==output) throw Error('PSD codec oracle drift');
console.log(`PSD codec conformance: ${cases.length} files`);
