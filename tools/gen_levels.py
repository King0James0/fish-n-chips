#!/usr/bin/env python3
"""Generate + validate js/levels.js for Fish N Chips. 96x44 grid, TILE=28."""
import json

W, H = 96, 44

def blank():
    g = [['.' for _ in range(W)] for _ in range(H)]
    for x in range(W):
        g[0][x] = '#'; g[H-1][x] = '#'
    for y in range(H):
        g[y][0] = '#'; g[y][W-1] = '#'
    return g

def rect(g, x, y, w, h, ch='#'):
    for yy in range(y, y+h):
        for xx in range(x, x+w):
            assert 0 <= xx < W and 0 <= yy < H, f"rect out of bounds {xx},{yy}"
            g[yy][xx] = ch

def put(g, x, y, ch, must_be_open=False):
    assert 0 <= x < W and 0 <= y < H, f"put out of bounds {x},{y}"
    if must_be_open:
        assert g[y][x] == '.', f"item at {x},{y} lands on '{g[y][x]}'"
    g[y][x] = ch

def col(g, x, y0, y1, ch):
    for y in range(y0, y1+1): put(g, x, y, ch)

def wall_v(g, x, y0, y1, ch, gaps):
    """Vertical wall with guaranteed open gaps (connectivity by construction)."""
    col(g, x, y0, y1, ch)
    for gy in gaps:
        put(g, x, gy, '.')

def place(g, coords, ch, tag=''):
    """Place ch on every OPEN tile in coords; skip (and report) blocked ones."""
    ok = skipped = 0
    for x, y in coords:
        if g[y][x] == '.':
            g[y][x] = ch; ok += 1
        else:
            skipped += 1
    print(f"  place {ch} {tag}: {ok} placed, {skipped} skipped")
    assert ok > 0, f"nothing placed for {ch} {tag} — all tiles blocked"
    return ok

def items(g, coords, ch):
    """Place critical items; assert every coord is open water (fail loudly)."""
    for x, y in coords:
        put(g, x, y, ch, True)

def dump(name, g):
    print(name)
    for r in g: print(''.join(r))
    print()

# ---------------- Act I: The Trench ----------------
# Teach: swim, urchins kill, plankton, sealed wall with a 1-tile gap (angler too
# chunky -> must shift to eel or jelly), checkpoint, goal.
# The gap at (26,16) is load-bearing: the smoke test probes eel-vs-angler fit
# at exactly that tile. Keep it a single open tile in a solid column.
l1 = blank()
rect(l1, 10, 6, 4, 6)
rect(l1, 33, 10, 5, 6)
rect(l1, 44, 30, 6, 6)
rect(l1, 70, 8, 5, 8)
rect(l1, 80, 26, 4, 6)
wall_v(l1, 26, 1, H-2, '#', [16])          # the 1-tile gap wall
wall_v(l1, 62, 1, H-2, '#', [28])          # a second, longer trench gate
items(l1, [(3, 2)], 'S')
items(l1, [(20, 34), (48, 12), (72, 36)], 'D')
items(l1, [(90, 22)], 'G')
items(l1, [(7, 3), (16, 14), (24, 22), (30, 34), (36, 6), (46, 20),
           (56, 30), (60, 12), (66, 24), (76, 20), (84, 34), (90, 8)], '*')
items(l1, [(14, 20), (28, 10), (42, 26), (50, 34), (64, 14), (76, 28), (86, 20), (30, 20)], 'U')
items(l1, [(5, 2), (36, 30), (60, 6), (88, 26)], 'b')
items(l1, [(52, 20), (86, 10)], 'P')       # 2 power-ups, spread down the trench
items(l1, [(40, 24), (56, 8)], 'T')        # stinger gates
items(l1, [(34, 20)], 'V')                 # viperfish shoots back
items(l1, [(70, 18)], 'L')                 # lanternfish hunts your glow
items(l1, [(48, 22)], 'M')                 # mini-boss (open water, mid-trench)

