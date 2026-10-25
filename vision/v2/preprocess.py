"""Deterministic crop normalization: remove padding, estimate background,
retain foreground, align major axis. No medicine label is used.
"""
import cv2,numpy as np
from PIL import Image

def foreground(rgb):
 h,w=rgb.shape[:2];lab=cv2.cvtColor(rgb,cv2.COLOR_RGB2LAB).astype(np.float32)
 yy,xx=np.mgrid[:h,:w];x=(xx-w/2)/max(w,1);y=(yy-h/2)/max(h,1)
 basis=np.stack([np.ones_like(x),x,y,x*x,y*y,x*y],axis=-1).astype(np.float32)
 border=(xx<w*.10)|(xx>w*.90)|(yy<h*.10)|(yy>h*.90)
 a=basis[border][::3];b=lab[border][::3];keep=np.ones(len(a),bool)
 for _ in range(3):
  coef=np.linalg.lstsq(a[keep],b[keep],rcond=None)[0];residual=np.sqrt(((a@coef-b)**2).mean(1));med=np.median(residual);mad=np.median(np.abs(residual-med));keep=residual<max(8,med+3*mad)
  if keep.sum()<20:break
 bg=np.einsum('hwk,kc->hwc',basis,coef);distance=np.sqrt(((lab-bg)**2).mean(2));threshold=max(10,min(30,float(np.median(residual)+4*np.median(np.abs(residual-np.median(residual))))))
 mask=(distance>threshold).astype(np.uint8)
 mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8));mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
 return mask

def canonicalize(image,size=224):
 rgb=np.asarray(image.convert('RGB'));h,w=rgb.shape[:2]
 # ePillID pads narrow photographs with exact black; remove only complete rows/columns.
 nonblack=np.max(rgb,axis=2)>7;ys=np.flatnonzero(nonblack.mean(1)>.02);xs=np.flatnonzero(nonblack.mean(0)>.02)
 if len(xs)>12 and len(ys)>12:rgb=rgb[ys[0]:ys[-1]+1,xs[0]:xs[-1]+1]
 h,w=rgb.shape[:2];mask=foreground(rgb)
 count,labels,stats,centroids=cv2.connectedComponentsWithStats(mask,8)
 if count<=1:return image.convert('RGB').resize((size,size)),{'detected':False}
 candidates=[]
 for i in range(1,count):
  x,y,bw,bh,area=stats[i];cx,cy=centroids[i];score=area/(1+2*((cx/w-.5)**2+(cy/h-.5)**2))
  if area>h*w*.008:candidates.append((score,i))
 if not candidates:return image.convert('RGB').resize((size,size)),{'detected':False}
 _,which=max(candidates);mask=(labels==which).astype(np.uint8)*255
 # Fill small imprint holes but preserve the silhouette.
 contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);mask[:]=0;cv2.drawContours(mask,contours,-1,255,-1)
 pixels=np.column_stack(np.where(mask>0));coords=pixels[:,::-1].astype(np.float32);mean,eigenvectors,eigenvalues=cv2.PCACompute2(coords,mean=None);angle=np.degrees(np.arctan2(eigenvectors[0,1],eigenvectors[0,0]));ratio=float(eigenvalues[0,0]/max(eigenvalues[1,0],1e-5))
 if ratio<1.3:angle=0
 masked=rgb.copy();masked[mask==0]=0
 side=int(np.ceil(np.hypot(w,h)))+8;pad=np.zeros((side,side,3),np.uint8);ox=(side-w)//2;oy=(side-h)//2;pad[oy:oy+h,ox:ox+w]=masked
 matrix=cv2.getRotationMatrix2D((side/2,side/2),float(angle),1);rot=cv2.warpAffine(pad,matrix,(side,side));valid=np.max(rot,axis=2)>7;ys,xs=np.where(valid)
 if not len(xs):return image.convert('RGB').resize((size,size)),{'detected':False}
 cropped=rot[ys.min():ys.max()+1,xs.min():xs.max()+1];ch,cw=cropped.shape[:2];canvas=np.zeros((max(ch,cw),max(ch,cw),3),np.uint8);top=(len(canvas)-ch)//2;left=(len(canvas)-cw)//2;canvas[top:top+ch,left:left+cw]=cropped
 # Match the reference occupancy while retaining a small black border.
 canvas=cv2.copyMakeBorder(canvas,max(2,int(len(canvas)*.06)),max(2,int(len(canvas)*.06)),max(2,int(len(canvas)*.06)),max(2,int(len(canvas)*.06)),cv2.BORDER_CONSTANT,value=0)
 return Image.fromarray(canvas).resize((size,size)),{'detected':True,'angle':float(angle),'areaFraction':len(coords)/(h*w),'axisRatio':ratio}
