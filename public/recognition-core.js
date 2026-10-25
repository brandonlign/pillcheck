// This file has no DOM/model dependency so the safety rules and detector are testable.
export function productNdc(value = "") {
  const text = String(value).split("_")[0].trim();
  const parts = text.split("-");
  if (
    parts.length >= 2 &&
    /^\d{4,5}$/.test(parts[0]) &&
    /^\d{3,4}$/.test(parts[1])
  )
    return `${parts[0].padStart(5, "0")}-${parts[1].padStart(4, "0")}`;
  if (/^\d{11}$/.test(text)) return `${text.slice(0, 5)}-${text.slice(5, 9)}`;
  return null;
}
export function rankEmbeddings(
  vector,
  gallery,
  referenceIds,
  catalog,
  limit = 3,
) {
  const size = vector.length,
    best = new Map();
  for (let row = 0; row < referenceIds.length; row++) {
    let score = 0;
    const offset = row * size;
    for (let i = 0; i < size; i++) score += vector[i] * gallery[offset + i];
    const id = referenceIds[row];
    const key = productNdc(catalog[id].ndc) || id;
    if (!best.has(key) || score > best.get(key).score)
      best.set(key, {
        ...catalog[id],
        catalogIndex: id,
        score,
        reference: row,
      });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
export function evaluateScan(patient, slot, scan, { day, currentSlot } = {}) {
  if (
    patient.logs.some(
      (l) => l.day === day && l.slot === slot && l.status === "taken",
    )
  )
    return {
      type: "duplicate",
      title: "This dose is already logged",
      detail: "Check the history before taking anything else.",
    };
  const expected = patient.meds.filter(
    (m) =>
      m.slots.includes(slot) && (!m.startDate || !day || m.startDate <= day),
  );
  if (!expected.length)
    return {
      type: "uncertain",
      title: "No medications scheduled",
      detail: "Check your saved schedule against the prescription label.",
    };
  if (!scan)
    return {
      type: "uncertain",
      title: "Take a photo to begin",
      detail:
        "The photo check finds pills and compares them with the reference library.",
    };
  if (scan.error || scan.quality?.length)
    return {
      type: "uncertain",
      title: "A clearer photo is needed",
      detail: scan.error || scan.quality.join(" "),
    };
  if (!scan.pills.length)
    return {
      type: "uncertain",
      title: "No clear pills found",
      detail:
        "Use a plain contrasting background, separate the pills, and try again.",
    };
  if (currentSlot && currentSlot !== slot)
    return {
      type: "time",
      title: "Check the scheduled time",
      detail: `This is the ${slot.toLowerCase()} plan; the current period is ${currentSlot.toLowerCase()}. Follow your prescription instructions.`,
    };
  if (expected.some((m) => !productNdc(m.ndc || m.pillId)))
    return {
      type: "setup",
      title: "Connect the bottle to its pill reference",
      detail:
        "Enter the exact NDC from each bottle in Medications. A medication name alone does not identify its manufacturer-specific appearance.",
    };
  if (scan.pills.some((p) => !p.accepted))
    return {
      type: "uncertain",
      title: "Not sure about every pill",
      detail:
        "The model found possible visual matches, but at least one did not meet the similarity and separation thresholds. Do not rely on the nearest suggestion.",
    };
  const counts = new Map();
  for (const pill of scan.pills) {
    const key = productNdc(pill.candidates[0].ndc);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const planned = new Map();
  for (const m of expected) {
    const key = productNdc(m.ndc || m.pillId);
    planned.set(key, (planned.get(key) || 0) + m.quantity);
  }
  if ([...counts.keys()].some((k) => !planned.has(k)))
    return {
      type: "wrong",
      title: "An unexpected pill may be present",
      detail:
        "At least one accepted visual match is outside this dose’s saved plan. Check the bottle and ask your pharmacist about unfamiliar pills.",
    };
  if ([...planned].some(([key, count]) => counts.get(key) !== count))
    return {
      type: "missing",
      title: "The detected counts do not match",
      detail:
        "The photo has a different number of one or more expected pill references. Recheck the prepared dose.",
    };
  return {
    type: "matched",
    title: "Photo matches the saved pill references",
    detail:
      "Detected references and counts match your plan. " +
      (scan.mode === "single"
        ? "Single-pill mode assumes one pill in the crop. "
        : "") +
      "This research model can still be wrong; follow your prescription and check unfamiliar pills with a pharmacist.",
  };
}
export function detectPills({ data, width, height }, {illumination=false}={}) {
  const n = width * height,
    border = [];
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40)))
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 40)))
      if (
        x < width * 0.05 ||
        x > width * 0.95 ||
        y < height * 0.05 ||
        y > height * 0.95
      )
        border.push([
          data[(y * width + x) * 4],
          data[(y * width + x) * 4 + 1],
          data[(y * width + x) * 4 + 2],
        ]);
  const median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)] || 0;
  const bg = [0, 1, 2].map((c) => median(border.map((p) => p[c])));
  const deviation = Math.sqrt(
    border.reduce(
      (sum, p) => sum + p.reduce((s, v, c) => s + (v - bg[c]) ** 2, 0) / 3,
      0,
    ) / Math.max(1, border.length),
  );
  const quality = [];
  if (!illumination && deviation > 28)
    quality.push(
      "Use a plain background with no hands, labels, or organizer dividers in view.",
    );
  const lighting=illumination?estimateIllumination({data,width,height}):null;
  if(lighting&&lighting.noise>15)quality.push('The background is textured or uneven. Use a plain contrasting mat.');
  const mask=new Uint8Array(n),threshold=lighting?lighting.threshold:Math.max(35,Math.min(85,deviation*2.4+28));
  for(let i=0;i<n;i++){
    let distance=0;const nx=(i%width)/width-.5,ny=Math.floor(i/width)/height-.5;
    const b=lighting?[1,nx,ny,nx*nx,ny*ny,nx*ny]:null;
    for(let c=0;c<3;c++){
      const expected=lighting?b.reduce((sum,value,k)=>sum+value*lighting.coefficients[k][c],0):bg[c];
      distance+=(data[i*4+c]-expected)**2;
    }
    mask[i]=Math.sqrt(distance/3)>threshold?1:0;
  }
  // Close small holes and imprint gaps without joining pills that are well separated.
  const dilated = new Uint8Array(n),
    closed = new Uint8Array(n);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (mask[i + dy * width + dx]) dilated[i] = 1;
    }
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      let all = 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!dilated[i + dy * width + dx]) all = 0;
      closed[i] = all;
    }
  const seen = new Uint8Array(n),
    queue = new Int32Array(n),
    components = [];
  for (let i = 0; i < n; i++)
    if (closed[i] && !seen[i]) {
      let head = 0,
        tail = 1,
        minX = width,
        maxX = 0,
        minY = height,
        maxY = 0;
      queue[0] = i;
      seen[i] = 1;
      while (head < tail) {
        const at = queue[head++],
          x = at % width,
          y = Math.floor(at / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const next of [at - 1, at + 1, at - width, at + width])
          if (
            next >= 0 &&
            next < n &&
            !seen[next] &&
            closed[next] &&
            Math.abs((next % width) - x) <= 1
          ) {
            seen[next] = 1;
            queue[tail++] = next;
          }
      }
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1,
        area = tail,
        ratio = bw / bh,
        fill = area / (bw * bh);
      if (area < n * 0.0012 || bw < 9 || bh < 9) continue;
      if (area > n * 0.65 || ratio > 5.5 || ratio < 0.18 || fill < 0.35) {
        quality.push(
          "One region is too large or irregular to count as a separate pill. Separate touching objects and retake the photo.",
        );
        continue;
      }
      if (minX < 4 || minY < 4 || maxX > width - 5 || maxY > height - 5)
        quality.push(
          "A pill may be cut off by the image edge. Leave more space around the dose.",
        );
      components.push({ x: minX, y: minY, width: bw, height: bh, area, fill });
    }
  if (components.length > 20)
    quality.push(
      "Too many objects or background marks were found. Use a cleaner background.",
    );
  return {
    components: components.slice(0, 20).sort((a, b) => a.x - b.x),
    quality: [...new Set(quality)],
    background: bg,
    mask: closed,
  };
}

