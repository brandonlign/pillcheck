# PillCheck

A local-first medication double-check app with **automated pill detection and image recognition**.

A photo is processed in the browser: the detector finds separated pills, a trained neural metric model compares each crop with 9,804 reference images across 4,902 research identities, and the app compares detected references/counts with a saved prescription plan. Weak or ambiguous matches return **not sure**. Users do not enter pill counts or tick appearance-match boxes in the photo flow.

This is a research prototype, not a clinically validated medication identifier. Read the measured evaluation and limitations below before using it.

## Run

Node.js 22 or newer:

```sh
npm ci
npm start
```

Open **http://localhost:4173**. On macOS, double-click **Start PillCheck.command**; it installs the browser runtime if missing, starts the server, and opens the app. Keep Terminal open. Control-C stops it. Use `PORT=4180 npm start` for another port.

The trained ONNX weights, embeddings, reference thumbnails, and offline names are included. **No API key, cloud inference account, Python installation, or training run is needed to use the app.** After installing the package, photo recognition needs no internet connection. Optional medication-name lookup uses RxNorm.

## Try automated recognition

1. Open **Dose check**.
2. Click **Try a real test image** or **Try a two-pill scene**. This opens a separate, explicitly labeled sample plan, preserves personal profiles, loads a real held-out image or a synthetic composite of held-out images, and runs the actual model. No predictions are hardcoded. Example selection is documented in `public/examples/manifest.json`; examples are illustrative and are not a random evaluation sample.
3. Inspect detection boxes, reference photographs, closest alternatives, similarity scores, and the plan comparison.
4. Try your own photo. For several pills, separate them on a plain, contrasting mat with clear lighting. For one already-cropped pill image, select **One pill, close-up**.
5. Add medications from your prescription and enter each exact bottle **NDC**. A medication name and strength alone do not establish a manufacturer-specific appearance. A candidate can be connected to a saved medication only after checking the NDC on the bottle.

The model always searches the full reference gallery, rather than assuming every detected pill must be one of the expected medications. A dose can match only when every detected region passes the score/margin gate and its product NDC and count match the plan. Unknown objects, quality flags, unexpected pills, duplicate logs, and wrong time periods block confirmation. A matching result is still fallible and is not advice to take an unfamiliar pill.

## What the recognizer actually does

- **Detection:** browser-based background segmentation, morphology, and connected components. It counts separated foreground regions; this is not a trained YOLO instance-segmentation model. Touching pills, hands, textured surfaces, shadows, or organizer dividers can break detection. The app flags some problematic regions but cannot detect every failure.
- **Recognition:** pretrained image encoder plus a pill-specific trained 256-dimensional metric head. Normalized embeddings are compared with both sides of reference pills. Training scripts evaluate multiple encoders; the selected encoder and model ID are in `public/models/evaluation.json` and `catalog.json`.
- **Identity:** a possible match to a historical research product NDC, with an offline public name where available. The 4,902 dataset identities represent 4,826 distinct normalized labeler/product NDCs. Package variants of the same product are merged for plan comparison. A catalog match is not a chemical assay, counterfeit check, or proof of the current product's appearance.
- **Abstention:** a similarity and runner-up-margin gate selected on held-out calibration data. Scores are not probabilities. This is **not conformal prediction**, a 99% guarantee, or proof of safety on arbitrary photos.
- **Privacy:** ONNX Runtime Web runs locally. Images, crops, and inference are not uploaded to the server or a third-party AI service. Offline metadata avoids sending inferred medication identities to external services.

## Measured performance

The committed report in [`public/models/evaluation.json`](public/models/evaluation.json) contains actual measurements: 11,783 training images, 789 calibration images, and 960 held-out consumer test images. It reports overall top-1/top-3 retrieval and the number/correctness of accepted predictions. The split is **image-held-out, not pill-identity-held-out**; it does not establish recognition of unseen types. Test photos are already cropped, whereas dose photos also depend on the separate detector. Known-pill benchmark accuracy does not measure open-world rejection or end-to-end medication safety.

