#!/usr/bin/env python3
"""Creature pass: the forms had real anatomy, but the glow halo + bloom washed it
down to a bright blob. Redraw all three as dark silhouettes with glowing rims,
fins, tails, eyes and detail that survive the bloom; tame halo/bloom/tint alphas.
Every edit is asserted to match exactly once."""
import sys

P = '/a0/usr/workdir/nightshift/js/main.js'
src = open(P).read()
EDITS = []


def rep(old, new):
    EDITS.append((old, new))


# ---- tame the things that were eating the bodies -------------------------------
rep("""      ctx.fillStyle = rgba(f.glow, a * 0.10);""",
    """      ctx.fillStyle = rgba(f.glow, a * 0.06);""")

rep("""    ctx.globalAlpha = 0.5;
    ctx.filter = 'blur(9px)';""",
    """    ctx.globalAlpha = 0.34;
    ctx.filter = 'blur(9px)';""")

rep("""    ctx.globalAlpha = 0.26;
    ctx.filter = 'blur(24px)';""",
    """    ctx.globalAlpha = 0.16;
    ctx.filter = 'blur(24px)';""")

rep("""      g.addColorStop(0, rgba(l.c, 0.15));
      g.addColorStop(0.45, rgba(l.c, 0.045));""",
    """      g.addColorStop(0, rgba(l.c, 0.1));
      g.addColorStop(0.45, rgba(l.c, 0.03));""")

# ---- EEL ----------------------------------------------------------------------
rep("""    if (f.key === 'eel') {
      ctx.rotate(ang);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      g.addColorStop(0, rgba(f.glow, 0.5)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();
      ctx.restore();
      // segmented body
      for (let i = 6; i >= 0; i--) {
        const t = i / 6;
        const wob = Math.sin(this.time * 10 + i * 0.9) * (2 + speed * 0.01) * t;
        const rr = 7.5 * (1 - t * 0.72);
        ctx.fillStyle = i === 0 ? f.body : rgba(f.body, 0.85 - t * 0.5);
        ctx.beginPath(); ctx.ellipse(-i * 6.2, wob * 0.6, rr + 1.2, rr, 0, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#06231f'; ctx.beginPath(); ctx.arc(4.5, -2.4, 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4.8, -2.6, 0.8, 0, 7); ctx.fill();
    } else if (f.key === 'angler') {""",
"""    if (f.key === 'eel') {
      ctx.rotate(ang);
      // small dim halo — the body must stay readable, not become the light
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, rgba(f.glow, 0.24)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.restore();
      // ---- eel: dark tapered body, glowing belly rim, undulating spine ----
      const seg = 9, pitch = 5.8;
      const spine = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const wob = Math.sin(this.time * 9 - i * 0.8) * (1.8 + speed * 0.013) * t;
        spine.push({ x: -i * pitch, y: wob, r: 7.6 * (1 - t * 0.8) + 0.9 });
      }
      // tail fin first, so the body laps over its root
      const tl = spine[spine.length - 1];
      ctx.fillStyle = rgba(f.glow, 0.32);
      ctx.beginPath();
      ctx.moveTo(tl.x + 1, tl.y);
      ctx.lineTo(tl.x - 9, tl.y - 6.5); ctx.lineTo(tl.x - 4.5, tl.y); ctx.lineTo(tl.x - 9, tl.y + 6.5);
      ctx.closePath(); ctx.fill();
      // one continuous silhouette instead of a stack of circles
      ctx.fillStyle = '#04141c';
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y - spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y - s.r);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y + spine[i].r);
      ctx.closePath(); ctx.fill();
      // dorsal fin ridge
      ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      for (let i = 0; i < spine.length - 1; i++) {
        const s = spine[i], n = spine[i + 1];
        ctx.beginPath(); ctx.moveTo(s.x, s.y - s.r + 0.5);
        ctx.lineTo(n.x, n.y - n.r - 2.4); ctx.stroke();
      }
      // glowing belly line
      ctx.strokeStyle = rgba(f.glow, 0.85); ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < spine.length; i++) {
        const s = spine[i];
        i ? ctx.lineTo(s.x, s.y + s.r) : ctx.moveTo(s.x, s.y + s.r);
      }
      ctx.stroke();
      // head: bright collar, dark skull, eye, jaw
      ctx.fillStyle = rgba(f.body, 0.95);
      ctx.beginPath(); ctx.ellipse(2.2, 0, 8.8, 6.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#04141c';
      ctx.beginPath(); ctx.ellipse(3, 0.7, 7.1, 5.3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#eafff9'; ctx.beginPath(); ctx.arc(5.6, -2.4, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#03201b'; ctx.beginPath(); ctx.arc(6.2, -2.4, 1.15, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10, 1.6); ctx.lineTo(4, 4.4); ctx.stroke();
    } else if (f.key === 'angler') {""")

