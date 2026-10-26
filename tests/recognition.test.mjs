import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productNdc,
  rankEmbeddings,
  evaluateScan,
  detectPills,
  pillsFromMaps,
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
test("a photo tip is shown with the result but does not block it", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [pill()], quality: ["A pill may be cut off by the image edge."] },
      options,
    ).type,
    "matched",
  ));
test("a center-of-photo fallback check never confirms a dose", () =>
  assert.equal(
    evaluateScan(
      patient(),
      "Morning",
      { pills: [{ ...pill(), box: { fallback: true } }], quality: [] },
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

// Photo-like scenes: textured surface, uneven light, touching pills.
function scene(shapes, { W = 360, H = 240, wood = true, light = true } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4,
        grain = wood ? 18 * Math.sin(y / 3 + Math.sin(x / 40) * 2) : 0,
        shade = light ? 30 * (x / W) : 0,
        pill = shapes.find((c) => ((x - c.x) / (c.rx || c.r)) ** 2 + ((y - c.y) / (c.ry || c.r)) ** 2 < 1);
      const [r, g, b] = pill ? pill.color || [235, 235, 238] : [150 + grain + shade, 100 + grain + shade, 60 + grain / 2 + shade];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: W, height: H, data };
}
test("detector finds pills on a wood-grain surface with uneven light", () =>
  assert.equal(
    detectPills(
      scene([
        { x: 70, y: 70, r: 22 },
        { x: 180, y: 150, rx: 40, ry: 16 },
        { x: 280, y: 80, r: 18, color: [200, 40, 40] },
      ]),
    ).components.length,
    3,
  ));
test("detector finds a cluster of pills that covers the middle of the photo", () => {
  const shapes = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) shapes.push({ x: 110 + i * 46, y: 70 + j * 50, r: 19 });
  assert.equal(detectPills(scene(shapes)).components.length, 12);
});
test("detector splits two pills that touch", () =>
  assert.equal(
    detectPills(scene([{ x: 140, y: 120, r: 40 }, { x: 219, y: 120, r: 40 }], { wood: false, light: false })).components.length,
    2,
  ));
test("detector keeps one capsule whole", () =>
  assert.equal(detectPills(scene([{ x: 180, y: 120, rx: 90, ry: 30 }], { wood: false })).components.length, 1));

// The pill finder's maps: logit > 0 means pill (first map) or outline (second map).
function maps(circles, w = 120, h = 80) {
  const m = new Float32Array(2 * w * h).fill(-5);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (const c of circles) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d < c.r) m[y * w + x] = 5;
        if (Math.abs(d - c.r) < 2) m[w * h + y * w + x] = 5;
      }
  return { m, w, h };
}
test("pill finder maps split two touching pills along their outlines", () => {
  const { m, w, h } = maps([{ x: 40, y: 40, r: 18 }, { x: 75, y: 40, r: 18 }]);
  const r = pillsFromMaps(m, w, h, 2);
  assert.equal(r.components.length, 2);
  assert.ok(Math.abs(r.components[0].width - 72) < 8, "boxes are scaled back to photo pixels");
});
test("pill finder maps with no pill pixels give no pills", () =>
  assert.equal(pillsFromMaps(new Float32Array(2 * 50 * 40).fill(-3), 50, 40).components.length, 0));
