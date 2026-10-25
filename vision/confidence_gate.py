"""Select a high-precision acceptance gate for the shipped v2 model (inference only).

The browser runs each pill crop at 0/90/180/270 degrees. A pill is accepted only
when the rotation-averaged match clears a similarity and margin threshold AND
enough of the individual rotations agree on the same product. The gate is chosen
on the calibration split only (largest accepted set whose calibration precision
meets the floor); the held-out test split is evaluated once afterwards.

Also simulates the app's real decision, checking a pill against a prescription
plan, including the hard case where the plan holds the pill's closest look-alike.

Usage: python vision/confidence_gate.py --nice
"""
import argparse, csv, json, random
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from train_finetune import Encoder, Metric, PillModel, load_pixels, to_float, plain, product

ROOT = Path(__file__).resolve().parents[1]


@torch.inference_mode()
def rot_embeddings(model, pixels, indices, device, bs=128):
    """(4, N, 256) normalized embeddings, one per right-angle rotation."""
    out = [[] for _ in range(4)]
    for s in range(0, len(indices), bs):
        x = plain(to_float(pixels[np.asarray(indices[s:s + bs])], device))
        for k in range(4):
            with torch.autocast("cuda", dtype=torch.bfloat16):
                out[k].append(F.normalize(model(torch.rot90(x, k, (2, 3))).float(), dim=1))
    return torch.stack([torch.cat(o) for o in out])


def ranked(q, g, gkeys, k=2):
    """Distinct-product top-k per query: list of [(product, score), ...]."""
    top = (q @ g.T).topk(200, dim=1)
    vals, inds = top.values.cpu().numpy(), top.indices.cpu().numpy()
    res = []
    for v, ix in zip(vals, inds):
        seen, best = set(), []
        for s, i in zip(v, ix):
            p = gkeys[i]
            if p in seen:
                continue
            seen.add(p)
            best.append((p, float(s)))
            if len(best) == k:
                break
        res.append(best)
    return res


def features(emb4, g, gkeys):
    avg = F.normalize(emb4.mean(0), dim=1)
    a = ranked(avg, g, gkeys, 3)
    per = [ranked(emb4[k], g, gkeys, 1) for k in range(4)]
    top = np.array([r[0][0] for r in a])
    score = np.array([r[0][1] for r in a])
    margin = np.array([r[0][1] - r[1][1] for r in a])
    agree = np.array([sum(per[k][i][0][0] == top[i] for k in range(4)) for i in range(len(a))])
    single = ranked(emb4[0], g, gkeys)
    top3 = np.array([[p for p, _ in r] for r in a], dtype=object)
    return {"top": top, "top3": top3, "score": score, "margin": margin, "agree": agree,
            "single_top": np.array([r[0][0] for r in single]),
            "single_score": np.array([r[0][1] for r in single]),
            "single_margin": np.array([r[0][1] - r[1][1] for r in single])}


def accept(f, gate):
    return (f["score"] >= gate["similarity"]) & (f["margin"] >= gate["margin"]) & (f["agree"] >= gate["agree"])


