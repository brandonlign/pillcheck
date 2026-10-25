"""Cache pretrained DINOv2 CLS + four spatial regions, retaining imprint layout."""
import sys,time,csv
from pathlib import Path
import torch
from torch.nn import functional as F
from torch.utils.data import DataLoader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from train_dino import Images,ROOT
import timm

def spatial_features(backbone,x):
 tokens=backbone.forward_features(x);cls=tokens[:,0];patch=tokens[:,1:].transpose(1,2).reshape(len(x),384,16,16)
 regions=F.adaptive_avg_pool2d(patch,(2,2)).flatten(2).transpose(1,2)
 return torch.cat([F.normalize(cls,dim=1),F.normalize(regions,dim=2).flatten(1)],dim=1)
def main():
 torch.set_num_threads(4);device='mps' if torch.backends.mps.is_available() else 'cpu'
 data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')))
 backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224)
 state=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in state.items() if k.startswith('encoder.backbone.')});backbone.eval().to(device)
 mean=torch.tensor([.485,.456,.406],device=device).reshape(1,3,1,1);std=torch.tensor([.229,.224,.225],device=device).reshape(1,3,1,1)
 parts=[];beg=time.time()
 with torch.inference_mode():
  for k,(x,_) in enumerate(DataLoader(Images(rows,data),batch_size=32,num_workers=0)):
   parts.append(spatial_features(backbone,(x.to(device)-mean)/std).cpu())
   if k%25==0:print(k*32,'/',len(rows),'seconds',round(time.time()-beg),flush=True)
 out=torch.cat(parts);torch.save(out,ROOT/'work/dino-spatial-features.pt');print('DONE',out.shape,flush=True)
if __name__=='__main__':main()