# ---------------- Act II: The Drift ----------------
# Teach: jellyfish passes anemone curtains; updrafts carry you. Eel/angler burn.
l2 = blank()
wall_v(l2, 14, 1, H-2, 'a', [])            # full-height jelly-only curtains
wall_v(l2, 38, 1, H-2, 'a', [])
wall_v(l2, 62, 1, H-2, 'a', [])
wall_v(l2, 22, 8, H-4, '^', [])            # updraft columns
wall_v(l2, 30, 8, H-4, '^', [])
wall_v(l2, 46, 8, H-4, '^', [])
wall_v(l2, 54, 8, H-4, '^', [])
rect(l2, 17, 18, 2, 3)
rect(l2, 42, 12, 3, 2)
rect(l2, 50, 30, 2, 3)
rect(l2, 66, 20, 3, 3)
items(l2, [(3, 2)], 'S')
items(l2, [(28, 20), (52, 34)], 'D')
items(l2, [(90, 22)], 'G')
items(l2, [(6, 6), (10, 24), (18, 8), (24, 32), (28, 12), (34, 20), (44, 34),
           (58, 14), (60, 36), (68, 10), (80, 26), (86, 14)], '*')
items(l2, [(16, 30), (26, 26), (40, 8), (52, 18), (64, 30), (72, 20), (84, 36)], 'U')
items(l2, [(5, 3), (40, 40), (88, 6)], 'b')
items(l2, [(34, 36), (74, 10)], 'P')
items(l2, [(20, 14), (58, 28)], 'T')
items(l2, [(56, 8)], 'V')
items(l2, [(26, 12), (48, 24), (70, 16)], 'L')
items(l2, [(49, 22)], 'M')                 # mini-boss (open drift channel)

# ---------------- Act III: The Lure ----------------
# Teach: angler lure reveals hidden blocks; flare stuns patrolling fish.
l3 = blank()
wall_v(l3, 12, 3, 40, 'h', [20, 21])
wall_v(l3, 30, 6, 42, 'h', [26, 27])
wall_v(l3, 48, 2, 38, 'h', [14, 15])
wall_v(l3, 66, 6, 42, 'h', [30, 31])
wall_v(l3, 80, 4, 36, 'h', [20, 21])
rect(l3, 16, 6, 4, 4)
rect(l3, 36, 34, 5, 4)
rect(l3, 54, 8, 4, 4)
rect(l3, 72, 24, 4, 4)
items(l3, [(3, 2)], 'S')
items(l3, [(34, 20), (60, 36)], 'D')
items(l3, [(90, 22)], 'G')
items(l3, [(18, 24), (40, 10), (58, 30), (74, 16)], 'F')
items(l3, [(6, 10), (14, 32), (24, 16), (28, 36), (38, 26), (44, 8),
           (56, 34), (64, 12), (76, 38), (86, 12)], '*')
items(l3, [(10, 26), (26, 22), (46, 30), (58, 16), (70, 36), (88, 16)], 'U')
items(l3, [(5, 4), (50, 34), (88, 38)], 'b')
items(l3, [(26, 34), (84, 30)], 'P')
items(l3, [(34, 10), (62, 24)], 'T')
items(l3, [(22, 10), (52, 26)], 'V')
items(l3, [(42, 18), (70, 10)], 'L')
items(l3, [(45, 22)], 'M')                 # mini-boss (open water mid-lure)

# ---------------- Act IV: The Gauntlet ----------------
# Sequence: narrow gap -> anemone curtain -> hidden maze -> fish corridor.
l4 = blank()
wall_v(l4, 10, 1, H-2, '#', [34])          # gap gate
wall_v(l4, 22, 1, H-2, 'a', [])            # anemone curtain
wall_v(l4, 34, 1, H-2, 'h', [12, 13])      # hidden wall
wall_v(l4, 52, 1, H-2, 'h', [30, 31])      # hidden wall II
wall_v(l4, 42, 16, H-4, '^', [])
wall_v(l4, 64, 4, 28, '^', [])
rect(l4, 46, 4, 3, 3)
rect(l4, 56, 34, 4, 3)
rect(l4, 74, 20, 4, 3)
rect(l4, 84, 6, 3, 4)
items(l4, [(3, 2)], 'S')
items(l4, [(18, 20), (40, 36), (60, 10)], 'D')
items(l4, [(90, 22)], 'G')
items(l4, [(46, 10), (58, 22), (70, 14), (78, 32)], 'F')
items(l4, [(6, 6), (14, 28), (20, 10), (26, 30), (30, 16), (38, 24), (44, 34),
           (50, 12), (58, 28), (68, 22), (80, 12), (90, 30)], '*')
