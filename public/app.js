import { detectPills, productNdc } from "./recognition-core.js";
import { lucide } from "./icons.js";
import {
  SLOTS,
  dayKey,
  dosesFor,
  isTaken,
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
// Lucide icons (ISC) and Fluent Emoji 3D illustrations (MIT), bundled locally.
const ICON_ALIAS = {
  home: "house",
  chart: "chart-no-axes-column",
  shield: "shield-check",
  arrow: "chevron-right",
  alert: "triangle-alert",
  volume: "volume-2",
  calendar: "calendar-days",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lucide[ICON_ALIAS[n] || n] || lucide.pill}</svg>`;
const art = (name, size = 40) =>
  `<img class="art" src="/img/${name}.webp" width="${size}" height="${size}" alt="" decoding="async">`;
const colors = {
  White: "#f3f0e8",
  Pink: "#f2a7b8",
  Yellow: "#f4d35e",
  Blue: "#7fb0ec",
  Orange: "#f6a35b",
  Green: "#7fcb8e",
  Brown: "#b98a67",
  Red: "#e66b5f",
  Purple: "#b39ce3",
};
function pillSvg(shape, c) {
  const line = "rgb(0 0 0 / 0.22)";
  if (shape === "Capsule")
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><g transform="rotate(-40 16 16)"><rect x="4" y="10" width="24" height="12" rx="6" fill="#fff"/><path d="M16 10h-6a6 6 0 0 0 0 12h6z" fill="${c}"/><rect x="4" y="10" width="24" height="12" rx="6" fill="none" stroke="${line}"/><rect x="7.5" y="12.5" width="6" height="2" rx="1" fill="#fff" opacity=".55"/></g></svg>`;
  if (shape === "Oval")
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><g transform="rotate(-30 16 16)"><ellipse cx="16" cy="16" rx="12.5" ry="8" fill="${c}" stroke="${line}"/><path d="M7 16h18" stroke="${line}"/><ellipse cx="11" cy="12.6" rx="3" ry="1.3" fill="#fff" opacity=".5"/></g></svg>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10.5" fill="${c}" stroke="${line}"/><path d="M8.5 16h15" stroke="${line}"/><circle cx="12" cy="11.8" r="2.2" fill="#fff" opacity=".5"/></svg>`;
}
const pill = (m, cls = "") => {
  const c = colors[m.color] || colors.White;
  return `<span class="pill-ico ${cls}" style="background:${m.color === "White" || !colors[m.color] ? "var(--fill)" : c + "40"}" role="img" aria-label="${esc(m.color)} ${esc(m.shape.toLowerCase())} pill">${pillSvg(m.shape, c)}</span>`;
};
// randomUUID needs a secure context; a phone on the LAN uses plain http.
const uid = () =>
  crypto.randomUUID?.() ??
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
function emptyState() {
  return {
    version: 1,
    onboarded: false,
    active: null,
    large: false,
    language: "en-US",
    patients: [],
  };
}
function removeSampleProfiles(s) {
  if (!Array.isArray(s?.patients)) return s;
  s.patients = s.patients.filter(
    (p) => !["demo", "demo-vision"].includes(p?.id),
  );
  delete s.demo;
  if (!s.patients.some((p) => p.id === s.active))
    s.active = s.patients[0]?.id || null;
  if (!s.patients.length) s.onboarded = false;
  return s;
}
let state;
try {
  const saved = JSON.parse(localStorage.getItem("pillcheck-v1"));
  state = validateState(saved) ? removeSampleProfiles(saved) : emptyState();
} catch {
  state = emptyState();
}
let page = state.patients.length && state.onboarded ? "today" : "welcome",
  lastPage = null,
  viewDay = dayKey(),
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
  scanVersion = 0;
let cameraStream = null,
  cameraRequest = 0,
  cameraFrameToken = 0,
  cameraFrameId = 0,
  cameraError = "";
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
function stopCamera() {
  cameraRequest++;
  cameraFrameToken++;
  if (cameraFrameId) cancelAnimationFrame(cameraFrameId);
  cameraFrameId = 0;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}
function resetCheck() {
  stopCamera();
  cameraError = "";
  scanVersion++;
  scan = null;
  scanBusy = false;
  scanProgress = "";
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
  if (page === "check" && next !== "check") stopCamera();
  page = next;
  result = null;
  if (next === "today") viewDay = dayKey();
  render();
  window.scrollTo(0, 0);
  $("#main")?.focus({ preventScroll: true });
}
const button = (label, action, kind = "", ico = "") =>
  `<button class="btn ${kind}" data-action="${action}">${ico ? icon(ico) : ""}${label}</button>`;
// Official product names can be very long; show a readable prefix and keep the full name as a tooltip.
const short = (s, n = 38) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const initials = (name) => esc(name.slice(0, 2).toUpperCase());
const avatarBtn = () =>
  `<button class="avatar" data-action="profiles" aria-label="Switch person (now ${esc(patient().name)})" title="Switch person">${initials(patient().name)}</button>`;
const topbar = (title, { sub = "", actions = "", back = "" } = {}) =>
  `${back ? `<button class="back" data-page="${back}">${icon("chevron-left")}${back === "settings" ? "Settings" : back === "meds" ? "Medications" : "Back"}</button>` : ""}<header class="topbar"><div>${sub ? `<div class="sub">${sub}</div>` : ""}<h1>${title}</h1></div><div class="top-actions">${actions}</div></header>`;
