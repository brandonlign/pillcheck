"""Development-only mask/crop ablation on actual archived camera frames."""
import sys,json,csv,time
from pathlib import Path
import numpy as np,torch,timm,cv2
from PIL import Image,ImageDraw
from torchvision.transforms.functional import to_tensor
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).resolve().parent));from train_segmenter import Segmenter
from train_metric import Metric

def main():
 torch.set_num_threads(4);device='mps' if torch.backends.mps.is_available() else 'cpu';records=json.load(open(ROOT/'work/v2/external-dev/manifest.json'));rows=list(csv.DictReader(open(ROOT/'work/dataset/ePillID_data/all_labels.csv')));refs=[i for i,r in enumerate(rows) if r['is_ref']=='True'];refproducts=[f"{int(rows[i]['label_code_id']):05d}-{int(rows[i]['prod_code_id']):04d}" for i in refs]
 maskmodel=Segmenter();checkpoint=torch.load(ROOT/'work/v2/segmenter/model.pt',map_location='cpu',weights_only=True);maskmodel.load_state_dict(checkpoint['model']);maskmodel.eval().to(device)
 backbone=timm.create_model('vit_small_patch14_dinov2.lvd142m',pretrained=False,num_classes=0,img_size=224);base=torch.load(ROOT/'models/dino-pill-model.pt',map_location='cpu',weights_only=True);backbone.load_state_dict({k.removeprefix('encoder.backbone.'):v for k,v in base.items() if k.startswith('encoder.backbone.')});metric=Metric(384);metric.load_state_dict(torch.load(ROOT/'work/v2/paired-cls/metric.pt',map_location='cpu',weights_only=True)['metric']);backbone.eval().to(device);metric.eval().to(device);gallery=torch.tensor(np.load(ROOT/'work/v2/paired-cls/embeddings.npy')[refs],device=device);mean=torch.tensor([.485,.456,.406],device=device).reshape(1,3,1,1);std=torch.tensor([.229,.224,.225],device=device).reshape(1,3,1,1);results=[];out=ROOT/'work/v2/mask-dev';out.mkdir(exist_ok=True);beg=time.time();panels=[]
 with torch.inference_mode():
  for j,item in enumerate(records):
   image=Image.open(ROOT/'work/external-nih'/item['file']).convert('RGB');p=maskmodel(to_tensor(image.resize((256,256))).unsqueeze(0).to(device)).sigmoid()[0,0].cpu().numpy();binary=(p>.5).astype(np.uint8);binary=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8));count,labels,stats,centers=cv2.connectedComponentsWithStats(binary,8);objects=[];rgba=np.asarray(image).copy();overlay=image.copy();draw=ImageDraw.Draw(overlay)
   for k in range(1,count):
    x,y,w,h,area=stats[k]
    if area<40 or w<7 or h<5:continue
    component=(labels==k).astype('uint8');contours,_=cv2.findContours(component,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);cv2.drawContours(component,contours,-1,1,-1);confidence=float(p[component>0].mean());side=max(w,h)*1.17;sx=image.width/256;sy=image.height/256;box=((x-(side-w)/2)*sx,(y-(side-h)/2)*sy,(x+(side+w)/2)*sx,(y+(side+h)/2)*sy);draw.rectangle((x*sx,y*sy,(x+w)*sx,(y+h)*sy),outline='lime',width=3)
    mask=cv2.resize(component,(image.width,image.height),interpolation=cv2.INTER_NEAREST);masked=rgba.copy();masked[mask==0]=0;predictions={}
    for variant,source in [('box',image),('masked',Image.fromarray(masked))]:
     crop=source.crop(box).resize((224,224));z=metric(backbone((to_tensor(crop).unsqueeze(0).to(device)-mean)/std));sim=(z@gallery.T)[0].cpu().numpy();order=np.argsort(-sim);distinct=[];seen=set()
     for index in order[:60]:
      product=refproducts[index]
      if product in seen:continue
      seen.add(product);distinct.append({'productNdc':product,'score':float(sim[index])})
      if len(distinct)==3:break
     predictions[variant]={'candidates':distinct,'correct':distinct[0]['productNdc']==item['productNdc']}
    objects.append({'x':int(x),'y':int(y),'width':int(w),'height':int(h),'maskConfidence':confidence,**predictions})
    if len(objects)>=8:break
   results.append({'file':item['file'],'truth':item['productNdc'],'objects':objects})
   if j<16:
    overlay.thumbnail((240,180));panels.append(overlay.copy())
   if j%30==0:print(j,'/',len(records),'seconds',round(time.time()-beg),flush=True)
 summary={'segmenterCheckpointEpoch':checkpoint['epoch'],'syntheticValidationIoU':checkpoint['syntheticValidationIoU'],'frames':len(results),'nonemptyFrames':sum(bool(r['objects']) for r in results),'variants':{}}
 for variant in ['box','masked']:
  objects=[o for r in results for o in r['objects']];summary['variants'][variant]={'detectedObjects':len(objects),'correctObjectIdentities':sum(o[variant]['correct'] for o in objects),'allDetectedIdentitiesCorrectFrames':sum(bool(r['objects']) and all(o[variant]['correct'] for o in r['objects']) for r in results)}
 (out/'results.json').write_text(json.dumps(results));(out/'summary.json').write_text(json.dumps(summary,indent=2));sheet=Image.new('RGB',(960,720),'white')
 for j,im in enumerate(panels):sheet.paste(im,(j%4*240,j//4*180))
 sheet.save(out/'detections.jpg');print(json.dumps(summary,indent=2),flush=True)
if __name__=='__main__':main()
