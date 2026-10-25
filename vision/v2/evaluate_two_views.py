"""Opposite-face development audit; the old test set is no longer called sealed.
Pairs are chosen by ground-truth product and side, never prediction correctness.
"""
import csv,json,random,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));by_path={r['image_path']:i for i,r in enumerate(rows)};refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];emb=np.load(ROOT/'work/v2/paired-cls/embeddings.npy');products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];pkeys=sorted(set(products));pmap={p:i for i,p in enumerate(pkeys)};refgroups={}
for k,i in enumerate(refs):refgroups.setdefault(products[i],{True:[],False:[]})[rows[i]['is_front']=='True'].append(k)
pairs=[]
for p in split['calibration']:
 i=by_path[p];matches=[by_path[q] for q in split['test'] if products[by_path[q]]==products[i] and rows[by_path[q]]['is_front']!=rows[i]['is_front']]
 if matches:pairs.append((i,matches[0]))
indices=sorted(set(i for pair in pairs for i in pair));sims={i:emb[i]@emb[refs].T for i in indices};correct=[];allresults=[]
for i,j in pairs:
 a=sims[i];b=sims[j];scores=[]
 for p in pkeys:
  group=refgroups[p];af=float(a[group[True]].max());ab=float(a[group[False]].max());bf=float(b[group[True]].max());bb=float(b[group[False]].max());scores.append(max(af+bb,ab+bf)/2)
 order=np.argsort(-np.array(scores));pred=pkeys[order[0]];correct.append(pred==products[i]);allresults.append({'first':rows[i]['image_path'],'second':rows[j]['image_path'],'truth':products[i],'prediction':pred,'score':scores[order[0]],'margin':scores[order[0]]-scores[order[1]],'correct':pred==products[i]})
result={'protocol':'Old calibration/test opposite-face pairs; development only, not a new held-out accuracy claim','model':'paired-cls','pairs':len(pairs),'top1Correct':sum(correct),'top1':float(np.mean(correct)),'examples':allresults};(ROOT/'work/v2/two-view-development.json').write_text(json.dumps(result,indent=2));print({k:v for k,v in result.items() if k!='examples'})
