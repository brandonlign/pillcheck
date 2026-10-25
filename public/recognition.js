import { detectPills, rankEmbeddings, productNdc } from "./recognition-core.js";
let loading, session, manifest, gallery, runtime;
// Product-level view of the gallery, built once: every gallery row maps to one
// product (normalized NDC), so each pill gets a score for every product.
let productIndex, rowProduct, productEntry;
// The encoder is ~88 MB. Expected size is only used when the server sends no Content-Length.
const MODEL_URL = "/models/pill-encoder.onnx",
  MODEL_BYTES = 87644905;
export const modelStatus = { state: "idle", loaded: 0, total: MODEL_BYTES, message: "" };
const listeners = new Set();
function setStatus(patch) {
  Object.assign(modelStatus, patch);
  listeners.forEach((fn) => fn(modelStatus));
}
export function onModelStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const megabytes = (n) => Math.round(n / 1048576);
async function fetchModel() {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw Error("The scan model could not be downloaded.");
  const total = Number(res.headers.get("content-length")) || MODEL_BYTES;
  let bytes = new Uint8Array(total),
    loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > bytes.length) {
      const grown = new Uint8Array(Math.max(bytes.length * 2, loaded + value.length));
      grown.set(bytes);
      bytes = grown;
    }
    bytes.set(value, loaded);
    loaded += value.length;
    setStatus({
      loaded,
      total: Math.max(total, loaded),
      message: `Downloading the scan model… ${megabytes(loaded)} of ${megabytes(Math.max(total, loaded))} MB`,
    });
  }
  return bytes.subarray(0, loaded);
}
export async function loadRecognition(progress = () => {}) {
  const off = onModelStatus((s) => s.message && progress(s.message));
  if (!loading)
    loading = (async () => {
      setStatus({ state: "loading", message: "Loading the on-device recognition model…" });
      runtime = await import("/vendor/ort.wasm.bundle.min.mjs");
      runtime.env.wasm.wasmPaths = "/vendor/";
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = false;
      const responses = await Promise.all([
        fetch("/models/catalog.json"),
        fetch("/models/gallery.f32"),
        fetch("/models/labels.json"),
      ]);
      if (responses.some((r) => !r.ok))
        throw Error(
          "The trained reference library is unavailable. Run the model setup instructions in the README.",
        );
      manifest = await responses[0].json();
      const labelData = await responses[2].json();
      for (const entry of manifest.catalog) {
        const key = productNdc(entry.ndc);
        entry.label = labelData.labels?.[key] || null;
      }
      gallery = new Float32Array(await responses[1].arrayBuffer());
      if (gallery.length !== manifest.referenceCount * manifest.embeddingSize)
        throw Error("Reference library size mismatch.");
      productIndex = new Map();
      productEntry = [];
      rowProduct = new Int32Array(manifest.referenceIds.length);
      manifest.referenceIds.forEach((id, row) => {
        const key = productNdc(manifest.catalog[id].ndc) || manifest.catalog[id].id;
        if (!productIndex.has(key)) {
          productIndex.set(key, productEntry.length);
          productEntry.push(id);
        }
        rowProduct[row] = productIndex.get(key);
      });
      const model = await fetchModel();
      setStatus({ message: "Starting the scan model…" });
      session = await runtime.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      setStatus({ state: "ready", message: "Recognition is ready. Photos stay on this device." });
      return manifest;
    })().catch((e) => {
      loading = null;
      setStatus({ state: "idle", message: "" });
      throw e;
    });
  try {
    return await loading;
  } finally {
    off();
  }
}
export async function getCatalog(progress = () => {}) {
  await loadRecognition(progress);
  return manifest;
}
function canvas(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
function inputTensor(source, quarterTurns = 0) {
  const size = manifest.inputSize,
    c = canvas(size, size),
    ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.translate(size / 2, size / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(source, -size / 2, -size / 2, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data,
    plane = size * size,
    tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++)
    for (let j = 0; j < 3; j++) tensor[j * plane + i] = pixels[i * 4 + j] / 255;
  return new runtime.Tensor("float32", tensor, [1, 3, size, size]);
}
function productScores(vector) {
  const size = vector.length,
    scores = new Float32Array(productEntry.length).fill(-1);
  for (let row = 0; row < rowProduct.length; row++) {
    let s = 0;
    const offset = row * size;
    for (let i = 0; i < size; i++) s += vector[i] * gallery[offset + i];
    const p = rowProduct[row];
    if (s > scores[p]) scores[p] = s;
  }
  return scores;
}
function topProducts(scores, k = 3) {
  const best = [];
  for (let p = 0; p < scores.length; p++) {
    if (best.length < k || scores[p] > best[best.length - 1][1]) {
      best.push([p, scores[p]]);
      best.sort((a, b) => b[1] - a[1]);
      if (best.length > k) best.pop();
    }
  }
  return best.map(([p, score]) => ({ ...manifest.catalog[productEntry[p]], catalogIndex: productEntry[p], score }));
}
// Combine a pill's first photo with a photo of its other side (scores averaged),
// matching how the flip gate was measured in vision/flip_gate.py.
export function fuseSides(first, second) {
  const scores = new Float32Array(first.scores.length);
  for (let i = 0; i < scores.length; i++) scores[i] = (first.scores[i] + second.scores[i]) / 2;
  const candidates = topProducts(scores);
  return {
    ...first,
    scores,
    candidates,
    margin: candidates.length > 1 ? candidates[0].score - candidates[1].score : 0,
    accepted: first.accepted && second.accepted && productNdc(first.candidates[0]?.ndc) === productNdc(second.candidates[0]?.ndc),
    sides: 2,
    backThumbnail: second.thumbnail,
  };
}
const rank = (vector) =>
  rankEmbeddings(vector, gallery, manifest.referenceIds, manifest.catalog);
const productOf = (candidate) => productNdc(candidate?.ndc) || candidate?.id;
// Each pill is embedded at 0/90/180/270 degrees. The averaged embedding is ranked,
// and a match is accepted only when it clears the similarity and runner-up margin
// thresholds AND enough single rotations independently agree on the same product.
// Thresholds come from vision/confidence_gate.py (calibration split only).
async function classify(source) {
  const views = [];
  for (let k = 0; k < 4; k++)
    views.push((await session.run({ image: inputTensor(source, k) })).embedding.data);
  const size = views[0].length,
    mean = new Float32Array(size);
  for (const v of views) for (let i = 0; i < size; i++) mean[i] += v[i];
  const norm = Math.hypot(...mean) || 1;
  for (let i = 0; i < size; i++) mean[i] /= norm;
  const candidates = rank(mean),
    best = productOf(candidates[0]),
    agree = views.filter((v) => productOf(rank(v)[0]) === best).length,
    margin =
      candidates.length > 1 ? candidates[0].score - candidates[1].score : 0,
    t = manifest.thresholds;
  return {
    candidates,
    margin,
    agree,
    scores: productScores(mean),
    sides: 1,
    accepted:
      !!candidates.length &&
      candidates[0].score >= t.similarity &&
      margin >= t.margin &&
      agree >= (t.agree || 1),
  };
}
export async function recognizePhoto(
  file,
  { mode = "dose", progress = () => {} } = {},
) {
  const start = performance.now();
  await loadRecognition(progress);
  progress("Finding pills in the photo…");
  const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    }),
    scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height)),
    source = canvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
  source.getContext("2d").drawImage(bitmap, 0, 0, source.width, source.height);
  bitmap.close();
  let regions,
    quality = [],
    detection;
  if (mode === "single")
    regions = [
      { x: 0, y: 0, width: source.width, height: source.height, single: true },
    ];
  else {
    const small = canvas(
        Math.round(source.width * 0.65),
        Math.round(source.height * 0.65),
      ),
      ctx = small.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, small.width, small.height);
    detection = detectPills(ctx.getImageData(0, 0, small.width, small.height));
    quality = detection.quality;
    regions = detection.components.map((b) => ({
      ...b,
      x: (b.x * source.width) / small.width,
      y: (b.y * source.height) / small.height,
      width: (b.width * source.width) / small.width,
      height: (b.height * source.height) / small.height,
    }));
  }
  const pills = [];
  for (let i = 0; i < regions.length; i++) {
    progress(
      `Comparing pill ${i + 1} of ${regions.length} with ${manifest.catalog.length.toLocaleString()} references…`,
    );
    const box = regions[i];
    let crop;
    if (box.single) crop = source;
    else {
      const side = Math.max(box.width, box.height) * 1.17;
      crop = canvas(manifest.inputSize, manifest.inputSize);
      const ctx = crop.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, crop.width, crop.height);
      ctx.drawImage(
        source,
        box.x - (side - box.width) / 2,
        box.y - (side - box.height) / 2,
        side,
        side,
        0,
        0,
        crop.width,
        crop.height,
      );
    }
    const prediction = await classify(crop);
    pills.push({
      ...prediction,
      box,
      thumbnail: crop.toDataURL("image/jpeg", 0.82),
    });
  }
  const annotated = canvas(source.width, source.height),
    ctx = annotated.getContext("2d");
  ctx.drawImage(source, 0, 0);
  ctx.lineWidth = Math.max(2, source.width / 250);
  ctx.font = `600 ${Math.max(14, source.width / 40)}px system-ui`;
  pills.forEach((p, i) => {
    const { x, y, width, height } = p.box;
    ctx.strokeStyle = p.accepted ? "#75b76c" : "#e8b45f";
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = p.accepted ? "#244e31" : "#78551e";
    const tx = Math.max(0, x),
      ty = Math.max(25, y);
    ctx.fillRect(tx, ty - 25, 95, 25);
    ctx.fillStyle = "white";
    ctx.fillText(
      `#${i + 1} ${p.accepted ? "match" : "unsure"}`,
      tx + 5,
      ty - 7,
    );
  });
  return {
    pills,
    quality,
    mode,
    width: source.width,
    height: source.height,
    annotated: annotated.toDataURL("image/jpeg", 0.87),
    elapsedMs: Math.round(performance.now() - start),
    model: manifest.model || "pillcheck-mobilenet-metric-v1",
    productIndex,
    planGate: manifest.planGate || null,
  };
}
export function referenceStyle(index) {
  const sheet = Math.floor(index / 100),
    local = index % 100;
  return `background-image:url('/models/references-${sheet}.webp');background-size:1600px 800px;background-position:-${(local % 10) * 160}px -${Math.floor(local / 10) * 80}px;`;
}
