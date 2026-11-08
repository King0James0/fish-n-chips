#!/usr/bin/env python3
"""Combat pass: 360-degree aim + rotation, per-form shooting, enemy HP,
power-ups with a color change, a boss with homing orbs, and a shield.
Every edit asserts its anchor is present exactly once, then fails loudly."""
import re, sys

P = '/a0/usr/workdir/nightshift/js/main.js'
s = open(P).read()
orig = s

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"ANCHOR x{n} (want {count}):\n{old[:90]!r}"
    s = s.replace(old, new, count)

# 1) SHOTS + POWERUP config after FORM_ORDER
rep("const FORM_ORDER = ['eel', 'angler', 'jelly'];",
"""const FORM_ORDER = ['eel', 'angler', 'jelly'];

const POWERS = {
  overcharge: { color: '#ffd166', name: 'OVERCHARGE', dur: 16, blurb: 'shots x2 · pierce' },
  storm:      { color: '#c77dff', name: 'STORM',      dur: 16, blurb: 'fire rate x2.4' },
  aegis:      { color: '#7ae7ff', name: 'AEGIS',      dur: 22, blurb: 'one death forgiven' },
};""")

# 2) constructor state fields
rep("    this.canBlur = (() => {",
"""    // combat / aim state
    this.aim = 0;
    this.mouse = null;
    this.padAim = { x: 0, y: 0 };
    this.firing = false;
    this.shotCd = 0;
    this.shots = [];
    this.powerups = [];
    this.power = null;
    this.boss = null;
    this.bossOrbs = [];
    this._s = 0; this._ox = 0; this._oy = 0;

    this.canBlur = (() => {""")

# 3) pointer listeners for aim + fire
rep("    this.cv.addEventListener('pointerdown', () => this.tap());",
"""    this.cv.addEventListener('pointerdown', (e) => {
      this.tap();
      if (this.state === 'play') { this.setMouse(e); this.firing = true; }
    });
    window.addEventListener('pointermove', (e) => { if (this.state === 'play') this.setMouse(e); });
    window.addEventListener('pointerup', () => { this.firing = false; });""")

# 4) fire key
rep("    if (k === ' ' || k === 'Shift') this.ability();",
"""    if (k === ' ' || k === 'Shift') this.ability();
    if (k === 'f') this.firing = down;""")

# 5) gamepad aim + fire
rep("      if (hit(0)) this.ability();",
"""      this.padAim = { x: gp.axes[2] || 0, y: gp.axes[3] || 0 };
      const trig = (b[7] && b[7].value > 0.4) || (b[5] && b[5].pressed);
      this.firing = !!trig;
      if (hit(0)) this.ability();""")

# 6) loadLevel: init combat lists
rep("    this.stingers = [];\n    this.bulbs = [];",
"""    this.stingers = [];
    this.shots = [];
    this.powerups = [];
    this.bossOrbs = [];
    this.boss = null;
    this.bulbs = [];""")

# 7) loadLevel: enemy HP + stinger stun
rep("        else if (c === 'U') this.urchins.push({ x: cx, y: cy, ph: Math.random() * 6 });",
"        else if (c === 'U') this.urchins.push({ x: cx, y: cy, ph: Math.random() * 6, hp: 2, dead: false });")
rep("        else if (c === 'F') this.fish.push({ x: cx, y: cy, x0: cx, dir: 1, stun: 0, ph: Math.random() * 6 });",
"        else if (c === 'F') this.fish.push({ x: cx, y: cy, x0: cx, dir: 1, stun: 0, ph: Math.random() * 6, hp: 2, dead: false });")
rep("        else if (c === 'V') this.vipers.push({ x: cx, y: cy, x0: cx, y0: cy, dir: 1, stun: 0, charge: 0, rest: 0, vx: 0, vy: 0, ph: Math.random() * 6 });",
"        else if (c === 'V') this.vipers.push({ x: cx, y: cy, x0: cx, y0: cy, dir: 1, stun: 0, charge: 0, rest: 0, vx: 0, vy: 0, ph: Math.random() * 6, hp: 3, dead: false });")
rep("        else if (c === 'L') this.lanterns.push({ x: cx, y: cy, x0: cx, y0: cy, stun: 0, ph: Math.random() * 6 });",
"        else if (c === 'L') this.lanterns.push({ x: cx, y: cy, x0: cx, y0: cy, stun: 0, ph: Math.random() * 6, hp: 2, dead: false });")
rep("        else if (c === 'T') this.stingers.push({ x: cx, y: cy, ph: Math.random() * 6, reach: 0 });",
"        else if (c === 'T') this.stingers.push({ x: cx, y: cy, ph: Math.random() * 6, reach: 0, stun: 0 });")

