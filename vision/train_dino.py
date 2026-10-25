"""Reproducible pill metric training on ePillID (research use, not clinical).
Reference images form the gallery; one consumer image per sufficiently sampled
identity is held out for calibration and another for the final test. Seed 2026.
"""
import argparse, csv, json, random, time, hashlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
import timm
from torchvision import transforms as T

ROOT=Path(__file__).resolve().parents[1]
class Images(Dataset):
 def __init__(self,rows,data): self.rows=rows; self.data=data
 def __len__(self): return len(self.rows)
 def __getitem__(self,i):
  im=Image.open(self.data/'classification_data'/self.rows[i]['image_path']).convert('RGB')
  return T.ToTensor()(im.resize((224,224))),i
class Encoder(nn.Module):
 def __init__(self,weights=None):
  super().__init__();self.backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=True,num_classes=0,img_size=224)
  self.register_buffer('mean',torch.tensor([.485,.456,.406]).reshape(1,3,1,1));self.register_buffer('std',torch.tensor([.229,.224,.225]).reshape(1,3,1,1))
 def forward(self,x): return self.backbone((x-self.mean)/self.std)
class Metric(nn.Module):
 def __init__(self):
  super().__init__();self.projection=nn.Sequential(nn.Linear(384,384),nn.ReLU(),nn.Linear(384,256))
 def forward(self,x): return F.normalize(self.projection(x),dim=1)
