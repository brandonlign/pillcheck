"""Package an evaluated model; threshold selection uses calibration, never test.
Run after train.py or train_dino.py. This evaluates product NDC retrieval,
merging duplicate appearances of the same labeler/product.
"""
import argparse,csv,json,shutil,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[1]
def product(s):
 parts=s.split('-');return parts[0].zfill(5)+'-'+parts[1].zfill(4)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--dino',action='store_true');args=ap.parse_args()
 source=ROOT/('work/dino-export' if args.dino else 'public/models');examples=ROOT/('work/dino-examples' if args.dino else 'public/examples')
 rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));manifest=json.load(open(source/'catalog.json'));split=json.load(open(ROOT/'models/split.json'));emb=np.load(ROOT/('work/dino-embeddings.npy' if args.dino else 'work/embeddings.npy'));rowmap={r['image_path']:i for i,r in enumerate(rows)}
 refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];row_by_pid={r['pilltype_id']:r for r in rows}
 for entry in manifest['catalog']:
  r=row_by_pid[entry['id']];entry['ndc']=entry['id'].split('_')[0] if '-' in entry['id'].split('_')[0] else f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}"
 refproducts=[product(manifest['catalog'][idx]['ndc']) for idx in manifest['referenceIds']]
 def evaluate(paths):
  indices=[rowmap[p] for p in paths];scores=[];margins=[];correct=[];top3=[];pred=[]
  for start in range(0,len(indices),128):
   sims=emb[indices[start:start+128]]@emb[refs].T
   for j,sim in enumerate(sims):
    ordered=np.argsort(-sim);distinct=[];seen=set()
    for k in ordered[:60]:
     key=refproducts[k]
     if key in seen:continue
     seen.add(key);distinct.append((key,float(sim[k]),int(k)))
     if len(distinct)==3:break
    r=rows[indices[start+j]];truth=f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}"
    scores.append(distinct[0][1]);margins.append(distinct[0][1]-distinct[1][1]);correct.append(distinct[0][0]==truth);top3.append(any(x[0]==truth for x in distinct));pred.append(distinct[0][2])
  return {'indices':indices,'scores':np.array(scores),'margins':np.array(margins),'correct':np.array(correct),'top3':np.array(top3),'pred':pred}
 cal=evaluate(split['calibration']);test=evaluate(split['test']);candidates=[]
 # This is an exploratory abstention gate, not a calibrated probability or clinical guarantee.
 for threshold in np.arange(.55,.981,.01):
  for margin in np.arange(.01,.241,.01):
   selected=(cal['scores']>=threshold)&(cal['margins']>=margin);n=int(selected.sum());precision=float(cal['correct'][selected].mean()) if n else 0
   if n>=10 and precision>=.90:candidates.append((n,float(threshold),float(margin),precision))
 if candidates:count,threshold,margin,precision=max(candidates)
 else:count,threshold,margin,precision=0,.98,.1,0
 selected=(test['scores']>=threshold)&(test['margins']>=margin)
 report=json.load(open(source/'evaluation.json'));report.update({'model':'pillcheck-dinov2-metric-v1' if args.dino else 'pillcheck-mobilenet-metric-v1','encoder':'DINOv2 ViT-S/14' if args.dino else 'MobileNet V3 Small','testIdentityTop1':report['testTop1'],'testTop1':float(test['correct'].mean()),'testTop3':float(test['top3'].mean()),'testAccepted':int(selected.sum()),'testAcceptedCorrect':int(test['correct'][selected].sum()),'calibrationAccepted':count,'calibrationAcceptedCorrect':round(count*precision),'scoreThreshold':threshold,'marginThreshold':margin,'note':'Image-held-out benchmark. Product-NDC retrieval merges duplicate catalog entries. The heuristic acceptance gate is selected on calibration data only. No open-world/clinical guarantee; similarity is not probability.'})
 manifest['thresholds']={'similarity':threshold,'margin':margin};manifest['model']=report['model'];manifest['encoder']=report['encoder'];(source/'catalog.json').write_text(json.dumps(manifest,separators=(',',':')));(source/'evaluation.json').write_text(json.dumps(report,indent=2))
 # Select a visible-imprint accepted example for demonstration, with complete provenance.
 chosen=[i for j,i in enumerate(test['indices']) if selected[j] and test['correct'][j]][:4]
 if not chosen:chosen=[i for j,i in enumerate(test['indices']) if test['correct'][j]][:4]
 samples=[]
 for j,i in enumerate(chosen):
  r=rows[i];im=Image.open(ROOT/'work/dataset/ePillID_data/classification_data'/r['image_path']).convert('RGB');im.save(examples/f'pill-{j+1}.jpg');testj=test['indices'].index(i);samples.append({'file':f'/examples/pill-{j+1}.jpg','id':r['pilltype_id'],'ndc':f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}",'sourceImage':r['image_path'],'split':'test','accepted':bool(selected[testj]),'selected':'Correct illustrative test prediction selected after evaluation; not a random sample and not used to calculate metrics.'})
 (examples/'manifest.json').write_text(json.dumps(samples,indent=2))
 # A controlled two-pill scene exercises segmentation and counting, not a real-world study.
 scene=Image.new('RGB',(800,440),(0,0,0))
 for j in range(min(2,len(chosen))):
  r=rows[chosen[j]];im=Image.open(ROOT/'work/dataset/ePillID_data/classification_data'/r['image_path']).convert('RGB');im=ImageOps.contain(im,(240,240));scene.paste(im,(90+j*380,90))
 scene.save(examples/'dose-two.jpg',quality=96)
 (examples/'dose-two.json').write_text(json.dumps({'kind':'synthetic composite of held-out consumer photos','expectedCount':min(2,len(chosen)),'sources':samples[:2]},indent=2))
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