# 8) loadLevel: parse powerups (P) + boss (B)
rep("        else if (c === 'G') this.goal = { x: cx, y: cy };",
"""        else if (c === 'G') this.goal = { x: cx, y: cy };
        else if (c === 'P') this.powerups.push({ x: cx, y: cy, type: ['overcharge', 'storm', 'aegis'][Math.floor(Math.random() * 3)], got: false, ph: Math.random() * 6 });
        else if (c === 'B') this.boss = { x: cx, y: cy, x0: cx, y0: cy, hp: 42, maxhp: 42, t: 0, fireT: 1.4, enraged: false, dead: false, dieT: 0, ph: 0 };""")

# 9) shield in die()
rep("  die(silentForm) {\n    this.deaths++;",
"""  die(silentForm) {
    if (this.power && this.power.type === 'aegis' && this.power.t > 0) {
      this.power = null; this.shake = 10; this.flash = 0.5; this.au.powerup();
      this.ring(this.px, this.py, '#7ae7ff', 8, 130, 0.6);
      this.burst(this.px, this.py, 34, '#7ae7ff', 170);
      this.vx = 0; this.vy = 0; this.pulse = 0.4; this.say('aegis absorbed the hit'); return;
    }
    this.deaths++;""")

# 10) stinger respects stun
rep("      const cyc = Math.sin(this.time * 1.15 + s.ph);\n      s.reach = cyc > 0 ? cyc * 40 : 0;",
"""      s.stun = Math.max(0, (s.stun || 0) - dt);
      const cyc = Math.sin(this.time * 1.15 + s.ph);
      s.reach = (cyc > 0 && s.stun <= 0) ? cyc * 40 : 0;""")

# 11) aim + fire + power decay (after input axis)
rep("    if (Math.abs(ix) + Math.abs(iy) > 0.05) { this.lastDirX = ix; this.lastDirY = iy; }",
"""    if (Math.abs(ix) + Math.abs(iy) > 0.05) { this.lastDirX = ix; this.lastDirY = iy; }

    // ---- aim: cursor / right-stick if active, else heading (360 degrees) ----
    if (this.padAim && (Math.abs(this.padAim.x) > 0.25 || Math.abs(this.padAim.y) > 0.25)) {
      this.aim = Math.atan2(this.padAim.y, this.padAim.x);
    } else if (this.mouse && this._s) {
      const wx = (this.mouse.x - this._ox) / this._s, wy = (this.mouse.y - this._oy) / this._s;
      if (Math.hypot(wx - this.px, wy - this.py) > 8) this.aim = Math.atan2(wy - this.py, wx - this.px);
    } else if (Math.hypot(this.vx, this.vy) > 22) {
      this.aim = Math.atan2(this.vy, this.vx);
    }
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.power) { this.power.t -= dt; if (this.power.t <= 0 && this.power.type !== 'aegis') this.power = null; }
    if (this.firing) this.fire();""")

# 12) combat block (shots, boss, orbs, powerup pickups) before pickups
rep("    // pickups\n    for (const p of this.plankton) {",
"""    // ---- COMBAT: projectiles, boss, boss orbs, power-ups -------------------
    this.updateCombat(dt, r);

    // pickups
    for (const p of this.plankton) {""")

# 13) store fit for aim math
rep("    const { s, ox, oy } = this.fit();",
"    const { s, ox, oy } = this.fit();\n    this._s = s; this._ox = ox; this._oy = oy;")

# 14) draw dispatch: powerups + boss + shots
rep("    this.drawPlankton();",
"    this.drawPlankton();\n    this.drawPowerups();")
rep("    this.drawPlayer();",
"    this.drawBoss();\n    this.drawShots();\n    this.drawPlayer();")

# 15) rotation: eel + angler point along aim
rep("      ctx.rotate(ang);\n      ctx.scale(VS, VS);",
"      ctx.rotate(this.aim);\n      ctx.scale(VS, VS);")
rep("      ctx.rotate(ang * 0.35);\n      ctx.scale(VS, VS);",
"      ctx.rotate(this.aim);\n      ctx.scale(VS, VS);")
rep("      ctx.scale(VS, VS);\n      // ---- JELLY: domed bell",
"      ctx.scale(VS, VS);\n      ctx.rotate(this.aim + Math.PI / 2);\n      // ---- JELLY: domed bell")

