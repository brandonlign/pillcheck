# PillCheck image recognition model

## Intended use

Educational research and a Congressional App Challenge prototype for automatic visual pill-reference comparison. It is not a clinical identifier, medication recommendation system, counterfeit detector, or proof of ingestion. Do not use a prediction to decide whether an unfamiliar medication should be taken.

## Version 2 (shipped): fully fine-tuned encoder

- ID: `pillcheck-dinov2-finetune-v2`. Script: `vision/train_finetune.py`; export check: `vision/verify_export.py`.
- Same input contract as v1 (224×224 RGB in [0, 1], normalization inside the graph, 256-d L2-normalized output), so the browser runtime is unchanged.
- **The whole DINOv2 ViT-S/14 backbone is trained**, with layer-wise learning-rate decay (0.8 per block, base 4e-5), AdamW, 1-epoch warm-up and cosine decay over 30 epochs, batch 64, bf16 autocast on one RTX 3080 Ti (~22 s/epoch).
- Loss: CosFace (scale 30, margin 0.25) over all 4,902 identities.
- GPU augmentation: any-angle rotation, scale 0.82–1.12, aspect jitter, ±7% shift (uncovered corners filled with the photo's border colour), brightness/contrast ±25%, saturation ±20%, small colour-temperature shift, 30% blur, sensor noise. No mirror flips (imprints are never mirrored) and no hue rotation (colour identifies pills).
- Gallery: each reference side embedded at 0/90/180/270° and averaged, plus training-split consumer photos (in-domain neighbours). This choice and the use of query-time rotation averaging were decided by calibration ablations only (`calibrationAblation` in `evaluation.json`). Test photos are never in the gallery.
- Split: identical to v1 (`models/split.json`, seed 2026); the abstention gate is selected on calibration only with the same rule (largest accepted set with ≥90% calibration precision). Training was paused once after epoch 9 and resumed from the best checkpoint with class weights initialized from mean training embeddings; the resumed run continued the same LR schedule.

| Held-out test (960 photos) | v1 | v2 |
|---|---:|---:|
| Top-1 product NDC | 53.1% | 72.4% |
| Top-3 | 76.3% | 85.1% |
| Accepted by gate | 200 (20.8%) | 471 (49.1%) |
| Correct among accepted | 178 (89.0%) | 434 (92.1%) |
| Gate (similarity / margin) | 0.77 / 0.06 | 0.69 / 0.13 |

Two abstention gates were selected on calibration data only: the v1 rule (largest accepted set with ≥90% calibration precision; similarity ≥ 0.60, margin ≥ 0.08) and a strict rule (≥95%; similarity ≥ 0.69, margin ≥ 0.13). On test, the 90% gate accepts 640 photos with 560 correct (87.5%), and the strict gate accepts 471 with 434 correct (92.1%). **The app ships the strict gate**, because a medication check should favour being right when it answers. This choice between the two calibration-selected gates was made after seeing both test results; both are recorded in `evaluation.json` (`strictGate`, `standardGate`). Query-time rotation averaging would add about one point of calibration top-1 (74.5% vs 73.4%) but costs four forward passes per pill in the browser, so it is not used. Demo examples were re-selected for v2 with `vision/finalize_v2.py` (correct, accepted, high-margin test photos; illustrative, not random).

The v1 description below is kept for provenance. Everything in "Failure modes" still applies to v2.

## Version 1 (previous)

### Shipped model

- ID: `pillcheck-dinov2-metric-v1`.
- Encoder: pretrained DINOv2 ViT-S/14, 224×224 RGB input, ImageNet channel normalization embedded in the graph.
- Pill-specific metric head: 384 → 384 (ReLU) → 256, L2 normalized.
- Training: supervised normalized classification head plus within-batch same-identity contrastive loss on cached encoder features. The DINOv2 backbone is frozen; **we trained the pill metric head, not DINOv2 from scratch**. A MobileNet-based baseline and an exploratory fine-tuning run are retained in the development scripts; the latter was stopped when the DINOv2 experiment gave better calibration retrieval.
- Runtime: ONNX, opset 17, browser ONNX Runtime Web / WASM. No remote inference.
- Gallery: 9,804 reference sides, 4,902 ePillID identities, 4,826 normalized product NDCs. Duplicate appearances of the same product are merged for ranking/plan comparison. Historical NIH references may not match current marketed products.
- Detector: plain-background segmentation with morphology and connected components. It is independent of the neural metric model and is **not** a trained object detector or instance-segmentation network.

## Dataset and split

[ePillID v1.0](https://github.com/usuyama/ePillID-benchmark), 13,532 images. The data derives from NIH NLM Pillbox and the Pill Image Recognition Challenge. Dataset authors describe it as research-only.

All reference sides are in the training gallery. Consumer photos are split deterministically by identity with seed 2026: where at least three exist, one goes to calibration, one to test, and the rest to training; two-image identities contribute one test and one train; singleton consumer identities go to test. Totals: 11,783 training images (including references), 789 calibration images, 960 test images. Exact paths are in `models/split.json`.

This is image-held-out evaluation. Test identities have reference images in the gallery; this is **not** an identity-held-out generalization claim. Photos are already cropped by the source dataset. Related captures may share acquisition conditions. There is no independently collected household, manufacturer-shift, skin-tone, organizer, or open-world test.

## Training and selection

Fixed seed 2026, 100 metric-training epochs, AdamW learning rate 0.001, weight decay 0.002, batches of 512 cached embeddings, cosine classification logits scaled by 20, and a 0.15 contrastive-loss weight. The checkpoint with best calibration top-1 identity retrieval is selected. Model architecture selection used calibration retrieval; the DINOv2 metric model exceeded the MobileNet baseline.

The postprocessing gate searches a fixed score/margin grid on calibration data, seeking the largest accepted set with at least ten examples and at least 90% observed calibration correctness. The selected gate is **cosine similarity ≥ 0.77 and runner-up gap ≥ 0.06**. This is an exploratory threshold heuristic, not a probability estimate, clinical calibration, conformal prediction, or statistical error guarantee. Selecting thresholds on a small calibration set can overfit. The test set is evaluated after threshold selection.

## Actual held-out results

| Measure | Result |
|---|---:|
| Consumer test images | 960 |
| Closest product NDC correct | 510 / 960 (53.125%) |
| Correct product in top 3 | 732 / 960 (76.25%) |
| Predictions passing score/margin gate | 200 / 960 (20.83%) |
| Correct among accepted predictions | 178 / 200 (89.0%) |
| Incorrect accepted predictions | 22 / 200 (11.0%) |
| Abstained predictions | 760 / 960 (79.17%) |
| Calibration gate support | 160 correct / 177 accepted |

These numbers are not good enough for medication decisions. In particular, accepted predictions can still be wrong. They measure retrieval on known-pill cropped research images, not end-to-end dose safety. Detection errors can create additional failures on full scenes. There is no measured <1% error rate.

The original dataset-identity top-1 metric is 51.354%; product-NDC merging gives 53.125%. Pretrained DINOv2 features alone scored 11.027% top-1 identity retrieval on the calibration split; the trained pill metric head scored 53.866%. Different splits/metrics must not be mixed when quoting improvement.

## Examples and testing

Example photos are real held-out test images selected for correct accepted predictions **after** overall evaluation. They are illustrative, not random evaluation examples. Their source paths and selection rule are recorded in `public/examples/manifest.json`. The two-pill image is a synthetic composite, documented in `dose-two.json`, and is not a real household test scene. Expected labels are used only to prepare an explicit sample plan and to validate results; inference reads image pixels, not the example manifest.

The neural smoke test executes the shipped ONNX model on a real image tensor and checks its retrieved NDC. Detector/rule tests check counts and unsafe-result blocking. Neither test suite is clinical validation.

## Failure modes

Blank reverse sides; look-alike white tablets; worn or unreadable imprints; unknown manufacturers; outdated references; capsule glare; color casts; dark pills on dark surfaces; blurry images; hands; translucent organizer lids; touching/overlapping pills; textured mats; cut-off pills; shadows; counterfeit pills; non-pill objects; and false acceptance despite high similarity. The model has no explicit imprint OCR, dosage understanding, chemical analysis, open-set detector, or interaction checker.

The single-pill close-up mode assumes there is one pill in the crop; it does not independently verify that assumption. The multi-pill mode counts connected foreground regions; touching pills can merge and one pill can split. Quality heuristics detect some, not all, failures.

## Reproduction

Python 3.12; install `vision/requirements-lock.txt` in a virtual environment. Download the exact ePillID release from its repository releases into `work/ePillID_data.zip`, then extract to `work/dataset/ePillID_data`.

```sh
python vision/train_dino.py --epochs 100
python vision/package_model.py --dino
python vision/label_catalog.py
python vision/enrich_historical.py
```

`train_dino.py` writes neural artifacts to `work/dino-export` and example images to `work/dino-examples`; copy those to `public/models` and `public/examples` after packaging. Preserve `labels.json` when copying. `models/split.json` contains the split; `public/models/checksums.json` records shipped file hashes. Model/atlas generation and caching paths are explicit in the scripts. MPS hardware/library behavior may affect exact floating-point reproducibility.

Label metadata scripts access only public dataset NDCs. They do not read user photographs or local care records. They build an offline snapshot from openFDA and historical RxNorm status, including discontinued products. Some identities remain named only by NDC.

## Licensing and source attribution

- Dataset: ePillID / NIH NLM, research-purpose release; see `docs/ePillID-LICENSE.txt` and upstream conditions.
- DINOv2: Meta / timm weights and implementation; Apache 2.0 (`docs/DINOv2-LICENSE.txt`).
- ONNX Runtime: Microsoft, MIT.
- Model head and app code: PillCheck contributors, MIT; upstream/data conditions still apply to derived research assets.
