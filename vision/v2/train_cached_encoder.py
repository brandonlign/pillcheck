"""Train DINO's last two blocks from a frozen-prefix cache.
Checkpoint selection uses the old calibration split, now validation.
"""
import sys,csv,json,time,random,argparse
from pathlib import Path
import numpy as np,torch,timm
from torch import nn
from torch.nn import functional as F
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).resolve().parent))
from train_metric import Metric
class FullModel(nn.Module):
 def __init__(self,backbone,metric):
  super().__init__();self.backbone=backbone;self.metric=metric;self.register_buffer('mean',torch.tensor([.485,.456,.406]).reshape(1,3,1,1));self.register_buffer('std',torch.tensor([.229,.224,.225]).reshape(1,3,1,1))
 def forward(self,x):return self.metric(self.backbone((x-self.mean)/self.std))
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--epochs',type=int,default=20);ap.add_argument('--steps',type=int,default=80);args=ap.parse_args()
 torch.set_num_threads(4);torch.manual_seed(20261025);random.seed(20261025);np.random.seed(20261025);device='mps' if torch.backends.mps.is_available() else 'cpu'
 data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));rowmap={r['image_path']:i for i,r in enumerate(rows)};train=[rowmap[p] for p in split['train']];cal=[rowmap[p] for p in split['calibration']];refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];pkeys=sorted(set(products));pmap={x:i for i,x in enumerate(pkeys)};py=torch.tensor([pmap[x] for x in products],device=device);appearance=[products[i]+'|'+r['is_front'] for i,r in enumerate(rows)];classes=sorted(set(appearance));cmap={x:i for i,x in enumerate(classes)};y=torch.tensor([cmap[x] for x in appearance],device=device)
 apprefs={};appcons={}
 for i in train:(apprefs if rows[i]['is_ref']=='True' else appcons).setdefault(cmap[appearance[i]],[]).append(i)
 known=sorted(appcons);keys=sorted(apprefs)
 config=json.load(open(ROOT/'work/v2/prefix.json'));cache=np.memmap(ROOT/'work/v2/prefix.f16',dtype='float16',mode='r',shape=tuple(config['shape']))
 backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);base=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in base.items() if k.startswith('encoder.backbone.')});basehead=torch.load(ROOT/'work/v2/paired-cls/metric.pt',map_location='cpu',weights_only=True);metric=Metric(384);metric.load_state_dict(basehead['metric']);model=FullModel(backbone,metric).to(device)
 for p in backbone.parameters():p.requires_grad=False
 for b in backbone.blocks[-2:]:
  for p in b.parameters():p.requires_grad=True
 for p in backbone.norm.parameters():p.requires_grad=True
 cached=np.load(ROOT/'work/v2/paired-cls/embeddings.npy');head=nn.Parameter(F.normalize(torch.tensor(np.stack([cached[apprefs[k]].mean(0) for k in keys]),device=device),dim=1))
 opt=torch.optim.AdamW([{'params':[p for p in backbone.parameters() if p.requires_grad],'lr':.000015},{'params':metric.parameters(),'lr':.00005},{'params':[head],'lr':.0001}],weight_decay=.001)
 out=ROOT/'work/v2/encoder-refined';out.mkdir(exist_ok=True);best=-1;beg=time.time();refidx=torch.tensor(refs,device=device);calidx=torch.tensor(cal,device=device)
 def forward(tokens):
  for b in backbone.blocks[-2:]:tokens=b(tokens)
  return metric(backbone.norm(tokens)[:,0])
 for epoch in range(args.epochs):
  model.train();losses=[]
  for step in range(args.steps):
   chosen=random.sample(known,24)+random.sample(keys,8);indices=[];views=[]
   for key in chosen:indices.extend([random.choice(apprefs[key]),random.choice(appcons.get(key,apprefs[key]))]);views.extend([random.randrange(2),random.randrange(2)])
   x=torch.from_numpy(np.array(cache[views,indices],dtype=np.float32)).to(device);targets=y[torch.tensor(indices,device=device)];z=forward(x);cosine=z@F.normalize(head,dim=1).T;cosine=cosine.scatter_add(1,targets[:,None],torch.full((len(indices),1),-.12,device=device));ce=F.cross_entropy(cosine*20,targets)
   sim=z@z.T;same=targets[:,None]==targets[None,:];eye=torch.eye(len(indices),device=device,dtype=torch.bool);positive=same&~eye;pos=sim.masked_fill(~positive,2).min(1).values;neg=sim.masked_fill(same,-2).max(1).values;triplet=F.relu(.18+neg-pos).mean();nce=-(sim/.10).masked_fill(eye,-1e4).log_softmax(1).masked_fill(~positive,0).sum(1)/positive.sum(1).clamp_min(1);loss=ce+.8*triplet+.35*nce.mean();opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad],2);opt.step();losses.append(loss.item())
  model.eval();parts=[]
  with torch.inference_mode():
   for start in range(0,len(rows),96):parts.append(forward(torch.from_numpy(np.array(cache[0,start:start+96],dtype=np.float32)).to(device)).cpu())
   emb=torch.cat(parts).to(device);correct=[];top3=[]
   for start in range(0,len(cal),128):
    scores=emb[calidx[start:start+128]]@emb[refidx].T;top=scores.topk(6,1).indices;pred=py[refidx[top]];truth=py[calidx[start:start+128]];correct.extend((pred[:,0]==truth).cpu().tolist());top3.extend((pred[:,:3]==truth[:,None]).any(1).cpu().tolist())
  accuracy=float(np.mean(correct));print('epoch',epoch,'loss',round(float(np.mean(losses)),4),'validation top1',round(accuracy,4),'top3',round(float(np.mean(top3)),4),'seconds',round(time.time()-beg),flush=True)
  if accuracy>best:
   best=accuracy;torch.save({'model':model.state_dict(),'dim':384,'out':384,'epoch':epoch,'validationTop1':accuracy,'seed':20261025},out/'model.pt');np.save(out/'embeddings.npy',emb.cpu().numpy())
  if epoch in [9,14]:
   for group in opt.param_groups:group['lr']*=.5
 (out/'training.json').write_text(json.dumps({'bestValidationTop1':best,'seed':20261025,'epochs':args.epochs,'unfrozenBlocks':2,'trainingViews':2,'viewAugmentation':'affine/color, training only','cacheDtype':'float16; final metrics must be rerun using full exported encoder'},indent=2));print('BEST',best,flush=True)
if __name__=='__main__':main()
