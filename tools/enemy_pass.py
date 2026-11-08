#!/usr/bin/env python3
"""Enemy pass for Fish N Chips.

Adds three new enemy species with distinct AI, upgrades the existing patrol fish
into a proper dragonfish, and adds detail to the urchins and the player forms.

  V  VIPERFISH   lurks, then charges on a line-of-sight trigger; flare stuns it
  L  LANTERNFISH slow drifter that homes on your light; flare scatters it
  T  STINGER     static column of tentacles that extends and retracts on a cycle
                 (lethal only while extended — a timed gate you can read)

Every edit is asserted; the script refuses to write if anything does not match.
"""
import sys

P = '/a0/usr/workdir/nightshift/js/main.js'
src = open(P).read()
EDITS = []


def rep(old, new):
    EDITS.append((old, new))


# ============================================================ 1. state buckets
rep("""    this.urchins = [];
    this.fish = [];""",
    """    this.urchins = [];
    this.fish = [];
    this.vipers = [];
    this.lanterns = [];
    this.stingers = [];""")

# ============================================================ 2. map parsing
rep("""        else if (c === 'F') this.fish.push({ x: cx, y: cy, x0: cx, dir: 1, stun: 0, ph: Math.random() * 6 });""",
    """        else if (c === 'F') this.fish.push({ x: cx, y: cy, x0: cx, dir: 1, stun: 0, ph: Math.random() * 6 });
        else if (c === 'V') this.vipers.push({ x: cx, y: cy, x0: cx, y0: cy, dir: 1, stun: 0, charge: 0, rest: 0, vx: 0, vy: 0, ph: Math.random() * 6 });
        else if (c === 'L') this.lanterns.push({ x: cx, y: cy, x0: cx, y0: cy, stun: 0, ph: Math.random() * 6 });
        else if (c === 'T') this.stingers.push({ x: cx, y: cy, ph: Math.random() * 6, reach: 0 });""")

# ============================================================ 3. LOS helper
rep("""  say(t) { this.msg = { text: t, t: 0 }; }""",
    """  losClear(x1, y1, x2, y2) {
    const n = 14;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const tc = this.tileAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      if (tc === '#' || tc === 'h') return false;
    }
    return true;
  }

  say(t) { this.msg = { text: t, t: 0 }; }""")

# ============================================================ 4. flare stuns all
rep("""      for (const f of this.fish) {
        if (Math.hypot(f.x - this.px, f.y - this.py) < 240) { f.stun = 3.2; this.burst(f.x, f.y, 8, '#8ecae6', 60); }
      }""",
    """      for (const f of this.fish) {
        if (Math.hypot(f.x - this.px, f.y - this.py) < 240) { f.stun = 3.2; this.burst(f.x, f.y, 8, '#8ecae6', 60); }
      }
      for (const v of this.vipers) {
        if (Math.hypot(v.x - this.px, v.y - this.py) < 260) { v.stun = 3.4; v.charge = 0; v.rest = 1.2; this.burst(v.x, v.y, 10, '#9d8cff', 70); }
      }
      for (const l of this.lanterns) {
        if (Math.hypot(l.x - this.px, l.y - this.py) < 260) { l.stun = 4.0; this.burst(l.x, l.y, 8, '#ffe08a', 60); }
      }""")

