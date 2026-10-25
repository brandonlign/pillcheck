# PillCheck

**Double-check every dose with one photo.** PillCheck finds separate pills and compares their appearances with saved bottle references. It marks uncertain matches instead of guessing.

Research prototype, not a medical device.

## Run

Node.js 22 or newer:

```sh
npm ci
npm start
```

Open **http://localhost:4173**. On Windows, double-click **Start PillCheck.cmd**; on macOS, double-click **Start PillCheck.command**. Use `PORT=4180 npm start` for another port.

**Use a phone:** start the server with `HOST=0.0.0.0 npm start` and open `http://<this-computer's-IP>:4173` on the same Wi-Fi. Live camera access and PWA installation need HTTPS or `localhost`.

## How a scan works

1. Open **Scan**, pick the dose time, and start the live camera or upload a photo. Live outlines are drawn in the browser.
2. The browser separates pill-shaped regions and compares each crop with the on-device reference model. Photos are not sent to a recognition service. The first scan downloads the model files; the service worker caches them for later use.
3. PillCheck compares accepted reference matches and detected counts with the saved bottle NDCs and quantities. Low-confidence or unmatched results are marked uncertain. The model compares appearance; it does not read imprints.

The shipped DINOv2 reference model was evaluated on 960 held-out ePillID photos: top-1 NDC retrieval was 72.4%, and 434 of 471 matches accepted by its strict threshold were correct (92.1%). These are cropped research photos, not an end-to-end evaluation on household dose scenes; see [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md).
## Interface

The UI is modelled on the patterns shared by the best-rated apps in this space, studied from their App Store screens: **Medisafe** (4.7★, 102K ratings), **MyTherapy** (4.8★), Apple Health Medications, the Apple Design Award winner **Streaks** (4.8★), **Duolingo** (4.7★, 5.5M ratings) and top medication-app concepts on Dribbble.

- **Today:** large title, a week strip with a progress ring per day, a summary ring with a day streak (Streaks/Duolingo), and doses grouped by time of day with colored pill icons and round check circles (MyTherapy/Medisafe).
- **Scan:** a camera viewfinder with corner brackets and a shutter button, a live step checklist while it works, then one big result card with a single next action.
- **Medications and Settings:** iOS-style grouped lists. **History:** big-number stats and weekly bars. Forms open as bottom sheets.
- **Navigation:** a bottom tab bar with a raised Scan button on phones, and a sidebar on tablets and desktops.
- **Tactile buttons** with a raised bottom edge (Duolingo), iOS semantic colors in light and dark, 44 px+ touch targets, and a *Larger text* setting that scales everything.
- **Assets:** [Lucide](https://lucide.dev) icons (ISC) and [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) 3D illustrations (MIT), bundled locally by `scripts/fetch_ui_assets.py` so the app works offline (169 KB total).

## Other working features

- Separate local care profiles; add/edit/delete medication plans and appearance notes.
- Live RxNorm name/NDC lookup, with manual label entry if unavailable.
- Per-pill scan results with count and reference-NDC matching against the saved plan.
- Manual 7×1, 7×2, and 7×4 organizer review, preparation notes, and refill-change notes.
- Local caregiver view, self-reported logging history/trends, correction of mistaken records, and printable weekly reports. Use the system print dialog's **Save as PDF**.
- Larger text, keyboard controls, and browser read-aloud guidance in English, Spanish, and Mandarin; visual UI remains English.
- JSON backup export/import and reset.

Morning is 00:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, and bedtime 21:00–23:59 in device local time. These are broad prototype buckets, not prescription-specific exact times. Liquid, PRN, tapered, alternate-day, and fractional-pill regimens are unsupported.

## What is still not implemented

Bottle barcode scanning; arbitrary organizer detection; an end-to-end accuracy study on real dose photos; validated look-alike sensitivity; remote caregiver accounts, sync, and alerts; native mobile packaging; clinical validation; and a conformal/clinical error guarantee. Phone hardware performance has not been formally measured.

## Data and privacy

Plans and logs are stored unencrypted in browser localStorage. Export backups carefully. Pill photos are analyzed on the device and are not uploaded or saved. Optional medication lookup sends the entered name/NDC to NLM. PillCheck does not run analytics or tracking and has no remote patient database.

Logging is self-reported and does not prove swallowing. Historical schedule edits can change past chart denominators; dates before a newly added medication's start date are excluded. Use one active entry tab; localStorage is not a transactional multi-user database.

## Development

```sh
npm test
```

GitHub Actions installs the pinned runtime dependency, runs the tests, and checks syntax. Tests cover detection, reference ranking, NDC matching, unknown/extra/wrong pills, quality flags, dose gating, schedules, backups, and serving. They do not establish clinical accuracy.

To reproduce model training, use Python 3.12, `vision/requirements-lock.txt`, the public ePillID release, the fixed split/seed, and the scripts described in [docs/MODEL_CARD.md](docs/MODEL_CARD.md). Python and dataset downloads are development-only.

```text
public/recognition.js       Retained browser ONNX inference (inactive in app)
public/recognition-core.js  Live detector and retained model helpers
public/models/             Trained weights, gallery, references, measured report
public/examples/           Real held-out photos and synthetic scene provenance
public/app.js              App UI and local care workflows
public/icons.js            Lucide icon paths (generated by scripts/fetch_ui_assets.py)
public/img/                Fluent Emoji 3D illustrations (MIT)
public/sw.js               Offline cache (app shell network-first, model cache-first)
public/core.js             Schedule/record and legacy guided-review rules
server.mjs                 Static server and RxNorm proxy
analysis.mjs               Legacy detection-response parser tests
vision/                    Training (train_finetune.py = v2), export checks, metadata scripts
models/split.json          Exact image split used for training and evaluation
tests/                     Logic, detector, inference, and server checks
```

## Attribution and license

Reference data: [ePillID benchmark](https://github.com/usuyama/ePillID-benchmark), derived from NIH NLM Pillbox and the Pill Image Recognition Challenge. The dataset is released for research purposes. Reference images and trained artifacts are research materials; the app's MIT license does not override their original conditions. Public name metadata comes from the [openFDA NDC directory](https://open.fda.gov/apis/drug/ndc/) and [NLM RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html). Historical products may be discontinued; not every reference has an available name.

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Code: MIT. Fonts: SIL OFL. ONNX Runtime and pretrained encoder components retain their upstream licenses; DINOv2 is Apache 2.0. See `docs/` for notices.
