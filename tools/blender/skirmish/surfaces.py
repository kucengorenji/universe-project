"""Painted, tileable surface textures for the skirmish environment (public/textures/skirmish_surfaces.png).

Every surface is a 512 x 512 tile that repeats seamlessly (all noise is periodic: white noise filtered
in the frequency domain; every pattern is laid out on the tile's own lattice). They are painted to
read like Valkyria Chronicles' watercolour-and-pencil textures: soft blotches of colour, brush
streaks along the grain, pattern edges in a darker wobbly line. The game stacks the tiles into a
texture array and samples them in world space (src/skirmish/battlefield/envKit.js); colour comes
mostly from here, the kit's vertex colours tint (plaster, paint) and darken (baked occlusion).

The strip is one tile wide, SURFACES in order from the top. Each tile spans TILE_M metres of world.

Run (plain Python 3 with numpy, or Blender's):  python3 surfaces.py <out.png>
"""
import struct
import sys
import zlib

import numpy as np

S = 512
SURFACES = ["plaster", "brick", "stone", "timber", "plank", "roof_tile", "concrete", "sandbag", "canvas", "metal",
            "leaf", "bark", "hay", "glass", "painted", "cobble", "grass", "dirt", "road", "wheat", "plough", "water"]
# metres of world one tile covers (the game reads the same table from envKit.js)
TILE_M = {"plaster": 2.0, "brick": 1.2, "stone": 1.6, "timber": 1.0, "plank": 1.2, "roof_tile": 1.6, "concrete": 2.0, "sandbag": 0.6,
          "canvas": 1.5, "metal": 1.0, "leaf": 1.4, "bark": 1.0, "hay": 1.0, "glass": 1.0, "painted": 1.2, "cobble": 1.4,
          "grass": 3.0, "dirt": 3.0, "road": 3.0, "wheat": 2.0, "plough": 3.0, "water": 6.0}

U = (np.arange(S) + 0.5) / S
X, Y = np.meshgrid(U, U)  # x across, y down the tile, 0..1


def rng(seed):
    return np.random.default_rng(seed)


def pnoise(seed, beta=2.0, lo=1.0, hi=None):
    """Periodic fractal noise in 0..1: white noise shaped by 1 / f^beta, band-limited to [lo, hi] cycles per tile."""
    g = rng(seed).standard_normal((S, S))
    f = np.fft.fftfreq(S) * S
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    amp = np.where(r >= lo, 1.0 / np.maximum(r, 1e-6) ** (beta / 2), 0.0)
    if hi:
        amp *= np.clip((hi - r) / (0.25 * hi), 0, 1)
    out = np.real(np.fft.ifft2(np.fft.fft2(g) * amp))
    out -= out.min()
    return out / max(out.max(), 1e-9)


def streaks(seed, angle=0.0, length=40, beta=1.6):
    """Brush streaks: periodic noise stretched along a direction (angle 0 = across)."""
    g = rng(seed).standard_normal((S, S))
    f = np.fft.fftfreq(S) * S
    fx, fy = np.meshgrid(f, f)
    c, s = np.cos(angle), np.sin(angle)
    a = fx * c + fy * s  # along the stroke: low frequencies only
    b = -fx * s + fy * c
    r = np.sqrt((a * length / 8) ** 2 + b * b)
    amp = np.where(r > 0.5, 1.0 / np.maximum(r, 1e-6) ** (beta / 2), 0.0)
    out = np.real(np.fft.ifft2(np.fft.fft2(g) * amp))
    out -= out.min()
    return out / max(out.max(), 1e-9)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def fill(c):
    return np.broadcast_to(hexrgb(c), (S, S, 3)).copy()


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def line(d, w, aa=0.8):
    """Coverage of a line from a distance field in pixels."""
    return np.clip(1 - (np.abs(d) - w) / aa, 0, 1)


def wobble(seed, amp=2.0):
    """A periodic displacement (pixels) for hand-drawn lines."""
    return (pnoise(seed, 2.5, 2, 24) - 0.5) * 2 * amp