# ============================================================ 5. enemy AI
rep("""      if (Math.hypot(fi.x - this.px, fi.y - this.py) < r + 13 && fi.stun <= 0) { this.die(); return; }
    }""",
    """      if (Math.hypot(fi.x - this.px, fi.y - this.py) < r + 13 && fi.stun <= 0) { this.die(); return; }
    }

    // ---- VIPERFISH: lurks, then charges what it can see -----------------------
    for (const v of this.vipers) {
      v.stun = Math.max(0, v.stun - dt);
      const dx = this.px - v.x, dy = this.py - v.y;
      const d = Math.hypot(dx, dy);
      if (v.stun > 0) {
        v.vx *= 0.86; v.vy *= 0.86;
      } else if (v.charge > 0) {
        v.charge -= dt;
        v.x += v.vx * dt; v.y += v.vy * dt;
        if (this.tileAt(v.x, v.y) === '#' || this.tileAt(v.x, v.y) === 'h') {
          v.x -= v.vx * dt; v.y -= v.vy * dt; v.charge = 0; v.rest = 1.1;
        }
        if (Math.random() < 0.5) this.particles.push({ x: v.x, y: v.y, vx: rnd(-12, 12), vy: rnd(-12, 12), life: 0.35, max: 0.35, c: '#8f7dff', s: rnd(1, 2.4), g: 0 });
      } else if (v.rest > 0) {
        v.rest -= dt;
        v.x += (v.x0 - v.x) * 1.6 * dt; v.y += (v.y0 - v.y) * 1.6 * dt;
      } else {
        // drift on station, watching
        v.x += Math.sin(this.time * 0.8 + v.ph) * 9 * dt + (v.x0 - v.x) * 0.6 * dt;
        v.y += Math.cos(this.time * 0.6 + v.ph) * 7 * dt + (v.y0 - v.y) * 0.6 * dt;
        if (d < 250 && this.losClear(v.x, v.y, this.px, this.py)) {
          v.charge = 0.62; v.rest = 1.15;
          const u = 1 / Math.max(d, 1), sp = 330;
          v.vx = dx * u * sp; v.vy = dy * u * sp;
          this.au.blip(230, 0.1, 'sawtooth', 0.12);
          this.ring(v.x, v.y, '#8f7dff', 4, 40, 0.3);
        }
      }
      if (Math.abs(v.vx) > 4) v.dir = v.vx < 0 ? -1 : 1;
      v.glow = v.charge > 0 ? 1 : (v.stun > 0 ? 0.25 : 0.55 + 0.2 * Math.sin(this.time * 2 + v.ph));
      if (v.stun <= 0 && Math.hypot(v.x - this.px, v.y - this.py) < r + 14) { this.say('viperfish — it charges what it can see'); this.die(); return; }
    }

    // ---- LANTERNFISH: slow, drawn to your light -------------------------------
    for (const l of this.lanterns) {
      l.stun = Math.max(0, l.stun - dt);
      const dx = this.px - l.x, dy = this.py - l.y;
      const d = Math.hypot(dx, dy) || 1;
      if (l.stun > 0) {
        l.x -= dx / d * 46 * dt; l.y -= dy / d * 46 * dt;
      } else if (d < 300) {
        l.x += dx / d * 34 * dt; l.y += dy / d * 34 * dt;
      } else {
        l.x += (l.x0 - l.x) * 0.4 * dt + Math.sin(this.time * 0.5 + l.ph) * 8 * dt;
        l.y += (l.y0 - l.y) * 0.4 * dt + Math.cos(this.time * 0.4 + l.ph) * 8 * dt;
      }
      if (this.tileAt(l.x, l.y) === '#' || this.tileAt(l.x, l.y) === 'h') { l.x -= dx / d * 40 * dt; l.y -= dy / d * 40 * dt; }
      l.dir = dx < 0 ? -1 : 1;
      l.pulse = 0.6 + 0.4 * Math.sin(this.time * 1.6 + l.ph);
      if (l.stun <= 0 && Math.hypot(l.x - this.px, l.y - this.py) < r + 12) { this.say('lanternfish hunts your glow — flare it away'); this.die(); return; }
    }

    // ---- STINGER: a timed gate, lethal only while extended --------------------
    for (const s of this.stingers) {
      const cyc = Math.sin(this.time * 1.15 + s.ph);
      s.reach = cyc > 0 ? cyc * 40 : 0;
      if (s.reach > 12 && Math.hypot(s.x - this.px, s.y - this.py) < r + s.reach * 0.78) {
        this.say('stinger — wait for it to retract, then pass');
        this.die(); return;
      }
    }""")

# ============================================================ 6. draw order
rep("""    this.drawUrchins();
    this.drawFish();""",
    """    this.drawUrchins();
    this.drawStingers();
    this.drawLanterns();
    this.drawFish();
    this.drawVipers();""")

