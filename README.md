# PillCheck

**Double-check every dose with one photo.** PillCheck finds each pill in a photo, recognizes it on your device, and checks it against the medicines planned for that dose. When it isn't confident, it says "Not sure" instead of guessing.

PillCheck is a research prototype, not a medical device.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open **http://localhost:4173**. On Windows you can double-click **Start PillCheck.cmd**, and on macOS **Start PillCheck.command**. Set `PORT=4180` to use another port.

**On a phone:** run `HOST=0.0.0.0 npm start` and open `http://<this-computer's-IP>:4173` on the same Wi-Fi. The live camera and installing the app need HTTPS or `localhost`.

**No pills handy?** Choose **Try the demo** on the welcome screen. It loads a sample plan and two real photos, one correct dose and one wrong pill, and runs them through the same on-device model.

## How a scan works

1. Open **Scan**, pick the dose time, and point the camera at the pills or upload a photo.
2. The **pill finder** (`public/models/pill-finder.onnx`, 3.7 MB) outlines every pill and splits pills that touch. On plain surfaces, a color-based detector picks up anything it missed.
3. Each pill is cropped and compared with about 4,900 prescription pill types from the NIH ePillID library. Everything runs in the browser. Photos are never uploaded, and the model files are cached after the first scan so it works offline.
4. PillCheck compares the recognized pills and the count with the medicines and quantities saved for that dose. A pill that isn't a confident match can be flipped and scanned on its other side, and both sides are combined.

Pills outside the library, including most store-brand and over-the-counter pills (Tylenol, ibuprofen, vitamins), are still found and outlined, but they're shown as "Not sure".

## Accuracy

**Recognition.** The DINOv2-based reference model was tested on 960 held-out ePillID photos. Its first guess was right 73.0% of the time and the right pill was in its top 3 85.2% of the time. A match is only accepted when the score, the lead over the runner-up, and at least two of four rotations all agree. 287 of the 292 accepted matches were correct (**98.3%**).

**Checking against the plan.** In practice the question is narrower: is this pill one of the two or three medicines in this dose? On 359 held-out pills photographed on both sides, with thresholds tuned on one half and scored on the other:

- 67% of correct pills were confirmed (24% from the first photo alone), and every confirmation was the right medicine.
- 100% of random wrong pills were caught.
- 96% of look-alike wrong pills were caught, where the plan held the product the model finds most similar.

The remaining mistakes are mostly the same drug at a different strength, where the only visible difference is a small imprint number. These results come from cropped research photos. Full details are in [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md), and the scripts are `vision/plan_check.py`, `vision/two_sided.py` and `vision/flip_gate.py`.

**Pill finder.** The pill finder was trained on synthetic scenes (`vision/train_segmenter.py`): NIH pill cut-outs placed on photos of marble, wood, counters, cloth, hands and paper, with shadows, uneven light, blur and distractors. On 29 freely licensed real photos from Wikimedia Commons it found separated pills on wood, stone, paper and blister packs, white pills on gray paper, and touching pills. White pills on white surfaces, dense piles and pills held in a hand are still hard.

## Features

- **Today:** a week strip, a daily progress ring and streak, and doses grouped by time of day.
- **Scan:** a camera viewfinder with live pill outlines and one clear result with a single next step.
- **Medications:** add, edit and remove medicines, with live RxNorm lookup by name or NDC (or manual entry).
- **Organizer review:** step through a 7×1, 7×2 or 7×4 weekly organizer one compartment at a time.
- **History and reports:** logged doses, corrections, and a printable weekly report for a doctor or pharmacist (use the print dialog's **Save as PDF**).
- **Profiles:** separate care profiles for each person, all stored locally.
- **Accessibility:** a Larger text setting that scales everything, 44 px+ touch targets, light and dark themes, keyboard navigation, and read-aloud guidance in English, Spanish and Mandarin.
- **Backup:** JSON export, import and reset.

Dose times are grouped as morning (00:00–11:59), afternoon (12:00–16:59), evening (17:00–20:59) and bedtime (21:00–23:59) in local time. Liquid, as-needed, tapered, alternate-day and split-pill regimens aren't supported yet.

## Design

The layout borrows proven patterns from top-rated medication and habit apps such as Medisafe, MyTherapy, Apple Health and Streaks: a time-grouped Today list with check circles, progress rings, a camera-first scan screen, and grouped settings lists. The look is bold and minimal, with a white page, black type, one orange accent, large numerals and one-word verdicts ("Match."). Pills are drawn as SVG renders in each medication's real color and shape. Icons are [Lucide](https://lucide.dev) (ISC). Type is DM Sans and Manrope (SIL OFL).

## Privacy

Plans and logs are stored in the browser's localStorage, unencrypted, so keep exported backups somewhere safe. Pill photos are analyzed on the device and are never uploaded or saved. The optional medication lookup sends the name or NDC you type to the National Library of Medicine. There are no accounts, analytics or tracking.

## Roadmap

- Bottle barcode scanning
- Reading pill imprints to separate strengths that look identical
- An accuracy study on real photos of full doses taken at home
- Shared caregiver accounts with sync and reminders
- Native mobile apps

## Development

```sh
npm test
```

GitHub Actions runs the tests and a syntax check on every push. The tests cover pill detection, reference ranking, NDC matching, unknown, extra and wrong pills, photo quality flags, dose rules, schedules, backups and the server.

To reproduce training, use Python 3.12, `vision/requirements-lock.txt`, the public ePillID release and the fixed split in `models/split.json`. See [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md).

```text
public/app.js              App UI and care workflows
public/core.js             Schedule and dose-record rules
public/recognition-core.js Pill finder, color detector and plan matching
public/recognition.js      Earlier single-pass browser inference (not used by the app)
public/models/             Trained weights, reference gallery and evaluation report
public/examples/           Demo photos and their sources
public/icons.js            Lucide icon paths (generated by scripts/fetch_ui_assets.py)
public/sw.js               Offline cache
server.mjs                 Static server and RxNorm proxy
analysis.mjs               Detection-response parser used by the tests
vision/                    Model training, export and evaluation scripts
models/split.json          Exact train/calibration/test split
tests/                     Logic, detector, model and server tests
docs/                      Architecture, model card and licenses
```

## Attribution and license

Reference data: the [ePillID benchmark](https://github.com/usuyama/ePillID-benchmark), derived from NIH NLM Pillbox and the Pill Image Recognition Challenge and released for research use. The app's MIT license doesn't override the original terms of the reference images or the models trained on them. Medication names come from the [openFDA NDC directory](https://open.fda.gov/apis/drug/ndc/) and [NLM RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html). Some older reference products are discontinued, and not every one has a name on file.

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Code: MIT. Fonts: SIL OFL. ONNX Runtime and DINOv2 (Apache 2.0) keep their upstream licenses; see `docs/`.
