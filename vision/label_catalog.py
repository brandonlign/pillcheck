"""Attach public openFDA names to historical research NDCs; never labels user photos."""
import concurrent.futures,csv,json,time,urllib.request,urllib.parse,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')))
keys=sorted(set(f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows))
terms=[]
for key in keys:
 if len(key.split('-'))!=2:continue
 a,b=key.split('-');terms.extend(set([a.lstrip('0').zfill(4)+'-'+b,a+'-'+b.lstrip('0').zfill(3),a+'-'+b]))
terms=sorted(set(terms));labels={};cache=ROOT/'work/fda-cache';cache.mkdir(exist_ok=True)
def fetch_group(pair):
 i,group=pair;path=cache/(hashlib.sha256('|'.join(group).encode()).hexdigest()+'.json')
 if path.exists():return json.loads(path.read_text())
 query=' OR '.join('product_ndc:"'+t+'"' for t in group)
 url='https://api.fda.gov/drug/ndc.json?'+urllib.parse.urlencode({'search':query,'limit':100})
 for attempt in range(4):
  try:
   data=json.load(urllib.request.urlopen(url,timeout=25));path.write_text(json.dumps(data));return data
  except Exception as e:
   if getattr(e,'code',None)==404:return {}
   time.sleep(2+attempt*2)
 return {}
groups=[terms[i:i+60] for i in range(0,len(terms),60)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for i,data in enumerate(pool.map(fetch_group,enumerate(groups))):
  for r in data.get('results',[]):
   p=r['product_ndc'].split('-');key=p[0].zfill(5)+'-'+p[1].zfill(4)
   ingredients=r.get('active_ingredients',[]);strength=' / '.join(x.get('strength','') for x in ingredients)
   labels[key]={'name':r.get('generic_name',r.get('brand_name',key)).title(),'brand':r.get('brand_name',''),'strength':strength,'manufacturer':r.get('labeler_name',''),'source':'openFDA NDC Directory','productNdc':r['product_ndc']}
  if i%15==0:print('groups',i,'/',len(groups),'names',len(labels),flush=True)
path=ROOT/'public/models/labels.json';path.write_text(json.dumps({'source':'https://api.fda.gov/drug/ndc.json','retrieved':'2026-10-24','labels':labels},separators=(',',':')))
print('DONE',len(labels),'of',len(keys),flush=True)
