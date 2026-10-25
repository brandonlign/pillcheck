import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnalysis } from "../analysis.mjs";

test("well-formed JSON becomes a pill list", () => {
  const r = parseAnalysis(
    '{"count":2,"pills":[{"color":"white","shape":"capsule","imprint":"PAN 5","possible":null},{"color":"blue","shape":"round","imprint":"TEVA","possible":"null"}],"note":"Clear photo."}',
  );
  assert.equal(r.pills.length, 2);
  assert.equal(r.pills[0].imprint, "PAN 5");
  assert.equal(r.pills[1].possible, null);
  assert.equal(r.note, "Clear photo.");
});

test("fenced JSON and a missing bracket still parse", () => {
  const fenced = parseAnalysis('```json\n{"pills":[{"color":"pink","shape":"round","imprint":"93 733","possible":"X 10 mg"}],"note":null}\n```');
  assert.equal(fenced.pills[0].possible, "X 10 mg");
  const broken = parseAnalysis(
    '{"count":1,"pills":[{"color":"pink","shape":"round","imprint":"93 733","possible":"X"},"note":"Close-up."}',
  );
  assert.equal(broken.pills.length, 1);
  assert.equal(broken.note, "Close-up.");
});

test("repeated output is capped and plain text falls back to a note", () => {
  const many = `{"pills":[${Array(40).fill('{"color":"pink","shape":"round"}').join(",")}]}`;
  assert.equal(parseAnalysis(many).pills.length, 12);
  const plain = parseAnalysis("I can see one white tablet.");
  assert.deepEqual(plain.pills, []);
  assert.equal(plain.note, "I can see one white tablet.");
});
