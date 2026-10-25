"""Finalize the v2 export: apply the strict (95% calibration precision) gate and
re-select illustrative examples that the shipped model handles under that gate.

The strict gate was chosen over the 90% gate because a medication check should
favour being right when it answers; both gates were selected on calibration
only and both test results are kept in evaluation.json.

Usage: python vision/finalize_v2.py   (reads and rewrites work/v2-export)
"""
import csv, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "work/v2-export"
DATA = ROOT / "work/dataset/ePillID_data"


def main():
    report = json.load(open(SRC / "evaluation.json"))
    catalog = json.load(open(SRC / "catalog.json"))
    strict = report["strictGate"]
    report["standardGate"] = {
        "precisionFloor": 0.90, "scoreThreshold": report["scoreThreshold"],
        "marginThreshold": report["marginThreshold"], "testAccepted": report["testAccepted"],
        "testAcceptedCorrect": report["testAcceptedCorrect"],
    }
    report.update({"scoreThreshold": strict["scoreThreshold"], "marginThreshold": strict["marginThreshold"],
                   "testAccepted": strict["testAccepted"], "testAcceptedCorrect": strict["testAcceptedCorrect"],
                   "shippedGate": "strict (>=95% calibration precision)"})
    catalog["thresholds"] = {"similarity": strict["scoreThreshold"], "margin": strict["marginThreshold"]}

    # Examples: correct, accepted test photos, preferring confident and visually varied ones.
    rows = list(csv.DictReader(open(DATA / "all_labels.csv")))
    rowmap = {r["image_path"]: r for r in rows}
    test = json.load(open(ROOT / "models/split.json"))["test"]
    scores, margins, correct = np.load(SRC / "test-scores.npy")
    ok = [i for i in range(len(test))
          if correct[i] and scores[i] >= strict["scoreThreshold"] and margins[i] >= strict["marginThreshold"]]
    ok.sort(key=lambda i: -(margins[i]))
    chosen, seen = [], set()
    for i in ok:
        r = rowmap[test[i]]
        im = Image.open(DATA / "classification_data" / r["image_path"]).convert("RGB")
        colour = tuple((np.asarray(im.resize((8, 8))).reshape(-1, 3).mean(0) // 48).astype(int))
        ndc = f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}"
        if colour in seen or any(c[1] == ndc for c in chosen):
            continue
        seen.add(colour)
        chosen.append((i, ndc, r, im))
        if len(chosen) == 4:
            break
    out = ROOT / "public/examples"
    samples = []
    for j, (i, ndc, r, im) in enumerate(chosen):
        im.save(out / f"pill-{j + 1}.jpg", quality=95)
        samples.append({"file": f"/examples/pill-{j + 1}.jpg", "id": r["pilltype_id"], "ndc": ndc,
                        "sourceImage": r["image_path"], "split": "test", "accepted": True,
                        "score": round(float(scores[i]), 4), "margin": round(float(margins[i]), 4),
                        "selected": "Correct, confidently accepted v2 test prediction chosen after evaluation for "
                                    "illustration (high margin, varied colours); not a random sample and not used "
                                    "to calculate metrics."})
    (out / "manifest.json").write_text(json.dumps(samples, indent=2))
    # A controlled two-pill scene exercises segmentation and counting, not a real-world study.
    scene = Image.new("RGB", (800, 440), (0, 0, 0))
    for j in range(2):
        scene.paste(ImageOps.contain(chosen[j][3], (240, 240)), (90 + j * 380, 90))
    scene.save(out / "dose-two.jpg", quality=96)
    (out / "dose-two.json").write_text(json.dumps(
        {"kind": "synthetic composite of held-out consumer photos", "expectedCount": 2, "sources": samples[:2]}, indent=2))
    (SRC / "evaluation.json").write_text(json.dumps(report, indent=2))
    (SRC / "catalog.json").write_text(json.dumps(catalog, separators=(",", ":")))
    print(json.dumps({k: report[k] for k in ("testTop1", "testTop3", "testAccepted", "testAcceptedCorrect",
                                             "scoreThreshold", "marginThreshold")}, indent=2))
    for s in samples:
        print(s["file"], s["ndc"], s["score"], s["margin"])


if __name__ == "__main__":
    main()