const SLOT_ART = { Morning: "sunrise", Afternoon: "sun", Evening: "sunset", Bedtime: "night" };
const SLOT_TIME = {
  Morning: "Before noon",
  Afternoon: "Noon – 5 PM",
  Evening: "5 – 9 PM",
  Bedtime: "After 9 PM",
};
function ring(frac, size = 38, stroke = 4, color = "var(--green)") {
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r,
    off = c * (1 - Math.max(0, Math.min(1, frac)));
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
function dayStats(p, key) {
  const slots = SLOTS.filter((s) => dosesFor(p, s, key).length);
  return { slots, taken: slots.filter((s) => isTaken(p, s, key)).length };
}
function streakDays(p) {
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 366; i++) {
    const { slots, taken } = dayStats(p, dayKey(d));
    if (slots.length && taken === slots.length) n++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
const NAV = [
  ["today", "house", "Today"],
  ["meds", "pill", "Medications"],
  ["check", "scan-line", "Scan"],
  ["family", "chart-no-axes-column", "History"],
  ["settings", "settings", "Settings"],
];
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "light" || state.theme === "dark")
    root.dataset.theme = state.theme;
  else delete root.dataset.theme;
  root.classList.toggle("large-text", !!state.large);
}
function isDark() {
  return (
    state.theme === "dark" ||
    (state.theme !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}
function render() {
  applyTheme();
  const entering = page !== lastPage;
  lastPage = page;
  if (page === "welcome") {
    $("#app").innerHTML = welcome();
    bind();
    return;
  }
  const p = patient(),
    body = (
      { today, meds: medications, check: checkPage, organizer, family, settings, about }[page] || today
    )(),
    current = page === "organizer" ? "meds" : page === "about" ? "settings" : page;
  $("#app").innerHTML =
    `<a class="skip-link" href="#main">Skip to content</a><div class="shell">
<nav class="sidebar" aria-label="Main navigation"><div class="brand"><img src="/icon.svg" alt="">PillCheck</div>
<button class="btn primary side-scan" data-page="check">${icon("scan-line")}Scan a dose</button>
${NAV.filter(([id]) => id !== "check")
  .map(([id, ic, label]) => {
    // The organizer has its own sidebar link; on phones it lives under Medications.
    const on = page === "organizer" ? false : current === id;
    return `<button class="side-link ${on ? "active" : ""}" data-page="${id}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}${label}</button>`;
  })
  .join("")}
<button class="side-link ${page === "organizer" ? "active" : ""}" data-page="organizer">${icon("grid-3x3")}Pill organizer</button>
<div class="side-foot"><button class="profile-chip" data-action="profiles"><span class="avatar sm">${initials(p.name)}</span><span class="grow"><b>${esc(p.name)}</b><small>${p.meds.length} medication${p.meds.length === 1 ? "" : "s"} · Switch</small></span></button></div></nav>
<div class="main"><main id="main" class="page" tabindex="-1" style="${entering ? "" : "animation:none"}">${storageError ? `<div class="notice orange" style="margin-top:12px">${art("warning", 32)}<div><b>Changes aren’t being saved</b><p>Export a backup in Settings.</p></div></div>` : ""}${body}
<p class="footer">PillCheck double-checks doses; it is not medical advice. Always follow your prescription and ask a pharmacist when unsure.</p></main></div></div>
<nav class="tabbar" aria-label="Main navigation">${NAV.map(([id, ic, label]) => `<button class="${current === id ? "active" : ""} ${id === "check" ? "scan-tab" : ""}" data-page="${id}" ${current === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></button>`).join("")}</nav>`;
  bind();
  if (cameraStream && page === "check") connectCameraPreview();
}
function welcome() {
  return `<main class="welcome" id="main"><div class="welcome-inner">
