"""Train a pill-specific CNN end to end, with face labels and metric losses.
ResNet34 ImageNet initialization; bilinear texture pooling for imprint detail.
"""
import csv,json,time,random,argparse,sys
from pathlib import Path
import numpy as np,torch
from torch import nn
from torch.nn import functional as F
from torchvision.models import resnet34,ResNet34_Weights
from torchvision import transforms as T
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
class CNN(nn.Module):
 def __init__(self,pretrained=True):
  super().__init__();m=resnet34(weights=ResNet34_Weights.DEFAULT if pretrained else None);self.features=nn.Sequential(*list(m.children())[:-2]);self.reduce=nn.Conv2d(512,64,1,bias=False);self.project=nn.Linear(4096+512,384);self.register_buffer('mean',torch.tensor([.485,.456,.406]).reshape(1,3,1,1));self.register_buffer('std',torch.tensor([.229,.224,.225]).reshape(1,3,1,1))
 def forward(self,x):
  features=self.features((x-self.mean)/self.std);reduced=self.reduce(features).flatten(2);gram=reduced@reduced.transpose(1,2)/reduced.shape[2];texture=torch.sign(gram)*torch.sqrt(torch.abs(gram)+1e-6);texture=F.normalize(texture.flatten(1),dim=1);average=F.normalize(features.mean((2,3)),dim=1);return F.normalize(self.project(torch.cat([average,texture],1)),dim=1)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--epochs',type=int,default=32);ap.add_argument('--steps',type=int,default=80);ap.add_argument('--resume',action='store_true');args=ap.parse_args();torch.set_num_threads(4);torch.manual_seed(401026);random.seed(401026);np.random.seed(401026);device='mps' if torch.backends.mps.is_available() else 'cpu';data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));split=json.load(open(ROOT/'models/split.json'));rmap={r['image_path']:i for i,r in enumerate(rows)};train=[rmap[p] for p in split['train']];cal=[rmap[p] for p in split['calibration']];refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];products=[f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}" for r in rows];pkeys=sorted(set(products));pmap={k:i for i,k in enumerate(pkeys)};py=torch.tensor([pmap[x] for x in products],device=device);appearances=[products[i]+'|'+r['is_front'] for i,r in enumerate(rows)];classes=sorted(set(appearances));cmap={k:i for i,k in enumerate(classes)};y=torch.tensor([cmap[x] for x in appearances],device=device);apprefs={};appcons={}
 for i in train:(apprefs if rows[i]['is_ref']=='True' else appcons).setdefault(cmap[appearances[i]],[]).append(i)
 known=sorted(appcons);keys=sorted(apprefs);model=CNN(pretrained=not args.resume).to(device)
 if args.resume:
  saved=torch.load(ROOT/'work/v2/resnet34/model.pt',map_location=device,weights_only=True);model.load_state_dict(saved['model']);previous=np.load(ROOT/'work/v2/resnet34/embeddings.npy');directions=np.stack([previous[apprefs[k]].mean(0) for k in keys]);head=nn.Parameter(F.normalize(torch.tensor(directions,device=device),dim=1));print('Initialized class prototypes from appearance references; baseline',saved['validationTop1'],flush=True)
 else:head=nn.Parameter(F.normalize(torch.randn(len(classes),384,device=device),dim=1))
 opt=torch.optim.AdamW([{'params':model.features.parameters(),'lr':.00004},{'params':list(model.reduce.parameters())+list(model.project.parameters()),'lr':.00015},{'params':[head],'lr':.0003}],weight_decay=.0005)
 # Decode once. All train/cal/test tensors remain separated by their recorded indices.
 images=[Image.open(data/'classification_data'/r['image_path']).convert('RGB').resize((224,224)) for r in rows];tensor=T.ToTensor();aug=T.Compose([T.RandomAffine(degrees=180,translate=(.025,.025),scale=(.88,1.04)),T.RandomPerspective(.12,p=.25),T.ColorJitter(.12,.12,.10,.01)])
 out=ROOT/'work/v2'/('resnet34-prototype' if args.resume else 'resnet34');out.mkdir(exist_ok=True);best=-1;best_epoch=-1;beg=time.time();refidx=torch.tensor(refs,device=device);calidx=torch.tensor(cal,device=device)
 for epoch in range(args.epochs):
  model.train();losses=[]
  for step in range(args.steps):
   selected=random.sample(known,16)+random.sample(keys,8);indices=[]
   for key in selected:indices.extend([random.choice(apprefs[key]),random.choice(appcons.get(key,apprefs[key]))])
   x=torch.stack([tensor(aug(images[i])) for i in indices]).to(device);target=y[torch.tensor(indices,device=device)];z=model(x);logits=z@F.normalize(head,dim=1).T;logits=logits.scatter_add(1,target[:,None],torch.full((len(indices),1),-.1,device=device));ce=F.cross_entropy(logits*20,target);sim=z@z.T;same=target[:,None]==target[None,:];eye=torch.eye(len(indices),dtype=torch.bool,device=device);positive=same&~eye;pos=sim.masked_fill(~positive,2).min(1).values;neg=sim.masked_fill(same,-2).max(1).values;triplet=F.relu(.2+neg-pos).mean();contrast=-(sim/.10).masked_fill(eye,-1e4).log_softmax(1).masked_fill(~positive,0).sum(1)/positive.sum(1).clamp_min(1);loss=ce+triplet+.5*contrast.mean();opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5);opt.step();losses.append(loss.item())
   if step%40==0:print('epoch',epoch,'step',step,'loss',round(loss.item(),3),'seconds',round(time.time()-beg),flush=True)
  if epoch%2==0 or epoch==args.epochs-1:
   model.eval();parts=[]
   with torch.inference_mode():
    for start in range(0,len(rows),64):parts.append(model(torch.stack([tensor(im) for im in images[start:start+64]]).to(device)).cpu())
    emb=torch.cat(parts).to(device);correct=[]
    for start in range(0,len(cal),128):scores=emb[calidx[start:start+128]]@emb[refidx].T;pred=py[refidx[scores.argmax(1)]];correct.extend((pred==py[calidx[start:start+128]]).cpu().tolist())
   accuracy=float(np.mean(correct));print('EPOCH',epoch,'validation top1',accuracy,'loss',float(np.mean(losses)),flush=True)
   if accuracy>best:best=accuracy;best_epoch=epoch;torch.save({'model':model.state_dict(),'epoch':epoch,'validationTop1':best,'seed':401026},out/'model.pt');np.save(out/'embeddings.npy',emb.cpu().numpy())
  if epoch>8 and epoch-best_epoch>=8:
   print('Early stopping after a validation plateau',flush=True);break
  if epoch in [14,23]:
   for g in opt.param_groups:g['lr']*=.5
 print('BEST',best,flush=True)
if __name__=='__main__':main()
