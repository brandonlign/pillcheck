"""Development-only full-frame audit. All images in a frame share NIH NDC.
No instance ground-truth masks/counts are assumed. Missing detections count as
frame failures; only development records are read by this script.
"""
import sys,csv,json,time
from pathlib import Path
import numpy as np,torch,timm
from PIL import Image
from torchvision.transforms.functional import to_tensor
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).resolve().parent))
from train_metric import Metric

def main():
 torch.set_num_threads(4);device='mps' if torch.backends.mps.is_available() else 'cpu';rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];refproducts=[products[i] for i in refs];records=json.load(open(ROOT/'work/v2/external-dev/detection.json'));backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);base=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in base.items() if k.startswith('encoder.backbone.')});metric=Metric(384);metric.load_state_dict(torch.load(ROOT/'work/v2/paired-cls/metric.pt',map_location='cpu',weights_only=True)['metric']);backbone.eval().to(device);metric.eval().to(device);gallery=torch.tensor(np.load(ROOT/'work/v2/paired-cls/embeddings.npy')[refs],device=device);mean=torch.tensor([.485,.456,.406],device=device).reshape(1,3,1,1);std=torch.tensor([.229,.224,.225],device=device).reshape(1,3,1,1);results=[];beg=time.time()
 with torch.inference_mode():
  for j,record in enumerate(records):
   image=Image.open(ROOT/'work/external-nih'/record['file']).convert('RGB');entry={k:v for k,v in record.items() if k not in ['original','adaptive']}
   for variant in ['original','adaptive']:
    detection=record[variant];objects=[]
    if len(detection['components'])<=5:
     for b in detection['components']:
      side=max(b['width'],b['height'])*1.17;sx=image.width/record['width'];sy=image.height/record['height'];x=(b['x']-(side-b['width'])/2)*sx;y=(b['y']-(side-b['height'])/2)*sy;crop=image.crop((x,y,x+side*sx,y+side*sy)).resize((224,224));z=metric(backbone((to_tensor(crop).unsqueeze(0).to(device)-mean)/std));sim=(z@gallery.T)[0].cpu().numpy();order=np.argsort(-sim);distinct=[];seen=set()
      for i in order[:80]:
       product=refproducts[i]
       if product in seen:continue
       seen.add(product);distinct.append({'productNdc':product,'similarity':float(sim[i])})
       if len(distinct)==3:break
      objects.append({'box':b,'candidates':distinct,'correct':distinct[0]['productNdc']==record['productNdc']})
    entry[variant]={'objects':objects,'quality':detection['quality'],'allDetectedIdentitiesCorrect':bool(objects) and all(o['correct'] for o in objects),'detectedCount':len(detection['components'])}
   results.append(entry)
   if j%30==0:print(j,'/',len(records),'seconds',round(time.time()-beg),flush=True)
 summary={}
 for variant in ['original','adaptive']:
  frames=[r[variant] for r in results];objects=[o for f in frames for o in f['objects']];summary[variant]={'frames':len(frames),'nonemptyFrames':sum(bool(f['objects']) for f in frames),'qualityPassFrames':sum(bool(f['objects']) and not f['quality'] for f in frames),'allDetectedIdentitiesCorrectFrames':sum(f['allDetectedIdentitiesCorrect'] for f in frames),'detectedObjects':len(objects),'correctObjectIdentities':sum(o['correct'] for o in objects),'note':'Development only. Instance counts are not independently annotated; this is identity retrieval with automatic crops, not detector F1 or dose-safety accuracy.'}
 out=ROOT/'work/v2/external-dev';(out/'recognition.json').write_text(json.dumps(results));(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2),flush=True)
if __name__=='__main__':main()
