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
export function detectPills({ data, width, height }) {
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
  if (deviation > 28)
    quality.push(
      "Use a plain background with no hands, labels, or organizer dividers in view.",
    );
  const mask = new Uint8Array(n),
    threshold = Math.max(35, Math.min(85, deviation * 2.4 + 28));
  for (let i = 0; i < n; i++) {
    let distance = 0;
    for (let c = 0; c < 3; c++) distance += (data[i * 4 + c] - bg[c]) ** 2;
    mask[i] = Math.sqrt(distance / 3) > threshold ? 1 : 0;
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