<div class="welcome-hero"><img src="/icon.svg" alt=""><h1>${state.onboarded ? "How PillCheck works" : "Welcome to PillCheck"}</h1><p>A second pair of eyes for every dose.</p></div>
<div class="card" style="display:grid;gap:22px;padding:22px">
<div class="feature">${art("camera", 46)}<div><b>Check a dose with the live camera</b><p>See object outlines update in the camera preview, then capture a frame for a suggestion from our detection model.</p></div></div>
<div class="feature">${art("question", 46)}<div><b>Says “not sure” instead of guessing</b><p>Look-alike or unclear pills are flagged, so you know to check the bottle or ask a pharmacist.</p></div></div>
<div class="feature">${art("heart", 46)}<div><b>Made for caregivers</b><p>Track doses for everyone you help, with large text and read-aloud.</p></div></div>
<div class="feature">${art("lock", 46)}<div><b>Know where photos go</b><p>When you analyze a photo, it is sent to an external service for processing with our detection model. PillCheck does not save the photo.</p></div></div>
</div>
<div class="welcome-actions">${state.onboarded ? button("Back to the app", "back-to-app", "primary block") : button("Get started", "new-profile", "primary block")}</div>
<p class="fine">Research prototype for the Congressional App Challenge. Not a medical device.</p>
</div></main>`;
}
function today() {
  const p = patient(),
    now = dayKey(),
    isToday = viewDay === now,
    week = Array.from({ length: 7 }, (_, i) => {
      const d = weekStart();
      d.setDate(d.getDate() + i);
      return d;
    }),
    { slots, taken } = dayStats(p, viewDay),
    next = isToday ? slots.find((s) => !isTaken(p, s)) : null,
    streak = streakDays(p),
    pairs = blindSpots(p.meds),
    viewDate = new Date(viewDay + "T12:00:00");
  const weekStrip = `<div class="card week" role="group" aria-label="This week">${week
    .map((d) => {
      const key = dayKey(d),
        st = dayStats(p, key),
        future = key > now;
      return `<button class="day ${key === viewDay ? "selected" : ""} ${key === now ? "today" : ""} ${future ? "future" : ""}" data-day="${key}" ${future ? "disabled" : ""} aria-label="${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}: ${st.taken} of ${st.slots.length} doses"><span>${d.toLocaleDateString("en-US", { weekday: "narrow" })}</span><span class="ring-wrap">${ring(st.slots.length ? st.taken / st.slots.length : 0)}<span class="ring-label num">${d.getDate()}</span></span></button>`;
    })
    .join("")}</div>`;
  const summary = !p.meds.length
    ? `<div class="card" style="text-align:center;display:grid;justify-items:center;gap:10px;padding:28px 20px">${art("pill", 76)}<h2 style="font-size:1.3rem">Add your first medication</h2><p class="muted">Copy the name, strength and times from the prescription label. It takes about a minute.</p>${button("Add medication", "add-med", "primary block", "plus")}</div>`
    : `<div class="card summary"><span class="ring-wrap">${ring(slots.length ? taken / slots.length : 0, 92, 10)}<span class="ring-label">${taken}/${slots.length}</span></span><div class="grow"><h2>${!slots.length ? "Nothing scheduled" : taken === slots.length ? "All doses taken" : isToday ? `Next: ${next.toLowerCase()} dose` : `${slots.length - taken} not logged`}</h2><p>${taken === slots.length && slots.length ? (isToday ? "Great job today." : "Every dose was logged.") : isToday ? "Take one photo before you take your pills." : "These doses were not logged that day."}</p>${streak ? `<span class="streak">${art("fire", 22)}${streak}-day streak</span>` : isToday && next ? `<button class="btn primary sm" data-slot="${next}">${icon("scan-line")}Scan now</button>` : ""}</div></div>`;
  const groups = slots
    .map((s) => {
      const done = isTaken(p, s, viewDay),
        log = p.logs.find((l) => l.day === viewDay && l.slot === s && l.status === "taken");
      return `<section class="section"><div class="dose-group-head"><h3>${art(SLOT_ART[s], 30)}${s} <span class="faint small" style="font-weight:600">${SLOT_TIME[s]}</span></h3>${!done && isToday && s !== next ? `<button class="link" data-slot="${s}">${icon("scan-line")}Scan</button>` : ""}</div><div class="list">${done ? `<div class="taken-banner">${icon("check")}Taken${log ? " at " + esc(new Date(log.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : ""}</div>` : ""}${dosesFor(p, s, viewDay)
        .map(
          (m) =>
            `<${!done && isToday ? `button data-slot="${s}"` : "div"} class="row">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)}</span><br><span class="row-sub">${esc(m.strength)} · ${m.quantity} ${m.shape === "Capsule" ? "capsule" : "tablet"}${m.quantity > 1 ? "s" : ""}</span></span><span class="check-circle ${done ? "done" : ""}">${icon("check")}</span></${!done && isToday ? "button" : "div"}>`,
        )
        .join("")}${!done && isToday && s === next ? `<div class="slot-cta">${button(`Scan ${s.toLowerCase()} dose`, "start-check", "primary block", "scan-line")}</div>` : ""}${!done && !isToday ? `<div class="row plain"><span class="tag orange">Not logged</span></div>` : ""}</div></section>`;
    })
    .join("");
  return (
    topbar(isToday ? "Today" : viewDate.toLocaleDateString("en-US", { weekday: "long" }), {
      sub: viewDate.toLocaleDateString("en-US", { weekday: isToday ? "long" : undefined, month: "long", day: "numeric" }),
      actions: `<button class="round-btn" data-action="add-med" aria-label="Add medication" title="Add medication">${icon("plus")}</button>${avatarBtn()}`,
    }) +
    weekStrip +
    `<div class="section" style="margin-top:14px">${summary}</div>` +
    groups +
    (pairs.length
      ? `<div class="section notice orange">${art("warning", 32)}<div><b>Some pills look alike</b><p>${pairs.map(([a, b]) => `${esc(a.name)} and ${esc(b.name)}`).join("; ")} have the same color and shape. Check labels and imprints carefully.</p></div></div>`
      : "") +
    `<div class="section grid-2"><button class="card row" data-page="organizer" style="min-height:0">${art("calendar", 40)}<span class="grow"><span class="row-title">Pill organizer</span><br><span class="row-sub">Check the week’s box</span></span>${icon("chevron-right")}</button><button class="card row" data-action="report" style="min-height:0">${art("chart", 40)}<span class="grow"><span class="row-title">Doctor report</span><br><span class="row-sub">Print this week</span></span>${icon("chevron-right")}</button></div>`
  );
}
function medications() {
  const p = patient(),
    matches = p.meds.filter((m) =>
      (m.name + " " + m.strength).toLowerCase().includes(search.toLowerCase()),
    ),
    pairs = blindSpots(p.meds);
  return (
    topbar("Medications", {
      sub: esc(p.name),
      actions: `<button class="round-btn" data-action="add-med" aria-label="Add medication" title="Add medication">${icon("plus")}</button>${avatarBtn()}`,
    }) +
    (p.meds.length > 3
      ? `<label class="search">${icon("search")}<span class="sr-only">Find a medication</span><input id="med-search" placeholder="Search" value="${esc(search)}"></label>`
      : "") +
    (pairs.length
      ? `<div class="section notice orange">${art("warning", 32)}<div><b>Look-alike pills</b><p>${pairs.map(([a, b]) => `${esc(a.name)} and ${esc(b.name)}`).join("; ")} share a color and shape.</p></div></div>`
      : "") +
    (p.meds.length
      ? `<div class="section"><div class="list">${matches
          .map(
            (m) =>
              `<button class="row" data-edit="${esc(m.id)}">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)} <span class="muted" style="font-weight:500">${esc(m.strength)}</span></span><br><span class="row-sub">${m.quantity} × ${m.slots.join(", ")}</span><br>${m.ndc ? `<span class="tag green">${icon("check")}NDC saved</span>` : `<span class="tag orange">Add bottle NDC</span>`}</span><span class="chev">${icon("chevron-right")}</span></button>`,
          )
          .join("") || '<div class="row plain"><span class="muted">No matches</span></div>'}</div><p class="caption">Tap a medication to edit it or report a refill that looks different. The NDC records the exact product from the bottle; AI photo suggestions do not verify it.</p></div>`
      : `<div class="section card" style="text-align:center;display:grid;justify-items:center;gap:10px;padding:30px 20px">${art("pill", 76)}<h2 style="font-size:1.3rem">No medications yet</h2><p class="muted">Copy the exact name, strength and schedule from each prescription label.</p>${button("Add medication", "add-med", "primary block", "plus")}</div>`) +
    `<div class="section"><div class="section-head"><h2>Tools</h2></div><div class="list"><button class="row" data-page="organizer"><span class="ico-tile t-purple">${icon("grid-3x3")}</span><span class="grow row-title">Pill organizer</span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-page="about"><span class="ico-tile t-blue">${icon("circle-help")}</span><span class="grow row-title">How recognition works</span><span class="chev">${icon("chevron-right")}</span></button></div></div>`
  );
}
const RESULT_KIND = {
  matched: ["good", "check"],
  wrong: ["bad", "cross"],
  missing: ["bad", "cross"],
  uncertain: ["warn", "question"],
  setup: ["warn", "warning"],
  time: ["warn", "alarm"],
  duplicate: ["warn", "warning"],
};
function resultHtml() {
  if (scan?.model === "PillCheck detection model")
    return `<div class="result warn" role="status" id="check-result">${art("warning", 84)}<h2>Visual suggestion · verify the label</h2><p>Our detection model cannot confirm pill identity. Compare each pill with its pharmacy label and your plan. Ask a pharmacist if anything is unclear.</p><label class="checks section-gap"><input id="manual-dose-confirm" type="checkbox"> I checked each pill against the pharmacy label and today’s plan</label><div class="actions"><button class="btn success block" data-action="log-taken" id="manual-log" disabled>I took this verified dose</button>${button("Save a concern", "log-concern", "block", "triangle-alert")}${button("Retake photo", "retake", "block", "camera")}</div></div>`;
  const [kind, pic] = RESULT_KIND[result.type] || ["warn", "warning"];
  const primary =
    result.type === "matched"
      ? button("I took it · log dose", "log-taken", "success block", "check")
      : result.type === "duplicate"
        ? button("See history", "go-family", "primary block")
        : result.type === "setup"
          ? button("Add bottle NDCs", "go-meds", "primary block", "pill")
          : button("Save a concern", "log-concern", "primary block", "triangle-alert");
  return `<div class="result ${kind}" role="status" id="check-result">${art(pic, 84)}<h2>${esc(result.title)}</h2><p>${esc(result.detail)}</p><div class="actions">${primary}${button("Retake photo", "retake", "block", "camera")}</div></div>`;
}
function scanSteps() {
  const stage = /Waiting/.test(scanProgress) ? 2 : /Sending/.test(scanProgress) ? 1 : 0;
  return `<div class="card steps" role="status" aria-live="polite">${[
    "Preparing a resized photo",
    "Sending the photo to our detection service",
    "Analyzing with PillCheck’s detection model",
  ]
    .map(
      (s, i) =>
        `<div class="step ${i < stage ? "done" : i === stage ? "now" : ""}"><span class="dot">${i < stage ? icon("check") : ""}</span>${s}</div>`,
    )
    .join("")}<p class="caption" style="margin:4px 16px 12px">${esc(scanProgress || "Preparing the photo…")}</p></div>`;
}
function visualSuggestionResult() {
  return {
    type: "uncertain",
    title: "Visual suggestion · verify the label",
    detail:
      "Our detection model cannot confirm pill identity. Compare each pill with its pharmacy label and your plan. Ask a pharmacist if anything is unclear.",
  };
}
function checkPage() {
  const p = patient(),
    meds = dosesFor(p, selectedSlot),
    planned = `<div class="section"><div class="section-head"><h2>${art(SLOT_ART[selectedSlot], 26)}Planned for ${selectedSlot.toLowerCase()}</h2></div><div class="list">${meds.map((m) => `<button class="row" data-edit="${esc(m.id)}">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)} <span class="muted" style="font-weight:500">× ${m.quantity}</span></span><br><span class="row-sub">${esc(m.strength)}${m.ndc ? " · NDC " + esc(m.ndc) : ""}</span></span>${m.ndc ? "" : '<span class="tag orange">Add NDC</span>'}<span class="chev">${icon("chevron-right")}</span></button>`).join("") || `<div class="row plain"><span class="muted">Nothing is scheduled for ${selectedSlot.toLowerCase()}.</span></div>`}</div></div>`;
  const slotPicker = `<div class="segmented" role="group" aria-label="Which dose">${SLOTS.map((s) => `<button data-slot="${s}" aria-pressed="${s === selectedSlot}">${s}${isTaken(p, s) ? " ✓" : ""}</button>`).join("")}</div>`;
  let body;
  if (scan && result && !scanBusy)
    body = `<div class="viewfinder" style="aspect-ratio:auto;min-height:200px;margin-top:14px"><img src="${esc(photoUrl)}" alt="Photo submitted for visual analysis" style="position:static;max-height:300px"></div><div class="section">${resultHtml()}</div><div class="section card"><h2>Our detection model’s visual suggestion</h2><p class="ai-output">${esc(scan.analysis)}</p><p class="caption">This is an unverified AI suggestion, not a pill identification or medication recommendation.</p></div>${planned}`;
  else if (cameraStream)
    body = `<div class="viewfinder camera-live" style="margin-top:14px"><video id="camera-video" autoplay playsinline muted aria-label="Live camera preview"></video><canvas id="camera-overlay" aria-hidden="true"></canvas><span class="camera-status" id="camera-status" role="status" aria-live="polite">Starting camera…</span><span class="corners"></span></div><div class="section"><p class="caption">Live outlines mark separate objects only. Capturing sends this photo to an external service for our detection model to analyze. Avoid labels, faces, or documents; the model cannot confirm pill identity.</p><div class="shutter-row"><label class="side-action" for="dose-library"><span class="ico">${icon("image-up")}</span>Upload</label><button class="shutter" data-action="capture-live" aria-label="Capture frame and check pills">${icon("camera")}</button><button class="side-action" data-action="stop-camera"><span class="ico">${icon("x")}</span>Stop</button></div><button class="link camera-mode" data-mode="${scanMode === "dose" ? "single" : "dose"}">${scanMode === "dose" ? "Switch to one pill" : "Switch to several pills"}</button></div>${planned}`;
  else if (scanBusy || photoUrl)
    body = `<div class="viewfinder ${scanBusy ? "busy" : ""}" style="margin-top:14px">${photoUrl ? `<img src="${esc(photoUrl)}" alt="Photo being checked">` : ""}<span class="corners"></span></div><div class="section">${scanBusy ? scanSteps() : `<div class="notice">${art("warning", 32)}<div><b>${esc(scanProgress || "Ready")}</b></div></div>`}</div>`;
  else
    body = `<div class="viewfinder" id="dropzone" style="margin-top:14px"><span class="corners"></span><span class="hint">${icon("camera")}<b>${scanMode === "single" ? "Fill the frame with one pill" : "Spread the pills on a plain surface"}</b><span>Keep them apart with imprints up, in good light. Start the live camera or upload a photo.</span></span></div>
