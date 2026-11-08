#!/usr/bin/env python3
"""Visual polish pass for Fish N Chips: bloom, god rays, baked rock, light tint,
expanding rings, richer water surface, glow particles, vignette.
Every replacement is asserted to match exactly once — the pass fails loudly."""
import sys

P = '/a0/usr/workdir/nightshift/js/main.js'
src = open(P).read()

EDITS = []


def rep(old, new):
    EDITS.append((old, new))


# 1) offscreen buffers + bloom toggle -------------------------------------------------
rep("""    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.au = new Audio();
""", """    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    // bloom buffer: quarter-res copy of the frame, blurred and added back
    this.bloom = document.createElement('canvas');
    this.blctx = this.bloom.getContext('2d');
    this.bloomOn = true;
    // baked static rock layer, rebuilt per level (frees frame budget for the glow)
    this.rock = document.createElement('canvas');
    this.rctx = this.rock.getContext('2d');
    this.rings = [];
    this.canBlur = (() => {
      try {
        const t = document.createElement('canvas').getContext('2d');
        t.filter = 'blur(3px)';
        return /blur/.test(t.filter || '');
      } catch (e) { return false; }
    })();
    this.au = new Audio();
""")

# 2) bloom buffer sizing -------------------------------------------------------------
rep("""    this.light.width = this.cv.width; this.light.height = this.cv.height;
    this.dpr = dpr;
""", """    this.light.width = this.cv.width; this.light.height = this.cv.height;
    this.bloom.width = Math.max(1, Math.floor(this.cv.width / 3));
    this.bloom.height = Math.max(1, Math.floor(this.cv.height / 3));
    this.dpr = dpr;
""")

# 3) bake rock when a level loads ----------------------------------------------------
rep("""    this.actName = L.name;
    this.hint = L.hint;
    this.initMotes();
  }
""", """    this.actName = L.name;
    this.hint = L.hint;
    this.rings = [];
    this.flare = null;
    this.initMotes();
    this.bakeRock();
  }
""")

# 4) new draw order ------------------------------------------------------------------
rep("""    this.drawWater();
    this.drawCurrents();
    this.drawTerrain();
    this.drawAnemones();
""", """    this.drawWater();
    this.drawGodRays();
    this.drawCurrents();
    this.drawRock();
    this.drawHidden();
    this.drawAnemones();
""")

rep("""    this.drawParticles();
    this.drawPlayer();

    ctx.restore();

    this.drawLighting(s, ox, oy);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHUD(s);
""", """    this.drawParticles();
    this.drawRings();
    this.drawPlayer();

    ctx.restore();

    this.drawLighting(s, ox, oy);
    this.drawLightTint(s, ox, oy);
    this.drawBloom();
    this.drawVignette();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHUD(s);
""")

# 5) richer water: surface crest + drifting caustic ribbons ---------------------------
rep("""    const g = ctx.createLinearGradient(0, 0, 0, this.wh);
    g.addColorStop(0, '#07203f'); g.addColorStop(0.45, '#04162c'); g.addColorStop(1, '#01060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.ww, this.wh);
    // caustic bands near the surface
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const y = 10 + i * 12 + Math.sin(this.time * 0.7 + i) * 6;
      ctx.fillStyle = `rgba(90,170,220,${0.05 - i * 0.006})`;
      ctx.fillRect(0, y, this.ww, 10);
    }
    ctx.restore();
""", """    const g = ctx.createLinearGradient(0, 0, 0, this.wh);
    g.addColorStop(0, '#0a2b4d'); g.addColorStop(0.28, '#06203a');
    g.addColorStop(0.65, '#031425'); g.addColorStop(1, '#01060e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.ww, this.wh);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // the surface itself: a rippling crest of light where the world ends
    const surf = TILE * 0.5;
    ctx.strokeStyle = 'rgba(175,238,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= this.ww; x += 8) {
      const y = surf + Math.sin(x * 0.03 + this.time * 1.3) * 3 + Math.sin(x * 0.011 - this.time * 0.8) * 4;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    const sg = ctx.createLinearGradient(0, 0, 0, TILE * 2.4);
    sg.addColorStop(0, 'rgba(155,228,255,0.24)');
    sg.addColorStop(1, 'rgba(120,200,245,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, this.ww, TILE * 2.4);
    // caustic ribbons drifting just beneath it
    for (let i = 0; i < 9; i++) {
      const y = TILE * 1.1 + i * 13 + Math.sin(this.time * 0.7 + i) * 5;
      const a = 0.06 - i * 0.0055;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(125,205,245,${a})`;
      ctx.beginPath();
      for (let x = 0; x <= this.ww; x += 24) {
        const yy = y + Math.sin(x * 0.02 + this.time * 1.1 + i * 0.6) * 4;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.lineTo(this.ww, y + 7); ctx.lineTo(0, y + 7);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
""")