# 16) powered aura + lit color
rep("    ctx.translate(this.px, this.py);\n    const ang = Math.atan2(this.vy, this.vx);",
"""    ctx.translate(this.px, this.py);
    if (this.power) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const pc = this.power.color;
      const pr = f.r * (2.4 + 0.3 * Math.sin(this.time * 6));
      const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      pg.addColorStop(0, rgba(pc, 0.32)); pg.addColorStop(1, rgba(pc, 0));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(pc, 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, f.r * 1.7, 0, 7); ctx.stroke();
      ctx.restore();
    }
    const ang = Math.atan2(this.vy, this.vx);""")
rep("    this.litSources.push({ x: this.px, y: this.py, r: lr, c: f.glow });",
"    this.litSources.push({ x: this.px, y: this.py, r: this.power ? lr * 1.25 : lr, c: this.power ? this.power.color : f.glow });")

# 17) HUD: boss bar + active power chip
rep("    // hint line",
"""    // boss health bar
    if (this.boss && !this.boss.dead) {
      const bw = Math.min(420, w * 0.6), bx = (w - bw) / 2, by = 54;
      ctx.textAlign = 'center';
      ctx.font = '700 11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,150,170,0.9)';
      ctx.fillText('THE MATRIARCH', w / 2, by - 8);
      ctx.fillStyle = 'rgba(0,10,24,0.7)'; ctx.fillRect(bx, by, bw, 8);
      const frac = clamp(this.boss.hp / this.boss.maxhp, 0, 1);
      ctx.fillStyle = this.boss.enraged ? '#ff5d73' : '#ff8fa3';
      ctx.fillRect(bx, by, bw * frac, 8);
      ctx.strokeStyle = 'rgba(255,150,170,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 8);
    }
    // active power chip
    if (this.power) {
      const pc = this.power.color;
      ctx.textAlign = 'left';
      ctx.font = '700 12px ui-monospace, Menlo, monospace';
      const label = POWERS[this.power.type].name + '  ' + Math.ceil(this.power.t) + 's';
      const tw = ctx.measureText(label).width + 18;
      ctx.fillStyle = 'rgba(0,10,24,0.6)'; ctx.fillRect(18, 52, tw, 20);
      ctx.fillStyle = rgba(pc, 0.9); ctx.beginPath(); ctx.arc(30, 62, 5, 0, 7); ctx.fill();
      ctx.fillStyle = pc; ctx.fillText(label, 40, 62);
    }

    // hint line""")

