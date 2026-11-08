#!/usr/bin/env python3
"""Frame each enemy species up close and in the dark, to judge anatomy + readability."""
import http.server, socketserver, threading, functools, os
from PIL import Image

ROOT = '/a0/usr/workdir/nightshift'
OUT = os.path.join(ROOT, 'art')

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass

class Reuse(socketserver.TCPServer):
    allow_reuse_address = True

httpd = Reuse(('127.0.0.1', 8145), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 700, 'height': 420})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.goto('http://127.0.0.1:8145/index.html', wait_until='load')
    pg.wait_for_timeout(1200)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(350)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(250)

    # put a viperfish right in front of the eel and let it charge
    pg.evaluate("""() => {
      const g = window.__game;
      g.loadLevel(3); g.state='play'; g.setForm('eel');
      g.px = 300; g.py = 300; g.vx=60; g.vy=0; g.respawn={x:300,y:300};
      g.vipers = [{x: 470, y: 300, x0: 470, y0: 300, dir: -1, stun: 0, charge: 0, rest: 0, vx: 0, vy: 0, ph: 1.2}];
      g.lanterns = [{x: 520, y: 180, x0: 520, y0: 180, stun: 0, ph: 2.0}];
      g.stingers = [{x: 380, y: 150, ph: 0.0, reach: 0}];
      g.fish = [{x: 250, y: 430, x0: 250, dir: 1, stun: 0, ph: 0.4}];
      g.urchins = [{x: 560, y: 400, ph: 0.9}];
    }""")
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{OUT}/shot_enemies.png')

    # freeze each species at max detail and crop it
    for name, sel, secs in [
        ('viper', 'vipers', 0.62),
        ('lantern', 'lanterns', 0.0),
        ('stinger', 'stingers', 0.0),
        ('dragon', 'fish', 0.0),
        ('urchin', 'urchins', 0.0),
    ]:
        pos = pg.evaluate("""(a) => {
          const g = window.__game;
          const e = g[a.sel][0];
          if (!e) return null;
          if (a.sel === 'vipers') { e.charge = a.s; e.vx = -300; e.vy = 0; }
          if (a.sel === 'stingers') { e.ph = 0; g.time = 1.37; }  // near full extension
          const {s, ox, oy} = g.fit();
          return {x: ox + e.x * s, y: oy + e.y * s};
        }""", {'sel': sel, 's': secs})
        if not pos:
            print(name, 'MISSING'); continue
        pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/tmp_{name}.png')
        im = Image.open(f'{OUT}/tmp_{name}.png')
        dpr = im.width / 700.0
        cx, cy = pos['x'] * dpr, pos['y'] * dpr
        box = 95 * dpr
        c = im.crop((int(cx - box), int(cy - box), int(cx + box), int(cy + box)))
        c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)
        c.save(f'{OUT}/enemy_{name}.png')
        os.remove(f'{OUT}/tmp_{name}.png')
        print(name, c.size)

    # do the species actually exist in the shipped levels?
    counts = pg.evaluate("""() => {
      const out = {};
      for (let i=0;i<5;i++) {
        window.__game.loadLevel(i);
        const g = window.__game;
        out[g.actName] = {vipers: g.vipers.length, lanterns: g.lanterns.length,
                          stingers: g.stingers.length, fish: g.fish.length, urchins: g.urchins.length};
      }
      return out;
    }""")
    import json
    print('ENEMY COUNTS:', json.dumps(counts, indent=2))
    b.close()

httpd.shutdown()
print('pageerrors:', len(errors), errors[:2])
