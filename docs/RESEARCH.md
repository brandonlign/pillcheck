# Vision research: work that remains

No trained model, clinical evaluation, or accuracy guarantee is shipped. There are no invented study results. The working product is a guided manual review tool.

## Required milestones for image recognition

1. Establish permitted access and licensing for a pill-image dataset; NIH C3PI is a historical project, not a reliable live catalog. Resolve label provenance and manufacturer-specific differences.
2. Collect consented, de-identified photos of known pills and mark instance masks. Keep scenes, photographers, pill identities, and manufacturer batches separated across splits to avoid leakage.
3. Train an instance segmentation model; evaluate crowded pills, shadows, hands, organizer dividers, and translucent lids. Measure missed pills and merged instances separately from identity classification.
4. Train a metric-learning model using labeled front/back pairs and identity-held-out evaluation. Evaluate imprint OCR as independent evidence rather than inferring identity from color/shape.
5. Calibrate an abstaining prediction method on a held-out calibration set. Any conformal coverage claim requires its assumptions, target population, calibration method, sample sizes, confidence intervals, and distribution-shift limitations. A nominal 99% coverage target is not a universal guarantee that confident identifications are 99% correct.
6. Measure device-level latency and memory, evaluate offline execution, document supported devices, and integrate only once the model can abstain on unknown pills and poor images.
7. Run a seeded-error organizer study with a fixed protocol and real recorded outcomes. Obtain consent, avoid real medication administration, and involve a pharmacist and adult supervisor. Evaluate usability with older adults and caregivers.

## Suggested evaluation record

For each consented test scene, record an anonymous scene ID, known pill identities/counts, lighting category, background, organizer type, split, predicted instances, prediction sets, abstentions, false reassurance, false alarms, and timing. Keep identifying images outside Git.

Measure detection recall, false reassurance rate, abstention rate, identity recall on unseen types, per-condition performance, and calibration behavior. Report denominators and uncertainty. Do not promote simulated examples to measured study results.

## Other product work

Exact prescription-specific scheduling; tested reminders; barcode and bottle-label capture; authenticated and encrypted caregiver sync; clinician-reviewed wording; validated translated UI; encrypted storage; accessible user studies; native mobile packaging; historical schedule versioning; and automated image review remain future work.
