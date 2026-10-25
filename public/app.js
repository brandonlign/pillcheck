import { recognizePhoto, getCatalog, referenceStyle } from "./recognition.js";
import { evaluateScan, productNdc } from "./recognition-core.js";
import {
  SLOTS,
  dayKey,
  dosesFor,
  isTaken,
  checkDose,
  blindSpots,
  currentSlot,
  adherence,
  validateState,
} from "./core.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  pill: '<path d="m8 16 8-8M5 19a6 6 0 0 1 0-8l6-6a6 6 0 0 1 8 8l-6 6a6 6 0 0 1-8 0Z"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/>',
  chart: '<path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  volume:
    '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.pill}</svg>`;
const colors = {
  White: "#f6f3e8",
  Pink: "#e8b5a9",
  Yellow: "#e7d791",
  Blue: "#a9c5dc",
  Orange: "#e4b27e",
  Green: "#b3c8a5",
  Brown: "#b18f72",
  Red: "#cd8073",
  Purple: "#c5b2d1",
};
const pill = (m) =>
  `<span class="pill ${esc(m.shape.toLowerCase())}" style="--pill:${colors[m.color] || colors.White}" aria-label="${esc(m.color)} ${esc(m.shape)} illustration"></span>`;
const uid = () => crypto.randomUUID();
function demoState() {
  const meds = [
    {
      id: "demo-l",
      name: "Lisinopril",
      strength: "10 mg",
      quantity: 1,
      slots: ["Morning"],
      color: "Pink",
      shape: "Round",
      imprint: "Example",
      manufacturer: "Example manufacturer",
      rx: null,
    },
    {
      id: "demo-m",
      name: "Metformin",
      strength: "500 mg",
      quantity: 1,
      slots: ["Morning", "Evening"],
      color: "White",
      shape: "Oval",
      imprint: "Example",
      manufacturer: "Example manufacturer",
      rx: null,
    },
    {
      id: "demo-a",
      name: "Atorvastatin",
      strength: "20 mg",
      quantity: 1,
      slots: ["Evening"],
      color: "White",
      shape: "Oval",
      imprint: "Example",
      manufacturer: "Example manufacturer",
      rx: null,
    },
  ];
  const logs = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    for (const slot of ["Morning", "Evening"])
      if (!(i === 3 && slot === "Evening"))
        logs.push({
          id: uid(),
          day: dayKey(d),
          slot,
          status: "taken",
          at: d.toISOString(),
          note: "Illustrative demo record",
        });
  }
  return {
    version: 1,
    demo: true,
    active: "demo",
    large: false,
    language: "en-US",
    patients: [
      { id: "demo", name: "Eleanor", meds, logs, refills: [], organizer: {} },
    ],
  };
}
let state;
try {
  state = JSON.parse(localStorage.getItem("pillcheck-v1"));
  if (!validateState(state)) state = demoState();
} catch {
  state = demoState();
}
let page = "today",
  selectedSlot = currentSlot(),
  photo = null,
  photoUrl = null,
  result = null,
  observations = {},
  orgRows = 2,
  orgWeek = dayKey(weekStart()),
  search = "",
  lookup = [],
  viewOrgPhoto = null;
let storageError = false;
let scan = null,
  scanBusy = false,
  scanProgress = "",
  scanMode = "dose",
  scanVersion = 0,
  scanLabels = {},
  visionEvaluation = null;
fetch("/models/evaluation.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    visionEvaluation = v;
  })
  .catch(() => {});
function save() {
  try {
    localStorage.setItem("pillcheck-v1", JSON.stringify(state));
    storageError = false;
  } catch {
    storageError = true;
    toast("Storage is full or blocked. Export a backup before closing.");
  }
}
const patient = () =>
  state.patients.find((p) => p.id === state.active) || state.patients[0];
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function resetCheck() {
  scanVersion++;
  scan = null;
  scanBusy = false;
  scanProgress = "";
  scanLabels = {};
  if (viewOrgPhoto) {
    URL.revokeObjectURL(viewOrgPhoto);
    viewOrgPhoto = null;
  }
  selectedSlot = currentSlot();
  observations = {};
  result = null;
  photo = null;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
}
function nav(next) {
  page = next;
  result = null;
  render();
  window.scrollTo(0, 0);
}
const button = (label, action, kind = "", ico = "") =>
  `<button class="btn ${kind}" data-action="${action}">${ico ? icon(ico) : ""}${label}</button>`;
const heading = (title, sub, action = "") =>
  `<div class="heading"><div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`;
