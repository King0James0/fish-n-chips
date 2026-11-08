"""Give the Matriarch presence: draw her ~1.5x (collision hitbox unchanged) and
replace the knotted tentacle scribble with long smooth swaying strands."""
P = '/a0/usr/workdir/nightshift/js/main.js'
s = open(P).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"ANCHOR x{n} (want {count}): {old[:80]!r}"
    s = s.replace(old, new, count)

# bigger draw scale, hitbox untouched
rep("    const scl = b.dead ? 1 + b.dieT * 0.4 : 1;",
    "    const scl = b.dead ? 1.5 + b.dieT * 0.5 : 1.5;")

# smoother, longer tentacle strands (quadratic, growing sway, no knot)
rep("""    ctx.strokeStyle = rgba('#b06a86', 0.7 * alpha); ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 1.6;
      ctx.beginPath(); ctx.moveTo(Math.sin(a) * 20, 30);
      let px = Math.sin(a) * 20, py = 30;
      for (let k = 1; k <= 6; k++) { const seg = k * 16; px = Math.sin(a) * 20 + Math.sin(this.time * 3 + i + k * 0.6) * (6 + k * 2); py = 30 + seg; ctx.lineTo(px, py); }
      ctx.stroke();
    }""",
"""    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.5;
      const bx = Math.sin(a) * 26;
      const len = 120 + (i % 2) * 34;
      const sway = 10 + (i % 3) * 5;
      const ph = this.time * 2.2 + i * 0.9;
      const midx = bx + Math.sin(ph) * sway * 0.5;
      const endx = bx + Math.sin(ph + 1.1) * sway;
      ctx.strokeStyle = rgba('#b06a86', (0.55 - Math.abs(a) * 0.12) * alpha); ctx.lineWidth = 5 - Math.abs(a);
      ctx.beginPath(); ctx.moveTo(bx, 26);
      ctx.quadraticCurveTo(midx, 26 + len * 0.55, endx, 26 + len);
      ctx.stroke();
      // glowing tip
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ff9db0', 0.5 * alpha); ctx.beginPath(); ctx.arc(endx, 26 + len, 2.4, 0, 7); ctx.fill();
      ctx.restore();
    }""")

# a touch more light for the bigger silhouette
rep("    this.litSources.push({ x: b.x, y: b.y, r: b.enraged ? 220 : 180, c: b.enraged ? '#ff5d73' : '#ff9db0' });",
    "    this.litSources.push({ x: b.x, y: b.y, r: b.enraged ? 250 : 205, c: b.enraged ? '#ff5d73' : '#ff9db0' });")

open(P, 'w').write(s)
print('BOSS PRESENCE OK')
