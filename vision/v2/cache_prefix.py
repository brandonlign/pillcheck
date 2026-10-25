"""Cache frozen DINO blocks once, including a training-only augmented view.
This changes training speed, not the deployed model's image computation.
"""
import sys,csv,json,time,numpy as np,torch,timm
from pathlib import Path
from torchvision import transforms as T
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
def main():
 torch.set_num_threads(4);torch.manual_seed(2026);device='mps' if torch.backends.mps.is_available() else 'cpu';data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));train=set(json.load(open(ROOT/'models/split.json'))['train'])
 m=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);state=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);m.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in state.items() if k.startswith('encoder.backbone.')});m.eval().to(device)
 mean=torch.tensor([.485,.456,.406],device=device).reshape(1,3,1,1);std=torch.tensor([.229,.224,.225],device=device).reshape(1,3,1,1);to_tensor=T.ToTensor();aug=T.Compose([T.RandomAffine(10,translate=(.025,.025),scale=(.90,1.05)),T.ColorJitter(.13,.13,.10,.015)])
 out=ROOT/'work/v2/prefix.f16';cache=np.memmap(out,dtype='float16',mode='w+',shape=(2,len(rows),257,384));beg=time.time()
 with torch.inference_mode():
  for view in range(2):
   for start in range(0,len(rows),32):
    indices=list(range(start,min(start+32,len(rows))));images=[]
    for i in indices:
     im=Image.open(data/'classification_data'/rows[i]['image_path']).convert('RGB').resize((224,224));x=to_tensor(im);x=aug(x) if view and rows[i]['image_path'] in train else x;images.append(x)
    x=(torch.stack(images).to(device)-mean)/std;x=m.norm_pre(m.patch_drop(m._pos_embed(m.patch_embed(x))))
    for block in m.blocks[:-2]:x=block(x)
    cache[view,start:start+len(indices)]=x.cpu().numpy().astype('float16')
    if start%800==0:print('view',view,'images',start,'seconds',round(time.time()-beg),flush=True)
   cache.flush()
 (ROOT/'work/v2/prefix.json').write_text(json.dumps({'shape':[2,len(rows),257,384],'dtype':'float16','augmentedOnlyTraining':True,'prefix':'first 10 frozen DINOv2 ViT-S/14 blocks','seed':2026}));print('DONE',flush=True)
if __name__=='__main__':main()