function render() {
  const p = patient();
  document.body.classList.toggle("large-text", !!state.large);
  const navigation = [
    ["today", "home", "Today"],
    ["meds", "pill", "Medications"],
    ["check", "camera", "Dose check"],
    ["organizer", "calendar", "Organizer"],
    ["family", "chart", "Care circle"],
    ["settings", "settings", "Settings"],
  ];
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/icon.svg" alt=""><span>Pill<span>Check</span></span></div><nav class="nav" aria-label="Main navigation">${navigation.map(([id, ic, label]) => `<button data-page="${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(ic)}${label}</button>`).join("")}</nav><div class="side-bottom"><div class="local-badge"><span class="dot"></span> Stored on this device</div><div class="foot">A little more peace of mind.<br>Built for the people you love.</div></div></aside><main class="main"><header class="topbar"><span class="breadcrumb">Daily care / ${esc(patient().name)}</span><div class="brand mobile-brand"><img src="/icon.svg" alt="">PillCheck</div><div class="top-right"><span class="chip ${state.demo ? "demo" : ""}">${state.demo ? "Sample profile" : "Personal profile"}</span><select aria-label="Active care profile" id="patient-select" class="patient-select">${state.patients.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><div class="avatar">${esc(p.name.slice(0, 2).toUpperCase())}</div></div></header><div class="content">${storageError ? '<div class="note amber">Changes are not being saved. Export a backup in Settings.</div>' : ""}${({ today: today, meds: medications, check: checkPage, organizer: organizer, family: family, settings: settings }[page] || today)()}<footer class="footer"><span>PillCheck is a double-check aid. Follow your prescription and confirm uncertainties with your pharmacist.</span><span>Local-first · Research prototype</span></footer></div></main></div>`;
  $("#patient-select").onchange = (e) => {
    state.active = e.target.value;
    state.demo = patient().id.startsWith("demo");
    resetCheck();
    save();
    render();
  };
  bind();
}
function today() {
  const p = patient(),
    stats = adherence(p),
    slots = SLOTS.filter((s) => dosesFor(p, s).length),
    done = slots.filter((s) => isTaken(p, s)).length,
    next = slots.find((s) => !isTaken(p, s));
  return (
    heading(
      `Today, ${esc(p.name)}.`,
      `${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} &nbsp; / &nbsp; ${esc(p.name)}’s daily overview`,
      button("Check a dose", "start-check", "primary", "camera"),
    ) +
    (state.demo
      ? `<div class="intro"><span><strong>You’re exploring a sample profile.</strong> ${p.id === "demo-vision" ? "Pill photos are real research images; this dose plan is an invented demonstration." : "All medications, appearances, and past records here are fictional examples."}</span><button class="text-btn" data-action="new-profile">Set up my own profile →</button></div>`
      : "") +
    `<section class="hero"><div><div class="eyebrow">YOUR NEXT STEP</div><h2>${!p.meds.length ? "Set up your daily routine." : done === slots.length ? "Today’s routine is logged." : `${next} checklist`}</h2><p>${!p.meds.length ? "Start with your prescription label. Add the medicines and times in your existing care plan." : next ? `Your ${next.toLowerCase()} checklist is ready. Take a moment to compare your prepared pills with your saved plan.` : "You can review your history or help prepare your weekly organizer."}</p>${button(!p.meds.length ? "Add your first medication" : next ? "Start my check" : "Review my history", !p.meds.length ? "add-med" : next ? "start-check" : "go-family", "light", "arrow")}</div><div class="hero-plan"><span class="eyebrow">${next ? next.toUpperCase() : "YOUR PLAN"}</span>${(next
      ? dosesFor(p, next)
      : p.meds
    )
      .slice(0, 3)
      .map(
        (m) =>
          `<div class="hero-med">${pill(m)}<span>${esc(m.name)}<small>${esc(m.strength)} · ${m.quantity} pill${m.quantity > 1 ? "s" : ""}</small></span></div>`,
      )
      .join("")}</div></section>
 <div class="stats"><div class="stat"><div><div class="stat-label">Today’s doses</div><div class="stat-number">${done}<span class="muted" style="font-size:17px"> / ${slots.length}</span></div><div class="stat-note">${slots.length - done} scheduled periods left</div></div><div class="stat-icon">${icon("check")}</div></div><div class="stat"><div><div class="stat-label">7-day logging rate</div><div class="stat-number">${stats.expected ? stats.percent + "%" : "—"}</div><div class="stat-note">${state.demo ? "Illustrative sample records" : "Self-reported doses"}</div></div><div class="stat-icon">${icon("chart")}</div></div><div class="stat"><div><div class="stat-label">Your medications</div><div class="stat-number">${p.meds.length}</div><div class="stat-note">In your saved care plan</div></div><div class="stat-icon">${icon("pill")}</div></div></div>
 <div class="grid"><section class="panel"><div class="panel-head"><h2>Today’s schedule</h2><span class="small muted">${slots.length} scheduled periods</span></div><div class="schedule">${
   slots.length
     ? slots
         .map((s) => {
           const taken = isTaken(p, s);
           return `<div class="dose-row ${taken ? "done" : ""}"><div class="dose-time">${icon(taken ? "check" : s === "Morning" ? "sun" : "moon")}</div><div class="grow"><div class="dose-title">${s}</div><div class="dose-desc">${dosesFor(
             p,
             s,
           )
             .map((m) => `${esc(m.name)} ${esc(m.strength)}`)
             .join(
               " · ",
             )}</div></div>${taken ? '<span class="badge green">Logged taken</span>' : `<button class="text-btn" data-slot="${s}">Review →</button>`}</div>`;
         })
         .join("")
     : '<p class="small muted">Add a medication to see your daily routine here.</p>'
 }</div></section><section class="panel"><div class="panel-head"><h2>Care notes</h2>${icon("shield")}</div><div class="stack">${blindSpots(p.meds).length ? `<div class="note amber"><strong>Some pills look alike</strong>${blindSpots(p.meds).length} pair${blindSpots(p.meds).length > 1 ? "s" : ""} share a saved color and shape. Check their labels and imprints carefully.<br><button class="text-btn" data-page="meds">Review look-alike pills →</button></div>` : '<div class="note green"><strong>Your saved appearance notes</strong>Keep them up to date with your pharmacist. A pill’s appearance alone does not confirm its identity.</div>'}<div class="note"><strong>Make the week feel lighter</strong>Review each compartment in your weekly organizer.<br><button class="text-btn" data-page="organizer">Open organizer →</button></div></div></section></div>`
  );
}
function medications() {
  const p = patient(),
    matches = p.meds.filter((m) =>
      (m.name + " " + m.strength).toLowerCase().includes(search.toLowerCase()),
    ),
    pairs = blindSpots(p.meds);
  return (
    heading(
      "Medications.",
      "Your prescription plan, with the details that matter.",
      button("Add medication", "add-med", "primary", "plus"),
    ) +
    `<div class="toolbar"><input id="med-search" placeholder="Find a medication…" aria-label="Find a medication" value="${esc(search)}"></div>${pairs.length ? `<div class="note amber" style="margin-bottom:22px"><strong>Look-alike notice</strong>${pairs.map(([a, b]) => `${esc(a.name)} and ${esc(b.name)}`).join("; ")} share a saved color and shape. This comparison uses your notes, not a trained vision model. Use labels and imprints; ask a pharmacist if unsure.</div>` : ""}<div class="med-list">${matches.map((m) => `<article class="med-card"><div class="pill-wrap">${pill(m)}</div><div class="grow"><h3>${esc(m.name)}</h3><div class="med-description">${esc(m.strength)} · ${m.quantity} pill${m.quantity > 1 ? "s" : ""} per scheduled dose</div><div class="med-description">${esc(m.color)} · ${esc(m.shape)} · Imprint: ${esc(m.imprint || "Not recorded")}</div><div class="med-meta">${m.slots.map((s) => `<span class="badge gray">${s}</span>`).join("")}</div><div class="med-description">${m.rx ? `RxCUI ${esc(m.rx)}` : "Entered from label"}${state.demo ? " · Example appearance" : ""}</div><div class="toolbar" style="margin:13px 0 0"><button class="text-btn" data-edit="${esc(m.id)}">Edit details</button><button class="text-btn" data-refill="${esc(m.id)}">Review refill →</button></div></div></article>`).join("")}</div>${!matches.length ? `<div class="empty-state"><h2>${p.meds.length ? "No matching medications" : "Build your care plan"}</h2><p>${p.meds.length ? "Try another name." : "Use the exact medication name, dose, and schedule on your prescription."}</p>${button("Add medication", "add-med", "primary", "plus")}</div>` : ""}<div class="note section-gap"><strong>A note on appearances</strong>Pill illustrations are based on your saved notes. They are not reference photographs or proof of identity. Confirm any refill changes with your pharmacist.</div>`
  );
}
function scanResultCards() {
  if (!scan) return "";
  return `<div class="scan-summary"><strong>${scan.mode === "single" ? "Single-pill close-up" : scan.pills.length + " objects found"}</strong><span>${(scan.elapsedMs / 1000).toFixed(1)}s · On-device inference${scan.mode === "single" ? " · One pill assumed" : ""}</span></div>${scan.quality.length ? `<div class="note amber">${scan.quality.map(esc).join("<br>")}</div>` : ""}${scan.pills.map((p, i) => `<article class="scan-pill"><div class="scan-pill-top"><img src="${esc(p.thumbnail)}" alt="Detected object ${i + 1}"><div><h3>Pill ${i + 1}</h3><span class="badge ${p.accepted ? "green" : "amber"}">${p.accepted ? "Visual match" : "Not sure"}</span></div></div><div class="candidate-list">${p.candidates.map((c, j) => `<div class="candidate"><span class="reference-tile" style="${referenceStyle(c.catalogIndex)}" role="img" aria-label="NIH reference front and back"></span><div class="grow"><strong>${esc(c.label ? c.label.name + " " + c.label.strength : "NDC " + c.ndc)}</strong><div class="small muted">${j === 0 ? "Closest reference" : "Alternative"} · similarity ${c.score.toFixed(3)}</div><button class="text-btn" data-connect-pill="${esc(c.id)}">Use this bottle reference →</button></div></div>`).join("")}</div></article>`).join("")}`;
}
function checkPage() {
  const p = patient(),
    meds = dosesFor(p, selectedSlot);
  return (
    heading(
      "Check a dose.",
      "One photo. Automatic pill detection and visual reference matching.",
      button("Read aloud", "speak", "", "volume"),
    ) +
    `<div class="steps"><span class="step">1</span> Choose a time <span>→</span><span class="step">2</span> Photograph pills <span>→</span><span class="step">3</span> Review the result</div><div class="toolbar">${SLOTS.map((s) => `<button class="btn ${s === selectedSlot ? "primary" : ""}" data-slot="${s}">${s}${isTaken(p, s) ? " ✓" : ""}</button>`).join("")}</div>
 <div class="check-layout"><section class="panel"><div class="panel-head"><h2>Your prepared dose</h2><span class="badge green">Automatic recognition</span></div><div class="capture">${scan?.annotated ? `<img src="${esc(scan.annotated)}" alt="Photo with automatic pill detection boxes">` : photoUrl ? `<img src="${esc(photoUrl)}" alt="Photo to analyze">` : `<div>${icon("camera")}<h3>Give each pill a little space.</h3><p>Place pills apart on a plain, contrasting surface. Use clear light and keep imprints visible.</p><label class="btn primary" for="dose-photo">${icon("camera")} Take or choose a photo</label></div>`}</div>
 <input id="dose-photo" type="file" accept="image/*" capture="environment" aria-label="Choose dose photo"><div class="toolbar section-gap"><label class="field-group grow">Photo type<select id="scan-mode"><option value="dose" ${scanMode === "dose" ? "selected" : ""}>Several separated pills</option><option value="single" ${scanMode === "single" ? "selected" : ""}>One pill, close-up</option></select></label><button class="btn primary" data-action="scan-photo" ${!photo || scanBusy ? "disabled" : ""}>${scanBusy ? "Analyzing…" : "Analyze photo"}</button></div>
 <div class="scan-progress" role="status" aria-live="polite">${esc(scanProgress)}</div><div class="photo-note">A trained pill metric model searches 4,902 reference identities. Photos and inference stay in your browser. Research prototype; visual matches can be wrong. <button class="text-btn" data-action="show-model-details">See measured accuracy</button></div><div class="example-links"><span class="small muted">No photo handy? Opens a separate sample plan.</span><button class="text-btn" data-action="example-single">Try a real test image →</button><button class="text-btn" data-action="example-dose">Try a two-pill scene →</button></div></section>
 <section class="panel"><div class="panel-head"><h2>${selectedSlot} plan</h2><span class="small muted">${meds.length} medication${meds.length === 1 ? "" : "s"}</span></div>${meds.map((m) => `<div class="dose-row"><div class="pill-wrap">${pill(m)}</div><div class="grow"><h3>${esc(m.name)}</h3><div class="dose-desc">${esc(m.strength)} · expected ${m.quantity}<br>${m.ndc ? "NDC " + esc(m.ndc) : '<span style="color:var(--amber)">Bottle NDC needed for automatic comparison</span>'}</div></div><button class="text-btn" data-edit="${esc(m.id)}">Edit</button></div>`).join("") || '<div class="note">Add the medications and exact bottle NDCs in your prescription plan to compare the detected pills automatically.</div>'}
 ${scan ? `<div id="check-result">${result ? resultHtml() : ""}</div><div class="section-gap"><h2>What the camera found</h2><p class="small muted" style="margin-top:8px">Similarity is a model score, not a probability of correct identification.</p>${scanResultCards()}</div>` : `<div class="scan-empty"><span class="step">↗</span><p>Your photo results will appear here.<br>No pill counts or appearance checkboxes to fill in.</p></div>`}</section></div>
 <details class="panel section-gap"><summary>How the recognition works & measured limits</summary><div class="stack section-gap"><p class="small">A pretrained image encoder and a pill-specific trained metric head compare image features with 9,804 front/back references from the ePillID/NIH dataset. A background-based detector locates separated pills. The detector is not a trained instance-segmentation network and does not support hands, overlapping pills, or organizer grids.</p>${visionEvaluation ? `<p class="small">Image-held-out test: ${visionEvaluation.testImages} consumer images; top-1 retrieval ${(visionEvaluation.testTop1 * 100).toFixed(1)}%. ${visionEvaluation.testAccepted} passed the conservative similarity gate; ${visionEvaluation.testAcceptedCorrect} of those had the correct dataset identity. These benchmark measurements do not establish clinical safety.</p>` : ""}<p class="small muted">A weak score or close alternative returns “not sure.” The library is historical and does not cover every manufacturer or current product. There is no 99% accuracy guarantee or automated imprint OCR. Do not take an unfamiliar pill based on this result.</p><a class="small" href="https://github.com/usuyama/ePillID-benchmark" target="_blank" rel="noopener">Reference dataset and research source ↗</a></div></details>`
  );
}
function resultHtml() {
  return `<div class="result ${result.type}" role="status"><h3>${esc(result.title)}</h3><p>${esc(result.detail)}</p>${result.type === "matched" ? button("I took this dose · log it", "log-taken", "primary", "check") : result.type === "duplicate" ? "" : result.type === "setup" ? button("Set up pill references", "go-meds", "", "pill") : button("Save a concern in history", "log-concern", "", "plus")}</div>`;
}
async function analyzePhoto() {
  if (!photo || scanBusy) return;
  const version = ++scanVersion;
  scanBusy = true;
  scan = null;
  result = null;
  scanProgress = "Starting on-device recognition…";
  render();
  try {
    const output = await recognizePhoto(photo, {
      mode: scanMode,
      progress: (message) => {
        if (version !== scanVersion) return;
        scanProgress = message;
        if (page === "check" && $(".scan-progress"))
          $(".scan-progress").textContent = message;
      },
    });
    if (version !== scanVersion) return;
    scan = output;
    result = evaluateScan(patient(), selectedSlot, scan, {
      day: dayKey(),
      currentSlot: currentSlot(),
    });
    scanProgress = "Analysis complete. Review uncertain matches carefully.";
    render();
  } catch (e) {
    if (version !== scanVersion) return;
    scanProgress = e.message;
    result = {
      type: "uncertain",
      title: "The photo could not be analyzed",
      detail: e.message,
    };
    toast(e.message);
  } finally {
    if (version === scanVersion) {
      scanBusy = false;
      if (page === "check") render();
    }
  }
}
async function useExample(multiple) {
  const exampleVersion = ++scanVersion;
  scanBusy = false;
  scan = null;
  result = null;
  scanProgress = "Loading the recognition model and test image…";
  render();
  try {
    const file = multiple ? "/examples/dose-two.jpg" : "/examples/pill-1.jpg";
    const response = await fetch(file);
    if (!response.ok) throw Error("The example images are not available yet.");
    const blob = await response.blob();
    const samples = await (await fetch("/examples/manifest.json")).json();
    const catalog = await getCatalog();
    if (exampleVersion !== scanVersion) return;
    const demonstration = samples.slice(0, multiple ? 2 : 1);
    const demoId = "demo-vision";
    const demoMeds = demonstration.map((sample, i) => {
      const entry = catalog.catalog.find((c) => c.id === sample.id);
      return {
        id: "vision-pill-" + i,
        name: entry?.label?.name || "Reference pill " + (i + 1),
        strength: entry?.label?.strength || "See bottle",
        quantity: 1,
        slots: [currentSlot()],
        color: "White",
        shape: "Oval",
        imprint: "From research reference",
        manufacturer: entry?.label?.manufacturer || "Research sample",
        rx: null,
        ndc: entry?.ndc || sample.ndc,
        pillId: sample.id,
        startDate: dayKey(),
      };
    });
    const demonstrationProfile = {
      id: demoId,
      name: "Vision demo",
      meds: demoMeds,
      logs: [],
      refills: [],
      organizer: {},
    };
    state.patients = state.patients.filter((p) => p.id !== demoId);
    state.patients.push(demonstrationProfile);
    state.active = demoId;
    state.demo = true;
    selectedSlot = currentSlot();
    save();

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photo = blob;
    photoUrl = URL.createObjectURL(blob);
    scanMode = multiple ? "dose" : "single";
    scan = null;
    result = null;
    scanProgress = multiple
      ? "Synthetic scene made from real held-out pill photos."
      : "A real held-out pill image; selected as an illustrative example.";
    render();
    await analyzePhoto();
  } catch (e) {
    toast(e.message);
  }
}
function organizer() {
  const p = patient(),
    days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(orgWeek + "T12:00:00");
      d.setDate(d.getDate() + i);
      return {
        key: dayKey(d),
        label: d.toLocaleDateString("en", { weekday: "short", day: "numeric" }),
      };
    }),
    slots =
      orgRows === 1
        ? ["Morning"]
        : orgRows === 2
          ? ["Morning", "Evening"]
          : SLOTS;
  return (
    heading(
      "Weekly organizer.",
      "Open one compartment at a time and review it against your plan.",
      button("Read instructions", "speak", "", "volume"),
    ) +
    `<div class="panel"><div class="panel-head"><h2>Your weekly organizer</h2><span class="badge gray">Manual compartment review</span></div><div class="toolbar"><label class="field-group">Week beginning<input id="org-week" type="date" value="${orgWeek}"></label><label class="field-group">Organizer layout<select id="org-layout"><option value="1" ${orgRows === 1 ? "selected" : ""}>7 × 1 · Morning</option><option value="2" ${orgRows === 2 ? "selected" : ""}>7 × 2 · Morning / Evening</option><option value="4" ${orgRows === 4 ? "selected" : ""}>7 × 4 · All periods</option></select></label></div><div class="organizer"><div class="org-row"><span></span>${days.map((d) => `<div class="org-label">${esc(d.label)}</div>`).join("")}</div>${slots
      .map(
        (s) =>
          `<div class="org-row"><div class="org-label">${s}</div>${days
            .map((d) => {
              const key = `${d.key}|${s}`,
                status = p.organizer?.[key]?.status,
                meds = dosesFor(p, s, d.key);
              return `<button class="org-cell ${status || (!meds.length ? "empty" : "")}" data-cell="${key}" aria-label="${esc(d.label)} ${s}: ${status || "not reviewed"}"><span class="org-pills">${meds.map((m) => pill(m)).join("") || "—"}</span><span>${status === "checked" ? "Reviewed ✓" : status === "concern" ? "Needs review" : meds.length ? "Review" : "No schedule"}</span></button>`;
            })
            .join("")}</div>`,
      )
      .join(
        "",
      )}</div><div class="legend"><span>○ Not reviewed</span><span style="color:#527844">● Reviewed by you</span><span style="color:#a14b3d">● Needs review</span></div></div><div class="grid section-gap"><div class="panel"><h2>A reference photo, if helpful.</h2><p class="small muted" style="margin:10px 0">A photo can help you compare compartments. Open colored lids and check the pills directly if details are obscured.</p><input type="file" id="org-photo" accept="image/*" capture="environment" aria-label="Organizer reference photo">${viewOrgPhoto ? `<img src="${esc(viewOrgPhoto)}" alt="Organizer reference for manual review" style="width:100%;max-height:300px;object-fit:contain;border-radius:9px">` : ""}<div class="photo-note">Tab-only photo. Compartment marks record your review, not an AI result.</div></div><div class="panel"><h2>One compartment at a time.</h2><div class="stack section-gap"><p class="small muted">1. Select a day and scheduled period.<br>2. Compare the count, label, and saved appearance notes for each medication.<br>3. Mark it reviewed or flag a concern.</p><div class="note amber">Organizer marks are preparation records. They never mark a dose as taken.</div></div></div></div>`
  );
}
function family() {
  const p = patient(),
    stats = adherence(p),
    logs = [...p.logs].sort((a, b) => b.at.localeCompare(a.at));
  return (
    heading(
      "Care circle.",
      "A clear record to review with the people who help you.",
      button("Print weekly report", "report", "primary", "download"),
    ) +
    `<div class="note" style="margin-bottom:22px"><strong>A shared view on this device</strong>Switch between local profiles to help a family member. Remote syncing, live alerts, and caregiver accounts are not connected.</div><div class="grid"><section class="panel"><div class="panel-head"><h2>Your weekly record</h2><span class="badge green">${stats.expected ? stats.percent + "% logged" : "No schedule"}</span></div><div class="chart" role="img" aria-label="${stats.taken} of ${stats.expected} scheduled periods logged taken in the past seven days">${stats.daily.map((d) => `<div class="bar-group"><span>${d.taken}/${d.expected}</span><div class="bar-bg"><div class="bar-fill" style="height:${d.expected ? (d.taken / d.expected) * 100 : 0}%"></div></div><span>${d.label}</span></div>`).join("")}</div><p class="small muted">${stats.taken} of ${stats.expected} scheduled periods logged taken. Today includes periods through ${currentSlot().toLowerCase()}. Logs are self-reported, not proof of ingestion.</p></section><section class="panel"><div class="panel-head"><h2>Your care profiles</h2><button class="text-btn" data-action="new-profile">+ Add</button></div><div class="stack">${state.patients.map((x) => `<div class="dose-row"><div class="avatar">${esc(x.name.slice(0, 2).toUpperCase())}</div><div class="grow"><h3>${esc(x.name)}</h3><div class="dose-desc">${x.meds.length} medications · Local profile</div></div><button class="text-btn" data-patient="${esc(x.id)}">${x.id === p.id ? "Selected" : "View →"}</button></div>`).join("")}</div></section></div><section class="panel section-gap"><div class="panel-head"><h2>Dose history</h2><span class="small muted">${logs.length} records</span></div>${
      logs
        .slice(0, 50)
        .map(
          (l) =>
            `<div class="history-row"><div class="dose-time">${icon(l.status === "taken" ? "check" : "clock")}</div><div class="grow"><h3>${esc(l.slot)} <span class="badge ${l.status === "taken" ? "green" : "amber"}">${esc(l.status === "taken" ? "Logged taken" : l.status === "concern" ? "Concern" : "Skipped")}</span></h3><div class="dose-desc">${esc(new Date(l.at).toLocaleString())} · ${esc(l.note || "Manually logged")}</div></div><button class="text-btn" data-delete-log="${esc(l.id)}">Correct</button></div>`,
        )
        .join("") ||
      '<p class="small muted">No doses logged yet. Your first check will appear here.</p>'
    }</section>${
      p.refills.length
        ? `<section class="panel section-gap"><h2>Refill notes</h2>${[
            ...p.refills,
          ]
            .reverse()
            .map(
              (r) =>
                `<div class="history-row"><div class="grow"><h3>${esc(r.name)}</h3><div class="dose-desc">${esc(new Date(r.at).toLocaleDateString())} · ${esc(r.note)}</div></div></div>`,
            )
            .join("")}</section>`
        : ""
    }`
  );
}
function settings() {
  return (
    heading("Settings.", "Simple preferences, and control over your data.") +
    `<div class="panel"><h2>Accessibility</h2><div class="settings-row"><div><h3>Larger text</h3><p>Make common controls and descriptions easier to read.</p></div><label class="checks"><input id="large-text" type="checkbox" ${state.large ? "checked" : ""}> Enable</label></div><div class="settings-row"><div><h3>Read-aloud voice</h3><p>Uses your browser’s available voices. Voice processing depends on the browser.</p></div><select id="language" aria-label="Read-aloud language">${[
      ["en-US", "English"],
      ["es-US", "Español"],
      ["zh-CN", "中文"],
    ]
      .map(
        ([id, label]) =>
          `<option value="${id}" ${state.language === id ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="settings-row"><div><h3>Spoken guidance</h3><p>Listen to translated core check instructions. The visual interface is in English.</p></div>${button("Try voice", "speak", "", "volume")}</div></div><div class="panel section-gap"><h2>Your data, your choice</h2><div class="settings-row"><div><h3>Local backup</h3><p>Export all profiles and records as JSON. This file contains personal health information; keep it private.</p></div>${button("Export backup", "export", "", "download")}</div><div class="settings-row"><div><h3>Restore a backup</h3><p>Import a PillCheck JSON backup. You’ll review the replacement before it is saved.</p></div><label class="btn" for="import-file">Choose backup</label><input id="import-file" type="file" accept="application/json,.json" hidden></div><div class="settings-row"><div><h3>Start a personal profile</h3><p>Create an empty care plan. Sample records stay separate.</p></div>${button("New profile", "new-profile", "", "plus")}</div><div class="settings-row"><div><h3>Remove all local data</h3><p>Deletes this browser’s profiles and history, then opens a fresh sample profile.</p></div>${button("Reset this device", "reset", "danger")}</div></div><div class="panel section-gap"><h2>About this prototype</h2><div class="stack section-gap"><p class="small">Working today: prescription-plan entry, RxNorm name/NDC lookup, on-device automated pill detection and reference recognition, duplicate-period logging protection, look-alike notices, manual organizer review, local profiles, read-aloud guidance, and printable reports.</p><div class="note amber"><strong>Recognition boundaries</strong>A trained pill recognition model is included. Automated imprint OCR, bottle-label reading, barcode scanning, organizer segmentation, remote alerts, and clinical accuracy guarantees remain unimplemented. The model can abstain and is not clinically validated.</div><p class="small muted">Medication records are stored in this browser’s local storage without encryption. Photos stay in tab memory. A medication name or NDC is sent to NLM only when you use lookup. No analytics or remote caregiver database is used. Browser speech services may process text outside this device.</p><p class="small muted">This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.</p><a class="small" href="https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getDrugs.html" target="_blank" rel="noopener">RxNorm API documentation ↗</a></div></div>`
  );
}
function openDialog(html) {
  const d = $("#modal");
  d.innerHTML = html;
  d.showModal();
}
const dialogHead = (title) =>
  `<div class="dialog-head"><h2>${title}</h2><button class="close" data-close aria-label="Close dialog">×</button></div>`;
function medicationForm(id) {
  const old = patient().meds.find((m) => m.id === id);
  const m = old || {
    name: "",
    strength: "",
    quantity: 1,
    color: "White",
    shape: "Round",
    imprint: "",
    manufacturer: "",
    slots: ["Morning"],
    rx: null,
  };
  lookup = [];
  openDialog(
    dialogHead(old ? "Medication details" : "Add a medication") +
      `<div class="note" style="margin-bottom:20px">Copy your existing prescription instructions. PillCheck does not choose medications or doses.</div>${!old ? `<label class="field-group">Optional: find a name or NDC in RxNorm<div class="toolbar" style="margin:0"><input id="lookup-query" placeholder="e.g. metformin or bottle NDC"><button type="button" class="btn" id="lookup-btn">Look up</button></div></label><div id="lookup-status" class="small muted" role="status"></div><div id="lookup-results" class="lookup-results"></div><hr style="border:0;border-top:1px solid var(--line);margin:20px 0">` : ""}<form id="med-form"><div class="form-grid"><label class="field-group full">Medication name<input name="name" value="${esc(m.name)}" maxlength="160" required></label><label class="field-group">Strength on label<input name="strength" value="${esc(m.strength)}" placeholder="e.g. 10 mg" maxlength="100" required></label><label class="field-group">Pills per scheduled dose<input name="quantity" value="${m.quantity}" type="number" min="1" max="20" step="1" required></label><label class="field-group">Color<select name="color">${Object.keys(
        colors,
      )
        .map((c) => `<option ${m.color === c ? "selected" : ""}>${c}</option>`)
        .join(
          "",
        )}</select></label><label class="field-group">Shape<select name="shape">${["Round", "Oval", "Capsule"].map((c) => `<option ${m.shape === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field-group">Imprint (if visible)<input name="imprint" value="${esc(m.imprint)}" maxlength="60" placeholder="Letters / numbers"></label><label class="field-group">Manufacturer (optional)<input name="manufacturer" value="${esc(m.manufacturer)}" maxlength="100"></label><label class="field-group full">Exact NDC from bottle (for automatic matching)<input name="ndc" value="${esc(m.ndc || "")}" maxlength="20" placeholder="e.g. 00093-0148-01"><span class="small muted">Use the exact bottle NDC. Name and strength alone do not select a pill appearance.</span></label><div class="field-group full"><span>Scheduled periods from your care plan</span><div class="checks">${SLOTS.map((s) => `<label><input name="slots" value="${s}" type="checkbox" ${m.slots.includes(s) ? "checked" : ""}>${s}</label>`).join("")}</div></div></div><p class="error" id="form-error" role="alert"></p><div class="dialog-actions">${old ? `<button type="button" class="btn danger" id="delete-med">Delete</button>` : ""}<button class="btn primary" type="submit">Save medication</button></div></form>`,
  );
  let selectedRx = m.rx;
  const medForm = $("#med-form");
  medForm.elements.name.oninput = () => {
    selectedRx = null;
  };
  const lookupButton = $("#lookup-btn"),
    lookupStatus = $("#lookup-status"),
    lookupResults = $("#lookup-results"),
    lookupQuery = $("#lookup-query");
  if (!old)
    lookupButton.onclick = async () => {
      const q = lookupQuery.value.trim();
      lookupStatus.textContent = "Looking up the NLM database…";
      lookupResults.innerHTML = "";
      lookupButton.disabled = true;
      try {
        const r = await fetch("/api/drugs?q=" + encodeURIComponent(q));
        const data = await r.json();
        if (!r.ok) throw Error(data.error || "Lookup unavailable.");
        lookup = data.drugs;
        lookupStatus.textContent = lookup.length
          ? "Choose the exact product. Confirm strength on your label."
          : "No matches found. Check the spelling, or enter the label details below.";
        lookupResults.innerHTML = lookup
          .map(
            (d, i) =>
              `<button type="button" class="lookup-result" data-drug="${i}">${esc(d.name)}</button>`,
          )
          .join("");
        lookupResults.querySelectorAll("[data-drug]").forEach(
          (b) =>
            (b.onclick = () => {
              const d = lookup[Number(b.dataset.drug)];
              medForm.elements.name.value = d.name;
              selectedRx = d.rxcui;
              lookupStatus.textContent =
                "Name selected. Enter the strength, schedule, and appearance from your own label.";
              lookupResults.innerHTML = "";
            }),
        );
      } catch (e) {
        lookupStatus.textContent = e.message;
      } finally {
        lookupButton.disabled = false;
      }
    };
  $("#med-form").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target),
      slots = fd.getAll("slots");
    if (!slots.length) {
      $("#form-error").textContent = "Choose at least one scheduled period.";
      return;
    }
    const newMed = {
      id: old?.id || uid(),
      name: fd.get("name").trim(),
      strength: fd.get("strength").trim(),
      quantity: Number(fd.get("quantity")),
      color: fd.get("color"),
      shape: fd.get("shape"),
      imprint: fd.get("imprint").trim(),
      manufacturer: fd.get("manufacturer").trim(),
      slots,
      rx: selectedRx,
      startDate: old?.startDate || dayKey(),
      ndc: fd.get("ndc").trim(),
      pillId: old?.pillId || null,
    };
    if (newMed.ndc && !productNdc(newMed.ndc)) {
      $("#form-error").textContent =
        "Use the hyphenated NDC from the bottle, or an 11-digit NDC.";
      return;
    }
    if (!newMed.name || !newMed.strength) {
      $("#form-error").textContent = "Enter a medication name and strength.";
      return;
    }
    if (old)
      patient().meds = patient().meds.map((x) =>
        x.id === old.id ? newMed : x,
      );
    else patient().meds.push(newMed);
    save();
    resetCheck();
    $("#modal").close();
    render();
    toast("Medication saved to your care plan.");
  };
  if (old)
    $("#delete-med").onclick = () =>
      confirmDialog(
        "Remove this medication?",
        `Remove ${esc(old.name)} from the active plan? Past dose logs will remain.`,
        () => {
          patient().meds = patient().meds.filter((x) => x.id !== old.id);
          save();
          resetCheck();
          render();
        },
        "Remove medication",
      );
}
function confirmDialog(title, body, fn, label = "Confirm") {
  openDialog(
    dialogHead(title) +
      `<p class="small">${body}</p><div class="dialog-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="confirm-action">${label}</button></div>`,
  );
  $("#confirm-action").onclick = () => {
    $("#modal").close();
    fn();
  };
}
function newProfile() {
  openDialog(
    dialogHead("Who are we caring for?") +
      `<form id="profile-form"><label class="field-group">First name or nickname<input id="profile-name" required maxlength="50" placeholder="e.g. Alex" autocomplete="off"></label><p class="small muted" style="margin-top:15px">A new profile starts with an empty medication plan. All profiles stay on this browser.</p><div class="dialog-actions"><button class="btn primary">Create profile</button></div></form>`,
  );
  $("#profile-form").onsubmit = (e) => {
    e.preventDefault();
    const name = $("#profile-name").value.trim();
    if (!name) return;
    const p = {
      id: uid(),
      name,
      meds: [],
      logs: [],
      refills: [],
      organizer: {},
    };
    state.patients.push(p);
    state.active = p.id;
    state.demo = false;
    resetCheck();
    save();
    $("#modal").close();
    page = "meds";
    render();
    window.scrollTo(0, 0);
  };
}
function refill(id) {
  const m = patient().meds.find((x) => x.id === id);
  openDialog(
    dialogHead("A new refill, a closer look.") +
      `<p class="small muted">Compare the new bottle and pill with your saved details for ${esc(m.name)}. A change in appearance does not establish what medicine it is.</p><div class="note section-gap">Saved: ${esc(m.color)} ${esc(m.shape)} · Imprint ${esc(m.imprint || "not recorded")}<br>Manufacturer: ${esc(m.manufacturer || "not recorded")}</div><form id="refill-form" class="section-gap"><label class="field-group">What changed?<select name="change"><option value="appearance">Color, shape, or imprint looks different</option><option value="manufacturer">Manufacturer on the label changed</option><option value="none">No changes noticed</option></select></label><label class="field-group section-gap">Your note<textarea name="note" rows="3" maxlength="500" placeholder="What you noticed or what your pharmacist confirmed"></textarea></label><div id="refill-warning" class="note amber section-gap">Confirm an unfamiliar pill with your pharmacist. This app cannot verify a manufacturer substitution.</div><div class="dialog-actions"><button class="btn primary">Save refill note</button></div></form>`,
  );
  $("#refill-form").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    patient().refills.push({
      at: new Date().toISOString(),
      name: m.name,
      note:
        (fd.get("change") === "none"
          ? "No changes reported. "
          : fd.get("change") === "manufacturer"
            ? "Manufacturer change reported; pharmacist confirmation needed. "
            : "Appearance change reported; pharmacist confirmation needed. ") +
        fd.get("note").trim(),
    });
    save();
    $("#modal").close();
    render();
    toast("Refill note saved in Care circle.");
  };
}
function cellDialog(key) {
  const [day, slot] = key.split("|"),
    meds = dosesFor(patient(), slot, day);
  openDialog(
    dialogHead(`${esc(day)} · ${esc(slot)}`) +
      `<p class="small muted">Compare this compartment directly with your prescription plan.</p><div class="stack section-gap">${meds.map((m) => `<div class="dose-row"><div class="pill-wrap">${pill(m)}</div><div><h3>${esc(m.name)} ${esc(m.strength)}</h3><div class="dose-desc">${m.quantity} pill(s) · ${esc(m.color)} ${esc(m.shape)} · Imprint ${esc(m.imprint || "not recorded")}</div></div></div>`).join("") || '<div class="note">No medications are scheduled for this period.</div>'}</div><label class="field-group section-gap">Review note<textarea id="cell-note" maxlength="500" rows="2">${esc(patient().organizer?.[key]?.note || "")}</textarea></label><div class="dialog-actions"><button class="btn danger" id="cell-clear">Clear mark</button><button class="btn" id="cell-concern">Needs review</button><button class="btn primary" id="cell-checked">I reviewed it</button></div>`,
  );
  for (const status of ["concern", "checked", "clear"])
    $("#cell-" + status).onclick = () => {
      patient().organizer ??= {};
      if (status === "clear") delete patient().organizer[key];
      else
        patient().organizer[key] = {
          status,
          note: $("#cell-note").value,
          at: new Date().toISOString(),
        };
      save();
      $("#modal").close();
      render();
    };
}
function logDose(status) {
  const p = patient();
  if (status === "taken" && isTaken(p, selectedSlot)) {
    toast("This scheduled period is already logged.");
    return;
  }
  p.logs.push({
    id: uid(),
    day: dayKey(),
    slot: selectedSlot,
    status,
    at: new Date().toISOString(),
    note:
      status === "taken"
        ? "Self-reported after automatic visual comparison"
        : result?.title || "Concern reported",
    medications: dosesFor(p, selectedSlot).map((m) => ({
      name: m.name,
      strength: m.strength,
      quantity: m.quantity,
    })),
    observations: structuredClone(observations),
    recognition: scan
      ? {
          model: scan.model,
          pills: scan.pills.map((p) => ({
            id: p.candidates[0]?.id,
            score: p.candidates[0]?.score,
            margin: p.margin,
            accepted: p.accepted,
          })),
          elapsedMs: scan.elapsedMs,
        }
      : null,
  });
  save();
  resetCheck();
  page = "family";
  render();
  window.scrollTo(0, 0);
  toast(
    status === "taken"
      ? "Dose recorded. Take care."
      : "Concern saved. Ask a caregiver or pharmacist for help.",
  );
}
function speak() {
  if (!("speechSynthesis" in window)) {
    toast("Read-aloud is unavailable in this browser.");
    return;
  }
  const lang = state.language || "en-US",
    texts = {
      "en-US": `Hello ${patient().name}. Review the ${selectedSlot.toLowerCase()} dose against your prescription plan. Photograph the separated pills on a plain contrasting background and review the automatic results. If a result is uncertain, ask a caregiver or pharmacist for help. The experimental image model can suggest visual references, but can be wrong. Ask a pharmacist about unfamiliar pills.`,
      "es-US":
        "Fotografíe las pastillas separadas sobre un fondo liso y revise los resultados automáticos. Si el resultado es incierto, consulte a su farmacéutico. El modelo de reconocimiento es experimental y puede equivocarse.",
      "zh-CN":
        "请将药片分开放在纯色背景上拍照，并查看自动识别结果。如果结果不确定，请咨询药剂师。本应用的图像识别模型处于研究阶段，可能出错。",
    };
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texts[lang] || texts["en-US"]);
  u.lang = lang;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}
