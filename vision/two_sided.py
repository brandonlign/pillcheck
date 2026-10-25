"""Measure a two-sided check: scan the pill, flip it, scan the other side.

Uses only held-out photos: for each pill identity that has a calibration photo
of one side and a test photo of the other side, the two photos' product scores
are added. A gate (similarity sum and runner-up margin) is chosen with 2-fold
cross-validation over identities, so every reported number comes from the fold
the gate was NOT tuned on. Single-photo results on the same pills are reported
for comparison.

Usage: python vision/two_sided.py --nice
"""
import argparse, csv, json, random
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from train_finetune import Encoder, Metric, PillModel, load_pixels, product
from confidence_gate import rot_embeddings

ROOT = Path(__file__).resolve().parents[1]


def product_scores(emb, g, gkey_idx, n_products):
    """Max similarity per product for each query: (N, P)."""
    out = []
    for s in range(0, len(emb), 64):
        sims = emb[s:s + 64] @ g.T
        best = torch.full((sims.shape[0], n_products), -1.0, device=sims.device)
        best.scatter_reduce_(1, gkey_idx.expand(sims.shape[0], -1), sims, reduce="amax")
        out.append(best)
    return torch.cat(out)


def decide(scores):
    top = scores.topk(2, dim=1)
    return top.indices[:, 0], top.values[:, 0], top.values[:, 0] - top.values[:, 1]


def best_gate(score, margin, correct, floor, min_n=20):
    best = None
    for t in np.unique(np.round(score, 2)):
        for m in np.arange(0, 0.6, 0.01):
            sel = (score >= t) & (margin >= m)
            n = int(sel.sum())
            if n >= min_n and correct[sel].mean() >= floor and (best is None or n > best[0]):
                best = (n, float(t), float(m))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "work/dataset/ePillID_data")
    ap.add_argument("--nice", action="store_true")
    args = ap.parse_args()
    if args.nice:
        import ctypes
        if hasattr(ctypes, "windll"):
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x40)
    device = "cuda"
    rows = list(csv.DictReader(open(args.data / "all_labels.csv")))
    rm = {r["image_path"]: i for i, r in enumerate(rows)}
    split = json.load(open(ROOT / "models/split.json"))
    cal = {rows[rm[p]]["pilltype_id"]: rm[p] for p in split["calibration"]}
    test = {rows[rm[p]]["pilltype_id"]: rm[p] for p in split["test"]}
    pairs = sorted(k for k in test if k in cal and rows[cal[k]]["is_front"] != rows[test[k]]["is_front"])
    print("held-out front/back pairs:", len(pairs), flush=True)

    catalog = json.load(open(ROOT / "public/models/catalog.json"))
    g = np.fromfile(ROOT / "public/models/gallery.f32", dtype="<f4").reshape(catalog["referenceCount"], catalog["embeddingSize"])
    gkeys = [product({"label_code_id": c["ndc"].split("-")[0], "prod_code_id": c["ndc"].split("-")[1]})
             for c in (catalog["catalog"][i] for i in catalog["referenceIds"])]
    keys = sorted(set(gkeys))
    kidx = {k: i for i, k in enumerate(keys)}
    gkey_idx = torch.tensor([kidx[k] for k in gkeys], device=device)[None, :]
    g = torch.from_numpy(g).to(device)

    encoder = Encoder("vit_small_patch14_dinov2.lvd142m")
    model = PillModel(encoder, Metric(encoder.backbone.num_features))
    model.load_state_dict(torch.load(ROOT / "models/v2-pill-model.pt", map_location="cpu", weights_only=True))
    model = model.to(device).eval()
    pixels = load_pixels(rows, args.data, ROOT / "work/pixels256.npy")

    def embed(indices):
        e4 = rot_embeddings(model, pixels, indices, device)
        return F.normalize(e4.mean(0), dim=1)

    a = product_scores(embed([cal[k] for k in pairs]), g, gkey_idx, len(keys))
    b = product_scores(embed([test[k] for k in pairs]), g, gkey_idx, len(keys))
    truth = torch.tensor([kidx[product(rows[test[k]])] for k in pairs], device=device)

    results = {}
    for name, sc in (("single (test side only)", b), ("two-sided (both photos)", a + b)):
        pred, score, margin = decide(sc)
        correct = (pred == truth).cpu().numpy()
        score, margin = score.cpu().numpy(), margin.cpu().numpy()
        # 2-fold cross-validation by identity for the gate.
        rng = random.Random(2026)
        order = list(range(len(pairs)))
        rng.shuffle(order)
        folds = [np.array(order[0::2]), np.array(order[1::2])]
        res = {"top1": float(correct.mean())}
        for floor in (0.99, 1.0):
            acc_n = acc_ok = 0
            gates = []
            for i in (0, 1):
                tune, hold = folds[i], folds[1 - i]
                gate = best_gate(score[tune], margin[tune], correct[tune], floor)
                if not gate:
                    continue
                _, t, m = gate
                sel = (score[hold] >= t) & (margin[hold] >= m)
                acc_n += int(sel.sum())
                acc_ok += int(correct[hold][sel].sum())
                gates.append({"score": t, "margin": m})
            res[f"gate_{floor}"] = {"coverage": acc_n / len(pairs), "accepted": acc_n, "correct": acc_ok,
                                    "precision": acc_ok / acc_n if acc_n else None, "gates": gates}
        results[name] = res
        print(name, json.dumps(res, indent=1), flush=True)
    (ROOT / "work/two_sided.json").write_text(json.dumps({"pairs": len(pairs), "results": results}, indent=2))


if __name__ == "__main__":
    main()
