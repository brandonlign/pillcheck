import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  checkDose,
  isTaken,
  blindSpots,
  adherence,
  validateState,
} from "../public/core.js";
const med = (id = "a") => ({
  id,
  name: "Example",
  strength: "10 mg",
  quantity: 1,
  slots: ["Morning"],
  color: "White",
  shape: "Round",
  imprint: "A",
  manufacturer: "",
});
const patient = () => ({
  id: "p",
  name: "Test",
  meds: [med()],
  logs: [],
  refills: [],
});
const obs = { a: { count: 1, appearance: true, unsure: false } };
test("matching observations produce a manual review result, never a pill identity claim", () =>
  assert.equal(checkDose(patient(), "Morning", obs).type, "reviewed"));
test("a previously logged dose takes precedence over observations", () => {
  const p = patient();
  p.logs.push({ day: dayKey(), slot: "Morning", status: "taken" });
  assert.equal(checkDose(p, "Morning", obs).type, "duplicate");
});
test("uncertain observations cannot produce a match", () =>
  assert.equal(
    checkDose(patient(), "Morning", { a: { ...obs.a, unsure: true } }).type,
    "uncertain",
  ));
test("missing observations require a closer look", () =>
  assert.equal(checkDose(patient(), "Morning", {}).type, "uncertain"));
test("wrong pill count is flagged", () =>
  assert.equal(
    checkDose(patient(), "Morning", { a: { ...obs.a, count: 0 } }).type,
    "missing",
  ));
test("appearance change requires review", () =>
  assert.equal(
    checkDose(patient(), "Morning", { a: { ...obs.a, appearance: false } })
      .type,
    "changed",
  ));
test("wrong period never produces a checklist match", () =>
  assert.equal(
    checkDose(patient(), "Morning", obs, { currentSlot: "Evening" }).type,
    "time",
  ));
test("unscheduled period cannot pass", () =>
  assert.equal(checkDose(patient(), "Bedtime", {}).type, "uncertain"));
test("concern records never mark a dose taken", () => {
  const p = patient();
  p.logs.push({ day: dayKey(), slot: "Morning", status: "concern" });
  assert.equal(isTaken(p, "Morning"), false);
});
test("duplicate logs count only once toward logging rate", () => {
  const p = patient(),
    d = new Date(2026, 9, 24, 10);
  p.logs = [
    { day: dayKey(d), slot: "Morning", status: "taken" },
    { day: dayKey(d), slot: "Morning", status: "taken" },
  ];
  assert.deepEqual(
    [adherence(p, 1, d).taken, adherence(p, 1, d).expected],
    [1, 1],
  );
});
test("future periods today are excluded", () => {
  const p = patient();
  p.meds[0].slots.push("Evening");
  assert.equal(adherence(p, 1, new Date(2026, 9, 24, 10)).expected, 1);
});
test("look-alike warning compares saved color and shape", () => {
  const a = med(),
    b = med("b");
  assert.equal(blindSpots([a, b]).length, 1);
  b.color = "Pink";
  assert.equal(blindSpots([a, b]).length, 0);
});
test("backup validation rejects malformed medication and logs", () => {
  const s = { version: 1, patients: [patient()] };
  assert.equal(validateState(s), true);
  s.patients[0].meds[0].slots = ["Tomorrow"];
  assert.equal(validateState(s), false);
  assert.equal(validateState({ version: 1, patients: [] }), false);
});
test("day keys use local calendar dates", () =>
  assert.equal(dayKey(new Date(2026, 0, 2, 0, 1)), "2026-01-02"));
test("a newly added medication is not counted before its start date", () => {
  const p = patient(),
    d = new Date(2026, 9, 24, 22);
  p.meds[0].startDate = "2026-10-24";
  assert.equal(adherence(p, 7, d).expected, 1);
});
test("backup validation rejects null entries, duplicate IDs, and invalid organizer marks", () => {
  assert.equal(validateState({ version: 1, patients: [null] }), false);
  assert.equal(
    validateState({ version: 1, patients: [patient(), patient()] }),
    false,
  );
  const p = patient();
  p.organizer = { "2026-10-24|Morning": { status: "safe", note: "", at: "" } };
  assert.equal(validateState({ version: 1, patients: [p] }), false);
});