function report() {
  const p = patient(),
    stats = adherence(p),
    cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  const logs = p.logs
    .filter((l) => l.day >= dayKey(cutoff))
    .sort((a, b) => b.at.localeCompare(a.at));
  let el = $("#print-report");
  if (!el) {
    el = document.createElement("section");
    el.id = "print-report";
    el.className = "report-only";
    document.body.append(el);
  }
  el.innerHTML = `<h1>PillCheck · Weekly care record</h1><p>${esc(p.name)} · Generated ${esc(new Date().toLocaleString())}${p.id.startsWith("demo") ? " · FICTIONAL SAMPLE PROFILE" : ""}</p><p>${stats.taken} of ${stats.expected} scheduled periods self-reported taken (${stats.percent}%). Today counts periods through ${currentSlot()}.</p><h2>Current medication plan</h2><table><thead><tr><th>Medication</th><th>Strength</th><th>Quantity</th><th>Periods</th></tr></thead><tbody>${p.meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.strength)}</td><td>${m.quantity}</td><td>${m.slots.join(", ")}</td></tr>`).join("")}</tbody></table><h2>Past seven days</h2><table><thead><tr><th>Date</th><th>Period</th><th>Reported status</th><th>Note</th></tr></thead><tbody>${logs.map((l) => `<tr><td>${esc(l.day)}</td><td>${esc(l.slot)}</td><td>${esc(l.status)}</td><td>${esc(l.note)}</td></tr>`).join("")}</tbody></table><h2>Refill notes</h2>${
    p.refills
      .filter((r) => r.at.slice(0, 10) >= dayKey(cutoff))
      .map((r) => `<p>${esc(r.name)}: ${esc(r.note)}</p>`)
      .join("") || "<p>No refill notes this week.</p>"
  }<p>This is a self-reported record, not proof of ingestion or pill identity. PillCheck is a double-check aid and does not replace a pharmacist. Automatic visual recognition is experimental and can be wrong. No clinical accuracy guarantee is active.</p>`;
  window.print();
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pillcheck-backup-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup downloaded. Keep it somewhere private.");
}
function bind() {
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        if (page === "check") resetCheck();
        if (b.dataset.page === "check") selectedSlot = currentSlot();
        if (page === "organizer" && viewOrgPhoto) {
          URL.revokeObjectURL(viewOrgPhoto);
          viewOrgPhoto = null;
        }
        nav(b.dataset.page);
      }),
  );
  document.querySelectorAll("[data-slot]").forEach(
    (b) =>
      (b.onclick = () => {
        if (page !== "check") resetCheck();
        selectedSlot = b.dataset.slot;
        observations = {};
        result = scan
          ? evaluateScan(patient(), selectedSlot, scan, {
              day: dayKey(),
              currentSlot: currentSlot(),
            })
          : null;
        page = "check";
        render();
      }),
  );
  document
    .querySelectorAll("[data-edit]")
    .forEach((b) => (b.onclick = () => medicationForm(b.dataset.edit)));
  document
    .querySelectorAll("[data-refill]")
    .forEach((b) => (b.onclick = () => refill(b.dataset.refill)));
  document
    .querySelectorAll("[data-cell]")
    .forEach((b) => (b.onclick = () => cellDialog(b.dataset.cell)));
  document.querySelectorAll("[data-patient]").forEach(
    (b) =>
      (b.onclick = () => {
        state.active = b.dataset.patient;
        state.demo = patient().id.startsWith("demo");
        save();
        resetCheck();
        render();
      }),
  );
  document.querySelectorAll("[data-delete-log]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmDialog(
          "Correct this record?",
          "Remove this log if it was recorded by mistake. This changes your weekly logging rate.",
          () => {
            patient().logs = patient().logs.filter(
              (l) => l.id !== b.dataset.deleteLog,
            );
            save();
            render();
          },
          "Remove record",
        )),
  );
  document
    .querySelectorAll("[data-count],[data-appearance],[data-unsure]")
    .forEach(
      (i) =>
        (i.onchange = () => {
          const id =
            i.dataset.count || i.dataset.appearance || i.dataset.unsure;
          observations[id] ??= {};
          if (i.dataset.count)
            observations[id].count = i.value === "" ? null : Number(i.value);
          else if (i.dataset.appearance)
            observations[id].appearance = i.checked;
          else observations[id].unsure = i.checked;
          result = null;
          $("#check-result").innerHTML = "";
        }),
    );
  const actions = {
    "start-check": () => {
      resetCheck();
      selectedSlot =
        SLOTS.find(
          (s) => dosesFor(patient(), s).length && !isTaken(patient(), s),
        ) || currentSlot();
      nav("check");
    },
    "go-family": () => nav("family"),
    "add-med": () => medicationForm(),
    "new-profile": newProfile,
    speak,
    report,
    export: exportData,
    "scan-photo": analyzePhoto,
    "show-model-details": () => {
      const details = document.querySelector("details");
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    "example-single": () => useExample(false),
    "example-dose": () => useExample(true),
    "go-meds": () => nav("meds"),
    "log-taken": () => {
      const fresh = evaluateScan(patient(), selectedSlot, scan, {
        day: dayKey(),
        currentSlot: currentSlot(),
      });
      if (fresh.type !== "matched") {
        result = fresh;
        render();
        return;
      }
      logDose("taken");
    },
    "log-concern": () => logDose("concern"),
    reset: () =>
      confirmDialog(
        "Reset this device?",
        "This removes all profiles and records from this browser. Export a backup first if you need them.",
        () => {
          state = demoState();
          save();
          resetCheck();
          page = "today";
          render();
          window.scrollTo(0, 0);
          toast("Local data reset. Sample profile opened.");
        },
        "Reset local data",
      ),
  };
  document
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => actions[b.dataset.action]?.()));
  if ($("#scan-mode"))
    $("#scan-mode").onchange = (e) => {
      scanMode = e.target.value;
      scanVersion++;
      scanBusy = false;
      scan = null;
      result = null;
      render();
    };
  document
    .querySelectorAll("[data-connect-pill]")
    .forEach((b) => (b.onclick = () => connectPill(b.dataset.connectPill)));
  if ($("#med-search"))
    $("#med-search").oninput = (e) => {
      const pos = e.target.selectionStart;
      search = e.target.value;
      render();
      $("#med-search").focus();
      $("#med-search").setSelectionRange(pos, pos);
    };
  if ($("#dose-photo"))
    $("#dose-photo").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!f.type.startsWith("image/")) return toast("Choose an image file.");
      if (f.size > 15 * 1024 * 1024)
        return toast("Please choose a photo under 15 MB.");
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      scanVersion++;
      scan = null;
      result = null;
      scanBusy = false;
      photo = f;
      photoUrl = URL.createObjectURL(f);
      render();
      analyzePhoto();
    };
  if ($("#org-photo"))
    $("#org-photo").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!f.type.startsWith("image/") || f.size > 15 * 1024 * 1024)
        return toast("Choose an image under 15 MB.");
      if (viewOrgPhoto) URL.revokeObjectURL(viewOrgPhoto);
      viewOrgPhoto = URL.createObjectURL(f);
      render();
    };
  if ($("#org-layout"))
    $("#org-layout").onchange = (e) => {
      orgRows = Number(e.target.value);
      render();
    };
  if ($("#org-week"))
    $("#org-week").onchange = (e) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
        orgWeek = e.target.value;
        render();
      }
    };
  if ($("#large-text"))
    $("#large-text").onchange = (e) => {
      state.large = e.target.checked;
      save();
      render();
    };
  if ($("#language"))
    $("#language").onchange = (e) => {
      state.language = e.target.value;
      save();
    };
  if ($("#import-file"))
    $("#import-file").onchange = async (e) => {
      try {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024)
          throw Error("Backup must be smaller than 5 MB.");
        const imported = JSON.parse(await f.text());
        if (!validateState(imported))
          throw Error("This is not a valid PillCheck backup.");
        confirmDialog(
          "Restore this backup?",
          `Replace all current local profiles with ${imported.patients.length} profile(s) from the backup?`,
          () => {
            state = imported;
            state.active = state.patients.some((p) => p.id === state.active)
              ? state.active
              : state.patients[0].id;
            state.demo = patient().id.startsWith("demo");
            save();
            resetCheck();
            render();
            toast("Backup restored.");
          },
          "Replace local data",
        );
      } catch (err) {
        toast(err.message);
      }
    };
}
$("#modal").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) $("#modal").close();
});
window.addEventListener("storage", (e) => {
  if (e.key === "pillcheck-v1") {
    try {
      const incoming = JSON.parse(e.newValue);
      if (validateState(incoming)) {
        state = incoming;
        resetCheck();
        render();
        toast("Updated from another tab.");
      }
    } catch {}
  }
});
render();

async function connectPill(id) {
  const catalog = await getCatalog();
  const entry = catalog.catalog.find((c) => c.id === id);
  if (!entry) return;
  const matches = patient().meds.filter(
    (m) => productNdc(m.ndc) === productNdc(entry.ndc),
  );
  openDialog(
    dialogHead("Connect this pill reference") +
      `<div class="reference-tile" style="${referenceStyle(catalog.catalog.indexOf(entry))}"></div><p class="small section-gap"><strong>NDC ${esc(entry.ndc)}</strong><br>Only connect this reference if its NDC matches the bottle label. A model suggestion is not confirmation of identity.</p><label class="field-group section-gap">Medication in your plan<select id="connect-med">${patient()
        .meds.map(
          (m) =>
            `<option value="${esc(m.id)}" ${matches.some((x) => x.id === m.id) ? "selected" : ""}>${esc(m.name)} ${esc(m.strength)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="checks section-gap"><input type="checkbox" id="connect-confirm"> I checked this NDC against the bottle</label><p class="error" id="connect-error"></p><div class="dialog-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="connect-save">Connect reference</button></div>`,
  );
  $("#connect-save").onclick = () => {
    if (!$("#connect-confirm").checked) {
      $("#connect-error").textContent =
        "Check the exact NDC on the bottle before connecting.";
      return;
    }
    const med = patient().meds.find((m) => m.id === $("#connect-med").value);
    if (!med) {
      $("#connect-error").textContent = "Add a medication to your plan first.";
      return;
    }
    med.ndc = entry.ndc;
    med.pillId = entry.id;
    save();
    $("#modal").close();
    if (scan)
      result = evaluateScan(patient(), selectedSlot, scan, {
        day: dayKey(),
        currentSlot: currentSlot(),
      });
    render();
    toast("Bottle reference connected.");
  };
}
