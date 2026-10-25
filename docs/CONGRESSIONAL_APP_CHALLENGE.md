# PillCheck · Congressional App Challenge submission guide

Use this page to fill in the submission form, plan the demo video, and prepare for judging questions. Always confirm the current year's rules, deadlines and video requirements on the official site: <https://www.congressionalappchallenge.us>.

## One-line pitch

**PillCheck helps families check a prepared dose against a saved medication plan.** It finds pill-shaped regions in a photo and compares them on-device with known pill references. It marks uncertain results instead of guessing.

## The problem

- Medication errors are a well-documented cause of preventable harm, and older adults who take several medicines every day are among the most exposed.
- Pills from different manufacturers look different, refills change appearance, and many white tablets look alike.
- Caregivers (often family members, sometimes teenagers helping grandparents) fill weekly organizers by hand with no second check.

> Before submitting, add one or two statistics from sources you have read yourself (for example CDC, FDA or AHRQ pages on medication errors and polypharmacy), with links. Judges reward specific, cited numbers, and you must be able to explain where they came from.

## Inspiration (write this in your own words)

Explain the real moment that started the project: a family member, a pill organizer, a pharmacy refill that looked different. Personal, specific stories score better than general statements.

## What it does

1. **Plan:** add each prescription (name, strength, schedule, quantity, and bottle NDC). Optional name lookup in NLM RxNorm.
2. **Scan:** pick the dose time and take one photo of the pills on a plain surface. Live outlines show each pill in the camera preview.
3. **Result:** a card shows detected pill crops, accepted reference matches or an uncertain result, and whether reference identities and counts match the saved plan.
4. **Track:** log the dose, see the week and streak, print a report for a doctor or pharmacist, and review a weekly organizer one compartment at a time.

## How it works (technical summary for judges)

| Part | What it is |
|---|---|
| Live outlines | In-browser background segmentation, morphology and connected components draw a box around each separate pill in the camera preview. |
| Reference comparison | A DINOv2 ViT-S/14 model runs in the browser through ONNX Runtime Web. It embeds each detected crop and ranks it against 11,783 reference photos covering 4,902 known pill identities. |
| Abstention | A calibration-selected similarity and margin threshold suppresses low-separation matches. Similarity is not a probability, and accepted matches can still be wrong. |
| Plan matching | Accepted reference NDCs and pill counts are compared with the NDCs and quantities saved for that dose. Scans that are uncertain or do not match cannot be logged as a matched dose; the user can still self-report manually. |
| Storage | Plans and logs stay in browser local storage. Pill photos are analyzed on-device and are not uploaded. Optional medication lookup goes to NLM. No accounts or analytics. |
| App | Vanilla JavaScript, no framework; installable web app; Node.js server for static files and the optional RxNorm proxy. |

## Model and evaluation

The current scanner uses the on-device reference model trained for PillCheck (`vision/`, `public/models/`):

- DINOv2 ViT-S/14 vision transformer, fully fine-tuned on the ePillID benchmark (NIH Pillbox images) with pill-specific augmentation and a CosFace metric-learning loss.
- 9,804 reference images covering 4,902 pill identities.
- Measured on 960 held-out phone photos:

| Metric | v1 (frozen backbone) | v2 (fine-tuned) |
|---|---:|---:|
| Correct first guess (top-1) | 53.1% | **72.4%** |
| Correct answer in top 3 | 76.3% | **85.1%** |
| Confident answers (coverage) | 20.8% | **49.1%** |
| Right when confident (precision) | 89.0% | **92.1%** |

The model only covers identities in the ePillID reference library, and its benchmark photos are already cropped. Its numbers measure reference retrieval, not pill segmentation or complete-dose accuracy. The current app has not been evaluated on an independent set of household photos or unknown pills. See [`MODEL_CARD.md`](MODEL_CARD.md) for the split, threshold selection, and limitations.

## Design process (good to mention to judges)

The interface was redesigned after studying the top-rated apps in the category on the App Store (Medisafe, MyTherapy, Apple Health Medications) and apps famous for their design (Streaks, an Apple Design Award winner, and Duolingo). PillCheck borrows their proven patterns: a time-grouped "Today" list with check circles, progress rings and streaks, a camera viewfinder for scanning, and tactile buttons. A later pass cut extra captions and warnings so each screen has one clear job.

## Accessibility and inclusion

- Large touch targets (at least 44 px), a "Larger text" setting that scales the whole interface, and light/dark themes.
- Read-aloud guidance in English, Spanish and Mandarin.
- Keyboard navigation, visible focus, a skip link and reduced-motion support.
- Free, no account, no tracking; works in any phone or laptop browser.

## Privacy

Plans and logs live in browser local storage. Pill photos are analyzed on-device and are not uploaded. The optional medication-name lookup sends the entered name or NDC to the National Library of Medicine.

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

- *How does the scan work?* The browser draws live outlines, runs the DINOv2 reference model locally on each crop, abstains below its threshold, then compares accepted reference NDCs and counts with the saved plan.
- *Did you build the model?* The DINOv2 backbone was fine-tuned on the ePillID benchmark with pill-specific augmentation and a CosFace loss. The strict threshold accepted 471 of 960 held-out crops, and 434 accepted matches were correct (92.1%). This is a research benchmark, not clinical validation.
- *What happens when it's wrong?* A wrong accepted match remains possible. The app labels matches as research results, and users must compare against the bottle and confirm the dose themselves.
- *What would you add next?* Test end-to-end detection and matching on diverse phone photos, improve unknown-pill rejection, add barcode lookup, and evaluate caregiver workflows.

## Submission checklist

- [ ] Confirm eligibility, district participation, team size and the deadline on the official site.
- [ ] Public code repository with this README and docs (check that no personal data or keys are committed; `.env` is gitignored).
- [ ] Demo video uploaded as the rules require (for example YouTube or Vimeo, public or unlisted).
- [ ] App description, inspiration, technical challenges and next steps written in your own words.
- [ ] Cited statistics in the problem statement.
- [ ] Test the app on a phone: run `HOST=0.0.0.0 npm start` on the laptop and open `http://<laptop-ip>:4173` on the phone (same Wi-Fi).
- [ ] Run `npm test` and confirm it passes.
- [ ] Credit data sources: ePillID / NIH NLM, openFDA, RxNorm, DINOv2, ONNX Runtime, Lucide icons, Microsoft Fluent Emoji.