class PillModel(nn.Module):
 def __init__(self,encoder,metric): super().__init__();self.encoder=encoder;self.metric=metric
 def forward(self,x): return self.metric(self.encoder(x))

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,default=ROOT/'work/dataset/ePillID_data');ap.add_argument('--epochs',type=int,default=100);ap.add_argument('--finetune',type=int,default=0);args=ap.parse_args()
 random.seed(2026);np.random.seed(2026);torch.manual_seed(2026);torch.set_num_threads(4)
 device='mps' if torch.backends.mps.is_available() else 'cpu';print('device',device,flush=True)
 rows=list(csv.DictReader(open(args.data/'all_labels.csv')));ids=sorted(set(r['pilltype_id'] for r in rows));idmap={x:i for i,x in enumerate(ids)}
 labels=torch.tensor([idmap[r['pilltype_id']] for r in rows]);refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];cons={}
 for i,r in enumerate(rows):
  if r['is_ref']!='True':cons.setdefault(r['pilltype_id'],[]).append(i)
 cal=[];test=[];train=list(refs)
 for key,indices in sorted(cons.items()):
  random.shuffle(indices)
  if len(indices)>=3:cal.append(indices[0]);test.append(indices[1]);train.extend(indices[2:])
  elif len(indices)==2:test.append(indices[0]);train.append(indices[1])
  else:test.extend(indices)
 print('records',len(rows),'identities',len(ids),'train',len(train),'calibration',len(cal),'test',len(test),flush=True)
 encoder=Encoder(MobileNet_V3_Small_Weights.DEFAULT).eval().to(device)
 cache=ROOT/'work/dino-features.pt'
 if cache.exists():features=torch.load(cache,weights_only=True)
 else:
  loader=DataLoader(Images(rows,args.data),batch_size=32,shuffle=False,num_workers=0);parts=[];beg=time.time()
  with torch.inference_mode():
   for k,(x,_) in enumerate(loader):
    parts.append(encoder(x.to(device)).cpu())
    if k%15==0:print('features',k*32,'/',len(rows),'seconds',round(time.time()-beg),flush=True)
  features=torch.cat(parts);torch.save(features,cache)
 features=features.to(device);y=labels.to(device);refidx=torch.tensor(refs,device=device);calidx=torch.tensor(cal,device=device);testidx=torch.tensor(test,device=device)
 def evaluate(emb,idx):
  q=emb[idx];gallery=emb[refidx];best=[];scores=[];margins=[];correct=[]
  for start in range(0,len(idx),128):
   sim=q[start:start+128]@gallery.T
   top=sim.topk(20,dim=1)
   for j in range(len(top.values)):
    values=top.values[j].cpu().tolist();inds=top.indices[j].cpu().tolist();pid=labels[refs[inds[0]]].item();second=next((v for v,k in zip(values[1:],inds[1:]) if labels[refs[k]].item()!=pid),0)
    best.append(pid);scores.append(values[0]);margins.append(values[0]-second);correct.append(pid==labels[idx[start+j].item()].item())
  return {'top1':float(np.mean(correct)),'scores':scores,'margins':margins,'correct':correct,'predictions':best}
 with torch.inference_mode(): baseline=evaluate(F.normalize(features,dim=1),calidx)
 print('pretrained calibration top1',baseline['top1'],flush=True)
 metric=Metric().to(device);head=nn.Linear(256,len(ids),bias=False).to(device);optimizer=torch.optim.AdamW(list(metric.parameters())+list(head.parameters()),lr=.001,weight_decay=.002)
 trainidx=torch.tensor(train,device=device);bestacc=-1;checkpoint=ROOT/'models/dino-metric.pt';checkpoint.parent.mkdir(exist_ok=True)
 for epoch in range(args.epochs):
  metric.train();losses=[];order=trainidx[torch.randperm(len(trainidx),device=device)]
  for batch in order.split(512):
   x=features[batch];z=metric(x+torch.randn_like(x)*.04);logits=20*z@F.normalize(head.weight,dim=1).T
   ce=F.cross_entropy(logits,y[batch]);sim=z@z.T/.12;eye=torch.eye(len(batch),dtype=torch.bool,device=device);positives=(y[batch,None]==y[batch][None,:])&~eye
   logp=sim.masked_fill(eye,-1e4).log_softmax(dim=1);mask=positives.sum(1)>0
   con=-(logp*positives).sum(1)/positives.sum(1).clamp_min(1);loss=ce+(con[mask].mean()*.15 if mask.any() else 0)
   optimizer.zero_grad();loss.backward();optimizer.step();losses.append(loss.item())
  if epoch%5==0 or epoch==args.epochs-1:
   metric.eval()
   with torch.inference_mode():emb=metric(features);ev=evaluate(emb,calidx)
   print('epoch',epoch,'loss',round(float(np.mean(losses)),4),'calibration top1',round(ev['top1'],4),flush=True)
   if ev['top1']>bestacc:bestacc=ev['top1'];torch.save(metric.state_dict(),checkpoint)
 metric.load_state_dict(torch.load(checkpoint,map_location=device,weights_only=True));metric.eval()
 if args.finetune:
  augmentation=T.Compose([T.RandomAffine(12,translate=(.035,.035),scale=(.88,1.05)),T.ColorJitter(.15,.15,.12,.02)])
  fineopt=torch.optim.AdamW([{'params':encoder.parameters(),'lr':.00008},{'params':metric.parameters(),'lr':.00015},{'params':head.parameters(),'lr':.00015}],weight_decay=.001)
  bestfine=-1;finepath=ROOT/'models/finetuned.pt'
  ds=Images(rows,args.data)
  for epoch in range(args.finetune):
   encoder.train();metric.train();losses=[];order=np.random.permutation(train)
   for start in range(0,len(order),64):
    indices=order[start:start+64];batch=torch.stack([augmentation(ds[int(i)][0]) for i in indices]).to(device);targets=y[torch.tensor(indices,device=device)]
    z=metric(encoder(batch));logits=20*z@F.normalize(head.weight,dim=1).T;loss=F.cross_entropy(logits,targets)
    fineopt.zero_grad();loss.backward();fineopt.step();losses.append(loss.item())
   encoder.eval();metric.eval();parts=[]
   with torch.inference_mode():
    for x,_ in DataLoader(ds,batch_size=32,num_workers=0):parts.append(encoder(x.to(device)))
    features=torch.cat(parts);ev=evaluate(metric(features),calidx)
   print('finetune',epoch,'loss',round(float(np.mean(losses)),4),'calibration top1',round(ev['top1'],4),flush=True)
   if ev['top1']>bestfine:
    bestfine=ev['top1'];torch.save({'encoder':encoder.state_dict(),'metric':metric.state_dict()},finepath)
  best=torch.load(finepath,map_location=device,weights_only=True);encoder.load_state_dict(best['encoder']);metric.load_state_dict(best['metric']);encoder.eval();metric.eval();parts=[]
  with torch.inference_mode():
   for x,_ in DataLoader(ds,batch_size=32,num_workers=0):parts.append(encoder(x.to(device)))
  features=torch.cat(parts)
 with torch.inference_mode():emb=metric(features);calout=evaluate(emb,calidx);testout=evaluate(emb,testidx)
 # Select a conservative heuristic gate using calibration only; report its test performance honestly.
 candidates=[]
 for score in [.65,.7,.75,.8,.85,.9,.93,.95,.97,.98]:
  for margin in [.01,.02,.03,.04,.06,.08,.10,.15]:
   accept=np.array(calout['scores'])>=score;accept &= np.array(calout['margins'])>=margin
   n=int(accept.sum());accuracy=float(np.array(calout['correct'])[accept].mean()) if n else 0
   if n>=15 and accuracy>=.95:candidates.append((n,score,margin,accuracy))
 if candidates:_,score,margin,acc=max(candidates)
 else:score,margin=.98,.10
 accepted=(np.array(testout['scores'])>=score)&(np.array(testout['margins'])>=margin)
 report={'seed':2026,'dataset':'ePillID 1.0','pillTypes':len(ids),'referenceImages':len(refs),'trainingImages':len(train),'calibrationImages':len(cal),'testImages':len(test),'pretrainedCalibrationTop1':baseline['top1'],'trainedCalibrationTop1':calout['top1'],'testTop1':testout['top1'],'testAccepted':int(accepted.sum()),'testAcceptedCorrect':int(np.array(testout['correct'])[accepted].sum()),'scoreThreshold':score,'marginThreshold':margin,'note':'Image-held-out, not identity-held-out. Research benchmark only; similarity scores are not probabilities. Heuristic thresholds are not conformal or clinical guarantees.'}
 print(json.dumps(report,indent=2),flush=True)
 out=ROOT/'work/dino-export';out.mkdir(parents=True,exist_ok=True)
 (out/'evaluation.json').write_text(json.dumps(report,indent=2));np.save(ROOT/'work/dino-embeddings.npy',emb.cpu().numpy())
 # Keep normalized gallery embeddings compact and deterministic.
 emb[refidx].cpu().numpy().astype('<f4').tofile(out/'gallery.f32')
 catalog=[]
 for i,pid in enumerate(ids):
  indices=[k for k in refs if rows[k]['pilltype_id']==pid]
  catalog.append({'id':pid,'ndc':pid.split('_')[0] if '-' in pid.split('_')[0] else f"{int(rows[indices[0]]['label_code_id']):05d}-{int(rows[indices[0]]['prod_code_id']):04d}",'references':[refs.index(k) for k in indices]})
 manifest={'version':1,'inputSize':224,'embeddingSize':256,'referenceCount':len(refs),'catalog':catalog,'referenceIds':[idmap[rows[k]['pilltype_id']] for k in refs],'thresholds':{'similarity':score,'margin':margin},'source':'ePillID / NIH NLM; research only'}
 (out/'catalog.json').write_text(json.dumps(manifest,separators=(',',':')))
 model=PillModel(encoder.cpu(),metric.cpu()).eval();torch.save(model.state_dict(),ROOT/'models/dino-pill-model.pt')
 torch.onnx.export(model,torch.zeros(1,3,224,224),str(out/'pill-encoder.onnx'),input_names=['image'],output_names=['embedding'],opset_version=17,dynamo=False)
 # Reference atlases: each identity has two sides, packed as 160x80 tiles.
 for sheet in range((len(ids)+99)//100):
  atlas=Image.new('RGB',(1600,800),'black')
  for local in range(100):
   index=sheet*100+local
   if index>=len(ids):break
   for side,k in enumerate([x for x in refs if rows[x]['pilltype_id']==ids[index]][:2]):
    im=Image.open(args.data/'classification_data'/rows[k]['image_path']).convert('RGB');im=ImageOps.contain(im,(80,80))
    atlas.paste(im,((local%10)*160+side*80+(80-im.width)//2,(local//10)*80+(80-im.height)//2))
  atlas.save(out/f'references-{sheet}.webp',quality=75)
 # Fixed held-out real examples and synthetic multi-pill scenes are kept separate from training.
 examples=ROOT/'work/dino-examples';examples.mkdir(exist_ok=True);chosen=[]
 for j,i in enumerate(test):
  if testout['correct'][j] and accepted[j]:chosen.append(i)
  if len(chosen)==4:break
 if not chosen:chosen=test[:4]
 samples=[]
 for j,i in enumerate(chosen):
  r=rows[i];im=Image.open(args.data/'classification_data'/r['image_path']).convert('RGB');im.save(examples/f'pill-{j+1}.jpg');samples.append({'file':f'/examples/pill-{j+1}.jpg','id':r['pilltype_id'],'ndc':r['pilltype_id'].split('_')[0],'sourceImage':r['image_path'],'split':'test','selected':'Correct accepted test prediction; illustrative, not a random evaluation sample.'})
 (examples/'manifest.json').write_text(json.dumps(samples,indent=2))
 (ROOT/'models/split.json').write_text(json.dumps({'train':[rows[i]['image_path'] for i in train],'calibration':[rows[i]['image_path'] for i in cal],'test':[rows[i]['image_path'] for i in test]},indent=2))
 print('EXPORTED',out,flush=True)
if __name__=='__main__':main()