def paint(base, seed, blot=0.08, grain=0.04, stroke=0.05, angle=0.0):
    """Watercolour on paper: soft blotches, brush streaks, a fine grain."""
    v = 1 + blot * (pnoise(seed, 2.2, 1, 12) - 0.5) * 2 + stroke * (streaks(seed + 1, angle) - 0.5) * 2
    v += grain * (pnoise(seed + 2, 0.8, 30) - 0.5) * 2
    return base * v[..., None]


def ink(img, cover, color="#3a3028", k=0.75):
    return mix(img, fill(color), np.clip(cover, 0, 1) * k)


def cells(seed, n):
    """Periodic Voronoi: distance to the nearest and second-nearest of n random points, and the nearest's id."""
    p = rng(seed).random((n, 2))
    d1 = np.full((S, S), 9.0)
    d2 = np.full((S, S), 9.0)
    idx = np.zeros((S, S), int)
    for k, (px, py) in enumerate(p):
        dx = np.abs(X - px)
        dy = np.abs(Y - py)
        d = np.sqrt(np.minimum(dx, 1 - dx) ** 2 + np.minimum(dy, 1 - dy) ** 2)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, k, idx)
        d1 = np.where(closer, d, d1)
    return d1, d2, idx


# ---------------------------------------------------------------- the surfaces
def plaster():
    img = paint(fill("#efe4cc"), 10, blot=0.07, stroke=0.04)
    stain = pnoise(11, 2.4, 1, 6)
    img = mix(img, img * hexrgb("#c8b28c"), np.clip((stain - 0.62) * 3, 0, 1) * 0.5)
    # a few hairline cracks
    w = wobble(12, 6)
    for k, (y0, x0, x1) in enumerate(((0.31, 0.1, 0.4), (0.72, 0.55, 0.9))):
        d = (Y - y0 - (X - x0) * 0.35) * S + w
        img = ink(img, line(d, 0.4) * ((X > x0) & (X < x1)), "#7a6a52", 0.5)
    return img


def brick():
    rows, per = 16, 5
    r = np.floor(Y * rows)
    off = (r % 2) * 0.5 / per
    bx = (X + off) * per
    col = np.floor(bx) % per
    g = rng(20)
    tone = g.uniform(0.82, 1.12, (rows, per))
    hue = g.uniform(0, 1, (rows, per))
    t = tone[r.astype(int), col.astype(int)]
    h = hue[r.astype(int), col.astype(int)]
    base = mix(fill("#a85a40"), fill("#8a4a36"), h * 0.6)
    img = paint(base * t[..., None], 21, blot=0.06, stroke=0.05)
    fy = (Y * rows) % 1.0
    fx = bx % 1.0
    w = wobble(22, 1.2)
    mortar = np.maximum(line((fy - 0.0) * S / rows + w, 1.6, 1.2), line((fy - 1.0) * S / rows + w, 1.6, 1.2))
    mortar = np.maximum(mortar, line(fx * S / per + w, 1.6, 1.2), )
    mortar = np.maximum(mortar, line((fx - 1.0) * S / per + w, 1.6, 1.2))
    img = mix(img, paint(fill("#cdbfa4"), 23, blot=0.05), mortar)
    img = ink(img, line(fy * S / rows + w - 2.5, 0.5) * 0.6, "#4a2a20", 0.5)  # the shadow under each course
    chips = pnoise(24, 1.2, 20) > 0.83
    return mix(img, img * 0.82, chips * 0.6)


def stone():
    d1, d2, idx = cells(30, 26)
    edge = (d2 - d1) * S
    g = rng(31)
    tone = g.uniform(0.85, 1.1, 26)[idx]
    warm = g.uniform(0, 1, 26)[idx]
    base = mix(fill("#b8ad94"), fill("#a39a88"), warm)
    img = paint(base * tone[..., None], 32, blot=0.07, stroke=0.04)
    img = mix(img, fill("#8a806c"), np.clip(1 - edge / 9, 0, 1) * 0.45)  # rounded, darker toward the joints
    img = ink(img, line(edge + wobble(33, 1.5), 1.2, 1.4), "#4a443a", 0.75)
    return img