# ---- ANGLER -------------------------------------------------------------------
rep("""      ctx.rotate(ang * 0.35);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 44);
      g.addColorStop(0, rgba(f.glow, 0.42)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 44, 0, 7); ctx.fill();
      ctx.restore();
      // bulky body
      ctx.fillStyle = '#3a2a12';
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 11, 0, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(f.body, 0.85);
      ctx.beginPath(); ctx.ellipse(-1, -1, 12, 8.5, 0, 0, 7); ctx.fill();
      // teeth
      ctx.fillStyle = '#fff7e0';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(6 + i * 2.2, 3); ctx.lineTo(7 + i * 2.2, 6.5); ctx.lineTo(8.6 + i * 2.2, 3); ctx.fill(); }
      ctx.fillStyle = '#1a0f00'; ctx.beginPath(); ctx.arc(6, -3, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(6.6, -3.2, 1.2, 0, 7); ctx.fill();
      // lure on a stalk
      const lx = 16 + Math.sin(this.time * 2.2) * 2, ly = -18 + Math.cos(this.time * 1.7) * 2;
      ctx.strokeStyle = 'rgba(255,220,150,0.8)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(4, -9); ctx.quadraticCurveTo(14, -16, lx, ly); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 22);
      lg.addColorStop(0, 'rgba(255,240,190,1)'); lg.addColorStop(0.3, 'rgba(255,200,90,0.5)'); lg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 22, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, 7); ctx.fill();
    } else {""",
"""      ctx.rotate(ang * 0.35);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      g.addColorStop(0, rgba(f.glow, 0.2)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
      ctx.restore();
      // ---- anglerfish: bulky dark body, gaping toothed jaw, lure on a rod ----
      // tail fin, fanning
      ctx.save(); ctx.rotate(Math.sin(this.time * 5.5) * 0.16);
      ctx.fillStyle = rgba(f.glow, 0.3);
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-25, -10); ctx.lineTo(-20, 0); ctx.lineTo(-25, 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // dorsal spines
      ctx.strokeStyle = rgba(f.body, 0.7); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = -9 + i * 4.6;
        ctx.beginPath(); ctx.moveTo(x, -9); ctx.lineTo(x - 1.6, -15 - (i % 2) * 2.5); ctx.stroke();
      }
      // body: dark mass with a glowing outline
      ctx.fillStyle = '#241705';
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 11.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.7); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 11.5, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = rgba(f.body, 0.2);
      ctx.beginPath(); ctx.ellipse(-2.5, -2.5, 10.5, 6.5, 0, 0, 7); ctx.fill();
      // photophore dots along the flank
      ctx.fillStyle = rgba(f.glow, 0.75);
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-11 + i * 4.4, 6.8, 1, 0, 7); ctx.fill(); }
      // gaping jaw
      ctx.fillStyle = '#120a01';
      ctx.beginPath();
      ctx.moveTo(4, -6.5); ctx.quadraticCurveTo(20, -4.5, 17.5, 1);
      ctx.quadraticCurveTo(12, 8.5, 3, 7.5);
      ctx.closePath(); ctx.fill();
      // teeth, upper and lower
      ctx.fillStyle = '#fff6dd';
      const teeth = [[6, -5, 3], [9.5, -3.8, 3.4], [13, -2, 2.8], [15.5, 0.6, 2.2],
                     [7, 5.8, -3], [10.5, 4.8, -3.3], [13.5, 3, -2.5]];
      for (const [tx, ty, th] of teeth) {
        ctx.beginPath(); ctx.moveTo(tx - 1.6, ty); ctx.lineTo(tx, ty + th); ctx.lineTo(tx + 1.6, ty);
        ctx.closePath(); ctx.fill();
      }
      // eye with catchlight
      ctx.fillStyle = '#f7f2df'; ctx.beginPath(); ctx.arc(5.2, -5.6, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#140c02'; ctx.beginPath(); ctx.arc(6.1, -5.6, 1.8, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(4.2, -6.7, 0.95, 0, 7); ctx.fill();
      // illicium (fishing rod) + esca (the glowing bait)
      const lx = 21 + Math.sin(this.time * 2.1) * 2.5, ly = -23 + Math.cos(this.time * 1.6) * 2.5;
      ctx.strokeStyle = rgba(f.body, 0.95); ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(6, -10.5); ctx.quadraticCurveTo(18, -20, lx, ly); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 15);
      lg.addColorStop(0, 'rgba(255,246,210,0.9)'); lg.addColorStop(0.35, 'rgba(255,205,110,0.35)'); lg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 15, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, 7); ctx.fill();
    } else {""")

