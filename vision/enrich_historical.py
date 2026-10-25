"""Public research NDCs only: cache historical RxNorm concept names offline."""
import concurrent.futures,csv,json,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'public/models/labels.json';data=json.load(open(path));rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));items={}
for r in rows:
 ndc=r['pilltype_id'].split('_')[0];parts=ndc.split('-');key=f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}"
 if key not in data['labels'] and len(parts)==3:items[key]=''.join(parts)
cache=ROOT/'work/rxnorm-cache';cache.mkdir(exist_ok=True)
def fetch(pair):
 key,ndc=pair;p=cache/(ndc+'.json')
 try:
  if p.exists():s=json.load(open(p))
  else:
   time.sleep(.3);s=json.load(urllib.request.urlopen('https://rxnav.nlm.nih.gov/REST/ndcstatus.json?ndc='+ndc,timeout=15));p.write_text(json.dumps(s))
  status=s.get('ndcStatus',{});name=status.get('conceptName')
  if name:return key,{'name':name,'strength':'','manufacturer':'','source':'NLM RxNorm historical NDC status','ndcStatus':status.get('status'),'rxcui':status.get('rxcui')}
 except Exception:pass
 return key,None
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for i,(key,label) in enumerate(pool.map(fetch,items.items())):
  if label:data['labels'][key]=label
  if i%100==0:print(i,'/',len(items),'labels',len(data['labels']),flush=True)
data['additionalSource']='https://rxnav.nlm.nih.gov/REST/ndcstatus.json';path.write_text(json.dumps(data,separators=(',',':')));print('DONE',len(data['labels']),flush=True)
