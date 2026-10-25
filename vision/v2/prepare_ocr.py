from pathlib import Path
import csv,json,cv2,numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];data=ROOT/'work/dataset/ePillID_data';rows=list(csv.DictReader(open(data/'all_labels.csv')));paths=json.load(open(ROOT/'models/split.json'))['calibration'];by_path={r['image_path']:r for r in rows};out=ROOT/'work/v2/ocr-input';out.mkdir(exist_ok=True);manifest=[]
for i,p in enumerate(paths):
 rgb=np.asarray(Image.open(data/'classification_data'/p).convert('RGB'));rgb=cv2.resize(rgb,(672,672),interpolation=cv2.INTER_CUBIC);gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY);gray=cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(gray)
 # Suppress only exact black padding; keep all imprint pixels unaltered in RGB view.
 cv2.imwrite(str(out/f'{i}-rgb.png'),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR));cv2.imwrite(str(out/f'{i}-gray.png'),gray)
 manifest.append({'index':i,'source':p,'productNdc':f"{int(by_path[p]['label_code_id']):05d}-{int(by_path[p]['prod_code_id']):04d}"})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('Prepared',len(manifest))
