# Validation record

## Automated checks

Run `npm test` with Node.js 22 or newer. The suite covers 21 cases: matching manual observations, prior taken records, uncertainty, absent observations, quantity mismatch, appearance mismatch, wrong period, unscheduled periods, concern logs, duplicate counting, current-period cutoff, color/shape look-alikes, invalid backups, local calendar dates, medication start dates, null/duplicate/organizer import data, server root, bundled assets/fonts, missing paths, path traversal, and lookup input bounds.

GitHub Actions also checks JavaScript syntax. There are no runtime package dependencies.

## Manually exercised in the in-app browser

- Loaded the responsive overview, medication page, dose check, organizer, care circle, and settings.
- Created a disposable empty profile, searched live RxNorm for lisinopril, selected a product, and saved label details with a bedtime schedule.
- Entered matching observations in a morning demo check during bedtime: wrong-period result displayed.
- Entered zero pills for an expected count of one: mismatch result displayed with no taken-log action.
- Entered one pill and confirmed appearance: the UI returned an explicitly manual checklist match.
- Logged a synthetic dose, observed it in history, reloaded the app, then verified the already-logged warning and duplicate-blocking result.
- Switched organizer from 7×2 to 7×4, reviewed a dated compartment, and observed the concern mark in the grid.
- Invoked the weekly report print flow, then dismissed it. A final saved PDF was not visually inspected in this environment.
- Reset all agent-generated QA records and left the fictional sample profile ready for exploration.
- Inspected responsive screenshots, corrected an oversized SVG, and confirmed the corrected care-note layout.
- Confirmed live name lookup via the local proxy; the endpoint returned actual RxNorm records rather than fixtures.

## Not yet validated

Physical camera capture, speech availability/pronunciation in every language, the downloaded backup restore round trip through a browser file picker, saved PDF pagination, phone hardware, all desktop browser combinations, accessibility with screen readers, older-adult usability, prescription-specific schedules, concurrency guarantees, remote care, or any image-recognition accuracy. No clinical trial or pharmacist review has been performed.

The sample profile and all QA records are illustrative. Test results validate software rules and serving behavior, not clinical safety or the identity of any medication.

## Automated recognition revision

The daily photo workflow now uses actual browser neural inference and automatic foreground counting. It no longer uses manual count or appearance-match inputs. The committed ONNX model has a real-image neural smoke test, and pure tests cover ranking, NDC normalization, uncertain/extra/unexpected pills, empty images, quality flags, timing, and duplicate records. See `docs/MODEL_CARD.md` and `public/models/evaluation.json` for measured model results; software test counts are not accuracy measurements.

Browser verification includes a real held-out single-pill image producing an automatic matching-plan result and a synthetic two-pill scene producing two automatically detected objects, candidate references, and an uncertainty result when a match fails the gate. After replacing baseline assets, the final DINOv2 model was checked in-browser: a single held-out image matched its sample plan (0.3 seconds with the model already loaded); the synthetic two-pill scene found two objects, retrieved both correct product references, and abstained on one ambiguous match (0.6 seconds). These are illustrative latency observations on this computer, not a phone benchmark.