${cameraError ? `<div class="section notice orange">${art("warning", 32)}<div><b>${esc(cameraError)}</b><br><label class="link" for="dose-photo">Use the device camera instead</label></div></div>` : ""}
<div class="shutter-row"><label class="side-action" for="dose-library"><span class="ico">${icon("image-up")}</span>Upload</label><button class="shutter" data-action="start-camera" aria-label="Start live camera">${icon("camera")}</button><button class="side-action" data-mode="${scanMode === "dose" ? "single" : "dose"}" aria-label="Switch to ${scanMode === "dose" ? "one-pill close-up" : "several pills"}"><span class="ico">${icon(scanMode === "dose" ? "pill" : "grid-3x3")}</span>${scanMode === "dose" ? "Several pills" : "One pill"}</button></div>
<p class="caption">Analyzing a photo sends it to an external service for our detection model to process. Avoid including labels, faces, or personal documents.</p>
${planned}`;
  return (
    topbar("Scan a dose", {
      sub: esc(p.name),
      actions: `<button class="round-btn" data-action="speak" aria-label="Read instructions aloud" title="Read aloud">${icon("volume-2")}</button>${avatarBtn()}`,
    }) +
    slotPicker +
    `<input id="dose-photo" type="file" accept="image/*" capture="environment"><input id="dose-library" type="file" accept="image/*">` +
    body
  );
}
function cameraErrorText(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError")
    return "Camera access was blocked. Allow camera access in your browser settings, then try again.";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError")
    return "No camera was found. Upload a photo instead.";
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError")
    return "The camera is busy in another app. Close that app or upload a photo.";
  if (error?.name === "SecurityError")
    return "Live camera access requires HTTPS or localhost. Upload a photo instead.";
  return "The camera could not start. Check browser permissions or upload a photo.";
}
async function startCamera() {
  stopCamera();
  cameraError = "";
  scanVersion++;
  scanBusy = false;
  scan = null;
  result = null;
  scanProgress = "";
  photo = null;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError = "Live camera access is unavailable in this browser. Upload a photo instead.";
    render();
    return;
  }
  const request = ++cameraRequest;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    });
    if (request !== cameraRequest || page !== "check") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream = stream;
    render();
  } catch (error) {
    if (request !== cameraRequest) return;
    cameraError = cameraErrorText(error);
    toast(cameraError);
    render();
  }
}
function connectCameraPreview() {
  const stream = cameraStream,
    video = $("#camera-video"),
    overlay = $("#camera-overlay");
  if (!stream || !video || !overlay) return;
  if (cameraFrameId) cancelAnimationFrame(cameraFrameId);
  const token = ++cameraFrameToken,
    overlayContext = overlay.getContext("2d"),
    detectorCanvas = document.createElement("canvas"),
    detectorContext = detectorCanvas.getContext("2d", {
      willReadFrequently: true,
    });
  let lastDetection = -Infinity,
    components = [],
    quality = [];
  video.srcObject = stream;
  video.play().catch(() => {
    const status = $("#camera-status");
    if (status) status.textContent = "Tap the preview to start the camera.";
  });
  const draw = (now) => {
    if (
      token !== cameraFrameToken ||
      stream !== cameraStream ||
      !video.isConnected
    )
      return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (
        overlay.width !== video.videoWidth ||
        overlay.height !== video.videoHeight
      ) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
      if (now - lastDetection >= 400) {
        lastDetection = now;
        const width = Math.min(480, video.videoWidth),
          height = Math.max(
            1,
            Math.round((video.videoHeight * width) / video.videoWidth),
          );
        detectorCanvas.width = width;
        detectorCanvas.height = height;
        detectorContext.drawImage(video, 0, 0, width, height);
        try {
          const detected = detectPills(
            detectorContext.getImageData(0, 0, width, height),
          );
          components = detected.components;
          quality = detected.quality;
        } catch {
          components = [];
          quality = [];
        }
      }
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      overlayContext.lineWidth = Math.max(3, video.videoWidth / 420);
      overlayContext.strokeStyle = "#4df0a5";
      overlayContext.fillStyle = "rgba(11, 123, 76, .9)";
      overlayContext.font = `600 ${Math.max(18, video.videoWidth / 48)}px system-ui`;
      const scaleX = video.videoWidth / detectorCanvas.width,
        scaleY = video.videoHeight / detectorCanvas.height;
      components.forEach((box, i) => {
        const x = box.x * scaleX,
          y = box.y * scaleY,
          width = box.width * scaleX,
          height = box.height * scaleY;
        overlayContext.strokeRect(x, y, width, height);
        overlayContext.fillRect(x, Math.max(0, y - 30), 42, 28);
        overlayContext.fillStyle = "#fff";
        overlayContext.fillText(String(i + 1), x + 9, Math.max(21, y - 9));
        overlayContext.fillStyle = "rgba(11, 123, 76, .9)";
      });
      const status = $("#camera-status");
      if (status) {
        const label = components.length
          ? `${components.length} object${components.length === 1 ? "" : "s"} in view`
          : quality.length
            ? "Adjust the background or pill spacing"
            : "Looking for separate objects…";
        if (status.textContent !== label) status.textContent = label;
      }
    }
    cameraFrameId = requestAnimationFrame(draw);
  };
  cameraFrameId = requestAnimationFrame(draw);
}
async function captureLivePhoto() {
  const video = $("#camera-video");
  if (!cameraStream || !video?.videoWidth) {
    toast("The camera is still starting. Try again in a moment.");
    return;
  }
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) {
    toast("The camera frame could not be captured. Try again.");
    return;
  }
  stopCamera();
  cameraError = "";
  setPhoto(blob);
}
async function preparePhoto(file) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw Error("The photo could not be prepared. Try another image.");
    return blob;
  } finally {
    bitmap.close();
  }
}
async function analyzePhoto() {
  if (!photo || scanBusy) return;
  const version = ++scanVersion;
  const started = performance.now();
  scanBusy = true;
  scan = null;
  result = null;
  scanProgress = "Preparing photo…";
  render();
  try {
    const upload = await preparePhoto(photo);
    if (version !== scanVersion) return;
    scanProgress = "Sending photo to our detection service…";
    if (page === "check") render();
    const response = await fetch("/api/recognize", {
      method: "POST",
      headers: {
        "Content-Type": upload.type,
        "X-PillCheck-Mode": scanMode,
      },
      body: upload,
      signal: AbortSignal.timeout(100_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(payload.error || "Our detection service is unavailable. Try again.");
    if (version !== scanVersion) return;
    scan = {
      model: payload.model || "PillCheck detection model",
      analysis: payload.analysis,
      elapsedMs: performance.now() - started,
      pills: [],
    };
    result = visualSuggestionResult();
    scanProgress = "";
  } catch (e) {
    if (version !== scanVersion) return;
    scanProgress = e.message;
    toast(e.message);
  } finally {
    if (version === scanVersion) {
      scanBusy = false;
      if (page === "check") {
        render();
        $("#check-result")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
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
    topbar("Pill organizer", {
      back: "meds",
      sub: "Filling a weekly box?",
      actions: `<button class="round-btn" data-action="speak" aria-label="Read instructions aloud">${icon("volume-2")}</button>`,
    }) +
    `<div class="card grid-2"><label class="field-group">Week starting<input id="org-week" type="date" value="${orgWeek}"></label><label class="field-group">Box layout<select id="org-layout"><option value="1" ${orgRows === 1 ? "selected" : ""}>7 × 1 · Morning</option><option value="2" ${orgRows === 2 ? "selected" : ""}>7 × 2 · Morning / Evening</option><option value="4" ${orgRows === 4 ? "selected" : ""}>7 × 4 · All times</option></select></label></div>
