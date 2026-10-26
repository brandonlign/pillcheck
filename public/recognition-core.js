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
// Plan-aware check: is this pill one of the plan's medicines? Confirm plan product X
// when its score clears the gate's similarity, nothing outside the plan beats it by
// more than `ahead`, and it leads the next plan medicine by `margin`. Mirrors
// vision/plan_check.py; gates come from vision/flip_gate.py (held-out pairs).
export function planDecision(scores, planIndices, gate) {
  if (!scores || !gate || !planIndices.length) return -1;
  let best = -Infinity;
  for (let i = 0; i < scores.length; i++) if (scores[i] > best) best = scores[i];
  let x = -1,
    sx = -Infinity,
    s2 = -Infinity;
  for (const i of planIndices) {
    const v = scores[i];
    if (v > sx) {
      s2 = sx;
      sx = v;
      x = i;
    } else if (v > s2) s2 = v;
  }
  return sx >= gate.similarity && sx >= best - gate.ahead && sx - s2 >= gate.margin ? x : -1;
}
function planAware(scan, expected) {
  const index = scan.productIndex,
    keys = [...new Set(expected.map((m) => productNdc(m.ndc || m.pillId)))],
    planIndices = keys.map((k) => index.get(k)).filter((i) => i !== undefined),
    keyOf = new Map(keys.map((k) => [index.get(k), k])),
    matches = [],
    unsure = [];
  let wrong = false;
  scan.pills.forEach((pill, i) => {
    const gate = pill.sides === 2 ? scan.planGate.flipped : scan.planGate.photo,
      hit = planDecision(pill.scores, planIndices, gate);
    if (hit >= 0) return matches.push(keyOf.get(hit));
    matches.push(null);
    // Confidently a different product (global gate) -> wrong pill; otherwise unsure.
    if (pill.accepted && !keys.includes(productNdc(pill.candidates[0]?.ndc))) wrong = true;
    else unsure.push(i);
  });
  return { keys, matches, unsure, wrong };
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
  // Photo tips (a pill near the edge, pills touching) are shown with the result but
  // don't block it; the plan and count checks below still have to pass.
  if (scan.error)
    return {
      type: "uncertain",
      title: "A clearer photo is needed",
      detail: scan.error,
    };
  if (!scan.pills.length)
    return {
      type: "uncertain",
      title: "No clear pills found",
      detail:
        scan.quality?.join(" ") ||
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
  // No pill outlines were found and the middle of the photo was checked instead, so
  // the pill count is unknown: never confirm a dose from that.
  if (scan.pills.some((p) => p.box?.fallback))
    return {
      type: "uncertain",
      title: "A clearer photo is needed",
      detail: "PillCheck couldn’t outline each pill. Spread the pills on a plain surface with space between them and try again.",
    };
  if (scan.productIndex && scan.planGate && scan.pills.every((p) => p.scores)) {
    const { keys, matches, unsure, wrong } = planAware(scan, expected);
    if (wrong)
      return {
        type: "wrong",
        matches,
        title: "An unexpected pill may be present",
        detail: "At least one pill looks like a medicine that isn’t in this dose. Check the bottle and ask your pharmacist about unfamiliar pills.",
      };
    const flip = unsure.filter((i) => scan.pills[i].sides !== 2);
    if (flip.length)
      return {
        type: "flip",
        matches,
        flip,
        title: "Flip to confirm",
        detail: `Turn pill ${flip.map((i) => i + 1).join(" and ")} over and scan the other side so PillCheck can be sure.`,
      };
    if (unsure.length)
      return {
        type: "uncertain",
        matches,
        title: "Not sure about every pill",
        detail: "Even with both sides, at least one pill isn’t a confident match. Check the bottle label or ask a pharmacist.",
      };
    const counts = new Map();
    for (const k of matches) counts.set(k, (counts.get(k) || 0) + 1);
    const planned = new Map();
    for (const m of expected) {
      const k = productNdc(m.ndc || m.pillId);
      planned.set(k, (planned.get(k) || 0) + m.quantity);
    }
    if (keys.some((k) => counts.get(k) !== planned.get(k)))
      return {
        type: "missing",
        matches,
        title: "The detected counts do not match",
        detail: "The photo has a different number of one or more expected pills. Recheck the prepared dose.",
      };
    return {
      type: "matched",
      matches,
      title: "Photo matches the saved pill references",
      detail: "Every pill matches a medicine in this dose, and the counts are right. Follow your prescription and check unfamiliar pills with a pharmacist.",
    };
  }
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
// Finds separate pills in a camera photo. Each pixel is compared with a background
// estimate: one surface color when the photo's border is plain, otherwise a local
// estimate (median of nearby blocks) that follows wood grain, cloth, skin and uneven
// light. Outline edges catch white pills on white surfaces, holes left by imprints are
// filled, and pills that touch are split where their joined shape narrows. The work is
// done on a copy at most maxSide px across; boxes come back in input pixels.
export function detectPills({ data, width, height }, { maxSide = 360 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(width, height)),
    w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale)),
    n = w * h;
  // Luma plus two color-opponent channels, averaged down to the working size.
  const L = new Float32Array(n),
    A = new Float32Array(n),
    B = new Float32Array(n),
    count = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const row = Math.min(h - 1, Math.floor(y * scale)) * w;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        t = row + Math.min(w - 1, Math.floor(x * scale)),
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      L[t] += 0.299 * r + 0.587 * g + 0.114 * b;
      A[t] += r - g;
      B[t] += (r + g) / 2 - b;
      count[t]++;
    }
  }
  for (let t = 0; t < n; t++) {
    const c = count[t] || 1;
    L[t] /= c;
    A[t] /= c;
    B[t] /= c;
  }
  // Shadows only darken the surface, so darker-than-background counts for less.
  const difference = (dl, da, db) => {
    const l = dl > 0 ? dl : dl * 0.4;
    return Math.sqrt(l * l + 0.6 * (da * da + db * db));
  };

  // Block medians and texture (median absolute deviation of luma).
  const bs = Math.max(6, Math.round(Math.max(w, h) / 20)),
    gw = Math.ceil(w / bs),
    gh = Math.ceil(h / bs),
    cells = gw * gh,
    median = (values) => {
      const s = Float32Array.from(values).sort();
      return s[s.length >> 1] || 0;
    };
  let grid = [new Float32Array(cells), new Float32Array(cells), new Float32Array(cells)],
    texture = new Float32Array(cells);
  const channels = [L, A, B];
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) {
      const k = by * gw + bx,
        values = [[], [], []];
      for (let y = by * bs; y < Math.min(h, (by + 1) * bs); y++)
        for (let x = bx * bs; x < Math.min(w, (bx + 1) * bs); x++)
          for (let c = 0; c < 3; c++) values[c].push(channels[c][y * w + x]);
      for (let c = 0; c < 3; c++) grid[c][k] = median(values[c]);
      texture[k] = 1.4826 * median(values[0].map((v) => Math.abs(v - grid[0][k])));
    }
  const borderCells = [];
  for (let k = 0; k < cells; k++) {
    const bx = k % gw,
      by = Math.floor(k / gw);
    if (bx === 0 || by === 0 || bx === gw - 1 || by === gh - 1) borderCells.push(k);
  }
  const surface = [0, 1, 2].map((c) => median(borderCells.map((k) => grid[c][k]))),
    spread = median(
      borderCells.map((k) =>
        difference(grid[0][k] - surface[0], grid[1][k] - surface[1], grid[2][k] - surface[2]),
      ),
    ),
    plain = spread < 10;
  const filterGrid = (src, r) => {
    const out = new Float32Array(cells);
    for (let by = 0; by < gh; by++)
      for (let bx = 0; bx < gw; bx++) {
        const v = [];
        for (let y = Math.max(0, by - r); y <= Math.min(gh - 1, by + r); y++)
          for (let x = Math.max(0, bx - r); x <= Math.min(gw - 1, bx + r); x++) v.push(src[y * gw + x]);
        out[by * gw + bx] = median(v);
      }
    return out;
  };
  if (plain) {
    grid = surface.map((v) => new Float32Array(cells).fill(v));
    texture = new Float32Array(cells).fill(median(borderCells.map((k) => texture[k])));
  } else {
    // A block is surface when its color is close to one of the photo's border blocks
    // (the most typical 80%, in case a pill touches the edge). Other blocks are pills
    // or clutter, so their surface is filled in from the nearest surface blocks. This
    // keeps a tight cluster of pills from being mistaken for the surface.
    const dists = borderCells.map((k) =>
        difference(grid[0][k] - surface[0], grid[1][k] - surface[1], grid[2][k] - surface[2]),
      ),
      cutoff = Float32Array.from(dists).sort()[Math.floor(dists.length * 0.8)],
      palette = borderCells.filter((k, i) => dists[i] <= cutoff),
      tolerance = 16 + 1.5 * median(palette.map((k) => texture[k])),
      known = new Uint8Array(cells);
    for (let k = 0; k < cells; k++)
      known[k] = palette.some(
        (b) => difference(grid[0][k] - grid[0][b], grid[1][k] - grid[1][b], grid[2][k] - grid[2][b]) < tolerance,
      )
        ? 1
        : 0;
    for (let pass = 0; pass < gw + gh && known.includes(0); pass++) {
      const add = [];
      for (let k = 0; k < cells; k++) {
        if (known[k]) continue;
        const bx = k % gw,
          by = Math.floor(k / gw),
          sum = [0, 0, 0, 0];
        let c = 0;
        for (let y = Math.max(0, by - 1); y <= Math.min(gh - 1, by + 1); y++)
          for (let x = Math.max(0, bx - 1); x <= Math.min(gw - 1, bx + 1); x++) {
            const j = y * gw + x;
            if (!known[j]) continue;
            sum[0] += grid[0][j];
            sum[1] += grid[1][j];
            sum[2] += grid[2][j];
            sum[3] += texture[j];
            c++;
          }
        if (c) add.push([k, sum.map((s) => s / c)]);
      }
      for (const [k, v] of add) {
        grid[0][k] = v[0];
        grid[1][k] = v[1];
        grid[2][k] = v[2];
        texture[k] = v[3];
        known[k] = 1;
      }
    }
    grid = grid.map((g) => filterGrid(g, 1));
    texture = filterGrid(texture, 1);
  }
  const sample = (src, x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5)),
      fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5)),
      x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      x1 = Math.min(gw - 1, x0 + 1),
      y1 = Math.min(gh - 1, y0 + 1),
      ax = fx - x0,
      ay = fy - y0;
    return (
      (src[y0 * gw + x0] * (1 - ax) + src[y0 * gw + x1] * ax) * (1 - ay) +
      (src[y1 * gw + x0] * (1 - ax) + src[y1 * gw + x1] * ax) * ay
    );
  };

  // Foreground: clearly different from the local surface, or a strong outline on a
  // smooth surface (white pill on a white plate).
  let mask = new Uint8Array(n);
  const edges = new Uint8Array(n),
    tone = { dl: new Float32Array(n), dc: new Float32Array(n), bg: new Float32Array(n) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = y * w + x,
        sigma = sample(texture, x, y),
        bgL = sample(grid[0], x, y),
        da = A[t] - sample(grid[1], x, y),
        db = B[t] - sample(grid[2], x, y),
        score = difference(L[t] - bgL, da, db);
      tone.dl[t] = L[t] - bgL;
      tone.dc[t] = Math.hypot(da, db);
      tone.bg[t] = bgL;
      mask[t] = score > Math.max(20, 10 + 3.5 * sigma) ? 1 : 0;
      if (sigma < 5 && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const gx = L[t - w + 1] + 2 * L[t + 1] + L[t + w + 1] - L[t - w - 1] - 2 * L[t - 1] - L[t + w - 1],
          gy = L[t + w - 1] + 2 * L[t + w] + L[t + w + 1] - L[t - w - 1] - 2 * L[t - w] - L[t - w + 1];
        edges[t] = Math.hypot(gx, gy) / 4 > Math.max(9, 4 * sigma) ? 1 : 0;
      }
    }
  mask = morph(mask, w, h, 1, false);
  mask = morph(mask, w, h, 1, true);
  for (let t = 0; t < n; t++) mask[t] |= edges[t];
  mask = morph(morph(mask, w, h, 2, true), w, h, 2, false);
  fillHoles(mask, w, h);
  mask = morph(morph(mask, w, h, 2, false), w, h, 2, true);

  // Connected regions, each split at narrow necks into separate pills.
  const dist = distanceTransform(mask, w, h),
    label = new Int32Array(n),
    regions = [];
  let next = 0;
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    const id = ++next;
    let head = 0,
      tail = 1;
    queue[0] = s;
    label[s] = id;
    while (head < tail) {
      const at = queue[head++],
        x = at % w;
      for (const nb of [x > 0 ? at - 1 : -1, x < w - 1 ? at + 1 : -1, at - w, at + w])
        if (nb >= 0 && nb < n && mask[nb] && !label[nb]) {
          label[nb] = id;
          queue[tail++] = nb;
        }
    }
    regions.push(...splitRegion(queue.slice(0, tail), dist, w, h, tone));
  }

  const quality = [],
    found = [],
    minArea = Math.max(30, n * 0.0008);
  const cutOff = [];
  for (const r of regions) {
    const bw = r.maxX - r.minX + 1,
      bh = r.maxY - r.minY + 1,
      fill = r.area / (bw * bh),
      edgesTouched = (r.minX <= 1) + (r.minY <= 1) + (r.maxX >= w - 2) + (r.maxY >= h - 2);
    if (r.area < minArea || bw < 5 || bh < 5) continue;
    // Pills are round, oval or capsule shaped: close to the ellipse with the same
    // second moments, and not extremely long.
    const mx = r.sx / r.area,
      my = r.sy / r.area,
      cxx = r.sxx / r.area - mx * mx,
      cyy = r.syy / r.area - my * my,
      cxy = r.sxy / r.area - mx * my,
      half = (cxx + cyy) / 2,
      disc = Math.sqrt(Math.max(0, half * half - (cxx * cyy - cxy * cxy))),
      major = half + disc,
      minor = Math.max(1e-6, half - disc),
      solidity = r.area / (4 * Math.PI * Math.sqrt(major * minor)),
      pillShaped = solidity > 0.8 && solidity < 1.2 && major / minor < 20;
    // A shadow or a gap between fingers is only a darker, same-colored patch of surface.
    const darker = -r.dl / r.area,
      shadow = darker > 0 && r.dc / r.area < 18 && darker < 0.55 * (r.bg / r.area);
    if (shadow) continue;
    if (edgesTouched) {
      // Usually surface, hands or table edges. A big pill-shaped region is a close-up.
      if (edgesTouched === 1 && pillShaped && r.area > n * 0.02 && r.area < n * 0.6)
        quality.push("A pill may be cut off by the image edge. Leave more space around the dose.");
      else {
        if (r.area < n * 0.12) cutOff.push(r.area);
        continue;
      }
    } else if (!pillShaped || r.area > n * 0.6) {
      if (r.area > minArea * 4)
        quality.push("One region is too large or irregular to count as a separate pill. Separate touching objects and retake the photo.");
      continue;
    }
    found.push({ x: r.minX, y: r.minY, width: bw, height: bh, area: r.area, fill });
  }
  // Drop specks that are far smaller than the pills around them.
  const typical = median(found.map((c) => c.area));
  const largest = Math.max(0, ...found.map((c) => c.area));
  let components = found.filter((c) => c.area >= Math.max(found.length >= 3 ? typical * 0.12 : 0, largest * 0.05));
  if (components.length >= 2 && components.some((c) => c.area > typical * 2.6))
    quality.push("Some pills seem to be touching. Spread them apart so each one sits on its own.");
  if (cutOff.some((a) => (found.length ? a >= typical * 0.3 : a >= minArea * 4)))
    quality.push("A pill may be cut off by the image edge. Leave more space around the dose.");
  if (!components.length && !plain)
    quality.push("Use a plain, contrasting surface with no hands, labels, or organizer dividers in view.");
  if (components.length > 20)
    quality.push("Too many objects or background marks were found. Use a cleaner background.");
  const back = 1 / scale;
  components = components
    .slice(0, 20)
    .sort((a, b) => a.x - b.x)
    .map((c) => ({
      x: c.x * back,
      y: c.y * back,
      width: c.width * back,
      height: c.height * back,
      area: c.area * back * back,
      fill: c.fill,
    }));
  return { components, quality: [...new Set(quality)], background: surface, plain };
}