# 6) replace drawTerrain with baked rock + live hidden blocks + new FX ---------------
TERRAIN_OLD = """  drawTerrain() {
    const ctx = this.ctx;
    const lit = (x, y) => {
      for (const l of this.litSources) {
        if (Math.hypot(x - l.x, y - l.y) < l.r) return clamp(1 - Math.hypot(x - l.x, y - l.y) / l.r, 0, 1);
      }
      return 0;
    };
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.map[y][x];
      if (c !== '#' && c !== 'h') continue;
      const bx = x * TILE, by = y * TILE;
      const cx = bx + TILE / 2, cy = by + TILE / 2;
      if (c === 'h') {
        const l = lit(cx, cy);
        if (l <= 0.02) {
          // faint shimmer so the player knows something is there
          const tw = 0.05 + 0.05 * Math.sin(this.time * 2 + x * 0.7 + y);
          ctx.fillStyle = `rgba(140,190,255,${tw})`;
          ctx.fillRect(bx + 6, by + 6, TILE - 12, TILE - 12);
          continue;
        }
        ctx.fillStyle = `rgba(58,44,26,${0.5 + l * 0.5})`;
        ctx.fillRect(bx, by, TILE, TILE);
        ctx.fillStyle = `rgba(255,200,110,${0.10 + l * 0.22})`;
        ctx.fillRect(bx, by, TILE, 3);
        continue;
      }
      // rock silhouette: a solid mass that reads against the water column
      ctx.fillStyle = '#05121f';
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.fillStyle = 'rgba(12,28,46,0.95)';
      ctx.fillRect(bx, by + 5, TILE, TILE - 5);
      // rim light on every face that touches water
      const wUp = y > 0 && this.map[y - 1][x] !== '#';
      const wL = x > 0 && this.map[y][x - 1] !== '#';
      const wR = x < this.w - 1 && this.map[y][x + 1] !== '#';
      if (wUp) {
        const rg = ctx.createLinearGradient(0, by, 0, by + 10);
        rg.addColorStop(0, 'rgba(125,205,255,0.5)');
        rg.addColorStop(1, 'rgba(125,205,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(bx, by, TILE, 10);
        ctx.fillStyle = 'rgba(195,240,255,0.55)'; ctx.fillRect(bx, by, TILE, 1.5);
      }
      if (wL) { ctx.fillStyle = 'rgba(95,180,230,0.3)'; ctx.fillRect(bx, by, 1.5, TILE); }
      if (wR) { ctx.fillStyle = 'rgba(70,150,205,0.2)'; ctx.fillRect(bx + TILE - 1.5, by, 1.5, TILE); }
      // speckle
      const h = ((x * 73 + y * 151) % 7);
      if (h < 2) { ctx.fillStyle = 'rgba(120,180,220,0.05)'; ctx.fillRect(bx + 8, by + 10, 3, 3); }
    }
  }
"""

