"""Train the pill finder: a small U-Net that outlines every pill in a phone photo.

Real photos with hand-drawn pill outlines don't exist for this project, so training
scenes are synthesized on the GPU: NIH pill cut-outs from ePillID
(segmented_nih_pills_224) are rotated, scaled and dropped onto surface photos
(marble, wood, counters, cloth, hands, paper) or generated surfaces, with soft
shadows, uneven light, blur, sensor noise, and distractors such as marble veins and
stains. Pills may touch or overlap.

The network predicts two maps: pill (any pill pixel) and edge (a thin band along each
pill's outline, including where two pills touch). In the app, pill minus edge gives
one blob per pill, so touching pills come apart.

Usage: python vision/train_segmenter.py --backgrounds DIR --steps 3500 --export
(The shipped model: 3,500 steps, batch 24, about 15 minutes on an RTX 3080 Ti. A
second pass that made a third of the pills white scored worse on real photos.)
"""
import argparse, glob, math, random, time
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
CUT = 128  # stored pill cut-out size
dev = "cuda"


def load_pills(limit, cache):
    if cache.exists():
        return torch.from_numpy(np.load(cache))
    files = sorted(glob.glob(str(ROOT / "work/dataset/ePillID_data/classification_data/segmented_nih_pills_224/*.jpg")))
    random.Random(0).shuffle(files)
    out = []
    for f in files[:limit]:
        rgb = np.asarray(Image.open(f).convert("RGB"))
        alpha = ndimage.binary_fill_holes(rgb.max(2) > 18)
        alpha = ndimage.binary_opening(alpha, iterations=1)
        ys, xs = np.nonzero(alpha)
        if len(ys) < 200:
            continue
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)[y0:y1, x0:x1]
        im = Image.fromarray(rgba, "RGBA")
        im.thumbnail((CUT, CUT), Image.LANCZOS)
        canvas = Image.new("RGBA", (CUT, CUT))
        canvas.paste(im, ((CUT - im.width) // 2, (CUT - im.height) // 2))
        out.append(np.asarray(canvas))
    arr = np.stack(out)
    np.save(cache, arr)
    return torch.from_numpy(arr)


def load_backgrounds(folder):
    bgs = []
    for f in sorted(glob.glob(str(Path(folder) / "*.jpg"))):
        im = Image.open(f).convert("RGB")
        s = 512 / min(im.size)
        im = im.resize((max(256, round(im.width * s)), max(256, round(im.height * s))), Image.BILINEAR)
        bgs.append(torch.from_numpy(np.asarray(im)).permute(2, 0, 1).float().div(255).to(dev))
    return bgs


def smooth_noise(b, s, cells):
    return F.interpolate(torch.randn(b, 1, cells, cells, device=dev), size=(s, s), mode="bicubic", align_corners=False)


def blur(x, sigma):
    if sigma <= 0.3:
        return x
    r = int(math.ceil(sigma * 2.5))
    k = torch.exp(-torch.arange(-r, r + 1, device=dev, dtype=torch.float32) ** 2 / (2 * sigma * sigma))
    k = k / k.sum()
    c = x.shape[1]
    x = F.conv2d(F.pad(x, (r, r, 0, 0), mode="replicate"), k.view(1, 1, 1, -1).repeat(c, 1, 1, 1), groups=c)
    return F.conv2d(F.pad(x, (0, 0, r, r), mode="replicate"), k.view(1, 1, -1, 1).repeat(c, 1, 1, 1), groups=c)


def surfaces(b, s, bgs):
    out = torch.empty(b, 3, s, s, device=dev)
    for i in range(b):
        if random.random() < 0.65:
            bg = random.choice(bgs)
            _, H, W = bg.shape
            c = random.randint(min(H, W) // 3, min(H, W))
            y, x = random.randint(0, H - c), random.randint(0, W - c)
            img = F.interpolate(bg[None, :, y : y + c, x : x + c], size=(s, s), mode="bilinear", align_corners=False)[0]
            if random.random() < 0.5:
                img = img.flip(2)
            img = img * torch.empty(3, 1, 1, device=dev).uniform_(0.85, 1.15)
        else:  # generated surface: plain, gradient, speckle or marble
            base = torch.rand(3, 1, 1, device=dev)
            if random.random() < 0.5:
                base = base * 0.3 + 0.7  # many real surfaces are light
            img = base.expand(3, s, s).clone()
            img = img + smooth_noise(1, s, random.choice([2, 4, 8]))[0] * random.uniform(0, 0.08)
            img = img + torch.randn(1, s, s, device=dev) * random.uniform(0, 0.03)
        if random.random() < 0.5:  # marble veins / wood lines / cracks
            n = smooth_noise(1, s, random.choice([3, 5, 8]))[0]
            width = random.uniform(0.02, 0.08)
            veins = torch.exp(-((n - random.uniform(-1, 1)) ** 2) / (2 * width * width))
            tint = torch.rand(3, 1, 1, device=dev) * 0.4
            img = img * (1 - veins * random.uniform(0.15, 0.6)) + veins * tint * 0.3
        if random.random() < 0.15:  # irregular stain (not a pill)
            m = (smooth_noise(1, s, 6)[0] > random.uniform(0.8, 1.6)).float()
            img = img * (1 - m) + m * torch.rand(3, 1, 1, device=dev)
        out[i] = img
    return out.clamp(0, 1)


def scenes(b, s, pills, bgs):
    img = surfaces(b, s, bgs)
    fg = torch.zeros(b, 1, s, s, device=dev)
    edge = torch.zeros(b, 1, s, s, device=dev)
    counts = [random.choice([1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 10]) for _ in range(b)]
    slots = max(counts)
    visible = [[] for _ in range(b)]
    for j in range(slots):
        idx = [i for i in range(b) if counts[i] > j]
        if not idx:
            break
        n = len(idx)
        src = pills[torch.randint(len(pills), (n,))].to(dev).permute(0, 3, 1, 2).float().div(255)
        # Pill size: longest side as a fraction of the image; single pills can be close-ups.
        frac = torch.tensor(
            [random.uniform(0.3, 0.8) if counts[i] == 1 and random.random() < 0.5 else random.uniform(0.07, 0.32) for i in idx],
            device=dev,
        )
        ang = torch.rand(n, device=dev) * 2 * math.pi
        tx = torch.empty(n, device=dev).uniform_(-0.85, 0.85)
        ty = torch.empty(n, device=dev).uniform_(-0.85, 0.85)
        sc = 1 / frac  # output->input scale
        cos, sin = torch.cos(ang) * sc, torch.sin(ang) * sc
        theta = torch.stack([torch.stack([cos, -sin, -(cos * tx - sin * ty)], 1), torch.stack([sin, cos, -(sin * tx + cos * ty)], 1)], 1)
        grid = F.affine_grid(theta, (n, 4, s, s), align_corners=False)
        warped = F.grid_sample(src, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
        rgb, a = warped[:, :3], warped[:, 3:4]
        # Lighting on the pill: exposure, slight tint, soft top-light shading.
        rgb = rgb * torch.empty(n, 1, 1, 1, device=dev).uniform_(0.7, 1.15) * torch.empty(n, 3, 1, 1, device=dev).uniform_(0.93, 1.07)
        # Shadow: the pill's silhouette, offset and blurred, darkens the surface.
        for k, i in enumerate(idx):
            L = frac[k].item() * s
            dx, dy = [int(random.uniform(-0.12, 0.12) * L) for _ in range(2)]
            sh = blur(torch.roll(a[k : k + 1], (dy, dx), (2, 3)), random.uniform(1, 0.15 * L + 1)) * random.uniform(0.15, 0.6)
            img[i : i + 1] = img[i : i + 1] * (1 - sh)
            ak = blur(a[k : k + 1], 0.6)
            img[i : i + 1] = img[i : i + 1] * (1 - ak) + rgb[k : k + 1] * ak
            hard = (a[k : k + 1] > 0.5).float()
            for v in visible[i]:
                v.mul_(1 - hard)
            visible[i].append(hard.clone())
    for i in range(b):
        for v in visible[i]:
            fg[i] += v[0]
            ring = F.max_pool2d(v, 5, 1, 2) - (-F.max_pool2d(-v, 5, 1, 2))
            edge[i] = torch.maximum(edge[i], ring[0])
    fg = fg.clamp(0, 1)
    # Whole-photo effects: uneven light, exposure, defocus, sensor noise.
    light = 1 + smooth_noise(b, s, 2) * torch.empty(b, 1, 1, 1, device=dev).uniform_(0, 0.25)
    img = img * light * torch.empty(b, 1, 1, 1, device=dev).uniform_(0.7, 1.2)
    sig = random.choice([0, 0, 0.6, 1.0, 1.6])
    img = blur(img, sig) + torch.randn_like(img) * random.uniform(0, 0.03)
    gray = torch.rand(b, 1, 1, 1, device=dev) < 0.05
    img = torch.where(gray, img.mean(1, keepdim=True).expand_as(img), img)
    return img.clamp(0, 1), fg, edge


def block(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class PillFinder(nn.Module):
    def __init__(self, ch=(16, 32, 64, 96, 128)):
        super().__init__()
        self.enc = nn.ModuleList([block(3, ch[0])] + [block(ch[k], ch[k + 1]) for k in range(len(ch) - 1)])
        self.dec = nn.ModuleList([block(ch[k + 1] + ch[k], ch[k]) for k in reversed(range(len(ch) - 1))])
        self.head = nn.Conv2d(ch[0], 2, 1)

    def forward(self, x):
        x = (x - 0.5) / 0.25
        skips = []
        for k, e in enumerate(self.enc):
            x = e(x if k == 0 else F.max_pool2d(x, 2))
            skips.append(x)
        for d, skip in zip(self.dec, reversed(skips[:-1])):
            x = d(torch.cat([F.interpolate(x, size=skip.shape[2:], mode="bilinear", align_corners=False), skip], 1))
        return self.head(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backgrounds", required=True)
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--init", help="continue from these weights")
    ap.add_argument("--lr", type=float, default=2e-3)
    args = ap.parse_args()
    random.seed(0)
    torch.manual_seed(0)
    pills = load_pills(9000, ROOT / "work/seg_pills.npy")
    bgs = load_backgrounds(args.backgrounds)
    print("pills", len(pills), "backgrounds", len(bgs), flush=True)
    model = PillFinder().to(dev)
    if args.init:
        model.load_state_dict(torch.load(args.init, map_location=dev, weights_only=True))
    print("params", sum(p.numel() for p in model.parameters()), flush=True)
    opt = torch.optim.AdamW(model.parameters(), args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, args.lr, total_steps=args.steps, pct_start=0.05)
    start = time.time()
    for step in range(args.steps):
        with torch.no_grad():
            img, fg, edge = scenes(args.batch, args.size, pills, bgs)
        out = model(img)
        p = torch.sigmoid(out[:, :1])
        dice = 1 - (2 * (p * fg).sum((2, 3)) + 1) / (p.sum((2, 3)) + fg.sum((2, 3)) + 1)
        loss = (F.binary_cross_entropy_with_logits(out[:, :1], fg) + dice.mean()
                + F.binary_cross_entropy_with_logits(out[:, 1:], edge, pos_weight=torch.tensor(3.0, device=dev)))
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        if step % 200 == 0 or step == args.steps - 1:
            print(f"step {step} loss {loss.item():.4f} {time.time() - start:.0f}s", flush=True)
    torch.save(model.state_dict(), ROOT / "work/pill-finder.pt")
    with torch.no_grad():
        img, fg, edge = scenes(8, args.size, pills, bgs)
        np.save(ROOT / "work/seg_preview.npy", np.concatenate([img.cpu().numpy(), fg.cpu().numpy(), edge.cpu().numpy(),
                                                                torch.sigmoid(model.eval()(img)).cpu().numpy()], 1))
    if args.export:
        model.eval().cpu()
        torch.onnx.export(model, torch.rand(1, 3, 256, 256), str(ROOT / "public/models/pill-finder.onnx"),
                          input_names=["image"], output_names=["maps"], opset_version=17, dynamo=False,
                          dynamic_axes={"image": {2: "h", 3: "w"}, "maps": {2: "h", 3: "w"}})
        print("exported", flush=True)


if __name__ == "__main__":
    main()
