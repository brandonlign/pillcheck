"""Run an exported ONNX model the way the browser does and check the demo images.

Usage: python vision/verify_export.py [model_dir]   (default: work/v2-export)
Prints, for each example photo and the test fixture, the closest product NDC,
its score and runner-up margin, and whether it passes the shipped gate.
"""
import json, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def product(ndc):
    a, b = str(ndc).split("_")[0].split("-")[:2]
    return a.zfill(5) + "-" + b.zfill(4)


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "work/v2-export"
    catalog = json.load(open(src / "catalog.json"))
    gallery = np.fromfile(src / "gallery.f32", dtype="<f4").reshape(catalog["referenceCount"], catalog["embeddingSize"])
    keys = [product(catalog["catalog"][i]["ndc"]) for i in catalog["referenceIds"]]
    session = ort.InferenceSession(str(src / "pill-encoder.onnx"), providers=["CPUExecutionProvider"])
    t = catalog["thresholds"]

    def rank(x):
        v = session.run(None, {"image": x})[0][0]
        sims = gallery @ v
        best = {}
        for k, s in zip(keys, sims):
            if s > best.get(k, -9):
                best[k] = float(s)
        top = sorted(best.items(), key=lambda kv: -kv[1])[:3]
        return top, top[0][1] - top[1][1]

    cases = []
    for sample in json.load(open(ROOT / "public/examples/manifest.json")):
        im = Image.open(ROOT / "public" / sample["file"].lstrip("/")).convert("RGB").resize((224, 224), Image.BILINEAR)
        x = (np.asarray(im, np.float32) / 255).transpose(2, 0, 1)[None]
        cases.append((sample["file"], product(sample["ndc"]), x))
    fixture = np.fromfile(ROOT / "tests/fixtures/pill.input.f32", dtype="<f4").reshape(1, 3, 224, 224)
    expected = json.load(open(ROOT / "tests/fixtures/pill.expected.json"))
    cases.append(("tests/fixtures/pill.input.f32", product(expected["ndc"]), fixture))

    ok = True
    for name, truth, x in cases:
        top, margin = rank(x)
        accepted = top[0][1] >= t["similarity"] and margin >= t["margin"]
        correct = top[0][0] == truth
        ok &= correct and accepted
        print(f"{name:34s} truth {truth} -> {top[0][0]} score {top[0][1]:.3f} margin {margin:.3f} "
              f"{'correct' if correct else 'WRONG'} {'accepted' if accepted else 'abstain'}")
    print("gate", t, "ALL OK" if ok else "SOME EXAMPLES FAIL")


if __name__ == "__main__":
    main()