def timber():
    w = wobble(40, 5)
    grain = np.sin((Y * S + w * 3) / S * np.pi * 2 * 18 + 3 * pnoise(41, 2, 2, 10)) * 0.5 + 0.5
    img = paint(fill("#6a4a32"), 42, blot=0.08, stroke=0.1, angle=0.0)
    img = mix(img, img * 0.78, (grain > 0.82) * 0.7)
    knots = pnoise(43, 2.0, 3, 10)
    return mix(img, fill("#3e2a1c"), np.clip((knots - 0.86) * 8, 0, 1) * 0.6)


def plank():
    n = 6
    fy = (Y * n) % 1.0
    k = np.floor(Y * n).astype(int)
    tone = rng(50).uniform(0.85, 1.1, n)[k]
    img = paint(fill("#8a6a48") * tone[..., None], 51, blot=0.06, stroke=0.12)
    grain = streaks(52, 0.0, 60)
    img = mix(img, img * 0.8, np.clip((grain - 0.6) * 3, 0, 1))
    w = wobble(53, 1.2)
    img = ink(img, np.maximum(line(fy * S / n + w, 0.9), line((fy - 1) * S / n + w, 0.9)), "#3a2a1c", 0.8)
    # end joints and nails
    jx = (X + (k % 3) * 0.37) % 1.0
    img = ink(img, line((jx - 0.5) * S, 0.8) * 0.8, "#3a2a1c", 0.6)
    nails = (np.abs(((jx - 0.5) * S)) < 6) & (np.abs((fy - 0.25) * S / n) < 2.5) | (np.abs(((jx - 0.5) * S)) < 6) & (np.abs((fy - 0.75) * S / n) < 2.5)
    return mix(img, fill("#2a2420"), nails * 0.7)


def roof_tile():
    rows, per = 10, 7
    r = np.floor(Y * rows).astype(int)
    off = (r % 2) * 0.5 / per
    fx = ((X + off) * per) % 1.0
    fy = (Y * rows) % 1.0
    col = np.floor((X + off) * per).astype(int) % per
    tone = rng(60).uniform(0.85, 1.1, (rows, per))[r, col]
    img = paint(mix(fill("#b86a48"), fill("#9a5038"), rng(61).uniform(0, 1, (rows, per))[r, col]) * tone[..., None], 62, blot=0.07)
    # each tile is a half-round: lighter down its middle, its rounded bottom edge drawn
    curve = 0.82 + 0.18 * np.cos((fx - 0.5) * np.pi)
    img = img * (0.86 + 0.24 * curve * (0.6 + 0.4 * fy))[..., None]
    lip = (fy - (0.92 - 0.12 * np.cos((fx - 0.5) * np.pi * 2) * 0.5)) * S / rows
    img = ink(img, line(lip + wobble(63, 1.0), 0.8), "#4a2418", 0.7)
    img = ink(img, line((fx - 0.0) * S / per + wobble(64, 0.8), 0.6) * (fy < 0.9), "#5a2a1c", 0.45)
    img = mix(img, img * 0.6, np.clip((fy - 0.86) * 8, 0, 1) * 0.6)  # the shadow under the next course
    moss = pnoise(65, 2.0, 2, 12)
    return mix(img, fill("#7a7a4a"), np.clip((moss - 0.78) * 4, 0, 1) * 0.35)


def concrete():
    img = paint(fill("#b4ae9e"), 70, blot=0.08, stroke=0.03)
    pits = pnoise(71, 0.8, 40) > 0.82
    img = mix(img, img * 0.85, pits * 0.5)
    # form lines and rust streaks running down
    fy = (Y * 3) % 1.0
    img = ink(img, line(fy * S / 3 + wobble(72, 1.0), 0.6), "#6a665c", 0.4)
    run = streaks(73, np.pi / 2, 80)
    return mix(img, fill("#8a7a62"), np.clip((run - 0.72) * 3, 0, 1) * 0.35)


