# PillCheck

**Double-check every dose with a live camera.** PillCheck draws live object outlines in the browser and sends a compressed photo to NVIDIA’s GLM-5.3-Flash endpoint for a visual suggestion. The model does not verify pill identity against a prescription plan.

This is a research prototype, not a clinically validated medication identifier. Treat every AI result as uncertain and check each pill against its pharmacy label or with a pharmacist.
## Run

Node.js 22 or newer:

```sh
npm ci
NVIDIA_API_KEY=your_key_here npm start
```

Set `NVIDIA_API_KEY` in the server environment. Never put the key in browser code or commit it to the repository. Open **http://localhost:4173**. On Windows, double-click **Start PillCheck.cmd**; on macOS, double-click **Start PillCheck.command**. Use `PORT=4180 npm start` for another port.

**Use a phone:** start the server with `HOST=0.0.0.0 npm start` and open `http://<this-computer's-IP>:4173` on the same Wi-Fi. Live camera access and PWA installation need HTTPS or `localhost`.

## Scan a photo

1. Open **Check a dose** and start the live camera, or choose **Upload**.
2. Live outlines run locally. Capturing or selecting a photo resizes it and sends a JPEG to NVIDIA GLM-5.3-Flash. NVIDIA’s trial service may log prompts and images; avoid including labels, faces, or personal documents.
3. Review the visual suggestion, then compare every pill with its pharmacy label and saved plan. The model output is unverified and cannot authorize a dose. Confirm manually before logging.

## What the scan actually does

- **Live outlines:** browser-based background segmentation, morphology, and connected components. It can mistake other objects for pills or miss touching pills.
- **Visual suggestion:** the server proxies the photo to NVIDIA’s `z-ai/glm-5.3-flash` chat endpoint. The model may describe appearance, transcribe a visible imprint, or suggest possibilities; there is no automatic identity-to-plan match.
- **Limits:** GLM can misread an imprint or invent an identity. It is not a clinical pill identifier, chemical assay, counterfeit check, or proof of a current product’s appearance.
- **Privacy:** the browser resizes photos and converts them to JPEG before upload. PillCheck does not persist the image. NVIDIA’s trial endpoint may log prompts and images for operation and improvement; review its [model privacy details](https://build.nvidia.com/z-ai/glm-5-3-flash/modelcard).
- **Retained model:** the DINOv2 weights and evaluation report in `public/models/` remain for research history, but the app does not load or call that model.

## Retained model evaluation

The report in [`public/models/evaluation.json`](public/models/evaluation.json) measures the bundled DINOv2 model only. Those figures do not measure GLM-5.3-Flash and are not current app accuracy.
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
- Dose logging requires a manual confirmation against the pharmacy label and saved plan.
- Manual 7×1, 7×2, and 7×4 organizer review, preparation notes, and refill-change notes.
- Local caregiver view, self-reported logging history/trends, correction of mistaken records, and printable weekly reports. Use the system print dialog's **Save as PDF**.
- Larger text, keyboard controls, and browser read-aloud guidance in English, Spanish, and Mandarin; visual UI remains English.
- JSON backup export/import and reset.

Morning is 00:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, and bedtime 21:00–23:59 in device local time. These are broad prototype buckets, not prescription-specific exact times. Liquid, PRN, tapered, alternate-day, and fractional-pill regimens are unsupported.

## What is still not implemented

Bottle OCR/barcode scanning; automated imprint OCR; arbitrary organizer detection; validated look-alike sensitivity; remote caregiver accounts, sync, and alerts; native mobile packaging; clinical validation; and a conformal/clinical error guarantee. Phone hardware performance has not been formally measured.

## Data and privacy

Plans and logs are stored unencrypted in browser localStorage. Someone using the same browser profile can read them, and storage can be cleared. Export backups carefully. Each selected photo is resized in the browser and sent through the PillCheck server to NVIDIA GLM-5.3-Flash. PillCheck does not persist photos, but NVIDIA’s trial endpoint may log inputs and outputs. User-triggered medication search sends the entered name/NDC to NLM; browser speech may process spoken text externally. There is no analytics service or remote patient database.

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
server.mjs                 Static server, NVIDIA image proxy, RxNorm proxy
vision/                    Training (train_finetune.py = v2), export checks, metadata scripts
models/split.json          Exact image split used for training and evaluation
tests/                     Logic, detector, inference, and server checks
```

## Attribution and license

Reference data: [ePillID benchmark](https://github.com/usuyama/ePillID-benchmark), derived from NIH NLM Pillbox and the Pill Image Recognition Challenge. The dataset is released for research purposes. Reference images and trained artifacts are research materials; the app's MIT license does not override their original conditions. Public name metadata comes from the [openFDA NDC directory](https://open.fda.gov/apis/drug/ndc/) and [NLM RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html). Historical products may be discontinued; not every reference has an available name.

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Code: MIT. Fonts: SIL OFL. ONNX Runtime and pretrained encoder components retain their upstream licenses; DINOv2 is Apache 2.0. See `docs/` for notices.
