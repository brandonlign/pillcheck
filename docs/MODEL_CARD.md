# PillCheck model card

PillCheck uses two on-device models. The **pill finder** outlines each pill in a photo. The **reference model** recognizes each outlined pill by comparing it with a library of known pills. Both run in the browser with ONNX Runtime Web, so photos never leave the device.

PillCheck was built as a research prototype for the Congressional App Challenge. It compares how pills look with how the planned medicines should look. It is not a clinical pill identifier.

## Reference model (v2, shipped)

- **ID:** `pillcheck-dinov2-finetune-v2` (`public/models/pill-encoder.onnx`). Training: `vision/train_finetune.py`. Export check: `vision/verify_export.py`.
- **Architecture:** DINOv2 ViT-S/14 with a 256-dimensional L2-normalized embedding. Input is 224×224 RGB in [0, 1], with normalization built into the graph.
- **Training:** the whole backbone is fine-tuned with a CosFace loss (scale 30, margin 0.25) over all 4,902 identities. Settings: layer-wise learning-rate decay (0.8 per block, base 4e-5), AdamW, 1-epoch warm-up then cosine decay over 30 epochs, batch 64, bf16 on one RTX 3080 Ti (about 22 s per epoch). Training was paused once after epoch 9 and resumed from the best checkpoint on the same learning-rate schedule.
- **Augmentation:** rotation at any angle, scale 0.82–1.12, aspect jitter, ±7% shift, ±25% brightness and contrast, ±20% saturation, small color-temperature shifts, blur and sensor noise. There are no mirror flips, because imprints are never mirrored, and no hue rotation, because color helps identify pills.
- **Gallery:** every reference side is embedded at 0°, 90°, 180° and 270° and averaged, alongside the training-split consumer photos. Test photos are never in the gallery. The gallery covers 4,902 ePillID identities, merged into 4,826 product NDCs.

### Accepting a match

Each pill is embedded at four rotations. A match is accepted only when similarity is at least 0.77, the lead over the runner-up is at least 0.24, and at least two of the single rotations agree on the same product (`vision/confidence_gate.py`). This gate was chosen on the calibration split only, as the most precise gate with at least 20 accepted examples (97.0% calibration precision).

### Results on 960 held-out test photos

| Measure | v1 (frozen backbone) | v2 (fine-tuned) |
|---|---:|---:|
| Top-1 product NDC | 53.1% | **73.0%** |
| Top-3 product NDC | 76.3% | **85.2%** |
| Accepted by the gate | 200 (20.8%) | 292 (30.4%) |
| Correct among accepted | 178 (89.0%) | **287 (98.3%)** |
| Wrong pill matched, random 3-medicine plan | | 0 / 960 |
| Wrong pill matched, plan holds its closest look-alike | | 5 / 960 |

All 5 test errors and 8 calibration errors fall into three groups: the same drug at a different strength (for example clonidine 0.1 mg vs 0.2 mg), contraceptive packs whose tablets are shared across products, and one clonidine/atenolol look-alike. Telling these apart reliably needs imprint reading or higher-resolution input. The four rotations cost about 1–1.5 s per pill in the browser.

## Plan check and flip step (shipped)

The app doesn't need to pick one pill out of 4,826. It only needs to decide whether each pill is one of the medicines planned for this dose. A planned medicine is confirmed when its score clears the similarity threshold, no product outside the plan scores meaningfully higher, and it leads the other planned medicines (`planDecision` in `public/recognition-core.js`, mirrored in `vision/plan_check.py`). A pill confidently recognized as a product outside the plan is reported as the wrong pill.

Pills not confirmed from the first photo are flipped and scanned on their other side. The two sides' scores are averaged and checked against a second threshold.

| Threshold (`catalog.json` → `planGate`) | Similarity | Ahead | Margin |
|---|---:|---:|---:|
| First photo | 0.88 | 0 | 0 |
| After the flip | 0.70 | 0.02 | 0 |