The similarity gate is selected on calibration images only; the test set is not used to select thresholds. Correct accepted test images are then chosen for the illustrative examples, so those examples must not be presented as a representative accuracy study. See [docs/MODEL_CARD.md](docs/MODEL_CARD.md).

## Other working features

- Separate local care profiles; add/edit/delete medication plans and appearance notes.
- Live RxNorm name/NDC lookup, with manual label entry if unavailable.
- Duplicate-period logging protection; time-period, count, uncertainty, and unexpected-reference outcomes.
- Manual 7×1, 7×2, and 7×4 organizer review, preparation notes, and refill-change notes.
- Local caregiver view, self-reported logging history/trends, correction of mistaken records, and printable weekly reports. Use the system print dialog's **Save as PDF**.
- Larger text, keyboard controls, and browser read-aloud guidance in English, Spanish, and Mandarin; visual UI remains English.
- JSON backup export/import and reset.

Morning is 00:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, and bedtime 21:00–23:59 in device local time. These are broad prototype buckets, not prescription-specific exact times. Liquid, PRN, tapered, alternate-day, and fractional-pill regimens are unsupported.

## What is still not implemented

Bottle OCR/barcode scanning; automated imprint OCR; arbitrary organizer detection; validated look-alike sensitivity; remote caregiver accounts, sync, and alerts; native mobile packaging; clinical validation; and a conformal/clinical error guarantee. The local server binds to this computer; another phone needs a future HTTPS deployment. Mobile layout and browser inference are implemented, but phone hardware performance has not been measured.

## Data and privacy

Plans and logs are stored unencrypted in browser localStorage. Someone using the same browser profile can read them, and storage can be cleared. Export backups carefully. Photos stay in tab memory and are discarded when leaving the check or closing the tab. Logs contain lightweight prediction evidence, not photographs. User-triggered medication search sends the entered name/NDC to NLM; browser speech may process spoken text externally. There is no analytics service or remote patient database.

Logging is self-reported and does not prove swallowing. Historical schedule edits can change past chart denominators; dates before a newly added medication's start date are excluded. Use one active entry tab; localStorage is not a transactional multi-user database.

## Development

```sh
npm test
```

GitHub Actions installs the pinned runtime dependency, runs the tests, and checks syntax. Tests cover detection, reference ranking, NDC matching, unknown/extra/wrong pills, quality flags, dose gating, schedules, backups, and serving. They do not establish clinical accuracy.

To reproduce model training, use Python 3.12, `vision/requirements-lock.txt`, the public ePillID release, the fixed split/seed, and the scripts described in [docs/MODEL_CARD.md](docs/MODEL_CARD.md). Python and dataset downloads are development-only.

```text
public/recognition.js       Browser ONNX inference, crops, annotated results
public/recognition-core.js  Detector, ranking, product-NDC and dose rules
public/models/             Trained weights, gallery, references, measured report
public/examples/           Real held-out photos and synthetic scene provenance
public/app.js              App UI and local care workflows
public/core.js             Schedule/record and legacy guided-review rules
server.mjs                 Local static server, runtime assets, RxNorm proxy
vision/                    Training, evaluation, metadata provenance scripts
models/split.json          Exact image split used for training and evaluation
tests/                     Logic, detector, inference, and server checks
```

## Attribution and license

Reference data: [ePillID benchmark](https://github.com/usuyama/ePillID-benchmark), derived from NIH NLM Pillbox and the Pill Image Recognition Challenge. The dataset is released for research purposes. Reference images and trained artifacts are research materials; the app's MIT license does not override their original conditions. Public name metadata comes from the [openFDA NDC directory](https://open.fda.gov/apis/drug/ndc/) and [NLM RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html). Historical products may be discontinued; not every reference has an available name.

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Code: MIT. Fonts: SIL OFL. ONNX Runtime and pretrained encoder components retain their upstream licenses; DINOv2 is Apache 2.0. See `docs/` for notices.
