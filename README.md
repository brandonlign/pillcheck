# PillCheck

A calm, local-first medication double-check app, built for a Congressional App Challenge project.

**Status:** a working guided-review prototype. The camera provides a private reference photo; it does **not** identify pills. Trained pill recognition, bottle OCR, automated organizer detection, remote caregiver alerts, and a clinically measured accuracy guarantee are not implemented. Do not describe these as completed features in a submission.

## Run

Requires Node.js 22 or newer. No packages, API keys, accounts, or build step are required.

```sh
npm start
```

Open **http://localhost:4173**. On macOS, double-click **Start PillCheck.command** in this folder. Keep its Terminal window open while using the app. Press Control-C to stop the server. Use `PORT=4180 npm start` if the default port is occupied.

The server binds to this computer only. Camera/file capture depends on your browser and device; on a laptop, choose an existing photo. Mobile layout is supported, but this local-only server is not reachable from a separate phone. A future HTTPS deployment is needed for phone access.

## What works

- Separate care profiles stored in the browser, with an explicitly fictional sample profile.
- Add, edit, and delete medication plans, including quantity, periods, appearance notes, and manufacturer.
- Real RxNorm medication-name and NDC lookup through a small Node proxy. Confirm the exact product and strength against the bottle. Results do not include a pill photograph, dosing recommendation, or interaction check.
- Guided dose review: optional camera/photo reference, manual counts, appearance match, and an uncertainty option.
- Flags for wrong period, previous taken record, different count, uncertainty, and changed appearance. A successful result means the user's checklist matches their saved plan; it does not establish pill identity.
- Explicit self-reported logging after a matching checklist. Periods are morning (00:00–11:59), afternoon (12:00–16:59), evening (17:00–20:59), and bedtime (21:00–23:59), in device local time. These broad buckets are a prototype limitation, not prescription-specific time windows.
- Look-alike warnings when two saved medication descriptions share color and shape.
- Manual 7×1, 7×2, and 7×4 organizer review, with dated marks and notes. Marks never log a dose taken.
- Refill-change notes and pharmacist-confirmation prompts.
- Caregiver view on the same device, 7-day self-reported logging charts, correction of mistaken logs, and a weekly print report. Choose **Save as PDF** in the system print dialog.
- Larger text, keyboard support, and optional read-aloud instructions in English, Spanish, and Mandarin. Browser voices vary; the visual UI is English.
- JSON backup export, validated import, and local reset.

## Try it

1. Open the sample profile to explore. Its medication appearances and historical logs are fictional.
2. Choose **Set up my own profile**, then enter a plan from your existing prescription.
3. Open **Dose check** for the current period. Enter a count for each medication and confirm its appearance, or choose **Not sure**.
4. Review the result. A reported count mismatch or unfamiliar appearance never gets a matching-checklist result.
5. After taking a dose according to your prescription, explicitly log it. Reopening that scheduled period shows the previous-log warning.
6. In **Organizer**, review a compartment; this records preparation only.
7. Use **Care circle → Print weekly report** to share a self-reported care record.

## Privacy and boundaries

Medication plans and logs are stored unencrypted in localStorage on this browser. They are not sent to a remote database. Someone with access to this browser profile can read them. Exported backups contain health information; protect them accordingly. Browser storage can be cleared or unavailable, so make backups when needed.

Uploaded images stay in tab memory; they are not posted to the server or saved with logs. Leaving a dose check discards its image. Closing the tab discards all reference images. Fonts are bundled locally. Only optional RxNorm lookup sends the entered search term/NDC to NLM. Browser speech services may process the spoken text outside the device.

There are no remote caregiver accounts, notifications, analytics, background reminders, or encrypted cloud sync. This app cannot verify ingestion, pill identity, medication interactions, suitability, or a prescription. A generic manufacturer's appearance change must be checked with a pharmacist. Do not use a sample plan as medical instructions.

## Verify

```sh
npm test
```

Tests use Node's built-in test runner. GitHub Actions runs the suite and syntax checks on pushes and pull requests. See [docs/VALIDATION.md](docs/VALIDATION.md) for browser verification and limitations, and [docs/RESEARCH.md](docs/RESEARCH.md) for the separate model-development plan.

## Structure

```text
public/app.js       UI, browser storage, and workflows
public/core.js      Pure schedule, review, and reporting logic
public/style.css    Responsive design and print layout
public/fonts/       Locally bundled OFL fonts and licenses
server.mjs          Local static server and restricted RxNorm proxy
tests/              Automated logic and server tests
docs/               Architecture, validation, and research boundaries
```

## Data attribution

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Sources: [RxNorm getDrugs](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getDrugs.html), [RxNorm APIs](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html). The NIH C3PI project is historical; this app does not depend on a current C3PI image service. [HHS dataset record](https://datahub.hhs.gov/NIH/Computational-Photography-Project-for-Pill-Identif/5vhs-kfa6).

Code is MIT licensed. Bundled fonts retain their respective SIL Open Font Licenses.
