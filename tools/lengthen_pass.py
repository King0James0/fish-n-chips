#!/usr/bin/env python3
"""Lengthen the game: add power-up pickups (P) into existing acts and append three
new acts — VI The Hollow, VII The Matriarch (boss), VIII The Surface. Regenerates
js/levels.js via the existing validated generator. Fails loudly on any anchor miss."""
P = '/a0/usr/workdir/nightshift/tools/gen_levels.py'
s = open(P).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"ANCHOR x{n} (want {count}): {old[:80]!r}"
    s = s.replace(old, new, count)

# widen grid for longer levels
rep("W, H = 48, 27", "W, H = 64, 27")

# power-ups sprinkled into the existing acts (open-water tiles only)
rep("for x, y in [(5,2),(35,3),(44,16)]:\n    put(l1, x, y, 'b', True)",
    "for x, y in [(5,2),(35,3),(44,16)]:\n    put(l1, x, y, 'b', True)\nfor x, y in [(48,12)]:\n    put(l1, x, y, 'P', True)")
rep("for x, y in [(5,3),(36,4)]:\n    put(l2, x, y, 'b', True)",
    "for x, y in [(5,3),(36,4)]:\n    put(l2, x, y, 'b', True)\nfor x, y in [(50,8)]:\n    put(l2, x, y, 'P', True)")
rep("for x, y in [(5,4),(44,16)]:\n    put(l3, x, y, 'b', True)",
    "for x, y in [(5,4),(44,16)]:\n    put(l3, x, y, 'b', True)\nfor x, y in [(52,20)]:\n    put(l3, x, y, 'P', True)")
rep("for x, y in [(5,3),(44,10)]:\n    put(l4, x, y, 'b', True)",
    "for x, y in [(5,3),(44,10)]:\n    put(l4, x, y, 'b', True)\nfor x, y in [(48,4),(54,22)]:\n    put(l4, x, y, 'P', True)")

# three new acts, appended before the emit block
new_acts = '''
# ---------------- Act VI: The Hollow ----------------
# Longer open arena. Heavy enemies, power-ups, currents. All three forms.
l6 = blank()
rect(l6, 8, 6, 5, 4)
rect(l6, 20, 16, 6, 5)
rect(l6, 34, 5, 5, 6)
rect(l6, 46, 12, 6, 5)
rect(l6, 56, 4, 4, 6)
col(l6, 28, 1, 12, '#'); put(l6, 28, 13, '.')
col(l6, 40, 14, 25, '#'); put(l6, 40, 13, '.')
put(l6, 3, 2, 'S', True)
put(l6, 60, 22, 'G', True)
put(l6, 30, 20, 'D', True)
put(l6, 44, 6, 'D', True)
for x, y in [(6,4),(16,10),(24,20),(32,8),(38,18),(48,16),(52,8),(58,20),(12,22),(42,22)]:
    put(l6, x, y, '*', True)
for x, y in [(14,8),(36,10),(50,14),(22,4)]:
    put(l6, x, y, 'U', True)
for x, y in [(18,14),(34,16),(54,10)]:
    put(l6, x, y, 'F', True)
for x, y in [(24,8),(46,20)]:
    put(l6, x, y, 'V', True)
for x, y in [(30,6),(52,18)]:
    put(l6, x, y, 'L', True)
for x, y in [(36,8)]:
    put(l6, x, y, 'T', True)
for x, y in [(44,16),(48,18)]:
    put(l6, x, y, 'a', True)
for x, y in [(10,18),(50,4)]:
    put(l6, x, y, 'P', True)
for x, y in [(5,2),(60,4)]:
    put(l6, x, y, 'b', True)
for y in range(16,22): put(l6, 50, y, 'a', True) if l6[y][50]=='.' else None

# ---------------- Act VII: The Matriarch (BOSS) ----------------
# A wide arena. Shoot the Matriarch; dodge her orbs. Power-ups to help.
l7 = blank()
rect(l7, 1, 1, 62, 2)          # ceiling band
rect(l7, 1, 24, 62, 2)         # floor band
for x in range(1, 63):
    l7[3][x] = '.'; l7[23][x] = '.'
rect(l7, 6, 8, 4, 12)
rect(l7, 54, 8, 4, 12)
put(l7, 3, 13, 'S', True)
put(l7, 32, 13, 'B', True)     # the Matriarch
put(l7, 3, 20, 'D', True)
for x, y in [(14,6),(50,20),(14,20),(50,6)]:
    put(l7, x, y, '*', True)
for x, y in [(12,13),(52,13)]:
    put(l7, x, y, 'P', True)
for x, y in [(20,6),(44,20)]:
    put(l7, x, y, 'L', True)
for x, y in [(24,20),(40,6)]:
    put(l7, x, y, 'V', True)
for x, y in [(2,4),(61,22)]:
    put(l7, x, y, 'b', True)

# ---------------- Act VIII: The Surface ----------------
# Final ascent. Updrafts, anemone gauntlet, thin safe paths, the beacon.
l8 = blank()
for y in range(1, 26):
    for x in range(1, 63):
        if (x + y) % 9 == 0 and l8[y][x] == '.':
            l8[y][x] = '#'
rect(l8, 10, 10, 6, 8)
rect(l8, 40, 8, 6, 8)
for y in range(6, 20): put(l8, 26, y, 'a', True) if l8[y][26]=='.' else None
put(l8, 26, 20, '.')
for y in range(4, 16): put(l8, 34, y, 'a', True) if l8[y][34]=='.' else None
put(l8, 34, 16, '.')
put(l8, 3, 23, 'S', True)
put(l8, 60, 3, 'G', True)
put(l8, 30, 13, 'D', True)
for y in range(4, 22, 3):
    put(l8, 14, y, '^', True) if l8[y][14]=='.' else None
    put(l8, 46, y, '^', True) if l8[y][46]=='.' else None
for x, y in [(8,20),(20,16),(30,8),(44,12),(52,6),(56,18),(22,4),(48,22)]:
    put(l8, x, y, '*', True)
for x, y in [(18,8),(42,18)]:
    put(l8, x, y, 'P', True)
for x, y in [(20,20),(44,4)]:
    put(l8, x, y, 'U', True)
for x, y in [(38,20),(28,4)]:
    put(l8, x, y, 'L', True)
for x, y in [(3,22),(60,5)]:
    put(l8, x, y, 'b', True)

'''
rep("# ---------------- emit ----------------", new_acts + "# ---------------- emit ----------------")

# register the new acts
rep("""    ("Act V — The Ascent",
     "Rise. The surface beacon waits.",
     l5),
]""",
"""    ("Act V — The Ascent",
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
]""")

# legend: document P and B
rep("//          L lanternfish (homes on your light) · T stinger (timed tentacle gate)",
    "//          L lanternfish (homes on your light) · T stinger (timed tentacle gate)\n"
    "// items:   P power-up (overcharge / storm / aegis) · B boss (the Matriarch)")

open(P, 'w').write(s)
print('GEN LEVELS PATCH OK —', s.count(chr(10)), 'lines')
