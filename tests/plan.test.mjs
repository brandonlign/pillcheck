import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planDecision, evaluateScan } from "../public/recognition-core.js";

// Three products: 0 = in plan, 1 = in plan, 2 = not in plan.
const gate = {
  photo: { similarity: 0.88, ahead: 0, margin: 0 },
  flipped: { similarity: 0.7, ahead: 0.02, margin: 0 },
};
const productIndex = new Map([
  ["11111-1111", 0],
  ["22222-2222", 1],
  ["33333-3333", 2],
]);
const patient = () => ({
  meds: [
    { id: "a", name: "A", strength: "1 mg", quantity: 1, slots: ["Morning"], ndc: "11111-1111" },
    { id: "b", name: "B", strength: "2 mg", quantity: 1, slots: ["Morning"], ndc: "22222-2222" },
  ],
  logs: [],
});
const pill = (scores, { sides = 1, accepted = false, top = "11111-1111" } = {}) => ({
  scores: Float32Array.from(scores),
  sides,
  accepted,
  candidates: [{ ndc: top, score: Math.max(...scores) }],
});
const scanOf = (...pills) => ({ pills, quality: [], productIndex, planGate: gate });
const check = (scan) => evaluateScan(patient(), "Morning", scan, { day: "2026-10-25" });

test("planDecision confirms only a clear, leading plan medicine", () => {
  assert.equal(planDecision(Float32Array.from([0.9, 0.5, 0.4]), [0, 1], gate.photo), 0);
  assert.equal(planDecision(Float32Array.from([0.85, 0.5, 0.4]), [0, 1], gate.photo), -1, "below similarity");
  assert.equal(planDecision(Float32Array.from([0.9, 0.5, 0.95]), [0, 1], gate.photo), -1, "a non-plan product looks better");
  assert.equal(planDecision(Float32Array.from([0.75, 0.3, 0.76]), [0, 1], gate.flipped), 0, "within the flipped gate's lead allowance");
});

test("both plan pills confirmed with the right counts is a match", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.3, 0.91, 0.2], { top: "22222-2222" })));
  assert.equal(r.type, "matched");
  assert.deepEqual(r.matches, ["11111-1111", "22222-2222"]);
});

test("an unsure pill asks for a flip, and only that pill", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.3, 0.8, 0.2], { top: "22222-2222" })));
  assert.equal(r.type, "flip");
  assert.deepEqual(r.flip, [1]);
});

test("after the flip, the fused score is judged by the flipped gate", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.3, 0.8, 0.2], { sides: 2, top: "22222-2222" })));
  assert.equal(r.type, "matched");
});

test("still unsure after a flip says not sure instead of asking again", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.3, 0.6, 0.2], { sides: 2 })));
  assert.equal(r.type, "uncertain");
});

test("a pill confidently identified as a non-plan product is a wrong pill", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.3, 0.2, 0.95], { accepted: true, top: "33333-3333" })));
  assert.equal(r.type, "wrong");
});

test("a look-alike of a plan medicine is not confirmed when something else scores higher", () => {
  // The pill resembles plan product 0 (0.89) but non-plan product 2 scores higher.
  const r = check(scanOf(pill([0.89, 0.2, 0.93]), pill([0.3, 0.91, 0.2], { top: "22222-2222" })));
  assert.notEqual(r.type, "matched");
});

test("two of the same plan pill when one is planned is a count mismatch", () => {
  const r = check(scanOf(pill([0.92, 0.3, 0.2]), pill([0.93, 0.3, 0.2])));
  assert.equal(r.type, "missing");
});

test("shipped catalog carries the photo and flipped plan gates", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/models/catalog.json", import.meta.url)));
  for (const step of ["photo", "flipped"])
    for (const k of ["similarity", "ahead", "margin"])
      assert.equal(typeof catalog.planGate[step][k], "number", `${step}.${k}`);
});
