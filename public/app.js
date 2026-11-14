import {
  detectPills,
  evaluateScan,
  productNdc,
} from "./recognition-core.js";
import { recognizePhoto, loadRecognition, modelStatus, onModelStatus, fuseSides, findPillsLive } from "./recognition.js";
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
// Lucide icons (ISC), bundled locally.
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
// Bespoke visual language (no stock emoji): rendered pills, light glyphs for the
// time of day, an animated verdict seal and a flame. All drawn as inline SVG.
const colors = {
  White: "#f1eee6",
  Pink: "#f4a6b7",
  Yellow: "#f6d36a",
  Blue: "#78a9ec",
  Orange: "#f59f5a",
  Green: "#79c98c",
  Brown: "#b8875f",
  Red: "#e5655a",
  Purple: "#ad94e4",
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Mix a color toward white (amt > 0) or black (amt < 0).
const shade = (hex, amt) =>
  "#" +
  hexRgb(hex)
    .map((v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
let svgSeq = 0;
// A lit, glossy pill: shaded body, rim, score line, specular highlight, contact shadow.
function pillSvg(shape, c, angle = -32) {
  const id = "p" + ++svgSeq,
    hi = shade(c, 0.55),
    lo = shade(c, -0.28),
    rim = shade(c, -0.42),
    defs = `<defs><radialGradient id="${id}b" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${lo}"/></radialGradient><linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lo}"/><stop offset=".18" stop-color="${hi}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${rim}"/></linearGradient><linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d6cf"/><stop offset=".18" stop-color="#ffffff"/><stop offset=".45" stop-color="#f4f2ee"/><stop offset="1" stop-color="#b9b5ad"/></linearGradient><radialGradient id="${id}s"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>`,
    shadow = `<ellipse cx="33" cy="54" rx="21" ry="5" fill="url(#${id}s)"/>`;
  if (shape === "Capsule")
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${defs}${shadow}<g transform="rotate(${angle} 32 32)"><rect x="8" y="22" width="48" height="20" rx="10" fill="url(#${id}w)"/><path d="M32 22H18a10 10 0 0 0 0 20h14z" fill="url(#${id}c)"/><path d="M32 22v20" stroke="rgb(0 0 0 / .18)" stroke-width="1.2"/><rect x="8" y="22" width="48" height="20" rx="10" fill="none" stroke="rgb(0 0 0 / .14)"/><rect x="13" y="25.5" width="36" height="3.4" rx="1.7" fill="#fff" opacity=".7"/></g></svg>`;
  if (shape === "Oval")
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${defs}${shadow}<g transform="rotate(${angle} 32 32)"><ellipse cx="32" cy="32" rx="24" ry="14" fill="url(#${id}b)"/><ellipse cx="32" cy="32" rx="24" ry="14" fill="none" stroke="${rim}" stroke-opacity=".55"/><ellipse cx="32" cy="32" rx="20.5" ry="10.8" fill="none" stroke="#fff" stroke-opacity=".28"/><path d="M12 32h40" stroke="${rim}" stroke-opacity=".45" stroke-width="1.4"/><path d="M12 33.3h40" stroke="#fff" stroke-opacity=".35"/><ellipse cx="23" cy="24.5" rx="8" ry="2.6" fill="#fff" opacity=".65"/></g></svg>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${defs}${shadow}<circle cx="32" cy="31" r="21" fill="url(#${id}b)"/><circle cx="32" cy="31" r="21" fill="none" stroke="${rim}" stroke-opacity=".55"/><circle cx="32" cy="31" r="17.5" fill="none" stroke="#fff" stroke-opacity=".3"/><path d="M13 31h38" stroke="${rim}" stroke-opacity=".45" stroke-width="1.4"/><path d="M13 32.3h38" stroke="#fff" stroke-opacity=".35"/><ellipse cx="24" cy="21.5" rx="7" ry="3.2" fill="#fff" opacity=".7" transform="rotate(-24 24 21.5)"/></svg>`;
}
const pill = (m, cls = "") =>
  `<span class="pill-ico ${cls}" role="img" aria-label="${esc(m.color)} ${esc(m.shape.toLowerCase())} pill">${pillSvg(m.shape, colors[m.color] || colors.White)}</span>`;
// Three floating pills, used for empty states and the welcome screen.
const pillTrio = (cls = "") =>
  `<span class="pill-trio ${cls}" aria-hidden="true"><span>${pillSvg("Capsule", colors.Orange, -38)}</span><span>${pillSvg("Round", colors.Blue)}</span><span>${pillSvg("Oval", colors.White, 24)}</span></span>`;
// Verdict seal: a soft gradient disc whose mark draws itself in.
const SEAL = {
  check: ["#34d399", "#059669", '<path class="draw" d="M19 33l8.5 8.5L45 23"/>'],
  search: ["#60a5fa", "#2563eb", '<circle class="draw" cx="29" cy="29" r="10"/><path class="draw" d="M37 37l8 8"/>'],
  question: ["#fbbf24", "#d97706", '<path class="draw" d="M25 25a7 7 0 1 1 9.5 6.5c-1.8.8-2.5 2-2.5 4"/><circle cx="32" cy="44" r="1.9" fill="#fff" stroke="none"/>'],
  warning: ["#fbbf24", "#d97706", '<path class="draw" d="M32 20v14"/><circle cx="32" cy="43" r="1.9" fill="#fff" stroke="none"/>'],
  cross: ["#fb7185", "#e11d48", '<path class="draw" d="M23 23l18 18M41 23L23 41"/>'],
};
function seal(name, size) {
  const id = "s" + ++svgSeq,
    [a, b, mark] = SEAL[name] || SEAL.warning;
  return `<svg class="seal" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><circle cx="32" cy="32" r="29" fill="url(#${id})"/><circle cx="32" cy="32" r="29" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/><ellipse cx="25" cy="15" rx="14" ry="6" fill="#fff" opacity=".22"/><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${mark}</g></svg>`;
}
function flame(size) {
  const id = "f" + ++svgSeq;
  return `<svg class="flame" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a36"/><stop offset=".6" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs><path d="M16 2c1 5 7 8 7 15a7 7 0 0 1-14 0c0-3.5 1.8-5.6 3.4-7.4.3 2.2 1.3 3.6 2.6 4.4C14.4 10 14.6 5.7 16 2z" fill="url(#${id})"/><path d="M16 29a4.2 4.2 0 0 1-4.2-4.2c0-2.6 2.2-3.9 3-6 1.6 1.7 5.4 3.4 5.4 6A4.2 4.2 0 0 1 16 29z" fill="#ffe8a3"/></svg>`;
}
// Single entry point used across the views.
function art(name, size = 40) {
  if (name === "fire") return flame(size);
  if (name in SEAL) return seal(name, size);
  if (name === "pill") return pillTrio();
  return seal("warning", size);
}
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
// The "how it works" welcome screen opens first on every load.
let page = "welcome",
  lastPage = null,
  viewDay = dayKey(),
  selectedSlot = currentSlot(),
  photo = null,
  photoUrl = null,
  observations = {},
  search = "",
  lookup = [];
let storageError = false;
let scan = null,
  // Flip step: the pill being re-checked, the scan it belongs to, and that scan's photo.
  flipTarget = null,
  baseScan = null,
  basePhotoUrl = null,
  flipBack = null,
  photoAspect = 0,
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
  if (basePhotoUrl && basePhotoUrl !== photoUrl) URL.revokeObjectURL(basePhotoUrl);
  flipTarget = null;
  baseScan = null;
  basePhotoUrl = null;
  flipBack = null;
  cameraError = "";
  scanVersion++;
  scan = null;
  scanBusy = false;
  scanProgress = "";
  selectedSlot = currentSlot();
  observations = {};
  photo = null;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
}
function nav(next) {
  if (page === "check" && next !== "check") stopCamera();
  const go = () => {
    page = next;
    if (next === "today") viewDay = dayKey();
    render();
    window.scrollTo(0, 0);
  };
  // Native-feeling cross-fade between screens where the browser supports it. The
  // transition waits for a rendered frame, so if frames are paused (background tab,
  // some screen recorders) switch screens anyway after a short fallback.
  if (document.startViewTransition && next !== page && !reducedMotion()) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      go();
      $("#main")?.focus({ preventScroll: true });
    };
    const transition = document.startViewTransition(run);
    transition.finished.catch(() => {});
    setTimeout(() => {
      if (!done) {
        transition.skipTransition?.();
        run();
      }
    }, 250);
  } else {
    go();
    $("#main")?.focus({ preventScroll: true });
  }
}
const button = (label, action, kind = "", ico = "") =>
  `<button class="btn ${kind}" data-action="${action}">${ico ? icon(ico) : ""}${label}</button>`;