def sandbag():
    weave = (np.sin(X * S * np.pi / 3) * np.sin(Y * S * np.pi / 3)) * 0.5 + 0.5
    img = paint(fill("#b8a676"), 80, blot=0.1, stroke=0.04)
    img = img * (0.92 + 0.12 * weave)[..., None]
    dirt = pnoise(81, 2.2, 1, 8)
    return mix(img, fill("#7a6a48"), np.clip((dirt - 0.55) * 1.6, 0, 1) * 0.5)


def canvas():
    weave = (np.sin(X * S * np.pi / 2) + np.sin(Y * S * np.pi / 2)) * 0.25 + 0.5
    img = paint(fill("#9a9670"), 90, blot=0.09, stroke=0.05)
    img = img * (0.94 + 0.1 * weave)[..., None]
    img = ink(img, line(((X * 2) % 1.0) * S / 2 + wobble(91, 1.0), 0.7) * 0.7, "#5a583e", 0.5)  # seams
    return img


def metal():
    img = paint(fill("#6e7276"), 100, blot=0.08, stroke=0.12, angle=np.pi / 2)
    rust = pnoise(101, 2.0, 2, 20)
    img = mix(img, fill("#8a5a3a"), np.clip((rust - 0.7) * 3, 0, 1) * 0.5)
    return mix(img, img * 1.25, (streaks(102, np.pi / 2, 90) > 0.75) * 0.4)


def leaf():
    # foliage as a watercolour wash: light and dark masses, dabs of leaves in clusters, no outlines
    img = mix(fill("#5e8a3e"), fill("#78a44a"), pnoise(110, 2.6, 1, 6))
    img = paint(img, 111, blot=0.1, stroke=0.03)
    d1, d2, idx = cells(112, 220)
    g = rng(113)
    lit = np.clip(1 - d1 * S / 9, 0, 1) ** 1.5 * g.uniform(0.3, 1, 220)[idx]
    img = mix(img, fill("#a2c464"), lit * 0.45)
    gaps = np.clip(1 - (d2 - d1) * S / 3, 0, 1)
    img = mix(img, fill("#35562a"), gaps * 0.35)
    deep = pnoise(114, 2.2, 1, 8)
    return mix(img, fill("#2e4a24"), np.clip((deep - 0.62) * 2.5, 0, 1) * 0.5)


def bark():
    w = wobble(120, 6)
    fiss = np.abs(np.sin((X * S + w * 2) / S * np.pi * 12 + 2 * pnoise(121, 2, 2, 8)))
    img = paint(fill("#6a5a48"), 122, blot=0.1, stroke=0.12, angle=np.pi / 2)
    img = mix(img, fill("#3a3028"), np.clip((0.25 - fiss) * 5, 0, 1) * 0.8)
    return mix(img, fill("#8a8a70"), np.clip((pnoise(123, 2, 2, 10) - 0.75) * 4, 0, 1) * 0.3)  # lichen


def hay():
    img = paint(fill("#d8bc70"), 130, blot=0.08)
    for k, a in enumerate((0.2, -0.3, 0.05)):
        s_ = streaks(131 + k, a, 100)
        img = mix(img, fill("#a88a40") if k % 2 else fill("#ecd48a"), np.clip((s_ - 0.7) * 4, 0, 1) * 0.5)
    return img


def glass():
    img = mix(fill("#3e5262"), fill("#5a7282"), Y)
    img = paint(img, 140, blot=0.06)
    streak = line(((X + Y * 0.6) % 0.5 - 0.25) * S, 10, 12)
    return mix(img, fill("#c8d8e0"), streak * 0.35)


