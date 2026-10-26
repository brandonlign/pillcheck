export const SLOTS = ["Morning", "Afternoon", "Evening", "Bedtime"];
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dosesFor(patient, slot, date = dayKey()) {
  return patient.meds.filter(
    (m) => m.slots.includes(slot) && (!m.startDate || m.startDate <= date),
  );
}
export function isTaken(patient, slot, date = dayKey()) {
  return patient.logs.some(
    (l) => l.day === date && l.slot === slot && l.status === "taken",
  );
}
export function checkDose(
  patient,
  slot,
  observations,
  { date = dayKey(), currentSlot = slot } = {},
) {
  if (isTaken(patient, slot, date))
    return {
      type: "duplicate",
      title: "This dose is already logged",
      detail: "Check the dose history before taking anything else.",
    };
  if (!dosesFor(patient, slot).length)
    return {
      type: "uncertain",
      title: "No medications scheduled",
      detail: "Check the schedule against the prescription label.",
    };
  if (currentSlot !== slot)
    return {
      type: "time",
      title: "Check the scheduled time",
      detail: `You selected ${slot.toLowerCase()}, but the current period is ${currentSlot.toLowerCase()}. Review your prescription instructions.`,
    };
  const expected = dosesFor(patient, slot);
  if (expected.some((m) => !observations[m.id] || observations[m.id].unsure))
    return {
      type: "uncertain",
      title: "A closer look is needed",
      detail:
        "One or more pills could not be confidently checked. Ask a caregiver or pharmacist to help.",
    };
  if (expected.some((m) => Number(observations[m.id].count) !== m.quantity))
    return {
      type: "missing",
      title: "The pill counts do not match",
      detail:
        "Your reported counts differ from your saved plan. Recheck the bottle and prepared dose.",
    };
  if (expected.some((m) => !observations[m.id].appearance))
    return {
      type: "changed",
      title: "A pill looks different",
      detail:
        "A manufacturer change is possible, but appearance cannot establish identity. Confirm with your pharmacist.",
    };
  return {
    type: "reviewed",
    title: "Your checklist matches your plan",
    detail:
      "Counts and appearance match what you reported. Pill identity has not been verified by the camera.",
  };
}
export function blindSpots(meds) {
  const pairs = [];
  for (let i = 0; i < meds.length; i++)
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i],
        b = meds[j];
      if (a.color === b.color && a.shape === b.shape) pairs.push([a, b]);
    }
  return pairs;
}
export function currentSlot(date = new Date()) {
  const h = date.getHours();
  return h < 12
    ? "Morning"
    : h < 17
      ? "Afternoon"
      : h < 21
        ? "Evening"
        : "Bedtime";
}
export function adherence(patient, days = 7, date = new Date()) {
  let expected = 0,
    taken = 0;
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const slots = SLOTS.filter(
      (s) =>
        dosesFor(patient, s, key).length &&
        (i > 0 || SLOTS.indexOf(s) <= SLOTS.indexOf(currentSlot(date))),
    );
    let n = 0;
    slots.forEach((s) => {
      expected++;
      if (isTaken(patient, s, key)) {
        taken++;
        n++;
      }
    });
    daily.push({
      day: key,
      label: d.toLocaleDateString("en", { weekday: "short" }),
      expected: slots.length,
      taken: n,
    });
  }
  return {
    expected,
    taken,
    daily,
  };
}
export function validateState(s) {
  return (
    !!s &&
    s.version === 1 &&
    Array.isArray(s.patients) &&
    s.patients.length <= 30 &&
    new Set(s.patients.map((p) => p?.id)).size === s.patients.length &&
    s.patients.every(
      (p) =>
        !!p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        Array.isArray(p.meds) &&
        new Set(p.meds.map((m) => m?.id)).size === p.meds.length &&
        p.meds.every(
          (m) =>
            !!m &&
            (m.startDate === undefined ||
              /^\d{4}-\d{2}-\d{2}$/.test(m.startDate)) &&
            typeof m.id === "string" &&
            typeof m.name === "string" &&
            typeof m.strength === "string" &&
            typeof m.color === "string" &&
            typeof m.shape === "string" &&
            typeof m.imprint === "string" &&
            typeof m.manufacturer === "string" &&
            Number.isInteger(m.quantity) &&
            m.quantity > 0 &&
            m.quantity < 21 &&
            Array.isArray(m.slots) &&
            m.slots.length > 0 &&
            m.slots.every((x) => SLOTS.includes(x)),
        ) &&
        Array.isArray(p.logs) &&
        p.logs.every(
          (l) =>
            !!l &&
            typeof l.id === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(l.day) &&
            SLOTS.includes(l.slot) &&
            ["taken", "skipped", "concern"].includes(l.status) &&
            typeof l.at === "string" &&
            typeof l.note === "string",
        ) &&
        (p.organizer === undefined ||
          (!!p.organizer &&
            typeof p.organizer === "object" &&
            !Array.isArray(p.organizer) &&
            Object.entries(p.organizer).every(
              ([key, v]) =>
                /^\d{4}-\d{2}-\d{2}\|(Morning|Afternoon|Evening|Bedtime)$/.test(
                  key,
                ) &&
                !!v &&
                ["checked", "concern"].includes(v.status) &&
                typeof v.note === "string" &&
                typeof v.at === "string",
            ))) &&
        Array.isArray(p.refills) &&
        p.refills.every(
          (r) =>
            !!r &&
            typeof r.at === "string" &&
            typeof r.name === "string" &&
            typeof r.note === "string",
        ),
    )
  );
}
