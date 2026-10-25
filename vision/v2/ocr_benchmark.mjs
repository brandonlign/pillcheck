import {createWorker,PSM} from 'tesseract.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),input=path.join(root,'work/v2/ocr-input'),output=path.join(root,'work/v2/ocr-cache');await mkdir(output,{recursive:true});
const samples=JSON.parse(await readFile(path.join(input,'manifest.json')));
let next=0,done=0;
async function run(){
 const worker=await createWorker('eng',1,{langPath:path.join(root,'node_modules/@tesseract.js-data/eng/4.0.0'),cachePath:path.join(root,'work/v2')});
 await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',user_defined_dpi:'300'});
 while(next<samples.length){const item=samples[next++],filename=path.join(output,`${item.index}.json`);try{await readFile(filename);done++;continue;}catch{}
  const results=[];
  for(const variant of ['rgb','gray']){const r=await worker.recognize(path.join(input,`${item.index}-${variant}.png`),{},{blocks:true});const words=(r.data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[]))).map(w=>({text:w.text,confidence:w.confidence}));results.push({variant,text:r.data.text,confidence:r.data.confidence,words});}
  await writeFile(filename,JSON.stringify({...item,results}));done++;if(done%40===0)console.log('OCR',done,'/',samples.length);
 }
 await worker.terminate();
}
await Promise.all([run(),run()]);console.log('DONE',done);
