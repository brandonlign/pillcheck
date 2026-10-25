"""Freeze an external NIH archive evaluation manifest before model evaluation.
Raw photographs, not existing ePillID crops. NDC ground truth comes from NIH's
public directory. Source overlap/near-duplicates must be screened separately.
"""
from pathlib import Path
import json,random,collections,urllib.request,urllib.parse,concurrent.futures,hashlib,io,time
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'work/external-nih';out.mkdir(exist_ok=True)
known=set()
for e in json.load(open(ROOT/'public/models/catalog.json'))['catalog']:
 p=e['ndc'].split('-');known.add(p[0].zfill(5)+'-'+p[1].zfill(4))
groups=collections.defaultdict(list)
for line in open(ROOT/'work/nih-consumers.txt'):
 r=line.rstrip().split('|')
 if len(r)<5 or r[3]!='C3PI_Test' or not r[2].lower().endswith(('.jpg','.jpeg')) or len(r[0])!=11:continue
 key=r[0][:5]+'-'+r[0][5:9]
 if key in known:groups[key].append(r)
rng=random.Random(20261025);products=sorted(k for k,v in groups.items() if len(v)>=4);rng.shuffle(products);products=products[:300];selected=[]
for product in products:
 options=sorted(groups[product],key=lambda r:r[2]);rng.shuffle(options)
 for j,r in enumerate(options[:3]):
  selected.append({'productNdc':product,'ndc':r[0],'path':r[2],'name':r[4],'split':'external-development' if j==0 else 'external-calibration' if j==1 else 'external-sealed','url':'https://data.lhncbc.nlm.nih.gov/public/Pills/'+urllib.parse.quote(r[2],safe='/!_-.'),'file':hashlib.sha256(r[2].encode()).hexdigest()[:20]+'.jpg'})
(out/'selection.json').write_text(json.dumps({'seed':20261025,'selection':'300 random supported products; three random JPEG photos each; split frozen before inference','source':'https://data.lhncbc.nlm.nih.gov/public/Pills/directory_consumer_grade_images.txt','images':selected},indent=2))
def download(item):
 p=out/item['file']
 if p.exists():return {**item,'downloaded':True}
 try:
  response=urllib.request.urlopen(item['url'],timeout=30);raw=response.read(16*1024*1024+1)
  if len(raw)>16*1024*1024:raise ValueError('source above 16 MB limit')
  image=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB');original=image.size;image.thumbnail((1400,1400));image.save(p,quality=94)
  return {**item,'downloaded':True,'originalSize':list(original),'sourceSha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
 except Exception as e:return {**item,'downloaded':False,'error':str(e)}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for i,item in enumerate(pool.map(download,selected)):
  results.append(item)
  if i%30==0:print(i,'/',len(selected),'downloaded',sum(x['downloaded'] for x in results),flush=True)
(out/'manifest.json').write_text(json.dumps({'source':'NIH C3PI historical archive','images':results},indent=2));print('DONE',sum(x['downloaded'] for x in results),'/',len(results),flush=True)