TERRAIN_NEW = """  // ---- rock is static: bake it once per level, blit it every frame ----
  bakeRock() {
    const RS = 2;
    this.rock.width = this.ww * RS;
    this.rock.height = this.wh * RS;
    const ctx = this.rctx;
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.clearRect(0, 0, this.ww, this.wh);
    const rockAt = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.map[y][x] === '#';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!rockAt(x, y)) continue;
      const bx = x * TILE, by = y * TILE;
      const d = clamp(by / this.wh, 0, 1);
      ctx.fillStyle = `rgb(${Math.round(9 - d * 6)},${Math.round(24 - d * 14)},${Math.round(41 - d * 24)})`;
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.fillStyle = 'rgba(2,8,16,0.5)';
      ctx.fillRect(bx, by + 6, TILE, TILE - 6);
      // rim light on every face that touches water
      const wUp = !rockAt(x, y - 1), wL = !rockAt(x - 1, y);
      const wR = !rockAt(x + 1, y), wD = !rockAt(x, y + 1);
      if (wUp) {
        const rg = ctx.createLinearGradient(0, by, 0, by + 12);
        rg.addColorStop(0, 'rgba(140,215,255,0.55)');
        rg.addColorStop(1, 'rgba(140,215,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(bx, by, TILE, 12);
        ctx.fillStyle = 'rgba(212,246,255,0.6)'; ctx.fillRect(bx, by, TILE, 1.5);
      }
      if (wL) { ctx.fillStyle = 'rgba(105,190,240,0.32)'; ctx.fillRect(bx, by, 1.5, TILE); }
      if (wR) { ctx.fillStyle = 'rgba(80,160,215,0.22)'; ctx.fillRect(bx + TILE - 1.5, by, 1.5, TILE); }
      if (wD) { ctx.fillStyle = 'rgba(3,10,20,0.85)'; ctx.fillRect(bx, by + TILE - 2, TILE, 2); }
      // mineral flecks that catch the light
      const hsh = (x * 73 + y * 151) % 11;
      if (hsh < 3) {
        ctx.fillStyle = hsh === 0 ? 'rgba(150,232,255,0.11)' : 'rgba(120,200,235,0.06)';
        ctx.fillRect(bx + 5 + hsh * 5, by + 8 + hsh * 3, 2.5, 2.5);
      }
      if (hsh === 7) {
        ctx.fillStyle = 'rgba(120,255,220,0.12)';
        ctx.beginPath(); ctx.arc(bx + 15, by + 17, 1.6, 0, 7); ctx.fill();
      }
    }
    // the water just above every rock face picks up a faint bounce light
    ctx.globalCompositeOperation = 'lighter';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!rockAt(x, y) || rockAt(x, y - 1)) continue;
      const g = ctx.createLinearGradient(0, y * TILE - 18, 0, y * TILE);
      g.addColorStop(0, 'rgba(70,150,200,0)');
      g.addColorStop(1, 'rgba(95,185,235,0.11)');
      ctx.fillStyle = g; ctx.fillRect(x * TILE, y * TILE - 18, TILE, 18);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRock() {
    this.ctx.drawImage(this.rock, 0, 0, this.ww, this.wh);
  }

  // hidden blocks live or fade with the light you carry, so they stay dynamic
  frameLights() {
    const f = this.form;
    const out = [];
    if (f) out.push({ x: this.px, y: this.py, r: f.key === 'angler' ? 178 : f.key === 'jelly' ? 120 : 134 });
    if (this.flare) out.push({ x: this.flare.x, y: this.flare.y, r: this.flare.r * 1.6 });
    for (const b of this.bulbs) out.push({ x: b.x, y: b.y, r: 55 });
    return out;
  }

  drawHidden() {
    const ctx = this.ctx;
    const lights = this.frameLights();
    const lit = (x, y) => {
      for (const l of lights) {
        const d = Math.hypot(x - l.x, y - l.y);
        if (d < l.r) return clamp(1 - d / l.r, 0, 1);
      }
      return 0;
    };
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.map[y][x] !== 'h') continue;
      const bx = x * TILE, by = y * TILE;
      const l = lit(bx + TILE / 2, by + TILE / 2);
      if (l <= 0.02) {
        // a barely-there shimmer: something is in the dark, shape unknown
        const tw = 0.05 + 0.05 * Math.sin(this.time * 2 + x * 0.7 + y);
        ctx.fillStyle = `rgba(140,190,255,${tw})`;
        ctx.fillRect(bx + 6, by + 6, TILE - 12, TILE - 12);
        continue;
      }
      ctx.fillStyle = `rgba(66,49,26,${0.55 + l * 0.45})`;
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.fillStyle = 'rgba(22,15,7,0.6)';
      ctx.fillRect(bx, by + 6, TILE, TILE - 6);
      ctx.fillStyle = `rgba(255,206,120,${0.14 + l * 0.3})`;
      ctx.fillRect(bx, by, TILE, 2.5);
      ctx.strokeStyle = `rgba(255,228,172,${l * 0.35})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, TILE - 1, TILE - 1);
    }
  }

  // ---- volumetric shafts falling from the surface ----
  drawGodRays() {
    const ctx = this.ctx;
    const reach = this.wh * 0.8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const base = (i / 7) * this.ww + TILE * 2;
      const sway = Math.sin(this.time * 0.22 + i * 1.7) * 42;
      const wTop = 26 + (i % 3) * 15;
      const wBot = wTop * 3.4;
      const a = 0.05 + 0.018 * Math.sin(this.time * 0.5 + i);
      const g = ctx.createLinearGradient(0, 0, 0, reach);
      g.addColorStop(0, `rgba(150,222,255,${a * 1.7})`);
      g.addColorStop(0.5, `rgba(110,190,240,${a * 0.5})`);
      g.addColorStop(1, 'rgba(90,170,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base - wTop / 2, 0);
      ctx.lineTo(base + wTop / 2, 0);
      ctx.lineTo(base + sway + wBot / 2, reach);
      ctx.lineTo(base + sway - wBot / 2, reach);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---- expanding shock rings: shift, dash, flare, checkpoint, death ----
  ring(x, y, c, r0, r1, life) { this.rings.push({ x, y, c, r0, r1, t: 0, life }); }

  drawRings() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const t = clamp(r.t / r.life, 0, 1);
      const rad = lerp(r.r0, r.r1, t * (2 - t));
      ctx.strokeStyle = rgba(r.c, (1 - t) * 0.55);
      ctx.lineWidth = 2.4 * (1 - t) + 0.4;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 7); ctx.stroke();
      ctx.strokeStyle = rgba(r.c, (1 - t) * 0.16);
      ctx.lineWidth = 8 * (1 - t);
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- two-tier bloom: downscale the frame, blur it, add it back ----
  drawBloom() {
    if (!this.canBlur || !this.bloomOn) return;
    if (this.cv.width > 3000) return; // keep low-end devices smooth
    const bc = this.blctx;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    bc.globalAlpha = 1;
    bc.clearRect(0, 0, this.bloom.width, this.bloom.height);
    bc.drawImage(this.cv, 0, 0, this.bloom.width, this.bloom.height);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.filter = 'blur(9px)';
    ctx.drawImage(this.bloom, 0, 0, this.cv.width, this.cv.height);
    ctx.globalAlpha = 0.26;
    ctx.filter = 'blur(24px)';
    ctx.drawImage(this.bloom, 0, 0, this.cv.width, this.cv.height);
    ctx.filter = 'none';
    ctx.restore();
  }

  // ---- colored light bleeding into the water (not just a punched hole) ----
  drawLightTint(s, ox, oy) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.litSources) {
      if (!l.c) continue;
      const x = ox + l.x * s, y = oy + l.y * s, r = l.r * s * 1.15;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(l.c, 0.15));
      g.addColorStop(0.45, rgba(l.c, 0.045));
      g.addColorStop(1, rgba(l.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ---- lens vignette ----
  drawVignette() {
    const ctx = this.ctx;
    const W = this.cv.width, H = this.cv.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.33, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,2,10,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
"""
rep(TERRAIN_OLD, TERRAIN_NEW)

