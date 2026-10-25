from pathlib import Path
import json,hashlib
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];source=ROOT/'work/external-nih';manifest=json.load(open(source/'manifest.json'));out=ROOT/'work/v2/external-dev';out.mkdir(exist_ok=True);results=[]
for item in manifest['images']:
 if item['split']!='external-development' or not item.get('downloaded'):continue
 im=Image.open(source/item['file']).convert('RGBA');im.thumbnail((580,580));file=out/(item['file']+'.rgba');file.write_bytes(im.tobytes());results.append({**item,'width':im.width,'height':im.height,'rgba':file.name,'inputSha256':hashlib.sha256((source/item['file']).read_bytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps(results,indent=2));print('Prepared',len(results),'development images; sealed images not read')