# ---- enemies carry their own light so they read in the dark -------------------
rep("""    if (this.goal) this.litSources.push({ x: this.goal.x, y: this.goal.y, r: 110, c: '#ffcf7a' });""",
    """    for (const v of this.vipers) this.litSources.push({ x: v.x, y: v.y, r: 52 + (v.charge > 0 ? 34 : 0), c: '#8f7dff' });
    for (const l of this.lanterns) this.litSources.push({ x: l.x, y: l.y, r: 46 + (l.pulse || 0) * 22, c: '#ffd98a' });
    for (const s of this.stingers) this.litSources.push({ x: s.x, y: s.y + 10, r: 34 + s.reach * 0.8, c: '#ff7ba8' });
    if (this.goal) this.litSources.push({ x: this.goal.x, y: this.goal.y, r: 110, c: '#ffcf7a' });""")

fails = 0
for i, (old, new) in enumerate(EDITS, 1):
    n = src.count(old)
    if n != 1:
        print(f"FAIL edit {i}: matched {n} times\n{old[:160]!r}")
        fails += 1
        continue
    src = src.replace(old, new)
if fails:
    sys.exit(f"{fails} edit(s) failed — file NOT written")

# ============================================================ 7. enemy renderers
lines = src.split('\n')
i0 = lines.index('  drawFish() {')
i1 = lines.index('  drawBulbs() {')
assert i0 < i1

