"""Train an on-device pill foreground model on synthetic scenes.
Masks come from clean research-reference silhouettes. Validation scenes and
reference images are held out; synthetic IoU is not real-world accuracy.
"""
from pathlib import Path
import csv,random,json,time,math
import numpy as np,cv2,torch
from torch import nn
from torch.nn import functional as F
from PIL import Image,ImageFilter
ROOT=Path(__file__).resolve().parents[2]
class Block(nn.Module):
 def __init__(self,a,b):super().__init__();self.net=nn.Sequential(nn.Conv2d(a,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU(),nn.Conv2d(b,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU())
 def forward(self,x):return self.net(x)
class Segmenter(nn.Module):
 def __init__(self):
  super().__init__();self.a=Block(3,8);self.b=Block(8,16);self.c=Block(16,32);self.d=Block(32,64);self.u3=Block(96,32);self.u2=Block(48,16);self.u1=Block(24,8);self.out=nn.Conv2d(8,1,1)
 def forward(self,x):
  a=self.a(x);b=self.b(F.max_pool2d(a,2));c=self.c(F.max_pool2d(b,2));d=self.d(F.max_pool2d(c,2));x=self.u3(torch.cat([F.interpolate(d,size=c.shape[2:],mode='bilinear',align_corners=False),c],1));x=self.u2(torch.cat([F.interpolate(x,size=b.shape[2:],mode='bilinear',align_corners=False),b],1));x=self.u1(torch.cat([F.interpolate(x,size=a.shape[2:],mode='bilinear',align_corners=False),a],1));return self.out(x)
def reference_cutout(path):
 rgb=np.asarray(Image.open(path).convert('RGB'));gray=np.max(rgb,2);mask=(gray>16).astype('uint8')*255;contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 if not contours:return None
 valid=[c for c in contours if cv2.contourArea(c)>4]
 if not valid:return None
 points=np.vstack(valid);hull=cv2.convexHull(points);mask[:]=0;cv2.fillConvexPoly(mask,hull,255);x,y,w,h=cv2.boundingRect(hull);rgba=np.dstack([rgb,mask])[y:y+h,x:x+w];return Image.fromarray(rgba)
def scene(seed,pills,size=256):
 rng=random.Random(seed);nr=np.random.default_rng(seed);base=np.array([rng.randint(25,235) for _ in range(3)],dtype=np.float32);yy,xx=np.mgrid[:size,:size];gx=rng.uniform(-45,45);gy=rng.uniform(-45,45);background=base[None,None,:]+gx*(xx[:,:,None]/size-.5)+gy*(yy[:,:,None]/size-.5);noise=nr.normal(0,rng.uniform(.5,12),(size,size,1));background=np.clip(background+noise,0,255).astype(np.uint8);im=Image.fromarray(background);truth=Image.new('L',(size,size),0)
 count=0 if rng.random()<.12 else rng.randint(1,5)
 centers=[]
 for _ in range(count):
  pill=rng.choice(pills).copy();scale=rng.randint(22,110)/max(pill.size);pill=pill.resize((max(5,round(pill.width*scale)),max(5,round(pill.height*scale))),Image.Resampling.BICUBIC);pill=pill.rotate(rng.uniform(0,360),expand=True,resample=Image.Resampling.BICUBIC)
  # Keep most objects separated; include occasional near contacts.
  for attempt in range(20):
   x=rng.randint(3,max(3,size-pill.width-3));y=rng.randint(3,max(3,size-pill.height-3));cx=x+pill.width/2;cy=y+pill.height/2
   if all(math.hypot(cx-px,cy-py)>max(pill.size)*.65+radius for px,py,radius in centers):break
  centers.append((cx,cy,max(pill.size)*.35));alpha=pill.getchannel('A');shadow=Image.new('L',(size,size),0);shadow.paste(alpha,(x+rng.randint(-3,6),y+rng.randint(2,7)));shadow=shadow.filter(ImageFilter.GaussianBlur(rng.uniform(1,4)));dark=np.array(im).astype(np.float32)*(1-.32*np.asarray(shadow)[:,:,None]/255);im=Image.fromarray(dark.astype('uint8'))
  rgba=np.asarray(pill).copy();rgba[:,:,:3]=np.clip(rgba[:,:,:3].astype(float)*rng.uniform(.75,1.15)+np.array([rng.uniform(-12,12),rng.uniform(-8,8),rng.uniform(-12,12)]),0,255).astype('uint8');pill=Image.fromarray(rgba);im.paste(pill,(x,y),pill);truth.paste(Image.new('L',pill.size,255),(x,y),alpha)
 if rng.random()<.2:im=im.filter(ImageFilter.GaussianBlur(rng.uniform(.2,.7)))
 x=np.asarray(im).transpose(2,0,1).astype('float32')/255;y=(np.asarray(truth)[None]>100).astype('float32');return torch.from_numpy(x),torch.from_numpy(y)
def main():
 torch.set_num_threads(4);torch.manual_seed(20261026);rng=random.Random(20261026);device='mps' if torch.backends.mps.is_available() else 'cpu';rows=[r for r in csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')) if r['is_ref']=='True'];rng.shuffle(rows);selected=rows[:2200];cutouts=[reference_cutout(ROOT/'work/dataset/ePillID_data/classification_data'/r['image_path']) for r in selected];cutouts=[p for p in cutouts if p is not None];train=cutouts[:2000];validation=cutouts[2000:];print('cutouts',len(train),'validation',len(validation),flush=True)
 out=ROOT/'work/v2/segmenter';out.mkdir(exist_ok=True);model=Segmenter().to(device);opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001);best=-1;beg=time.time();batch=16
 for epoch in range(18):
  model.train();losses=[]
  for step in range(60):
   samples=[scene(epoch*100000+step*batch+j,train) for j in range(batch)];x=torch.stack([s[0] for s in samples]).to(device);y=torch.stack([s[1] for s in samples]).to(device);logits=model(x);prob=logits.sigmoid();bce=F.binary_cross_entropy_with_logits(logits,y,pos_weight=torch.tensor(3.,device=device));dice=1-(2*(prob*y).sum((1,2,3))+1)/(prob.sum((1,2,3))+y.sum((1,2,3))+1);loss=bce+dice.mean();opt.zero_grad();loss.backward();opt.step();losses.append(loss.item())
   if step%30==0:print('epoch',epoch,'step',step,'loss',round(loss.item(),3),'seconds',round(time.time()-beg),flush=True)
  model.eval();inter=union=0
  with torch.inference_mode():
   for k in range(0,96,8):
    samples=[scene(9000000+j,validation) for j in range(k,k+8)];x=torch.stack([s[0] for s in samples]).to(device);y=torch.stack([s[1] for s in samples]).to(device);pred=model(x).sigmoid()>.5;inter+=int((pred&(y>.5)).sum().item());union+=int((pred|(y>.5)).sum().item())
  iou=inter/max(1,union);print('EPOCH',epoch,'synthetic validation IoU',iou,'loss',float(np.mean(losses)),flush=True)
  if iou>best:best=iou;torch.save({'model':model.state_dict(),'epoch':epoch,'syntheticValidationIoU':iou,'seed':20261026},out/'model.pt')
  if epoch==10:
   for g in opt.param_groups:g['lr']*=.3
 print('BEST',best,flush=True)
if __name__=='__main__':main()
