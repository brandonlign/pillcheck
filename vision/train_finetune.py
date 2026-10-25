"""Full fine-tuning of the DINOv2 pill encoder (v2). Research use, not clinical.

Differences from train_dino.py (v1, frozen backbone + small head):
- The whole ViT-S/14 backbone is fine-tuned with layer-wise learning-rate decay.
- Pill-specific GPU augmentation: any-angle rotation, scale/shift, lighting,
  contrast, mild saturation, blur and sensor noise. No mirror flips (imprints
  are never mirrored in real photos) and almost no hue shift (color matters).
- CosFace (additive cosine margin) classification loss over all identities.
- Gallery = reference sides averaged over 4 right-angle rotations, plus the
  training-split consumer photos (in-domain neighbours). Test images are never
  in the gallery or the training set.
- The exact image split from models/split.json (seed 2026) is reused, so the
  numbers are directly comparable with v1.

Usage: python vision/train_finetune.py --epochs 30
"""
import argparse, csv, json, math, random, time
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from torch import nn
from torch.nn import functional as F
import timm

ROOT = Path(__file__).resolve().parents[1]
SIZE = 224
STORE = 256


class Encoder(nn.Module):
    def __init__(self, name):
        super().__init__()
        self.backbone = timm.create_model(name, pretrained=True, num_classes=0, img_size=SIZE)
        self.register_buffer("mean", torch.tensor([.485, .456, .406]).reshape(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([.229, .224, .225]).reshape(1, 3, 1, 1))

    def forward(self, x):
        return self.backbone((x - self.mean) / self.std)


class Metric(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.projection = nn.Sequential(nn.Linear(width, width), nn.ReLU(), nn.Linear(width, 256))

    def forward(self, x):
        return F.normalize(self.projection(x), dim=1)


class PillModel(nn.Module):
    def __init__(self, encoder, metric):
        super().__init__()
        self.encoder = encoder
        self.metric = metric

    def forward(self, x):
        return self.metric(self.encoder(x))


def product(r):
    return f"{int(r['label_code_id']):05d}-{int(r['prod_code_id']):04d}"


def load_pixels(rows, data, cache):
    if cache.exists():
        return np.load(cache, mmap_mode="r")
    out = np.zeros((len(rows), STORE, STORE, 3), np.uint8)
    start = time.time()
    for i, r in enumerate(rows):
        im = Image.open(data / "classification_data" / r["image_path"]).convert("RGB")
        out[i] = np.asarray(im.resize((STORE, STORE), Image.BICUBIC))
        if i % 2000 == 0:
            print("cached", i, "/", len(rows), round(time.time() - start), "s", flush=True)
    np.save(cache, out)
    return np.load(cache, mmap_mode="r")


def to_float(batch_u8, device):
    # pixels is a memory-mapped uint8 array; copy only the requested rows.
    batch_u8 = torch.from_numpy(np.ascontiguousarray(batch_u8))
    return batch_u8.to(device, non_blocking=True).permute(0, 3, 1, 2).float().div_(255)


def augment(x):
    """x: (B,3,256,256) in [0,1] on GPU -> (B,3,224,224) augmented."""
    b = x.shape[0]
    dev = x.device
    theta = torch.rand(b, device=dev) * 2 * math.pi
    scale = torch.empty(b, device=dev).uniform_(0.82, 1.12)
    aspect = torch.empty(b, device=dev).uniform_(0.92, 1.08)
    shift = torch.empty(b, 2, device=dev).uniform_(-0.07, 0.07)
    cos, sin = torch.cos(theta), torch.sin(theta)
    mat = torch.zeros(b, 2, 3, device=dev)
    mat[:, 0, 0] = cos * scale * aspect
    mat[:, 0, 1] = -sin * scale
    mat[:, 1, 0] = sin * scale * aspect
    mat[:, 1, 1] = cos * scale
    mat[:, :, 2] = shift
    grid = F.affine_grid(mat, (b, 3, SIZE, SIZE), align_corners=False)
    # Fill uncovered corners with the image's own border colour, like a real mat.
    border = torch.cat([x[:, :, :6].flatten(2), x[:, :, -6:].flatten(2)], 2).median(2).values
    out = F.grid_sample(x - border[:, :, None, None], grid, mode="bilinear",
                        padding_mode="zeros", align_corners=False) + border[:, :, None, None]
    # Photometric: brightness, contrast, saturation, colour temperature.
    bright = torch.empty(b, 1, 1, 1, device=dev).uniform_(0.75, 1.25)
    contrast = torch.empty(b, 1, 1, 1, device=dev).uniform_(0.75, 1.25)
    sat = torch.empty(b, 1, 1, 1, device=dev).uniform_(0.8, 1.2)
    temp = torch.empty(b, 3, 1, 1, device=dev).uniform_(-0.04, 0.04)
    out = out * bright
    mean = out.mean((1, 2, 3), keepdim=True)
    out = (out - mean) * contrast + mean
    gray = out.mean(1, keepdim=True)
    out = (out - gray) * sat + gray + temp
    # Occasional blur (defocus / motion) and sensor noise.
    blur = torch.rand(b, device=dev) < 0.3
    if blur.any():
        k = torch.tensor([1., 4., 6., 4., 1.], device=dev)
        k = (k[:, None] * k[None, :]) / 256
        blurred = F.conv2d(F.pad(out[blur], (2, 2, 2, 2), mode="replicate"),
                           k.expand(3, 1, 5, 5), groups=3)
        out[blur] = blurred
    out = out + torch.randn_like(out) * torch.empty(b, 1, 1, 1, device=dev).uniform_(0, 0.03)
    return out.clamp_(0, 1)


def plain(x):
    return F.interpolate(x, size=(SIZE, SIZE), mode="bilinear", align_corners=False, antialias=True)


@torch.inference_mode()
def embed(model, pixels, indices, device, rotations=(0,), bs=256):
    parts = []
    for s in range(0, len(indices), bs):
        x = plain(to_float(pixels[np.asarray(indices[s:s + bs])], device))
        acc = 0
        for k in rotations:
            with torch.autocast("cuda", dtype=torch.bfloat16):
                acc = acc + model(torch.rot90(x, k, (2, 3))).float()
        parts.append(F.normalize(acc, dim=1))
    return torch.cat(parts)


def retrieve(q, g, gproducts, truth, k=3):
    """Product-NDC retrieval with distinct-product top-k, score and runner-up margin."""
    sims = q @ g.T
    top = sims.topk(min(200, g.shape[0]), dim=1)
    scores, margins, correct, top3 = [], [], [], []
    vals, inds = top.values.cpu().numpy(), top.indices.cpu().numpy()
    for j in range(len(q)):
        seen, distinct = set(), []
        for v, i in zip(vals[j], inds[j]):
            p = gproducts[i]
            if p in seen:
                continue
            seen.add(p)
            distinct.append((p, float(v)))
            if len(distinct) == k:
                break
        scores.append(distinct[0][1])
        margins.append(distinct[0][1] - distinct[1][1])
        correct.append(distinct[0][0] == truth[j])
        top3.append(any(p == truth[j] for p, _ in distinct))
    return {"scores": np.array(scores), "margins": np.array(margins),
            "correct": np.array(correct), "top3": np.array(top3)}


def select_gate(cal, precision_floor=0.90, min_n=10):
    best = (0, .98, .10, 0.0)
    for t in np.arange(.30, .981, .01):
        for m in np.arange(.00, .241, .01):
            sel = (cal["scores"] >= t) & (cal["margins"] >= m)
            n = int(sel.sum())
            if n >= min_n:
                p = float(cal["correct"][sel].mean())
                if p >= precision_floor and n > best[0]:
                    best = (n, float(t), float(m), p)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "work/dataset/ePillID_data")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--arch", default="vit_small_patch14_dinov2.lvd142m")
    ap.add_argument("--lr", type=float, default=4e-5)
    ap.add_argument("--layer-decay", type=float, default=0.8)
    ap.add_argument("--out", type=Path, default=ROOT / "work/v2-export")
    ap.add_argument("--resume", type=Path, help="continue from a saved model checkpoint")
    ap.add_argument("--start-epoch", type=int, default=0, help="epoch to resume the LR schedule at")
    ap.add_argument("--nice", action="store_true", help="run at idle CPU priority so the PC stays responsive")
    args = ap.parse_args()
    if args.nice and hasattr(__import__("ctypes"), "windll"):
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x40)
    elif args.nice:
        __import__("os").nice(19)
    random.seed(2026); np.random.seed(2026); torch.manual_seed(2026)
    device = "cuda"
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    rows = list(csv.DictReader(open(args.data / "all_labels.csv")))
    ids = sorted(set(r["pilltype_id"] for r in rows))
    idmap = {x: i for i, x in enumerate(ids)}
    rowmap = {r["image_path"]: i for i, r in enumerate(rows)}
    split = json.load(open(ROOT / "models/split.json"))
    train = [rowmap[p] for p in split["train"]]
    cal = [rowmap[p] for p in split["calibration"]]
    test = [rowmap[p] for p in split["test"]]
    refs = [i for i, r in enumerate(rows) if r["is_ref"] == "True"]
    train_cons = [i for i in train if rows[i]["is_ref"] != "True"]
    assert not set(test) & set(train) and not set(cal) & set(train)
    print("train", len(train), "cal", len(cal), "test", len(test), "refs", len(refs), flush=True)

    pixels = load_pixels(rows, args.data, ROOT / "work/pixels256.npy")
    labels = torch.tensor([idmap[r["pilltype_id"]] for r in rows])
    products = [product(r) for r in rows]

    encoder = Encoder(args.arch)
    width = encoder.backbone.num_features
    metric = Metric(width)
    model = PillModel(encoder, metric).to(device)
    classifier = nn.Parameter(torch.randn(len(ids), 256, device=device) * 0.01)
    classifier_path = ROOT / "models/v2-best-classifier.pt"
    if args.resume:
        model.load_state_dict(torch.load(args.resume, map_location=device, weights_only=True))
        with torch.no_grad():
            if classifier_path.exists():
                classifier.copy_(torch.load(classifier_path, map_location=device, weights_only=True))
            else:
                # No saved class weights: start each class at its mean training embedding.
                z = embed(model, pixels, train, device)
                y = labels[train].to(device)
                proxy = torch.zeros(len(ids), z.shape[1], device=device).index_add_(0, y, z)
                classifier.copy_(F.normalize(proxy, dim=1))
        print("resumed from", args.resume, "at epoch", args.start_epoch, flush=True)

    # Layer-wise LR decay: later transformer blocks adapt more than early ones.
    blocks = model.encoder.backbone.blocks
    depth = len(blocks)
    groups = []
    for name, p in model.encoder.named_parameters():
        if ".blocks." in name:
            layer = int(name.split(".blocks.")[1].split(".")[0]) + 1
        elif any(k in name for k in ("norm.", "fc_norm")) and ".blocks." not in name:
            layer = depth + 1
        else:
            layer = 0
        groups.append({"params": [p], "lr": args.lr * args.layer_decay ** (depth + 1 - layer),
                       "weight_decay": 0.0 if p.ndim == 1 else 0.05})
    groups.append({"params": list(model.metric.parameters()), "lr": 1e-3, "weight_decay": 1e-4})
    groups.append({"params": [classifier], "lr": 3e-3, "weight_decay": 0.0})
    for g in groups:
        g["base_lr"] = g["lr"]
    opt = torch.optim.AdamW(groups, betas=(0.9, 0.999))

    steps_per_epoch = math.ceil(len(train) / args.batch)
    total = steps_per_epoch * args.epochs
    warm = steps_per_epoch
    s, m = 30.0, 0.25

    gallery_rows = refs + train_cons
    gproducts = [products[i] for i in gallery_rows]

    def evaluate(indices, ref_rot=(0, 1, 2, 3), query_rot=(0,), with_consumer=True):
        model.eval()
        g_ref = embed(model, pixels, refs, device, ref_rot)
        g = torch.cat([g_ref, embed(model, pixels, train_cons, device, ref_rot)]) if with_consumer else g_ref
        gp = gproducts if with_consumer else gproducts[:len(refs)]
        q = embed(model, pixels, indices, device, query_rot)
        return retrieve(q, g, gp, [products[i] for i in indices])

    if args.resume:
        base = {"correct": np.array([0.1179])}  # measured on the first (fresh) run
    else:
        base = evaluate(cal, ref_rot=(0,), with_consumer=False)
    print("pretrained cal top1", round(base["correct"].mean(), 4), flush=True)

    best, best_path = -1, ROOT / "models/v2-best.pt"
    step = start_step = args.start_epoch * steps_per_epoch
    train_t = torch.tensor(train)
    for epoch in range(args.start_epoch, args.epochs):
        model.train()
        order = train_t[torch.randperm(len(train_t))]
        t0, losses = time.time(), []
        for batch in order.split(args.batch):
            lr_scale = step / warm if step < warm else 0.5 * (1 + math.cos(math.pi * (step - warm) / (total - warm)))
            if args.resume:  # optimizer state is fresh after a resume, so ease back in
                lr_scale *= min(1.0, (step - start_step + 1) / (warm / 2))
            for g in opt.param_groups:
                g["lr"] = g["base_lr"] * lr_scale
            x = augment(to_float(pixels[np.sort(batch.numpy())], device))
            y = labels[torch.from_numpy(np.sort(batch.numpy()))].to(device)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                z = model(x)
            z = z.float()
            logits = z @ F.normalize(classifier, dim=1).T
            logits = s * (logits - m * F.one_hot(y, len(ids)))
            loss = F.cross_entropy(logits, y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            losses.append(loss.item())
            step += 1
        msg = f"epoch {epoch} loss {np.mean(losses):.3f} {time.time() - t0:.0f}s"
        if epoch % 2 == 1 or epoch == args.epochs - 1:
            ev = evaluate(cal)
            acc = float(ev["correct"].mean())
            msg += f" cal top1 {acc:.4f} top3 {ev['top3'].mean():.4f}"
            if acc > best:
                best = acc
                torch.save(model.state_dict(), best_path)
                torch.save(classifier.detach(), classifier_path)
                msg += " *"
        print(msg, flush=True)

    model.load_state_dict(torch.load(best_path, map_location=device, weights_only=True))
    # Ablations on calibration only, to choose gallery and query settings.
    options = {
        "refs_only": dict(ref_rot=(0,), with_consumer=False),
        "refs_rot4": dict(ref_rot=(0, 1, 2, 3), with_consumer=False),
        "refs_rot4+consumer": dict(ref_rot=(0, 1, 2, 3), with_consumer=True),
        "refs_rot4+consumer+queryrot4": dict(ref_rot=(0, 1, 2, 3), with_consumer=True, query_rot=(0, 1, 2, 3)),
    }
    ablation = {}
    for k, o in options.items():
        ablation[k] = float(evaluate(cal, **o)["correct"].mean())
        print("cal", k, round(ablation[k], 4), flush=True)
    # The browser runs one forward pass per pill: prefer query_rot=(0,) unless TTA is decisively better.
    chosen = "refs_rot4+consumer" if ablation["refs_rot4+consumer"] >= ablation["refs_rot4"] else "refs_rot4"
    o = options[chosen]
    calout = evaluate(cal, **o)
    testout = evaluate(test, **o)
    n, t, mg, prec = select_gate(calout)
    acc_test = (testout["scores"] >= t) & (testout["margins"] >= mg)
    n95, t95, m95, p95 = select_gate(calout, 0.95)
    acc95 = (testout["scores"] >= t95) & (testout["margins"] >= m95)
    report = {
        "seed": 2026, "dataset": "ePillID 1.0", "pillTypes": len(ids), "referenceImages": len(refs),
        "trainingImages": len(train), "calibrationImages": len(cal), "testImages": len(test),
        "model": "pillcheck-dinov2-finetune-v2", "encoder": "DINOv2 ViT-S/14 (fully fine-tuned)",
        "pretrainedCalibrationTop1": float(base["correct"].mean()),
        "trainedCalibrationTop1": float(calout["correct"].mean()),
        "testTop1": float(testout["correct"].mean()), "testTop3": float(testout["top3"].mean()),
        "testAccepted": int(acc_test.sum()), "testAcceptedCorrect": int(testout["correct"][acc_test].sum()),
        "calibrationAccepted": n, "calibrationAcceptedCorrect": round(n * prec),
        "scoreThreshold": t, "marginThreshold": mg,
        "strictGate": {"precisionFloor": 0.95, "scoreThreshold": t95, "marginThreshold": m95,
                       "testAccepted": int(acc95.sum()), "testAcceptedCorrect": int(testout["correct"][acc95].sum())},
        "gallery": chosen, "galleryRows": len(refs) + (len(train_cons) if "consumer" in chosen else 0),
        "calibrationAblation": ablation, "epochs": args.epochs,
        "previous": {"model": "pillcheck-dinov2-metric-v1", "testTop1": 0.53125, "testTop3": 0.7625,
                     "testAccepted": 200, "testAcceptedCorrect": 178},
        "note": "Image-held-out benchmark on the same split as v1 (models/split.json). Product-NDC retrieval. "
                "Gate selected on calibration only (largest accepted set with >=90% calibration precision). "
                "Similarity is not probability; no open-world or clinical guarantee.",
    }
    print(json.dumps(report, indent=2), flush=True)

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    g = embed(model, pixels, refs, device, (0, 1, 2, 3))
    gallery_ids = [labels[i].item() for i in refs]
    if "consumer" in chosen:
        g = torch.cat([g, embed(model, pixels, train_cons, device, (0, 1, 2, 3))])
        gallery_ids += [labels[i].item() for i in train_cons]
    g.cpu().numpy().astype("<f4").tofile(out / "gallery.f32")
    (out / "evaluation.json").write_text(json.dumps(report, indent=2))
    manifest = json.load(open(ROOT / "public/models/catalog.json"))
    manifest.update({"referenceCount": len(gallery_ids), "referenceIds": gallery_ids,
                     "thresholds": {"similarity": t, "margin": mg},
                     "model": report["model"], "encoder": report["encoder"],
                     "gallery": "Reference sides (4-rotation averaged) plus training-split consumer photos"})
    (out / "catalog.json").write_text(json.dumps(manifest, separators=(",", ":")))
    model = model.float().cpu().eval()
    torch.save(model.state_dict(), ROOT / "models/v2-pill-model.pt")
    torch.onnx.export(model, torch.zeros(1, 3, SIZE, SIZE), str(out / "pill-encoder.onnx"),
                      input_names=["image"], output_names=["embedding"], opset_version=17, dynamo=False)
    np.save(out / "test-scores.npy", np.stack([testout["scores"], testout["margins"], testout["correct"]]))
    print("EXPORTED", out, flush=True)


if __name__ == "__main__":
    main()
