import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ort from "onnxruntime-web/wasm";
import { rankEmbeddings, productNdc } from "../public/recognition-core.js";
test("actual shipped neural model recognizes a real held-out pill fixture", async () => {
  const root = new URL("../", import.meta.url);
  const catalog = JSON.parse(
    await readFile(new URL("public/models/catalog.json", root)),
  );
  const expected = JSON.parse(
    await readFile(new URL("tests/fixtures/pill.expected.json", root)),
  );
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(
    new Uint8Array(
      await readFile(new URL("public/models/pill-encoder.onnx", root)),
    ),
    { executionProviders: ["wasm"] },
  );
  const bytes = await readFile(new URL("tests/fixtures/pill.input.f32", root));
  const input = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const output = await session.run({
    image: new ort.Tensor("float32", input, [
      1,
      3,
      catalog.inputSize,
      catalog.inputSize,
    ]),
  });
  const vector = output.embedding.data;
  assert.equal(vector.length, catalog.embeddingSize);
  assert.ok(vector.every(Number.isFinite));
  const raw = await readFile(new URL("public/models/gallery.f32", root));
  const gallery = new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
  const candidates = rankEmbeddings(
    vector,
    gallery,
    catalog.referenceIds,
    catalog.catalog,
  );
  assert.equal(productNdc(candidates[0].ndc), productNdc(expected.ndc));
  assert.ok(candidates[0].score >= catalog.thresholds.similarity);
  assert.ok(
    candidates[0].score - candidates[1].score >= catalog.thresholds.margin,
  );
  await session.release();
});