ENEMY = r"""  drawUrchinBody(ctx, ph, scale) {
    // shared urchin shell: test tube feet, primary + secondary spines, apex organ
    const t = this.time;
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(255,105,132,0.95)'; ctx.lineWidth = 2.1; ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.sin(t * 0.9 + ph) * 0.22;
      const sway = Math.sin(t * 2.2 + i * 0.7 + ph) * 0.1;
      const r0 = 4.5, r1 = 13.5 + (i % 3) * 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.quadraticCurveTo(Math.cos(a + sway) * (r0 + r1) * 0.55, Math.sin(a + sway) * (r0 + r1) * 0.55,
                           Math.cos(a + sway * 2) * r1, Math.sin(a + sway * 2) * r1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,190,205,0.95)';
      ctx.beginPath(); ctx.arc(Math.cos(a + sway * 2) * r1, Math.sin(a + sway * 2) * r1, 0.95, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,80,110,0.55)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * Math.PI * 2 + Math.sin(t * 0.9 + ph) * 0.22;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); ctx.stroke();
    }
    const g = ctx.createRadialGradient(-1.5, -1.5, 0, 0, 0, 11);
    g.addColorStop(0, '#6d1322'); g.addColorStop(0.7, '#3a0710'); g.addColorStop(1, '#22030a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, 7); ctx.fill();
    // tube feet
    ctx.strokeStyle = 'rgba(255,170,190,0.8)'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.4;
      const w = 1 + Math.sin(t * 4 + i) * 0.5;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
      ctx.lineTo(Math.cos(a) * (5 + w), Math.sin(a) * (5 + w)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,150,170,0.95)'; ctx.beginPath(); ctx.arc(0, 0, 2.1, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,240,0.9)'; ctx.beginPath(); ctx.arc(-0.7, -0.7, 0.8, 0, 7); ctx.fill();
  }

  drawUrchins() {
    const ctx = this.ctx;
    for (const u of this.urchins) {
      const pu = 1 + 0.07 * Math.sin(this.time * 3 + u.ph);
      ctx.save(); ctx.translate(u.x, u.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ug = ctx.createRadialGradient(0, 0, 0, 0, 0, 24);
      ug.addColorStop(0, 'rgba(255,95,125,0.38)');
      ug.addColorStop(1, 'rgba(255,60,100,0)');
      ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.scale(pu, pu);
      this.drawUrchinBody(ctx, u.ph, 1);
      ctx.restore();
      ctx.restore();
    }
  }

  // ------------------------------------------------- STINGER (T)
  drawStingers() {
    const ctx = this.ctx;
    for (const s of this.stingers) {
      const ext = s.reach / 40;
      const hot = ext > 0.3;
      const base = hot ? '#ff7ba8' : '#5d7f96';
      ctx.save(); ctx.translate(s.x, s.y);
      // bulb base anchored to the ceiling
      const bg = ctx.createRadialGradient(0, -3, 0, 0, 0, 13);
      bg.addColorStop(0, hot ? '#7a1c3a' : '#1d2f3a');
      bg.addColorStop(1, hot ? '#2e0817' : '#0c161c');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, -4, 11, 8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = hot ? 'rgba(255,140,180,0.9)' : 'rgba(130,170,190,0.6)';
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, -4, 11, 8, 0, 0, 7); ctx.stroke();
      // warts
      ctx.fillStyle = hot ? 'rgba(255,180,205,0.8)' : 'rgba(150,190,210,0.5)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.time * 0.3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 6, -4 + Math.sin(a) * 4, 1.1, 0, 7); ctx.fill();
      }
      // tentacle column
      ctx.lineCap = 'round';
      const n = 9;
      for (let i = 0; i < n; i++) {
        const ox = -10 + i * (20 / (n - 1));
        const len = 6 + ext * (30 + (i % 3) * 7);
        const sw = Math.sin(this.time * 2.4 + i * 0.9 + s.ph) * (2 + ext * 6);
        ctx.strokeStyle = hot ? `rgba(255,120,168,${0.35 + ext * 0.5})` : 'rgba(120,160,180,0.4)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(ox, 2);
        ctx.bezierCurveTo(ox + sw * 0.3, 2 + len * 0.4, ox + sw, 2 + len * 0.7, ox + sw * 0.7, 2 + len);
        ctx.stroke();
        // cnidocyte knobs at the tip
        ctx.fillStyle = hot ? 'rgba(255,200,222,0.95)' : 'rgba(150,190,210,0.5)';
        for (let k = 1; k <= 3; k++) {
          const t = k / 3.4;
          ctx.beginPath(); ctx.arc(ox + sw * t * 0.8, 2 + len * t, 0.95, 0, 7); ctx.fill();
        }
      }
      // warning ring as it arms
      if (ext > 0.02 && ext < 0.34) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,150,190,${0.5 - ext * 1.2})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 6, 20 + ext * 40, 0, 7); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------- LANTERNFISH (L)
  drawLanterns() {
    const ctx = this.ctx;
    for (const l of this.lanterns) {
      const stunned = l.stun > 0;
      const pu = l.pulse || 0.7;
      const bob = Math.sin(this.time * 1.8 + l.ph) * 3;
      ctx.save(); ctx.translate(l.x, l.y + bob);
      ctx.rotate(Math.sin(this.time * 1.1 + l.ph) * 0.12 + (stunned ? this.time * 3 : 0));
      ctx.scale(l.dir, 1);
      // body: elongated, dark, with a ventral lantern row
      ctx.fillStyle = '#1b1608';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,130,0.7)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.stroke();
      // tail
      ctx.fillStyle = 'rgba(255,200,110,0.3)';
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-19, -5.5); ctx.lineTo(-16, 0); ctx.lineTo(-19, 5.5);
      ctx.closePath(); ctx.fill();
      // dorsal fin
      ctx.beginPath(); ctx.moveTo(-4, -6); ctx.quadraticCurveTo(1, -12, 6, -6);
      ctx.closePath(); ctx.fill();
      // photophore ladder along the belly
      for (let i = 0; i < 7; i++) {
        const x = -9 + i * 3;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 3 + i * 0.8 + l.ph));
        ctx.fillStyle = `rgba(255,226,150,${a * (stunned ? 0.3 : 1)})`;
        ctx.beginPath(); ctx.arc(x, 5.2, 1.35, 0, 7); ctx.fill();
      }
      // the big sub-ocular lantern it hunts with
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(8, 3.5, 0, 8, 3.5, 20 * pu);
      lg.addColorStop(0, `rgba(255,240,190,${0.85 * (stunned ? 0.25 : 1)})`);
      lg.addColorStop(0.3, `rgba(255,205,110,${0.3 * (stunned ? 0.25 : 1)})`);
      lg.addColorStop(1, 'rgba(255,190,80,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(8, 3.5, 20 * pu, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff3d2'; ctx.beginPath(); ctx.arc(8, 3.5, 2.3, 0, 7); ctx.fill();
      // eye + snout teeth
      ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(8, -2.6, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#171002'; ctx.beginPath(); ctx.arc(8.8, -2.6, 1.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff6e2';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(11 + i * 1.7, -1); ctx.lineTo(11.6 + i * 1.7, 1.4); ctx.lineTo(12.5 + i * 1.7, -1);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const a = this.time * 5 + i * 1.6;
          ctx.fillStyle = 'rgba(255,225,160,0.75)';
          ctx.beginPath(); ctx.arc(l.x + Math.cos(a) * 17, l.y - 18 + Math.sin(a) * 5, 2, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------- DRAGONFISH (F)
  drawFish() {
    const ctx = this.ctx;
    for (const f of this.fish) {
      const stunned = f.stun > 0;
      const bob = Math.sin(this.time * 3 + f.ph) * 2;
      const wag = Math.sin(this.time * 9 + f.ph) * 3;
      ctx.save(); ctx.translate(f.x, f.y + bob); ctx.scale(f.dir, 1);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 28);
      fg.addColorStop(0, stunned ? 'rgba(140,200,255,0.28)' : 'rgba(255,110,130,0.24)');
      fg.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, 28, 0, 7); ctx.fill();
      ctx.restore();
      // caudal fin with rays
      ctx.save(); ctx.rotate(wag * 0.05);
      ctx.fillStyle = stunned ? 'rgba(150,200,240,0.35)' : 'rgba(255,120,140,0.35)';
      ctx.beginPath(); ctx.moveTo(-16, 0);
      ctx.lineTo(-26, -7 + wag); ctx.lineTo(-22, wag * 0.4); ctx.lineTo(-26, 7 + wag);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = stunned ? 'rgba(180,220,250,0.5)' : 'rgba(255,170,185,0.5)'; ctx.lineWidth = 0.8;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-25, i * 4.5 + wag); ctx.stroke();
      }
      ctx.restore();
      // dorsal + anal fins
      const fc = stunned ? 'rgba(150,200,240,0.3)' : 'rgba(255,120,140,0.3)';
      ctx.fillStyle = fc;
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.quadraticCurveTo(-2, -13, 5, -6.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9, 6); ctx.quadraticCurveTo(-3, 12, 3, 6.5); ctx.closePath(); ctx.fill();
      // body
      const body = stunned ? 'rgba(140,185,225,0.9)' : 'rgba(120,26,44,0.95)';
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.quadraticCurveTo(4, -8.5, -8, -5.5);
      ctx.quadraticCurveTo(-14, -3.2, -18, 0);
      ctx.quadraticCurveTo(-14, 3.2, -8, 5.5);
      ctx.quadraticCurveTo(4, 8.5, 15, 0);
      ctx.fill();
      ctx.strokeStyle = stunned ? 'rgba(180,225,255,0.7)' : 'rgba(255,120,140,0.8)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.quadraticCurveTo(4, -8.5, -8, -5.5);
      ctx.quadraticCurveTo(-14, -3.2, -18, 0);
      ctx.quadraticCurveTo(-14, 3.2, -8, 5.5);
      ctx.quadraticCurveTo(4, 8.5, 15, 0);
      ctx.stroke();
      // lateral line + myomere chevrons
      ctx.strokeStyle = stunned ? 'rgba(210,240,255,0.4)' : 'rgba(255,150,170,0.4)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -1.5, 14, 0); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const x = -9 + i * 5;
        ctx.beginPath(); ctx.moveTo(x + 2, -4.5); ctx.lineTo(x - 2, 0); ctx.lineTo(x + 2, 4.5); ctx.stroke();
      }
      // photophore row
      ctx.fillStyle = stunned ? 'rgba(200,235,255,0.6)' : 'rgba(255,200,150,0.85)';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-11 + i * 4.6, 4.6, 1, 0, 7); ctx.fill(); }
      // gape with fangs
      ctx.fillStyle = '#1a0308';
      ctx.beginPath(); ctx.moveTo(6, -4.5); ctx.quadraticCurveTo(17, -3, 15, 1.5); ctx.quadraticCurveTo(11, 6, 5.5, 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff2f4';
      ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(9.2, 0.6); ctx.lineTo(10.6, -3.8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(12, -3); ctx.lineTo(13, 0.2); ctx.lineTo(14.2, -2.8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8.5, 5); ctx.lineTo(9.6, 1.6); ctx.lineTo(10.8, 4.8); ctx.closePath(); ctx.fill();
      // eye
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8.5, -3.4, 2.4, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(9.2, -3.4, 1.15, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(7.7, -4.2, 0.6, 0, 7); ctx.fill();
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const a = this.time * 4 + i * 2.1;
          ctx.fillStyle = 'rgba(150,220,255,0.7)';
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 16, f.y - 16 + Math.sin(a) * 5, 2, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------- VIPERFISH (V)
  drawVipers() {
    const ctx = this.ctx;
    for (const v of this.vipers) {
      const stunned = v.stun > 0;
      const lunging = v.charge > 0;
      const glow = v.glow || 0.6;
      ctx.save(); ctx.translate(v.x, v.y);
      ctx.rotate(Math.atan2(v.vy, v.vx) * (Math.abs(v.vx) + Math.abs(v.vy) > 6 ? 0.9 : 0.15));
      ctx.scale(v.dir, 1);
      if (lunging) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
        hg.addColorStop(0, 'rgba(150,130,255,0.4)'); hg.addColorStop(1, 'rgba(120,100,255,0)');
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
        ctx.restore();
      }
      // spine-backed dorsal fin
      ctx.strokeStyle = `rgba(160,140,255,${0.5 * glow + 0.2})`; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -12 + i * 3.6;
        ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x - 1.4, -11 - (i % 2) * 2); ctx.stroke();
      }
      // tail
      const wag = Math.sin(this.time * 11 + v.ph) * (lunging ? 4.5 : 2.5);
      ctx.fillStyle = `rgba(150,130,255,${0.3 + glow * 0.2})`;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-27, -8 + wag); ctx.lineTo(-22, wag * 0.4); ctx.lineTo(-27, 8 + wag);
      ctx.closePath(); ctx.fill();
      // long slim body
      ctx.fillStyle = stunned ? '#2a2540' : '#160f2e';
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.quadraticCurveTo(6, -6.5, -8, -4.6);
      ctx.quadraticCurveTo(-14, -2.6, -18, 0);
      ctx.quadraticCurveTo(-14, 2.6, -8, 4.6);
      ctx.quadraticCurveTo(6, 6.5, 18, 0);
      ctx.fill();
      ctx.strokeStyle = `rgba(160,140,255,${0.55 + glow * 0.4})`; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.quadraticCurveTo(6, -6.5, -8, -4.6);
      ctx.quadraticCurveTo(-14, -2.6, -18, 0);
      ctx.quadraticCurveTo(-14, 2.6, -8, 4.6);
      ctx.quadraticCurveTo(6, 6.5, 18, 0);
      ctx.stroke();
      // photophore ladder
      ctx.fillStyle = `rgba(190,175,255,${0.5 + glow * 0.5})`;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-13 + i * 4.4, 3.9, 1.05, 0, 7); ctx.fill(); }
      // the huge eye that gave it away
      ctx.fillStyle = stunned ? '#8f9bc0' : '#e8e2ff'; ctx.beginPath(); ctx.arc(11, -2.2, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0618'; ctx.beginPath(); ctx.arc(12, -2.2, 1.9, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(9.8, -3.3, 0.95, 0, 7); ctx.fill();
      // needle jaw — the whole reason to keep your distance
      ctx.fillStyle = '#f2eeff';
      const fangs = [[8, -2.6, 5.5], [11, -1.8, 6.5], [14, -0.8, 5], [9, 3.6, -5], [12.5, 2.8, -6]];
      for (const [fx, fy, fl] of fangs) {
        ctx.beginPath(); ctx.moveTo(fx - 1.1, fy); ctx.lineTo(fx, fy + fl); ctx.lineTo(fx + 1.1, fy);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const a = this.time * 5 + i * 1.6;
          ctx.fillStyle = 'rgba(180,165,255,0.8)';
          ctx.beginPath(); ctx.arc(v.x + Math.cos(a) * 18, v.y - 19 + Math.sin(a) * 5, 2.1, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

""".split('\n')

lines = lines[:i0] + ENEMY + lines[i1:]
src = '\n'.join(lines)

open(P, 'w').write(src)
print(f'enemy pass applied: {len(EDITS)} edits + enemy renderers ({len(ENEMY)} lines)')
