#!/usr/bin/env python3
"""Procedural atmospheric underwater background samples for Fish N Chips.

Generates 2 lifelike sample backgrounds per act (8 acts = 16 images) in the
moody, depth-layered style of the reference shots — volumetric god rays,
atmospheric fog, textured gradient silhouettes, fish schools, coloured
coral, boulders, marine snow and a per-act color grade. Original artwork,
not copies of any reference.

Run:  /opt/venv/bin/python tools/gen_backgrounds.py
Out:  art/bg_samples/act{N}_v{M}.png  +  art/bg_samples/contact_sheet.png
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1344, 756
OUT = os.path.join(os.path.dirname(__file__), '..', 'art', 'bg_samples')

# ----------------------------------------------------------------- helpers
def lerp(a, b, t):
    return a + (b - a) * t

def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))

def clamp_img(a):
    return np.clip(a, 0, 255)

def vgrad(w, h, top, bot):
    t = np.linspace(0, 1, h)[:, None]
    g = np.zeros((h, w, 3), np.float32)
    for c in range(3):
        g[:, :, c] = lerp(top[c], bot[c], t)
    return g

def noise_field(w, h, rng, scale=0.006, amp=1.0, octaves=3):
    """Low-frequency organic noise in [-amp, amp]."""
    n = np.zeros((h, w), np.float32)
    for _ in range(octaves):
        small = rng.random((max(2, int(h * scale)), max(2, int(w * scale))))
        im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        n += np.array(im, np.float32) / 255.0
    n = (n / octaves - 0.5) * 2 * amp
    return n

# per-act palette + theme + accents.
ACTS = {
    0: dict(name='Trench',    top=(10, 42, 74),  bot=(1, 6, 14),   fog=(30, 72, 98),  dark=(4, 12, 22), ray=(150, 205, 245), rayS=0.30, grade=(0.96, 1.05, 1.07), theme='trench',    coral=(255, 143, 106), fish=(120, 170, 210), glow=(120, 190, 230), schools=3, floor=True),
    1: dict(name='Drift',     top=(14, 58, 72),  bot=(2, 15, 22),  fog=(44, 98, 98),  dark=(3, 16, 18), ray=(168, 232, 220), rayS=0.42, grade=(0.99, 1.08, 0.97), theme='drift',     coral=(99, 224, 200),  fish=(150, 210, 200), glow=(150, 220, 210), schools=3, floor=True),
    2: dict(name='Lure',      top=(11, 32, 56),  bot=(1, 8, 16),   fog=(42, 76, 108), dark=(4, 12, 24), ray=(205, 222, 255), rayS=0.34, grade=(1.07, 0.97, 1.10), theme='lure',      coral=(157, 140, 255), fish=(170, 190, 230), glow=(220, 230, 255), schools=3, floor=True),
    3: dict(name='Gauntlet',  top=(16, 40, 42),  bot=(3, 10, 8),   fog=(52, 80, 74),  dark=(5, 12, 10), ray=(188, 220, 198), rayS=0.28, grade=(0.96, 1.01, 1.10), theme='gauntlet',  coral=(99, 224, 200),  fish=(150, 180, 170), glow=(180, 210, 190), schools=2, floor=True),
    4: dict(name='Ascent',    top=(26, 74, 106), bot=(4, 22, 38),  fog=(74, 132, 162),dark=(5, 20, 34), ray=(205, 242, 255), rayS=0.50, grade=(0.96, 1.06, 1.09), theme='ascent',    coral=(99, 224, 200),  fish=(180, 220, 240), glow=(220, 245, 255), schools=4, floor=True),
    5: dict(name='Hollow',    top=(11, 20, 52),  bot=(2, 4, 14),   fog=(46, 64, 132), dark=(3, 6, 18),  ray=(150, 172, 255), rayS=0.24, grade=(1.03, 0.97, 1.10), theme='hollow',    coral=(140, 160, 255), fish=(150, 170, 230), glow=(150, 170, 255), schools=2, floor=True),
    6: dict(name='Matriarch', top=(44, 15, 34),  bot=(9, 2, 7),    fog=(88, 40, 68),  dark=(16, 5, 12), ray=(255, 150, 182), rayS=0.20, grade=(1.11, 1.01, 0.90), theme='matriarch', coral=(255, 157, 176), fish=(200, 120, 150), glow=(255, 170, 190), schools=2, floor=False),
    7: dict(name='Surface',   top=(255, 214, 158), bot=(10, 42, 74), fog=(140, 170, 182), dark=(8, 22, 38), ray=(255, 240, 208), rayS=0.55, grade=(1.10, 1.06, 0.92), theme='surface',   coral=(255, 143, 106), fish=(255, 230, 200), glow=(255, 244, 220), schools=4, floor=True),
}

# ------------------------------------------------------------ atmosphere
def base_gradient(w, h, top, bot, lx=0.5, strength=0.5):
    img = vgrad(w, h, top, bot)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = xx / w - lx
    dy = yy / h
    dist = np.sqrt(dx * dx + (dy * 1.1) ** 2)
    glow = np.clip(1 - dist / 0.9, 0, 1) ** 2 * strength
    img += glow[:, :, None] * np.array([16, 34, 46])
    return img

def god_rays(img, w, h, rng, ray, strength):
    # bright source glow at top centre
    yy, xx = np.mgrid[0:h, 0:w]
    sx = float(rng.uniform(0.35, 0.65)) * w
    d = np.sqrt(((xx - sx) / (w * 0.5)) ** 2 + (yy / (h * 0.55)) ** 2)
    src = np.clip(1 - d, 0, 1) ** 2 * strength * 1.6
    img = img + src[:, :, None] * np.array(ray, np.float32) * 0.5
    # volumetric shafts
    layer = Image.new('L', (w, h), 0)
    dd = ImageDraw.Draw(layer)
    n = int(rng.integers(8, 14))
    for i in range(n):
        x0 = float(rng.uniform(0.05, 0.95)) * w
        skew = float(rng.uniform(-0.30, 0.30)) * w
        top_w = float(rng.uniform(6, 30))
        bot_w = float(rng.uniform(70, 200))
        a = float(rng.uniform(0.4, 1.0)) * strength
        dd.polygon([(x0 - top_w / 2, -40), (x0 + top_w / 2, -40),
                    (x0 + skew + bot_w / 2, h), (x0 + skew - bot_w / 2, h)],
                   fill=int(255 * a))
    layer = layer.filter(ImageFilter.GaussianBlur(22))
    rays = np.array(layer, np.float32) / 255.0
    img = img + rays[:, :, None] * np.array(ray, np.float32)
    return img

def caustics(img, w, h, rng, ray, strength, band=0.30):
    yy, xx = np.mgrid[0:h, 0:w]
    y0 = h * band
    m = np.clip(1 - yy / y0, 0, 1)
    waves = (np.sin(xx * 0.03 + rng.uniform(0, 6)) +
             np.sin(xx * 0.017 + rng.uniform(0, 6)) * 0.6 +
             np.sin(xx * 0.05 + rng.uniform(0, 6)) * 0.4)
    band_m = m * np.clip(waves * 0.5 + 0.5, 0, 1)
    img += band_m[:, :, None] * np.array(ray, np.float32) * strength
    return img

def marine_snow(img, w, h, rng, n=420):
    xs = rng.integers(0, w, n)
    ys = rng.integers(0, h, n)
    sz = rng.uniform(0.6, 2.8, n)
    al = rng.uniform(0.05, 0.55, n) * (1 - ys / h * 0.45)
    for x, y, s, a in zip(xs, ys, sz, al):
        r = max(1, int(s))
        img[int(y) - r:int(y) + r + 1, int(x) - r:int(x) + r + 1] += a * 255 * 0.3
    return img

def mist_band(img, w, h, rng, fog, y0=0.42, y1=0.62, strength=0.16):
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.clip(1 - np.abs((yy / h) - (y0 + y1) / 2) / ((y1 - y0) / 2), 0, 1)
    m *= 0.7 + 0.3 * np.sin(xx * 0.004 + rng.uniform(0, 6))
    img += m[:, :, None] * np.array(fog, np.float32) * strength
    return img

def vignette(img, w, h, strength=0.44):
    yy, xx = np.mgrid[0:h, 0:w]
    dx = (xx / w - 0.5) * 2
    dy = (yy / h - 0.5) * 2
    d = np.sqrt(dx * dx + dy * dy)
    m = np.clip(1 - (d - 0.55) / 0.95, 0, 1)
    m = 1 - strength * (1 - m)
    return img * m[:, :, None]

# ------------------------------------------------------------ shape parts
def fish(d, x, y, s, col, flip=False):
    if flip:
        d.polygon([(x, y), (x - s, y - s * 0.30), (x - s * 1.7, y), (x - s, y + s * 0.30)], fill=col)
        d.polygon([(x, y), (x + s * 0.5, y - s * 0.42), (x + s * 0.5, y + s * 0.42)], fill=col)
    else:
        d.polygon([(x, y), (x + s, y - s * 0.30), (x + s * 1.7, y), (x + s, y + s * 0.30)], fill=col)
        d.polygon([(x, y), (x - s * 0.5, y - s * 0.42), (x - s * 0.5, y + s * 0.42)], fill=col)

def kelp(d, x, base_y, height, col, rng):
    segs = 9
    px, py = x, base_y
    for i in range(1, segs + 1):
        tt = i / segs
        bx = x + np.sin(tt * 3.2 + x * 0.02) * height * 0.07
        by = base_y - height * tt
        d.line([(px, py), (bx, by)], fill=col, width=max(1, int(7 - tt * 5)))
        if i % 2 == 0:
            d.ellipse([bx + 6, by - 3, bx + 18, by + 3], fill=col)
        px, py = bx, by

def coral(d, x, y, s, col, rng):
    for i in range(5):
        ang = -np.pi / 2 + (i - 2) * 0.46
        ln = s * (0.7 + (i % 3) * 0.25)
        x1 = x + np.cos(ang) * ln
        y1 = y + np.sin(ang) * ln
        d.line([(x, y), (x1, y1)], fill=col, width=max(1, int(s * 0.22)))
        d.ellipse([x1 - s * 0.12, y1 - s * 0.12, x1 + s * 0.12, y1 + s * 0.12], fill=col)

def column(d, x, base_y, w, h, col, broken):
    d.rectangle([x - w / 2, base_y - h, x + w / 2, base_y], fill=col)
    if not broken:
        d.rectangle([x - w * 0.72, base_y - h - 10, x + w * 0.72, base_y - h], fill=col)
    else:
        d.polygon([(x - w / 2, base_y - h), (x + w / 2, base_y - h + 18),
                   (x + w / 2, base_y - h + 30), (x - w / 2, base_y - h + 10)], fill=col)
    for i in range(1, 5):
        fy = base_y - h + (h / 5) * i
        d.line([(x - w / 2 + 3, fy), (x + w / 2 - 3, fy)], fill=col, width=1)

def crystal(d, x, y, s, col):
    d.polygon([(x, y - s), (x + s * 0.34, y - s * 0.3), (x + s * 0.2, y),
               (x - s * 0.2, y), (x - s * 0.34, y - s * 0.3)], fill=col)

def ledge(d, x, y, w, h, col):
    d.polygon([(x, y), (x + w * 0.18, y - h), (x + w * 0.82, y - h), (x + w, y)], fill=col)

def boulder(d, x, y, s, col, rng):
    d.ellipse([x - s, y - s * 0.7, x + s, y + s * 0.7], fill=col)
    d.ellipse([x - s * 0.6, y - s * 0.9, x + s * 0.7, y + s * 0.4], fill=col)

def bubbles(d, x, y, hgt, n, col, rng):
    for i in range(n):
        tt = i / n
        d.ellipse([x + np.sin(tt * 7 + x) * 9 - 3, y - hgt * tt - 3,
                   x + np.sin(tt * 7 + x) * 9 + 3, y - hgt * tt + 3], fill=col)

def fish_school(d, w, h, rng, col, n=14):
    cx = float(rng.uniform(0.15, 0.85)) * w
    cy = float(rng.uniform(0.2, 0.65)) * h
    rx = float(rng.uniform(40, 110))
    ry = float(rng.uniform(20, 45))
    for i in range(n):
        a = float(rng.uniform(0, 2 * np.pi))
        r = float(rng.uniform(0.3, 1.0))
        x = cx + np.cos(a) * rx * r
        y = cy + np.sin(a) * ry * r
        s = float(rng.uniform(4, 9))
        fish(d, x, y, s, col, bool(rng.integers(0, 2)))

# ------------------------------------------------------------ theme body (white mask)
def t_trench_far(d, w, h, rng, col):
    floor = h * 0.86
    for side in (0, 1):
        pts = [(0 if side == 0 else w, 0)]
        n = 10
        for i in range(n + 1):
            yy = i / n * h
            inset = float(rng.uniform(0.05, 0.16)) * w + abs(np.sin(i * 1.7)) * w * 0.05
            pts.append(((inset) if side == 0 else (w - inset), yy))
        pts.append((0 if side == 0 else w, h))
        d.polygon(pts, fill=col)
    d.ellipse([w * 0.32, floor - 260, w * 0.68, floor - 260 + 160], fill=col)

def t_trench_mid(d, w, h, rng, col):
    floor = h * 0.88
    for i in range(10):
        y = h * (0.10 + i * 0.09)
        ledge(d, 0, y, w * float(rng.uniform(0.10, 0.16)), 24 + rng.integers(0, 22), col)
        ledge(d, w - w * float(rng.uniform(0.10, 0.15)), y + 40, w * 0.12, 22 + rng.integers(0, 20), col)
    for i in range(12):
        boulder(d, w * (0.08 + i / 12 * 0.84), floor + 10, 20 + rng.integers(0, 26), col, rng)

def t_trench_near(d, w, h, rng, col):
    floor = h * 0.92
    for i in range(7):
        x = w * (0.10 + i * 0.13)
        ledge(d, x, floor + 20, 90 + rng.integers(0, 70), 22 + rng.integers(0, 20), col)
    for i in range(5):
        boulder(d, w * float(rng.uniform(0.1, 0.9)), floor + 30, 30 + rng.integers(0, 30), col, rng)

def t_drift_far(d, w, h, rng, col):
    floor = h * 0.9
    for i in range(16):
        x = w * (0.02 + i / 16 * 0.96) + rng.integers(-15, 15)
        kelp(d, x, floor, h * float(rng.uniform(0.35, 0.6)), col, rng)

def t_drift_mid(d, w, h, rng, col):
    floor = h * 0.92
    for i in range(22):
        x = w * (0.02 + i / 22 * 0.96) + rng.integers(-20, 20)
        kelp(d, x, floor, h * float(rng.uniform(0.45, 0.85)), col, rng)

def t_drift_near(d, w, h, rng, col):
    floor = h * 0.95
    for i in range(9):
        x = w * (0.05 + i * 0.11)
        kelp(d, x, floor, h * float(rng.uniform(0.7, 1.0)), col, rng)

def t_lure_far(d, w, h, rng, col):
    floor = h * 0.88
    for i in range(8):
        x = w * (0.10 + i * 0.105)
        column(d, x, floor, 30, 190 + rng.integers(0, 90), col, i % 3 == 0)
    d.arc([w * 0.30, floor - 360, w * 0.70, floor - 120], start=180, end=360, fill=col, width=18)
    d.rectangle([w * 0.20, floor - 14, w * 0.80, floor], fill=col)

def t_lure_mid(d, w, h, rng, col):
    floor = h * 0.9
    for i in range(6):
        x = w * (0.14 + i * 0.14)
        d.line([(x, 0), (x + 2, h * 0.24)], fill=col, width=2)
        d.ellipse([x - 4, h * 0.24, x + 10, h * 0.24 + 14], fill=col)

def t_lure_near(d, w, h, rng, col):
    floor = h * 0.94
    for i in range(6):
        x = w * (0.08 + i * 0.16)
        column(d, x, floor + 10, 40, 120 + rng.integers(0, 60), col, bool(rng.integers(0, 2)))

def t_gauntlet_far(d, w, h, rng, col):
    floor = h * 0.86
    hx, hy, hl = w * 0.5, floor - 20, w * 0.46
    d.polygon([(hx - hl, hy), (hx - hl * 0.5, hy - 130), (hx + hl * 0.3, hy - 150),
               (hx + hl, hy - 50), (hx + hl * 0.9, hy + 34), (hx - hl * 0.92, hy + 34)], fill=col)
    d.line([(hx, hy - 130), (hx, hy - 340)], fill=col, width=8)
    d.line([(hx - 90, hy - 310), (hx + 80, hy - 300)], fill=col, width=4)
    d.line([(hx - hl * 0.5, hy - 120), (hx - hl * 0.5, hy - 270)], fill=col, width=5)
    d.line([(hx + hl * 0.4, hy - 140), (hx + hl * 0.4, hy - 250)], fill=col, width=5)

def t_gauntlet_mid(d, w, h, rng, col):
    floor = h * 0.9
    for i in range(5):
        x = w * (0.10 + i * 0.2)
        d.rectangle([x, floor - 34, x + 46, floor], fill=col)
    for i in range(6):
        boulder(d, w * float(rng.uniform(0.05, 0.95)), floor + 12, 22 + rng.integers(0, 24), col, rng)

def t_gauntlet_near(d, w, h, rng, col):
    floor = h * 0.94
    for i in range(6):
        x = w * (0.08 + i * 0.15)
        d.rectangle([x, floor + 6, x + 40, floor + 34], fill=col)

def t_ascent_far(d, w, h, rng, col):
    for i in range(6):
        y = h * (0.86 - i * 0.12)
        x = w * (0.5 if i % 2 else 0.02)
        ledge(d, x, y, w * 0.42, 26 + rng.integers(0, 24), col)

def t_ascent_mid(d, w, h, rng, col):
    for i in range(7):
        y = h * (0.9 - i * 0.115)
        x = w * (0.52 if i % 2 else 0.04)
        ledge(d, x, y, w * 0.44, 30 + rng.integers(0, 26), col)

def t_ascent_near(d, w, h, rng, col):
    floor = h * 0.95
    for i in range(6):
        boulder(d, w * float(rng.uniform(0.05, 0.95)), floor + 14, 26 + rng.integers(0, 26), col, rng)

def t_hollow_far(d, w, h, rng, col):
    for i in range(12):
        x = w * (0.04 + i / 12 * 0.92)
        s = 60 + rng.integers(0, 130)
        d.polygon([(x - 16, 0), (x, s), (x + 16, 0)], fill=col)

def t_hollow_mid(d, w, h, rng, col):
    floor = h * 0.92
    for i in range(12):
        x = w * (0.05 + i / 12 * 0.9)
        s = 70 + rng.integers(0, 150)
        d.polygon([(x - 18, floor + 4), (x, floor - s), (x + 18, floor + 4)], fill=col)

def t_hollow_near(d, w, h, rng, col):
    floor = h * 0.96
    for i in range(6):
        x = w * float(rng.uniform(0.05, 0.95))
        s = 40 + rng.integers(0, 70)
        d.polygon([(x - 14, 0), (x, s), (x + 14, 0)], fill=col)

def t_matriarch_far(d, w, h, rng, col):
    floor = h * 0.9
    for i in range(10):
        x = w * (0.04 + i / 10 * 0.92)
        s = 120 + rng.integers(0, 190)
        d.polygon([(x - 26, floor + 6), (x - 8, floor - s * 0.6), (x, floor - s),
                   (x + 8, floor - s * 0.6), (x + 26, floor + 6)], fill=col)
    d.polygon([(0, h * 0.1), (w * 0.5, h * 0.24), (w, h * 0.1), (w, 0), (0, 0)], fill=col)

def t_matriarch_mid(d, w, h, rng, col):
    for i in range(16):
        x = w * float(rng.uniform(0, 1))
        y = h * float(rng.uniform(0.12, 0.62))
        d.ellipse([x - 12 - rng.integers(0, 10), y - 16 - rng.integers(0, 12),
                   x + 12 + rng.integers(0, 10), y + 16 + rng.integers(0, 12)], fill=col)

def t_matriarch_near(d, w, h, rng, col):
    floor = h * 0.95
    for i in range(7):
        x = w * (0.06 + i * 0.14)
        s = 150 + rng.integers(0, 160)
        d.polygon([(x - 30, floor + 8), (x - 10, floor - s * 0.6), (x, floor - s),
                   (x + 10, floor - s * 0.6), (x + 30, floor + 8)], fill=col)

def t_surface_far(d, w, h, rng, col):
    wl = h * 0.14
    d.rectangle([0, 0, w, wl], fill=col)
    d.ellipse([w * 0.72 - 46, wl * 0.45 - 46, w * 0.72 + 46, wl * 0.45 + 46], fill=col)
    d.polygon([(w * 0.16, wl), (w * 0.24, wl - 70), (w * 0.34, wl)], fill=col)

def t_surface_mid(d, w, h, rng, col):
    floor = h * 0.9
    for i in range(8):
        boulder(d, w * (0.05 + i * 0.12), floor + 8, 24 + rng.integers(0, 24), col, rng)

def t_surface_near(d, w, h, rng, col):
    floor = h * 0.95
    for i in range(6):
        boulder(d, w * float(rng.uniform(0.05, 0.95)), floor + 16, 30 + rng.integers(0, 28), col, rng)

THEMES = {
    'trench':    (t_trench_far, t_trench_mid, t_trench_near),
    'drift':     (t_drift_far, t_drift_mid, t_drift_near),
    'lure':      (t_lure_far, t_lure_mid, t_lure_near),
    'gauntlet':  (t_gauntlet_far, t_gauntlet_mid, t_gauntlet_near),
    'ascent':    (t_ascent_far, t_ascent_mid, t_ascent_near),
    'hollow':    (t_hollow_far, t_hollow_mid, t_hollow_near),
    'matriarch': (t_matriarch_far, t_matriarch_mid, t_matriarch_near),
    'surface':   (t_surface_far, t_surface_mid, t_surface_near),
}

# ------------------------------------------------------------ compositing
def render_layer(img, w, h, depth, fog, dark, body_fn, rng, blur=0, noise_amp=10):
    mask = Image.new('L', (w, h), 0)
    dm = ImageDraw.Draw(mask)
    body_fn(dm, w, h, rng, 255)
    if blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    top_c = mix(fog, dark, depth * 0.55)
    bot_c = mix(fog, dark, depth)
    color = vgrad(w, h, top_c, bot_c)
    nz = noise_field(w, h, rng, scale=0.006, amp=noise_amp)
    color += nz[:, :, None]
    a = np.array(mask, np.float32) / 255.0
    return clamp_img(img * (1 - a[:, :, None]) + color * a[:, :, None])

def accent_pass(img, w, h, cfg, rng):
    ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    floor = h * 0.9
    # coloured coral along the floor
    if cfg['floor']:
        for i in range(14):
            x = w * (0.04 + i * 0.07) + rng.integers(-10, 10)
            coral(d, x, floor + 6, 14 + rng.integers(0, 16), tuple(int(v) for v in cfg['coral']), rng)
    # fish schools (dark silhouettes)
    fcol = tuple(int(v) for v in cfg['fish'])
    for _ in range(cfg['schools']):
        fish_school(d, w, h, rng, fcol, n=int(rng.integers(10, 18)))
    # bubbles
    bubbles(d, w * float(rng.uniform(0.2, 0.8)), floor, h * 0.5, 14, fcol, rng)
    ov = ov.filter(ImageFilter.GaussianBlur(0.6))
    oa = np.array(ov)
    a = oa[:, :, 3:4] / 255.0
    rgb = oa[:, :, 0:3].astype(np.float32)
    return clamp_img(img * (1 - a) + rgb * a)

def glow_spots(img, w, h, cfg, rng, n=6):
    for _ in range(n):
        x = float(rng.uniform(0, w))
        y = float(rng.uniform(0.15, 0.8) * h)
        r = float(rng.uniform(20, 60))
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
        m = np.clip(1 - d / r, 0, 1) ** 2 * 0.10
        img += m[:, :, None] * np.array(cfg['glow'], np.float32)
    return img

# ------------------------------------------------------------ main render
def render(act, variant, w=W, h=H):
    cfg = ACTS[act]
    rng = np.random.default_rng(act * 100 + variant * 7 + 13)
    img = base_gradient(w, h, cfg['top'], cfg['bot'], lx=0.5, strength=0.5)
    img = god_rays(img, w, h, rng, cfg['ray'], cfg['rayS'])
    if cfg['theme'] in ('surface', 'ascent'):
        img = caustics(img, w, h, rng, cfg['ray'], 0.5, band=0.30)
    far, mid, near = THEMES[cfg['theme']]
    img = render_layer(img, w, h, 0.15, cfg['fog'], cfg['dark'], far, rng, blur=2, noise_amp=7)
    img = render_layer(img, w, h, 0.55, cfg['fog'], cfg['dark'], mid, rng, blur=1, noise_amp=10)
    img = render_layer(img, w, h, 0.95, cfg['fog'], cfg['dark'], near, rng, blur=0, noise_amp=14)
    img = mist_band(img, w, h, rng, cfg['fog'], 0.40, 0.62, 0.14)
    img = glow_spots(img, w, h, cfg, rng)
    img = accent_pass(img, w, h, cfg, rng)
    img = marine_snow(img, w, h, rng)
    img = vignette(img, w, h, strength=0.44)
    img += rng.normal(0, 4, (h, w, 1)).astype(np.float32)
    img = img * np.array(cfg['grade'], np.float32)
    return Image.fromarray(clamp_img(img).astype(np.uint8))

def contact_sheet(paths, out, cols=4):
    tw, th = 480, 270
    rows = int(np.ceil(len(paths) / cols))
    sheet = Image.new('RGB', (cols * tw, rows * th), (0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        im = Image.open(p).resize((tw, th))
        cx, cy = (i % cols) * tw, (i // cols) * th
        sheet.paste(im, (cx, cy))
        d.rectangle([cx, cy, cx + tw - 1, cy + th - 1], outline=(255, 255, 255), width=1)
        label = os.path.basename(p).replace('.png', '')
        d.rectangle([cx, cy, cx + 150, cy + 22], fill=(0, 0, 0))
        d.text((cx + 6, cy + 6), label, fill=(255, 255, 255))
    sheet.save(out)
    return out

def main():
    os.makedirs(OUT, exist_ok=True)
    paths = []
    for act in range(8):
        for v in range(2):
            p = os.path.join(OUT, f'act{act}_v{v}.png')
            render(act, v).save(p)
            paths.append(p)
            print('wrote', p)
    cs = contact_sheet(paths, os.path.join(OUT, 'contact_sheet.png'))
    print('contact sheet:', cs)

if __name__ == '__main__':
    main()
