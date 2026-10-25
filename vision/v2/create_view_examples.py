"""Create optional other-side examples from actual consumer photographs."""
from pathlib import Path
import csv,json
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[2];data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));by_path={r['image_path']:r for r in rows};examples=ROOT/'public/examples';samples=json.load(open(examples/'manifest.json'));split=json.load(open(ROOT/'models/split.json'));splits={p:k for k,paths in split.items() for p in paths};chosen=[]
for sample in samples[:2]:
 first=by_path[sample['sourceImage']];candidates=[r for r in rows if r['pilltype_id']==first['pilltype_id'] and r['is_ref']=='False' and r['is_front']!=first['is_front']]
 candidates.sort(key=lambda r:({'test':0,'calibration':1,'train':2}.get(splits.get(r['image_path']),3),r['image_path']))
 if not candidates:raise RuntimeError('No genuine opposite consumer view for '+sample['id'])
 second=candidates[0];chosen.append(second)
if chosen:
 Image.open(data/'classification_data'/chosen[0]['image_path']).convert('RGB').save(examples/'other-side.jpg',quality=96)
scene=Image.new('RGB',(800,440),'black')
for j,r in enumerate(chosen):
 im=ImageOps.contain(Image.open(data/'classification_data'/r['image_path']).convert('RGB'),(240,240));scene.paste(im,(90+j*380,90))
scene.save(examples/'dose-other-side.jpg',quality=96)
(examples/'other-side.json').write_text(json.dumps({'kind':'Actual consumer images of opposite faces; composition is synthetic','images':[{'sourceImage':r['image_path'],'pillId':r['pilltype_id'],'split':splits.get(r['image_path']),'isFront':r['is_front']} for r in chosen],'purpose':'Illustrative development example, not an accuracy study'},indent=2));print('Created genuine opposite-side examples')
