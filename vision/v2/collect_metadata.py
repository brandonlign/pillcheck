"""Public NIH per-image metadata, including imprint/color/shape and attribution."""
from pathlib import Path
import json,concurrent.futures,urllib.request,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'work/nih-xml';out.mkdir(exist_ok=True)
def get(disc):
 p=out/f'PillProjectDisc{disc}.xml'
 try:
  if not p.exists():p.write_bytes(urllib.request.urlopen(f'https://data.lhncbc.nlm.nih.gov/public/Pills/ALLXML/PillProjectDisc{disc}.xml',timeout=30).read())
  tree=ET.parse(p);records=[]
  for image in tree.findall('.//Image'):
   item={child.tag:child.text for child in image if len(child)==0};file=image.find('File');item['file']=file.findtext('Name') if file is not None else None;item['disc']=disc
   if item.get('NDC11'):records.append(item)
  return records
 except Exception as e:print('error',disc,str(e),flush=True);return []
records=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for i,items in enumerate(pool.map(get,range(1,111))):
  records.extend(items)
  if i%10==0:print(i,'/ 110 records',len(records),flush=True)
products={}
for r in records:
 ndc=r['NDC11'];key=ndc[:5]+'-'+ndc[5:9];p=products.setdefault(key,{'ndcs':set(),'names':set(),'imprints':set(),'colors':set(),'shapes':set(),'attribution':set()})
 for field,target in [('NDC11','ndcs'),('GenericName','names'),('ProprietaryName','names'),('Imprint','imprints'),('Color','colors'),('Shape','shapes'),('Attribution','attribution')]:
  if r.get(field):p[target].add(r[field])
products={k:{x:sorted(y) for x,y in v.items()} for k,v in products.items()}
(out/'products.json').write_text(json.dumps(products,indent=2));(out/'images.json').write_text(json.dumps(records,separators=(',',':')));print('DONE',len(products),'products',len(records),'images',flush=True)
