#!/usr/bin/env python3
"""Crop in on the player creature for each form so we can judge body detail."""
import http.server, socketserver, threading, functools, os
from PIL import Image

ROOT = '/a0/usr/workdir/nightshift'
OUT = os.path.join(ROOT, 'art')

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass

class Reuse(socketserver.TCPServer):
    allow_reuse_address = True

httpd = Reuse(('127.0.0.1', 8143), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    # small viewport => the fit() scale is larger => creature drawn bigger
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 640, 'height': 360})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8143/pixi.html', wait_until='load')
    pg.wait_for_function('window.__pixi && window.__pixi.ready===true', timeout=25000)
    pg.wait_for_timeout(600)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)

    for lvl, form, tx, ty, name in [
        (0, 'eel', 6, 6, 'zoom_eel'),
        (2, 'angler', 7, 12, 'zoom_angler'),
        (1, 'jelly', 12, 12, 'zoom_jelly'),
    ]:
        pg.evaluate("""(a) => {
          const g = window.__game;
          g.loadLevel(a.lvl); g.state = 'play'; g.setForm(a.form);
          g.px = a.tx * 28 + 14; g.py = a.ty * 28 + 14;
          g.vx = 120; g.vy = 0; g.respawn = {x: g.px, y: g.py};
        }""", {'lvl': lvl, 'form': form, 'tx': tx, 'ty': ty})
        pg.wait_for_timeout(900)
        pos = pg.evaluate("""() => {
          const g = window.__game;
          const {s, ox, oy} = g.fit();
          return {x: ox + g.px * s, y: oy + g.py * s, s};
        }""")
        pg.screenshot(path=f'{OUT}/{name}.png')
        # 3x upscale of a 150px box around the creature
        im = Image.open(f'{OUT}/{name}.png')
        dpr = im.width / 640.0
        cx, cy = pos['x'] * dpr, pos['y'] * dpr
        box = 110 * dpr
        crop = im.crop((int(cx - box), int(cy - box), int(cx + box), int(cy + box)))
        crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
        crop.save(f'{OUT}/{name}_crop.png')
        print(name, 'scale', round(pos['s'], 2), 'crop', crop.size)
    b.close()

httpd.shutdown()
print('pageerrors:', len(errors), errors[:2])