# 7) rings tick down -----------------------------------------------------------------
rep("""    this.particles = this.particles.filter((p) => p.life > 0);
""", """    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
""")

# 8) tinted light sources ------------------------------------------------------------
rep("""    this.litSources.push({ x: this.px, y: this.py, r: lr });
    if (this.flare) this.litSources.push({ x: this.flare.x, y: this.flare.y, r: this.flare.r * 1.6 });
    for (const b of this.bulbs) this.litSources.push({ x: b.x, y: b.y, r: 55 });
""", """    this.litSources.push({ x: this.px, y: this.py, r: lr, c: f.glow });
    if (this.flare) this.litSources.push({ x: this.flare.x, y: this.flare.y, r: this.flare.r * 1.6, c: '#ffd88a' });
    for (const b of this.bulbs) this.litSources.push({ x: b.x, y: b.y, r: 55, c: '#6fd0ff' });
    if (this.goal) this.litSources.push({ x: this.goal.x, y: this.goal.y, r: 110, c: '#ffcf7a' });
    for (const c of this.checkpoints) if (c.on) this.litSources.push({ x: c.x, y: c.y, r: 60, c: '#78ffdc' });
""")

# 9) particles get a soft halo -------------------------------------------------------
rep("""      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = rgba(p.c, a * 0.85);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.5 + a * 0.7), 0, 7); ctx.fill();
""", """      const a = clamp(p.life / p.max, 0, 1);
      const rad = p.s * (0.5 + a * 0.7);
      ctx.fillStyle = rgba(p.c, a * 0.16);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad * 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(p.c, a * 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 7); ctx.fill();
""")

# 10) urchin halo --------------------------------------------------------------------
rep("""      ctx.strokeStyle = 'rgba(255,90,120,0.85)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
""", """      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ug = ctx.createRadialGradient(0, 0, 0, 0, 0, 21);
      ug.addColorStop(0, 'rgba(255,95,125,0.4)');
      ug.addColorStop(1, 'rgba(255,60,100,0)');
      ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(0, 0, 21, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,105,132,0.95)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
""")

