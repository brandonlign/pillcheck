from pathlib import Path
import sys,csv,time,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));sys.path.insert(0,str(Path(__file__).resolve().parent))
from train_dino import ROOT
from preprocess import canonicalize
import torch,timm
from torchvision.transforms.functional import to_tensor
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

def main():
 torch.set_num_threads(4);device='mps' if torch.backends.mps.is_available() else 'cpu';data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));out=ROOT/'work/v2/canonical';out.mkdir(parents=True,exist_ok=True)
 def process(pair):
  i,r=pair;p=out/f'{i}.jpg'
  if not p.exists():
   im,meta=canonicalize(Image.open(data/'classification_data'/r['image_path']));im.save(p,quality=97)
  return i,p
 beg=time.time()
 with ThreadPoolExecutor(max_workers=4) as pool:
  for i,p in pool.map(process,enumerate(rows)):
   if i%1000==0:print('canonical',i,'seconds',round(time.time()-beg),flush=True)
 backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);state=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in state.items() if k.startswith('encoder.backbone.')});backbone.eval().to(device);mean=torch.tensor([.485,.456,.406],device=device).reshape(1,3,1,1);std=torch.tensor([.229,.224,.225],device=device).reshape(1,3,1,1);features=[]
 with torch.inference_mode():
  for start in range(0,len(rows),32):
   x=torch.stack([to_tensor(Image.open(out/f'{i}.jpg').convert('RGB')) for i in range(start,min(start+32,len(rows)))]).to(device);features.append(backbone((x-mean)/std).cpu())
   if start%800==0:print('features',start,'seconds',round(time.time()-beg),flush=True)
 torch.save(torch.cat(features),ROOT/'work/dino-canonical-features.pt');print('DONE',flush=True)
if __name__=='__main__':main()