// Official product names can be very long; show a readable prefix and keep the full name as a tooltip.
const short = (s, n = 38) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const initials = (name) => esc(name.slice(0, 2).toUpperCase());
const avatarBtn = () =>
  `<button class="avatar" data-action="profiles" aria-label="Switch person (now ${esc(patient().name)})" title="Switch person">${initials(patient().name)}</button>`;
const topbar = (title, { sub = "", actions = "", back = "" } = {}) =>
  `${back ? `<button class="back" data-page="${back}">${icon("chevron-left")}Back</button>` : ""}<header class="topbar"><div>${sub ? `<div class="sub">${sub}</div>` : ""}<h1>${title}</h1></div><div class="top-actions">${actions}</div></header>`;
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
      { today, meds: medications, check: checkPage, family, settings }[page] || today
    )(),
    current = page;
  $("#app").innerHTML =
    `<a class="skip-link" href="#main">Skip to content</a><div class="shell">
<nav class="sidebar" aria-label="Main navigation"><div class="brand"><img src="/icon.svg" alt="">PillCheck</div>
<button class="btn primary side-scan" data-page="check">${icon("scan-line")}Scan a dose</button>
${NAV.filter(([id]) => id !== "check")
  .map(([id, ic, label]) => {
    const on = current === id;
    return `<button class="side-link ${on ? "active" : ""}" data-page="${id}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}${label}</button>`;
  })
  .join("")}
<div class="side-foot"><button class="profile-chip" data-action="profiles"><span class="avatar sm">${initials(p.name)}</span><span class="grow"><b>${esc(p.name)}</b><small>${p.meds.length} medication${p.meds.length === 1 ? "" : "s"} · Switch</small></span></button></div></nav>
<div class="main"><main id="main" class="page" tabindex="-1" style="${entering ? "" : "animation:none"}">${storageError ? `<div class="notice orange" style="margin-top:12px">${art("warning", 32)}<div><b>Changes aren’t being saved</b><p>Export a backup in Settings.</p></div></div>` : ""}${body}</main></div></div>
${page !== "check" && p.meds.length ? `<button class="fab" data-page="check">${icon("scan-line")}Scan a dose</button>` : ""}${page === "check" ? "" : `<nav class="tabbar" aria-label="Main navigation">${NAV.filter(([id]) => id !== "check")
  .map(([id, ic, label]) => `<button class="${current === id ? "active" : ""}" data-page="${id}" aria-label="${label}" title="${label}" ${current === id ? 'aria-current="page"' : ""}>${icon(ic)}</button>`)
  .join("")}</nav>`}`;
  bind();
  if (cameraStream && page === "check") connectCameraPreview();
}
function welcome() {
  return `<main class="welcome" id="main"><div class="welcome-inner">
