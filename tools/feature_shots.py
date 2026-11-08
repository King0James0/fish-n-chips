"""Clean evidence shots of the NEW features. The earlier rig let aggressive enemies
kill the camera creature (so we captured death bursts, not projectiles). Here we
clear the neighbourhood, place the player in open water, and FREEZE in-flight
projectiles so the stream is actually visible."""
import http.server, socketserver, threading, functools, os
ROOT = '/a0/usr/workdir/nightshift'; OUT = os.path.join(ROOT, 'art')
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass
class Reuse(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Reuse(('127.0.0.1', 8139), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8139/index.html', wait_until='load')
    pg.wait_for_timeout(1000)

    # BOSS ARENA — clear her escorts so she reads alone, big, mid-fire
    pg.evaluate("""() => { const g = window.__game; g.loadLevel(6); g.state='play';
      g.vipers=[]; g.lanterns=[]; g.fish=[]; g.urchins=[];
      g.mouse=null; g.padAim={x:0,y:0};
      for (let i=0;i<90;i++){ g.px=g.boss.x-170; g.py=g.boss.y+10; g.aim=0; g.update(0.016); g.bossOrbs.length=Math.min(g.bossOrbs.length,4);} }""")
    pg.wait_for_timeout(160); pg.screenshot(path=f'{OUT}/shot_boss.png')

    # SHOOTING — eel zaps frozen mid-flight toward a lanternfish
    pg.evaluate("""() => { const g = window.__game; g.loadLevel(5); g.state='play'; g.setForm('eel');
      g.vipers=[]; g.urchins=[]; g.fish=[];
      const e = g.lanterns[0]; if(e){ e.stun=99; g.lanterns=[e]; }
      const tx = e? e.x-130 : g.spawn.x+120, ty = e? e.y : g.spawn.y;
      g.mouse=null; g.padAim={x:0,y:0}; g.firing=true;
      for(let i=0;i<18;i++){ g.px=tx; g.py=ty; g.aim=0; g.update(0.016); }
      g.firing=false; for(const sh of g.shots){ sh.life=6; } }""")
    pg.wait_for_timeout(120); pg.screenshot(path=f'{OUT}/shot_shooting.png')

    # POWER-UP aura — angler glowing gold, clear water
    pg.evaluate("""() => { const g = window.__game; g.loadLevel(5); g.state='play'; g.setForm('angler');
      g.vipers=[]; g.urchins=[]; g.fish=[]; g.lanterns=[]; g.stingers=[];
      g.grantPower('overcharge'); g.mouse=null; g.padAim={x:0,y:0};
      g.px = g.spawn.x+60; g.py=g.spawn.y+30; g.vx=0; g.vy=0; g.aim=0;
      for(let i=0;i<10;i++){ g.px=g.spawn.x+60; g.py=g.spawn.y+30; g.update(0.016);} }""")
    pg.wait_for_timeout(150); pg.screenshot(path=f'{OUT}/shot_powerup.png')

    # JELLY 360 aim — bell rotated up-left, nematocyst spread frozen
    pg.evaluate("""() => { const g = window.__game; g.loadLevel(5); g.state='play'; g.setForm('jelly');
      g.vipers=[]; g.urchins=[]; g.fish=[]; g.lanterns=[]; g.stingers=[];
      g.mouse=null; g.padAim={x:0,y:0};
      const px=g.spawn.x+80, py=g.spawn.y+50;
      g.firing=true; for(let i=0;i<14;i++){ g.px=px; g.py=py; g.aim=-2.3; g.update(0.016);} g.firing=false;
      for(const sh of g.shots){ sh.life=6; } g.px=px; g.py=py; g.aim=-2.3; }""")
    pg.wait_for_timeout(120); pg.screenshot(path=f'{OUT}/shot_jelly_aim.png')

    b.close()
httpd.shutdown()
print('SHOTS ERRORS:', len(errs))
for e in errs[:8]: print(' !', e)
