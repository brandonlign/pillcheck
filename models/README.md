# Trained model artifacts

Runtime weights, normalized gallery embeddings, reference atlases, offline public name metadata, and the measured evaluation report live in `public/models/`.

`split.json` records the exact training/calibration/test image paths. PyTorch training checkpoints (`*.pt`) are local-only to avoid shipping duplicate weights. They are reproducible from the pinned training environment and scripts in `vision/`.

The model is research software. Its similarity scores are not probabilities, its abstention gate does not guarantee clinical accuracy, and a matching result does not prove that a pill is safe or that it was swallowed.
