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
test('recognition crop maps preview detections back to original photo pixels',async()=>{
 const {originalCrop}=await import('../public/recognition-core.js');
 const crop=originalCrop({x:100,y:100,width:180,height:90},{width:900,height:675},{width:4000,height:3000},1);
 assert.equal(crop.width,800);assert.equal(crop.height,800);
 assert.ok(Math.abs(crop.x-100*4000/900)<1e-8);
 assert.ok(Math.abs(crop.y-55*3000/675)<1e-8);
});
test('two-view matching combines opposite pill faces rather than averaging unrelated guesses',async()=>{
 const {jointViewCandidates}=await import('../public/recognition-core.js');
 const manifest={catalog:[{id:'A',ndc:'00093-0148',references:[0,1]},{id:'B',ndc:'11111-1111',references:[2,3]}],referenceIds:[0,0,1,1],referenceSides:[true,false,true,false]};
 const candidates=jointViewCandidates([.95,.1,.8,.2],[.1,.94,.2,.7],manifest);
 assert.equal(candidates[0].id,'A');assert.ok(Math.abs(candidates[0].score-.945)<1e-6);
});
test('a retake with changed counts cannot produce a combined dose match',async()=>{
 const {combineViews}=await import('../public/recognition-core.js');
 const combined=combineViews({pills:[{box:{x:0,y:0,width:10,height:10}}],width:100,height:100,quality:[]},{pills:[],width:100,height:100,quality:[]},{});
 assert.ok(combined.error.includes('different detected counts'));
});
test('smooth lighting gradients are modeled separately from separated pills',()=>{
 const width=240,height=160,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,foreground=(x-65)**2+(y-80)**2<19**2||(x-170)**2+(y-85)**2<22**2;
  const background=35+x*.55+y*.15;
  data[i]=foreground?235:background;data[i+1]=foreground?220:background;data[i+2]=foreground?180:background;data[i+3]=255;
 }
 const detected=detectPills({width,height,data},{illumination:true});
 assert.equal(detected.components.length,2);assert.deepEqual(detected.quality,[]);
});