// Turns the pill finder's two output maps (pill and outline, as logits, w x h each)
// into one box per pill. Pill pixels away from any outline form one core per pill;
// each core then grows back over the pill pixels around it, so touching pills stay
// separate. `back` scales boxes from map pixels to photo pixels.
export function pillsFromMaps(maps, w, h, back = 1, { pillAt = -0.5, edgeAt = 1 } = {}) {
  const n = w * h,
    label = new Int32Array(n),
    queue = new Int32Array(n),
    pill = (t) => maps[t] > pillAt,
    core = (t) => maps[t] > pillAt && maps[n + t] < edgeAt,
    neighbors = (t) => {
      const x = t % w;
      return [x > 0 ? t - 1 : -1, x < w - 1 ? t + 1 : -1, t >= w ? t - w : -1, t < n - w ? t + w : -1];
    };
  let next = 0,
    tail = 0;
  for (let s = 0; s < n; s++) {
    if (!core(s) || label[s]) continue;
    const start = tail,
      id = ++next;
    label[s] = id;
    queue[tail++] = s;
    for (let head = start; head < tail; head++)
      for (const nb of neighbors(queue[head]))
        if (nb >= 0 && !label[nb] && core(nb)) {
          label[nb] = id;
          queue[tail++] = nb;
        }
    if (tail - start < 4) {
      // Too small to be a pill's core: forget it.
      for (let k = start; k < tail; k++) label[queue[k]] = -1;
      tail = start;
    }
  }
  for (let head = 0; head < tail; head++)
    for (const nb of neighbors(queue[head]))
      if (nb >= 0 && !label[nb] && pill(nb)) {
        label[nb] = label[queue[head]];
        queue[tail++] = nb;
      }
  const regions = Array.from({ length: next + 1 }, () => ({ minX: w, minY: h, maxX: -1, maxY: -1, area: 0 }));
  for (let t = 0; t < n; t++) {
    const id = label[t];
    if (id <= 0) continue;
    const r = regions[id],
      x = t % w,
      y = (t / w) | 0;
    r.minX = Math.min(r.minX, x);
    r.maxX = Math.max(r.maxX, x);
    r.minY = Math.min(r.minY, y);
    r.maxY = Math.max(r.maxY, y);
    r.area++;
  }
  const quality = [],
    minArea = Math.max(12, n * 0.0004);
  let found = [];
  for (const r of regions) {
    if (r.area < minArea) continue;
    const edgesTouched = (r.minX <= 0) + (r.minY <= 0) + (r.maxX >= w - 1) + (r.maxY >= h - 1);
    if (edgesTouched >= 2 && r.area > n * 0.25) continue;
    if (edgesTouched) {
      // A small sliver at the edge is a cut-off pill or a bit of label: too little to
      // identify, so note it and leave it out.
      quality.push("A pill may be cut off by the image edge. Leave more space around the dose.");
      if (r.area < n * 0.01) continue;
    }
    const bw = r.maxX - r.minX + 1,
      bh = r.maxY - r.minY + 1;
    found.push({ x: r.minX, y: r.minY, width: bw, height: bh, area: r.area, fill: r.area / (bw * bh) });
  }
  const largest = Math.max(0, ...found.map((c) => c.area));
  found = found.filter((c) => c.area >= largest * 0.05);
  if (found.length > 20) quality.push("Too many objects were found. Use a cleaner background.");
  const components = found
    .slice(0, 20)
    .sort((a, b) => a.x - b.x)
    .map((c) => ({
      x: c.x * back,
      y: c.y * back,
      width: c.width * back,
      height: c.height * back,
      area: c.area * back * back,
      fill: c.fill,
    }));
  return { components, quality: [...new Set(quality)] };
}

