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
  photo = null;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
}
function nav(next) {
  if (page === "check" && next !== "check") stopCamera();
  page = next;
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
    const on = page === "organizer" ? false : current === id;
    return `<button class="side-link ${on ? "active" : ""}" data-page="${id}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}${label}</button>`;
  })
  .join("")}
<div class="side-foot"><button class="profile-chip" data-action="profiles"><span class="avatar sm">${initials(p.name)}</span><span class="grow"><b>${esc(p.name)}</b><small>${p.meds.length} medication${p.meds.length === 1 ? "" : "s"} · Switch</small></span></button></div></nav>
<div class="main"><main id="main" class="page" tabindex="-1" style="${entering ? "" : "animation:none"}">${storageError ? `<div class="notice orange" style="margin-top:12px">${art("warning", 32)}<div><b>Changes aren’t being saved</b><p>Export a backup in Settings.</p></div></div>` : ""}${body}</main></div></div>
<nav class="tabbar" aria-label="Main navigation">${NAV.map(([id, ic, label]) => `<button class="${current === id ? "active" : ""} ${id === "check" ? "scan-tab" : ""}" data-page="${id}" ${current === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></button>`).join("")}</nav>`;
  bind();
  if (cameraStream && page === "check") connectCameraPreview();
}
function welcome() {
  return `<main class="welcome" id="main"><div class="welcome-inner">
