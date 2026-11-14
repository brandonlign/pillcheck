# Model files

The runtime weights, gallery embeddings, reference images, offline name data and evaluation report live in `public/models/`.

`split.json` records the exact training, calibration and test image paths. PyTorch checkpoints (`*.pt`) aren't committed, since the exported ONNX files are what the app uses. They can be rebuilt with the scripts in `vision/` and the pinned environment in `vision/requirements-lock.txt`. See [`docs/MODEL_CARD.md`](../docs/MODEL_CARD.md) for training details and results.