<div class="section card org"><div class="org-grid"><span></span>${days.map((d) => `<div class="org-label">${esc(d.label)}</div>`).join("")}${slots
      .map(
        (s) =>
          `<div class="org-label">${art(SLOT_ART[s], 26)}<br>${s}</div>${days
            .map((d) => {
              const key = `${d.key}|${s}`,
                status = p.organizer?.[key]?.status,
                meds = dosesFor(p, s, d.key);
              return `<button class="org-cell ${status || (!meds.length ? "empty" : "")}" data-cell="${key}" aria-label="${esc(d.label)} ${s}: ${status || "not checked"}"><span class="pill-stack">${meds.map((m) => pill(m)).join("") || "—"}</span><span>${status === "checked" ? "✓ Checked" : status === "concern" ? "Needs review" : meds.length ? "Tap to check" : "Empty"}</span></button>`;
            })
            .join("")}`,
      )
      .join("")}</div></div>
<p class="caption">Tap a compartment, compare each pill with the plan, then mark it checked or flag a concern. These marks never log a dose as taken.</p>
<div class="section list"><label class="row" for="org-photo"><span class="ico-tile t-teal">${icon("camera")}</span><span class="grow"><span class="row-title">Add a reference photo</span><br><span class="row-sub">Stays in this tab only</span></span><span class="chev">${icon("chevron-right")}</span></label></div><input type="file" id="org-photo" accept="image/*" capture="environment">${viewOrgPhoto ? `<img src="${esc(viewOrgPhoto)}" alt="Organizer reference photo" style="width:100%;max-height:320px;object-fit:contain;border-radius:18px;margin-top:12px;background:#000">` : ""}`
  );
}
function family() {
  const p = patient(),
    stats = adherence(p),
    logs = [...p.logs].sort((a, b) => b.at.localeCompare(a.at)),
    streak = streakDays(p);
  return (
    topbar("History", { sub: esc(p.name), actions: avatarBtn() }) +
    `<div class="stats"><div class="card stat"><b>${stats.expected ? stats.percent + "%" : "—"}</b><span>This week</span></div><div class="card stat"><b>${streak}</b><span>Day streak</span></div><div class="card stat"><b>${p.logs.filter((l) => l.status === "taken").length}</b><span>Doses logged</span></div></div>
