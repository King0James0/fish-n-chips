#!/usr/bin/env python3
"""Verify the act-card hint no longer overflows the reading window (word-wrap)."""
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
    pg = b.new_page(viewport={'width': 960, 'height': 540})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8145/pixi.html', wait_until='load')
    pg.wait_for_function('window.__pixi && window.__pixi.ready===true', timeout=25000)
    pg.wait_for_timeout(600)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)

    for lvl, name in [(1, 'actcard_act2'), (2, 'actcard_act3'), (4, 'actcard_act5')]:
        pg.evaluate("""(a) => {
          const g = window.__game;
          g.loadLevel(a.lvl); g.state = 'actcard'; g.cardT = 0.8;
        }""", {'lvl': lvl})
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/{name}.png')
        print(name, 'done')
    b.close()
httpd.shutdown()
print('pageerrors:', len(errors), errors[:2])