items(l4, [(12, 14), (24, 22), (36, 30), (48, 18), (54, 8), (72, 28), (86, 26)], 'U')
items(l4, [(5, 3), (30, 38), (90, 8)], 'b')
items(l4, [(16, 8), (76, 26), (88, 38)], 'P')
items(l4, [(14, 22), (62, 16)], 'T')
items(l4, [(28, 8), (66, 36)], 'V')
items(l4, [(48, 26), (82, 18)], 'L')
items(l4, [(48, 22)], 'M')                 # mini-boss (open water mid-gauntlet)

# ---------------- Act V: The Ascent ----------------
# Vertical climb: platforms, updrafts, anemone, hidden wall, fish, goal at top.
l5 = blank()
rect(l5, 8, 30, 12, 2)
rect(l5, 26, 22, 10, 2)
rect(l5, 44, 14, 10, 2)
rect(l5, 62, 8, 10, 2)
rect(l5, 78, 26, 8, 2)
wall_v(l5, 20, 1, 30, 'a', [])
wall_v(l5, 56, 20, H-2, 'h', [34, 35])
wall_v(l5, 14, 4, H-4, '^', [])            # updraft columns carry the climb
wall_v(l5, 34, 4, H-4, '^', [])
wall_v(l5, 50, 4, H-4, '^', [])
wall_v(l5, 70, 4, H-4, '^', [])
items(l5, [(3, 41)], 'S')                  # spawn low...
items(l5, [(30, 38), (58, 18)], 'D')
items(l5, [(90, 3)], 'G')                  # ...goal high: a true ascent
items(l5, [(6, 36), (10, 20), (16, 8), (24, 28), (30, 14), (38, 34), (42, 10),
           (48, 26), (54, 6), (60, 32), (68, 14), (76, 20), (82, 34), (88, 10)], '*')
items(l5, [(12, 26), (28, 18), (36, 26), (46, 34), (58, 26), (72, 16), (80, 12)], 'U')
items(l5, [(24, 10), (66, 20)], 'F')
items(l5, [(4, 38), (44, 6), (86, 38)], 'b')
items(l5, [(18, 16), (64, 30)], 'P')
items(l5, [(22, 12), (62, 34)], 'T')
items(l5, [(40, 28), (74, 10)], 'V')
items(l5, [(48, 20), (84, 6)], 'L')
items(l5, [(47, 22)], 'M')                 # mini-boss guards the climb

# ---------------- Act VI: The Hollow ----------------
# Longer open arena. Heavy enemies, power-ups, currents. All three forms.
l6 = blank()
rect(l6, 10, 8, 6, 5)
rect(l6, 24, 28, 7, 6)
rect(l6, 40, 6, 6, 7)
rect(l6, 56, 24, 7, 6)
rect(l6, 70, 10, 6, 6)
rect(l6, 82, 30, 5, 6)
rect(l6, 48, 36, 6, 4)
wall_v(l6, 34, 1, 20, '#', [21])
wall_v(l6, 62, 22, H-2, '#', [21])
wall_v(l6, 52, 16, 20, 'a', [])
wall_v(l6, 76, 22, 26, 'a', [])
items(l6, [(3, 2)], 'S')
items(l6, [(30, 24), (58, 12), (78, 34)], 'D')
items(l6, [(92, 40)], 'G')
items(l6, [(6, 6), (14, 24), (22, 6), (32, 34), (38, 16), (46, 28), (54, 10),
           (60, 34), (72, 20), (78, 38), (88, 22), (92, 12)], '*')