${pillTrio("float")}
<div class="welcome-hero"><h1>Check every dose before you take it.</h1><p>Point your camera at the pills in your hand. PillCheck compares them with your prescription, right on your device.</p></div>
<div class="list">
<div class="row"><span class="ico-tile t-blue">${icon("scan-line")}</span><span class="grow"><span class="row-title">Scan in a second</span><br><span class="row-sub">Each pill is recognized on your device.</span></span></div>
<div class="row"><span class="ico-tile t-green">${icon("shield-check")}</span><span class="grow"><span class="row-title">Honest when unsure</span><br><span class="row-sub">Says “not sure” instead of guessing.</span></span></div>
<div class="row"><span class="ico-tile t-orange">${icon("users")}</span><span class="grow"><span class="row-title">For you and family</span><br><span class="row-sub">Private, offline, no account.</span></span></div>
</div>
<div class="welcome-actions">${state.onboarded && state.patients.length ? button("Continue", "back-to-app", "dark block") : button("Try the demo", "start-demo", "dark block") + button("Set up my plan", "new-profile", "plain block")}</div>
<p class="fine">Research prototype · not a medical device</p>
</div></main>`;
}
// Short labels for the time column, so the schedule reads like a timetable.
const SLOT_TIME = { Morning: "AM", Afternoon: "Noon", Evening: "PM", Bedtime: "Night" };
function today() {
  const p = patient(),
    { slots, taken } = dayStats(p, dayKey()),
    current = SLOTS.indexOf(currentSlot()),
    next = slots.find((s) => !isTaken(p, s)),
    yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return dayStats(p, dayKey(d));
    })(),
    date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    slotState = (s) => (isTaken(p, s) ? "done" : SLOTS.indexOf(s) <= current ? "due" : "later");
  const head = `<div class="today-top"><span class="date">${esc(date)}</span>${avatarBtn()}</div>`;
  if (!p.meds.length)
    return `${head}<section class="empty">${pillTrio()}<h1>No medications yet</h1><p>Add a prescription to start checking doses.</p>${button("Add a medication", "go-meds", "dark block")}${button("Try the demo", "start-demo", "plain block")}</section>`;
  const rows = slots
    .map((s) => {
      const st = slotState(s),
        log = p.logs.find((l) => l.day === dayKey() && l.slot === s && l.status === "taken"),
        tag = st === "due" ? "button" : "div";
      return `<${tag} class="t ${st}" ${st === "due" ? `data-slot="${s}"` : ""}><span class="t-time">${SLOT_TIME[s]}</span><span class="t-main"><b>${s}</b><span>${esc(short(dosesFor(p, s).map((m) => m.name).join(", "), 38))}</span></span><span class="t-chip ${st}">${st === "done" ? (log ? esc(new Date(log.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : "Taken") : st === "due" ? "Scan" : "Later"}</span></${tag}>`;
    })
    .join("");
  const yest = yesterday.slots.length
    ? `<div class="t done past"><span class="t-time">Yest.</span><span class="t-main"><b>${yesterday.taken === yesterday.slots.length ? `All ${yesterday.slots.length} doses` : `${yesterday.taken} of ${yesterday.slots.length} doses`}</b><span>Logged</span></span><span class="t-chip done">${icon("check")}</span></div>`
    : "";
  return `${head}<section class="count"><div class="big">${taken}<small>/${slots.length}</small></div><p>${taken === slots.length ? "all doses taken today" : "doses taken today"}</p><div class="bar" aria-hidden="true">${slots.map((s) => `<i class="${slotState(s)}"></i>`).join("")}</div></section>
<div class="timeline">${rows}${yest}</div>${next ? `<button class="link quiet" data-manual-slot="${next}">Log ${next.toLowerCase()} dose without scanning</button>` : ""}`;
}
function medications() {
  const p = patient(),
    matches = p.meds.filter((m) =>
      (m.name + " " + m.strength).toLowerCase().includes(search.toLowerCase()),
    ),
    pairs = blindSpots(p.meds);
  return (
    topbar("Medications", {
      actions: `${p.meds.length ? `<button class="round-btn" data-action="add-med" aria-label="Add medication" title="Add medication">${icon("plus")}</button>` : ""}${avatarBtn()}`,
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
      : `<div class="section card" style="text-align:center;display:grid;justify-items:center;gap:10px;padding:30px 20px">${art("pill", 76)}<h2 style="font-size:1.3rem">No medications yet</h2>${button("Add medication", "add-med", "primary block", "plus")}</div>`)
  );
}
const referenceFor = (pill) => pill?.candidates?.[0] || null;
const referenceName = (reference) => {
  const label = reference?.label;
  if (!label) return reference?.ndc ? `NDC ${reference.ndc}` : "Unknown reference";
  return short([label.name, label.strength].filter(Boolean).join(" · "), 60);
};
const matchesMedication = (pill, medication) => {
  const reference = referenceFor(pill);
  return !!pill?.accepted && !!reference &&
    productNdc(reference.ndc) === productNdc(medication.ndc || medication.pillId);
};
const VERDICT = {
  matched: "Match.",
  uncertain: "Not sure.",
  wrong: "Wrong pill.",
  missing: "Count is off.",
  setup: "Add bottle info.",
  time: "Check the time.",
  duplicate: "Already logged.",
  flip: "Flip to confirm.",
};
function resultHtml(meds) {
  const found = scan.pills,
    expected = meds.reduce((n, m) => n + m.quantity, 0),
    evaluation = evaluateScan(patient(), selectedSlot, scan, { day: dayKey() }),
    canLogFromScan = evaluation.type === "matched",
    identifyOnly =
      evaluation.type === "setup" ||
      (!expected && found.length > 0),
    allKnown = found.length > 0 && found.every((f) => f.accepted),
    tone = identifyOnly
      ? allKnown ? "info" : "warn"
      : canLogFromScan
        ? "good"
        : ["wrong", "missing"].includes(evaluation.type)
          ? "bad"
          : "warn",
    word = identifyOnly ? (allKnown ? "Found." : "Not sure.") : VERDICT[evaluation.type] || "Check again.",
    sub = identifyOnly
      ? found.some((f) => f.accepted)
        ? `${found.length} pill${found.length === 1 ? "" : "s"} found. Confirm names on the bottle.`
        : `${found.length} pill${found.length === 1 ? "" : "s"} found, but ${found.length === 1 ? "it doesn’t" : "none"} match PillCheck’s library of about 4,900 prescription pills. Many store-brand and over-the-counter pills aren’t in it yet. Check the bottle label.`
      : canLogFromScan
        ? `${found.length} of ${expected} ${expected === 1 ? "pill matches" : "pills match"} your ${selectedSlot.toLowerCase()} plan.`
        : evaluation.detail;
  const tiles = found
    .map((f, i) => {
      const reference = referenceFor(f),
        matched = identifyOnly
          ? null
          : evaluation.matches
            ? meds.find((m) => productNdc(m.ndc || m.pillId) === evaluation.matches[i])
            : meds.find((m) => matchesMedication(f, m)),
        flipping = evaluation.flip?.includes(i),
        state = matched ? "ok" : flipping ? "unsure" : f.accepted ? (identifyOnly ? "ok" : "off") : "unsure",
        name = matched ? matched.name : f.accepted ? referenceName(reference) : `Pill ${i + 1}`,
        label = matched
          ? f.sides === 2 ? "Both sides match" : "In your plan"
          : flipping
            ? "Flip to check"
            : f.accepted ? (identifyOnly ? "Likely match" : "Not in your plan") : "Not sure";
      return `<div class="pill-tile ${state}">${f.thumbnail ? `<img src="${esc(f.thumbnail)}" alt="Pill ${i + 1}">` : ""}<b>${esc(short(name, 26))}</b><span>${icon(state === "ok" ? "check" : state === "off" ? "x" : "circle-help")}${label}</span>${identifyOnly && f.accepted ? `<button class="link" data-add-ref="${i}">Add to plan</button>` : ""}</div>`;
    })
    .join("");
  const primary =
    identifyOnly || !expected || evaluation.type === "duplicate"
      ? ""
      : evaluation.type === "flip"
        ? button(`Scan the other side of pill ${evaluation.flip[0] + 1}`, "flip-scan", "dark block pillbtn", "refresh-cw")
        : canLogFromScan
        ? button("Log dose", "log-taken", "dark block pillbtn")
        : ["wrong", "missing"].includes(evaluation.type)
          ? button("Report a problem", "log-concern", "dark block pillbtn", "triangle-alert")
          : button("Log manually", "log-manual", "plain block pillbtn");
  return `<section class="verdict ${tone}" role="status" id="check-result"><p class="eyebrow">${esc(selectedSlot)} dose</p><h2 class="verdict-word">${word}</h2><p class="verdict-sub">${esc(sub)}</p>${tiles ? `<div class="tiles">${tiles}</div>` : ""}${scan.quality?.length ? `<p class="verdict-note">${esc(scan.quality.join(" "))}</p>` : ""}</section>
<div class="actions">${primary}<button class="link quiet center" data-action="retake">Retake</button></div>
<p class="fineprint">Compares appearance only. Check the bottle label.${identifyOnly || ["wrong", "missing"].includes(evaluation.type) ? "" : ` <button class="link inline" data-action="log-concern">Report a problem</button>`}</p>`;
}
// Result photo with HTML brackets that "lock on" to each detected pill in turn.
function lockOn() {
  const w = scan.width || 1,
    h = scan.height || 1,
    src = photoUrl || scan.annotated,
    boxes =
      scan.mode === "single"
        ? ""
        : scan.pills
            .map((f, i) => {
              const b = f.box;
              return `<span class="lock ${f.accepted ? "ok" : "unsure"}" style="left:${((b.x / w) * 100).toFixed(2)}%;top:${((b.y / h) * 100).toFixed(2)}%;width:${((b.width / w) * 100).toFixed(2)}%;height:${((b.height / h) * 100).toFixed(2)}%;animation-delay:${(i * 0.22).toFixed(2)}s"><span class="lock-tag">${i + 1}${f.accepted ? " ✓" : " ?"}</span></span>`;
            })
            .join("");
  // Boxes are placed in a frame with the photo's exact shape, so they line up with
  // the pills however the photo area around it is sized.
  return `<div class="viewfinder shot lockon" style="aspect-ratio:${w}/${h};width:min(100%, calc(52vh * ${(w / h).toFixed(3)}))"><div class="lock-frame" style="--r:${(w / h).toFixed(4)}"><img src="${esc(src)}" alt="Scanned photo with ${scan.pills.length} detected pill${scan.pills.length === 1 ? "" : "s"}">${boxes}</div></div>`;
}
// Shown on the idle Scan screen while the one-time model download is running.
function modelStatusHtml() {
  if (modelStatus.state !== "loading") return "";
  const pct = Math.min(99, Math.round((modelStatus.loaded / modelStatus.total) * 100));
  return `<div class="section notice blue model-status" id="model-status" role="status"><div class="grow"><b>Getting the scan model ready</b><p id="model-status-text">${esc(modelStatus.message)}</p><progress max="100" value="${modelStatus.loaded ? pct : 0}" aria-label="Model download"></progress><p class="small muted">One-time download. It stays on this device afterward.</p></div></div>`;
}
// Camera-first scan screen: the viewfinder is the page. Dose time and samples
// live in sheets so the screen holds only a viewfinder and one row of controls.
function checkPage() {
  const p = patient(),
    meds = dosesFor(p, selectedSlot),
    inputs = `<input id="dose-photo" type="file" accept="image/*" capture="environment"><input id="dose-library" type="file" accept="image/*">`;
  if (scan && !scanBusy)
    return `${inputs}<div class="result-b"><button class="close-b" data-action="retake" aria-label="Close result">${icon("x")}</button>${lockOn()}<div class="sheet reveal" style="animation-delay:${Math.min(1, 0.2 + scan.pills.length * 0.2).toFixed(2)}s">${resultHtml(meds)}</div></div>`;
  const planned = flipTarget !== null
      ? "Both sides together give a surer answer"
      : meds.length
        ? meds.map((m) => `${esc(m.name)}${m.quantity > 1 ? ` ×${m.quantity}` : ""}`).join(" · ")
        : "Nothing planned for this time",
    flipping = flipTarget !== null,
    chip = flipping
      ? `<span class="slot-chip">Pill ${flipTarget + 1} · other side</span>`
      : `<button class="slot-chip" data-action="pick-slot" aria-label="Change dose time, now ${selectedSlot}">${selectedSlot} dose${isTaken(p, selectedSlot) ? " · logged" : ""}${icon("chevron-right")}</button>`,
    close = flipping
      ? `<button class="close-b" data-action="cancel-flip" aria-label="Back to the result">${icon("x")}</button>`
      : `<button class="close-b" data-page="today" aria-label="Close scanner">${icon("x")}</button>`,
    upload = `<label class="side-action" for="dose-library"><span class="ico">${icon("image-up")}</span>Upload</label>`,
    mode = `<button class="side-action" data-mode="${scanMode === "dose" ? "single" : "dose"}" aria-label="Switch to ${scanMode === "dose" ? "one pill" : "several pills"}"><span class="ico">${icon(scanMode === "dose" ? "grid-3x3" : "pill")}</span>${scanMode === "dose" ? "Several" : "One pill"}</button>`;
  let stage, controls, extra = "";
  if (cameraStream) {
    stage = `<video id="camera-video" autoplay playsinline muted aria-label="Live camera preview"></video><canvas id="camera-overlay" aria-hidden="true"></canvas><span class="camera-status" id="camera-status" role="status" aria-live="polite">Starting camera…</span>`;
    controls = `<div class="shutter-row">${upload}<button class="shutter" data-action="capture-live" aria-label="Capture and scan">${icon("camera")}</button><button class="side-action" data-action="stop-camera"><span class="ico">${icon("x")}</span>Stop</button></div>`;
  } else if (scanBusy || photoUrl) {
    stage = `${photoUrl ? `<img src="${esc(photoUrl)}" alt="Photo being scanned">` : ""}<span class="sweep" aria-hidden="true"></span>${scanBusy ? `<span class="camera-status" id="scan-progress" role="status" aria-live="polite">Checking pills…</span>` : ""}`;
    controls = scanBusy
      ? ""
      : `<p class="cam-error">${esc(scanProgress || "Something went wrong.")}</p><div class="actions">${button("Try again", "scan-photo", "dark block pillbtn")}<button class="link quiet center" data-action="retake">Retake</button></div>`;
  } else {
    stage = `<span class="hint">${icon(flipping ? "refresh-cw" : "camera")}<b>${flipping ? `Turn pill ${flipTarget + 1} over and fill the frame with its other side` : p.demo ? "Tap the shutter to scan a sample" : scanMode === "single" ? "Fill the frame with one pill" : "Spread the pills on a plain surface"}</b></span>`;
    const demoShot = p.demo && (!flipping || flipBack);
    controls = `<div class="shutter-row">${upload}<button class="shutter" data-action="${demoShot ? "demo-scan" : "start-camera"}" aria-label="${demoShot ? "Scan a sample photo" : "Start camera"}">${icon("camera")}</button>${flipping ? '<span class="side-action" aria-hidden="true"></span>' : mode}</div>`;
    extra = `${p.demo && !flipping ? `<button class="link quiet" data-action="samples">No pills? Try a sample</button>` : ""}${modelStatusHtml()}${cameraError ? `<div class="section notice orange"><div><b>${esc(cameraError)}</b><br><label class="link" for="dose-photo">Use the device camera instead</label></div></div>` : ""}`;
  }
  const fit = !cameraStream && photoUrl && photoAspect,
    fitStyle = fit ? ` style="aspect-ratio:${photoAspect.toFixed(4)};width:min(100%, calc(60vh * ${photoAspect.toFixed(4)}))"` : "";
  return `${inputs}<div class="cam"><div class="viewfinder cam-view${cameraStream ? " camera-live" : ""}${scanBusy ? " scanning" : ""}${fit ? " fit" : ""}"${fitStyle}${!cameraStream && !photoUrl ? ' id="dropzone"' : ""}>${stage}<span class="corners"></span>${close}${scanBusy ? "" : chip}</div><p class="cam-planned">${planned}</p>${controls}${extra}</div>`;
}
function slotSheet() {
  const p = patient();
  openDialog(
    dialogHead("Which dose?") +
      `<div class="list">${SLOTS.map((s) => `<button class="row" data-pick-slot="${s}"><span class="grow"><span class="row-title">${s}</span><br><span class="row-sub">${esc(short(dosesFor(p, s).map((m) => m.name).join(", ") || "Nothing planned", 44))}</span></span>${isTaken(p, s) ? '<span class="tag green">Logged</span>' : ""}${s === selectedSlot ? `<span class="picked">${icon("check")}</span>` : ""}</button>`).join("")}</div>`,
  );
  document.querySelectorAll("#modal [data-pick-slot]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedSlot = b.dataset.pickSlot;
        observations = {};
        $("#modal").close();
        render();
      }),
  );
}
function samplesSheet() {
  openDialog(
    dialogHead("Try a sample") +
      `<div class="list"><button class="row" data-pick-sample="correct"><span class="ico-tile t-green">${icon("check")}</span><span class="grow"><span class="row-title">Correct dose</span><br><span class="row-sub">Two pills that match the morning plan</span></span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-pick-sample="wrong"><span class="ico-tile t-orange">${icon("triangle-alert")}</span><span class="grow"><span class="row-title">Wrong pill</span><br><span class="row-sub">A pill that isn’t in the plan</span></span><span class="chev">${icon("chevron-right")}</span></button><button class="row" data-pick-sample="flip"><span class="ico-tile t-blue">${icon("refresh-cw")}</span><span class="grow"><span class="row-title">Needs a flip</span><br><span class="row-sub">Not sure from one side, so check the back</span></span><span class="chev">${icon("chevron-right")}</span></button></div><p class="caption">Real research photos, scanned by the on-device model.</p>`,
  );
  document.querySelectorAll("#modal [data-pick-sample]").forEach(
    (b) =>
      (b.onclick = () => {
        $("#modal").close();
        runSample(b.dataset.pickSample);
      }),
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
    liveBusy = false,
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
      if (now - lastDetection >= 400 && !liveBusy) {
        lastDetection = now;
        const width = Math.min(480, video.videoWidth),
          height = Math.max(
            1,
            Math.round((video.videoHeight * width) / video.videoWidth),
          );
        detectorCanvas.width = width;
        detectorCanvas.height = height;
        detectorContext.drawImage(video, 0, 0, width, height);
        // The pill finder network once the models are loaded; the color-based
        // detector until then.
        liveBusy = true;
        findPillsLive(detectorCanvas)
          .then((found) => found || detectPills(detectorContext.getImageData(0, 0, width, height), { maxSide: 240 }))
          .then((detected) => {
            components = detected.components;
            quality = detected.quality;
          })
          .catch(() => {
            components = [];
            quality = [];
          })
          .finally(() => (liveBusy = false));
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
async function analyzePhoto() {
  if (!photo || scanBusy) return;
  const version = ++scanVersion;
  scanBusy = true;
  scan = null;
  scanProgress = "";
  // Measure the photo first so the scanning frame takes its exact shape.
  if (!photoAspect)
    try {
      const bitmap = await createImageBitmap(photo);
      photoAspect = bitmap.width / bitmap.height;
      bitmap.close();
    } catch {}
  render();
  // Inference blocks the main thread, so make sure the photo is decoded and the
  // scanning view has painted (the sweep animation then runs on the compositor).
  const settle = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
  await settle($(".cam-view > img")?.decode?.().catch(() => {}), 400);
  await settle(new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), 120);
  const started = performance.now();
  try {
    const flipping = flipTarget !== null && baseScan;
    const result = await recognizePhoto(photo, {
      mode: flipping ? "single" : scanMode,
      progress: (message) => {
        if (version !== scanVersion) return;
        scanProgress = message;
        const status = $("#scan-progress");
        if (status) status.textContent = message;
      },
    });
    if (flipping) {
      // Combine the other side with the first photo of the same pill, then show the
      // original photo again with the updated verdict.
      const other = result.pills[0];
      scan = other
        ? { ...baseScan, pills: baseScan.pills.map((p, i) => (i === flipTarget ? fuseSides(p, other) : p)) }
        : baseScan;
      if (!other) toast("Couldn’t see the pill. Try the other side again.");
      if (photoUrl && photoUrl !== basePhotoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = basePhotoUrl;
      flipTarget = null;
      baseScan = null;
      basePhotoUrl = null;
    } else scan = result;
    // Hold the scanning sweep for at least one full pass so it never just flickers.
    const wait = 1400 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (version !== scanVersion) return;
  } catch (e) {
    if (version !== scanVersion) return;
    scanProgress = e.message || "The on-device scan could not finish. Try again.";
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
function family() {
  const p = patient(),
    stats = adherence(p),
    logs = [...p.logs].sort((a, b) => b.at.localeCompare(a.at)),
    streak = streakDays(p);
  return (
    topbar("History", { actions: avatarBtn() }) +
    `<div class="stats"><div class="card stat"><b>${streak}</b><span>Day streak</span></div><div class="card stat"><b>${p.logs.filter((l) => l.status === "taken").length}</b><span>Doses logged</span></div></div>
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
    `<div class="list"><button class="row" data-action="profiles"><span class="avatar">${initials(p.name)}</span><span class="grow"><span class="row-title">${esc(p.name)}</span><br><span class="row-sub">${state.patients.length} ${state.patients.length === 1 ? "person" : "people"} on this device · Switch</span></span><span class="chev">${icon("chevron-right")}</span></button>${p.demo ? `<button class="row" data-action="exit-demo"><span class="ico-tile t-gray">${icon("x")}</span><span class="grow"><span class="row-title">Exit demo</span><br><span class="row-sub">Remove the sample profile and its data</span></span></button>` : ""}</div>
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
      .join("")}</select></label><button class="row" data-action="speak"><span class="ico-tile t-teal">${icon("volume-2")}</span><span class="grow row-title">Read instructions aloud</span><span class="chev">${icon("chevron-right")}</span></button></div><p class="caption">Spoken guidance for checking a dose, in the language above.</p></div>
<div class="section"><div class="section-head"><h2>Your data</h2></div><div class="list"><button class="row" data-action="export"><span class="ico-tile t-blue">${icon("download")}</span><span class="grow row-title">Export a backup</span><span class="chev">${icon("chevron-right")}</span></button><label class="row" for="import-file"><span class="ico-tile t-green">${icon("upload")}</span><span class="grow row-title">Restore from a backup</span><span class="chev">${icon("chevron-right")}</span></label><button class="row" data-action="reset"><span class="ico-tile t-red">${icon("trash-2")}</span><span class="grow row-title" style="color:var(--red)">Erase all data on this device</span></button></div><input id="import-file" type="file" accept="application/json,.json"></div>
<div class="section"><div class="section-head"><h2>About</h2></div><div class="list"><button class="row" data-page="welcome"><span class="ico-tile t-blue">${icon("circle-help")}</span><span class="grow row-title">How PillCheck works</span><span class="chev">${icon("chevron-right")}</span></button>${state.patients.some((x) => x.demo) ? "" : `<button class="row" data-action="start-demo"><span class="ico-tile t-green">${icon("scan-line")}</span><span class="grow row-title">Try the demo</span><span class="chev">${icon("chevron-right")}</span></button>`}</div><p class="caption">Your medication plan stays in this browser. Pill photos are analyzed on this device and aren’t uploaded.</p><p class="caption">Icons: Lucide (ISC). Fonts: DM Sans, Manrope (SIL OFL). This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.</p></div>`
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
function medicationForm(id, prefill = {}) {
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
    ...prefill,
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
// Sample profile for trying a scan without real medication. The NDCs match the
// bundled /examples photos (held-out ePillID research images).
const SAMPLE_PHOTOS = {
  correct: { file: "dose-two.jpg", mode: "dose", slot: "Morning" },
  wrong: { file: "pill-4.jpg", mode: "single", slot: "Morning" },
  flip: { file: "flip-front.jpg", back: "flip-back.jpg", mode: "single", slot: "Bedtime" },
};
function demoPatient() {
  const back = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d;
    },
    med = (name, strength, color, shape, imprint, manufacturer, ndc, slots) => ({
      id: uid(),
      name,
      strength,
      quantity: 1,
      color,
      shape,
      imprint,
      manufacturer,
      slots,
      rx: null,
      startDate: dayKey(back(7)),
      ndc,
      pillId: null,
    }),
    meds = [
      med("Pancrelipase", "Lipase 5,000 units", "White", "Capsule", "PAN 5", "", "39822-0205", ["Morning"]),
      med("Lovastatin", "20 mg", "Blue", "Round", "TEVA", "Teva", "00093-0576", ["Morning"]),
      med("Metoprolol tartrate", "50 mg", "Pink", "Round", "93 733", "Teva", "00093-0733", ["Evening"]),
      { ...med("Simvastatin", "10 mg", "Pink", "Round", "7153 / TV", "Teva", "00093-7153", ["Bedtime"]), startDate: dayKey() },
    ],
    logs = [];
  for (let n = 1; n <= 6; n++)
    for (const [slot, hour] of [["Morning", 8], ["Evening", 19]]) {
      if (n === 3 && slot === "Evening") continue;
      const at = back(n);
      at.setHours(hour, 5, 0, 0);
      logs.push({
        id: uid(),
        day: dayKey(at),
        slot,
        status: "taken",
        at: at.toISOString(),
        note: "Logged after a scan",
        medications: meds
          .filter((m) => m.slots.includes(slot))
          .map((m) => ({ name: m.name, strength: m.strength, quantity: m.quantity })),
        observations: {},
        recognition: null,
      });
    }
  return { id: "sample-demo", name: "Demo", demo: true, meds, logs, refills: [] };
}
function startDemo() {
  let demo = state.patients.find((x) => x.demo);
  if (!demo) {
    demo = demoPatient();
    state.patients.push(demo);
  }
  state.active = demo.id;
  state.onboarded = true;
  resetCheck();
  save();
  if ($("#modal").open) $("#modal").close();
  nav("today");
  toast("Demo loaded. Tap Scan a dose to try a sample.");
}
function exitDemo() {
  state.patients = state.patients.filter((x) => !x.demo);
  state.active = state.patients[0]?.id || null;
  if (!state.patients.length) state.onboarded = false;
  resetCheck();
  save();
  nav(state.patients.length ? "today" : "welcome");
}
async function runSample(key) {
  const sample = SAMPLE_PHOTOS[key];
  if (!sample) return;
  try {
    const res = await fetch("/examples/" + sample.file);
    if (!res.ok) throw Error();
    resetCheck();
    selectedSlot = sample.slot;
    scanMode = sample.mode;
    flipBack = sample.back || null;
    setPhoto(await res.blob());
  } catch (error) {
    console.error("Sample scan failed", error);
    toast("Couldn’t load the sample. Make sure PillCheck is still running, then try again.");
  }
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
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Full-screen moment after a dose is logged (Duolingo-style streak screen).
function celebrate(slot, streakBefore, streakNow, palette = []) {
  const el = document.createElement("div"),
    time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  el.className = "celebrate";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Dose logged");
  el.innerHTML = `<div class="celebrate-card">${seal("check", 112)}<h1>Logged.</h1><p>${esc(slot)} dose · ${esc(time)}</p>${streakNow ? `<p class="celebrate-streak">${icon("flame")}<span><b id="streak-count">${streakBefore}</b>-day streak</span></p>` : ""}<button class="btn dark block celebrate-done">Done</button></div>`;
  document.body.append(el);
  navigator.vibrate?.([18, 50, 28]);
  const close = () => {
    el.classList.add("leaving");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => el.remove(), reducedMotion() ? 0 : 220);
    $("#main")?.focus({ preventScroll: true });
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  el.querySelector(".celebrate-done").onclick = close;
  el.onclick = (e) => e.target === el && close();
  el.querySelector(".celebrate-done").focus();
  const counter = el.querySelector("#streak-count");
  if (counter && streakNow > streakBefore)
    setTimeout(() => {
      counter.textContent = streakNow;
      counter.classList.add("bump");
    }, reducedMotion() ? 0 : 900);
}
function logDose(status, method = "scan") {
  const p = patient(),
    loggedSlot = selectedSlot,
    streakBefore = streakDays(p);
  if (status === "taken" && !dosesFor(p, selectedSlot).length) {
    toast("No medication is scheduled for this period.");
    return;
  }
  if (status === "taken" && method === "scan") {
    const evaluation = scan && evaluateScan(p, selectedSlot, scan, { day: dayKey() });
    if (evaluation?.type !== "matched") {
      toast("The scan did not match every planned pill. Review it or log manually.");
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
  if (status === "taken")
    celebrate(
      loggedSlot,
      streakBefore,
      streakDays(p),
      dosesFor(p, loggedSlot).map((m) => colors[m.color] || colors.White),
    );
  else toast("Problem saved to history.");
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
  el.innerHTML = `<h1>PillCheck · Weekly care record</h1><p>${esc(p.name)} · Generated ${esc(new Date().toLocaleString())}</p><p>${stats.taken} of ${stats.expected} scheduled periods self-reported taken. Today counts periods through ${currentSlot()}.</p><h2>Current medication plan</h2><table><thead><tr><th>Medication</th><th>Strength</th><th>Quantity</th><th>Periods</th></tr></thead><tbody>${p.meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.strength)}</td><td>${m.quantity}</td><td>${m.slots.join(", ")}</td></tr>`).join("")}</tbody></table><h2>Past seven days</h2><table><thead><tr><th>Date</th><th>Period</th><th>Reported status</th><th>Note</th></tr></thead><tbody>${logs.map((l) => `<tr><td>${esc(l.day)}</td><td>${esc(l.slot)}</td><td>${esc(l.status)}</td><td>${esc(l.note)}</td></tr>`).join("")}</tbody></table><h2>Refill notes</h2>${
    p.refills
      .filter((r) => r.at.slice(0, 10) >= dayKey(cutoff))
      .map((r) => `<p>${esc(r.name)}: ${esc(r.note)}</p>`)
      .join("") || "<p>No refill notes this week.</p>"
  }<p>Self-reported record from PillCheck.</p>`;
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
  photoAspect = 0;
  analyzePhoto();
}
function bind() {
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        if (page === "check") resetCheck();
        if (b.dataset.page === "check") selectedSlot = currentSlot();
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
  document.querySelectorAll("[data-add-ref]").forEach(
    (b) =>
      (b.onclick = () => {
        const ref = referenceFor(scan?.pills[Number(b.dataset.addRef)]),
          label = ref?.label;
        medicationForm(undefined, {
          name: label?.name ? short(label.name, 80) : "",
          strength: label?.strength || "",
          ndc: ref?.ndc || "",
          manufacturer: label?.manufacturer || "",
        });
      }),
  );
  document
    .querySelectorAll("[data-sample]")
    .forEach((b) => (b.onclick = () => runSample(b.dataset.sample)));
  const actions = {
    "start-demo": startDemo,
    "demo-scan": async () => {
      if (flipTarget === null || !flipBack) return runSample("correct");
      try {
        const res = await fetch("/examples/" + flipBack);
        if (!res.ok) throw Error(res.status);
        setPhoto(await res.blob());
      } catch (error) {
        console.error("Flip sample failed", error);
        toast("Couldn’t load the sample. Make sure PillCheck is still running, then try again.");
      }
    },
    "flip-scan": () => {
      const ev = scan && evaluateScan(patient(), selectedSlot, scan, { day: dayKey() });
      if (ev?.type !== "flip") return;
      flipTarget = ev.flip[0];
      baseScan = scan;
      basePhotoUrl = photoUrl;
      scan = null;
      photo = null;
      photoUrl = null;
      photoAspect = 0;
      render();
      window.scrollTo(0, 0);
    },
    "cancel-flip": () => {
      stopCamera();
      if (photoUrl && photoUrl !== basePhotoUrl) URL.revokeObjectURL(photoUrl);
      scan = baseScan;
      photoUrl = basePhotoUrl;
      flipTarget = null;
      baseScan = null;
      basePhotoUrl = null;
      render();
    },
    "pick-slot": slotSheet,
    samples: samplesSheet,
    "exit-demo": exitDemo,
    "start-check": () => {
      resetCheck();
      selectedSlot =
        SLOTS.find(
          (s) => dosesFor(patient(), s).length && !isTaken(patient(), s),
        ) || currentSlot();
      nav("check");
    },
    profiles: profilesSheet,
    "back-to-app": () => {
      page = state.patients.length ? "today" : "welcome";
      render();
    },
    "toggle-theme": () => {
      state.theme = isDark() ? "light" : "dark";
      save();
      render();
    },
    retake: () => {
      resetCheck();
      render();
      if (!patient().demo) startCamera();
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
// Update the status card in place; a full render would reset the page mid-download.
let lastModelState = modelStatus.state;
onModelStatus((s) => {
  const card = $("#model-status");
  if (s.state !== lastModelState) {
    lastModelState = s.state;
    if (page === "check" && !scan && !scanBusy && !photoUrl && !cameraStream) return render();
  }
  if (!card) return;
  $("#model-status-text").textContent = s.message;
  const bar = card.querySelector("progress");
  if (bar && s.loaded) bar.value = Math.min(99, Math.round((s.loaded / s.total) * 100));
});
render();
// Start the one-time model download as soon as the app opens, unless Data Saver is on.
if (!navigator.connection?.saveData)
  setTimeout(() => loadRecognition().catch(() => {}), 300);
