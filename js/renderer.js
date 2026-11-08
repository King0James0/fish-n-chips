// Fish N Chips — native PixiJS renderer.
//
// This module replaces the entire Canvas2D draw layer with Pixi scene-graph
// primitives: Graphics for all vector art, pooled Sprites for radial glows and
// particles, RenderTexture + BlurFilter for bloom, blendMode 'erase' for the
// darkness pass, and Text for HUD/overlays. It reads the verified Game state
// (physics/AI in main.js) and draws nothing through a 2D context.
//
// Coordinate convention: everything below works in CSS pixels. `world` is a
// Container with position (ox,oy) and scale s — the camera. Screen-space
// layers (lighting, bloom, vignette, HUD, overlays) sit outside `world`.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const hexCache = new Map();
function hexInt(h) {
  if (typeof h !== 'string' || h[0] !== '#') return 0xc8e8ff;
  let v = hexCache.get(h);
  if (v === undefined) {
    const n = parseInt(h.slice(1), 16);
    v = Number.isFinite(n) ? n : 0xc8e8ff;
    hexCache.set(h, v);
  }
  return v;
}

// Parse a CSS-ish font string like '700 13px ui-monospace, Menlo, monospace'
// (optionally prefixed 'italic ') into a Pixi TextStyle descriptor.
const styleCache = new Map();
function textStyle(PIXI, font, color, shadow) {
  const key = font + '|' + color + '|' + (shadow || '');
  let st = styleCache.get(key);
  if (st) return st;
  let f = font, italic = false;
  if (/^italic\s/.test(f)) { italic = true; f = f.replace(/^italic\s/, ''); }
  const m = f.match(/^(?:(\w+)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/);
  const weight = m && m[1] ? m[1] : 'normal';
  const size = m ? parseFloat(m[2]) : 14;
  const fam = m ? m[3] : 'monospace';
  const opts = {
    fontFamily: fam,
    fontSize: size,
    fontWeight: weight,
    fontStyle: italic ? 'italic' : 'normal',
    fill: hexInt(color),
  };
  if (shadow) {
    const sd = shadow.match(/^(#[0-9a-fA-F]{3,8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    opts.dropShadow = {
      color: sd ? hexInt(sd[1]) : 0x78dcff,
      blur: sd ? parseFloat(sd[2]) : 20,
      distance: 0,
      alpha: sd ? parseFloat(sd[3]) : 0.9,
    };
  }
  st = new PIXI.TextStyle(opts);
  styleCache.set(key, st);
  return st;
}

import { TILE } from './levels.js';

export function createRenderer(PIXI, game, app) {
  // ---------------------------------------------------------------- helpers
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = () => app.screen.width;
  const H = () => app.screen.height;

  // ---- baked radial-glow textures (white; tinted per use) ----
  function radialTex(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return PIXI.Texture.from(c);
  }
  const TEX_SOFT = radialTex([[0, 1], [0.45, 0.3], [1, 0]]);      // generic halo
  const TEX_TIGHT = radialTex([[0, 1], [0.3, 0.55], [1, 0]]);      // hot core
  const TEX_FADE = radialTex([[0, 0.8], [0.6, 0.12], [1, 0]]);     // wide bloom
  const TEX_PART = radialTex([[0, 1], [0.25, 0.25], [1, 0]]);      // particle

  // ---- scene graph ----
  const stage = app.stage;

  const pageBgG = new PIXI.Graphics();                 // letterbox backdrop
  stage.addChild(pageBgG);

  const graded = new PIXI.Container();                 // receives shimmer+grade
  stage.addChild(graded);

  const world = new PIXI.Container();                  // camera
  graded.addChild(world);

  const waterBaseG = new PIXI.Graphics();
  const waterG = new PIXI.Graphics();
  const bgLayer = new PIXI.Container();
  const bgG = new PIXI.Graphics();
  bgLayer.addChild(bgG);
  const rayG = new PIXI.Graphics(); rayG.blendMode = 'add';
  const rockG = new PIXI.Graphics();
  const currentG = new PIXI.Graphics(); currentG.blendMode = 'add';
  const hiddenG = new PIXI.Graphics();
  const anemG = new PIXI.Graphics();
  const checkG = new PIXI.Graphics(); checkG.blendMode = 'add';
  const goalG = new PIXI.Graphics();
  const plankG = new PIXI.Graphics(); plankG.blendMode = 'add';
  const bulbG = new PIXI.Graphics(); bulbG.blendMode = 'add';
  const powerG = new PIXI.Graphics();
  const urchG = new PIXI.Graphics();
  const stingG = new PIXI.Graphics();
  const lanG = new PIXI.Graphics();
  const fishG = new PIXI.Graphics();
  const vipG = new PIXI.Graphics();
  const ringG = new PIXI.Graphics(); ringG.blendMode = 'add';
  const miniG = new PIXI.Graphics();
  const bossG = new PIXI.Graphics();
  const shotG = new PIXI.Graphics(); shotG.blendMode = 'add';
  const playerG = new PIXI.Graphics();
  const glowWorld = new PIXI.Container(); glowWorld.blendMode = 'add';
  const partWorld = new PIXI.Container(); partWorld.blendMode = 'add';
  world.addChild(waterBaseG, waterG, bgLayer, rayG, rockG, currentG, hiddenG, anemG,
    checkG, goalG, plankG, bulbG, powerG, urchG, stingG, lanG, fishG, vipG,
    glowWorld, ringG, miniG, bossG, shotG, playerG, partWorld);

  // ---- screen-space FX layers ----
  const tintG = new PIXI.Graphics(); tintG.blendMode = 'add';
  stage.addChild(tintG);

  // Darkness pass: a dark rect with soft holes punched by blendMode 'erase',
  // rendered OFFSCREEN into a RenderTexture and composited as a single sprite.
  // (Erasing directly on the main framebuffer would also erase the world.)
  const darkG = new PIXI.Graphics();
  const eraseLayer = new PIXI.Container();
  eraseLayer.blendMode = 'erase';
  const darkBox = new PIXI.Container();
  darkBox.addChild(darkG, eraseLayer);
  darkBox.renderable = false;
  stage.addChild(darkBox);
  const darkRT = PIXI.RenderTexture.create({ width: 2, height: 2, resolution: 1 });
  const darkSprite = new PIXI.Sprite(darkRT);
  stage.addChild(darkSprite);

  // bloom: world -> 1/3 RT -> two blurred additive sprites
  const bloomRT = PIXI.RenderTexture.create({ width: 2, height: 2, resolution: 1 });
  let bloomA = null, bloomB = null;
  try {
    bloomA = new PIXI.Sprite(bloomRT);
    bloomA.blendMode = 'add'; bloomA.alpha = 0.34;
    bloomA.filters = [new PIXI.BlurFilter({ blur: 9 })];
    bloomB = new PIXI.Sprite(bloomRT);
    bloomB.blendMode = 'add'; bloomB.alpha = 0.16;
    bloomB.filters = [new PIXI.BlurFilter({ blur: 24 })];
    stage.addChild(bloomA, bloomB);
  } catch (e) { bloomA = bloomB = null; }

  const vignetteG = new PIXI.Graphics();
  const flashG = new PIXI.Graphics();
  const fadeG = new PIXI.Graphics();
  stage.addChild(vignetteG, flashG, fadeG);

  // ---- HUD / overlay layer (scaled by u, like the Canvas build) ----
  const hudLayer = new PIXI.Container();
  stage.addChild(hudLayer);
  const hudG = new PIXI.Graphics();
  hudLayer.addChild(hudG);

  // pooled glow sprites (world space, additive)
  const glowPool = [];
  let glowN = 0;
  function glow(tex, x, y, r, col, a) {
    if (a <= 0.002 || r <= 0) return;
    let s = glowPool[glowN];
    if (!s) {
      s = new PIXI.Sprite(tex);
      s.anchor.set(0.5);
      glowWorld.addChild(s);
      glowPool[glowN] = s;
    }
    s.texture = tex; s.visible = true;
    s.position.set(x, y);
    s.width = s.height = r * 2;
    s.tint = col;
    s.alpha = clamp(a, 0, 1);
    glowN++;
  }

  // pooled particle sprites (world space, additive)
  const partPool = [];
  let partN = 0;
  function particle(x, y, r, col, a) {
    if (a <= 0.004 || r <= 0) return;
    let s = partPool[partN];
    if (!s) {
      s = new PIXI.Sprite(TEX_PART);
      s.anchor.set(0.5);
      partWorld.addChild(s);
      partPool[partN] = s;
    }
    s.visible = true; s.position.set(x, y);
    s.width = s.height = r * 2;
    s.tint = col; s.alpha = clamp(a, 0, 1);
    partN++;
  }

  // pooled erase sprites (screen space) — punch soft holes in the darkness
  const erasePool = [];
  let eraseN = 0;
  function eraseHole(x, y, r, a) {
    if (r <= 0) return;
    let s = erasePool[eraseN];
    if (!s) {
      s = new PIXI.Sprite(TEX_SOFT);
      s.anchor.set(0.5);
      eraseLayer.addChild(s);
      erasePool[eraseN] = s;
    }
    s.visible = true; s.position.set(x, y);
    s.width = s.height = r * 2;
    s.alpha = clamp(a, 0, 1);
    eraseN++;
  }

  // pooled Text (hud space)
  const textPool = [];
  let textN = 0;
  function txt(str, x, y, font, color, align, alpha, shadow) {
    let t = textPool[textN];
    if (!t) {
      t = new PIXI.Text({ text: '', style: {} });
      hudLayer.addChild(t);
      textPool[textN] = t;
    }
    t.text = str;
    t.style = textStyle(PIXI, font, color, shadow);
    t.anchor.set(align === 'center' ? 0.5 : align === 'right' ? 1 : 0, 0.5);
    t.position.set(x, y);
    t.alpha = alpha === undefined ? 1 : clamp(alpha, 0, 1);
    t.visible = true;
    textN++;
  }

  // ---- water gradient strip cache: rebuild only when act/size changes ----
  let waterKey = '', bgKey = '';

  function drawWater() {
    const p = game.pal;
    const ww = game.ww, wh = game.wh, T = TILE;
    const key = game.levelIndex + ':' + ww + 'x' + wh;
    waterG.clear();
    if (waterKey !== key) {
      waterKey = key;
      waterBaseG.clear();
      // vertical depth gradient as 28 strips (top->bot palette stops)
      const stops = [[0, p.top], [0.28, p.mid], [0.65, p.deep], [1, p.bot]];
      const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      const cols = stops.map(([o, h]) => [o, toRgb(h)]);
      const N = 28;
      for (let i = 0; i < N; i++) {
        const y0 = (i / N) * wh, y1 = ((i + 1) / N) * wh;
        const t = (i + 0.5) / N;
        let seg = 0;
        while (seg < cols.length - 2 && t > cols[seg + 1][0]) seg++;
        const [o0, c0] = cols[seg], [o1, c1] = cols[seg + 1];
        const lt = clamp((t - o0) / (o1 - o0 || 1), 0, 1);
        const c = mix(c0, c1, lt);
        waterBaseG.rect(0, y0, ww, y1 - y0 + 0.5).fill({ color: (c[0] << 16) | (c[1] << 8) | c[2] | 0, alpha: 1 });
      }
    }
    // animated surface + caustics + motes (additive, redrawn per frame)
    const surf = T * 0.5;
    const srf = hexInt(p.surf), ray = hexInt(p.ray);
    waterG.moveTo(0, surf + Math.sin(0 + game.time * 1.3) * 3 + Math.sin(0 - game.time * 0.8) * 4);
    for (let x = 8; x <= ww; x += 8) {
      const y = surf + Math.sin(x * 0.03 + game.time * 1.3) * 3 + Math.sin(x * 0.011 - game.time * 0.8) * 4;
      waterG.lineTo(x, y);
    }
    waterG.stroke({ width: 2, color: srf, alpha: 0.4 });
    // surface glow band (4 fading strips)
    for (let i = 0; i < 4; i++) {
      const a = 0.24 * (1 - i / 4);
      waterG.rect(0, (i / 4) * T * 2.4, ww, T * 2.4 / 4 + 0.5).fill({ color: srf, alpha: a });
    }
    // caustic ribbons
    for (let i = 0; i < 9; i++) {
      const y = T * 1.1 + i * 13 + Math.sin(game.time * 0.7 + i) * 5;
      const a = 0.06 - i * 0.0055;
      if (a <= 0) continue;
      waterG.moveTo(0, y + Math.sin(0 + game.time * 1.1 + i * 0.6) * 4);
      for (let x = 24; x <= ww; x += 24) {
        waterG.lineTo(x, y + Math.sin(x * 0.02 + game.time * 1.1 + i * 0.6) * 4);
      }
      waterG.lineTo(ww, y + 7).lineTo(0, y + 7).closePath().fill({ color: ray, alpha: a });
    }
    // motes
    for (const m of game.motes) {
      const a = m.a * (0.5 + 0.5 * Math.sin(game.time * 1.4 + m.ph)) * 0.5;
      waterG.circle(m.x, m.y, m.s).fill({ color: 0xa0e6ff, alpha: a });
    }
  }

  // ---- per-act ruin silhouettes (rebuilt per level) ----
  function drawBackground() {
    const ww = game.ww, wh = game.wh;
    const key = game.levelIndex + ':' + ww + 'x' + wh;
    if (bgKey === key) return;
    bgKey = key;
    bgG.clear();
    const floor = wh - TILE;
    const dark = 0x162842;
    const act = game.levelIndex;
    const poly = (pts, a) => {
      bgG.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) bgG.lineTo(pts[i], pts[i + 1]);
      bgG.closePath().fill({ color: dark, alpha: a });
    };
    if (act === 0) {
      const pts = [0, floor];
      for (let x = 0; x <= ww; x += ww / 7) {
        pts.push(x + ww / 14, floor - 60 - (x % 3) * 26, x + ww / 7, floor - 10);
      }
      pts.push(ww, wh, 0, wh);
      poly(pts, 0.5);
    } else if (act === 1) {
      for (let i = 0; i < 4; i++) {
        const cx = ww * (0.15 + i * 0.24);
        bgG.moveTo(cx + 90, floor - 40);
        bgG.arc(cx, floor - 40, 90, 0, Math.PI, true);
        bgG.lineTo(cx - 90, floor).lineTo(cx + 90, floor).closePath().fill({ color: dark, alpha: 0.42 });
      }
    } else if (act === 2) {
      bgG.rect(ww * 0.1, floor - 210, ww * 0.7, 18).fill({ color: dark, alpha: 0.5 });
      poly([ww * 0.08, floor - 210, ww * 0.45, floor - 268, ww * 0.82, floor - 210], 0.5);
      for (let i = 0; i < 7; i++) {
        const x = ww * 0.12 + i * (ww * 0.66 / 6);
        const hh = 150 + (i % 2) * 40;
        bgG.rect(x, floor - hh, 22, hh).rect(x - 3, floor - hh, 28, 8).fill({ color: dark, alpha: 0.5 });
      }
      bgG.rect(ww * 0.09, floor - 24, ww * 0.72, 10).rect(ww * 0.07, floor - 14, ww * 0.76, 10).fill({ color: dark, alpha: 0.5 });
      // fallen column (rotated) — its own child container
      if (!bgLayer._fallen) {
        const f = new PIXI.Graphics();
        bgLayer.addChild(f);
        bgLayer._fallen = f;
      }
      const f = bgLayer._fallen;
      f.clear();
      f.position.set(ww * 0.5, floor - 18); f.rotation = 0.12;
      f.rect(0, 0, 150, 18).fill({ color: dark, alpha: 0.5 });
    } else if (act === 3) {
      bgG.rect(ww * 0.2, floor - 200, ww * 0.6, 16).fill({ color: dark, alpha: 0.44 });
      for (let i = 0; i < 5; i++) {
        const x = ww * 0.22 + i * (ww * 0.52 / 4);
        bgG.rect(x, floor - 170, 20, 170).fill({ color: dark, alpha: 0.44 });
      }
      poly([ww * 0.5, floor - 170, ww * 0.44, floor - 90, ww * 0.56, floor - 110], 0.44);
    } else if (act === 4) {
      let x = ww * 0.05;
      while (x < ww * 0.95) {
        const bw = 40 + (x % 5) * 12, bh = 90 + ((x / 30) % 5) * 44;
        bgG.rect(x, floor - bh, bw, bh).rect(x + bw * 0.4, floor - bh - 22, 4, 22).fill({ color: dark, alpha: 0.46 });
        for (let wy = floor - bh + 12; wy < floor - 14; wy += 20) {
          for (let wx = x + 6; wx < x + bw - 6; wx += 14) {
            bgG.rect(wx, wy, 5, 8).fill({ color: 0x8cbfeb, alpha: 0.12 });
          }
        }
        x += bw + 14;
      }
    } else if (act === 5) {
      bgG.moveTo(ww * 0.2, floor - 40);
      bgG.quadraticCurveTo(ww * 0.5, floor - 210, ww * 0.8, floor - 40);
      bgG.lineTo(ww * 0.8, floor).lineTo(ww * 0.2, floor).closePath().fill({ color: dark, alpha: 0.45 });
      bgG.rect(ww * 0.48, floor - 300, 12, 260).fill({ color: dark, alpha: 0.45 });
    } else if (act === 6) {
      for (let i = 0; i < 5; i++) {
        const x = ww * 0.14 + i * (ww * 0.6 / 4);
        bgG.moveTo(x + 46, floor - 120);
        bgG.arc(x, floor - 120, 46, 0, Math.PI, true);
        bgG.lineTo(x - 46, floor).lineTo(x + 46, floor).closePath().fill({ color: dark, alpha: 0.44 });
      }
      bgG.rect(ww * 0.44, floor - 150, ww * 0.12, 150).fill({ color: dark, alpha: 0.44 });
    } else {
      for (let i = 0; i < 8; i++) {
        const x = ww * (0.08 + i * 0.11), hh = 140 + (i % 3) * 70;
        poly([x, floor, x + 18, floor - hh, x + 40, floor - hh * 0.55, x + 56, floor], 0.46);
      }
      poly([ww * 0.46, floor, ww * 0.5, floor - 300, ww * 0.56, floor - 150, ww * 0.6, floor], 0.46);
      for (let i = 0; i < 8; i++) {
        const x = ww * (0.08 + i * 0.11), hh = 140 + (i % 3) * 70;
        poly([x + 18, floor - hh, x + 24, floor - hh * 0.5, x + 30, floor - hh * 0.7], 0.10);
      }
    }
    if (bgLayer._fallen && act !== 2) bgLayer._fallen.clear();
    bgLayer.alpha = 0.82;
  }

  // ---- rock: baked per level as one big Graphics ----
  let rockKey = '';
  function drawRock() {
    const key = game.levelIndex + ':' + game.ww + 'x' + game.wh;
    if (rockKey === key) return;
    rockKey = key;
    rockG.clear();
    const T = TILE, w = game.w, h = game.h, map = game.map;
    const rockAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && map[y][x] === '#';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!rockAt(x, y)) continue;
      const bx = x * T, by = y * T;
      const d = clamp(by / game.wh, 0, 1);
      const cr = Math.round(9 - d * 6), cg = Math.round(24 - d * 14), cb = Math.round(41 - d * 24);
      rockG.rect(bx, by, T, T).fill({ color: (cr << 16) | (cg << 8) | cb, alpha: 1 });
      rockG.rect(bx, by + 6, T, T - 6).fill({ color: 0x020810, alpha: 0.5 });
      const wUp = !rockAt(x, y - 1), wL = !rockAt(x - 1, y);
      const wR = !rockAt(x + 1, y), wD = !rockAt(x, y + 1);
      if (wUp) {
        // rim light: 3 fading strips + bright line
        rockG.rect(bx, by, T, 4).fill({ color: 0x8cd7ff, alpha: 0.37 });
        rockG.rect(bx, by + 4, T, 4).fill({ color: 0x8cd7ff, alpha: 0.22 });
        rockG.rect(bx, by + 8, T, 4).fill({ color: 0x8cd7ff, alpha: 0.08 });
        rockG.rect(bx, by, T, 1.5).fill({ color: 0xd4f6ff, alpha: 0.6 });
      }
      if (wL) rockG.rect(bx, by, 1.5, T).fill({ color: 0x69bef0, alpha: 0.32 });
      if (wR) rockG.rect(bx + T - 1.5, by, 1.5, T).fill({ color: 0x50a0d7, alpha: 0.22 });
      if (wD) rockG.rect(bx, by + T - 2, T, 2).fill({ color: 0x030a14, alpha: 0.85 });
      const hsh = (x * 73 + y * 151) % 11;
      if (hsh < 3) {
        rockG.rect(bx + 5 + hsh * 5, by + 8 + hsh * 3, 2.5, 2.5)
          .fill({ color: hsh === 0 ? 0x96e8ff : 0x78c8eb, alpha: hsh === 0 ? 0.11 : 0.06 });
      }
      if (hsh === 7) rockG.circle(bx + 15, by + 17, 1.6).fill({ color: 0x78ffdc, alpha: 0.12 });
      if (!rockAt(x, y) || rockAt(x, y - 1)) continue;
      // bounce light on water above the face
      rockG.rect(x * T, y * T - 18, T, 9).fill({ color: 0x5fb9eb, alpha: 0.03 });
      rockG.rect(x * T, y * T - 9, T, 9).fill({ color: 0x5fb9eb, alpha: 0.08 });
    }
  }

  // ---- god rays ----
  function drawGodRays() {
    rayG.clear();
    const p = game.pal, ray = hexInt(p.ray);
    const reach = game.wh * 0.8;
    for (let i = 0; i < 7; i++) {
      const base = (i / 7) * game.ww + TILE * 2;
      const sway = Math.sin(game.time * 0.22 + i * 1.7) * 42;
      const wTop = 26 + (i % 3) * 15;
      const wBot = wTop * 3.4;
      const a = 0.05 + 0.018 * Math.sin(game.time * 0.5 + i);
      // vertical alpha falloff in 5 bands (1.7a -> 0.5a -> 0)
      const bands = [[0, 0.2, a * 1.7], [0.2, 0.5, a * 1.1], [0.5, 0.75, a * 0.35], [0.75, 1, a * 0.12]];
      for (const [t0, t1, al] of bands) {
        const y0 = t0 * reach, y1 = t1 * reach;
        const s0 = sway * t0, s1 = sway * t1;
        const wt0 = lerp(wTop, wBot, t0), wt1 = lerp(wTop, wBot, t1);
        rayG.moveTo(base - wt0 / 2 + s0, y0).lineTo(base + wt0 / 2 + s0, y0)
          .lineTo(base + s1 + wt1 / 2, y1).lineTo(base + s1 - wt1 / 2, y1)
          .closePath().fill({ color: ray, alpha: al });
      }
    }
  }

  function drawCurrents() {
    currentG.clear();
    for (const c of game.currents) {
      const bx = c.x * TILE, by = c.y * TILE;
      const ph = (game.time * 1.6 + c.ph) % 1;
      for (let k = 0; k < 3; k++) {
        const t = (ph + k / 3) % 1;
        let x = bx + TILE / 2, y = by + TILE / 2;
        if (c.dx === '^') y = by + TILE * (1 - t);
        if (c.dx === 'v') y = by + TILE * t;
        if (c.dx === '<') x = bx + TILE * (1 - t);
        if (c.dx === '>') x = bx + TILE * t;
        currentG.circle(x, y, 2.2).fill({ color: 0x78c8ff, alpha: 0.28 * (1 - Math.abs(t - 0.5) * 2) });
      }
    }
  }

  // ---- lights (mirrors main.js drawPlayer's litSources) ----
  const lights = [];
  function computeLights() {
    lights.length = 0;
    const f = game.form;
    if (f) {
      let lr = f.key === 'angler' ? 200 : f.key === 'jelly' ? 138 : 154;
      lights.push({ x: game.px, y: game.py, r: game.power ? lr * 1.05 : lr, c: game.power ? game.power.color : f.glow });
    }
    if (game.flare) lights.push({ x: game.flare.x, y: game.flare.y, r: game.flare.r * 1.6, c: '#ffd88a' });
    for (const b of game.bulbs) lights.push({ x: b.x, y: b.y, r: 55, c: '#6fd0ff' });
    for (const v of game.vipers) lights.push({ x: v.x, y: v.y, r: 68 + (v.charge > 0 ? 48 : 0), c: v.charge > 0 ? '#ff5a72' : '#8f7dff' });
    for (const l of game.lanterns) lights.push({ x: l.x, y: l.y, r: 64 + (l.pulse || 0) * 26, c: '#ffd06a' });
    for (const s of game.stingers) lights.push({ x: s.x, y: s.y + 12, r: s.reach > 12 ? 66 + s.reach : 42, c: s.reach > 12 ? '#ff5c96' : '#7fa8bd' });
    if (game.goal) lights.push({ x: game.goal.x, y: game.goal.y, r: 110, c: '#ffcf7a' });
    for (const c of game.checkpoints) if (c.on) lights.push({ x: c.x, y: c.y, r: 60, c: '#78ffdc' });
    const b = game.boss;
    if (b && !(b.dead && b.dieT > 1.6)) lights.push({ x: b.x, y: b.y, r: b.enraged ? 250 : 205, c: b.enraged ? '#ff5d73' : '#ff9db0' });
    for (const mb of game.minibosses) if (!(mb.dead && mb.dieT > 1.6)) lights.push({ x: mb.x, y: mb.y, r: mb.r * 4, c: mb.glow });
  }

  function drawHidden() {
    hiddenG.clear();
    const lit = (x, y) => {
      for (const l of lights) {
        const d = Math.hypot(x - l.x, y - l.y);
        if (d < l.r) return clamp(1 - d / l.r, 0, 1);
      }
      return 0;
    };
    for (let y = 0; y < game.h; y++) for (let x = 0; x < game.w; x++) {
      if (game.map[y][x] !== 'h') continue;
      const bx = x * TILE, by = y * TILE;
      const l = lit(bx + TILE / 2, by + TILE / 2);
      if (l <= 0.02) {
        const tw = 0.05 + 0.05 * Math.sin(game.time * 2 + x * 0.7 + y);
        hiddenG.rect(bx + 6, by + 6, TILE - 12, TILE - 12).fill({ color: 0x8cbeff, alpha: tw });
        continue;
      }
      hiddenG.rect(bx, by, TILE, TILE).fill({ color: 0x42311a, alpha: 0.55 + l * 0.45 });
      hiddenG.rect(bx, by, TILE, TILE).fill({ color: 0x160f07, alpha: 0.6 });
      hiddenG.rect(bx, by, TILE, 2.5).fill({ color: 0xffce78, alpha: 0.14 + l * 0.3 });
      hiddenG.rect(bx + 0.5, by + 0.5, TILE - 1, TILE - 1).stroke({ width: 1, color: 0xffe4ac, alpha: l * 0.35 });
    }
  }

  function drawAnemones() {
    anemG.clear();
    const t = game.time;
    for (const run of (game.anemoneRuns || [])) {
      const cx = run.x * TILE + TILE / 2;
      const top = run.y0 * TILE;
      const bot = (run.y1 + 1) * TILE;
      const len = bot - top;
      for (let i = 0; i < 6; i++) {
        const off = (i - 2.5) * 4.2;
        const seed = run.x * 1.7 + i * 0.9;
        const amp = 7 + (i % 3) * 3;
        const steps = 14;
        // strand: 3 color bands along its length (pink->violet->fade)
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps, t1 = (s + 1) / steps;
          const x0 = cx + off + Math.sin(t * 1.5 + seed + t0 * 3.2) * amp * t0;
          const y0 = top + len * t0;
          const x1 = cx + off + Math.sin(t * 1.5 + seed + t1 * 3.2) * amp * t1;
          const y1 = top + len * t1;
          const al = t0 < 0.55 ? lerp(0.5, 0.3, t0 / 0.55) : lerp(0.3, 0.02, (t0 - 0.55) / 0.45);
          const col = t0 < 0.55 ? 0xff7dc3 : 0xd250ff;
          anemG.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2.2 - (i % 2) * 0.5, color: col, alpha: al, cap: 'round' });
        }
        const tx = cx + off + Math.sin(t * 1.5 + seed + 3.2) * amp;
        anemG.circle(tx, bot, 1.8).fill({ color: 0xffc8eb, alpha: 0.55 });
        if (i % 2 === 0) {
          const bt = 0.4 + 0.2 * Math.sin(t + seed);
          anemG.circle(cx + off + Math.sin(t * 1.5 + seed + bt * 3.2) * amp * bt, top + len * bt, 1.4)
            .fill({ color: 0xffaae1, alpha: 0.35 });
        }
      }
    }
  }

  function drawCheckpoints() {
    checkG.clear();
    for (const c of game.checkpoints) {
      const pu = c.on ? 1 : 0.5 + 0.5 * Math.sin(game.time * 2 + c.ph);
      const col = c.on ? 0x78ffdc : 0x78c8ff;
      glow(TEX_SOFT, c.x, c.y, 26 * pu, col, 0.5 * pu);
      checkG.circle(c.x, c.y, 9 + pu * 2).stroke({ width: 1.6, color: col, alpha: 0.6 * pu });
    }
  }

  function drawGoal() {
    goalG.clear();
    const g0 = game.goal;
    if (!g0) return;
    const pu = 0.8 + 0.2 * Math.sin(game.time * 1.6);
    glow(TEX_FADE, g0.x, g0.y, 90 * pu, 0xffebaa, 0.75);
    glow(TEX_SOFT, g0.x, g0.y, 90 * pu * 0.55, 0xffbe5a, 0.5);
    for (let i = 0; i < 14; i++) {
      const t = (game.time * 0.5 + i / 14) % 1;
      goalG.circle(g0.x + Math.sin(t * 6 + i) * 8, g0.y + 24 - t * 70, 2.4 * (1 - t) + 0.6)
        .fill({ color: 0xffe1a0, alpha: 0.5 * (1 - t) });
    }
    goalG.circle(g0.x, g0.y, 15 + pu * 3).stroke({ width: 2, color: 0xfff0c8, alpha: 0.85 });
  }

  function drawPlankton() {
    plankG.clear();
    for (const p of game.plankton) {
      if (p.got) continue;
      const pu = 0.6 + 0.4 * Math.sin(game.time * 2.2 + p.ph);
      const y = p.y + Math.sin(game.time * 1.1 + p.ph) * 3;
      glow(TEX_SOFT, p.x, y, 16 * pu, 0x5af0b4, 0.85 * pu);
      plankG.circle(p.x, y, 2.6).fill({ color: 0xeafff5, alpha: 0.95 });
    }
  }

  function drawBulbs() {
    bulbG.clear();
    for (const b of game.bulbs) {
      const pu = 0.7 + 0.3 * Math.sin(game.time * 0.9 + b.ph);
      glow(TEX_FADE, b.x, b.y, 46 * pu, 0x78dcff, 0.5 * pu);
      bulbG.circle(b.x, b.y, 2.4).fill({ color: 0xd2f5ff, alpha: 0.9 });
    }
  }

  function drawUrchins() {
    urchG.clear();
    const t = game.time;
    for (const u of game.urchins) {
      const pu = 1 + 0.07 * Math.sin(t * 3 + u.ph);
      glow(TEX_SOFT, u.x, u.y, 24, 0xff5f7d, 0.38);
      urchG.position.set(0, 0);
      const cx = u.x, cy = u.y;
      urchG.moveTo(0, 0); // no-op anchor keeps clear() cheap; removed below
      urchG.closePath();
      // primary spines
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + Math.sin(t * 0.9 + u.ph) * 0.22;
        const sway = Math.sin(t * 2.2 + i * 0.7 + u.ph) * 0.1;
        const r0 = 4.5 * pu, r1 = (13.5 + (i % 3) * 1.6) * pu;
        const mx = cx + Math.cos(a + sway) * (r0 + r1) * 0.55;
        const my = cy + Math.sin(a + sway) * (r0 + r1) * 0.55;
        urchG.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
          .quadraticCurveTo(mx, my, cx + Math.cos(a + sway * 2) * r1, cy + Math.sin(a + sway * 2) * r1)
          .stroke({ width: 2.1, color: 0xff6984, alpha: 0.95, cap: 'round' });
        urchG.circle(cx + Math.cos(a + sway * 2) * r1, cy + Math.sin(a + sway * 2) * r1, 0.95 * pu)
          .fill({ color: 0xffbecd, alpha: 0.95 });
      }
      // secondary spines
      for (let i = 0; i < 16; i++) {
        const a = ((i + 0.5) / 16) * Math.PI * 2 + Math.sin(t * 0.9 + u.ph) * 0.22;
        urchG.moveTo(cx + Math.cos(a) * 4 * pu, cy + Math.sin(a) * 4 * pu)
          .lineTo(cx + Math.cos(a) * 8.5 * pu, cy + Math.sin(a) * 8.5 * pu)
          .stroke({ width: 1.1, color: 0xff506e, alpha: 0.55 });
      }
      // shell
      urchG.circle(cx, cy, 6.4 * pu).fill({ color: 0x3a0710, alpha: 1 });
      urchG.circle(cx - 1.5 * pu, cy - 1.5 * pu, 3 * pu).fill({ color: 0x6d1322, alpha: 0.8 });
      // tube feet
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.4;
        const w = 1 + Math.sin(t * 4 + i) * 0.5;
        urchG.moveTo(cx + Math.cos(a) * 5 * pu, cy + Math.sin(a) * 5 * pu)
          .lineTo(cx + Math.cos(a) * (5 + w) * pu, cy + Math.sin(a) * (5 + w) * pu)
          .stroke({ width: 1, color: 0xffaabe, alpha: 0.8 });
      }
      urchG.circle(cx, cy, 2.1 * pu).fill({ color: 0xff96aa, alpha: 0.95 });
      urchG.circle(cx - 0.7, cy - 0.7, 0.8).fill({ color: 0xffeff4, alpha: 0.9 });
    }
  }

  function drawStingers() {
    stingG.clear();
    const t = game.time;
    for (const s of game.stingers) {
      const ext = s.reach / 40;
      const hot = ext > 0.3;
      const cx = s.x, cy = s.y;
      // bulb
      stingG.ellipse(cx, cy - 4, 11, 8).fill({ color: hot ? 0x3a0a1e : 0x12222c, alpha: 1 });
      stingG.ellipse(cx - 2, cy - 6, 6, 4).fill({ color: hot ? 0xa02650 : 0x2c4a5c, alpha: 0.9 });
      stingG.ellipse(cx, cy - 4, 11, 8).stroke({ width: 1.5, color: hot ? 0xff8cb4 : 0x9bcdE6, alpha: hot ? 1 : 0.9 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.3;
        stingG.circle(cx + Math.cos(a) * 6, cy - 4 + Math.sin(a) * 4, 1.1)
          .fill({ color: hot ? 0xffb4cd : 0x96bed2, alpha: hot ? 0.8 : 0.5 });
      }
      // tentacles
      const n = 9;
      for (let i = 0; i < n; i++) {
        const ox = -10 + i * (20 / (n - 1));
        const len = 6 + ext * (30 + (i % 3) * 7);
        const sw = Math.sin(t * 2.4 + i * 0.9 + s.ph) * (2 + ext * 6);
        stingG.moveTo(cx + ox, cy + 2)
          .bezierCurveTo(cx + ox + sw * 0.3, cy + 2 + len * 0.4, cx + ox + sw, cy + 2 + len * 0.7, cx + ox + sw * 0.7, cy + 2 + len)
          .stroke({ width: 1.4, color: hot ? 0xff78a8 : 0x9bcde6, alpha: hot ? 0.5 + ext * 0.5 : 0.6, cap: 'round' });
        for (let k = 1; k <= 3; k++) {
          const tt = k / 3.4;
          stingG.circle(cx + ox + sw * tt * 0.8, cy + 2 + len * tt, 0.95)
            .fill({ color: hot ? 0xffc8de : 0x96bed2, alpha: hot ? 0.95 : 0.5 });
        }
      }
      if (ext > 0.02 && ext < 0.34) {
        glow(TEX_SOFT, cx, cy + 6, 20 + ext * 40, 0xff96be, 0.5 - ext * 1.2);
      }
    }
  }

  function drawLanterns() {
    lanG.clear();
    const t = game.time;
    for (const l of game.lanterns) {
      const stunned = l.stun > 0;
      const pu = l.pulse || 0.7;
      const bob = Math.sin(t * 1.8 + l.ph) * 3;
      const cx = l.x, cy = l.y + bob;
      const rot = Math.sin(t * 1.1 + l.ph) * 0.12 + (stunned ? t * 3 : 0);
      const dir = l.dir;
      const P = (x, y) => [cx + (Math.cos(rot) * x - Math.sin(rot) * y) * dir, cy + (Math.sin(rot) * x + Math.cos(rot) * y)];
      // tail
      const lwag = Math.sin(t * 8 + l.ph) * 3.2;
      const tp = [[-11, 0], [-19, -5.5 + lwag], [-16, lwag * 0.4], [-19, 5.5 + lwag]].map(([x, y]) => P(x, y));
      lanG.moveTo(tp[0][0], tp[0][1]);
      for (let i = 1; i < tp.length; i++) lanG.lineTo(tp[i][0], tp[i][1]);
      lanG.closePath().fill({ color: 0xffc86e, alpha: 0.3 });
      // body
      lanG.ellipse(cx, cy, 13, 6.4).fill({ color: 0x4a3710, alpha: 1 });
      lanG.ellipse(cx, cy, 13, 6.4).stroke({ width: 1.7, color: 0xffd682, alpha: 0.95 });
      // dorsal fin
      const d0 = P(-4, -6), dc = P(1, -12), d1 = P(6, -6);
      lanG.moveTo(d0[0], d0[1]).quadraticCurveTo(dc[0], dc[1], d1[0], d1[1]).stroke({ width: 1.2, color: 0xffd682, alpha: 0.7 });
      // photophore ladder
      for (let i = 0; i < 7; i++) {
        const [x, y] = P(-9 + i * 3, 5.2);
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 + i * 0.8 + l.ph));
        lanG.circle(x, y, 1.35).fill({ color: 0xffe296, alpha: a * (stunned ? 0.3 : 1) });
      }
      // big lantern
      const [lx, ly] = P(8, 3.5);
      glow(TEX_SOFT, lx, ly, 20 * pu, 0xffcd6e, 0.85 * (stunned ? 0.25 : 1));
      lanG.circle(lx, ly, 2.3).fill({ color: 0xfff3d2, alpha: 1 });
      // eye + teeth
      const [ex, ey] = P(8, -2.6);
      lanG.circle(ex, ey, 2.6).fill({ color: 0xf4ecd8, alpha: 1 });
      const [px2, py2] = P(8.8, -2.6);
      lanG.circle(px2, py2, 1.3).fill({ color: 0x171002, alpha: 1 });
      for (let i = 0; i < 3; i++) {
        const a = P(11 + i * 1.7, -1), b = P(11.6 + i * 1.7, 1.4), c = P(12.5 + i * 1.7, -1);
        lanG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1]).closePath().fill({ color: 0xfff6e2, alpha: 1 });
      }
      if (stunned) {
        for (let i = 0; i < 4; i++) {
          const a = t * 5 + i * 1.6;
          lanG.circle(l.x + Math.cos(a) * 17, l.y - 18 + Math.sin(a) * 5, 2).fill({ color: 0xffe1a0, alpha: 0.75 });
        }
      }
    }
  }

  function drawFish() {
    fishG.clear();
    const t = game.time;
    for (const f of game.fish) {
      const stunned = f.stun > 0;
      const fspd = stunned ? 0 : 1;
      const bob = Math.sin(t * 3 + f.ph) * (1.1 + 1.5 * fspd);
      const wag = Math.sin(t * (7 + 5 * fspd) + f.ph) * (1.4 + 2.6 * fspd);
      const fwave = Math.sin(t * 8 + f.ph) * 0.05 * fspd;
      const cx = f.x, cy = f.y + bob;
      const rot = fdir(fwave) ;
      const P = (x, y) => {
        const xr = x * Math.cos(rot) - y * Math.sin(rot);
        const yr = x * Math.sin(rot) + y * Math.cos(rot);
        return [cx + xr * f.dir, cy + yr];
      };
      glow(TEX_SOFT, cx, cy, 28, stunned ? 0x8cc8ff : 0xff6e82, stunned ? 0.28 : 0.24);
      // caudal fin
      const cp = [[-16, 0], [-26, -7 + wag], [-22, wag * 0.4], [-26, 7 + wag]].map(([x, y]) => P(x, y));
      fishG.moveTo(cp[0][0], cp[0][1]);
      for (let i = 1; i < cp.length; i++) fishG.lineTo(cp[i][0], cp[i][1]);
      fishG.closePath().fill({ color: stunned ? 0x96c8f0 : 0xff788c, alpha: 0.35 });
      for (let i = -1; i <= 1; i++) {
        const a = P(-17, 0), b = P(-25, i * 4.5 + wag);
        fishG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 0.8, color: stunned ? 0xb4dcfa : 0xffa9b9, alpha: 0.5 });
      }
      // dorsal + anal fins
      let q0 = P(-8, -6), qc = P(-2, -13), q1 = P(5, -6.5);
      fishG.moveTo(q0[0], q0[1]).quadraticCurveTo(qc[0], qc[1], q1[0], q1[1]).closePath().fill({ color: stunned ? 0x96c8f0 : 0xff788c, alpha: 0.3 });
      q0 = P(-9, 6); qc = P(-3, 12); q1 = P(3, 6.5);
      fishG.moveTo(q0[0], q0[1]).quadraticCurveTo(qc[0], qc[1], q1[0], q1[1]).closePath().fill({ color: stunned ? 0x96c8f0 : 0xff788c, alpha: 0.3 });
      // body
      const bp0 = P(15, 0);
      fishG.moveTo(bp0[0], bp0[1]);
      const curves = [[4, -8.5, -8, -5.5], [-14, -3.2, -18, 0], [-14, 3.2, -8, 5.5], [4, 8.5, 15, 0]];
      for (const [cx1, cy1, x2, y2] of curves) {
        const c = P(cx1, cy1), e = P(x2, y2);
        fishG.quadraticCurveTo(c[0], c[1], e[0], e[1]);
      }
      fishG.closePath().fill({ color: stunned ? 0x8cb9e1 : 0xb02840, alpha: stunned ? 0.9 : 0.95 });
      fishG.stroke({ width: 1.7, color: stunned ? 0xb4e1ff : 0xff91a5, alpha: 0.95 });
      // lateral line + chevrons
      const ll0 = P(-14, 0), llc = P(0, -1.5), ll1 = P(14, 0);
      fishG.moveTo(ll0[0], ll0[1]).quadraticCurveTo(llc[0], llc[1], ll1[0], ll1[1]).stroke({ width: 0.9, color: stunned ? 0xd2f0ff : 0xff96aa, alpha: 0.4 });
      for (let i = 0; i < 4; i++) {
        const x = -9 + i * 5;
        const a = P(x + 2, -4.5), b = P(x - 2, 0), c = P(x + 2, 4.5);
        fishG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1]).stroke({ width: 0.9, color: stunned ? 0xd2f0ff : 0xff96aa, alpha: 0.4 });
      }
      // photophores
      for (let i = 0; i < 5; i++) {
        const [x, y] = P(-11 + i * 4.6, 4.6);
        fishG.circle(x, y, 1).fill({ color: stunned ? 0xc8ebff : 0xffc896, alpha: stunned ? 0.6 : 0.85 });
      }
      // gape + fangs
      const g0 = P(6, -4.5), gc1 = P(17, -3), g1 = P(15, 1.5), gc2 = P(11, 6), g2 = P(5.5, 5);
      fishG.moveTo(g0[0], g0[1]).quadraticCurveTo(gc1[0], gc1[1], g1[0], g1[1]).quadraticCurveTo(gc2[0], gc2[1], g2[0], g2[1]).closePath().fill({ color: 0x1a0308, alpha: 1 });
      const fangs = [[8, -4, 9.2, 0.6, 10.6, -3.8], [12, -3, 13, 0.2, 14.2, -2.8], [8.5, 5, 9.6, 1.6, 10.8, 4.8]];
      for (const [ax, ay, bx2, by2, cx2, cy2] of fangs) {
        const A = P(ax, ay), B = P(bx2, by2), C = P(cx2, cy2);
        fishG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).lineTo(C[0], C[1]).closePath().fill({ color: 0xfff2f4, alpha: 1 });
      }
      // eye
      const [ex, ey] = P(8.5, -3.4);
      fishG.circle(ex, ey, 2.4).fill({ color: 0xffffff, alpha: 1 });
      const [px2, py2] = P(9.2, -3.4);
      fishG.circle(px2, py2, 1.15).fill({ color: 0x111111, alpha: 1 });
      const [hx, hy] = P(7.7, -4.2);
      fishG.circle(hx, hy, 0.6).fill({ color: 0xffffff, alpha: 0.95 });
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const a = t * 4 + i * 2.1;
          fishG.circle(f.x + Math.cos(a) * 16, f.y - 16 + Math.sin(a) * 5, 2).fill({ color: 0x96dcff, alpha: 0.7 });
        }
      }
    }
  }
  // helper: fish rotate uses ctx.rotate AFTER scale(dir,1); approximate with
  // combined rotation (direction handled in P())
  function fdir(wave) { return wave; }

  function drawVipers() {
    vipG.clear();
    const t = game.time;
    for (const v of game.vipers) {
      const stunned = v.stun > 0;
      const lunging = v.charge > 0;
      const glowAmt = v.glow || 0.6;
      const cx = v.x, cy = v.y;
      const rot = Math.atan2(v.vy, v.vx) * (Math.abs(v.vx) + Math.abs(v.vy) > 6 ? 0.9 : 0.15) + Math.sin(t * 10 + v.ph) * 0.045;
      const P = (x, y) => {
        const xr = x * Math.cos(rot) - y * Math.sin(rot);
        const yr = x * Math.sin(rot) + y * Math.cos(rot);
        return [cx + xr * v.dir, cy + yr];
      };
      if (lunging) glow(TEX_SOFT, cx, cy, 34, 0x9682ff, 0.4);
      // dorsal spines
      for (let i = 0; i < 7; i++) {
        const x = -12 + i * 3.6;
        const a = P(x, -5), b = P(x - 1.4, -11 - (i % 2) * 2);
        vipG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 1.2, color: 0xa08cff, alpha: 0.5 * glowAmt + 0.2, cap: 'round' });
      }
      // tail
      const wag = Math.sin(t * 11 + v.ph) * (lunging ? 4.5 : 2.5);
      const tp = [[-16, 0], [-27, -8 + wag], [-22, wag * 0.4], [-27, 8 + wag]].map(([x, y]) => P(x, y));
      vipG.moveTo(tp[0][0], tp[0][1]);
      for (let i = 1; i < tp.length; i++) vipG.lineTo(tp[i][0], tp[i][1]);
      vipG.closePath().fill({ color: 0x9682ff, alpha: 0.3 + glowAmt * 0.2 });
      // body
      const bp0 = P(18, 0);
      vipG.moveTo(bp0[0], bp0[1]);
      const curves = [[6, -6.5, -8, -4.6], [-14, -2.6, -18, 0], [-14, 2.6, -8, 4.6], [6, 6.5, 18, 0]];
      for (const [cx1, cy1, x2, y2] of curves) {
        const c = P(cx1, cy1), e = P(x2, y2);
        vipG.quadraticCurveTo(c[0], c[1], e[0], e[1]);
      }
      vipG.closePath().fill({ color: stunned ? 0x3a3458 : 0x241a44, alpha: 1 });
      vipG.stroke({ width: 1.7, color: lunging ? 0xff6e82 : 0xaf9bff, alpha: lunging ? 0.75 + glowAmt * 0.25 : 0.7 + glowAmt * 0.3 });
      // photophore ladder
      for (let i = 0; i < 6; i++) {
        const [x, y] = P(-13 + i * 4.4, 3.9);
        vipG.circle(x, y, 1.05).fill({ color: 0xbeafff, alpha: 0.5 + glowAmt * 0.5 });
      }
      // huge eye
      const [ex, ey] = P(11, -2.2);
      vipG.circle(ex, ey, 3.6).fill({ color: stunned ? 0x8f9bc0 : 0xe8e2ff, alpha: 1 });
      const [px2, py2] = P(12, -2.2);
      vipG.circle(px2, py2, 1.9).fill({ color: 0x0b0618, alpha: 1 });
      const [hx, hy] = P(9.8, -3.3);
      vipG.circle(hx, hy, 0.95).fill({ color: 0xffffff, alpha: 0.95 });
      // needle jaw
      const fangs = [[8, -2.6, 5.5], [11, -1.8, 6.5], [14, -0.8, 5], [9, 3.6, -5], [12.5, 2.8, -6]];
      for (const [fx, fy, fl] of fangs) {
        const A = P(fx - 1.1, fy), B = P(fx, fy + fl), C = P(fx + 1.1, fy);
        vipG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).lineTo(C[0], C[1]).closePath().fill({ color: 0xf2eeff, alpha: 1 });
      }
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const a = t * 4 + i * 2.1;
          vipG.circle(v.x + Math.cos(a) * 18, v.y - 19 + Math.sin(a) * 5, 2.1).fill({ color: 0xb4a5ff, alpha: 0.8 });
        }
      }
    }
  }

  function drawPowerups() {
    powerG.clear();
    const POW = { overcharge: '#ffd166', storm: '#c77dff', aegis: '#7ae7ff' };
    for (const p of game.powerups) {
      if (p.got) continue;
      const col = hexInt(POW[p.type] || '#ffd166');
      const pu = 1 + 0.12 * Math.sin(game.time * 3 + p.ph);
      glow(TEX_SOFT, p.x, p.y, 26 * pu, col, 0.6);
      const rot = game.time * 0.9 + p.ph;
      const P = (x, y) => [p.x + x * Math.cos(rot) - y * Math.sin(rot), p.y + x * Math.sin(rot) + y * Math.cos(rot)];
      powerG.moveTo(...P(Math.cos(0) * 12, Math.sin(0) * 12));
      for (let i = 1; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rr = i % 2 ? 6 : 12;
        const [x, y] = P(Math.cos(a) * rr, Math.sin(a) * rr);
        powerG.lineTo(x, y);
      }
      powerG.closePath().stroke({ width: 2.5, color: col, alpha: 0.95 });
      powerG.circle(p.x, p.y, 3).fill({ color: 0xffffff, alpha: 0.85 });
    }
  }

  function drawRings() {
    ringG.clear();
    for (const r of game.rings) {
      const t = clamp(r.t / r.life, 0, 1);
      const rad = lerp(r.r0, r.r1, t * (2 - t));
      ringG.circle(r.x, r.y, rad).stroke({ width: 2.4 * (1 - t) + 0.4, color: hexInt(r.c), alpha: (1 - t) * 0.55 });
      ringG.circle(r.x, r.y, rad).stroke({ width: 8 * (1 - t), color: hexInt(r.c), alpha: (1 - t) * 0.16 });
    }
  }

  function drawShots() {
    shotG.clear();
    for (const sh of game.shots) {
      const a = clamp(sh.life * 2, 0, 1);
      const col = hexInt(sh.c);
      if (sh.type === 'zap') {
        const ang = Math.atan2(sh.vy, sh.vx);
        shotG.ellipse(sh.x, sh.y, sh.r * 4, sh.r).fill({ color: col, alpha: 0.9 * a });
        shotG.ellipse(sh.x, sh.y, sh.r * 2, sh.r * 0.5).fill({ color: 0xffffff, alpha: 0.9 * a });
        // rotate the ellipse to velocity direction via a second draw is skipped:
        // v8 ellipse has no rotation; approximate with a thick round-cap line
        shotG.moveTo(sh.x - Math.cos(ang) * sh.r * 3.4, sh.y - Math.sin(ang) * sh.r * 3.4)
          .lineTo(sh.x + Math.cos(ang) * sh.r * 3.4, sh.y + Math.sin(ang) * sh.r * 3.4)
          .stroke({ width: sh.r * 1.6, color: col, alpha: 0.9 * a, cap: 'round' });
        shotG.moveTo(sh.x - Math.cos(ang) * sh.r * 1.6, sh.y - Math.sin(ang) * sh.r * 1.6)
          .lineTo(sh.x + Math.cos(ang) * sh.r * 1.6, sh.y + Math.sin(ang) * sh.r * 1.6)
          .stroke({ width: sh.r * 0.8, color: 0xffffff, alpha: 0.9 * a, cap: 'round' });
      } else if (sh.type === 'bolt') {
        glow(TEX_TIGHT, sh.x, sh.y, sh.r * 2.2, col, 0.8 * a);
      } else {
        shotG.circle(sh.x, sh.y, sh.r).fill({ color: col, alpha: 0.85 * a });
        shotG.circle(sh.x, sh.y, sh.r * 0.4).fill({ color: 0xffffff, alpha: 0.6 * a });
      }
    }
    for (const es of game.eshots) {
      const a = clamp(es.life / 2.2, 0, 1);
      glow(TEX_TIGHT, es.x, es.y, es.r * 2.4, hexInt(es.c || '#ff5d73'), 0.9 * a);
      shotG.circle(es.x, es.y, es.r * 0.5).fill({ color: 0xffffff, alpha: 0.7 * a });
    }
    for (const o of game.bossOrbs) {
      glow(TEX_TIGHT, o.x, o.y, 16, 0xff5d73, 0.9);
      shotG.circle(o.x, o.y, 4).fill({ color: 0xffd0d8, alpha: 0.95 });
    }
  }

  function drawMiniBosses() {
    miniG.clear();
    const t = game.time;
    for (const mb of game.minibosses) {
      if (mb.dead && mb.dieT > 1.6) continue;
      const alpha = mb.dead ? clamp(1 - mb.dieT / 1.6, 0, 1) : 1;
      const scl = mb.dead ? 1 + mb.dieT * 0.4 : 1;
      const cx = mb.x, cy = mb.y;
      const col = hexInt(mb.color), glw = hexInt(mb.glow);
      const P = (x, y, rot = 0) => {
        const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot);
        return [cx + xr * scl, cy + yr * scl];
      };
      glow(TEX_SOFT, cx, cy, mb.r * 2.2, glw, 0.4 * alpha);
      if (mb.kind === 'crab') {
        for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 3; i++) {
          const base = (i - 1) * 9;
          const sw = Math.sin(t * 6 + i + (s > 0 ? 0 : 1.5)) * 6;
          const a = P(s * 12, base), b = P(s * (22 + sw), base + 12 + sw * 0.4);
          miniG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 3, color: col, alpha: 0.8 * alpha, cap: 'round' });
        }
        for (let s = -1; s <= 1; s += 2) {
          const open = 0.3 + 0.3 * Math.sin(t * 4 + (s > 0 ? 1 : 0));
          const rot = s * (0.4 + open);
          const c = P(s * 24, -6, rot);
          miniG.ellipse(c[0], c[1], 10 * scl, 6 * scl).fill({ color: col, alpha: 0.9 * alpha });
          const p1 = P(s * 24 + 6, -10, rot), p2 = P(s * 24 + 14, -12, rot);
          const p3 = P(s * 24 + 6, -2, rot), p4 = P(s * 24 + 14, 0, rot);
          miniG.moveTo(p1[0], p1[1]).lineTo(p2[0], p2[1]).moveTo(p3[0], p3[1]).lineTo(p4[0], p4[1])
            .stroke({ width: 2, color: glw, alpha: 0.7 * alpha });
        }
        miniG.ellipse(cx, cy - 4 * scl, 22 * scl, 16 * scl).fill({ color: col, alpha: 0.95 * alpha });
        miniG.ellipse(cx, cy + 6 * scl, 22 * scl, 8 * scl).fill({ color: 0x5a3a1a, alpha: 0.9 * alpha });
        miniG.ellipse(cx, cy, 22 * scl, 16 * scl).stroke({ width: 2, color: glw, alpha: 0.6 * alpha });
        for (let i = -1; i <= 1; i++) {
          const a = P(i * 8, -14), b = P(i * 8, 12);
          miniG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 1, color: 0x3a2410, alpha: 0.6 * alpha });
        }
        for (let s = -1; s <= 1; s += 2) { const e = P(s * 6, -8); miniG.circle(e[0], e[1], 3 * scl).fill({ color: 0x0a0602, alpha }); }
      } else if (mb.kind === 'manta') {
        const flap = Math.sin(t * 2.4) * 0.5;
        const rot = mb.ph + Math.PI / 2;
        for (let s = -1; s <= 1; s += 2) {
          const A = P(0, -6, rot);
          const c1 = P(s * 30, -14 - flap * 22, rot), e1 = P(s * 40, 6 + flap * 10, rot);
          const c2 = P(s * 20, 10, rot), e2 = P(0, 12, rot);
          miniG.moveTo(A[0], A[1]).quadraticCurveTo(c1[0], c1[1], e1[0], e1[1]).quadraticCurveTo(c2[0], c2[1], e2[0], e2[1])
            .closePath().fill({ color: col, alpha: 0.85 * alpha }).stroke({ width: 1.5, color: glw, alpha: 0.5 * alpha });
        }
        miniG.ellipse(cx, cy, 9 * scl, 20 * scl).fill({ color: col, alpha: 0.9 * alpha });
        const tb0 = P(0, 18, rot), tbc = P(Math.sin(t * 3) * 8, 34, rot), tb1 = P(0, 48, rot);
        miniG.moveTo(tb0[0], tb0[1]).quadraticCurveTo(tbc[0], tbc[1], tb1[0], tb1[1]).stroke({ width: 2, color: col, alpha: 0.8 * alpha });
        for (let s = -1; s <= 1; s += 2) { const e = P(s * 4, -12, rot); miniG.circle(e[0], e[1], 2.4 * scl).fill({ color: 0x0a1226, alpha }); }
      } else if (mb.kind === 'urchin') {
        const rot = mb.spin * 0.8;
        miniG.moveTo(0, 0).closePath();
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const len = mb.r + 8 + Math.sin(t * 3 + i) * 4;
          const A = P(Math.cos(a) * mb.r * 0.6, Math.sin(a) * mb.r * 0.6, rot);
          const B = P(Math.cos(a) * len, Math.sin(a) * len, rot);
          miniG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).stroke({ width: 3, color: col, alpha: 0.9 * alpha, cap: 'round' });
        }
        miniG.circle(cx, cy, mb.r * 0.7 * scl).fill({ color: glw, alpha: 0.9 * alpha });
        miniG.circle(cx, cy, mb.r * 0.28 * scl).fill({ color: 0x3a0812, alpha });
      } else if (mb.kind === 'moray') {
        const rot = mb.ph;
        const seg = 10; const spine = [];
        for (let i = 0; i <= seg; i++) {
          const tt = i / seg;
          const bx = -tt * 60, by = Math.sin(t * 4 - tt * 4) * 10 * (1 - tt * 0.3);
          spine.push(P(bx, by, rot));
        }
        for (let pass = 0; pass < 2; pass++) {
          miniG.moveTo(spine[0][0], spine[0][1]);
          for (const p of spine) miniG.lineTo(p[0], p[1]);
          miniG.stroke({ width: pass ? 3 * scl : 14 * scl, color: pass ? glw : col, alpha: pass ? 0.5 * alpha : 0.9 * alpha, cap: 'round' });
        }
        const jaw = 0.4 + 0.4 * Math.sin(t * 5);
        const j0 = P(6, 0, rot), j1 = P(22, -6 - jaw * 6, rot), j2 = P(22, 6 + jaw * 6, rot);
        miniG.moveTo(j0[0], j0[1]).lineTo(j1[0], j1[1]).lineTo(j2[0], j2[1]).closePath().fill({ color: 0x0a1408, alpha: 0.95 * alpha });
        for (let i = -1; i <= 1; i++) {
          const a = P(8, i * 3, rot), b = P(14, i * 4, rot), c = P(8, i * 3 + 2, rot);
          miniG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1]).closePath().fill({ color: 0xeaffd0, alpha: 0.9 * alpha });
        }
        const e0 = P(2, -5, rot), e1 = P(2.6, -5, rot);
        miniG.circle(e0[0], e0[1], 2.4 * scl).fill({ color: 0xffffff, alpha });
        miniG.circle(e1[0], e1[1], 1.2 * scl).fill({ color: 0x0a1408, alpha });
      } else if (mb.kind === 'king') {
        const rot = mb.ph;
        const kwag = Math.sin(t * 6 + mb.seed) * 7;
        const tp = [[-26, 0], [-44, -14 + kwag], [-40, kwag * 0.4], [-44, 14 + kwag]].map(([x, y]) => P(x, y, rot));
        miniG.moveTo(tp[0][0], tp[0][1]);
        for (let i = 1; i < tp.length; i++) miniG.lineTo(tp[i][0], tp[i][1]);
        miniG.closePath().fill({ color: col, alpha: 0.8 * alpha });
        const bc = P(0, 0, rot);
        miniG.ellipse(bc[0], bc[1], 30 * scl, 17 * scl).fill({ color: col, alpha: 0.95 * alpha });
        miniG.ellipse(bc[0], bc[1], 30 * scl, 17 * scl).stroke({ width: 2, color: glw, alpha: 0.6 * alpha });
        for (let i = -2; i <= 2; i++) {
          const lx = i * 9, ly = -16 + Math.abs(i) * 2;
          const s0 = P(lx, -12, rot), s1 = P(lx, ly - 6, rot);
          miniG.moveTo(s0[0], s0[1]).lineTo(s1[0], s1[1]).stroke({ width: 1, color: glw, alpha: 0.5 * alpha });
          const lp = P(lx, ly - 8, rot);
          glow(TEX_TIGHT, lp[0], lp[1], 7 * scl, 0xfff6d0, (0.7 + 0.3 * Math.sin(t * 5 + i)) * alpha);
        }
        const e0 = P(18, -4, rot), e1 = P(19.5, -4, rot);
        miniG.circle(e0[0], e0[1], 4 * scl).fill({ color: 0xffffff, alpha });
        miniG.circle(e1[0], e1[1], 2 * scl).fill({ color: 0x0a0602, alpha });
        const j0 = P(24, 4, rot), jc = P(34, 8, rot), j1 = P(24, 12, rot);
        miniG.moveTo(j0[0], j0[1]).quadraticCurveTo(jc[0], jc[1], j1[0], j1[1]).closePath().fill({ color: 0x0a0602, alpha: 0.9 * alpha });
      } else if (mb.kind === 'kraken') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 7 - 0.5) * 2.2;
          const bx = Math.sin(a) * 16;
          const ph = t * 2 + i * 0.8;
          const len = 34 + (i % 2) * 12;
          const A = P(bx, 10), B = P(bx + Math.sin(ph) * 12, 10 + len * 0.6), C = P(bx + Math.sin(ph + 1) * 18, 10 + len);
          miniG.moveTo(A[0], A[1]).quadraticCurveTo(B[0], B[1], C[0], C[1])
            .stroke({ width: (6 - Math.abs(a)) * scl, color: col, alpha: (0.7 - Math.abs(a) * 0.1) * alpha, cap: 'round' });
        }
        const hc = P(0, -8);
        miniG.ellipse(hc[0], hc[1], 22 * scl, 24 * scl).fill({ color: col, alpha: 0.9 * alpha });
        miniG.ellipse(hc[0], hc[1] - 6 * scl, 16 * scl, 14 * scl).fill({ color: glw, alpha: 0.5 * alpha });
        for (let s = -1; s <= 1; s += 2) {
          const e = P(s * 9, -10);
          miniG.ellipse(e[0], e[1], 5 * scl, 6 * scl).fill({ color: 0xffffff, alpha: 0.9 * alpha });
          miniG.ellipse(e[0], e[1], 1.6 * scl, 4 * scl).fill({ color: 0x12041a, alpha });
        }
      } else if (mb.kind === 'serpent') {
        const rot = mb.ph;
        const seg = 14; const spine = [];
        for (let i = 0; i <= seg; i++) {
          const tt = i / seg;
          const bx = -tt * 78, by = Math.sin(t * 3 - tt * 5) * 12 * (1 - tt * 0.2);
          spine.push(P(bx, by, rot));
        }
        for (let i = 1; i < seg; i += 2) {
          const p = spine[i];
          const a = P(-((i / seg) * 78), Math.sin(t * 3 - (i / seg) * 5) * 12 * (1 - (i / seg) * 0.2) - 9, rot);
          const b = P(-((i / seg) * 78) - 10, Math.sin(t * 3 - (i / seg) * 5) * 12 * (1 - (i / seg) * 0.2), rot);
          miniG.moveTo(p[0], p[1]).lineTo(a[0], a[1]).lineTo(b[0], b[1]).closePath().fill({ color: glw, alpha: 0.4 * alpha });
        }
        for (let pass = 0; pass < 2; pass++) {
          miniG.moveTo(spine[0][0], spine[0][1]);
          for (const p of spine) miniG.lineTo(p[0], p[1]);
          miniG.stroke({ width: pass ? 3 * scl : 11 * scl, color: pass ? glw : col, alpha: pass ? 0.5 * alpha : 0.92 * alpha, cap: 'round' });
        }
        const hc = P(6, 0, rot), e0 = P(10, -3, rot), e1 = P(10.8, -3, rot);
        miniG.ellipse(hc[0], hc[1], 12 * scl, 8 * scl).fill({ color: col, alpha: 0.95 * alpha });
        miniG.circle(e0[0], e0[1], 2.4 * scl).fill({ color: 0xffffff, alpha });
        miniG.circle(e1[0], e1[1], 1.2 * scl).fill({ color: 0x04241c, alpha });
      }
    }
  }

  function drawBoss() {
    bossG.clear();
    const b = game.boss;
    if (!b) return;
    if (b.dead && b.dieT > 1.6) return;
    const t = game.time;
    const alpha = b.dead ? clamp(1 - b.dieT / 1.6, 0, 1) : 1;
    const scl = b.dead ? 1.5 + b.dieT * 0.5 : 1.5;
    const bbeat = 1 + Math.sin(t * 2.4) * 0.05;
    const rot = b.ph + Math.PI / 2;
    const sx = scl * bbeat, sy = scl * (2 - bbeat);
    const P = (x, y) => {
      const xr = x * sx, yr = y * sy;
      return [b.x + xr * Math.cos(rot) - yr * Math.sin(rot), b.y + xr * Math.sin(rot) + yr * Math.cos(rot)];
    };
    glow(TEX_SOFT, b.x, b.y, 90 * scl, b.enraged ? 0xff5d73 : 0xff9db0, 0.4 * alpha);
    // tentacles
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.5;
      const bx = Math.sin(a) * 26;
      const len = 120 + (i % 2) * 34;
      const sway = 10 + (i % 3) * 5;
      const ph = t * 2.2 + i * 0.9;
      const A = P(bx, 26), B = P(bx + Math.sin(ph) * sway * 0.5, 26 + len * 0.55), C = P(bx + Math.sin(ph + 1.1) * sway, 26 + len);
      bossG.moveTo(A[0], A[1]).quadraticCurveTo(B[0], B[1], C[0], C[1])
        .stroke({ width: (5 - Math.abs(a)) * scl, color: 0xb06a86, alpha: (0.55 - Math.abs(a) * 0.12) * alpha, cap: 'round' });
      glow(TEX_TIGHT, C[0], C[1], 2.4 * scl, 0xff9db0, 0.5 * alpha);
    }
    // bell
    const m = P(-44, 20);
    bossG.moveTo(m[0], m[1]);
    let c1 = P(-52, -30), c2 = P(-26, -54), e1 = P(0, -54);
    bossG.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e1[0], e1[1]);
    c1 = P(26, -54); c2 = P(52, -30); e1 = P(44, 20);
    bossG.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e1[0], e1[1]);
    const qc = P(0, 34), qe = P(-44, 20);
    bossG.quadraticCurveTo(qc[0], qc[1], qe[0], qe[1]).closePath()
      .fill({ color: b.enraged ? 0x5a1830 : 0x3a1430, alpha: 0.95 * alpha })
      .stroke({ width: 2.5, color: b.enraged ? 0xff8fa3 : 0xff9db0, alpha: 0.85 * alpha });
    // jaw + fangs
    const j0 = P(-26, 6), jc = P(0, 40), j1 = P(26, 6), jc2 = P(0, 18);
    bossG.moveTo(j0[0], j0[1]).quadraticCurveTo(jc[0], jc[1], j1[0], j1[1]).quadraticCurveTo(jc2[0], jc2[1], j0[0], j0[1])
      .closePath().fill({ color: 0x0a0208, alpha: 0.95 });
    for (let i = -3; i <= 3; i++) {
      const fx = i * 7;
      const A = P(fx - 2.5, 8), B = P(fx + 2.5, 8), C = P(fx, 8 + (i % 2 ? 9 : 13));
      bossG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).lineTo(C[0], C[1]).closePath().fill({ color: 0xfff0f4, alpha: 0.9 * alpha });
    }
    for (const sgn of [-1, 1]) {
      const e = P(sgn * 18, -22), p = P(sgn * 18 + sgn * 2, -22);
      bossG.circle(e[0], e[1], 7 * scl).fill({ color: 0xffffff, alpha: 0.9 });
      bossG.circle(p[0], p[1], 3.4 * scl).fill({ color: 0x0a0208, alpha });
    }
    // lure
    const r0 = P(0, -52), rc = P(6, -80), r1 = P(2, -96);
    bossG.moveTo(r0[0], r0[1]).quadraticCurveTo(rc[0], rc[1], r1[0], r1[1]).stroke({ width: 2, color: 0xffd0d8, alpha: 0.8 });
    glow(TEX_TIGHT, r1[0], r1[1], 22 * scl, 0xfff2c0, 0.95 * alpha);
  }

  function drawPlayer() {
    playerG.clear();
    const f = game.form;
    if (!f) return;
    const t = game.time;
    const cx = game.px, cy = game.py;
    const speed = Math.hypot(game.vx, game.vy);
    const fglow = hexInt(f.glow), fbody = hexInt(f.body);
    // trail
    for (const tr of game.trail) {
      const a = 1 - tr.t / 0.55;
      glow(TEX_SOFT, tr.x, tr.y, f.r * (0.6 + a * 1.2) * 1.6, fglow, a * 0.07);
    }
    // power aura
    if (game.power) {
      const pc = hexInt(game.power.color);
      const pr = f.r * (1.6 + 0.12 * Math.sin(t * 6));
      glow(TEX_SOFT, cx, cy, pr, pc, 0.12);
      playerG.circle(cx, cy, f.r * 1.35).stroke({ width: 1.2, color: pc, alpha: 0.4 });
    }
    const aim = game.aim;
    const VS = f.key === 'eel' ? 1.3 : f.key === 'angler' ? 1.24 : 1.2;
    const P = (x, y, rot = aim) => {
      const xr = x * VS, yr = y * VS;
      return [cx + xr * Math.cos(rot) - yr * Math.sin(rot), cy + xr * Math.sin(rot) + yr * Math.cos(rot)];
    };

    if (f.key === 'eel') {
      glow(TEX_SOFT, cx, cy, 26 * VS, fglow, 0.2);
      const seg = 11, pitch = 6.2;
      const spine = [];
      for (let i = 0; i <= seg; i++) {
        const tt = i / seg;
        const wob = Math.sin(t * 8 - i * 0.75) * (2.0 + speed * 0.014) * tt;
        spine.push({ p: P(-i * pitch, wob), r: (7.4 * (1 - tt * 0.78) + 1.1) * VS });
      }
      const tl = spine[spine.length - 1];
      // caudal
      const c1 = { x: tl.p[0] - 10 * Math.cos(aim), y: tl.p[1] - 10 * Math.sin(aim) };
      const perpX = -Math.sin(aim), perpY = Math.cos(aim);
      playerG.moveTo(tl.p[0] + 1.5 * Math.cos(aim), tl.p[1] + 1.5 * Math.sin(aim));
      playerG.lineTo(c1.x + perpX * -7.6 * VS, c1.y + perpY * -7.6 * VS);
      playerG.lineTo(c1.x, c1.y);
      playerG.lineTo(c1.x + perpX * 7.6 * VS, c1.y + perpY * 7.6 * VS);
      playerG.closePath().fill({ color: fglow, alpha: 0.3 });
      // dorsal/anal membranes
      const mem = (side, off) => {
        playerG.moveTo(spine[0].p[0] + perpX * side * spine[0].r, spine[0].p[1] + perpY * side * spine[0].r);
        for (const s of spine) playerG.lineTo(s.p[0] + perpX * side * (s.r + off), s.p[1] + perpY * side * (s.r + off));
        for (let i = spine.length - 1; i >= 0; i--) playerG.lineTo(spine[i].p[0] + perpX * side * spine[i].r, spine[i].p[1] + perpY * side * spine[i].r);
        playerG.closePath().fill({ color: fglow, alpha: 0.15 });
      };
      mem(-1, 3.4); mem(1, 2.6);
      // body silhouette
      playerG.moveTo(spine[0].p[0] + perpX * -spine[0].r, spine[0].p[1] + perpY * -spine[0].r);
      for (const s of spine) playerG.lineTo(s.p[0] + perpX * -s.r, s.p[1] + perpY * -s.r);
      for (let i = spine.length - 1; i >= 0; i--) playerG.lineTo(spine[i].p[0] + perpX * spine[i].r, spine[i].p[1] + perpY * spine[i].r);
      playerG.closePath().fill({ color: 0x04141c, alpha: 1 });
      // volume sheen (approx: body-color spine strokes)
      playerG.moveTo(spine[0].p[0] + perpX * -spine[0].r * 0.5, spine[0].p[1] + perpY * -spine[0].r * 0.5);
      for (const s of spine) playerG.lineTo(s.p[0] + perpX * -s.r * 0.5, s.p[1] + perpY * -s.r * 0.5);
      playerG.stroke({ width: 2.5 * VS, color: fbody, alpha: 0.16 });
      // chevrons
      for (let i = 1; i < spine.length - 2; i++) {
        const s = spine[i];
        const A = { x: s.p[0] + Math.cos(aim) * 2.2 + perpX * -s.r * 0.82, y: s.p[1] + Math.sin(aim) * 2.2 + perpY * -s.r * 0.82 };
        const B = s.p;
        const C = { x: s.p[0] + Math.cos(aim) * 2.2 + perpX * s.r * 0.82, y: s.p[1] + Math.sin(aim) * 2.2 + perpY * s.r * 0.82 };
        playerG.moveTo(A.x, A.y).lineTo(B[0], B[1]).lineTo(C.x, C.y).stroke({ width: 1, color: fbody, alpha: 0.26 });
      }
      // lateral line (dashed approximation)
      for (let i = 0; i < spine.length - 1; i++) {
        const a0 = spine[i], a1 = spine[i + 1];
        playerG.moveTo(a0.p[0] + perpX * -a0.r * 0.18, a0.p[1] + perpY * -a0.r * 0.18)
          .lineTo((a0.p[0] + a1.p[0]) / 2 + perpX * -(a0.r + a1.r) * 0.09, (a0.p[1] + a1.p[1]) / 2 + perpY * -(a0.r + a1.r) * 0.09)
          .stroke({ width: 1, color: fglow, alpha: 0.45 });
      }
      // glowing belly
      playerG.moveTo(spine[0].p[0] + perpX * spine[0].r, spine[0].p[1] + perpY * spine[0].r);
      for (const s of spine) playerG.lineTo(s.p[0] + perpX * s.r, s.p[1] + perpY * s.r);
      playerG.stroke({ width: 1.6, color: fglow, alpha: 0.85, cap: 'round' });
      // flank speckles
      for (let i = 2; i < spine.length - 1; i += 2) {
        const s = spine[i];
        playerG.circle(s.p[0] - Math.cos(aim) + perpX * -s.r * 0.45, s.p[1] - Math.sin(aim) + perpY * -s.r * 0.45, 0.85)
          .fill({ color: fglow, alpha: 0.5 });
      }
      // pectoral fin
      const pf = [[-0.5, 4], [-4, 11.5], [-9.5, 12.5], [-5.5, 6.5], [-0.5, 6.5]].map(([x, y]) => P(x, y));
      playerG.moveTo(pf[0][0], pf[0][1]);
      playerG.quadraticCurveTo(pf[1][0], pf[1][1], pf[2][0], pf[2][1]);
      playerG.quadraticCurveTo(pf[3][0], pf[3][1], pf[4][0], pf[4][1]);
      playerG.closePath().fill({ color: fglow, alpha: 0.26 });
      // gill slits
      for (let i = 0; i < 3; i++) {
        const x = -2.4 - i * 2.7;
        const A = P(x, -4.6), C = P(x - 1.8, 0), B = P(x, 4.8);
        playerG.moveTo(A[0], A[1]).quadraticCurveTo(C[0], C[1], B[0], B[1]).stroke({ width: 1.2, color: fglow, alpha: 0.7 });
      }
      // head
      const hc = P(2.4, 0), hc2 = P(3.2, 0.8);
      playerG.ellipse(hc[0], hc[1], 9.2 * VS, 7.1 * VS).fill({ color: fbody, alpha: 0.95 });
      playerG.ellipse(hc2[0], hc2[1], 7.4 * VS, 5.5 * VS).fill({ color: 0x04141c, alpha: 1 });
      const jl0 = P(10.6, 1.8), jl1 = P(3.6, 5.2);
      playerG.moveTo(jl0[0], jl0[1]).lineTo(jl1[0], jl1[1]).stroke({ width: 1, color: fglow, alpha: 0.55 });
      for (let i = 0; i < 4; i++) {
        const A = P(9.6 - i * 1.9, 3.4), B = P(9 - i * 1.9, 5.1), C = P(8.2 - i * 1.9, 3.4);
        playerG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).lineTo(C[0], C[1]).closePath().fill({ color: 0xdff8f0, alpha: 1 });
      }
      // barbels
      const b0 = P(9.5, 2.6), b1 = P(13.5, 5 + Math.sin(t * 5) * 0.9), b2 = P(16, 7.2);
      playerG.moveTo(b0[0], b0[1]).quadraticCurveTo(b1[0], b1[1], b2[0], b2[1]).stroke({ width: 1, color: fglow, alpha: 0.6 });
      const b3 = P(9.5, 3.4), b4 = P(12.5, 6.5 + Math.cos(t * 4.4) * 0.9), b5 = P(14, 9.2);
      playerG.moveTo(b3[0], b3[1]).quadraticCurveTo(b4[0], b4[1], b5[0], b5[1]).stroke({ width: 1, color: fglow, alpha: 0.6 });
      // eye
      const e0 = P(5.8, -2.8), e1 = P(6.5, -2.8), e2 = P(4.9, -3.7);
      playerG.circle(e0[0], e0[1], 2.6 * VS).fill({ color: 0xeafff9, alpha: 1 });
      playerG.circle(e1[0], e1[1], 1.35 * VS).fill({ color: 0x03201b, alpha: 1 });
      playerG.circle(e2[0], e2[1], 0.7 * VS).fill({ color: 0xffffff, alpha: 0.95 });
    } else if (f.key === 'angler') {
      glow(TEX_SOFT, cx, cy, 34 * VS, fglow, 0.18);
      // caudal
      const tp = [[-14, 0], [-27, -11], [-21.5, 0], [-27, 11]].map(([x, y]) => P(x, y));
      playerG.moveTo(tp[0][0], tp[0][1]);
      for (let i = 1; i < tp.length; i++) playerG.lineTo(tp[i][0], tp[i][1]);
      playerG.closePath().fill({ color: fglow, alpha: 0.3 });
      for (let i = -2; i <= 2; i++) {
        const a = P(-15, 0), b = P(-25, i * 4.2);
        playerG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 0.8, color: fglow, alpha: 0.45 });
      }
      // dorsal spines
      for (let i = 0; i < 6; i++) {
        const x = -11 + i * 3.9;
        const a = P(x, -10), b = P(x - 1.8, -16.5 - (i % 3) * 2.6);
        playerG.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 1.4, color: fbody, alpha: 0.75, cap: 'round' });
      }
      // pectoral fan
      const pf0 = P(2, 5), pfc1 = P(-3, 15), pfe = P(-11, 17), pfc2 = P(-7, 8.5), pfe2 = P(2, 8);
      playerG.moveTo(pf0[0], pf0[1]).quadraticCurveTo(pfc1[0], pfc1[1], pfe[0], pfe[1])
        .quadraticCurveTo(pfc2[0], pfc2[1], pfe2[0], pfe2[1]).closePath().fill({ color: fglow, alpha: 0.22 });
      // body
      const bc = P(0, 0);
      playerG.ellipse(bc[0], bc[1], 17 * VS, 12.2 * VS).fill({ color: 0x241705, alpha: 1 });
      playerG.ellipse(bc[0], bc[1] - 4 * VS, 14 * VS, 6 * VS).fill({ color: fbody, alpha: 0.14 });
      const mott = [[-8, -5, 4.2], [-2, -7, 3.1], [-11, 2, 3.6], [-4, 4, 4.6], [3, -6, 2.8], [6, 5, 3.2]];
      for (const [mx, my, mr] of mott) {
        const M = P(mx, my);
        playerG.ellipse(M[0], M[1], mr * VS, mr * 0.7 * VS).fill({ color: fbody, alpha: 0.13 });
      }
      playerG.ellipse(bc[0], bc[1], 17 * VS, 12.2 * VS).stroke({ width: 1.7, color: fglow, alpha: 0.7 });
      // operculum
      const o0 = P(4.5, -8.5), oc = P(8.5, 0), o1 = P(4.5, 9);
      playerG.moveTo(o0[0], o0[1]).quadraticCurveTo(oc[0], oc[1], o1[0], o1[1]).stroke({ width: 1.3, color: fglow, alpha: 0.55 });
      const o2 = P(2.5, -7.5), oc2 = P(6, 0), o3 = P(2.5, 8);
      playerG.moveTo(o2[0], o2[1]).quadraticCurveTo(oc2[0], oc2[1], o3[0], o3[1]).stroke({ width: 1.3, color: fglow, alpha: 0.55 });
      // photophores
      for (let i = 0; i < 6; i++) { const q = P(-12 + i * 4.2, 8.4); playerG.circle(q[0], q[1], 1.1).fill({ color: fglow, alpha: 0.8 }); }
      for (let i = 0; i < 5; i++) { const q = P(-11 + i * 4.4, -9.6); playerG.circle(q[0], q[1], 0.9).fill({ color: fglow, alpha: 0.45 }); }
      // jaw
      const j0 = P(4, -7.5), jc1 = P(22, -5), j1 = P(19.5, 1.2), jc2 = P(13, 10), j2 = P(3, 8.8);
      playerG.moveTo(j0[0], j0[1]).quadraticCurveTo(jc1[0], jc1[1], j1[0], j1[1]).quadraticCurveTo(jc2[0], jc2[1], j2[0], j2[1])
        .closePath().fill({ color: 0x120a01, alpha: 1 });
      playerG.moveTo(j0[0], j0[1]).quadraticCurveTo(jc1[0], jc1[1], j1[0], j1[1]).stroke({ width: 1, color: fglow, alpha: 0.35 });
      const teeth = [[6, -5.6, 3.4], [9.6, -4.4, 3.9], [13.2, -2.4, 3.1], [16, 0.4, 2.4], [7.2, 6.8, -3.4], [11, 5.6, -3.8], [14.2, 3.4, -2.8]];
      for (const [tx, ty, th] of teeth) {
        const A = P(tx - 1.7, ty), B = P(tx, ty + th), C = P(tx + 1.7, ty);
        playerG.moveTo(A[0], A[1]).lineTo(B[0], B[1]).lineTo(C[0], C[1]).closePath().fill({ color: 0xfff6dd, alpha: 1 });
      }
      const big1 = [[8.4, -5.8], [9.9, -1.2], [11.4, -5.4]].map(([x, y]) => P(x, y));
      playerG.moveTo(big1[0][0], big1[0][1]).lineTo(big1[1][0], big1[1][1]).lineTo(big1[2][0], big1[2][1]).closePath().fill({ color: 0xfffbe9, alpha: 1 });
      const big2 = [[9.4, 7.2], [10.8, 2.6], [12.2, 6.6]].map(([x, y]) => P(x, y));
      playerG.moveTo(big2[0][0], big2[0][1]).lineTo(big2[1][0], big2[1][1]).lineTo(big2[2][0], big2[2][1]).closePath().fill({ color: 0xfffbe9, alpha: 1 });
      // eye
      const e0 = P(5.6, -6.4), e1 = P(6.6, -6.4), e2 = P(4.4, -7.7);
      playerG.circle(e0[0], e0[1], 4.1 * VS).fill({ color: 0xf7f2df, alpha: 1 });
      playerG.circle(e1[0], e1[1], 2.1 * VS).fill({ color: 0x140c02, alpha: 1 });
      playerG.circle(e2[0], e2[1], 1.1 * VS).fill({ color: 0xffffff, alpha: 0.95 });
      // illicium + esca
      const lx = 22 + Math.sin(t * 2.1) * 2.6, ly = -25 + Math.cos(t * 1.6) * 2.6;
      const i0 = P(6.5, -11.5), ic = P(19, -22), ie = P(lx, ly);
      playerG.moveTo(i0[0], i0[1]).quadraticCurveTo(ic[0], ic[1], ie[0], ie[1]).stroke({ width: 1.9, color: fbody, alpha: 0.95 });
      for (let i = 1; i <= 3; i++) {
        const tt = i / 4;
        const bx = (1 - tt) * (1 - tt) * 6.5 + 2 * (1 - tt) * tt * 19 + tt * tt * lx;
        const by = (1 - tt) * (1 - tt) * -11.5 + 2 * (1 - tt) * tt * -22 + tt * tt * ly;
        const Q = P(bx, by);
        playerG.circle(Q[0], Q[1], 1.2 * VS).fill({ color: fglow, alpha: 0.9 });
      }
      glow(TEX_TIGHT, ie[0], ie[1], 16 * VS, 0xfff6d2, 0.85);
      for (let i = 0; i < 5; i++) {
        const a = i * (Math.PI * 2 / 5) + t * 0.8;
        playerG.moveTo(ie[0] + Math.cos(a) * 3, ie[1] + Math.sin(a) * 3)
          .lineTo(ie[0] + Math.cos(a) * 7.5, ie[1] + Math.sin(a) * 7.5)
          .stroke({ width: 0.9, color: 0xffebb4, alpha: 0.7 });
      }
      playerG.circle(ie[0], ie[1], 3 * VS).fill({ color: 0xfffbe8, alpha: 1 });
    } else {
      // jelly: rotated aim+90°, no directional scale
      const rot = aim + Math.PI / 2;
      const PJ = (x, y) => [cx + (x * Math.cos(rot) - y * Math.sin(rot)) * VS, cy + (x * Math.sin(rot) + y * Math.cos(rot)) * VS];
      const sq = 1 + Math.sin(t * 3.0) * 0.13;
      const bw = 15.5 * sq * VS, bh = 11.5 / sq * VS;
      glow(TEX_SOFT, cx, cy, 30 * VS, fglow, 0.2);
      // tentacles
      for (let i = 0; i < 12; i++) {
        const ox = -13.5 + i * 2.45;
        const len = 30 + (i % 4) * 9;
        const sw = Math.sin(t * 2.5 + i * 0.7) * 7;
        const A = PJ(ox, 0), B = PJ(ox + sw * 0.4, len * 0.4), C = PJ(ox + sw, len * 0.72), D = PJ(ox + sw * 0.6, len);
        playerG.moveTo(A[0], A[1]).bezierCurveTo(B[0], B[1], C[0], C[1], D[0], D[1])
          .stroke({ width: 1.3, color: fglow, alpha: 0.45, cap: 'round' });
        for (let k = 1; k <= 3; k++) {
          const tt = k / 4;
          const Q = PJ(ox + sw * tt * 0.85, len * tt);
          playerG.circle(Q[0], Q[1], 0.9).fill({ color: fglow, alpha: 0.75 });
        }
      }
      // oral arms
      for (let i = 0; i < 4; i++) {
        const ox = -6 + i * 4;
        const sw = Math.sin(t * 2.2 + i * 1.1) * 5;
        const A = PJ(ox - 2.4, 0), B = PJ(ox + sw * 0.6 - 2, 12), C = PJ(ox + sw - 1.2, 21), D = PJ(ox + sw + 1.2, 21), E = PJ(ox + sw * 0.6 + 2.4, 12), F = PJ(ox + 2.4, 0);
        playerG.moveTo(A[0], A[1]).quadraticCurveTo(B[0], B[1], C[0], C[1]).lineTo(D[0], D[1]).quadraticCurveTo(E[0], E[1], F[0], F[1])
          .closePath().fill({ color: fbody, alpha: 0.4 });
        const G0 = PJ(ox, 1), G1 = PJ(ox + sw * 0.6, 12), G2 = PJ(ox + sw, 20);
        playerG.moveTo(G0[0], G0[1]).quadraticCurveTo(G1[0], G1[1], G2[0], G2[1]).stroke({ width: 0.9, color: fglow, alpha: 0.5 });
      }
      // bell
      const bell = () => {
        const m0 = PJ(-bw / VS, -1);
        playerG.moveTo(m0[0], m0[1]);
        const c1 = PJ(-bw / VS, -bh / VS * 2.15), c2 = PJ(bw / VS, -bh / VS * 2.15), e1 = PJ(bw / VS, -1);
        playerG.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e1[0], e1[1]);
        const lobes = 7;
        for (let i = 0; i <= lobes; i++) {
          const tt = i / lobes;
          const Q = PJ(bw / VS - 2 * (bw / VS) * tt, -1 + Math.sin(tt * Math.PI * lobes) * 2.6);
          playerG.lineTo(Q[0], Q[1]);
        }
        playerG.closePath();
        return playerG;
      };
      bell().fill({ color: 0x1a0a32, alpha: 0.9 });
      // radial canals
      for (let i = 0; i < 7; i++) {
        const tt = (i + 0.5) / 7;
        const A = PJ(0, -bh / VS * 1.5), B = PJ((-bw / VS + 2 * (bw / VS) * tt) * 0.5, -bh / VS * 0.9), C = PJ(-bw / VS + 2 * (bw / VS) * tt, -1.5);
        playerG.moveTo(A[0], A[1]).quadraticCurveTo(B[0], B[1], C[0], C[1]).stroke({ width: 1, color: fglow, alpha: 0.5 });
      }
      bell().stroke({ width: 1.9, color: fglow, alpha: 0.95 });
      // ocelli
      for (let i = 0; i < 8; i++) {
        const tt = (i + 0.5) / 8;
        const Q = PJ(-bw / VS + 2 * (bw / VS) * tt, -2.6);
        playerG.circle(Q[0], Q[1], 1.15).fill({ color: fglow, alpha: 0.95 });
      }
      // gonads + manubrium + highlight
      for (const [gx, gy] of [[-4.4, -7.5], [4.4, -7.5], [-2.4, -11.5], [2.4, -11.5]]) {
        const G = PJ(gx, gy);
        playerG.ellipse(G[0], G[1], 3.1 * VS, 2.4 * VS).fill({ color: fglow, alpha: 0.72 });
      }
      const m0 = PJ(0, -6), m1 = PJ(0, -1);
      playerG.moveTo(m0[0], m0[1]).lineTo(m1[0], m1[1]).stroke({ width: 1.6, color: fglow, alpha: 0.6 });
      const hl = PJ(-4.6, -13.4);
      playerG.ellipse(hl[0], hl[1], 2.6 * VS, 1.5 * VS).fill({ color: 0xffffff, alpha: 0.92 });
    }
    // flare ring
    if (game.flare) {
      const ft = game.flare.t / game.flare.life;
      ringG.circle(game.flare.x, game.flare.y, game.flare.r * (0.4 + ft * 1.2))
        .stroke({ width: 3 * (1 - ft) + 1, color: 0xffebb4, alpha: (1 - ft) * 0.8 });
    }
  }

  function drawParticles() {
    for (const p of game.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const rad = p.s * (0.5 + a * 0.7);
      particle(p.x, p.y, rad * 3.2, hexInt(p.c), a * 0.16);
      particle(p.x, p.y, rad, hexInt(p.c), a * 0.9);
    }
  }

  // ---- lighting: darkness + erase holes + colored tint ----
  function drawLighting(s, ox, oy) {
    const w = W(), h = H();
    darkG.clear();
    eraseN = 0;
    const lit = game.state === 'play' || game.state === 'actcard' || game.state === 'win' || game.state === 'ending';
    if (lit) {
      darkG.rect(0, 0, w, h).fill({ color: 0x01050e, alpha: 0.86 });
      for (const l of lights) {
        const x = ox + l.x * s, y = oy + l.y * s, r = l.r * s;
        // Canvas gradient stops 1 -> .72 -> 0; two stacked erase holes approximate it
        eraseHole(x, y, r, 0.72);
        eraseHole(x, y, r * 0.55, 0.55);
      }
    }
    if (darkRT.width !== Math.max(2, w) || darkRT.height !== Math.max(2, h)) darkRT.resize(Math.max(2, w), Math.max(2, h));
    darkSprite.width = w; darkSprite.height = h; darkSprite.visible = true;
    try { app.renderer.render({ container: darkBox, target: darkRT, clear: true }); }
    catch (e) { darkSprite.visible = false; }
    // colored light tint (additive)
    tintG.clear();
    for (const l of lights) {
      if (!l.c) continue;
      glowScreen(TEX_SOFT, ox + l.x * s, oy + l.y * s, l.r * s * 1.15, hexInt(l.c), 0.1);
    }
  }

  // screen-space glow sprites (tint layer)
  const tintPool = [];
  let tintN = 0;
  function glowScreen(tex, x, y, r, col, a) {
    if (a <= 0.004) return;
    let sp = tintPool[tintN];
    if (!sp) {
      sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      stage.addChildAt(sp, stage.getChildIndex(tintG) + 1);
      tintPool[tintN] = sp;
    }
    sp.texture = tex; sp.visible = true;
    sp.position.set(x, y);
    sp.width = sp.height = r * 2;
    sp.tint = col; sp.alpha = clamp(a, 0, 1);
    tintN++;
  }

  function drawVignette() {
    vignetteG.clear();
    const w = W(), h = H();
    // radial vignette approximated by concentric annulus bands (stroked circles)
    const cx = w / 2, cy = h / 2;
    const rIn = Math.min(w, h) * 0.33, rOut = Math.max(w, h) * 0.78;
    const N = 10;
    for (let i = 0; i < N; i++) {
      const rMid = lerp(rIn, rOut, (i + 0.5) / N);
      const band = (rOut - rIn) / N + 1;
      const a = 0.6 * Math.pow((i + 1) / N, 1.6) / N;
      vignetteG.circle(cx, cy, rMid).stroke({ width: band, color: 0x00020a, alpha: a });
    }
  }

  // ---- HUD ----
  const FORMS = {
    eel: { key: 'eel', name: 'EEL', num: 1, body: '#5ef2c8', glow: '#2affd5', ability: 'dash', abilityName: 'DASH' },
    angler: { key: 'angler', name: 'ANGLER', num: 2, body: '#ffd166', glow: '#ffb020', ability: 'flare', abilityName: 'LURE / FLARE' },
    jelly: { key: 'jelly', name: 'JELLY', num: 3, body: '#c77dff', glow: '#e0aaff', ability: 'pulse', abilityName: 'PULSE' },
  };
  const FORM_ORDER = ['eel', 'angler', 'jelly'];
  const POWERS = {
    overcharge: { color: '#ffd166', name: 'OVERCHARGE' },
    storm: { color: '#c77dff', name: 'STORM' },
    aegis: { color: '#7ae7ff', name: 'AEGIS' },
  };

  function drawHUD() {
    hudG.clear();
    const w = W(), h = H();
    const u = Math.max(1, Math.min(w, h) / 700);
    hudLayer.scale.set(1);
    hudLayer.position.set(0, 0);
    const sw = w / u, sh = h / u;
    hudLayer.scale.set(u);
    const L = game.levels[game.levelIndex];
    // scrim
    for (let i = 0; i < 4; i++) {
      hudG.rect(0, (i / 4) * 74, sw, 74 / 4 + 0.5).fill({ color: 0x000610, alpha: 0.6 * (1 - i / 4) });
    }
    txt((L.name || '').toUpperCase(), 18, 20, '600 13px ui-monospace, Menlo, monospace', 'rgba(190,225,255,0.75)', 'left', 1);
    hudG.circle(24, 40, 4).fill({ color: 0xa0ffd2, alpha: 0.95 });
    txt(String(game.sparks), 34, 40, '600 13px ui-monospace, Menlo, monospace', 'rgba(200,255,230,0.9)', 'left', 1);
    txt('×' + game.deaths, 64, 40, '600 13px ui-monospace, Menlo, monospace', 'rgba(255,140,160,0.6)', 'left', 1);
    if (game.state === 'play') {
      txt(`${fmtTime(game.time - game.startedAt)}   ·   ${game.kills} kills`, sw / 2, 20, '600 13px ui-monospace, Menlo, monospace', 'rgba(200,230,255,0.8)', 'center', 1);
    }
    // form chips
    let cxp = sw - 18;
    for (let i = FORM_ORDER.length - 1; i >= 0; i--) {
      const f = FORMS[FORM_ORDER[i]];
      const active = game.form && game.form.key === f.key;
      const label = `${f.num} ${f.name}`;
      const tw = label.length * 7.6 + 16;
      const bx = cxp - tw;
      hudG.roundRect(bx, 10, tw, 22, 6).fill({ color: active ? hexInt(f.glow) : 0xffffff, alpha: active ? 0.18 : 0.04 });
      if (active) hudG.roundRect(bx, 10, tw, 22, 6).stroke({ width: 1.2, color: hexInt(f.glow), alpha: 0.8 });
      txt(label, cxp - 8, 21, `${active ? '700' : '500'} 12px ui-monospace, Menlo, monospace`, active ? f.body : 'rgba(190,215,240,0.45)', 'right', 1);
      cxp = bx - 6;
    }
    // ability cooldown
    const cd = clamp(game.cooldown / 1.0, 0, 1);
    hudG.roundRect(18, sh - 30, 120, 5, 3).fill({ color: 0xffffff, alpha: 0.08 });
    hudG.roundRect(18, sh - 30, 120 * (1 - cd), 5, 3).fill({ color: hexInt(game.form ? game.form.glow : '#5ef2c8'), alpha: 0.85 });
    txt('SPACE · ' + (game.form ? game.form.abilityName : '') + (game.form && game.form.ability === 'flare' ? ' (2 sparks)' : ''),
      18, sh - 40, '500 10px ui-monospace, Menlo, monospace', 'rgba(180,210,240,0.5)', 'left', 1);
    // boss / miniboss bar
    {
      let hb = null, hlabel = '', hcol = '#ff8fa3';
      if (game.boss && !game.boss.dead) {
        hb = game.boss; hlabel = 'THE MATRIARCH'; hcol = game.boss.enraged ? '#ff5d73' : '#ff8fa3';
      } else {
        for (const mb of game.minibosses) if (!mb.dead) { hb = mb; hlabel = mb.name; hcol = mb.glow || mb.color; break; }
      }
      if (hb) {
        const bw = Math.min(420, sw * 0.6), bx = (sw - bw) / 2, by = 54;
        txt(hlabel, sw / 2, by - 8, '700 11px ui-monospace, Menlo, monospace', hcol, 'center', 1);
        hudG.rect(bx, by, bw, 8).fill({ color: 0x000a18, alpha: 0.7 });
        hudG.rect(bx, by, bw * clamp(hb.hp / hb.maxhp, 0, 1), 8).fill({ color: hexInt(hcol), alpha: 1 });
        hudG.rect(bx, by, bw, 8).stroke({ width: 1, color: hexInt(hcol), alpha: 0.5 });
      }
    }
    // power chip
    if (game.power) {
      const pc = game.power.color;
      const label = (POWERS[game.power.type] || {}).name + '  ' + Math.ceil(game.power.t) + 's';
      const tw = label.length * 7.6 + 18;
      hudG.rect(18, 52, tw, 20).fill({ color: 0x000a18, alpha: 0.6 });
      hudG.circle(30, 62, 5).fill({ color: hexInt(pc), alpha: 0.9 });
      txt(label, 40, 62, '700 12px ui-monospace, Menlo, monospace', pc, 'left', 1);
    }
    // hint + msg
    if (game.state === 'play' && game.time - game.startedAt < 9) {
      txt(game.hint, sw / 2, sh - 24, '500 12px ui-monospace, Menlo, monospace', 'rgba(200,230,255,1)', 'center', clamp(9 - (game.time - game.startedAt), 0, 1) * 0.7);
    }
    if (game.msg) {
      txt(game.msg.text, sw / 2, sh - 60, '600 13px ui-monospace, Menlo, monospace', 'rgba(255,200,140,1)', 'center', clamp(1 - game.msg.t / 2.2, 0, 1));
    }
  }

  // ---- overlays ----
  function overlayBase() {
    const w = W(), h = H();
    const u = Math.max(1, Math.min(w, h) / 700);
    hudLayer.scale.set(u);
    return { w: w / u, h: h / u };
  }

  function drawTitle() {
    hudG.clear();
    const { w, h } = overlayBase();
    for (let i = 0; i < 40; i++) {
      const x = (Math.sin(i * 12.9898 + game.time * 0.08) * 0.5 + 0.5) * w;
      const y = ((i * 37.7 + game.time * 12) % (h + 60)) - 30;
      const r = 18 + (i % 5) * 9;
      glowScreen(TEX_SOFT, x, y, r, 0x5ac8ff, 0.05 + (i % 3) * 0.02);
    }
    const cy = h * 0.40;
    txt('FISH N CHIPS', w / 2, cy, '700 74px Georgia, "Times New Roman", serif', '#dff3ff', 'center', 1, '#78dcff 40 0.9');
    txt('a bioluminescent descent · GITHUB GAME OFF 2026 — theme: SHIFT', w / 2, cy + 46, '500 15px ui-monospace, Menlo, monospace', 'rgba(150,200,235,0.85)', 'center', 1);
    const labels = { eel: 'FAST · fits narrow gaps', angler: 'LURE reveals the hidden', jelly: 'passes the burning curtain' };
    ['eel', 'angler', 'jelly'].forEach((k, i) => {
      const f = FORMS[k];
      const y = cy + 96 + i * 30;
      glowScreen(TEX_SOFT, w / 2 - 130, y, 22, hexInt(f.glow), 0.55);
      hudG.circle(w / 2 - 130, y, 5).fill({ color: hexInt(f.body), alpha: 1 });
      txt(f.name, w / 2 - 108, y - 7, '700 14px ui-monospace, Menlo, monospace', f.body, 'left', 1);
      txt(labels[k], w / 2 - 108, y + 8, '500 12px ui-monospace, Menlo, monospace', 'rgba(180,210,240,0.6)', 'left', 1);
    });
    const pulse = 0.55 + 0.45 * Math.sin(game.time * 2.4);
    txt('press any key · tap · or press A', w / 2, h * 0.86, '600 16px ui-monospace, Menlo, monospace', 'rgba(220,245,255,1)', 'center', pulse);
    txt('WASD / ARROWS swim · Q E shift form · SPACE ability · R restart · M mute', w / 2, h * 0.92, '500 11px ui-monospace, Menlo, monospace', 'rgba(150,185,215,0.45)', 'center', 1);
  }

  function drawActCard() {
    hudG.clear();
    const { w, h } = overlayBase();
    const a = clamp(game.cardT / 0.6, 0, 1) * clamp((4.5 - game.cardT) / 0.8, 0, 1);
    hudG.rect(0, 0, w, h).fill({ color: 0x00040c, alpha: 0.55 * a });
    txt(game.actName, w / 2, h * 0.44, '700 40px Georgia, serif', '#e1f5ff', 'center', a, '#78dcff 26 ' + (0.8 * a));
    txt(game.hint, w / 2, h * 0.53, '500 14px ui-monospace, Menlo, monospace', 'rgba(160,205,240,1)', 'center', 0.8 * a);
    txt('any key to begin', w / 2, h * 0.66, '500 11px ui-monospace, Menlo, monospace', 'rgba(150,185,215,1)', 'center', 0.5 * a);
  }

  function drawWin() {
    hudG.clear();
    game.winT = (game.winT || 0) + 1 / 60;
    const { w, h } = overlayBase();
    const a = clamp(game.winT / 0.5, 0, 1);
    hudG.rect(0, 0, w, h).fill({ color: 0x00040c, alpha: 0.6 * a });
    txt(game.levelIndex + 1 >= game.levels.length ? 'THE SURFACE' : 'ACT CLEARED', w / 2, h * 0.42, '700 44px Georgia, serif', '#fff0cd', 'center', a, '#ffd278 30 0.9');
    txt(`sparks ${game.sparks} · deaths ${game.deaths}`, w / 2, h * 0.52, '500 14px ui-monospace, Menlo, monospace', 'rgba(190,220,245,1)', 'center', 0.8 * a);
    txt('press any key to descend further', w / 2, h * 0.62, '600 13px ui-monospace, Menlo, monospace', 'rgba(220,245,255,1)', 'center', 0.4 + 0.5 * Math.sin(game.time * 2.5));
  }

  function drawEnding() {
    hudG.clear();
    const { w, h } = overlayBase();
    hudG.rect(0, 0, w, h).fill({ color: 0x00030a, alpha: 0.82 });
    for (let i = 0; i < 60; i++) {
      const x = (Math.sin(i * 78.233) * 0.5 + 0.5) * w;
      const y = ((i * 23.5 + game.time * 26) % (h + 40)) - 20;
      hudG.circle(x, y, 1 + (i % 3) * 0.8).fill({ color: 0xb4f0ff, alpha: 0.1 + (i % 4) * 0.05 });
    }
    txt('YOU REACHED THE LIGHT', w / 2, h * 0.36, '700 52px Georgia, serif', '#fff4dc', 'center', 1, '#ffe6a0 40 0.9');
    txt(`${game.sparks} sparks gathered · ${game.deaths} times the dark took you · ${Math.round(game.time - game.startedAt)}s`,
      w / 2, h * 0.47, '500 15px ui-monospace, Menlo, monospace', 'rgba(190,220,245,0.85)', 'center', 1);
    txt('every creature you were carried you somewhere the others could not go.',
      w / 2, h * 0.55, 'italic 500 14px Georgia, serif', 'rgba(160,200,235,0.7)', 'center', 1);
    txt('press any key to dive again', w / 2, h * 0.66, '600 13px ui-monospace, Menlo, monospace', 'rgba(220,245,255,1)', 'center', 0.4 + 0.5 * Math.sin(game.time * 2.5));
  }

  function drawScoreScreen() {
    hudG.clear();
    const { w, h } = overlayBase();
    hudG.rect(0, 0, w, h).fill({ color: 0x00030a, alpha: 0.86 });
    txt('RUN COMPLETE', w / 2, h * 0.24, '700 46px Georgia, serif', '#fff4dc', 'center', 1, '#ffe6a0 36 0.9');
    const rs = game.runStats || { time: 0, kills: 0, score: 0, timeBonus: 0 };
    txt(`TIME   ${fmtTime(rs.time)}`, w / 2, h * 0.38, '500 18px ui-monospace, Menlo, monospace', 'rgba(190,220,245,0.92)', 'center', 1);
    txt(`KILLS  ${rs.kills}`, w / 2, h * 0.44, '500 18px ui-monospace, Menlo, monospace', 'rgba(190,220,245,0.92)', 'center', 1);
    txt(`TIME BONUS  ${rs.timeBonus}`, w / 2, h * 0.50, '500 18px ui-monospace, Menlo, monospace', 'rgba(190,220,245,0.92)', 'center', 1);
    txt(`SCORE  ${rs.score}`, w / 2, h * 0.58, '700 30px Georgia, serif', '#a8ffe8', 'center', 1, '#78ffdc 20 0.6');
    const caret = (Math.sin(game.time * 5) > 0) ? '_' : ' ';
    txt(`> ${game.nameEntry}${caret}`, w / 2, h * 0.70, '600 22px ui-monospace, Menlo, monospace', '#ffffff', 'center', 1);
    txt('type your name · ENTER to save', w / 2, h * 0.78, '600 13px ui-monospace, Menlo, monospace', 'rgba(220,245,255,1)', 'center', 0.4 + 0.5 * Math.sin(game.time * 2.5));
  }

  function drawLeaderboard() {
    hudG.clear();
    const { w, h } = overlayBase();
    hudG.rect(0, 0, w, h).fill({ color: 0x00030a, alpha: 0.88 });
    txt('HALL OF THE DEEP', w / 2, h * 0.16, '700 40px Georgia, serif', '#d6fff2', 'center', 1, '#78ffdc 28 0.7');
    const list = game.scores || [];
    txt('#   NAME            SCORE     TIME    KILLS', w / 2, h * 0.28, '500 14px ui-monospace, Menlo, monospace', 'rgba(150,190,225,0.6)', 'center', 1);
    const left = w / 2 - 220;
    let y = h * 0.34;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mine = game.lastScore && e === game.lastScore;
      const row = `${String(i + 1).padStart(2, ' ')}   ${(e.name || 'DIVER').padEnd(12, ' ')}   ${String(e.score).padStart(6, ' ')}   ${fmtTime(e.time).padStart(5, ' ')}   ${String(e.kills).padStart(4, ' ')}`;
      txt(row, left, y, `${mine ? '700' : '500'} 15px ui-monospace, Menlo, monospace`, mine ? '#ffe08a' : 'rgba(200,225,248,0.85)', 'left', 1);
      y += 24;
    }
    if (!list.length) txt('no dives recorded yet', w / 2, y, '500 14px ui-monospace, Menlo, monospace', 'rgba(180,210,240,0.6)', 'center', 1);
    txt('R / any key to dive again', w / 2, h * 0.86, '600 13px ui-monospace, Menlo, monospace', 'rgba(220,245,255,1)', 'center', 0.4 + 0.5 * Math.sin(game.time * 2.5));
  }

  // ---- shimmer + grade filters on the world ----
  let disp = null, dispSprite = null, cmf = null;
  function noiseTexture() {
    const S1 = 128;
    const c = document.createElement('canvas'); c.width = c.height = S1;
    const x = c.getContext('2d');
    const small = document.createElement('canvas'); small.width = small.height = 16;
    const sx = small.getContext('2d'); const img = sx.createImageData(16, 16);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    sx.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = true; x.drawImage(small, 0, 0, S1, S1);
    const small2 = document.createElement('canvas'); small2.width = small2.height = 48;
    const sx2 = small2.getContext('2d'); const img2 = sx2.createImageData(48, 48);
    for (let i = 0; i < img2.data.length; i += 4) { const v = Math.random() * 255; img2.data[i] = img2.data[i + 1] = img2.data[i + 2] = v; img2.data[i + 3] = 255; }
    sx2.putImageData(img2, 0, 0);
    x.globalAlpha = 0.5; x.drawImage(small2, 0, 0, S1, S1); x.globalAlpha = 1;
    const t = PIXI.Texture.from(c); t.source.addressMode = 'repeat'; return t;
  }
  function buildGrade(act) {
    const sat = 1.10;
    const T = {
      0: [[0.96, 1.05, 1.07], [0.000, 0.004, 0.008]],
      1: [[0.99, 1.08, 0.97], [0.000, 0.008, 0.000]],
      2: [[1.07, 0.97, 1.10], [0.008, 0.000, 0.008]],
      3: [[0.96, 1.01, 1.10], [0.000, 0.000, 0.010]],
      4: [[0.96, 1.06, 1.09], [0.000, 0.004, 0.008]],
      5: [[1.03, 0.97, 1.10], [0.004, 0.000, 0.010]],
      6: [[1.11, 1.01, 0.90], [0.010, 0.000, 0.000]],
      7: [[1.10, 1.06, 0.92], [0.010, 0.004, 0.000]],
    }[act] || [[1, 1, 1], [0, 0, 0]];
    const gain = T[0], off = T[1];
    const lr = 0.299, lg = 0.587, lb = 0.114, sr = 1 - sat;
    const satM = [
      [lr * sr + sat, lg * sr, lb * sr, 0],
      [lr * sr, lg * sr + sat, lb * sr, 0],
      [lr * sr, lg * sr, lb * sr + sat, 0],
    ];
    const m = [];
    for (let r = 0; r < 3; r++) {
      const g = gain[r];
      for (let c = 0; c < 4; c++) m.push(satM[r][c] * g);
      m.push(off[r]);
    }
    m.push(0, 0, 0, 1, 0);
    return m;
  }
  try {
    dispSprite = new PIXI.Sprite(noiseTexture());
    dispSprite.renderable = false;
    dispSprite.scale.set(1.4);
    stage.addChild(dispSprite);
    disp = new PIXI.DisplacementFilter(dispSprite, 2.2);
    try { disp.scale.set(2.2, 2.2); } catch (e) { /* v8 may take scalar only */ }
  } catch (e) { disp = null; }
  try { cmf = new PIXI.ColorMatrixFilter(); } catch (e) { cmf = null; }
  let lastGrade = -1;

  // ---- camera + master render ----
  function cam() {
    const ww = game.ww || 1344, wh = game.wh || 756;
    const w = W(), h = H();
    let s = Math.min(w / 1380, h / 770);
    s = clamp(s, 0.6, 1.05);
    const vw = ww * s, vh = wh * s;
    let ox = w / 2 - (game.px != null ? game.px : ww / 2) * s;
    let oy = h / 2 - (game.py != null ? game.py : wh / 2) * s;
    if (vw <= w) ox = (w - vw) / 2; else ox = clamp(ox, w - vw, 0);
    if (vh <= h) oy = (h - vh) / 2; else oy = clamp(oy, h - vh, 0);
    if (game.shake > 0) { ox += rnd(-game.shake, game.shake); oy += rnd(-game.shake, game.shake); }
    return { s, ox, oy };
  }

  function render() {
    const w = W(), h = H();
    glowN = 0; partN = 0; textN = 0; tintN = 0;
    for (const s of glowPool) s.visible = false;
    for (const s of partPool) s.visible = false;
    for (const t of textPool) t.visible = false;
    for (const s of tintPool) s.visible = false;
    for (const s of erasePool) s.visible = false;

    // page backdrop
    pageBgG.clear().rect(0, 0, w, h).fill({ color: hexInt((game.pal || { bot: '#01060e' }).bot), alpha: 1 });
    pageBgG.rect(0, h * 0.5, w, h * 0.5).fill({ color: 0x000106, alpha: 0.6 });

    if (game.state === 'title') {
      world.visible = false;
      darkSprite.visible = false; tintG.clear();
      hudG.clear();
      drawTitle();
    } else {
      world.visible = true;
      const { s, ox, oy } = cam();
      world.position.set(ox, oy);
      world.scale.set(s);
      game._s = s * dpr; game._ox = ox * dpr; game._oy = oy * dpr;

      computeLights();
      drawWater();
      drawBackground();
      drawRock();
      drawGodRays();
      drawCurrents();
      drawHidden();
      drawAnemones();
      drawCheckpoints();
      drawGoal();
      drawPlankton();
      drawBulbs();
      drawPowerups();
      drawUrchins();
      drawStingers();
      drawLanterns();
      drawFish();
      drawVipers();
      drawParticles();
      drawRings();
      drawMiniBosses();
      drawBoss();
      drawShots();
      drawPlayer();

      // bloom: world -> RT (before darkness, like the Canvas pass order)
      if (bloomA) {
        try {
          const bw = Math.max(2, Math.floor(w / 3)), bh = Math.max(2, Math.floor(h / 3));
          if (bloomRT.width !== bw || bloomRT.height !== bh) bloomRT.resize(bw, bh);
          app.renderer.render({ container: world, target: bloomRT, clear: true });
          bloomA.width = w; bloomA.height = h; bloomA.visible = true;
          bloomB.width = w; bloomB.height = h; bloomB.visible = true;
        } catch (e) { bloomA.visible = false; bloomB.visible = false; }
      }

      drawLighting(s, ox, oy);
      drawVignette();
      drawHUD();

      if (game.state === 'actcard') drawActCard();
      else if (game.state === 'win') drawWin();
      else if (game.state === 'ending') drawEnding();
      else if (game.state === 'score') drawScoreScreen();
      else if (game.state === 'leaderboard') drawLeaderboard();
    }

    // flash + fade
    flashG.clear();
    if (game.flash > 0) flashG.rect(0, 0, w, h).fill({ color: 0xbeE6ff, alpha: game.flash * 0.35 });
    fadeG.clear();
    if (game.fade > 0) fadeG.rect(0, 0, w, h).fill({ color: 0x000208, alpha: game.fade });

    // shimmer + grade
    if (dispSprite) {
      dispSprite.x = (game.time * 7) % 100000;
      dispSprite.y = (game.time * 4.5) % 100000;
    }
    if (cmf) {
      const li = game.levelIndex | 0;
      if (li !== lastGrade) { cmf.matrix = buildGrade(li); lastGrade = li; }
    }
    const fxs = [];
    if (disp) fxs.push(disp);
    if (cmf) fxs.push(cmf);
    graded.filters = fxs.length ? fxs : null;
  }

  function resize() {
    // nothing persistent depends on screen size; render() recomputes
  }

  return { render, resize, graded, world, dispSprite, disp, cmf };
}
