# PillCheck · Congressional App Challenge submission guide

Use this page to fill in the submission form, plan the demo video, and prepare for judging questions. Always confirm the current year's rules, deadlines and video requirements on the official site: <https://www.congressionalappchallenge.us>.

## One-line pitch

**PillCheck lets families double-check every dose with one photo.** It finds each pill in the picture, recognizes it against 9,804 NIH reference images with a model that runs entirely on the device, and says plainly whether the dose matches the prescription plan. When it isn't sure, it says "not sure" instead of guessing.

## The problem

- Medication errors are a well-documented cause of preventable harm, and older adults who take several medicines every day are among the most exposed.
- Pills from different manufacturers look different, refills change appearance, and many white tablets look alike.
- Caregivers (often family members, sometimes teenagers helping grandparents) fill weekly organizers by hand with no second check.

> Before submitting, add one or two statistics from sources you have read yourself (for example CDC, FDA or AHRQ pages on medication errors and polypharmacy), with links. Judges reward specific, cited numbers, and you must be able to explain where they came from.

## Inspiration (write this in your own words)

Explain the real moment that started the project: a family member, a pill organizer, a pharmacy refill that looked different. Personal, specific stories score better than general statements.

## What it does

1. **Plan:** add each prescription (name, strength, schedule, the NDC printed on the bottle). Optional lookup in NLM RxNorm.
2. **Check:** pick the dose time, take one photo of the pills on a plain surface.
3. **Answer:** a green, amber or red verdict in plain language:
   - *Matches your plan*: every pill recognized confidently, counts match.
   - *Not sure*: a match is too weak or too close to a look-alike, so no guess is made.
   - *Unexpected pill* / *counts don't match*: tells you exactly what to recheck.
4. **Track:** log the dose, review the week, print a report for a doctor or pharmacist, and review a weekly organizer one compartment at a time.

## How it works (technical summary for judges)

| Part | What it is |
|---|---|
| Detection | In-browser background segmentation, morphology and connected components find separated pills. |
| Recognition | DINOv2 ViT-S/14 vision transformer, **fully fine-tuned** on the ePillID benchmark (NIH Pillbox images) with pill-specific augmentation and a CosFace metric-learning loss. Each pill becomes a 256-number embedding compared with every reference image. |
| Gallery | 9,804 front/back reference images (each averaged over four rotations) plus training-split phone photos, covering 4,902 pill identities. |
| Safety gate | A similarity threshold and a runner-up margin, chosen on calibration photos only, decide when the model may answer. Otherwise it abstains. |
| Runtime | ONNX Runtime Web (WebAssembly). No server-side AI, no account, works offline as an installable web app. |
| App | Vanilla JavaScript, no framework; Node.js static server with an RxNorm lookup proxy. |

### Accuracy, measured honestly

Measured on 960 phone photos that were never used for training or threshold selection (same split as version 1):

| Metric | v1 (frozen backbone) | v2 (fine-tuned) |
|---|---:|---:|
| Correct first guess (top-1) | 53.1% | **72.4%** |
| Correct answer in top 3 | 76.3% | **85.1%** |
| Confident answers (coverage) | 20.8% | **49.1%** |
| Right when confident (precision) | 89.0% | **92.1%** |

The app uses the stricter of two confidence gates chosen on calibration data, trading some coverage for being right more often when it answers. It is better than v1 on both counts: 2.4× as many confident answers, and more of them correct.

What changed in v2:

- **Whole-network fine-tuning** instead of training only a small head on frozen features, with layer-wise learning-rate decay so the pretrained knowledge isn't destroyed.
- **Pill-aware augmentation:** any-angle rotation, scale, lighting and contrast changes, blur and sensor noise. No mirror flips, because imprints are never mirrored in real photos, and almost no hue change, because color identifies pills.
- **CosFace margin loss** pushes look-alike pills apart in embedding space.
- **Better gallery:** rotation-averaged references plus in-domain phone photos from the training split.

Limitations to state openly: this is a research benchmark on already-cropped photos of known pills, not a clinical study. There is no imprint OCR or barcode scanning, the NIH library is historical, and touching pills can confuse the detector.

## Design process (good to mention to judges)

The interface was redesigned after studying the top-rated apps in the category on the App Store (Medisafe, MyTherapy, Apple Health Medications) and apps famous for their design (Streaks, an Apple Design Award winner, and Duolingo). PillCheck borrows their proven patterns: a time-grouped "Today" list with check circles, progress rings and streaks for motivation, a camera viewfinder for scanning, and tactile buttons, so it feels familiar from the first tap.

## Accessibility and inclusion

- Large touch targets (at least 44 px), a "Larger text" setting that scales the whole interface, and light/dark themes.
- Read-aloud guidance in English, Spanish and Mandarin.
- Keyboard navigation, visible focus, a skip link, reduced-motion support, and plain-language results.
- Free, no account, no tracking; works on any phone or laptop browser and offline after the first load.

## Privacy

Photos and recognition never leave the device. Records live in the browser's local storage. The only network request is the optional medication-name lookup to the National Library of Medicine.

## Demo video plan (keep within the official length limit)

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | You, or a caregiver scene with a pill organizer | The problem, in one personal sentence. |
| 0:20–0:40 | Welcome screen | "PillCheck double-checks every dose with one photo, privately on your phone." |
| 0:40–1:20 | Add a medication, then **Check a dose**: take a real photo | Point out the detection box and the green verdict. |
| 1:20–1:50 | A wrong or extra pill, or a look-alike | Show the amber/red result and "not sure". This is the safety story. |
| 1:50–2:20 | Accuracy panel, Care circle, printable report, Larger text, read-aloud | Accessibility and honesty about accuracy. |
| 2:20–2:40 | Code or architecture slide | On-device AI, fine-tuned vision transformer, what you'd build next. |

Tips: record the screen at 1080p; use a phone on a stand for real photos; use a plain dark or light mat; keep the background quiet; add captions.

## Judging questions to rehearse

- *How do you know it works?* Held-out test set, numbers above, and the fact that thresholds were chosen without looking at the test set.
- *What happens when it's wrong?* It abstains when unsure; even a match tells the user to follow the prescription and ask a pharmacist.
- *Why on-device?* Health privacy, works offline, no server costs, free for everyone.
- *What would you add next?* Imprint OCR, bottle barcode scanning, a trained pill detector for touching pills, a native app, and a study with real users.

## Submission checklist

- [ ] Confirm eligibility, district participation, team size and the deadline on the official site.
- [ ] Public code repository with this README and docs (check that no personal data or keys are committed).
- [ ] Demo video uploaded as the rules require (for example YouTube or Vimeo, public or unlisted).
- [ ] App description, inspiration, technical challenges and next steps written in your own words.
- [ ] Cited statistics in the problem statement.
- [ ] Test the app on a phone: run `HOST=0.0.0.0 npm start` on the laptop and open `http://<laptop-ip>:4173` on the phone (same Wi-Fi).
- [ ] Run `npm test` and confirm it passes.
- [ ] Credit data sources: ePillID / NIH NLM, openFDA, RxNorm, DINOv2, ONNX Runtime, Lucide icons, Microsoft Fluent Emoji.
