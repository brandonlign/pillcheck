import { detectPills, rankEmbeddings, productNdc } from "./recognition-core.js";
let loading, session, manifest, gallery, runtime;
export async function loadRecognition(progress = () => {}) {
  if (!loading)
    loading = (async () => {
      progress("Loading the on-device recognition model…");
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
      session = await runtime.InferenceSession.create(
        "/models/pill-encoder.onnx",
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      );
      progress("Recognition is ready. Photos stay on this device.");
      return manifest;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
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
function inputTensor(source) {
  const size = manifest.inputSize,
    c = canvas(size, size),
    ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data,
    plane = size * size,
    tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++)
    for (let j = 0; j < 3; j++) tensor[j * plane + i] = pixels[i * 4 + j] / 255;
  return new runtime.Tensor("float32", tensor, [1, 3, size, size]);
}
async function classify(source) {
  const output = await session.run({ image: inputTensor(source) });
  const vector = output.embedding.data;
  const candidates = rankEmbeddings(
    vector,
    gallery,
    manifest.referenceIds,
    manifest.catalog,
  );
  const margin =
    candidates.length > 1 ? candidates[0].score - candidates[1].score : 0;
  return {
    candidates,
    margin,
    accepted:
      !!candidates.length &&
      candidates[0].score >= manifest.thresholds.similarity &&
      margin >= manifest.thresholds.margin,
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
  };
}
export function referenceStyle(index) {
  const sheet = Math.floor(index / 100),
    local = index % 100;
  return `background-image:url('/models/references-${sheet}.webp');background-size:1600px 800px;background-position:-${(local % 10) * 160}px -${Math.floor(local / 10) * 80}px;`;
}
