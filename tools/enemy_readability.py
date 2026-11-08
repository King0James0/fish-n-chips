#!/usr/bin/env python3
"""Enemy readability pass.

The close-up crops proved two real problems:
  - lanternfish and stinger came back almost pitch black in their own crops
    (self-light too weak, body too dark) — an enemy you cannot see is unfair
  - viperfish and lanternfish both read as "violet fish with a bright dot"

Fixes: stronger self-light per species, brighter bodies/outlines, and a hard
colour split — viperfish violet turning RED while charging, lanternfish
unmistakably amber/gold, stinger dim blue-grey when safe / hot magenta when armed.
"""
import sys

P = '/a0/usr/workdir/nightshift/js/main.js'
src = open(P).read()
EDITS = []


def rep(old, new):
    EDITS.append((old, new))


# ---- 1. self-light: bigger, and colour-coded by state -------------------------
rep("""    for (const v of this.vipers) this.litSources.push({ x: v.x, y: v.y, r: 52 + (v.charge > 0 ? 34 : 0), c: '#8f7dff' });
    for (const l of this.lanterns) this.litSources.push({ x: l.x, y: l.y, r: 46 + (l.pulse || 0) * 22, c: '#ffd98a' });
    for (const s of this.stingers) this.litSources.push({ x: s.x, y: s.y + 10, r: 34 + s.reach * 0.8, c: '#ff7ba8' });""",
    """    for (const v of this.vipers) this.litSources.push({ x: v.x, y: v.y, r: 68 + (v.charge > 0 ? 48 : 0), c: v.charge > 0 ? '#ff5a72' : '#8f7dff' });
    for (const l of this.lanterns) this.litSources.push({ x: l.x, y: l.y, r: 64 + (l.pulse || 0) * 26, c: '#ffd06a' });
    for (const s of this.stingers) this.litSources.push({ x: s.x, y: s.y + 12, r: s.reach > 12 ? 66 + s.reach : 42, c: s.reach > 12 ? '#ff5c96' : '#7fa8bd' });""")

# ---- 2. lanternfish: unmistakably gold, body lifted out of black --------------
rep("""      ctx.fillStyle = '#1b1608';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,130,0.7)'; ctx.lineWidth = 1.4;""",
    """      ctx.fillStyle = '#4a3710';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,130,0.95)'; ctx.lineWidth = 1.7;""")

# ---- 3. viperfish: violet outline, goes red the instant it commits ------------
rep("""      ctx.strokeStyle = `rgba(160,140,255,${0.55 + glow * 0.4})`; ctx.lineWidth = 1.3;""",
    """      ctx.strokeStyle = lunging ? `rgba(255,110,130,${0.75 + glow * 0.25})` : `rgba(175,155,255,${0.7 + glow * 0.3})`;
      ctx.lineWidth = 1.7;""")

rep("""      ctx.fillStyle = stunned ? '#2a2540' : '#160f2e';""",
    """      ctx.fillStyle = stunned ? '#3a3458' : '#241a44';""")

# ---- 4. stinger: visible when safe, alarming when armed -----------------------
rep("""      ctx.strokeStyle = hot ? 'rgba(255,140,180,0.9)' : 'rgba(130,170,190,0.6)';""",
    """      ctx.strokeStyle = hot ? 'rgba(255,140,180,1)' : 'rgba(155,205,230,0.9)';""")

rep("""        ctx.strokeStyle = hot ? `rgba(255,120,168,${0.35 + ext * 0.5})` : 'rgba(120,160,180,0.4)';""",
    """        ctx.strokeStyle = hot ? `rgba(255,120,168,${0.5 + ext * 0.5})` : 'rgba(155,205,230,0.6)';""")

rep("""      bg.addColorStop(0, hot ? '#7a1c3a' : '#1d2f3a');
      bg.addColorStop(1, hot ? '#2e0817' : '#0c161c');""",
    """      bg.addColorStop(0, hot ? '#a02650' : '#2c4a5c');
      bg.addColorStop(1, hot ? '#3a0a1e' : '#12222c');""")

# ---- 5. dragonfish: lift it out of the murk -----------------------------------
rep("""      const body = stunned ? 'rgba(140,185,225,0.9)' : 'rgba(120,26,44,0.95)';""",
    """      const body = stunned ? 'rgba(140,185,225,0.9)' : 'rgba(176,40,64,0.95)';""")

rep("""      ctx.strokeStyle = stunned ? 'rgba(180,225,255,0.7)' : 'rgba(255,120,140,0.8)';
      ctx.lineWidth = 1.3;""",
    """      ctx.strokeStyle = stunned ? 'rgba(180,225,255,0.85)' : 'rgba(255,145,165,0.95)';
      ctx.lineWidth = 1.7;""")

fails = 0
for i, (old, new) in enumerate(EDITS, 1):
    n = src.count(old)
    if n != 1:
        print(f"FAIL edit {i}: matched {n} times\n{old[:150]!r}")
        fails += 1
        continue
    src = src.replace(old, new)
if fails:
    sys.exit(f"{fails} edit(s) failed — file NOT written")
open(P, 'w').write(src)
print(f"enemy readability pass: {len(EDITS)} edits applied")
