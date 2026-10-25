import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {detectPills} from '../../public/recognition-core.js';
const root=process.cwd(),dir=path.join(root,'work/v2/external-dev'),manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'))),results=[];
for(const item of manifest){const bytes=await readFile(path.join(dir,item.rgba));const frame={data:new Uint8ClampedArray(bytes.buffer,bytes.byteOffset,bytes.byteLength),width:item.width,height:item.height};const original=detectPills(frame);const adaptive=detectPills(frame,{illumination:true});results.push({...item,original:{components:original.components,quality:original.quality},adaptive:{components:adaptive.components,quality:adaptive.quality}});}
await writeFile(path.join(dir,'detection.json'),JSON.stringify(results));
for(const variant of ['original','adaptive'])console.log(variant,{frames:results.length,nonempty:results.filter(r=>r[variant].components.length>0).length,qualityPass:results.filter(r=>r[variant].components.length>0&&!r[variant].quality.length).length,tooManyRegions:results.filter(r=>r[variant].components.length>5).length});