<div class="section"><div class="section-head"><h2>Last 7 days</h2></div><div class="card"><div class="bars" role="img" aria-label="${stats.taken} of ${stats.expected} scheduled doses logged in the past seven days">${stats.daily.map((d) => `<div class="bar"><div class="track"><div class="fill" style="height:${d.expected ? (d.taken / d.expected) * 100 : 0}%"></div></div><span>${d.label}</span></div>`).join("")}</div></div><p class="caption">${stats.taken} of ${stats.expected} scheduled doses logged. Logs are self-reported, not proof a pill was swallowed.</p></div>
<div class="section">${button("Print a report for the doctor", "report", "primary block", "printer")}</div>
<div class="section"><div class="section-head"><h2>Dose log</h2><span class="faint small">${logs.length} records</span></div><div class="list">${
      logs
        .slice(0, 50)
        .map(
          (l) =>
            `<div class="row"><span class="ico-tile ${l.status === "taken" ? "t-green" : "t-orange"}">${icon(l.status === "taken" ? "check" : "triangle-alert")}</span><span class="grow"><span class="row-title">${esc(l.slot)} · ${esc(l.status === "taken" ? "Taken" : l.status === "concern" ? "Concern" : "Skipped")}</span><br><span class="row-sub">${esc(new Date(l.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span></span><button class="link" data-delete-log="${esc(l.id)}">Undo</button></div>`,
        )
        .join("") ||
      `<div class="row plain"><span class="muted">No doses logged yet. Your first scan will appear here.</span></div>`
    }</div></div>${
      p.refills.length
        ? `<div class="section"><div class="section-head"><h2>Refill notes</h2></div><div class="list">${[...p.refills]
            .reverse()
            .map(
              (r) =>
                `<div class="row"><span class="ico-tile t-purple">${icon("refresh-cw")}</span><span class="grow"><span class="row-title">${esc(r.name)}</span><br><span class="row-sub">${esc(new Date(r.at).toLocaleDateString())} · ${esc(r.note)}</span></span></div>`,
            )
            .join("")}</div></div>`
        : ""
    }`
  );
}
function settings() {
  const p = patient();
  return (
    topbar("Settings") +
    `<div class="list"><button class="row" data-action="profiles"><span class="avatar">${initials(p.name)}</span><span class="grow"><span class="row-title">${esc(p.name)}</span><br><span class="row-sub">${state.patients.length} ${state.patients.length === 1 ? "person" : "people"} on this device · Switch</span></span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-action="new-profile"><span class="ico-tile t-green">${icon("user-plus")}</span><span class="grow row-title">Add a person</span><span class="chev">${icon("chevron-right")}</span></button></div>
<div class="section"><div class="section-head"><h2>Display</h2></div><div class="list"><label class="row"><span class="ico-tile t-blue">${icon("a-large-small")}</span><span class="grow row-title">Larger text</span><input id="large-text" class="switch" type="checkbox" ${state.large ? "checked" : ""}></label><div class="row"><span class="ico-tile t-purple">${icon("sun-moon")}</span><span class="grow row-title" style="white-space:nowrap">Appearance</span><div class="segmented" role="group" aria-label="Appearance" style="flex:0 1 190px">${[
      ["system", "Auto"],
      ["light", "Light"],
      ["dark", "Dark"],
    ]
      .map(([id, label]) => `<button data-theme-choice="${id}" aria-pressed="${(state.theme || "system") === id}">${label}</button>`)
      .join("")}</div></div></div></div>
<div class="section"><div class="section-head"><h2>Read aloud</h2></div><div class="list"><label class="row"><span class="ico-tile t-orange">${icon("languages")}</span><span class="grow row-title">Language</span><select id="language">${[
      ["en-US", "English"],
      ["es-US", "Español"],
      ["zh-CN", "中文"],
    ]
      .map(([id, label]) => `<option value="${id}" ${state.language === id ? "selected" : ""}>${label}</option>`)
      .join("")}</select></label><button class="row" data-action="speak"><span class="ico-tile t-teal">${icon("volume-2")}</span><span class="grow row-title">Play a voice preview</span><span class="chev">${icon("chevron-right")}</span></button></div></div>
