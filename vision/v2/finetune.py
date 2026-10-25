"""End-to-end V2 refinement: update DINO's last two blocks on true pill pairs.
All earlier blocks are frozen; calibration images are never used in gradients.
"""
import sys,time,csv,json,random,argparse
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torchvision import transforms as T
from torch.utils.data import DataLoader
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).resolve().parent));sys.path.insert(0,str(ROOT/'vision'))
from train_metric import Metric
from extract_spatial import spatial_features
from train_dino import Images
import timm
class Model(nn.Module):
 def __init__(self,backbone,metric,spatial=True):
  super().__init__();self.backbone=backbone;self.metric=metric;self.spatial=spatial;self.register_buffer('mean',torch.tensor([.485,.456,.406]).reshape(1,3,1,1));self.register_buffer('std',torch.tensor([.229,.224,.225]).reshape(1,3,1,1))
 def forward(self,x):
  x=(x-self.mean)/self.std
  return self.metric(spatial_features(self.backbone,x) if self.spatial else self.backbone(x))
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--epochs',type=int,default=12);ap.add_argument('--steps',type=int,default=80);ap.add_argument('--base',default='paired-cls');ap.add_argument('--eval-every',type=int,default=3);args=ap.parse_args()
 torch.set_num_threads(4);torch.manual_seed(312026);np.random.seed(312026);random.seed(312026);device='mps' if torch.backends.mps.is_available() else 'cpu'
 data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));by_path={r['image_path']:i for i,r in enumerate(rows)};train=[by_path[p] for p in split['train']];cal=[by_path[p] for p in split['calibration']];refs=[i for i,r in enumerate(rows) if r['is_ref']=='True']
 product=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];types=sorted(set(product));typemap={x:i for i,x in enumerate(types)};appearance=[product[i]+'|'+r['is_front'] for i,r in enumerate(rows)];classes=sorted(set(appearance));classmap={x:i for i,x in enumerate(classes)};y=torch.tensor([classmap[x] for x in appearance],device=device);py=torch.tensor([typemap[x] for x in product],device=device)
 apprefs={};appcons={}
 for i in train:(apprefs if rows[i]['is_ref']=='True' else appcons).setdefault(classmap[appearance[i]],[]).append(i)
 known=sorted(appcons);allkeys=sorted(apprefs);ds=Images(rows,data)
 backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);base=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in base.items() if k.startswith('encoder.backbone.')})
 for p in backbone.parameters():p.requires_grad=False
 for block in backbone.blocks[-2:]:
  for p in block.parameters():p.requires_grad=True
 for p in backbone.norm.parameters():p.requires_grad=True
 checkpoint=torch.load(ROOT/'work/v2'/args.base/'metric.pt',map_location='cpu',weights_only=True);metric=Metric(checkpoint['dim']);metric.load_state_dict(checkpoint['metric']);model=Model(backbone,metric,spatial=checkpoint['dim']!=384).to(device)
 # Initialize class directions from the learned reference embeddings.
 with torch.no_grad():
  cached=np.load(ROOT/'work/v2'/args.base/'embeddings.npy');directions=np.stack([np.mean(cached[apprefs[k]],axis=0) for k in allkeys]);head=nn.Parameter(F.normalize(torch.tensor(directions,device=device),dim=1))
 opt=torch.optim.AdamW([{'params':[p for p in backbone.parameters() if p.requires_grad],'lr':.000008},{'params':metric.parameters(),'lr':.00003},{'params':[head],'lr':.0001}],weight_decay=.001)
 aug=T.Compose([T.RandomAffine(degrees=9,translate=(.025,.025),scale=(.92,1.04)),T.ColorJitter(.10,.10,.08,.01)])
 out=ROOT/'work/v2'/('finetuned-'+args.base);out.mkdir(exist_ok=True);best=float(checkpoint['calibrationTop1']);start=time.time();refidx=torch.tensor(refs,device=device);calidx=torch.tensor(cal,device=device)
 print('start cal',best,'trainable backbone params',sum(p.numel() for p in backbone.parameters() if p.requires_grad),flush=True)
 for epoch in range(args.epochs):
  model.train();losses=[]
  for step in range(args.steps):
   # Every selected consumer is paired with the matching appearance reference.
   chosen=random.sample(known,24)+random.sample(allkeys,8);indices=[]
   for k in chosen:indices.extend([random.choice(apprefs[k]),random.choice(appcons.get(k,apprefs[k]))])
   x=torch.stack([aug(ds[i][0]) for i in indices]).to(device);target=y[torch.tensor(indices,device=device)];z=model(x);similarity=z@z.T;same=target[:,None]==target[None,:];eye=torch.eye(len(indices),device=device,dtype=torch.bool);positives=same&~eye
   positive=similarity.masked_fill(~positives,2).min(1).values;negative=similarity.masked_fill(same,-2).max(1).values;triplet=F.relu(.18+negative-positive).mean()
   logits=z@F.normalize(head,dim=1).T;logits=logits.scatter_add(1,target[:,None],torch.full((len(indices),1),-.12,device=device));ce=F.cross_entropy(logits*20,target)
   nce=-(similarity/.10).masked_fill(eye,-1e4).log_softmax(1).masked_fill(~positives,0).sum(1)/positives.sum(1).clamp_min(1);loss=ce+.8*triplet+.35*nce.mean();opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad],2);opt.step();losses.append(loss.item())
   if step%20==0:print('epoch',epoch,'step',step,'loss',round(loss.item(),3),'seconds',round(time.time()-start),flush=True)
  if (epoch+1)%args.eval_every!=0 and epoch!=args.epochs-1:continue
  model.eval();parts=[]
  with torch.inference_mode():
   for x,_ in DataLoader(ds,batch_size=32,num_workers=0):parts.append(model(x.to(device)).cpu())
   emb=torch.cat(parts).to(device);correct=[]
   for startidx in range(0,len(cal),128):
    sim=emb[calidx[startidx:startidx+128]]@emb[refidx].T;pred=py[refidx[sim.argmax(1)]];correct.extend((pred==py[calidx[startidx:startidx+128]]).cpu().tolist())
  score=float(np.mean(correct));print('EPOCH',epoch,'cal top1',score,'loss',float(np.mean(losses)),flush=True)
  if score>best:
   best=score;torch.save({'model':model.cpu().state_dict(),'dim':checkpoint['dim'],'out':384,'epoch':epoch,'calibrationTop1':best},out/'model.pt');np.save(out/'embeddings.npy',emb.cpu().numpy());model.to(device)
  if epoch==5:
   for g in opt.param_groups:g['lr']*=.5
 print('BEST',best,flush=True)
if __name__=='__main__':main()
