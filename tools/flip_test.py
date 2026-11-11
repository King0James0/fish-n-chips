#!/usr/bin/env python3
"""Verify the never-upside-down flip at extreme aim angles.
angler/eel facing left (aim=PI) and jelly facing down (aim=PI/2) must still
show the dorsal/lure/dome on TOP, not inverted."""
import http.server, socketserver, threading, functools, os
from PIL import Image

ROOT = '/a0/usr/workdir/nightshift'
OUT = os.path.join(ROOT, 'art')

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass
class Reuse(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Reuse(('127.0.0.1', 8144), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 640, 'height': 360})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8144/pixi.html', wait_until='load')
    pg.wait_for_function('window.__pixi && window.__pixi.ready===true', timeout=25000)
    pg.wait_for_timeout(600)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)

    cases = [
        (2, 'angler', 0.0, 'flip_angler_right'),   # baseline: facing right
        (2, 'angler', 3.14159, 'flip_angler_left'),  # facing left -> must flip, lure on top
        (1, 'jelly', 0.0, 'flip_jelly_right'),
        (1, 'jelly', 1.5708, 'flip_jelly_down'),   # facing down -> must flip, dome on top
        (0, 'eel', 0.0, 'flip_eel_right'),
        (0, 'eel', 3.14159, 'flip_eel_left'),       # facing left -> must flip, highlight on top
    ]
    for lvl, form, aim, name in cases:
        pg.evaluate("""(a) => {
          const g = window.__game;
          g.loadLevel(a.lvl); g.state = 'play'; g.setForm(a.form);
          g.px = 10 * 28 + 14; g.py = 10 * 28 + 14;
          g.vx = Math.cos(a.aim) * 120; g.vy = Math.sin(a.aim) * 120;
          g.aim = a.aim; g.aimTarget = a.aim; g.lastDirX = Math.cos(a.aim); g.lastDirY = Math.sin(a.aim);
          g.respawn = {x: g.px, y: g.py};
        }""", {'lvl': lvl, 'form': form, 'aim': aim})
        pg.wait_for_timeout(1000)
        pos = pg.evaluate("""() => {
          const g = window.__game;
          const {s, ox, oy} = g.fit();
          return {x: ox + g.px * s, y: oy + g.py * s};
        }""")
        pg.screenshot(path=f'{OUT}/{name}.png')
        im = Image.open(f'{OUT}/{name}.png')
        dpr = im.width / 640.0
        cx, cy = pos['x'] * dpr, pos['y'] * dpr
        box = 90 * dpr
        crop = im.crop((int(cx - box), int(cy - box), int(cx + box), int(cy + box)))
        crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
        crop.save(f'{OUT}/{name}_crop.png')
        print(name, 'done')
    b.close()
httpd.shutdown()
print('pageerrors:', len(errors), errors[:2])