def search(f, truth, floor, min_n=30):
    correct = f["top"] == truth
    best = None
    for t in np.arange(0.40, 0.951, 0.01):
        for m in np.arange(0.0, 0.301, 0.01):
            for a in (2, 3, 4):
                gate = {"similarity": round(float(t), 2), "margin": round(float(m), 2), "agree": a}
                sel = accept(f, gate)
                n = int(sel.sum())
                if n < min_n:
                    continue
                prec = float(correct[sel].mean())
                if prec >= floor and (best is None or n > best[0]):
                    best = (n, gate, prec)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "work/dataset/ePillID_data")
    ap.add_argument("--floor", type=float, default=0.995, help="calibration precision floor")
    ap.add_argument("--nice", action="store_true")
    ap.add_argument("--apply", action="store_true", help="write the chosen gate into public/models")
    args = ap.parse_args()
    if args.nice:
        import ctypes
        if hasattr(ctypes, "windll"):
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x40)
    device = "cuda"
    rows = list(csv.DictReader(open(args.data / "all_labels.csv")))
    rowmap = {r["image_path"]: i for i, r in enumerate(rows)}
    split = json.load(open(ROOT / "models/split.json"))
    cal = [rowmap[p] for p in split["calibration"]]
    test = [rowmap[p] for p in split["test"]]
    products = [product(r) for r in rows]
    pixels = load_pixels(rows, args.data, ROOT / "work/pixels256.npy")

    catalog = json.load(open(ROOT / "public/models/catalog.json"))
    g = np.fromfile(ROOT / "public/models/gallery.f32", dtype="<f4").reshape(catalog["referenceCount"], catalog["embeddingSize"])
    g = torch.from_numpy(g).to(device)
    gkeys = [product({"label_code_id": c["ndc"].split("-")[0], "prod_code_id": c["ndc"].split("-")[1]})
             for c in (catalog["catalog"][i] for i in catalog["referenceIds"])]

    encoder = Encoder("vit_small_patch14_dinov2.lvd142m")
    model = PillModel(encoder, Metric(encoder.backbone.num_features))
    model.load_state_dict(torch.load(ROOT / "models/v2-pill-model.pt", map_location="cpu", weights_only=True))
    model = model.to(device).eval()

    cache = ROOT / "work/confidence_features.npz"
    out = {}
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        out = {k: z[k].item() for k in z.files}
    else:
        for name, idx in (("calibration", cal), ("test", test)):
            f = features(rot_embeddings(model, pixels, idx, device), g, gkeys)
            f["truth"] = np.array([products[i] for i in idx])
            out[name] = f
        np.savez(cache, **{k: np.array(v, dtype=object) for k, v in out.items()})
    calf, testf = out["calibration"], out["test"]

    # Sanity: single-rotation top-1 should reproduce the shipped evaluation.
    report = {"singleTop1": {k: float((v["single_top"] == v["truth"]).mean()) for k, v in out.items()},
              "rot4Top1": {k: float((v["top"] == v["truth"]).mean()) for k, v in out.items()},
              "rot4Top3": {k: float(np.mean([t in row for t, row in zip(v["truth"], v["top3"])])) for k, v in out.items()}}
    gates = {}
    for floor in (0.95, 0.97, 0.98, 0.99, 0.995, 1.0):
        best = search(calf, calf["truth"], floor, min_n=20)
        if not best:
            continue
        n, gate, prec = best
        sel = accept(testf, gate)
        ok = (testf["top"] == testf["truth"])[sel]
        gates[str(floor)] = {"gate": gate, "calibrationAccepted": n, "calibrationPrecision": prec,
                             "testAccepted": int(sel.sum()), "testCorrect": int(ok.sum()),
                             "testPrecision": float(ok.mean()) if sel.any() else None,
                             "testCoverage": float(sel.mean())}
    report["gates"] = gates

    # Plan check simulation on test, with the chosen gate.
    print(json.dumps(gates, indent=1), flush=True)
    usable = [k for k in gates if float(k) >= 0.99]
    chosen = gates[max(usable, key=float) if usable else max(gates, key=float)]["gate"]
    rng = random.Random(2026)
    all_products = sorted(set(gkeys))
    sel = accept(testf, chosen)
    # Right pill, plan of 3 meds: accepted as the correct plan med?
    right_match = int(((testf["top"] == testf["truth"]) & sel).sum())
    right_wrongmed = int(((testf["top"] != testf["truth"]) & sel).sum())
    # Wrong pill: plan contains 3 random other products, or the pill's closest look-alike.
    lookalike_plan_false_match = 0
    random_plan_false_match = 0
    for i in range(len(testf["top"])):
        truth = testf["truth"][i]
        others = [p for p in rng.sample(all_products, 4) if p != truth][:3]
        if sel[i] and testf["top"][i] in others:
            random_plan_false_match += 1
        if sel[i] and testf["top"][i] != truth:
            lookalike_plan_false_match += 1  # plan = {predicted look-alike}: any wrong accept is a false match
    n = len(testf["top"])
    report["planSimulation"] = {
        "gate": chosen, "testPhotos": n,
        "rightPillConfirmed": right_match, "rightPillMislabeled": right_wrongmed,
        "rightPillNotSure": n - right_match - right_wrongmed,
        "wrongPillFalseMatch_randomPlan": random_plan_false_match,
        "wrongPillFalseMatch_lookalikePlan": lookalike_plan_false_match,
    }
    print(json.dumps(report, indent=2))
    (ROOT / "work/confidence_gate.json").write_text(json.dumps(report, indent=2))
    if args.apply:
        key = max(usable, key=float) if usable else max(gates, key=float)
        g = gates[key]
        catalog["thresholds"] = dict(g["gate"])
        catalog["inference"] = "4 right-angle rotations, averaged; agreement counted per rotation"
        (ROOT / "public/models/catalog.json").write_text(json.dumps(catalog, separators=(",", ":")))
        ev = json.load(open(ROOT / "public/models/evaluation.json"))
        sim = report["planSimulation"]
        ev.update({
            "testTop1": report["rot4Top1"]["test"], "testTop3": report["rot4Top3"]["test"],
            "singlePassTestTop1": report["singleTop1"]["test"],
            "testAccepted": g["testAccepted"], "testAcceptedCorrect": g["testCorrect"],
            "calibrationAccepted": g["calibrationAccepted"],
            "calibrationAcceptedCorrect": round(g["calibrationAccepted"] * g["calibrationPrecision"]),
            "scoreThreshold": g["gate"]["similarity"], "marginThreshold": g["gate"]["margin"],
            "agreeThreshold": g["gate"]["agree"],
            "shippedGate": f"4-rotation agreement gate (highest calibration precision reachable with >=20 accepted: {float(key):.0%})",
            "gateCurve": gates, "planSimulation": sim,
            "wrongPillCaughtRandomPlan": 1 - sim["wrongPillFalseMatch_randomPlan"] / sim["testPhotos"],
            "wrongPillCaughtLookalikePlan": 1 - sim["wrongPillFalseMatch_lookalikePlan"] / sim["testPhotos"],
        })
        (ROOT / "public/models/evaluation.json").write_text(json.dumps(ev, indent=2))
        print("APPLIED", g["gate"])


if __name__ == "__main__":
    main()
