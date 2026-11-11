#!/usr/bin/env python3
"""Swap in the native 2752x1536 AI backgrounds where available.
Idempotent: for each act, if art/bg2752/actN.jpg exists, recompress it to
art/bg/actN.jpg (keeping 2752x1536) at a lean quality; otherwise leave the
existing art/bg/actN.jpg untouched. Safe to re-run as more acts land."""
import os
from PIL import Image

ROOT = '/a0/usr/workdir/nightshift'
BG = os.path.join(ROOT, 'art', 'bg')
SRC = os.path.join(ROOT, 'art', 'bg2752')
Q = 82

for i in range(8):
    src = os.path.join(SRC, f'act{i}.jpg')
    dst = os.path.join(BG, f'act{i}.jpg')
    if not os.path.exists(src):
        print(f'act{i}: SKIP (no 2752 source; keeping existing)')
        continue
    im = Image.open(src).convert('RGB')
    if im.size != (2752, 1536):
        print(f'act{i}: WARN unexpected size {im.size}, still using it')
    im.save(dst, quality=Q, optimize=True)
    print(f'act{i}: -> {dst} {im.size} {round(os.path.getsize(dst)/1e6,2)}MB')
print('done')