These were chosen with `vision/flip_gate.py --cap 0.03` on 359 held-out pills that have a photo of each side. The targets were at least 99.5% precision on correct pills, at most 0.5% of random wrong pills confirmed, and at most 3% of look-alike wrong pills confirmed. With 2-fold cross-validation by identity:

| Measure | Result |
|---|---:|
| Correct pills confirmed | 67.1% (24.0% from the first photo alone) |
| Precision of confirmations | 100% |
| Random wrong pills caught | 100% |
| Look-alike wrong pills caught | 96.4% |

Plans in this simulation are random three-medicine plans, and the look-alike case puts the single most similar product in the plan.

## Pill finder (shipped)

`public/models/pill-finder.onnx` (3.7 MB) is a small segmentation network trained on synthetic scenes (`vision/train_segmenter.py`). The scenes place NIH pill cut-outs on photos of marble, wood, counters, cloth, hands and paper, with shadows, uneven light, blur and distractors such as marble veins. It outlines each pill and splits pills that touch. On plain, even surfaces, a color-based detector adds anything the network missed.

On 29 freely licensed real photos from Wikimedia Commons, it found separated pills on wood, stone, paper and blister packs, white pills on gray paper, and touching pills. White pills on white surfaces, dense piles and pills held in a hand are the hardest cases.

## Data and split

[ePillID v1.0](https://github.com/usuyama/ePillID-benchmark) has 13,532 images derived from NIH NLM Pillbox and the Pill Image Recognition Challenge, released for research use.

All reference sides go in the gallery. Consumer photos are split by identity with seed 2026: identities with at least three photos give one to calibration, one to test and the rest to training; two-photo identities give one to test and one to training; single-photo identities go to test. That gives 11,783 training images (including references), 789 calibration images and 960 test images. Exact paths are in `models/split.json`.

The test set holds out images, not identities: every test pill has reference images in the gallery. ePillID photos are already cropped to one pill.

## Version 1 (previous)

`pillcheck-dinov2-metric-v1` kept the DINOv2 backbone frozen and trained a small metric head (384 → 384 → 256) with a normalized classification loss plus a within-batch contrastive loss on cached features: 100 epochs, AdamW, learning rate 0.001, weight decay 0.002, batch 512, logit scale 20, contrastive weight 0.15. Pretrained DINOv2 features alone reached 11.0% top-1 identity retrieval on calibration; the trained head reached 53.9%. Its gate was similarity ≥ 0.77 and margin ≥ 0.06. A MobileNet baseline scored lower on calibration retrieval.

## Known hard cases

Blank back sides, look-alike white tablets, worn imprints, products from manufacturers not in the library, capsule glare, color casts, dark pills on dark surfaces, blur, and translucent organizer lids. The model reads appearance only. It doesn't read imprints, check dosages or check interactions.

## Demo examples

The demo photos are real held-out test images, chosen after evaluation as clear, correctly accepted examples (`vision/finalize_v2.py`). Their sources are recorded in `public/examples/manifest.json`. The two-pill image is a synthetic composite documented in `dose-two.json`.

## Reproduction

Use Python 3.12 with `vision/requirements-lock.txt` in a virtual environment. Download the ePillID release into `work/ePillID_data.zip` and extract it to `work/dataset/ePillID_data`.

```sh
python vision/train_dino.py --epochs 100   # v1 metric head and split
python vision/train_finetune.py            # v2 fine-tuned encoder
python vision/verify_export.py
python vision/package_model.py --dino
python vision/label_catalog.py
python vision/enrich_historical.py
```

Copy the exported artifacts into `public/models` and `public/examples`, keeping `labels.json`. `public/models/checksums.json` records the hashes of the shipped files. The label scripts read only public dataset NDCs and build an offline name snapshot from openFDA and RxNorm, including discontinued products.

## Licenses

- Dataset: ePillID / NIH NLM, research release (`docs/ePillID-LICENSE.txt`).
- DINOv2: Meta, via timm, Apache 2.0 (`docs/DINOv2-LICENSE.txt`).
- ONNX Runtime: Microsoft, MIT.
- PillCheck code and model head: MIT. Upstream data terms still apply to derived model files.
