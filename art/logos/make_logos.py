#!/usr/bin/env python3
"""Fish N Chips — 5 marketing title logos with the 3 creatures (Pillow). v2 fixes."""
import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = '/a0/usr/workdir/nightshift/art/logos'
F = OUT + '/fonts'
W, H = 1600, 1000

EEL_B, EEL_G = (94, 242, 200), (42, 255, 213)
ANGLER_B, ANGLER_G = (255, 209, 102), (255, 176, 32)
JELLY_B, JELLY_G = (199, 125, 255), (224, 170, 255)
WHITE = (235, 250, 255)


def load(name, size):
    return ImageFont.truetype(F + '/' + name, size)


def gradient(c1, c2, w=W, h=H):
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        t = y / h
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def vignette(base, strength=0.55):
    w, h = base.size
    dark = Image.new('L', (w // 2, h // 2), 0)
    dd = ImageDraw.Draw(dark)
    dd.ellipse([0, 0, w, h], fill=255)
    dark = dark.resize((w, h)).filter(ImageFilter.GaussianBlur(120))
    alpha = dark.point(lambda a: int((1 - a / 255) * 255 * strength))
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    layer.putalpha(alpha)
    base.alpha_composite(layer)


def glow_layer(base, draw_fn, radius, strength=1.0):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    glow = layer.filter(ImageFilter.GaussianBlur(radius))
    if strength < 1.0:
        glow.putalpha(glow.getchannel('A').point(lambda a: int(a * strength)))
    base.alpha_composite(glow)
    base.alpha_composite(layer)


def text_glow(base, xy, s, font, fill, glowc, radius, strength=1.0):
    def fn(d):
        d.text(xy, s, font=font, fill=glowc)
    glow_layer(base, fn, radius, strength)
    ImageDraw.Draw(base).text(xy, s, font=font, fill=fill)


# ---------------------------------------------------------------- creatures
def eel_ribbon(d, pts, body, glow, outline, ow):
    """pts: list of (x, y, r) — head last. Circle-chain snake body + forked tail + eye."""
    n = len(pts)
    def norm(i):
        if i == 0:
            tx, ty = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
        elif i == n - 1:
            tx, ty = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        else:
            tx, ty = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
        m = math.hypot(tx, ty) or 1
        return -ty / m, tx / m
    # body: overlapping circles from tail to head (drawn as one filled chain)
    for i, (x, y, r) in enumerate(pts):
        d.ellipse([x - r, y - r, x + r, y + r], fill=body)
    # outline pass (stroke each circle, tail->head)
    for i, (x, y, r) in enumerate(pts):
        d.ellipse([x - r, y - r, x + r, y + r], outline=outline, width=ow)
    # dorsal glow stripe
    for i in range(2, n - 2):
        x, y, r = pts[i]
        d.ellipse([x - r * 0.35, y - r * 0.35, x + r * 0.35, y + r * 0.35], fill=glow)
    # forked tail at pts[0]
    x0, y0, r0 = pts[0]
    nx, ny = norm(0)
    tx, ty = -nx, -ny  # direction back toward tail
    tl = r0 * 3.4
    d.polygon([(x0, y0),
               (x0 + tx * tl + nx * r0 * 2.6, y0 + ty * tl + ny * r0 * 2.6),
               (x0 + tx * tl * 0.5, y0 + ty * tl * 0.5),
               (x0 + tx * tl - nx * r0 * 2.6, y0 + ty * tl - ny * r0 * 2.6)],
              fill=body, outline=outline, width=ow)
    # head: slightly larger circle + eye, oriented along the spine
    hx, hy, hr = pts[-1]
    hnx, hny = norm(n - 1)
    htx, hty = -hnx, -hny  # forward (nose) direction
    hr2 = hr * 1.18
    d.ellipse([hx - hr2, hy - hr2, hx + hr2, hy + hr2], fill=body, outline=outline, width=ow)
    # eye offset to the side of the nose
    ex = hx + htx * hr * 0.5 + hnx * hr * 0.5
    ey = hy + hty * hr * 0.5 + hny * hr * 0.5
    d.ellipse([ex - hr * 0.34, ey - hr * 0.34, ex + hr * 0.34, ey + hr * 0.34], fill=(8, 26, 30))
    d.ellipse([ex - hr * 0.12, ey - hr * 0.12, ex + hr * 0.12, ey + hr * 0.12], fill=(225, 255, 252))


def draw_eel(d, cx, cy, s=1.0, body=EEL_B, glow=EEL_G):
    L = 250 * s
    pts = []
    N = 24
    for i in range(N + 1):
        t = i / N
        x = math.sin(t * 3.2) * 0.24 * L
        y = -t * L
        r = (1 - t * 0.82) * 0.13 * L + 0.02 * L
        pts.append((x, y, r))
    ox, oy = cx, cy + L / 2  # center the body
    pts = [(x + ox, y + oy, r) for (x, y, r) in pts]
    eel_ribbon(d, pts, body, glow, (16, 60, 55), max(2, int(3 * s)))


def draw_angler(d, cx, cy, s=1.0, body=ANGLER_B, glow=ANGLER_G):
    R = 70 * s
    d.ellipse([cx - R, cy - R * 0.85, cx + R, cy + R * 0.85], fill=body, outline=(120, 70, 10), width=max(2, int(3 * s)))
    d.polygon([(cx + R * 0.55, cy - R * 0.25), (cx + R * 1.55, cy + R * 0.1), (cx + R * 0.5, cy + R * 0.5)], fill=body, outline=(120, 70, 10), width=max(2, int(3 * s)))
    d.polygon([(cx - R * 0.2, cy + R * 0.5), (cx + R * 0.4, cy + R * 1.15), (cx + R * 0.55, cy + R * 0.45)], fill=body)
    d.polygon([(cx - R * 0.9, cy), (cx - R * 1.7, cy - R * 0.55), (cx - R * 1.35, cy), (cx - R * 1.7, cy + R * 0.55)], fill=body, outline=(120, 70, 10), width=max(2, int(3 * s)))
    d.ellipse([cx + R * 0.25, cy - R * 0.45, cx + R * 0.55, cy - R * 0.15], fill=(50, 30, 8))
    d.ellipse([cx + R * 0.33, cy - R * 0.37, cx + R * 0.47, cy - R * 0.23], fill=(255, 240, 200))
    lx, ly = cx + R * 0.15, cy - R * 1.75
    d.line([(cx + R * 0.3, cy - R * 0.7), (lx, ly)], fill=glow, width=max(3, int(6 * s)))
    d.ellipse([lx - R * 0.30, ly - R * 0.30, lx + R * 0.30, ly + R * 0.30], fill=(255, 243, 192), outline=glow, width=max(2, int(3 * s)))


def draw_jelly(d, cx, cy, s=1.0, body=JELLY_B, glow=JELLY_G):
    R = 66 * s
    top = cy - R * 0.95
    bot = cy + R * 0.35
    # translucent dome
    d.pieslice([cx - R, top, cx + R, top + R * 2], 180, 360, fill=body + (215,))
    d.rectangle([cx - R, (top + bot) / 2, cx + R, bot], fill=body + (215,))
    # rim
    d.arc([cx - R, top, cx + R, top + R * 2], 180, 360, fill=glow, width=max(4, int(8 * s)))
    # inner glow core
    d.ellipse([cx - R * 0.35, top + R * 0.25, cx + R * 0.35, top + R * 1.0], fill=glow + (120,))
    # thin wavy tentacles
    for i in range(7):
        tx = cx - R * 0.85 + i * R * 0.28
        ph = i * 1.1
        x1 = tx + math.sin(ph) * R * 0.22
        x2 = tx + math.sin(ph + 1.4) * R * 0.34
        d.line([(tx, bot - 4), (x1, bot + R * 0.75)], fill=body + (230,), width=max(2, int(5 * s)))
        d.line([(x1, bot + R * 0.75), (x2, bot + R * 1.5)], fill=body + (190,), width=max(2, int(4 * s)))


# ---------------------------------------------------------------- concepts
def concept1_trench():
    img = gradient((6, 30, 54), (1, 6, 14)).convert('RGBA')
    d = ImageDraw.Draw(img)
    # faint god rays, angled, NOT over the title zone
    for i in range(6):
        x0 = 120 + i * 260
        d.polygon([(x0, 0), (x0 + 90, 0), (x0 + 260, H), (x0 + 110, H)], fill=(122, 231, 255, 8))
    rng = random.Random(7)
    for _ in range(160):
        x, y = rng.randrange(W), rng.randrange(H)
        r = rng.randrange(1, 4)
        d.ellipse([x, y, x + r, y + r], fill=(180, 230, 255, 80))
    # creatures descending on a diagonal
    glow_layer(img, lambda dd: draw_eel(dd, 430, 270, s=1.55), 22, 0.95)
    glow_layer(img, lambda dd: draw_angler(dd, 850, 470, s=1.35), 22, 0.95)
    glow_layer(img, lambda dd: draw_jelly(dd, 1230, 660, s=1.45), 22, 0.95)
    # title stacked bottom-left
    f1 = load('Bungee-Regular.ttf', 175)
    f2 = load('Bungee-Regular.ttf', 88)
    text_glow(img, (110, 600), 'FISH', f1, WHITE, EEL_G, 24, 1.0)
    text_glow(img, (118, 775), 'N', f2, ANGLER_B, ANGLER_G, 20, 1.0)
    text_glow(img, (110, 815), 'CHIPS', f1, WHITE, JELLY_G, 24, 1.0)
    ft = load('Righteous-Regular.ttf', 44)
    tag = 'A BILUMINESCENT SHAPE-SHIFTING DESCENT'
    tw = d.textlength(tag, font=ft)
    d.text(((W - tw) / 2, 55), tag, font=ft, fill=(190, 235, 255, 255))
    vignette(img)
    img.convert('RGB').save(OUT + '/logo1_trench.png')


def concept2_morph():
    img = gradient((8, 16, 38), (2, 4, 12)).convert('RGBA')
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2 + 20
    R = 350
    for i in range(48):
        a0 = i / 48 * 2 * math.pi
        d.arc([cx - R, cy - R, cx + R, cy + R], math.degrees(a0), math.degrees(a0 + 3.1),
              fill=(122, 231, 255, 120), width=5)
    f = load('Bungee-Regular.ttf', 140)
    text_glow(img, (cx - 360, cy - 95), 'FISH N', f, WHITE, (42, 255, 213), 22, 1.0)
    text_glow(img, (cx - 280, cy + 45), 'CHIPS', f, WHITE, (224, 170, 255), 22, 1.0)
    # eel top, angler bottom-right, jelly bottom-left — clear of the text
    glow_layer(img, lambda dd: draw_eel(dd, cx, cy - R - 40, s=1.15), 20, 0.95)
    glow_layer(img, lambda dd: draw_angler(dd, cx + R * 0.82, cy + R * 0.55, s=1.1), 20, 0.95)
    glow_layer(img, lambda dd: draw_jelly(dd, cx - R * 0.82, cy + R * 0.55, s=1.15), 20, 0.95)
    ft = load('Righteous-Regular.ttf', 36)
    tw = d.textlength('SHIFT YOUR FORM. DIVE THE DEEP.', font=ft)
    d.text(((W - tw) / 2, H - 90), 'SHIFT YOUR FORM. DIVE THE DEEP.', font=ft, fill=(160, 215, 240, 230))
    vignette(img)
    img.convert('RGB').save(OUT + '/logo2_morph.png')


def concept3_neon():
    img = Image.new('RGBA', (W, H), (4, 8, 18, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(30, 60, 90, 30), width=1)
    f = load('Bungee-Regular.ttf', 170)
    s = 'FISH N CHIPS'
    bb = d.textbbox((0, 0), s, font=f)
    tw = bb[2] - bb[0]
    x0 = (W - tw) // 2
    # per-word neon colors: FISH cyan, N amber, CHIPS violet
    def word_xy(word, i0, i1):
        w = sum(d.textlength(ch, font=f) for ch in s[i0:i1])
        x = x0 + sum(d.textlength(ch, font=f) for ch in s[:i0])
        return x, w
    for word, i0, i1, col, gcol in [('FISH', 0, 4, (210, 255, 245), (42, 255, 213)),
                                    ('N', 4, 5, (255, 235, 190), (255, 176, 32)),
                                    ('CHIPS', 5, 10, (240, 225, 255), (224, 170, 255))]:
        x, w = word_xy(word, i0, i1)
        text_glow(img, (x, 170), word, f, col, gcol, 38, 1.0)
        text_glow(img, (x, 170), word, f, col, gcol, 13, 1.0)
    glow_layer(img, lambda dd: draw_eel(dd, 400, 660, s=1.75), 24, 1.0)
    glow_layer(img, lambda dd: draw_angler(dd, 820, 670, s=1.55), 24, 1.0)
    glow_layer(img, lambda dd: draw_jelly(dd, 1220, 660, s=1.6), 24, 1.0)
    ft = load('Righteous-Regular.ttf', 38)
    tw2 = d.textlength('THE TRENCH IS CALLING', font=ft)
    d.text(((W - tw2) / 2, H - 110), 'THE TRENCH IS CALLING', font=ft, fill=(140, 190, 220, 230))
    vignette(img)
    img.convert('RGB').save(OUT + '/logo3_neon.png')


def arch_text(img, cx, cy, R, s, font, col, span, bottom=False):
    d = ImageDraw.Draw(img)
    n = len(s)
    start = (90 - span / 2) if bottom else (-90 - span / 2)
    for i, ch in enumerate(s):
        a = math.radians(start + (i + 0.5) / n * span)
        r = R
        x = cx + math.cos(a) * r
        y = cy + math.sin(a) * r
        timg = Image.new('RGBA', (150, 150), (0, 0, 0, 0))
        td = ImageDraw.Draw(timg)
        bb = td.textbbox((0, 0), ch, font=font)
        td.text(((150 - (bb[2] - bb[0])) / 2 - bb[0], (150 - (bb[3] - bb[1])) / 2 - bb[1]), ch, font=font, fill=col)
        timg = timg.rotate(-math.degrees(a) - 90, resample=Image.BICUBIC)
        img.alpha_composite(timg, (int(x - 75), int(y - 75)))


def concept4_badge():
    img = gradient((4, 14, 30), (1, 5, 12)).convert('RGBA')
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    R = 380
    for rr, wdt, col in [(R, 10, (122, 231, 255, 210)), (R - 26, 3, (122, 231, 255, 130)), (R - 70, 2, (90, 160, 200, 130))]:
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col, width=wdt)
    arch_text(img, cx, cy, R - 52, 'FISH N CHIPS', load('TitanOne-Regular.ttf', 92), (235, 250, 255, 255), 170)
    arch_text(img, cx, cy, R - 52, 'BILUMINESCENT DESCENT', load('Righteous-Regular.ttf', 40), (150, 210, 235, 235), 120, bottom=True)
    glow_layer(img, lambda dd: draw_jelly(dd, cx, cy - 140, s=1.35), 20, 0.95)
    glow_layer(img, lambda dd: draw_eel(dd, cx - 130, cy + 100, s=1.25), 20, 0.95)
    glow_layer(img, lambda dd: draw_angler(dd, cx + 130, cy + 100, s=1.15), 20, 0.95)
    rng = random.Random(3)
    for _ in range(40):
        x, y = rng.randrange(W), rng.randrange(H)
        r = rng.randrange(1, 3)
        d.ellipse([x, y, x + r, y + r], fill=(180, 230, 255, 90))
    vignette(img)
    img.convert('RGB').save(OUT + '/logo4_badge.png')


def concept5_weave():
    img = gradient((5, 20, 40), (1, 6, 14)).convert('RGBA')
    d = ImageDraw.Draw(img)
    f = load('Bungee-Regular.ttf', 230)
    s = 'FISH N CHIPS'
    bb = d.textbbox((0, 0), s, font=f)
    tw = bb[2] - bb[0]
    x0 = (W - tw) // 2
    y0 = H // 2 - 130
    text_glow(img, (x0, y0), s, f, WHITE, (42, 255, 213), 22, 0.8)
    widths = [d.textlength(ch, font=f) for ch in s]
    pos = []
    xx = x0
    for ch, wdt in zip(s, widths):
        pos.append((ch, xx, xx + wdt))
        xx += wdt

    def letter(ch):
        for c, a, b in pos:
            if c == ch:
                return (a + b) / 2
        return W // 2

    # eel woven under the word, bold
    def eel_fn(dd):
        L = tw * 1.18
        pts = []
        N = 30
        for i in range(N + 1):
            t = i / N
            x = x0 - L * 0.09 + t * L
            y = y0 + 140 + math.sin(t * math.pi * 2.2) * 44
            r = (1 - t * 0.88) * 20 + 5
            pts.append((x, y, r))
        eel_ribbon(dd, pts, EEL_B, EEL_G, (16, 60, 55), 3)
    glow_layer(img, eel_fn, 16, 0.85)
    # angler to the right of the N, lure above
    nx = letter('N') + 110
    def angler_fn(dd):
        R = 60
        dd.ellipse([nx - R, y0 + 30, nx + R, y0 + 30 + R * 1.7], fill=ANGLER_B, outline=(120, 70, 10), width=3)
        dd.polygon([(nx + R * 0.55, y0 + 30 + R * 0.2), (nx + R * 1.5, y0 + 30 + R * 0.55), (nx + R * 0.5, y0 + 30 + R * 1.0)], fill=ANGLER_B)
        dd.polygon([(nx - R * 0.9, y0 + 30 + R * 0.85), (nx - R * 1.6, y0 + 30 + R * 0.35), (nx - R * 1.6, y0 + 30 + R * 1.35)], fill=ANGLER_B)
        dd.ellipse([nx + R * 0.2, y0 + 30 + R * 0.3, nx + R * 0.5, y0 + 30 + R * 0.6], fill=(50, 30, 8))
        lx, ly = nx + R * 0.25, y0 - 80
        dd.line([(nx + R * 0.3, y0 + 30 + R * 0.2), (lx, ly)], fill=ANGLER_G, width=6)
        dd.ellipse([lx - 18, ly - 18, lx + 18, ly + 18], fill=(255, 243, 192), outline=ANGLER_G, width=3)
    glow_layer(img, angler_fn, 16, 0.9)
    # jelly above the C of CHIPS
    cx5 = letter('C')
    def jelly_fn(dd):
        draw_jelly(dd, cx5, y0 - 150, s=1.15)
    glow_layer(img, jelly_fn, 16, 0.9)
    ft = load('Righteous-Regular.ttf', 36)
    tw2 = d.textlength('A BILUMINESCENT SHAPE-SHIFTING DESCENT', font=ft)
    d.text(((W - tw2) / 2, y0 + 320), 'A BILUMINESCENT SHAPE-SHIFTING DESCENT', font=ft, fill=(150, 210, 235, 230))
    vignette(img)
    img.convert('RGB').save(OUT + '/logo5_weave.png')


if __name__ == '__main__':
    concept1_trench()
    concept2_morph()
    concept3_neon()
    concept4_badge()
    concept5_weave()
    print('done')
    ims = [Image.open(f'{OUT}/logo{i}_{n}.png') for i, n in [(1, 'trench'), (2, 'morph'), (3, 'neon'), (4, 'badge'), (5, 'weave')]]
    tw, th = 800, 500
    sheet = Image.new('RGB', (tw * 3, th * 2), (0, 0, 0))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((tw, th)), ((i % 3) * tw, (i // 3) * th))
    sheet.save(OUT + '/contact_sheet.png')
    print('sheet saved')