// Detection coordinates belong to the preview; recognition must use original pixels.
export function originalCrop(box,preview,original,padding=1.17){
 const side=Math.max(box.width,box.height)*padding;
 const sx=original.width/preview.width,sy=original.height/preview.height;
 return {x:(box.x-(side-box.width)/2)*sx,y:(box.y-(side-box.height)/2)*sy,width:side*sx,height:side*sy};
}

// Fit smooth illumination from the border so a lighting gradient is not counted as a pill.
export function estimateIllumination({data,width,height}){
 const samples=[];const stride=Math.max(2,Math.floor(Math.max(width,height)/90));
 for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride)if(x<width*.12||x>width*.88||y<height*.12||y>height*.88){const nx=x/width-.5,ny=y/height-.5,i=(y*width+x)*4;samples.push({b:[1,nx,ny,nx*nx,ny*ny,nx*ny],rgb:[data[i],data[i+1],data[i+2]]});}
 const median=a=>{a.sort((a,b)=>a-b);return a[Math.floor(a.length/2)]||0;};
 let active=samples,coefficients=Array.from({length:6},()=>[0,0,0]),residuals=[];
 for(let iteration=0;iteration<3;iteration++){
  const matrix=Array.from({length:6},()=>new Float64Array(9));
  for(const s of active)for(let r=0;r<6;r++){for(let c=0;c<6;c++)matrix[r][c]+=s.b[r]*s.b[c];for(let ch=0;ch<3;ch++)matrix[r][6+ch]+=s.b[r]*s.rgb[ch];}
  for(let r=0;r<6;r++)matrix[r][r]+=.00001;
  for(let r=0;r<6;r++){let best=r;for(let k=r+1;k<6;k++)if(Math.abs(matrix[k][r])>Math.abs(matrix[best][r]))best=k;[matrix[r],matrix[best]]=[matrix[best],matrix[r]];const pivot=matrix[r][r];if(Math.abs(pivot)<1e-12)continue;for(let c=r;c<9;c++)matrix[r][c]/=pivot;for(let k=0;k<6;k++)if(k!==r){const factor=matrix[k][r];for(let c=r;c<9;c++)matrix[k][c]-=factor*matrix[r][c];}}
  coefficients=matrix.map(row=>[row[6],row[7],row[8]]);
  residuals=samples.map(s=>Math.sqrt(s.rgb.reduce((sum,v,ch)=>sum+(v-s.b.reduce((n,b,k)=>n+b*coefficients[k][ch],0))**2,0)/3));
  const med=median([...residuals]),mad=median(residuals.map(v=>Math.abs(v-med)));const cutoff=Math.max(12,med+3*mad);active=samples.filter((_,i)=>residuals[i]<cutoff);if(active.length<25)break;
 }
 const med=median([...residuals]),mad=median(residuals.map(v=>Math.abs(v-med)));return {coefficients,noise:mad,threshold:Math.max(18,Math.min(65,med+4*mad)),inlierFraction:active.length/Math.max(1,samples.length)};
}