# 18) new methods before drawPlayer()
rep("  drawPlayer() {",
"""  setMouse(e) {
    const r = this.cv.getBoundingClientRect();
    const dpr = this.cv.width / r.width;
    this.mouse = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }

  grantPower(type) {
    const p = POWERS[type];
    this.power = { type, color: p.color, t: p.dur };
    this.au.powerup();
    this.ring(this.px, this.py, p.color, 8, 150, 0.8);
    this.burst(this.px, this.py, 26, p.color, 150);
    this.say(p.name + ' — ' + p.blurb);
  }

  fire() {
    if (this.state !== 'play' || this.shotCd > 0) return;
    const f = this.form, a = this.aim;
    const oc = this.power && this.power.type === 'overcharge';
    const storm = this.power && this.power.type === 'storm';
    const rate = storm ? 2.4 : 1;
    const dmg = oc ? 2 : 1;
    if (f.key === 'eel') {
      this.shotCd = 0.16 / rate;
      this.shots.push({ type: 'zap', x: this.px + Math.cos(a) * 14, y: this.py + Math.sin(a) * 14,
        vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, r: oc ? 5 : 3, life: 0.9, dmg, pierce: oc ? 2 : 1, hit: [], c: this.power ? this.power.color : f.glow });
      this.au.shoot('eel'); this.ring(this.px + Math.cos(a) * 14, this.py + Math.sin(a) * 14, f.glow, 3, 24, 0.18);
    } else if (f.key === 'angler') {
      this.shotCd = 0.5 / rate;
      this.shots.push({ type: 'bolt', x: this.px + Math.cos(a) * 18, y: this.py + Math.sin(a) * 18,
        vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: oc ? 11 : 8, life: 1.6, dmg: 2 * dmg, pierce: 0, hit: [], boom: true, c: this.power ? this.power.color : f.glow });
      this.au.shoot('angler');
    } else {
      this.shotCd = 0.34 / rate;
      const n = oc ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const aa = a + (i - (n - 1) / 2) * 0.22;
        this.shots.push({ type: 'nem', x: this.px, y: this.py, vx: Math.cos(aa) * 260, vy: Math.sin(aa) * 260,
          r: 4, life: 1.2, dmg: 0.7 * dmg, pierce: 0, hit: [], home: true, c: this.power ? this.power.color : f.glow });
      }
      this.au.shoot('jelly');
    }
  }

  _hurt(e, dmg, stun) {
    if (!e || e.dead) return false;
    e.hp -= dmg; if (stun) e.stun = Math.max(e.stun || 0, stun);
    if (e.hp <= 0) { e.dead = true; this.au.enemyDie(); this.burst(e.x, e.y, 22, '#ff9db0', 150); this.ring(e.x, e.y, '#ff9db0', 6, 70, 0.5); }
    else this.au.hit();
    return true;
  }

  updateCombat(dt, r) {
    const f = this.form;
    const solids = (x, y) => { const t = this.tileAt(x, y); return t === '#' || t === 'h'; };

    // projectiles
    for (const sh of this.shots) {
      sh.life -= dt;
      if (sh.home) { const dx = this._nearestEnemy(sh.x, sh.y); if (dx) { const a = Math.atan2(dx.y - sh.y, dx.x - sh.x); sh.vx += Math.cos(a) * 260 * dt; sh.vy += Math.sin(a) * 260 * dt; const sp = Math.hypot(sh.vx, sh.vy) || 1; sh.vx *= 260 / sp; sh.vy *= 260 / sp; } }
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      if (solids(sh.x, sh.y)) { sh.life = 0; if (sh.boom) this._boom(sh); continue; }
      const targets = [...this.urchins, ...this.fish, ...this.vipers, ...this.lanterns];
      for (const e of targets) {
        if (e.dead || sh.hit.includes(e)) continue;
        const er = e === this.urchins.find((u) => u === e) ? 11 : 13;
        if (Math.hypot(e.x - sh.x, e.y - sh.y) < sh.r + er) {
          sh.hit.push(e);
          this._hurt(e, sh.dmg, sh.type === 'nem' ? 1.2 : 0.4);
          if (sh.boom) { this._boom(sh); sh.life = 0; break; }
          sh.pierce -= 1; if (sh.pierce < 0) { sh.life = 0; break; }
        }
      }
      // stinger bulbs: hit to retract
      for (const st of this.stingers) {
        if (sh.hit.includes(st)) continue;
        if (Math.hypot(st.x - sh.x, st.y - sh.y) < sh.r + 14) { st.stun = 3.2; sh.hit.push(st); this.au.hit(); this.burst(st.x, st.y, 10, '#ff5c96', 90); if (!sh.boom) { sh.pierce -= 1; if (sh.pierce < 0) sh.life = 0; } else { this._boom(sh); sh.life = 0; } }
      }
      // boss
      const b = this.boss;
      if (b && !b.dead && !sh.hit.includes(b) && Math.hypot(b.x - sh.x, b.y - sh.y) < sh.r + 46) {
        sh.hit.push(b); b.hp -= sh.dmg; this.au.bossHit(); this.burst(sh.x, sh.y, 8, '#ffd0d8', 90);
        if (b.hp <= 0) { b.dead = true; b.dieT = 0; this.au.bossRoar(); this.shake = 20; this.flash = 0.8; this.burst(b.x, b.y, 120, '#ffe08a', 320); this.ring(b.x, b.y, '#ffe08a', 12, 400, 1.4); }
        if (sh.boom) { this._boom(sh); sh.life = 0; break; }
        sh.pierce -= 1; if (sh.pierce < 0) { sh.life = 0; break; }
      }
    }
    this.shots = this.shots.filter((sh) => sh.life > 0);

    // clear dead enemies
    this.urchins = this.urchins.filter((e) => !e.dead);
    this.fish = this.fish.filter((e) => !e.dead);
    this.vipers = this.vipers.filter((e) => !e.dead);
    this.lanterns = this.lanterns.filter((e) => !e.dead);

    // power-ups
    for (const p of this.powerups) {
      if (p.got) continue;
      if (Math.hypot(p.x - this.px, p.y - this.py) < r + 14) { p.got = true; this.grantPower(p.type); }
    }

    // boss behaviour
    const b = this.boss;
    if (b && !b.dead) {
      b.t += dt; b.enraged = b.hp <= b.maxhp * 0.5;
      this.au.setIntensity(1);
      const dx = this.px - b.x, dy = this.py - b.y, d = Math.hypot(dx, dy) || 1;
      const sp = b.enraged ? 40 : 24;
      b.x += (dx / d) * sp * dt + Math.cos(b.t * 1.1) * 22 * dt;
      b.y += (dy / d) * sp * 0.5 * dt + Math.sin(b.t * 1.6) * 26 * dt;
      b.x = clamp(b.x, TILE * 2, this.ww - TILE * 2);
      b.y = clamp(b.y, TILE * 2, this.wh - TILE * 2);
      b.ph = Math.atan2(dy, dx);
      b.fireT -= dt;
      if (b.fireT <= 0) {
        b.fireT = b.enraged ? 0.72 : 1.3;
        const n = b.enraged ? 5 : 3;
        for (let i = 0; i < n; i++) { const a = b.ph + (i - (n - 1) / 2) * 0.34;
          this.bossOrbs.push({ x: b.x, y: b.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, life: 5 }); }
        this.au.bossHit(); this.ring(b.x, b.y, '#ff5d73', 6, 60, 0.4);
      }
      if (d < 46 + r) { this.say('the Matriarch — shoot it, do not touch it'); this.die(); return; }
    } else if (b && b.dead) {
      b.dieT += dt; this.au.setIntensity(0.3);
    } else {
      this.au.setIntensity(0);
    }

    // boss orbs
    for (const o of this.bossOrbs) {
      o.life -= dt; o.x += o.vx * dt; o.y += o.vy * dt;
      if (Math.hypot(o.x - this.px, o.y - this.py) < r + 9) { this.die(); return; }
    }
    this.bossOrbs = this.bossOrbs.filter((o) => o.life > 0 && !solids(o.x, o.y));
  }

  _boom(sh) {
    this.au.flare(); this.ring(sh.x, sh.y, sh.c, 8, 120, 0.5);
    this.burst(sh.x, sh.y, 18, sh.c, 150);
    const targets = [...this.fish, ...this.vipers, ...this.lanterns, ...this.urchins];
    for (const e of targets) if (!e.dead && Math.hypot(e.x - sh.x, e.y - sh.y) < 70) this._hurt(e, 1, 2.2);
    if (this.boss && !this.boss.dead && Math.hypot(this.boss.x - sh.x, this.boss.y - sh.y) < 116) { this.boss.hp -= 1; this.au.bossHit(); }
  }

  _nearestEnemy(x, y) {
    let best = null, bd = 260;
    for (const e of [...this.fish, ...this.vipers, ...this.lanterns, ...this.urchins]) {
      if (e.dead) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; }
    }
    if (this.boss && !this.boss.dead) { const d = Math.hypot(this.boss.x - x, this.boss.y - y); if (d < bd) best = this.boss; }
    return best;
  }

  drawShots() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const sh of this.shots) {
      const a = clamp(sh.life * 2, 0, 1);
      if (sh.type === 'zap') {
        const ang = Math.atan2(sh.vy, sh.vx);
        ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(ang);
        ctx.fillStyle = rgba(sh.c, 0.9 * a);
        ctx.beginPath(); ctx.ellipse(0, 0, sh.r * 4, sh.r, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.9 * a);
        ctx.beginPath(); ctx.ellipse(0, 0, sh.r * 2, sh.r * 0.5, 0, 0, 7); ctx.fill();
        ctx.restore();
      } else if (sh.type === 'bolt') {
        const g = ctx.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, sh.r * 2.2);
        g.addColorStop(0, rgba('#fff2c0', 0.95 * a)); g.addColorStop(0.5, rgba(sh.c, 0.7 * a)); g.addColorStop(1, rgba(sh.c, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r * 2.2, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = rgba(sh.c, 0.85 * a); ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.6 * a); ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r * 0.4, 0, 7); ctx.fill();
      }
    }
    // boss orbs
    for (const o of this.bossOrbs) {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 16);
      g.addColorStop(0, rgba('#ffd0d8', 0.95)); g.addColorStop(0.5, rgba('#ff5d73', 0.6)); g.addColorStop(1, rgba('#ff5d73', 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, 16, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  drawPowerups() {
    const ctx = this.ctx;
    for (const p of this.powerups) {
      if (p.got) continue;
      const col = POWERS[p.type].color;
      const pu = 1 + 0.12 * Math.sin(this.time * 3 + p.ph);
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(pu, pu);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, rgba(col, 0.6)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.rotate(this.time * 0.9 + p.ph);
      ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * 7; const rr = i % 2 ? 6 : 12; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.85); ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  drawBoss() {
    const b = this.boss;
    if (!b) return;
    const ctx = this.ctx;
    if (b.dead && b.dieT > 1.6) return;
    this.litSources.push({ x: b.x, y: b.y, r: b.enraged ? 220 : 180, c: b.enraged ? '#ff5d73' : '#ff9db0' });
    const alpha = b.dead ? clamp(1 - b.dieT / 1.6, 0, 1) : 1;
    const scl = b.dead ? 1 + b.dieT * 0.4 : 1;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ph + Math.PI / 2); ctx.scale(scl, scl);
    ctx.globalAlpha = alpha;
    // glow
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 90);
    g.addColorStop(0, rgba(b.enraged ? '#ff5d73' : '#ff9db0', 0.4)); g.addColorStop(1, rgba('#ff9db0', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 90, 0, 7); ctx.fill();
    ctx.restore();
    // tentacles (jelly heritage)
    ctx.strokeStyle = rgba('#b06a86', 0.7 * alpha); ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 1.6;
      ctx.beginPath(); ctx.moveTo(Math.sin(a) * 20, 30);
      let px = Math.sin(a) * 20, py = 30;
      for (let k = 1; k <= 6; k++) { const seg = k * 16; px = Math.sin(a) * 20 + Math.sin(this.time * 3 + i + k * 0.6) * (6 + k * 2); py = 30 + seg; ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // bell / dome (angler body)
    const bg = ctx.createLinearGradient(0, -50, 0, 30);
    bg.addColorStop(0, rgba(b.enraged ? '#5a1830' : '#3a1430', 0.95)); bg.addColorStop(1, rgba('#12040f', 0.95));
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(-44, 20);
    ctx.bezierCurveTo(-52, -30, -26, -54, 0, -54);
    ctx.bezierCurveTo(26, -54, 52, -30, 44, 20);
    ctx.quadraticCurveTo(0, 34, -44, 20); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(b.enraged ? '#ff8fa3' : '#ff9db0', 0.85 * alpha); ctx.lineWidth = 2.5; ctx.stroke();
    // jaw + fangs
    ctx.fillStyle = rgba('#0a0208', 0.95);
    ctx.beginPath(); ctx.moveTo(-26, 6); ctx.quadraticCurveTo(0, 40, 26, 6); ctx.quadraticCurveTo(0, 18, -26, 6); ctx.fill();
    ctx.fillStyle = rgba('#fff0f4', 0.9 * alpha);
    for (let i = -3; i <= 3; i++) { const fx = i * 7; ctx.beginPath(); ctx.moveTo(fx - 2.5, 8); ctx.lineTo(fx + 2.5, 8); ctx.lineTo(fx, 8 + (i % 2 ? 9 : 13)); ctx.closePath(); ctx.fill(); }
    // eyes
    [-1, 1].forEach((sgn) => {
      ctx.fillStyle = rgba('#fff', 0.9); ctx.beginPath(); ctx.arc(sgn * 18, -22, 7, 0, 7); ctx.fill();
      ctx.fillStyle = rgba('#0a0208', 1); ctx.beginPath(); ctx.arc(sgn * 18 + sgn * 2, -22, 3.4, 0, 7); ctx.fill();
    });
    // lure rod + esca
    ctx.strokeStyle = rgba('#ffd0d8', 0.8); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -52); ctx.quadraticCurveTo(6, -80, 2, -96); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(2, -98, 0, 2, -98, 22);
    lg.addColorStop(0, rgba('#fff2c0', 0.95)); lg.addColorStop(1, rgba('#ff9db0', 0));
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(2, -98, 22, 0, 7); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  drawPlayer() {""")

open(P, 'w').write(s)
print('COMBAT PASS OK —', len(orig), '->', len(s), 'bytes,', s.count(chr(10)), 'lines')