function morph(src, w, h, r, dilate) {
  // Square structuring element, done as a horizontal then a vertical pass.
  const tmp = new Uint8Array(src.length),
    out = new Uint8Array(src.length),
    outside = dilate ? 0 : 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const xx = x + d,
          s = xx < 0 || xx >= w ? outside : src[y * w + xx];
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const yy = y + d,
          s = yy < 0 || yy >= h ? outside : tmp[yy * w + x];
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      out[y * w + x] = v;
    }
  return out;
}

function fillHoles(mask, w, h) {
  // Background reachable from the border stays background; enclosed gaps become pill.
  const n = w * h,
    reach = new Uint8Array(n),
    queue = new Int32Array(n);
  let tail = 0;
  const seed = (t) => {
    if (!mask[t] && !reach[t]) {
      reach[t] = 1;
      queue[tail++] = t;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let head = 0; head < tail; head++) {
    const at = queue[head],
      x = at % w;
    if (x > 0) seed(at - 1);
    if (x < w - 1) seed(at + 1);
    if (at >= w) seed(at - w);
    if (at < n - w) seed(at + w);
  }
  for (let t = 0; t < n; t++) if (!reach[t]) mask[t] = 1;
}

function distanceTransform(mask, w, h) {
  // Two-pass chamfer distance to the nearest background pixel.
  const n = w * h,
    d = new Float32Array(n),
    D = Math.SQRT2;
  for (let t = 0; t < n; t++) d[t] = mask[t] ? 1e6 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = y * w + x;
      if (!d[t]) continue;
      let v = d[t];
      if (x > 0) v = Math.min(v, d[t - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[t - w] + 1);
        if (x > 0) v = Math.min(v, d[t - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[t - w + 1] + D);
      }
      d[t] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const t = y * w + x;
      if (!d[t]) continue;
      let v = d[t];
      if (x < w - 1) v = Math.min(v, d[t + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[t + w] + 1);
        if (x < w - 1) v = Math.min(v, d[t + w + 1] + D);
        if (x > 0) v = Math.min(v, d[t + w - 1] + D);
      }
      d[t] = v;
    }
  for (let t = 0; t < n; t++) if (d[t] >= 1e6) d[t] = Math.max(w, h);
  return d;
}

function splitRegion(pixels, dist, w, h, tone) {
  // Peaks of the distance map are pill centers. Two peaks belong to different pills
  // when the shape narrows between them; a capsule's ridge has no such neck.
  const inside = new Set(pixels);
  let top = 0;
  for (const t of pixels) top = Math.max(top, dist[t]);
  const peaks = [];
  if (top >= 3)
    for (const t of pixels) {
      const v = dist[t],
        x = t % w;
      if (v < top * 0.4) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            nb = t + dy * w + dx;
          if ((dx || dy) && xx >= 0 && xx < w && nb >= 0 && nb < w * h && dist[nb] > v) {
            peak = false;
            break;
          }
        }
      if (peak) peaks.push(t);
    }
  peaks.sort((a, b) => dist[b] - dist[a]);
  const markers = [];
  for (const p of peaks) {
    if (markers.length >= 15) break;
    const px = p % w,
      py = Math.floor(p / w);
    const separate = markers.every((m) => {
      const mx = m % w,
        my = Math.floor(m / w),
        len = Math.hypot(px - mx, py - my);
      if (len < Math.max(dist[p], dist[m])) return false;
      let low = Infinity;
      for (let s = 1; s < len; s++) {
        const x = Math.round(mx + ((px - mx) * s) / len),
          y = Math.round(my + ((py - my) * s) / len),
          t = y * w + x;
        low = Math.min(low, inside.has(t) ? dist[t] : 0);
      }
      return low < 0.76 * Math.min(dist[p], dist[m]);
    });
    if (separate) markers.push(p);
  }
  const box = () => ({ minX: w, minY: h, maxX: 0, maxY: 0, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, dl: 0, dc: 0, bg: 0 });
  const grow = (r, t) => {
    const x = t % w,
      y = Math.floor(t / w);
    r.minX = Math.min(r.minX, x);
    r.maxX = Math.max(r.maxX, x);
    r.minY = Math.min(r.minY, y);
    r.maxY = Math.max(r.maxY, y);
    r.area++;
    r.sx += x;
    r.sy += y;
    r.sxx += x * x;
    r.syy += y * y;
    r.sxy += x * y;
    r.dl += tone.dl[t];
    r.dc += tone.dc[t];
    r.bg += tone.bg[t];
  };
  if (markers.length < 2) {
    const r = box();
    for (const t of pixels) grow(r, t);
    return [r];
  }
  // Flood outward from each center, highest distance first (a simple watershed).
  const owner = new Map(),
    buckets = Array.from({ length: Math.ceil(top) + 2 }, () => []);
  markers.forEach((m, i) => {
    owner.set(m, i);
    buckets[Math.floor(dist[m])].push(m);
  });
  let level = buckets.length - 1;
  while (level >= 0) {
    const t = buckets[level].pop();
    if (t === undefined) {
      level--;
      continue;
    }
    const x = t % w,
      id = owner.get(t);
    for (const nb of [x > 0 ? t - 1 : -1, x < w - 1 ? t + 1 : -1, t - w, t + w])
      if (nb >= 0 && inside.has(nb) && !owner.has(nb)) {
        owner.set(nb, id);
        const b = Math.floor(dist[nb]);
        buckets[b].push(nb);
        if (b > level) level = b;
      }
  }
  const out = markers.map(box);
  for (const [t, id] of owner) grow(out[id], t);
  return out;
}