<div class="section"><div class="section-head"><h2>Your data</h2></div><div class="list"><button class="row" data-action="export"><span class="ico-tile t-blue">${icon("download")}</span><span class="grow"><span class="row-title">Export a backup</span><br><span class="row-sub">Contains health information; keep it private</span></span><span class="chev">${icon("chevron-right")}</span></button><label class="row" for="import-file"><span class="ico-tile t-green">${icon("upload")}</span><span class="grow"><span class="row-title">Restore from a backup</span><br><span class="row-sub">You confirm before anything is replaced</span></span><span class="chev">${icon("chevron-right")}</span></label><button class="row" data-action="reset"><span class="ico-tile t-red">${icon("trash-2")}</span><span class="grow row-title" style="color:var(--red)">Erase all data on this device</span></button></div><input id="import-file" type="file" accept="application/json,.json"></div>
<div class="section"><div class="section-head"><h2>About</h2></div><div class="list"><button class="row" data-page="about"><span class="ico-tile t-blue">${icon("circle-help")}</span><span class="grow"><span class="row-title">How PillCheck works</span><br><span class="row-sub">Accuracy, limits and data sources</span></span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-page="welcome"><span class="ico-tile t-gray">${icon("sparkles")}</span><span class="grow row-title">Show the welcome screen</span><span class="chev">${icon("chevron-right")}</span></button></div><p class="caption">Care profiles and logs stay in this browser, unencrypted. When you analyze a photo, PillCheck sends a compressed copy to an external service for processing with our detection model. PillCheck does not store the photo. Avoid including labels, faces, or documents.</p><p class="caption">A medicine name or NDC is sent to the U.S. National Library of Medicine only when you use lookup. PillCheck does not run analytics or tracking.</p><p class="caption">This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.</p></div>`
  );
}
function about() {
  return (
    topbar("How it works", { back: "settings" }) +
    `<div class="card" style="display:grid;gap:18px"><div class="feature">${art("camera", 46)}<div><b>1 · Find separate objects</b><p>The live camera uses simple background segmentation to draw outlines. It can mistake other objects for pills or miss touching pills.</p></div></div><div class="feature">${art("search", 46)}<div><b>2 · Ask our detection model for a visual description</b><p>After you capture or select a photo, the server sends a compressed copy to an external service for processing. It may describe shape and color, read a visible imprint, or suggest possibilities.</p></div></div><div class="feature">${art("check", 46)}<div><b>3 · Check the pharmacy label</b><p>Our detection model does not verify pill identity against your plan. Treat every suggestion as uncertain and confirm each pill using its original label or a pharmacist.</p></div></div></div><div class="section notice orange">${art("warning", 32)}<div><b>Know the limits</b><p>Our detection model is not clinically validated for medication identification and can be wrong. Color and shape alone are not enough to identify a pill. Never take an unfamiliar pill because of an AI suggestion.</p></div></div><p class="caption">The previous on-device pill identity model remains in the project but is inactive. Icons: Lucide (ISC). Illustrations: Microsoft Fluent Emoji (MIT).</p>`
  );
}
function profilesSheet() {
  openDialog(
    dialogHead("Who are you checking for?") +
      `<div class="list">${state.patients.map((x) => `<button class="row" data-pick-profile="${esc(x.id)}"><span class="avatar sm">${initials(x.name)}</span><span class="grow"><span class="row-title">${esc(x.name)}</span><br><span class="row-sub">${x.meds.length} medication${x.meds.length === 1 ? "" : "s"}</span></span>${x.id === patient().id ? `<span style="color:var(--accent)">${icon("check")}</span>` : ""}</button>`).join("")}</div><div class="dialog-actions">${button("Add a person", "sheet-new-profile", "block", "user-plus")}</div>`,
  );
  document.querySelectorAll("#modal [data-pick-profile]").forEach(
    (b) =>
      (b.onclick = () => {
        state.active = b.dataset.pickProfile;
        save();
        resetCheck();
        viewDay = dayKey();
        $("#modal").close();
        render();
      }),
  );
  $("#modal [data-action=sheet-new-profile]").onclick = newProfile;
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
        )}</select></label><label class="field-group">Shape<select name="shape">${["Round", "Oval", "Capsule"].map((c) => `<option ${m.shape === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field-group">Imprint (if visible)<input name="imprint" value="${esc(m.imprint)}" maxlength="60" placeholder="Letters / numbers"></label><label class="field-group">Manufacturer (optional)<input name="manufacturer" value="${esc(m.manufacturer)}" maxlength="100"></label><label class="field-group full">Exact NDC from bottle (for automatic matching)<input name="ndc" value="${esc(m.ndc || "")}" maxlength="20" placeholder="e.g. 00093-0148-01"><span class="small muted">Use the exact bottle NDC. Name and strength alone do not select a pill appearance.</span></label><div class="field-group full"><span>Scheduled periods from your care plan</span><div class="checks">${SLOTS.map((s) => `<label><input name="slots" value="${s}" type="checkbox" ${m.slots.includes(s) ? "checked" : ""}>${s}</label>`).join("")}</div></div></div><p class="error" id="form-error" role="alert"></p><div class="dialog-actions">${old ? `<button type="button" class="btn danger" id="delete-med">Delete</button><button type="button" class="btn" id="refill-med">New refill?</button>` : ""}<button class="btn primary" type="submit">Save medication</button></div></form>`,
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
  if (old) $("#refill-med").onclick = () => refill(old.id);
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
    state.onboarded = true;
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
        ? "Self-reported after checking the pharmacy label and dose plan"
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
          elapsedMs: scan.elapsedMs,
          userConfirmed: status === "taken",
        }
      : null,
  });
  save();
  resetCheck();
  page = "today";
  viewDay = dayKey();
  render();
  window.scrollTo(0, 0);
  toast(
    status === "taken"
      ? "Dose logged. Nice work!"
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
      "en-US": `Hello ${patient().name}. Review the ${selectedSlot.toLowerCase()} dose against your prescription plan. A photo will be sent to an external service for a visual suggestion. Check every pill against the pharmacy label; if anything is unclear, ask a caregiver or pharmacist.`,
      "es-US":
        "La foto se enviará a un servicio externo para obtener una sugerencia visual. Compare cada pastilla con la etiqueta de la farmacia y consulte a su farmacéutico si tiene dudas.",
      "zh-CN":
        "照片会发送到外部服务获取视觉建议。请将每片药与药房标签核对；如有疑问，请咨询药剂师。",
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
  el.innerHTML = `<h1>PillCheck · Weekly care record</h1><p>${esc(p.name)} · Generated ${esc(new Date().toLocaleString())}</p><p>${stats.taken} of ${stats.expected} scheduled periods self-reported taken (${stats.percent}%). Today counts periods through ${currentSlot()}.</p><h2>Current medication plan</h2><table><thead><tr><th>Medication</th><th>Strength</th><th>Quantity</th><th>Periods</th></tr></thead><tbody>${p.meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.strength)}</td><td>${m.quantity}</td><td>${m.slots.join(", ")}</td></tr>`).join("")}</tbody></table><h2>Past seven days</h2><table><thead><tr><th>Date</th><th>Period</th><th>Reported status</th><th>Note</th></tr></thead><tbody>${logs.map((l) => `<tr><td>${esc(l.day)}</td><td>${esc(l.slot)}</td><td>${esc(l.status)}</td><td>${esc(l.note)}</td></tr>`).join("")}</tbody></table><h2>Refill notes</h2>${
    p.refills
      .filter((r) => r.at.slice(0, 10) >= dayKey(cutoff))
      .map((r) => `<p>${esc(r.name)}: ${esc(r.note)}</p>`)
      .join("") || "<p>No refill notes this week.</p>"
  }<p>This is a self-reported record, not proof of ingestion or pill identity. PillCheck is a double-check aid and does not replace a pharmacist. Suggestions from our detection model are unverified and can be wrong. No clinical accuracy guarantee is active.</p>`;
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
function setPhoto(f) {
  if (!f) return;
  if (!f.type.startsWith("image/")) return toast("Choose an image file.");
  if (f.size > 15 * 1024 * 1024) return toast("Please choose a photo under 15 MB.");
  stopCamera();
  cameraError = "";
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  scanVersion++;
  scan = null;
  result = null;
  scanBusy = false;
  photo = f;
  photoUrl = URL.createObjectURL(f);
  render();
  analyzePhoto();
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
        result = scan ? visualSuggestionResult() : null;
        if (page !== "check") nav("check");
        else render();
      }),
  );
  document.querySelectorAll("[data-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        if (scanMode === b.dataset.mode) return;
        scanMode = b.dataset.mode;
        scanVersion++;
        scanBusy = false;
        scan = null;
        result = null;
        render();
        if (photo) analyzePhoto();
      }),
  );
  document.querySelectorAll("[data-day]").forEach(
    (b) =>
      (b.onclick = () => {
        viewDay = b.dataset.day;
        render();
      }),
  );
  document.querySelectorAll("[data-theme-choice]").forEach(
    (b) =>
      (b.onclick = () => {
        state.theme = b.dataset.themeChoice;
        save();
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
        save();
        resetCheck();
        render();
      }),
  );
  document.querySelectorAll("[data-delete-log]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmDialog(
          "Undo this record?",
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
  const actions = {
    "start-check": () => {
      resetCheck();
      selectedSlot =
        SLOTS.find(
          (s) => dosesFor(patient(), s).length && !isTaken(patient(), s),
        ) || currentSlot();
      nav("check");
    },
    profiles: profilesSheet,
    about: () => nav("about"),
    "back-to-app": () => {
      page = state.patients.length ? "today" : "welcome";
      render();
    },
    about: () => nav("welcome"),
    "toggle-theme": () => {
      state.theme = isDark() ? "light" : "dark";
      save();
      render();
    },
    retake: () => {
      resetCheck();
      render();
      startCamera();
    },
    "go-family": () => nav("family"),
    "add-med": () => medicationForm(),
    "new-profile": newProfile,
    speak,
    report,
    export: exportData,
    "scan-photo": analyzePhoto,
    "start-camera": startCamera,
    "capture-live": captureLivePhoto,
    "stop-camera": () => {
      stopCamera();
      cameraError = "";
      render();
    },
    "show-model-details": () => {
      const details = $("#model-details");
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    "go-meds": () => nav("meds"),
    "log-taken": () => {
      if (!$("#manual-dose-confirm")?.checked)
        return toast("Check each pill against the pharmacy label and dose plan first.");
      logDose("taken");
    },
    "log-concern": () => logDose("concern"),
    reset: () =>
      confirmDialog(
        "Erase this device?",
        "This removes all profiles and records from this browser. Export a backup first if you need them.",
        () => {
          state = emptyState();
          save();
          resetCheck();
          page = "welcome";
          render();
          window.scrollTo(0, 0);
          toast("All local data erased.");
        },
        "Erase all data",
      ),
  };
  document
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => actions[b.dataset.action]?.()));
  if ($("#manual-dose-confirm"))
    $("#manual-dose-confirm").onchange = (e) => {
      $("#manual-log").disabled = !e.target.checked;
    };
  if ($("#med-search"))
    $("#med-search").oninput = (e) => {
      const pos = e.target.selectionStart;
      search = e.target.value;
      render();
      $("#med-search").focus();
      $("#med-search").setSelectionRange(pos, pos);
    };
  for (const id of ["#dose-photo", "#dose-library"])
    if ($(id))
      $(id).onchange = (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        setPhoto(file);
      };
  const zone = $("#dropzone");
  if (zone) {
    zone.ondragover = (e) => {
      e.preventDefault();
      zone.classList.add("drag");
    };
    zone.ondragleave = () => zone.classList.remove("drag");
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      setPhoto(e.dataTransfer.files[0]);
    };
  }
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
        const imported = removeSampleProfiles(JSON.parse(await f.text()));
        if (!validateState(imported))
          throw Error("This is not a valid PillCheck backup.");
        confirmDialog(
          "Restore this backup?",
          `Replace all current local profiles with ${imported.patients.length} profile(s) from the backup?`,
          () => {
            state = imported;
            state.active = state.patients.some((p) => p.id === state.active)
              ? state.active
              : state.patients[0]?.id || null;
            save();
            resetCheck();
            page = state.patients.length ? "today" : "welcome";
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
      const incoming = removeSampleProfiles(JSON.parse(e.newValue));
      if (validateState(incoming)) {
        state = incoming;
        if (!state.patients.length) page = "welcome";
        resetCheck();
        render();
        toast("Updated from another tab.");
      }
    } catch {}
  }
});
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => (state.theme || "system") === "system" && render());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream) {
    stopCamera();
    cameraError = "The live camera stopped when you left this page.";
    if (page === "check") render();
  }
});
window.addEventListener("pagehide", stopCamera);
render();