items(l6, [(12, 18), (26, 14), (36, 28), (42, 34), (58, 18), (74, 30), (86, 20), (90, 34)], 'U')
items(l6, [(20, 14), (44, 20), (68, 20), (84, 24)], 'F')
items(l6, [(18, 20), (50, 26), (88, 14)], 'V')
items(l6, [(28, 10), (66, 36), (80, 8)], 'L')
items(l6, [(30, 18), (70, 36)], 'T')
items(l6, [(16, 20), (50, 30), (86, 8)], 'P')
items(l6, [(5, 2), (34, 38), (64, 6), (92, 26)], 'b')
items(l6, [(48, 22)], 'M')                 # mini-boss (open arena centre)

# ---------------- Act VII: The Matriarch (BOSS) ----------------
# A wide arena. Shoot the Matriarch; dodge her orbs. Power-ups to help.
# Exactly ONE 'B' across the whole game, and only here.
l7 = blank()
rect(l7, 1, 1, W-2, 2)          # ceiling band
rect(l7, 1, H-3, W-2, 2)         # floor band
for x in range(1, W-1):
    l7[3][x] = '.'; l7[H-4][x] = '.'
rect(l7, 8, 12, 5, 20)
rect(l7, 83, 12, 5, 20)
items(l7, [(4, 22)], 'S')
items(l7, [(48, 22)], 'M')      # mini-boss guards the beacon (boss moved to l8)
items(l7, [(48, 6)], 'G')       # beacon — stays cold until the mini-boss is slain
items(l7, [(4, 36), (90, 22)], 'D')
items(l7, [(24, 8), (72, 36), (24, 36), (72, 8), (40, 16), (56, 28)], '*')
items(l7, [(20, 22), (74, 22)], 'P')
items(l7, [(30, 10), (66, 34)], 'L')
items(l7, [(36, 34), (60, 10)], 'V')
items(l7, [(2, 4), (92, 4), (2, 40), (92, 40)], 'b')

# ---------------- Act VIII: The Surface ----------------
# Final ascent. Updrafts, anemone gauntlet, thin safe paths, the beacon.
l8 = blank()
# scattered isolated pillars (never full diagonal walls, so the 4-neighbour
# flood fill stays connected — verified by the reachability validator below)
for x, y in [(8, 6), (16, 12), (24, 6), (34, 14), (42, 8), (50, 12), (58, 6),
            (66, 14), (74, 8), (82, 12), (90, 6), (12, 20), (22, 26), (34, 22),
            (44, 28), (58, 22), (64, 28), (74, 22), (84, 26), (90, 20),
            (10, 34), (20, 38), (32, 34), (40, 40), (50, 36), (60, 40),
            (70, 34), (80, 38), (88, 34)]:
    if l8[y][x] == '.':
        l8[y][x] = '#'
rect(l8, 14, 16, 6, 10)
rect(l8, 52, 14, 6, 10)
wall_v(l8, 30, 6, 34, 'a', [])
wall_v(l8, 66, 8, 38, 'a', [])
items(l8, [(3, 41)], 'S')                  # spawn at the deep end...
items(l8, [(48, 22)], 'B')     # THE MATRIARCH now guards the final surface beacon
items(l8, [(46, 22)], 'D')
items(l8, [(92, 3)], 'G')                  # ...the beacon is the surface
for y in range(4, 41):
    if l8[y][18] == '.': l8[y][18] = '^'
    if l8[y][78] == '.': l8[y][78] = '^'
items(l8, [(6, 36), (16, 30), (28, 10), (38, 30), (48, 10), (58, 34),
           (68, 10), (76, 30), (86, 8), (92, 16)], '*')
items(l8, [(24, 30), (60, 12)], 'P')
items(l8, [(14, 30), (26, 20), (36, 38), (46, 34), (58, 26), (70, 20), (82, 32), (90, 28)], 'U')
items(l8, [(40, 36), (72, 8)], 'L')
items(l8, [(56, 30)], 'V')
items(l8, [(4, 38), (44, 4), (88, 40)], 'b')
items(l8, [(22, 10), (62, 36)], 'T')