export function referenceSimilarities(vector,gallery){
 const size=vector.length,count=gallery.length/size,scores=new Float32Array(count);
 for(let row=0;row<count;row++){let sum=0;for(let i=0;i<size;i++)sum+=vector[i]*gallery[row*size+i];scores[row]=sum;}
 return scores;
}
export function rankReferenceScores(scores,referenceIds,catalog,limit=3){
 const best=new Map();
 for(let row=0;row<scores.length;row++){const index=referenceIds[row],entry=catalog[index],key=productNdc(entry.ndc)||index;const value=scores[row];if(!best.has(key)||value>best.get(key).score)best.set(key,{...entry,catalogIndex:index,score:value,reference:row});}
 return [...best.values()].sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function jointViewCandidates(first,second,manifest,limit=3){
 const products=new Map();
 for(let row=0;row<manifest.referenceIds.length;row++){
  const index=manifest.referenceIds[row],entry=manifest.catalog[index],key=productNdc(entry.ndc)||entry.id;
  if(!products.has(key))products.set(key,{entry,index,aFront:-1,aBack:-1,bFront:-1,bBack:-1});
  const p=products.get(key),front=manifest.referenceSides?.[row]??(entry.references.indexOf(row)%2===1);
  if(front){p.aFront=Math.max(p.aFront,first[row]);p.bFront=Math.max(p.bFront,second[row]);}
  else{p.aBack=Math.max(p.aBack,first[row]);p.bBack=Math.max(p.bBack,second[row]);}
 }
 return [...products.values()].map(p=>({...p.entry,catalogIndex:p.index,score:Math.max(p.aFront+p.bBack,p.aBack+p.bFront)/2,firstSimilarity:Math.max(p.aFront,p.aBack),secondSimilarity:Math.max(p.bFront,p.bBack)})).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function combineViews(first,second,manifest){
 const quality=[...(first.quality||[]),...(second.quality||[])];
 if(first.pills.length!==second.pills.length||!first.pills.length)return {...first,quality,error:'The two photos have different detected counts. Keep the same pills in the same positions and retake the other side.',views:2,secondaryAnnotated:second.annotated};
 const used=new Set(),pills=[];
 for(const a of first.pills){
  const ax=(a.box.x+a.box.width/2)/first.width,ay=(a.box.y+a.box.height/2)/first.height;
  const ranked=second.pills.map((b,index)=>({b,index,distance:Math.hypot(ax-(b.box.x+b.box.width/2)/second.width,ay-(b.box.y+b.box.height/2)/second.height)})).filter(x=>!used.has(x.index)).sort((x,y)=>x.distance-y.distance);
  if(!ranked.length||ranked[0].distance>.22||(ranked.length>1&&ranked[1].distance-ranked[0].distance<.035))return {...first,quality,error:'Pill positions changed too much to pair the views confidently. Keep each pill in its place when turning it over.',views:2,secondaryAnnotated:second.annotated};
  const b=ranked[0].b;used.add(ranked[0].index);
  if(!a.evidence||!b.evidence)return {...first,quality,error:'This first photo needs to be analyzed again before adding another view.',views:2,secondaryAnnotated:second.annotated};
  const candidates=jointViewCandidates(a.evidence,b.evidence,manifest),margin=candidates[0].score-candidates[1].score,gate=manifest.thresholds.twoView||{similarity:.9,margin:.12,minSingle:.6};
  const chosen=productNdc(candidates[0].ndc),conflict=(a.accepted&&productNdc(a.candidates[0].ndc)!==chosen)||(b.accepted&&productNdc(b.candidates[0].ndc)!==chosen);
  const accepted=!conflict&&candidates[0].score>=gate.similarity&&margin>=gate.margin&&candidates[0].firstSimilarity>=(gate.minSingle||.5)&&candidates[0].secondSimilarity>=(gate.minSingle||.5);
  pills.push({...a,candidates,margin,accepted,viewConflict:conflict,secondThumbnail:b.thumbnail});
 }
 return {...first,pills,quality,views:2,secondaryAnnotated:second.annotated,elapsedMs:first.elapsedMs+second.elapsedMs};
}
