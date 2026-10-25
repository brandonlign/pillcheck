"""Ablation on validation only. Never use sealed archive photos for tuning."""
import csv,json,re,collections
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));pathmap={r['image_path']:i for i,r in enumerate(rows)};refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];queries=[pathmap[p] for p in split['calibration']];products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];metadata=json.load(open(ROOT/'work/nih-xml/products.json'));emb=np.load(ROOT/'work/v2/paired-cls/embeddings.npy');similarities=emb[queries]@emb[refs].T
catalog=sorted(set(products));pmap={p:i for i,p in enumerate(catalog)};base=np.full((len(queries),len(catalog)),-1,dtype=np.float32)
for k,i in enumerate(refs):base[:,pmap[products[i]]]=np.maximum(base[:,pmap[products[i]]],similarities[:,k])
# Only exact, reasonably long, high-confidence tokens are allowed to contribute.
imprint_tokens={p:set(re.findall(r'[A-Z0-9]+',' '.join(v.get('imprints',[])).upper())) for p,v in metadata.items()};frequency=collections.Counter(t for tokens in imprint_tokens.values() for t in tokens);boost=np.zeros_like(base);usable=0
for j,index in enumerate(queries):
 result=json.load(open(ROOT/f'work/v2/ocr-cache/{j}.json'));tokens={re.sub('[^A-Z0-9]','',w['text']) for variant in result['results'] for w in variant['words'] if w['confidence']>=85};tokens={t for t in tokens if len(t)>=4 and frequency[t]>0 and frequency[t]<=8}
 if tokens:usable+=1
 for p,k in pmap.items():
  matches=tokens&imprint_tokens.get(p,set())
  if matches:boost[j,k]=1
truth=np.array([pmap[products[i]] for i in queries]);baseline=float(np.mean(base.argmax(1)==truth));output={'validationImages':len(queries),'usableUniqueTokens':usable,'baselineTop1':baseline,'experiments':[]}
for weight in [.02,.04,.06,.08,.10,.15,.20]:
 scores=base+boost*weight;accuracy=float(np.mean(scores.argmax(1)==truth));output['experiments'].append({'exactImprintBonus':weight,'top1':accuracy})
print(json.dumps(output,indent=2));(ROOT/'work/v2/ocr-ablation.json').write_text(json.dumps(output,indent=2))
