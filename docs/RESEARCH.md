# Recognition research status

Automated image recognition is now implemented. It replaces manual count/appearance checkboxes in the daily photo flow. The app includes real model weights, a public reference gallery, browser inference, abstention rules, a recorded split, actual evaluation, and provenance for illustrative test images.

The current detector is classical background segmentation, not a trained instance-segmentation network. Neural metric training is supervised on ePillID pill identities; backbone-specific experiments are in `vision/train.py` and `vision/train_dino.py`. No clinical or accuracy guarantee is claimed.

Next research milestones:

1. Evaluate on independently captured household photos and separate pill identities/manufacturer batches across splits. Current test images are held out by image, not identity.
2. Train and evaluate true instance segmentation for hands, overlapping pills, organizer dividers, and translucent lids. Current connected components can miss, split, or merge objects.
3. Add independently evaluated imprint OCR and reconcile candidate names/NDCs with a maintained source. The reference library is historical.
4. Evaluate out-of-library pills and non-pill objects, rather than relying only on known-pill retrieval. Measure false reassurance and abstention separately.
5. Design and validate statistical calibration before making any error-bound claim. A similarity threshold is not conformal prediction or a probability.
6. Measure end-to-end detector-plus-recognizer performance on a seeded-error study and phone hardware, then obtain pharmacist review and consented older-adult usability evidence.

No seeded-error study, pharmacist review, or clinical trial has been performed. Illustrative example scenes are synthetic composites and must never be reported as a community pilot or measured real-world success rate.
