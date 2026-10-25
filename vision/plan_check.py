"""Plan-aware check: "is this pill one of the medicines in this plan, or not?"

For every held-out photo (true product t) three trials are simulated:
  right pill  : plan = {t, two random other products}  -> should confirm t
  wrong pill  : plan = three random products, none = t -> must not confirm
  look-alike  : plan = {the product the model finds most similar to t, other
                than t itself}                           -> must not confirm
                (the dangerous case: a different drug that looks like your med)

Decision for a photo against a plan: take the plan medicine X with the highest
score s_X. Confirm X when
  s_X >= T                       (it really looks like X),
  s_X >= best_any_product - E    (nothing outside the plan looks clearly better),
  s_X - second_plan_score >= M   (it is not ambiguous between two plan medicines).
T, E, M are chosen on the calibration split only, maximising right-pill
coverage subject to: right-pill precision >= 99.5%, random wrong pills
confirmed <= 0.5%, look-alike wrong pills confirmed <= 1%. Test is scored once.

Usage: python vision/plan_check.py --nice
"""
import argparse, csv, json, random
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from train_finetune import Encoder, Metric, PillModel, load_pixels, product
from confidence_gate import rot_embeddings
from two_sided import product_scores

ROOT = Path(__file__).resolve().parents[1]


def trials(S, truth, rng):
    """Build plans for the three trial types. S: (N, P) numpy product scores."""
    n, P = S.shape
    pos, neg, adv = [], [], []
    for i in range(n):
        t = truth[i]
        others = [p for p in rng.sample(range(P), 6) if p != t]
        pos.append([t] + others[:2])
        neg.append(others[2:5])
        s = S[i].copy()
        s[t] = -9
        adv.append([int(s.argmax())])
    return pos, neg, adv


def decide(S, plans, T, E, M):
    """Return the confirmed plan product per photo, or -1."""
    best_any = S.max(1)
    out = np.full(len(plans), -1)
    for i, plan in enumerate(plans):
        sc = S[i, plan]
        order = np.argsort(-sc)
        x, sx = plan[order[0]], sc[order[0]]
        s2 = sc[order[1]] if len(plan) > 1 else -9
        if sx >= T and sx >= best_any[i] - E and sx - s2 >= M:
            out[i] = x
    return out


def evaluate(S, truth, plans, T, E, M):
    pos, neg, adv = plans
    p = decide(S, pos, T, E, M)
    confirmed = p >= 0
    correct = p == truth
    return {
        "rightConfirmed": float(confirmed.mean()),
        "rightPrecision": float(correct[confirmed].mean()) if confirmed.any() else 1.0,
        "rightWrongMed": int((confirmed & ~correct).sum()),
        "wrongConfirmed": float((decide(S, neg, T, E, M) >= 0).mean()),
        "lookalikeConfirmed": float((decide(S, adv, T, E, M) >= 0).mean()),
        "n": len(truth),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "work/dataset/ePillID_data")
    ap.add_argument("--nice", action="store_true")
    args = ap.parse_args()
    if args.nice:
        import ctypes
        if hasattr(ctypes, "windll"):
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x40)
    cache = ROOT / "work/plan_scores.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        Scal, tcal, Stest, ttest, keys = z["Scal"], z["tcal"], z["Stest"], z["ttest"], list(z["keys"])
    else:
        device = "cuda"
        rows = list(csv.DictReader(open(args.data / "all_labels.csv")))
        rm = {r["image_path"]: i for i, r in enumerate(rows)}
        split = json.load(open(ROOT / "models/split.json"))
        catalog = json.load(open(ROOT / "public/models/catalog.json"))
        g = np.fromfile(ROOT / "public/models/gallery.f32", dtype="<f4").reshape(catalog["referenceCount"], catalog["embeddingSize"])
        gkeys = [product({"label_code_id": c["ndc"].split("-")[0], "prod_code_id": c["ndc"].split("-")[1]})
                 for c in (catalog["catalog"][i] for i in catalog["referenceIds"])]
        keys = sorted(set(gkeys))
        kidx = {k: i for i, k in enumerate(keys)}
        gidx = torch.tensor([kidx[k] for k in gkeys], device=device)[None, :]
        g = torch.from_numpy(g).to(device)
        encoder = Encoder("vit_small_patch14_dinov2.lvd142m")
        model = PillModel(encoder, Metric(encoder.backbone.num_features))
        model.load_state_dict(torch.load(ROOT / "models/v2-pill-model.pt", map_location="cpu", weights_only=True))
        model = model.to(device).eval()
        pixels = load_pixels(rows, args.data, ROOT / "work/pixels256.npy")

        def scores(paths):
            idx = [rm[p] for p in paths]
            e = F.normalize(rot_embeddings(model, pixels, idx, device).mean(0), dim=1)
            return product_scores(e, g, gidx, len(keys)).cpu().numpy(), np.array([kidx[product(rows[i])] for i in idx])

        Scal, tcal = scores(split["calibration"])
        Stest, ttest = scores(split["test"])
        np.savez(cache, Scal=Scal, tcal=tcal, Stest=Stest, ttest=ttest, keys=np.array(keys))

    cal_plans = trials(Scal, tcal, random.Random(1))
    test_plans = trials(Stest, ttest, random.Random(2))
    best = None
    for T in np.arange(0.30, 0.86, 0.02):
        for E in (0.0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12):
            for M in (0.0, 0.02, 0.05, 0.1):
                r = evaluate(Scal, tcal, cal_plans, T, E, M)
                ok = r["rightPrecision"] >= 0.995 and r["wrongConfirmed"] <= 0.005 and r["lookalikeConfirmed"] <= 0.01
                if ok and (best is None or r["rightConfirmed"] > best[0]["rightConfirmed"]):
                    best = (r, float(T), E, M)
    r_cal, T, E, M = best
    r_test = evaluate(Stest, ttest, test_plans, T, E, M)
    report = {"gate": {"similarity": round(T, 2), "aheadOfAll": E, "planMargin": M},
              "calibration": r_cal, "test": r_test}
    print(json.dumps(report, indent=2))
    (ROOT / "work/plan_check.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
