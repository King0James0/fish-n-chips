#!/usr/bin/env python3
"""Headless runtime test for Fish N Chips: load, play, screenshot, capture console errors."""
import http.server, socketserver, threading, functools, os, sys, json

ROOT = '/a0/usr/workdir/nightshift'
OUT = os.path.join(ROOT, 'art')
os.makedirs(OUT, exist_ok=True)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass

class Reuse(socketserver.TCPServer):
    allow_reuse_address = True

httpd = Reuse(('127.0.0.1', 8137), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
print('serving on 8137')

from playwright.sync_api import sync_playwright

errors, warnings = [], []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else (warnings.append(m.text) if m.type == 'warning' else None))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR: ' + str(e) + '\n' + (e.stack or '')))

    pg.goto('http://127.0.0.1:8137/pixi.html', wait_until='load')
    pg.wait_for_function('window.__pixi && window.__pixi.ready===true', timeout=25000)
    pg.wait_for_timeout(600)
    pg.screenshot(path=f'{OUT}/shot_title.png')

    # start the game
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(700)
    pg.screenshot(path=f'{OUT}/shot_actcard.png')

    # dismiss act card, swim around
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(400)
    pg.keyboard.down('d'); pg.wait_for_timeout(900); pg.keyboard.up('d')
    pg.keyboard.down('w'); pg.wait_for_timeout(500); pg.keyboard.up('w')
    pg.keyboard.press('Space')  # eel dash
    pg.wait_for_timeout(400)
    pg.screenshot(path=f'{OUT}/shot_eel.png')

    # shift to angler (reveals hidden blocks + lure light)
    pg.keyboard.press('2')
    pg.wait_for_timeout(600)
    pg.screenshot(path=f'{OUT}/shot_angler.png')

    # shift to jelly
    pg.keyboard.press('3')
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{OUT}/shot_jelly.png')

    # probe internal state
    st = pg.evaluate("""() => {
      const g = window.__game;
      if (!g) return {err: 'no __game handle'};
      return {state: g.state, level: g.levelIndex, act: g.actName, form: g.form.key,
              px: Math.round(g.px), py: Math.round(g.py), sparks: g.sparks,
              plankton: g.plankton.length, urchins: g.urchins.length,
              fish: g.fish.length, checkpoints: g.checkpoints.length,
              goal: !!g.goal, motes: g.motes.length, particles: g.particles.length,
              audio: !!g.au.ctx, fps_ok: g.time > 0};
    }""")
    print('STATE:', json.dumps(st, indent=2))

    # exercise every level: teleport to goal and confirm act-clear transitions
    trans = pg.evaluate("""async () => {
      const g = window.__game; const out = [];
      for (let i = 0; i < 8; i++) {
        g.loadLevel(i); g.state = 'play';
        if (!g.goal) { out.push({i, err: 'no goal'}); continue; }
        if (g.boss && !g.boss.dead) g.boss.dead = true;   // boss arena gates its beacon
        for (const mb of (g.minibosses || [])) mb.dead = true;   // mini-bosses gate it too
        g.px = g.goal.x; g.py = g.goal.y; g.form = Object.assign({}, g.form, {r: 8});
        g.update(0.016);
        out.push({i, act: g.actName, stateAfter: g.state});
        g.state = 'play';
      }
      return out;
    }""")
    print('LEVEL GOALS:', json.dumps(trans, indent=2))

    # verify eel fits the 1-tile gap and angler does not (Act I wall at x=26,y=16)
    fit = pg.evaluate("""() => {
      const g = window.__game; g.loadLevel(0); g.state='play';
      // snapshot the REAL form objects (a bare {r} stub has no accel/drag -> NaN)
      const real = {};
      for (const k of ['eel','angler','jelly']) { g.setForm(k); real[k] = Object.assign({}, g.form); }
      const res = {};
      for (const k of ['eel','angler','jelly']) {
        g.form = real[k];
        g.px = 26*28+14; g.py = 16*28+14;
        res[k] = { fits: !g.overlapsSolid(), r: real[k].r };
      }
      return res;
    }""")
    print('GAP FIT (true=can pass):', json.dumps(fit))

    # anemone burn check: eel dies, jelly survives
    burn = pg.evaluate("""() => {
      const g = window.__game; g.loadLevel(1); g.state='play';
      const ax = g.anemones[3]; const px = ax.x*28+14, py = ax.y*28+14;
      const out = {};
      g.form = {key:'eel', r:8, speed:1, accel:0, drag:0, ability:'', burns:false, glow:'#2affd5', body:'#5ef2c8'};
      g.px=px; g.py=py; g.vx=0; g.vy=0; const d0=g.deaths; g.update(0.016);
      out.eelDies = g.deaths > d0;
      g.loadLevel(1); g.state='play';
      g.form = {key:'jelly', r:11, speed:130, accel:620, drag:2.2, ability:'pulse', burns:true, glow:'#e0aaff', body:'#c77dff'};
      g.px=px; g.py=py; g.vx=0; g.vy=0; const d1=g.deaths; g.update(0.016);
      out.jellySurvives = g.deaths === d1;
      return out;
    }""")
    print('ANEMONE RULES:', json.dumps(burn))

    # ---- COMBAT: shooting kills, power-ups tint, boss takes damage, beacon gated --
    combat = pg.evaluate("""async () => {
      const g = window.__game; const out = {};
      const pin = (x, y, aim) => { g.px = x; g.py = y; g.vx = 0; g.vy = 0; g.aim = aim; };

      // Act VI (index 5) is stocked with every species + power-ups
      g.loadLevel(5); g.state = 'play'; g.mouse = null; g.padAim = { x: 0, y: 0 };
      out.roster = { urchins: g.urchins.length, fish: g.fish.length, vipers: g.vipers.length,
                     lanterns: g.lanterns.length, powerups: g.powerups.length };

      // eel zap kills a lanternfish (stun it first so it cannot kill the rig)
      const e = g.lanterns[0] || g.fish[0];
      e.stun = 9; const hp0 = e.hp;
      let frames = 0; g.firing = true;
      while (!e.dead && frames < 240) { pin(e.x - 70, e.y, 0); g.update(0.016); frames++; }
      out.shooting = { hp0, dead: !!e.dead, framesToKill: frames, shotsSeen: g.shots.length > 0 };

      // power-up changes the player's colour + aura
      g.firing = false; g.grantPower('overcharge');
      out.powerup = { type: g.power && g.power.type, color: g.power && g.power.color,
                      litColorMatches: g.power ? true : false };
      out.powerup.shots = g.shots.length;

      // Act VIII (index 7): the Matriarch (the boss now guards the FINAL beacon)
      g.loadLevel(7); g.state = 'play'; g.mouse = null;
      const b = g.boss;
      out.boss = { present: !!b, hp: b && b.hp, maxhp: b && b.maxhp };
      const bhp0 = b.hp; let bf = 0;
      g.grantPower('overcharge'); g.firing = true;
      while (!b.dead && bf < 900) { pin(b.x - 130, b.y, 0); g.bossOrbs.length = 0; g.eshots.length = 0; g.update(0.016); bf++; }
      out.bossFight = { bhp0, hpAfter: Math.round(b.hp), dead: !!b.dead, frames: bf, enraged: !!b.enraged };

      // orbs do spawn (separate probe, we cleared them during the damage test)
      g.loadLevel(7); g.state = 'play'; g.firing = false;
      for (let i = 0; i < 120; i++) { pin(g.boss.x - 130, g.boss.y, 0); g.eshots.length = 0; g.update(0.016); }
      out.bossOrbsSpawned = g.bossOrbs.length > 0;

      // beacon is cold while she lives, live once she is slain
      g.loadLevel(7); g.state = 'play'; pin(g.goal.x, g.goal.y, 0); g.update(0.016);
      out.beaconGatedWhileAlive = g.state !== 'win';
      g.boss.dead = true; g.update(0.016);
      out.beaconLiveAfterKill = g.state === 'win';

      g.state = 'play'; g.firing = false; g.power = null;
      return out;
    }""")
    print('COMBAT:', json.dumps(combat, indent=2))

    # 360-degree aim: cursor to the left must rotate the creature to face left
    aimtest = pg.evaluate("""() => {
      const g = window.__game; g.loadLevel(0); g.state = 'play'; g.setForm('eel');
      const s = g.fit(); g._s = s.s; g._ox = s.ox; g._oy = s.oy;
      const toScreen = (wx, wy) => ({ x: wx * s.s + s.ox, y: wy * s.s + s.oy });
      const right = toScreen(g.px + 200, g.py);
      g.mouse = right; g.update(0.016); const aRight = g.aim;
      const left = toScreen(g.px - 200, g.py);
      g.mouse = left; g.update(0.016); const aLeft = g.aim;
      const up = toScreen(g.px, g.py - 200);
      g.mouse = up; g.update(0.016); const aUp = g.aim;
      g.mouse = null;
      return { right: +aRight.toFixed(2), left: +aLeft.toFixed(2), up: +aUp.toFixed(2),
               fullCircle: Math.abs(aRight - aLeft) > 2.5 };
    }""")
    print('AIM 360 (rad):', json.dumps(aimtest))

    # long-run stability: 6s of simulated frames
    stab = pg.evaluate("""async () => {
      const g = window.__game; g.loadLevel(3); g.state='play';
      let maxP = 0;
      for (let i=0;i<400;i++){
        g.keys = new Set(['d']); g.update(0.016);
        if (i%40===0) g.setForm(['eel','angler','jelly'][(i/40)%3]);
        maxP = Math.max(maxP, g.particles.length);
      }
      return {frames: 400, maxParticles: maxP, deaths: g.deaths, state: g.state};
    }""")
    print('STABILITY:', json.dumps(stab))

    b.close()

httpd.shutdown()
print('CONSOLE ERRORS:', len(errors))
for e in errors[:20]: print('  !', e)
print('SHOTS:', sorted(os.listdir(OUT)))
sys.exit(1 if errors else 0)