# ---- JELLY --------------------------------------------------------------------
rep("""      // jellyfish bell + tentacles
      const sq = 1 + Math.sin(this.time * 3.2) * 0.12;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
      g.addColorStop(0, rgba(f.glow, 0.5)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 40, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = rgba(f.body, 0.55);
      ctx.beginPath(); ctx.ellipse(0, -2, 12 * sq, 10 / sq, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.9); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, -2, 12 * sq, 10 / sq, 0, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const ox = -10 + i * 4;
        const sw = Math.sin(this.time * 4 + i) * 4;
        ctx.beginPath(); ctx.moveTo(ox, 0);
        ctx.quadraticCurveTo(ox + sw * 0.5, 9, ox + sw, 18);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(0, -6, 2.2, 0, 7); ctx.fill();
    }""",
"""      // ---- jellyfish: pulsing translucent bell, radial canals, trailing arms ----
      const sq = 1 + Math.sin(this.time * 3.0) * 0.14;
      const bw = 13.5 * sq, bh = 11 / sq;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -2, 0, 0, -2, 28);
      g.addColorStop(0, rgba(f.glow, 0.22)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -2, 28, 0, 7); ctx.fill();
      ctx.restore();
      ctx.lineCap = 'round';
      // long trailing tentacles first, so the bell laps over their roots
      ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) {
        const ox = -11.5 + i * 2.9;
        const len = 24 + (i % 3) * 8;
        const sw = Math.sin(this.time * 2.6 + i * 0.8) * 6;
        ctx.beginPath(); ctx.moveTo(ox, 1);
        ctx.bezierCurveTo(ox + sw * 0.4, 1 + len * 0.4, ox + sw, 1 + len * 0.72, ox + sw * 0.6, 1 + len);
        ctx.stroke();
      }
      // oral arms: thicker, frilled, hanging centrally
      ctx.strokeStyle = rgba(f.body, 0.55); ctx.lineWidth = 2.8;
      for (let i = 0; i < 4; i++) {
        const ox = -5 + i * 3.3;
        const sw = Math.sin(this.time * 2.2 + i) * 4.5;
        ctx.beginPath(); ctx.moveTo(ox, 0);
        ctx.quadraticCurveTo(ox + sw, 11, ox + sw * 1.5, 18);
        ctx.stroke();
      }
      // bell: dark inner mass under a glowing membrane
      ctx.fillStyle = 'rgba(26,10,50,0.88)';
      ctx.beginPath(); ctx.ellipse(0, -2, bw, bh, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = rgba(f.body, 0.34);
      ctx.beginPath(); ctx.ellipse(0, -2, bw, bh, 0, Math.PI, 0); ctx.fill();
      // radial canals
      ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 5);
        ctx.beginPath(); ctx.moveTo(0, -2);
        ctx.lineTo(Math.cos(a) * bw * 0.9, -2 + Math.sin(a) * bh * 0.9);
        ctx.stroke();
      }
      // circular canal + scalloped margin
      ctx.strokeStyle = rgba(f.glow, 0.95); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(0, -2, bw, bh, 0, Math.PI, 0); ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      const notches = 8;
      for (let i = 0; i <= notches; i++) {
        const t = i / notches;
        const x = -bw + 2 * bw * t;
        const y = -2 + Math.abs(Math.sin(t * Math.PI * notches)) * 2.2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // gonad core + highlight
      ctx.fillStyle = rgba(f.glow, 0.8);
      ctx.beginPath(); ctx.ellipse(0, -5.5, 4.4, 3.2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.arc(-1.5, -6.6, 1.4, 0, 7); ctx.fill();
    }""")

fails = 0
for i, (old, new) in enumerate(EDITS, 1):
    n = src.count(old)
    if n != 1:
        print(f"FAIL edit {i}: matched {n} times\n{old[:140]!r}")
        fails += 1
        continue
    src = src.replace(old, new)
if fails:
    sys.exit(f"{fails} edit(s) failed — file NOT written")

open(P, 'w').write(src)
print(f"applied {len(EDITS)} creature edits -> js/main.js")