# ---------------- emit ----------------
levels = [
    ("Act I — The Trench",
     "WASD / Arrows swim · Q/E shift form · 1 eel 2 angler 3 jelly · SPACE ability · R restart",
     l1),
    ("Act II — The Drift",
     "The curtain burns eel and angler. Become the jellyfish (3). Updrafts carry the willing. Lanternfish hunt your glow — flare them off.",
     l2),
    ("Act III — The Lure",
     "Become the angler (2). The lure reveals what the dark hides. SPACE flare stuns fish and viperfish — costs 2 sparks.",
     l3),
    ("Act IV — The Gauntlet",
     "All three forms. Remember what each one can survive.",
     l4),
    ("Act V — The Ascent",
     "Rise. The surface beacon waits.",
     l5),
    ("Act VI — The Hollow",
     "A longer dark. Shoot to clear the way: aim with the mouse or F, become the right form to survive.",
     l6),
    ("Act VII — The Matriarch",
     "THE MATRIARCH. Do not touch her. Aim with the mouse, hold F to fire. Grab the power-ups first.",
     l7),
    ("Act VIII — The Surface",
     "The last climb. Updrafts and curtains. The beacon is the surface.",
     l8),
]

def reachable(g, sx, sy):
    """4-neighbour flood fill from spawn. '#' and 'h' are solid; 'a' (anemone)
    is passable because the jellyfish form gets through."""
    seen = {(sx, sy)}
    stack = [(sx, sy)]
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen:
                if g[ny][nx] not in ('#', 'h'):
                    seen.add((nx, ny)); stack.append((nx, ny))
    return seen

LAST = len(levels) - 1
for idx, (name, hint, g) in enumerate(levels):
    sp = next(((x, y) for y in range(H) for x in range(W) if g[y][x] == 'S'), None)
    assert sp, f"{name}: no spawn"
    reach = reachable(g, *sp)
    need = [(ch, lbl) for ch, lbl in (('G','goal'), ('D','checkpoint'), ('P','power-up'), ('B','boss'), ('M','mini-boss'))]
    counts = {}
    for ch, lbl in need:
        pts = [(x, y) for y in range(H) for x in range(W) if g[y][x] == ch]
        counts[ch] = len(pts)
        for p in pts:
            assert p in reach, f"{name}: {lbl} at {p} is UNREACHABLE from spawn"
    # 'B' (the Matriarch) lives ONLY on the final act; every other act carries
    # exactly one 'M' mini-boss guarding its beacon.
    if idx == LAST:
        assert counts['B'] == 1, f"{name}: final act must hold exactly one 'B' boss (found {counts['B']})"
        assert counts['M'] == 0, f"{name}: final act must NOT carry an 'M' mini-boss (found {counts['M']})"
    else:
        assert counts['B'] == 0, f"{name}: only the final act may hold the 'B' boss (found {counts['B']})"
        assert counts['M'] == 1, f"{name}: every non-final act needs exactly one 'M' mini-boss (found {counts['M']})"
    openable = len(reach)
    print(f"  reach {name}: {openable} open tiles reachable, B={counts['B']} M={counts['M']} items verified")

for name, hint, g in levels:
    dump(name, g)

parts = []
for name, hint, g in levels:
    rows = ',\n'.join('      "%s"' % ''.join(r) for r in g)
    parts.append(
        '  {\n    name: %s,\n    hint: %s,\n    map: [\n%s,\n    ],\n  },'
        % (json.dumps(name), json.dumps(hint), rows))

out = """// Fish N Chips — level data (generated by tools/gen_levels.py — edit there!)
// Legend: # rock · . water · ^< >v current · a anemone · h hidden block
//         * plankton · S spawn · D checkpoint · G beacon · b bulb
// enemies: U urchin · F dragonfish patrol · V viperfish (charges what it sees)
//          L lanternfish (homes on your light) · T stinger (timed tentacle gate)
// items:   P power-up (overcharge / storm / aegis) · B boss (the Matriarch)

export const TILE = 28;

export const LEVELS = [
%s
];
""" % '\n'.join(parts)

with open('/a0/usr/workdir/nightshift/js/levels.js', 'w') as f:
    f.write(out)
print('WROTE js/levels.js — all maps validated %dx%d' % (W, H))
