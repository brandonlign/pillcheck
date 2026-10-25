"""Choose gates for the shipped flow: one photo, then flip only the unsure pills.

Step 1 checks the first photo against the plan with gate G1. Pills that are not
confirmed are flipped; step 2 averages both sides' product scores and checks
them with gate G2. Each gate is (T, E, M): plan medicine score >= T, within E of
the best score over all products, and M ahead of the next plan medicine.

Uses held-out front/back pairs (calibration photo + test photo of opposite
sides). Reported numbers come from 2-fold cross-validation by identity: gates
tuned on one half, scored on the other. The shipped gates are then tuned on
all pairs with the same constraints.

Constraints (the "safest" setting): right-pill precision >= 99.5%, random wrong
pills confirmed <= 0.5%, look-alike wrong pills confirmed <= 5% (whole flow).

Usage: python vision/flip_gate.py [--apply]   (needs work/plan_scores.npz from plan_check.py)
"""
import argparse, csv, json, random
from pathlib import Path
import numpy as np
from plan_check import trials, decide

ROOT = Path(__file__).resolve().parents[1]
GRID = [(round(float(T), 2), E, M) for T in np.arange(0.50, 0.92, 0.02) for E in (0.0, 0.01, 0.02, 0.03, 0.05) for M in (0.0, 0.02)]


def outcomes(S, plans):
    """Confirmed product per item for every gate: (len(GRID), 3 trial types, n)."""
    return np.stack([np.stack([decide(S, p, *g) for p in plans]) for g in GRID])


def combine(o1, o2, truth):
    """Flow result for every (G1, G2): coverage, precision, wrong, look-alike rates."""
    c = np.where(o1[:, None] >= 0, o1[:, None], o2[None, :])  # (G1, G2, 3, n)
    pos, neg, adv = c[:, :, 0], c[:, :, 1], c[:, :, 2]
    conf = pos >= 0
    cov = conf.mean(-1)
    prec = np.where(conf.sum(-1) > 0, (conf & (pos == truth)).sum(-1) / np.maximum(conf.sum(-1), 1), 1.0)
    return cov, prec, (neg >= 0).mean(-1), (adv >= 0).mean(-1)


def pick(cov, prec, wrong, look, cap):
    ok = (prec >= 0.995) & (wrong <= 0.005) & (look <= cap)
    if not ok.any():
        return None
    i, j = np.unravel_index(np.where(ok, cov, -1).argmax(), cov.shape)
    return int(i), int(j)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=float, default=0.05)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    z = np.load(ROOT / "work/plan_scores.npz", allow_pickle=True)
    Scal, Stest, ttest = z["Scal"], z["Stest"], z["ttest"]
    rows = list(csv.DictReader(open(ROOT / "work/dataset/ePillID_data/all_labels.csv")))
    rm = {r["image_path"]: r for r in rows}
    split = json.load(open(ROOT / "models/split.json"))
    cid = {rm[p]["pilltype_id"]: (i, rm[p]["is_front"]) for i, p in enumerate(split["calibration"])}
    tid = {rm[p]["pilltype_id"]: (i, rm[p]["is_front"]) for i, p in enumerate(split["test"])}
    pairs = [(cid[k][0], tid[k][0]) for k in tid if k in cid and cid[k][1] != tid[k][1]]
    first = np.stack([Stest[b] for a, b in pairs])           # first photo
    both = np.stack([(Scal[a] + Stest[b]) / 2 for a, b in pairs])  # after the flip
    truth = np.array([ttest[b] for a, b in pairs])

    idx = list(range(len(pairs)))
    random.Random(2026).shuffle(idx)
    folds = [np.array(idx[0::2]), np.array(idx[1::2])]
    agg = np.zeros(5)
    for f in (0, 1):
        tune, hold = folds[f], folds[1 - f]
        pt, ph = trials(first[tune], truth[tune], random.Random(1)), trials(first[hold], truth[hold], random.Random(2))
        # Same plans for both steps: a flip re-checks the same pill against the same plan.
        res_t = combine(outcomes(first[tune], pt), outcomes(both[tune], pt), truth[tune])
        g = pick(*res_t, args.cap)
        o1h, o2h = outcomes(first[hold], ph), outcomes(both[hold], ph)
        r = [x[0, 0] for x in combine(o1h[[g[0]]], o2h[[g[1]]], truth[hold])]
        step1 = (o1h[g[0], 0] >= 0).mean()
        n = len(hold)
        agg += np.array([r[0], r[1], 1 - r[2], 1 - r[3], step1]) * n
    cv = dict(zip(["rightConfirmed", "rightPrecision", "wrongCaught", "lookalikeCaught", "confirmedWithoutFlip"], (agg / len(pairs)).round(4).tolist()))

    plans = trials(first, truth, random.Random(3))
    res = combine(outcomes(first, plans), outcomes(both, plans), truth)
    gi, gj = pick(*res, args.cap)
    gate = {"photo": dict(zip(["similarity", "ahead", "margin"], GRID[gi])),
            "flipped": dict(zip(["similarity", "ahead", "margin"], GRID[gj]))}
    report = {"pairs": len(pairs), "lookalikeCap": args.cap, "heldOut2Fold": cv, "gate": gate}
    print(json.dumps(report, indent=2))
    (ROOT / "work/flip_gate.json").write_text(json.dumps(report, indent=2))
    if args.apply:
        cat = json.load(open(ROOT / "public/models/catalog.json"))
        cat["planGate"] = gate
        (ROOT / "public/models/catalog.json").write_text(json.dumps(cat, separators=(",", ":")))
        ev = json.load(open(ROOT / "public/models/evaluation.json"))
        ev["planCheck"] = {**report, "note": "Plan-aware check: is this pill one of the plan's medicines? "
                           "Photo first; unsure pills are flipped and both sides averaged. Held-out front/back "
                           "pairs, 2-fold cross-validated by identity. Look-alike = the plan holds the product the "
                           "model finds most similar to the pill. Small sample (359 pills); approximate."}
        (ROOT / "public/models/evaluation.json").write_text(json.dumps(ev, indent=2))
        print("APPLIED")


if __name__ == "__main__":
    main()