def painted():
    img = paint(fill("#f0ece2"), 150, blot=0.06, stroke=0.12)
    n = 5
    fx = (X * n) % 1.0
    img = ink(img, line(fx * S / n + wobble(151, 1.0), 0.8), "#6a6050", 0.45)
    flake = pnoise(152, 1.0, 20) > 0.86
    return mix(img, fill("#8a6a48"), flake * 0.5)


def cobble():
    d1, d2, idx = cells(160, 60)
    edge = (d2 - d1) * S
    tone = rng(161).uniform(0.8, 1.1, 60)[idx]
    img = paint(fill("#a49c8a") * tone[..., None], 162, blot=0.08)
    img = mix(img, fill("#7a7262"), np.clip(1 - edge / 6, 0, 1) * 0.5)
    return ink(img, line(edge, 1.0, 1.2), "#4a4438", 0.7)


def grass():
    img = mix(fill("#7a9a48"), fill("#9ab25a"), pnoise(170, 2.4, 1, 6))
    img = paint(img, 171, blot=0.1, stroke=0.06)
    for k, (c, t) in enumerate((("#5a7a34", 0.68), ("#b4c870", 0.74), ("#6a8a3a", 0.7))):
        s_ = streaks(172 + k, 1.3 + k * 0.4, 30)
        img = mix(img, fill(c), np.clip((s_ - t) * 5, 0, 1) * 0.55)
    return img


def dirt():
    img = mix(fill("#a88a64"), fill("#947a58"), pnoise(180, 2.2, 1, 8))
    img = paint(img, 181, blot=0.1, stroke=0.05)
    pebbles = pnoise(182, 0.7, 30) > 0.84
    return mix(img, fill("#6a5a44"), pebbles * 0.5)


def road():
    img = mix(fill("#c4ac82"), fill("#b09670"), pnoise(190, 2.2, 1, 8))
    img = paint(img, 191, blot=0.08, stroke=0.08)
    s_ = streaks(192, 0.0, 120)
    img = mix(img, fill("#8a7454"), np.clip((s_ - 0.66) * 4, 0, 1) * 0.5)  # wheel-worn streaks along the road
    return mix(img, fill("#6a5a44"), (pnoise(193, 0.7, 30) > 0.86) * 0.5)


def wheat():
    img = mix(fill("#d8b860"), fill("#e8cc78"), pnoise(200, 2.2, 1, 8))
    img = paint(img, 201, blot=0.08)
    for k, (c, t) in enumerate((("#b08a3a", 0.66), ("#f2dc94", 0.7), ("#c09a48", 0.68))):
        s_ = streaks(202 + k, np.pi / 2 + (k - 1) * 0.25, 40)
        img = mix(img, fill(c), np.clip((s_ - t) * 5, 0, 1) * 0.6)
    return img


def plough():
    n = 14
    fy = (Y * n) % 1.0
    img = paint(fill("#8a6a4a"), 210, blot=0.1)
    ridge = 0.5 + 0.5 * np.cos(fy * np.pi * 2)
    img = img * (0.82 + 0.26 * ridge)[..., None]
    sprout = pnoise(211, 1.0, 20) > 0.78
    return mix(img, fill("#7a9a48"), sprout * ridge[...] * 0.6)


def water():
    img = mix(fill("#6a9aa8"), fill("#7aaab4"), pnoise(220, 2.4, 1, 6))
    img = paint(img, 221, blot=0.06, stroke=0.1)
    rip = streaks(222, 0.0, 60)
    img = mix(img, fill("#c8e0e0"), np.clip((rip - 0.72) * 5, 0, 1) * 0.5)
    return mix(img, fill("#4a7a88"), np.clip((streaks(223, 0.1, 50) - 0.7) * 5, 0, 1) * 0.4)


PAINTERS = {k: globals()[k] for k in SURFACES}


def write_png(path, rgb):
    h, w, _ = rgb.shape
    data = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    out = sys.argv[1]
    strip = np.concatenate([PAINTERS[k]() for k in SURFACES], axis=0)
    write_png(out, strip)
    print("SURFACES", len(SURFACES), "tiles ->", out)


if __name__ == "__main__":
    main()
