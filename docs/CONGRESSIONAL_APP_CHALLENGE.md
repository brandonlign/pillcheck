# PillCheck · Congressional App Challenge submission guide

Use this page to fill in the submission form, plan the demo video, and prepare for judging questions. Always confirm the current year's rules, deadlines and video requirements on the official site: <https://www.congressionalappchallenge.us>.

## One-line pitch

**PillCheck lets families double-check every dose with one photo.** Our detection model finds each pill, reads its color, shape and imprint, and PillCheck checks the count and imprints against the prescription plan in about two seconds.

## The problem

- Medication errors are a well-documented cause of preventable harm, and older adults who take several medicines every day are among the most exposed.
- Pills from different manufacturers look different, refills change appearance, and many white tablets look alike.
- Caregivers (often family members, sometimes teenagers helping grandparents) fill weekly organizers by hand with no second check.

> Before submitting, add one or two statistics from sources you have read yourself (for example CDC, FDA or AHRQ pages on medication errors and polypharmacy), with links. Judges reward specific, cited numbers, and you must be able to explain where they came from.

## Inspiration (write this in your own words)

Explain the real moment that started the project: a family member, a pill organizer, a pharmacy refill that looked different. Personal, specific stories score better than general statements.

## What it does

1. **Plan:** add each prescription (name, strength, schedule, and the imprint printed on the pill). Optional name lookup in NLM RxNorm.
2. **Scan:** pick the dose time and take one photo of the pills on a plain surface. Live outlines show each pill in the camera preview.
3. **Result:** a card lists every pill found with its color, shape and imprint, says whether the count matches the plan, and marks each pill whose imprint matches a saved medication.
4. **Track:** log the dose, see the week and streak, print a report for a doctor or pharmacist, and review a weekly organizer one compartment at a time.

## How it works (technical summary for judges)

| Part | What it is |
|---|---|
| Live outlines | In-browser background segmentation, morphology and connected components draw a box around each separate pill in the camera preview. |
| Detection | The photo is resized in the browser and sent through the PillCheck server to our detection model, a hosted vision model prompted to return structured JSON (count, then color, shape, imprint and a possible name for each pill). |
| Parsing | The server validates the image, rate-limits requests, and parses the model's JSON with a fallback that still recovers pills from malformed output. Tested in `tests/analysis.test.mjs`. |
| Plan matching | Imprints are normalized and compared with each saved medication, allowing one misread character (for example "PAIN 5" vs "PAN 5"). The pill count is compared with the planned quantity. |
| Storage | Plans and logs stay in the browser's local storage. No accounts, no analytics. Photos are not stored. |
| App | Vanilla JavaScript, no framework; installable web app; Node.js server with the detection and RxNorm proxies. |

## Research history: the on-device model

Before the current detection model, PillCheck ran its own pill recognizer in the browser. It is still in the repository (`vision/`, `public/models/`) and is a good story for judges about the machine-learning work.

- DINOv2 ViT-S/14 vision transformer, fully fine-tuned on the ePillID benchmark (NIH Pillbox images) with pill-specific augmentation and a CosFace metric-learning loss.
- 9,804 reference images covering 4,902 pill identities.
- Measured on 960 held-out phone photos:

| Metric | v1 (frozen backbone) | v2 (fine-tuned) |
|---|---:|---:|
| Correct first guess (top-1) | 53.1% | **72.4%** |
| Correct answer in top 3 | 76.3% | **85.1%** |
| Confident answers (coverage) | 20.8% | **49.1%** |
| Right when confident (precision) | 89.0% | **92.1%** |

Why it was replaced: it only knew pills in the historical NIH library and needed already-cropped photos, while the detection model reads imprints on any pill in a full photo. These numbers describe the retained model, not the current detection model.

## Design process (good to mention to judges)

The interface was redesigned after studying the top-rated apps in the category on the App Store (Medisafe, MyTherapy, Apple Health Medications) and apps famous for their design (Streaks, an Apple Design Award winner, and Duolingo). PillCheck borrows their proven patterns: a time-grouped "Today" list with check circles, progress rings and streaks, a camera viewfinder for scanning, and tactile buttons. A later pass cut extra captions and warnings so each screen has one clear job.

## Accessibility and inclusion

- Large touch targets (at least 44 px), a "Larger text" setting that scales the whole interface, and light/dark themes.
- Read-aloud guidance in English, Spanish and Mandarin.
- Keyboard navigation, visible focus, a skip link and reduced-motion support.
- Free, no account, no tracking; works in any phone or laptop browser.

## Privacy

Plans and logs live in the browser's local storage. Photos are analyzed by our detection model and are not stored. The only other network request is the optional medication-name lookup to the National Library of Medicine.

## Demo video plan (keep within the official length limit)

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | You, or a caregiver scene with a pill organizer | The problem, in one personal sentence. |
| 0:20–0:40 | Welcome screen and Today | "PillCheck double-checks every dose with one photo." |
| 0:40–1:20 | Add a medication with its imprint, then **Scan**: live outlines, take a real photo | Point out the per-pill result and the green "Matches" labels. |
| 1:20–1:50 | Scan with a pill missing or a wrong pill | Show the count mismatch and the pill without a match. |
| 1:50–2:20 | Streak, history, printable report, Larger text, read-aloud | Accessibility and caregiver features. |
| 2:20–2:40 | Architecture slide | Live outlines, detection model, plan matching, and the on-device model you trained first. |

Tips: record the screen at 1080p; use a phone on a stand for real photos; use a plain dark or light mat; keep the background quiet; add captions.

## Judging questions to rehearse

- *How does the detection work?* The browser draws live outlines; the photo goes through the PillCheck server to our detection model, which returns structured JSON; PillCheck then matches imprints and counts against the plan.
- *Did you build the model?* Be ready to explain both parts honestly: the detection model is a hosted vision model you prompt and parse, and you separately trained and evaluated the on-device DINOv2 recognizer (numbers above).
- *What happens when it's wrong?* The count and the imprint matches make a wrong or missing pill stand out, and every dose is still confirmed by the user before it is logged.
- *What would you add next?* Bottle barcode scanning, a measured accuracy study for the detection model on real doses, a native app, and caregiver sync.

## Submission checklist

- [ ] Confirm eligibility, district participation, team size and the deadline on the official site.
- [ ] Public code repository with this README and docs (check that no personal data or keys are committed; `.env` is gitignored).
- [ ] Demo video uploaded as the rules require (for example YouTube or Vimeo, public or unlisted).
- [ ] App description, inspiration, technical challenges and next steps written in your own words.
- [ ] Cited statistics in the problem statement.
- [ ] Test the app on a phone: run `HOST=0.0.0.0 npm start` on the laptop and open `http://<laptop-ip>:4173` on the phone (same Wi-Fi).
- [ ] Run `npm test` and confirm it passes.
- [ ] Credit data sources: ePillID / NIH NLM, openFDA, RxNorm, DINOv2, ONNX Runtime, Lucide icons, Microsoft Fluent Emoji.
