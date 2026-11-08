#!/usr/bin/env python3
"""Capture a curated screenshot set for the README / itch.io page.
Places each form in open water (or at its teaching set-piece) so the shots land."""
import http.server, socketserver, threading, functools, os

ROOT = '/a0/usr/workdir/nightshift'
OUT = os.path.join(ROOT, 'art')
os.makedirs(OUT, exist_ok=True)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass

class Reuse(socketserver.TCPServer):
    allow_reuse_address = True

httpd = Reuse(('127.0.0.1', 8141), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8141/pixi.html', wait_until='load')
    pg.wait_for_function('window.__pixi && window.__pixi.ready===true', timeout=25000)
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{OUT}/shot_title.png')

    pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    pg.screenshot(path=f'{OUT}/shot_actcard.png')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)

    def place(level, form, x, y, settle=1.4):
        pg.evaluate("""(a) => {
          const g = window.__game;
          g.loadLevel(a.level); g.state = 'play';
          g.setForm(a.form);
          g.px = a.x * 28 + 14; g.py = a.y * 28 + 14;
          g.vx = 0; g.vy = 0; g.respawn = { x: g.px, y: g.py };
          g.time = 0;
        }""", {'level': level, 'form': form, 'x': x, 'y': y})
        pg.wait_for_timeout(int(settle * 1000))

    # Act I: eel gliding through open water, rim-lit rock
    place(0, 'eel', 6, 6, 1.6)
    pg.keyboard.down('d'); pg.wait_for_timeout(700); pg.keyboard.up('d')
    pg.wait_for_timeout(250)
    pg.screenshot(path=f'{OUT}/shot_eel.png')

    # Act II: jelly inside the anemone curtain, currents carrying it
    place(1, 'jelly', 12, 12, 1.6)
    pg.screenshot(path=f'{OUT}/shot_jelly.png')

    # Act III: angler beside a hidden wall — the lure exposes it
    place(2, 'angler', 7, 12, 1.6)
    pg.screenshot(path=f'{OUT}/shot_angler.png')

    # Act III: flare fired — ring + stun + big light
    pg.keyboard.press('4'); pg.wait_for_timeout(50)   # nothing; keep state
    pg.evaluate("() => { const g=window.__game; g.sparks = 6; }")
    pg.keyboard.press('Space'); pg.wait_for_timeout(320)
    pg.screenshot(path=f'{OUT}/shot_flare.png')

    # Act V: the ascent, god rays + goal beacon
    place(4, 'jelly', 30, 20, 1.4)
    pg.evaluate("() => { const g=window.__game; g.px = g.goal.x; g.py = g.goal.y + 120; g.vy = -60; }")
    pg.wait_for_timeout(900)
    pg.screenshot(path=f'{OUT}/shot_ascent.png')

    # Act IV: the gauntlet wide shot with a checkpoint lit
    place(3, 'eel', 5, 12, 1.2)
    pg.evaluate("() => { const g=window.__game; for (const c of g.checkpoints) { c.on = true; break; } g.sparks = 3; }")
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{OUT}/shot_gauntlet.png')

    b.close()

httpd.shutdown()
print('pageerrors:', len(errors), errors[:3])
print('SHOTS:', sorted(f for f in os.listdir(OUT) if f.endswith('.png')))
