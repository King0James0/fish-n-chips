"""Make the new acts robust: tolerant `place()` (skips blocked tiles, reports counts)
and a BFS reachability validator so every goal / checkpoint / power-up / boss is
actually reachable from spawn — validated at build time, not assumed."""
P = '/a0/usr/workdir/nightshift/tools/gen_levels.py'
s = open(P).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"ANCHOR x{n} (want {count}): {old[:80]!r}"
    s = s.replace(old, new, count)

# 1) tolerant placement helper (after col())
rep("def col(g, x, y0, y1, ch):\n    for y in range(y0, y1+1): put(g, x, y, ch)",
"""def col(g, x, y0, y1, ch):
    for y in range(y0, y1+1): put(g, x, y, ch)

def place(g, coords, ch, tag=''):
    \"\"\"Place ch on every OPEN tile in coords; skip (and report) blocked ones.\"\"\"
    ok = skipped = 0
    for x, y in coords:
        if g[y][x] == '.':
            g[y][x] = ch; ok += 1
        else:
            skipped += 1
    print(f"  place {ch} {tag}: {ok} placed, {skipped} skipped")
    assert ok > 0, f"nothing placed for {ch} {tag} — all tiles blocked"
    return ok""")

# 2) swap the colliding hand-placements in the new acts for tolerant place()
rep("""for x, y in [(6,4),(16,10),(24,20),(32,8),(38,18),(48,16),(52,8),(58,20),(12,22),(42,22)]:
    put(l6, x, y, '*', True)""",
    "place(l6, [(6,4),(16,10),(24,22),(32,8),(38,18),(48,18),(52,8),(58,20),(12,22),(42,22)], '*', 'plankton')")
rep("""for x, y in [(14,8),(36,10),(50,14),(22,4)]:
    put(l6, x, y, 'U', True)""",
    "place(l6, [(14,8),(32,10),(44,14),(22,4)], 'U', 'urchin')")
rep("""for x, y in [(18,14),(34,16),(54,10)]:
    put(l6, x, y, 'F', True)""",
    "place(l6, [(18,14),(34,16),(54,10)], 'F', 'dragon')")
rep("""for x, y in [(24,8),(46,20)]:
    put(l6, x, y, 'V', True)""",
    "place(l6, [(24,8),(46,20)], 'V', 'viper')")
rep("""for x, y in [(30,6),(52,18)]:
    put(l6, x, y, 'L', True)""",
    "place(l6, [(30,6),(52,18)], 'L', 'lantern')")
rep("""for x, y in [(36,8)]:
    put(l6, x, y, 'T', True)""",
    "place(l6, [(32,8)], 'T', 'stinger')")
rep("""for x, y in [(44,16),(48,18)]:
    put(l6, x, y, 'a', True)""",
    "place(l6, [(44,16),(48,18)], 'a', 'anemone')")
rep("""for x, y in [(10,18),(50,4)]:
    put(l6, x, y, 'P', True)""",
    "place(l6, [(10,18),(50,4)], 'P', 'powerup')")
rep("""for x, y in [(5,2),(60,4)]:
    put(l6, x, y, 'b', True)
for y in range(16,22): put(l6, 50, y, 'a', True) if l6[y][50]=='.' else None""",
    "place(l6, [(5,2),(60,4)], 'b', 'bulb')\nplace(l6, [(50,y) for y in range(17,22)], 'a', 'curtain')")

# Act VIII: goal sat on a diagonal pillar; plankton too
rep("put(l8, 60, 3, 'G', True)", "put(l8, 60, 4, 'G', True)")
rep("""for x, y in [(8,20),(20,16),(30,8),(44,12),(52,6),(56,18),(22,4),(48,22)]:
    put(l8, x, y, '*', True)""",
    "place(l8, [(8,20),(20,17),(30,8),(44,12),(52,6),(56,18),(22,4),(48,22)], '*', 'plankton')")
rep("""for x, y in [(18,8),(42,18)]:
    put(l8, x, y, 'P', True)""",
    "place(l8, [(18,8),(42,18)], 'P', 'powerup')")
rep("""for x, y in [(20,20),(44,4)]:
    put(l8, x, y, 'U', True)""",
    "place(l8, [(20,20),(44,4)], 'U', 'urchin')")
rep("""for x, y in [(38,20),(28,4)]:
    put(l8, x, y, 'L', True)""",
    "place(l8, [(38,20),(28,4)], 'L', 'lantern')")
rep("""for x, y in [(3,22),(60,5)]:
    put(l8, x, y, 'b', True)""",
    "place(l8, [(3,22),(60,6)], 'b', 'bulb')")

# 3) BFS reachability validator, run before emit
rep("for name, hint, g in levels:\n    dump(name, g)",
"""def reachable(g, sx, sy):
    \"\"\"4-neighbour flood fill from spawn. '#' and 'h' are solid; 'a' (anemone)
    is passable because the jellyfish form gets through.\"\"\"
    seen = {(sx, sy)}
    stack = [(sx, sy)]
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen:
                if g[ny][nx] not in ('#', 'h'):
                    seen.add((nx, ny)); stack.append((nx, ny))
    return seen

for name, hint, g in levels:
    sp = next(((x, y) for y in range(H) for x in range(W) if g[y][x] == 'S'), None)
    assert sp, f"{name}: no spawn"
    reach = reachable(g, *sp)
    need = [(ch, lbl) for ch, lbl in (('G','goal'), ('D','checkpoint'), ('P','power-up'), ('B','boss'))]
    for ch, lbl in need:
        pts = [(x, y) for y in range(H) for x in range(W) if g[y][x] == ch]
        for p in pts:
            assert p in reach, f"{name}: {lbl} at {p} is UNREACHABLE from spawn"
    openable = len(reach)
    print(f"  reach {name}: {openable} open tiles reachable, {len(pts)} boss/checkpoint/power items verified")

for name, hint, g in levels:
    dump(name, g)""")

open(P, 'w').write(s)
print('VALIDATOR PATCH OK')
