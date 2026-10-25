import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productNdc,
  rankEmbeddings,
  evaluateScan,
  detectPills,
} from "../public/recognition-core.js";
const patient = () => ({
  meds: [
    {
      id: "a",
      name: "Example",
      ndc: "00093-0148-01",
      quantity: 1,
      slots: ["Morning"],
    },
  ],
  logs: [],
});
const pill = (ndc = "00093-0148-01", accepted = true) => ({
  accepted,
  candidates: [{ ndc, id: "id", score: 0.95 }],
});
const options = { day: "2026-10-24", currentSlot: "Morning" };
test("NDC comparisons normalize package codes and zero padding", () => {
  assert.equal(productNdc("0093-0148-01"), "00093-0148");
  assert.equal(productNdc("00093014801"), "00093-0148");
  assert.equal(productNdc("00093-0148"), "00093-0148");
  assert.equal(productNdc(""), null);
});
test("full-gallery retrieval ranks distinct types using normalized embedding similarity", () => {
  const results = rankEmbeddings(
    new Float32Array([1, 0]),
    new Float32Array([1, 0, 0.9, 0.1, 0, 1]),
    [0, 0, 1],
    [{ id: "A" }, { id: "B" }],
  );
  assert.deepEqual(
    results.map((x) => x.id),
    ["A", "B"],
  );
  assert.equal(results[0].score, 1);
});
test("automatic accepted reference and count match can be logged", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill()], quality: [] },
      options,
    ).type,
    "matched",
  ));
test("an unknown pill blocks an automatic match even when another expected pill is present", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill(), pill("11111-1111-01", false)], quality: [] },
      options,
    ).type,
    "uncertain",
  ));
test("a high-scoring unexpected reference flags the wrong pill", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill("11111-1111-01")], quality: [] },
      options,
    ).type,
    "wrong",
  ));
test("an extra duplicate pill fails the expected quantity", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill(), pill()], quality: [] },
      options,
    ).type,
    "missing",
  ));
test("an empty photo never produces a matching dose result", () =>
  assert.equal(
    evaluateScan(patient(), "Morning", { pills: [], quality: [] }, options)
      .type,
    "uncertain",
  ));
test("poor image quality blocks automatic confirmation", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill()], quality: ["Poor background"] },
      options,
    ).type,
    "uncertain",
  ));
test("name-only medication plans require exact appearance reference setup", () => {
  const p = patient();
  delete p.meds[0].ndc;
  assert.equal(
    evaluateScan(p, "Morning", { pills: [pill()], quality: [] }, options).type,
    "setup",
  );
});
test("duplicate log and wrong-period rules remain active after automatic inference", () => {
  const p = patient();
  p.logs.push({ day: options.day, slot: "Morning", status: "taken" });
  assert.equal(evaluateScan(p, "Morning", null, options).type, "duplicate");
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill()], quality: [] },
      { ...options, currentSlot: "Evening" },
    ).type,
    "time",
  );
});
function image(circles = []) {
  const width = 240,
    height = 160,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const fg = circles.some(
        (c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r ** 2,
      );
      data[i] = data[i + 1] = data[i + 2] = fg ? 220 : 20;
      data[i + 3] = 255;
    }
  return { width, height, data };
}
test("detector counts two separated foreground pills without user counts", () => {
  const r = detectPills(
    image([
      { x: 60, y: 70, r: 20 },
      { x: 170, y: 85, r: 24 },
    ]),
  );
  assert.equal(r.components.length, 2);
  assert.deepEqual(r.quality, []);
});
test("detector returns no pills on an empty mat", () =>
  assert.equal(detectPills(image()).components.length, 0));
test("detector flags cut-off foreground objects", () =>
  assert.ok(detectPills(image([{ x: 3, y: 70, r: 20 }])).quality.length));
