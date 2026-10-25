"""V2: appearance-side-aware, paired, hard-negative metric learning.
Old test is now explicitly a development benchmark. Selection uses calibration.
"""
import sys,csv,json,random,time,argparse
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
ROOT=Path(__file__).resolve().parents[2]
class Metric(nn.Module):
 def __init__(self,dim=384,out=384):
  super().__init__();self.net=nn.Sequential(nn.LayerNorm(dim),nn.Linear(dim,768),nn.GELU(),nn.Linear(768,out))
 def forward(self,x):return F.normalize(self.net(x),dim=1)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--features',default='work/dino-features.pt');ap.add_argument('--name',default='paired-cls');ap.add_argument('--epochs',type=int,default=120);args=ap.parse_args()
 torch.set_num_threads(4);torch.manual_seed(241026);np.random.seed(241026);random.seed(241026)
 device='mps' if torch.backends.mps.is_available() else 'cpu';rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));by_path={r['image_path']:i for i,r in enumerate(rows)}
 train=[by_path[p] for p in split['train']];cal=[by_path[p] for p in split['calibration']];refs=[i for i,r in enumerate(rows) if r['is_ref']=='True']
 products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];types=sorted(set(products));typemap={x:i for i,x in enumerate(types)}
 appearance=[products[i]+'|'+r['is_front'] for i,r in enumerate(rows)];appids=sorted(set(appearance));appmap={x:i for i,x in enumerate(appids)}
 labels=torch.tensor([appmap[x] for x in appearance],device=device);plabels=torch.tensor([typemap[x] for x in products],device=device)
 raw=torch.load(ROOT/args.features,weights_only=True).float();features=raw.to(device);dim=features.shape[1]
 # Candidate hard negatives come only from training reference features.
 apprefs={};appcons={}
 for i in train:
  bucket=apprefs if rows[i]['is_ref']=='True' else appcons;bucket.setdefault(appmap[appearance[i]],[]).append(i)
 appkeys=sorted(apprefs);known=sorted(appcons);refrow=torch.tensor([apprefs[k][0] for k in appkeys],device=device)
 with torch.inference_mode():
  refunit=F.normalize(features[refrow],dim=1);neighbors=[]
  for chunk in refunit.split(128):neighbors.extend((chunk@refunit.T).topk(12,dim=1).indices.cpu().tolist())
 negatives={key:[appkeys[k] for k in neighbors[j] if appkeys[k]!=key] for j,key in enumerate(appkeys)}
 metric=Metric(dim).to(device);head=nn.Parameter(F.normalize(torch.randn(len(appids),384,device=device),dim=1));optimizer=torch.optim.AdamW([{'params':metric.parameters(),'lr':.0006},{'params':[head],'lr':.001}],weight_decay=.002)
 out=ROOT/'work/v2'/args.name;out.mkdir(parents=True,exist_ok=True);best=-1;best_epoch=-1;beg=time.time()
 refidx=torch.tensor(refs,device=device);calidx=torch.tensor(cal,device=device)
 def evaluate():
  metric.eval()
  with torch.inference_mode():
   emb=metric(features);gallery=emb[refidx];correct=[];top3=[]
   for start in range(0,len(cal),128):
    s=emb[calidx[start:start+128]]@gallery.T;top=s.topk(8,dim=1).indices
    pred=plabels[refidx[top]];truth=plabels[calidx[start:start+128]];correct.extend((pred[:,0]==truth).cpu().tolist());top3.extend((pred[:,:3]==truth[:,None]).any(1).cpu().tolist())
  return float(np.mean(correct)),float(np.mean(top3)),emb
 print('features',args.features,'dim',dim,'appearances',len(appids),'paired classes',len(known),'train',len(train),'cal',len(cal),flush=True)
 for epoch in range(args.epochs):
  metric.train();losses=[]
  # Exactly matched positives in every batch; mix consumers and reference-only classes.
  for step in range(64):
   seeds=random.sample(known,24)+random.sample(appkeys,8);chosen=set(seeds)
   for k in seeds[:16]:
    available=[x for x in negatives[k] if x not in chosen]
    if available:chosen.add(random.choice(available[:5]))
   batch=[]
   for k in chosen:
    batch.append(random.choice(apprefs[k]));batch.append(random.choice(appcons.get(k,apprefs[k])))
   ix=torch.tensor(batch,device=device);x=features[ix];noise=torch.randn_like(x)*.015;z=metric(x+noise);target=labels[ix];normalized=F.normalize(head,dim=1)
   cosine=z@normalized.T
   # CosFace angular separation without unstable acos operations.
   logits=cosine.clone();logits.scatter_add_(1,target[:,None],torch.full((len(ix),1),-.12,device=device));ce=F.cross_entropy(logits*20,target)
   sim=z@z.T;same=(target[:,None]==target[None,:]);eye=torch.eye(len(ix),dtype=torch.bool,device=device);positive=same&~eye
   pos=sim.masked_fill(~positive,2).min(1).values;neg=sim.masked_fill(same,-2).max(1).values
   triplet=F.relu(.18+neg-pos).mean()
   nce=-(sim/.10).masked_fill(eye,-1e4).log_softmax(1).masked_fill(~positive,0).sum(1)/positive.sum(1).clamp_min(1)
   loss=ce+.8*triplet+.35*nce.mean();optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(metric.parameters(),5);optimizer.step();losses.append(loss.item())
  if epoch%4==0 or epoch==args.epochs-1:
   accuracy,top3,emb=evaluate();print('epoch',epoch,'loss',round(float(np.mean(losses)),4),'cal top1',round(accuracy,4),'top3',round(top3,4),'seconds',round(time.time()-beg),flush=True)
   if accuracy>best:
    best=accuracy;best_epoch=epoch;torch.save({'metric':metric.state_dict(),'dim':dim,'out':384,'epoch':epoch,'calibrationTop1':best},out/'metric.pt');np.save(out/'embeddings.npy',emb.cpu().numpy())
  if epoch in [60,90]:
   for group in optimizer.param_groups:group['lr']*=.5
 (out/'training.json').write_text(json.dumps({'seed':241026,'bestEpoch':best_epoch,'calibrationTop1':best,'trainImages':len(train),'calibrationImages':len(cal),'features':args.features,'appearanceClasses':len(appids),'method':'paired hard negatives; side labels; cosine margin + triplet + contrastive'},indent=2))
if __name__=='__main__':main()