<div class="welcome-hero"><img src="/icon.svg" alt=""><h1>${state.onboarded ? "How PillCheck works" : "Welcome to PillCheck"}</h1><p>A second pair of eyes for every dose.</p></div>
<div class="card" style="display:grid;gap:22px;padding:22px">
<div class="feature">${art("camera", 46)}<div><b>Scan a dose</b><p>Our detection model reads each pill’s color, shape and imprint.</p></div></div>
<div class="feature">${art("calendar", 46)}<div><b>Stay on schedule</b><p>See what’s due today and keep a streak going.</p></div></div>
<div class="feature">${art("heart", 46)}<div><b>Made for caregivers</b><p>Track doses for everyone you help.</p></div></div>
</div>
<div class="welcome-actions">${state.onboarded ? button("Back to the app", "back-to-app", "primary block") : button("Get started", "new-profile", "primary block")}</div>
<p class="fine">Research prototype</p>
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
    ? `<div class="card" style="text-align:center;display:grid;justify-items:center;gap:10px;padding:28px 20px">${art("pill", 76)}<h2 style="font-size:1.3rem">Add your first medication</h2>${button("Add medication", "add-med", "primary block", "plus")}</div>`
    : `<div class="card summary"><span class="ring-wrap">${ring(slots.length ? taken / slots.length : 0, 92, 10)}<span class="ring-label">${taken}/${slots.length}</span></span><div class="grow"><h2>${!slots.length ? "Nothing scheduled" : taken === slots.length ? "All doses taken" : isToday ? `Next: ${next.toLowerCase()} dose` : `${slots.length - taken} not logged`}</h2><p>${taken === slots.length && slots.length ? (isToday ? "Great job today." : "Every dose was logged.") : isToday ? "Scan before you take them." : "Not logged that day."}</p>${streak ? `<span class="streak">${art("fire", 22)}${streak}-day streak</span>` : ""}</div></div>`;
  const groups = slots
    .map((s) => {
      const done = isTaken(p, s, viewDay),
        log = p.logs.find((l) => l.day === viewDay && l.slot === s && l.status === "taken");
      const doseActions = !done && isToday
        ? `<div class="slot-actions"><button class="link" data-manual-slot="${s}">Log manually</button>${s !== next ? `<button class="link" data-slot="${s}">${icon("scan-line")}Scan</button>` : ""}</div>`
        : "";
      return `<section class="section"><div class="dose-group-head"><h3>${art(SLOT_ART[s], 30)}${s}</h3>${doseActions}</div><div class="list">${done ? `<div class="taken-banner">${icon("check")}Taken${log ? " at " + esc(new Date(log.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : ""}</div>` : ""}${dosesFor(p, s, viewDay)
        .map(
          (m) =>
            `<${!done && isToday ? `button data-slot="${s}"` : "div"} class="row">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)}</span><br><span class="row-sub">${esc(m.strength)} · ${m.quantity} ${m.shape === "Capsule" ? "capsule" : "tablet"}${m.quantity > 1 ? "s" : ""}</span></span><span class="check-circle ${done ? "done" : ""}">${icon("check")}</span></${!done && isToday ? "button" : "div"}>`,
        )
        .join("")}${!done && isToday && s === next ? `<div class="slot-cta">${button(`Scan ${s.toLowerCase()} dose`, "start-check", "primary block", "scan-line")}</div>` : ""}${!done && !isToday ? `<div class="row plain"><span class="tag orange">Not logged</span></div>` : ""}</div></section>`;
    })
    .join("");
  return (
    topbar(isToday ? "Today" : viewDate.toLocaleDateString("en-US", { weekday: "long" }), {
      actions: `<button class="round-btn" data-action="add-med" aria-label="Add medication" title="Add medication">${icon("plus")}</button>${avatarBtn()}`,
    }) +
    weekStrip +
    `<div class="section" style="margin-top:14px">${summary}</div>` +
    groups +
    (pairs.length
      ? `<div class="section notice orange">${art("warning", 32)}<div><b>Some pills look alike</b><p>${pairs.map(([a, b]) => `${esc(a.name)} and ${esc(b.name)}`).join("; ")} look alike. Check the imprints.</p></div></div>`
      : "")
  );
}
function medications() {
  const p = patient(),
    matches = p.meds.filter((m) =>
      (m.name + " " + m.strength).toLowerCase().includes(search.toLowerCase()),
    ),
    pairs = blindSpots(p.meds);
  return (
    topbar("Your plan", {
      actions: `<button class="round-btn" data-action="add-med" aria-label="Add medication" title="Add medication">${icon("plus")}</button>${avatarBtn()}`,
    }) +
    (p.meds.length > 3
      ? `<label class="search">${icon("search")}<span class="sr-only">Find a medication</span><input id="med-search" placeholder="Search" value="${esc(search)}"></label>`
      : "") +
    (pairs.length
      ? `<div class="section notice orange">${art("warning", 32)}<div><b>Look-alike pills</b><p>${pairs.map(([a, b]) => `${esc(a.name)} and ${esc(b.name)}`).join("; ")} look alike.</p></div></div>`
      : "") +
    (p.meds.length
      ? `<div class="section"><div class="list">${matches
          .map(
            (m) =>
              `<button class="row" data-edit="${esc(m.id)}">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)} <span class="muted" style="font-weight:500">${esc(m.strength)}</span></span><br><span class="row-sub">${m.quantity} × ${m.slots.join(", ")}</span></span><span class="chev">${icon("chevron-right")}</span></button>`,
          )
          .join("") || '<div class="row plain"><span class="muted">No matches</span></div>'}</div></div>`
      : `<div class="section card" style="text-align:center;display:grid;justify-items:center;gap:10px;padding:30px 20px">${art("pill", 76)}<h2 style="font-size:1.3rem">No medications yet</h2>${button("Add medication", "add-med", "primary block", "plus")}</div>`) +
    `<div class="section list"><button class="row" data-page="organizer"><span class="ico-tile t-purple">${icon("grid-3x3")}</span><span class="grow row-title">Pill organizer</span><span class="chev">${icon("chevron-right")}</span></button></div>`
  );
}
// Map the detection model's free-text color and shape onto the app's pill icons.
const pillLook = (f) => {
  const c = (f.color || "").toLowerCase(),
    s = (f.shape || "").toLowerCase();
  return {
    color: Object.keys(colors).find((k) => c.includes(k.toLowerCase())) || "White",
    shape: /capsule/.test(s) ? "Capsule" : /oval|oblong|ellip/.test(s) ? "Oval" : "Round",
  };
};
const imprintKey = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Imprints are read from photos, so allow one misread character ("PAIN5" vs "PAN5").
function closeImprint(a, b) {
  a = imprintKey(a);
  b = imprintKey(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) i++, j++;
    else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else i++, j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const planMatch = (f, meds) => meds.find((m) => closeImprint(f.imprint, m.imprint));
// A planned medication counts as seen when a found pill carries its saved imprint.
const seenImprint = (m) => !!scan?.pills.some((f) => closeImprint(f.imprint, m.imprint));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
function resultHtml(meds) {
  const found = scan.pills,
    expected = meds.reduce((n, m) => n + m.quantity, 0),
    countOk = found.length > 0 && found.length === expected,
    head = found.length
      ? `${found.length} pill${found.length === 1 ? "" : "s"} found`
      : "No pills found",
    sub = !found.length
      ? "Try again on a plain surface with better light."
      : expected
        ? countOk
          ? `Matches the ${expected} planned for ${selectedSlot.toLowerCase()}`
          : `${expected} planned for ${selectedSlot.toLowerCase()}`
        : `Nothing is planned for ${selectedSlot.toLowerCase()}`;
  const rows = found
    .map((f) => {
      const look = pillLook(f),
        label = cap([f.color, f.shape].filter(Boolean).join(" ").toLowerCase()) || "Pill",
        mine = planMatch(f, meds),
        sub = mine
          ? `<span class="row-sub match">${icon("check")}Matches ${esc(mine.name)} ${esc(mine.strength)}</span>`
          : f.possible
            ? `<span class="row-sub">Possibly ${esc(f.possible)}</span>`
            : "";
      return `<div class="row">${pill(look)}<span class="grow"><span class="row-title">${esc(label)}</span>${sub ? "<br>" + sub : ""}</span>${f.imprint ? `<span class="imprint">${esc(f.imprint)}</span>` : ""}</div>`;
    })
    .join("");
  const logAction = !expected
    ? ""
    : countOk
      ? button("Log as taken", "log-taken", "success block", "check")
      : button("Log manually", "log-manual", "success block", "check");
  const resultNote = !expected
    ? `Nothing is planned for ${selectedSlot.toLowerCase()}.`
    : countOk
      ? "Research prototype · compare with your pharmacy label."
      : found.length
        ? "The detected count does not match the plan. Retake or log manually if you took the dose."
        : "No pills were detected, so this scan cannot be logged as taken. If you took the dose, you can record it manually.";
  return `<div class="card found" role="status" id="check-result"><div class="found-head"><span class="found-ico ${countOk ? "good" : "warn"}">${icon(countOk ? "check" : found.length ? "triangle-alert" : "x")}</span><div><h2>${head}</h2><p>${esc(sub)}</p></div></div>${rows ? `<div class="list flat">${rows}</div>` : ""}${scan.note ? `<p class="found-note">${esc(scan.note)}</p>` : ""}</div>
<div class="actions-row">${logAction}<div class="btn-pair">${button("Retake", "retake", "block", "camera")}${button("Flag a problem", "log-concern", "block", "triangle-alert")}</div></div>
<p class="research-note">${resultNote}</p>`;
}
function checkPage() {
  const p = patient(),
    meds = dosesFor(p, selectedSlot),
    planned = `<div class="section"><div class="section-head"><h2>Planned for ${selectedSlot.toLowerCase()}</h2></div><div class="list">${meds.map((m) => `<button class="row" data-edit="${esc(m.id)}">${pill(m)}<span class="grow"><span class="row-title">${esc(m.name)}</span><br><span class="row-sub">${esc(m.strength)} · ${m.quantity} ${m.shape === "Capsule" ? "capsule" : "tablet"}${m.quantity > 1 ? "s" : ""}${m.imprint ? ` · ${esc(m.imprint)}` : ""}</span></span>${scan && seenImprint(m) ? `<span class="tag green">${icon("check")}Seen</span>` : ""}</button>`).join("") || `<div class="row plain"><span class="muted">Nothing planned.</span></div>`}</div></div>`;
  const slotPicker = `<div class="segmented" role="group" aria-label="Which dose">${SLOTS.map((s) => `<button data-slot="${s}" aria-pressed="${s === selectedSlot}">${s}${isTaken(p, s) ? " ✓" : ""}</button>`).join("")}</div>`;
  const modeToggle = `<div class="segmented mode" role="group" aria-label="Photo type">${[
    ["dose", "Several pills"],
    ["single", "One pill"],
  ]
    .map(([id, label]) => `<button data-mode="${id}" aria-pressed="${scanMode === id}">${label}</button>`)
    .join("")}</div>`;
  let body;
  if (scan && !scanBusy)
    body = `<div class="viewfinder shot"><img src="${esc(photoUrl)}" alt="Scanned photo"></div><div class="section">${resultHtml(meds)}</div>${planned}`;
  else if (cameraStream)
    body = `<div class="viewfinder camera-live"><video id="camera-video" autoplay playsinline muted aria-label="Live camera preview"></video><canvas id="camera-overlay" aria-hidden="true"></canvas><span class="camera-status" id="camera-status" role="status" aria-live="polite">Starting camera…</span><span class="corners"></span></div><div class="shutter-row"><label class="side-action" for="dose-library"><span class="ico">${icon("image-up")}</span>Upload</label><button class="shutter" data-action="capture-live" aria-label="Capture and scan">${icon("camera")}</button><button class="side-action" data-action="stop-camera"><span class="ico">${icon("x")}</span>Stop</button></div>${modeToggle}${planned}`;
  else if (scanBusy || photoUrl)
    body = `<div class="viewfinder ${scanBusy ? "busy" : ""}">${photoUrl ? `<img src="${esc(photoUrl)}" alt="Photo being scanned">` : ""}<span class="corners"></span>${scanBusy ? `<span class="camera-status" role="status" aria-live="polite">Analyzing…</span>` : ""}</div>${scanBusy ? "" : `<div class="section notice orange">${art("warning", 32)}<div><b>${esc(scanProgress || "Something went wrong")}</b></div></div><div class="actions-row">${button("Try again", "scan-photo", "primary block", "refresh-cw")}${button("Retake", "retake", "block", "camera")}</div>`}`;
  else
    body = `<div class="viewfinder" id="dropzone"><span class="corners"></span><span class="hint">${icon("camera")}<b>${scanMode === "single" ? "Fill the frame with one pill" : "Spread pills on a plain surface"}</b><span>Imprints up, good light</span></span></div>
${cameraError ? `<div class="section notice orange">${art("warning", 32)}<div><b>${esc(cameraError)}</b><br><label class="link" for="dose-photo">Use the device camera instead</label></div></div>` : ""}
<div class="shutter-row"><label class="side-action" for="dose-library"><span class="ico">${icon("image-up")}</span>Upload</label><button class="shutter" data-action="start-camera" aria-label="Start camera">${icon("camera")}</button><span class="side-action" aria-hidden="true"></span></div>${modeToggle}
${planned}`;
  return (
    topbar("Scan", {
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
  scanProgress = "";
  render();
  try {
    const upload = await preparePhoto(photo);
    if (version !== scanVersion) return;
    const response = await fetch("/api/recognize", {
      method: "POST",
      headers: {
        "Content-Type": upload.type,
        "X-PillCheck-Mode": scanMode,
      },
      body: upload,
      signal: AbortSignal.timeout(40_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(payload.error || "Our detection model is unavailable. Try again.");
    if (version !== scanVersion) return;
    scan = {
      model: payload.model || "PillCheck detection model",
      pills: Array.isArray(payload.pills) ? payload.pills : [],
      note: payload.note || "",
      elapsedMs: performance.now() - started,
    };
  } catch (e) {
    if (version !== scanVersion) return;
    scanProgress =
      e.name === "TimeoutError" ? "Our detection model took too long. Try again." : e.message;
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
<div class="section list"><label class="row" for="org-photo"><span class="ico-tile t-teal">${icon("camera")}</span><span class="grow row-title">Add a reference photo</span><span class="chev">${icon("chevron-right")}</span></label></div><input type="file" id="org-photo" accept="image/*" capture="environment">${viewOrgPhoto ? `<img src="${esc(viewOrgPhoto)}" alt="Organizer reference photo" style="width:100%;max-height:320px;object-fit:contain;border-radius:18px;margin-top:12px;background:#000">` : ""}`
  );
}
function family() {
  const p = patient(),
    stats = adherence(p),
    logs = [...p.logs].sort((a, b) => b.at.localeCompare(a.at)),
    streak = streakDays(p);
  return (
    topbar("History", { actions: avatarBtn() }) +
    `<div class="stats"><div class="card stat"><b>${stats.expected ? stats.percent + "%" : "—"}</b><span>This week</span></div><div class="card stat"><b>${streak}</b><span>Day streak</span></div><div class="card stat"><b>${p.logs.filter((l) => l.status === "taken").length}</b><span>Doses logged</span></div></div>
<div class="section"><div class="section-head"><h2>Last 7 days</h2></div><div class="card"><div class="bars" role="img" aria-label="${stats.taken} of ${stats.expected} scheduled doses logged in the past seven days">${stats.daily.map((d) => `<div class="bar"><div class="track"><div class="fill" style="height:${d.expected ? (d.taken / d.expected) * 100 : 0}%"></div></div><span>${d.label}</span></div>`).join("")}</div></div></div>
<div class="section">${button("Print a report for the doctor", "report", "primary block", "printer")}</div>
<div class="section"><div class="section-head"><h2>Dose log</h2><span class="faint small">${logs.length} records</span></div><div class="list">${
      logs
        .slice(0, 50)
        .map(
          (l) =>
            `<div class="row"><span class="ico-tile ${l.status === "taken" ? "t-green" : "t-orange"}">${icon(l.status === "taken" ? "check" : "triangle-alert")}</span><span class="grow"><span class="row-title">${esc(l.slot)} · ${esc(l.status === "taken" ? "Taken" : l.status === "concern" ? "Concern" : "Skipped")}</span><br><span class="row-sub">${esc(new Date(l.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span></span><button class="link" data-delete-log="${esc(l.id)}">Undo</button></div>`,
        )
        .join("") ||
      `<div class="row plain"><span class="muted">No doses logged yet.</span></div>`
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
<div class="section"><div class="section-head"><h2>Display</h2></div><div class="list"><label class="row"><span class="ico-tile t-blue">${icon("a-large-small")}</span><span class="grow row-title">Larger text</span><input id="large-text" class="switch" type="checkbox" ${state.large ? "checked" : ""}></label><div class="row"><span class="ico-tile t-purple">${icon("sun-moon")}</span><span class="grow row-title" style="white-space:nowrap">Theme</span><div class="segmented" role="group" aria-label="Appearance" style="flex:0 1 190px">${[
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
<div class="section"><div class="section-head"><h2>Your data</h2></div><div class="list"><button class="row" data-action="export"><span class="ico-tile t-blue">${icon("download")}</span><span class="grow row-title">Export a backup</span><span class="chev">${icon("chevron-right")}</span></button><label class="row" for="import-file"><span class="ico-tile t-green">${icon("upload")}</span><span class="grow row-title">Restore from a backup</span><span class="chev">${icon("chevron-right")}</span></label><button class="row" data-action="reset"><span class="ico-tile t-red">${icon("trash-2")}</span><span class="grow row-title" style="color:var(--red)">Erase all data on this device</span></button></div><input id="import-file" type="file" accept="application/json,.json"></div>
<div class="section"><div class="section-head"><h2>About</h2></div><div class="list"><button class="row" data-page="about"><span class="ico-tile t-blue">${icon("circle-help")}</span><span class="grow row-title">How PillCheck works</span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-page="welcome"><span class="ico-tile t-gray">${icon("sparkles")}</span><span class="grow row-title">Show the welcome screen</span><span class="chev">${icon("chevron-right")}</span></button></div><p class="caption">Your data stays in this browser. Photos are analyzed by our detection model and not stored.</p></div>`
  );
}
function about() {
  return (
    topbar("How it works", { back: "settings" }) +
    `<div class="card" style="display:grid;gap:18px"><div class="feature">${art("camera", 46)}<div><b>1 · Snap the dose</b><p>Spread the pills out on a plain surface and take one photo.</p></div></div><div class="feature">${art("search", 46)}<div><b>2 · Our detection model reads it</b><p>It finds each pill and reads its color, shape and imprint.</p></div></div><div class="feature">${art("check", 46)}<div><b>3 · Compare with your plan</b><p>PillCheck counts the pills and flags imprints that match your saved medications.</p></div></div></div>
<p class="caption">Research prototype · not a medical device.</p>
<p class="caption">Icons: Lucide (ISC). Illustrations: Microsoft Fluent Emoji (MIT). This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.</p>`
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
      `${!old ? `<label class="field-group">Look up a medicine<div class="toolbar" style="margin:0"><input id="lookup-query" placeholder="e.g. metformin or bottle NDC"><button type="button" class="btn" id="lookup-btn">Look up</button></div></label><div id="lookup-status" class="small muted" role="status"></div><div id="lookup-results" class="lookup-results"></div><hr style="border:0;border-top:1px solid var(--line);margin:20px 0">` : ""}<form id="med-form"><div class="form-grid"><label class="field-group full">Medication name<input name="name" value="${esc(m.name)}" maxlength="160" required></label><label class="field-group">Strength<input name="strength" value="${esc(m.strength)}" placeholder="e.g. 10 mg" maxlength="100" required></label><label class="field-group">Pills per dose<input name="quantity" value="${m.quantity}" type="number" min="1" max="20" step="1" required></label><label class="field-group">Color<select name="color">${Object.keys(
        colors,
      )
        .map((c) => `<option ${m.color === c ? "selected" : ""}>${c}</option>`)
        .join(
          "",
        )}</select></label><label class="field-group">Shape<select name="shape">${["Round", "Oval", "Capsule"].map((c) => `<option ${m.shape === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field-group">Imprint<input name="imprint" value="${esc(m.imprint)}" maxlength="60" placeholder="Letters / numbers"></label><label class="field-group">Manufacturer (optional)<input name="manufacturer" value="${esc(m.manufacturer)}" maxlength="100"></label><label class="field-group full">NDC from bottle (optional)<input name="ndc" value="${esc(m.ndc || "")}" maxlength="20" placeholder="e.g. 00093-0148-01"></label><div class="field-group full"><span>When</span><div class="checks">${SLOTS.map((s) => `<label><input name="slots" value="${s}" type="checkbox" ${m.slots.includes(s) ? "checked" : ""}>${s}</label>`).join("")}</div></div></div><p class="error" id="form-error" role="alert"></p><div class="dialog-actions">${old ? `<button type="button" class="btn danger" id="delete-med">Delete</button><button type="button" class="btn" id="refill-med">New refill?</button>` : ""}<button class="btn primary" type="submit">Save medication</button></div></form>`,
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
    toast("Medication saved.");
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
      `<form id="profile-form"><label class="field-group">First name or nickname<input id="profile-name" required maxlength="50" placeholder="e.g. Alex" autocomplete="off"></label><div class="dialog-actions"><button class="btn primary">Create profile</button></div></form>`,
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
    dialogHead("New refill") +
      `<div class="note">Saved: ${esc(m.color)} ${esc(m.shape)} · Imprint ${esc(m.imprint || "not recorded")}<br>Manufacturer: ${esc(m.manufacturer || "not recorded")}</div><form id="refill-form" class="section-gap"><label class="field-group">What changed?<select name="change"><option value="appearance">Color, shape, or imprint looks different</option><option value="manufacturer">Manufacturer on the label changed</option><option value="none">No changes noticed</option></select></label><label class="field-group section-gap">Your note<textarea name="note" rows="3" maxlength="500" placeholder="What you noticed or what your pharmacist confirmed"></textarea></label><div class="dialog-actions"><button class="btn primary">Save refill note</button></div></form>`,
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
    toast("Refill note saved.");
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
function confirmManualLog() {
  if (!dosesFor(patient(), selectedSlot).length)
    return toast("No medication is scheduled for this period.");
  confirmDialog(
    "Log dose manually?",
    "This is a self-reported record and does not use the scan. Continue only if you took the scheduled dose.",
    () => logDose("taken", "manual"),
    "Log dose",
  );
}
function logDose(status, method = "scan") {
  const p = patient();
  if (status === "taken" && !dosesFor(p, selectedSlot).length) {
    toast("No medication is scheduled for this period.");
    return;
  }
  if (status === "taken" && method === "scan") {
    const expected = dosesFor(p, selectedSlot).reduce((n, m) => n + m.quantity, 0);
    if (!expected || !scan?.pills?.length || scan.pills.length !== expected) {
      toast("The scan count does not match the plan. Retake or log manually.");
      return;
    }
  }
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
        ? method === "manual"
          ? "Manually logged by user"
          : "Logged after a scan"
        : "Concern reported after a scan",
    medications: dosesFor(p, selectedSlot).map((m) => ({
      name: m.name,
      strength: m.strength,
      quantity: m.quantity,
    })),
    observations: structuredClone(observations),
    recognition: method === "scan" && scan
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
      : "Problem saved to history.",
  );
}
function speak() {
  if (!("speechSynthesis" in window)) {
    toast("Read-aloud is unavailable in this browser.");
    return;
  }
  const lang = state.language || "en-US",
    texts = {
      "en-US": `Hello ${patient().name}. Spread the ${selectedSlot.toLowerCase()} pills on a plain surface with the imprints up, then take a photo.`,
      "es-US":
        "Coloque las pastillas sobre una superficie lisa con la marca hacia arriba y tome una foto.",
      "zh-CN":
        "请把药片平放在纯色表面上，印字朝上，然后拍一张照片。",
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
  }<p>Self-reported record from PillCheck, a research prototype.</p>`;
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
        if (page !== "check") nav("check");
        else render();
      }),
  );
  document.querySelectorAll("[data-manual-slot]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedSlot = b.dataset.manualSlot;
        confirmManualLog();
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
    "log-taken": () => logDose("taken"),
    "log-manual": confirmManualLog,
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