# 11) fish rim glow ------------------------------------------------------------------
rep("""      const body = stunned ? 'rgba(120,160,200,0.75)' : 'rgba(255,110,130,0.92)';
""", """      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      fg.addColorStop(0, stunned ? 'rgba(140,200,255,0.30)' : 'rgba(255,110,130,0.26)');
      fg.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.restore();
      const body = stunned ? 'rgba(140,185,225,0.85)' : 'rgba(255,120,140,0.95)';
""")

# 12) rings on the big beats ---------------------------------------------------------
rep("""    this.au.shift();
    this.shake = Math.max(this.shake, 6);
    this.flash = Math.max(this.flash, 0.35);
""", """    this.au.shift();
    this.shake = Math.max(this.shake, 6);
    this.flash = Math.max(this.flash, 0.35);
    this.ring(this.px, this.py, f.glow, 6, 78, 0.55);
""")

rep("""      this.dashT = 0.22; this.cooldown = 0.55;
      this.au.blip(320, 0.14, 'triangle', 0.22);
      this.burst(this.px, this.py, 10, this.form.glow, 120);
""", """      this.dashT = 0.22; this.cooldown = 0.55;
      this.au.blip(320, 0.14, 'triangle', 0.22);
      this.burst(this.px, this.py, 10, this.form.glow, 120);
      this.ring(this.px, this.py, this.form.glow, 5, 52, 0.35);
""")

rep("""      this.vy = -230; this.pulse = 0.5; this.cooldown = 0.45;
      this.au.blip(520, 0.2, 'sine', 0.2);
""", """      this.vy = -230; this.pulse = 0.5; this.cooldown = 0.45;
      this.au.blip(520, 0.2, 'sine', 0.2);
      this.ring(this.px, this.py + 6, '#e0aaff', 6, 46, 0.4);
""")

rep("""      this.cooldown = 1.0; this.flash = 0.5; this.shake = 8;
      this.au.flare();
""", """      this.cooldown = 1.0; this.flash = 0.5; this.shake = 8;
      this.au.flare();
      this.ring(this.px, this.py, '#ffe8a3', 10, 250, 0.7);
""")

rep("""        c.on = true; this.respawn = { x: c.x, y: c.y };
        this.au.ping(); this.burst(c.x, c.y, 20, '#7ae7ff', 120);
""", """        c.on = true; this.respawn = { x: c.x, y: c.y };
        this.au.ping(); this.burst(c.x, c.y, 20, '#7ae7ff', 120);
        this.ring(c.x, c.y, '#7ae7ff', 8, 90, 0.7);
""")

rep("""    this.shake = 14; this.flash = 0.6;
    this.burst(this.px, this.py, 40, '#ff5d73', 220);
""", """    this.shake = 14; this.flash = 0.6;
    this.burst(this.px, this.py, 40, '#ff5d73', 220);
    this.ring(this.px, this.py, '#ff5d73', 8, 130, 0.6);
""")

rep("""      this.au.win(); this.state = 'win'; this.winT = 0;
      this.burst(this.goal.x, this.goal.y, 80, '#ffe08a', 240);
""", """      this.au.win(); this.state = 'win'; this.winT = 0;
      this.burst(this.goal.x, this.goal.y, 80, '#ffe08a', 240);
      this.ring(this.goal.x, this.goal.y, '#ffe08a', 10, 300, 1.2);
""")

# 13) bloom toggle + HUD scrim -------------------------------------------------------
rep("""    if (k === 'm') { this.muted = !this.muted; this.au.setMuted(this.muted); }
""", """    if (k === 'm') { this.muted = !this.muted; this.au.setMuted(this.muted); }
    if (k === 'b') { this.bloomOn = !this.bloomOn; }
""")

rep("""    // top bar
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
""", """    // scrim so the HUD still reads over the bloom
    const scrim = ctx.createLinearGradient(0, 0, 0, 74);
    scrim.addColorStop(0, 'rgba(0,6,16,0.6)');
    scrim.addColorStop(1, 'rgba(0,6,16,0)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, 74);

    // top bar
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
""")

# apply -----------------------------------------------------------------------------
fails = 0
for i, (old, new) in enumerate(EDITS, 1):
    n = src.count(old)
    if n != 1:
        print(f"FAIL edit {i}: anchor matched {n} times\n{old[:120]!r}")
        fails += 1
        continue
    src = src.replace(old, new)
if fails:
    sys.exit(f"{fails} edit(s) failed — file NOT written")

open(P, 'w').write(src)
print(f"applied {len(EDITS)} polish edits -> js/main.js")
