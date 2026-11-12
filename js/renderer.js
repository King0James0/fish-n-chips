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
  const bgFarLayer = new PIXI.Container();
  const bgFarG = new PIXI.Graphics();
  bgFarLayer.addChild(bgFarG);
  const bgLayer = new PIXI.Container();
  const bgG = new PIXI.Graphics();
  bgLayer.addChild(bgG);
  // ---- AI-generated act backgrounds: two parallax image plates per act ----
  // A darkened, blurred, zoomed "far" ghost behind a full "near" plate. Both
  // scroll at the existing parallax factors (set in render()), so the offset
  // between the two sells depth. Loaded async; until they're ready (or if they
  // fail) the procedural drawBackground() below is the fallback.
  const bgImageCache = new Map();
  let bgFarSprite = null, bgNearSprite = null, bgImagesReady = false;
  const loadBgImage = (url) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(PIXI.Texture.from(img));
    img.onerror = () => rej(new Error('bg load failed: ' + url));
    img.src = url;
  });
  (async () => {
    try {
      await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(a =>
        loadBgImage(`art/bg/act${a}.jpg`).then(t => bgImageCache.set(a, t))));
      bgFarSprite = new PIXI.Sprite();
      bgFarSprite.anchor.set(0.5); bgFarSprite.alpha = 0.5;
      try { bgFarSprite.filters = [new PIXI.BlurFilter({ strength: 8 })]; } catch (e) {}
      bgFarLayer.addChild(bgFarSprite);
      bgNearSprite = new PIXI.Sprite();
      bgNearSprite.anchor.set(0.5);
      bgLayer.addChild(bgNearSprite);
      bgImagesReady = true;
      bgKey = ''; // force the next drawBackground() to (re)apply the plates
    } catch (e) { bgImagesReady = false; }
  })();
  const kelpG = new PIXI.Graphics();
  const hazG = new PIXI.Graphics();
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
  const playerSkel = new PIXI.Container();
  // playerFlip mirrors the whole player (graphics + skeleton) so a creature is
  // never rendered upside-down: it reflects across the forward axis when the
  // dorsal would point down (angler/eel) or across the horizontal when the dome
  // would point down (jelly). Identity when the creature is already right-side-up.
  const playerFlip = new PIXI.Container();
  playerFlip.addChild(playerG, playerSkel);
  let playerFlipped = false;   // set per-frame in drawPlayer; drives eel ribbon light compensation
  const partWorld = new PIXI.Container(); partWorld.blendMode = 'add';
  // ---- decorative (non-interactive) life + soft label plates + natural god rays ----
  const ambG = new PIXI.Graphics();            // seaweed / coral / ambient sea animals
  const raySpr = new PIXI.Container(); raySpr.blendMode = 'add';
  const plateLayer = new PIXI.Container();     // soft label backdrops (behind the text)
  const platePool = [];
  let plateN = 0;
  const raySprites = [];
  // baked soft-edged label plate (white; tinted dark): a feathered rounded rect so
  // overlay titles sit on a backdrop that fades out instead of a hard-edged slab
  // Title backdrop: a soft elliptical glow (bright centre fading to fully
  // transparent at every edge). Because all four sides of the texture dissolve
  // to zero, a stretched plate has NO straight sides or corners — the headline
  // sits on a darkening that blends into the water instead of a hard slab.
  const PLATE_TEX = (() => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    // radius > half-size so the glow reaches full transparency BEFORE the
    // canvas edge: the stretched plate then has no rectangular cutoff at all.
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, cx * 1.7);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return PIXI.Texture.from(c);
  })();
  // baked god-ray beam (white): soft sides + smooth top->bottom falloff, so each
  // shaft reads as light instead of a hard banded pillar
  const BEAM_TEX = (() => {
    const W = 64, H = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    for (let py = 0; py < H; py++) {
      const ty = py / H, va = Math.pow(1 - ty, 1.7);
      for (let px = 0; px < W; px++) {
        const tx = px / (W - 1), ha = Math.sin(tx * Math.PI);
        x.fillStyle = `rgba(255,255,255,${va * ha})`; x.fillRect(px, py, 1, 1);
      }
    }
    return PIXI.Texture.from(c);
  })();
  // Sprite-skeleton rig for enemy/boss creatures. Sits immediately above the
  // procedural miniG/bossG layers: a creature that draws via sprites skips its
  // vector path, so the two never double-draw and depth ordering is preserved.
  const creatureSkel = new PIXI.Container();
  world.addChild(waterBaseG, waterG, bgFarLayer, bgLayer, rayG, raySpr, rockG, kelpG, ambG, currentG, hiddenG, hazG, anemG,
    checkG, goalG, plankG, bulbG, powerG, urchG, stingG, lanG, fishG, vipG,
    glowWorld, ringG, miniG, bossG, creatureSkel, shotG, playerFlip, partWorld);

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
  stage.addChild(plateLayer, hudLayer);
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
  function txt(str, x, y, font, color, align, alpha, shadow, maxWidth) {
    let t = textPool[textN];
    if (!t) {
      t = new PIXI.Text({ text: '', style: {} });
      hudLayer.addChild(t);
      textPool[textN] = t;
    }
    t.text = str;
    let st = textStyle(PIXI, font, color, shadow);
    if (maxWidth) { st = st.clone(); st.wordWrap = true; st.wordWrapWidth = maxWidth; }
    t.style = st;
    t.anchor.set(align === 'center' ? 0.5 : align === 'right' ? 1 : 0, 0.5);
    t.position.set(x, y);
    t.alpha = alpha === undefined ? 1 : clamp(alpha, 0, 1);
    t.visible = true;
    textN++;
    return t;
  }

  // ---- soft label backdrop ------------------------------------------------
  // A feathered rounded plate behind overlay titles so the big text sits on a
  // backdrop that fades out at the edges instead of a hard-edged slab. Lives in
  // plateLayer (behind the text) and is scaled like the HUD by the caller.
  function plate(x, y, w, h, col, alpha) {
    if (alpha <= 0.004) return;
    let sp = platePool[plateN];
    if (!sp) {
      sp = new PIXI.Sprite(PLATE_TEX);
      sp.anchor.set(0.5);
      plateLayer.addChild(sp);
      platePool[plateN] = sp;
    }
    sp.visible = true;
    sp.position.set(x, y);
    sp.width = w; sp.height = h;
    sp.tint = col; sp.alpha = clamp(alpha, 0, 1);
    plateN++;
  }

  // Convenience: a soft backdrop sized to an overlay title. x,y,w,h are in the
  // overlay's logical (u-scaled) space — the same numbers the title text uses —
  // and are mapped to screen space so the plate tracks the HUD scale.
  function titlePlate(x, y, w, h, alpha) {
    const u = Math.max(1, Math.min(W(), H()) / 700);
    plate(x * u, y * u, w * u, h * u, 0x00040c, alpha);
  }

  // Big overlay title with a soft feathered backdrop. Measures the rendered text
  // and lays a rounded, edge-fading plate behind it (in the overlay's logical
  // space), so the headline reads on a backdrop that dissolves out rather than a
  // hard-edged slab. Returns the PIXI.Text for any further tweaks.
  function title(str, x, y, font, color, alpha, shadow, padX, padY, plateAlpha) {
    const t = txt(str, x, y, font, color, 'center', alpha, shadow);
    const w = t.width + (padX || 44), h = t.height + (padY || 30);
    titlePlate(x, y, w, h, plateAlpha == null ? 0.55 : plateAlpha);
    return t;
  }

  // ---- high-resolution creature-part baker -------------------------------
  // Creature parts are drawn ONCE into a supersampled canvas and reused as
  // textures. The camera scale (up to ~1.05), the per-form VS factor (~1.3) and
  // the boss scale (up to 1.5+) blow a part up several times over, so every part
  // is baked at 4x its logical size and flagged 'linear' — bilinear upscale
  // instead of the blocky nearest-neighbour default. Textures are cached by key:
  // baked lazily on first use, shared by every later frame and every instance.
  const partCache = new Map();
  function smooth(t) {
    try { if (t.source) t.source.scaleMode = 'linear'; } catch (e) { /* v8 */ }
    try { t.scaleMode = 'linear'; } catch (e) { /* older setter */ }
    return t;
  }
  function bakePart(lw, lh, drawFn, ss) {
    const S = ss || 4;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(lw * S));
    c.height = Math.max(1, Math.round(lh * S));
    const x = c.getContext('2d');
    x.scale(S, S);
    drawFn(x, lw, lh);          // artist code stays in LOGICAL units
    const t = smooth(PIXI.Texture.from(c));
    t._lw = lw; t._lh = lh;     // logical size: world size = _lw * scale factor
    return t;
  }
  function bakeLogical(key, lw, lh, drawFn, ss) {
    let t = partCache.get(key);
    if (!t) { t = bakePart(lw, lh, drawFn, ss); partCache.set(key, t); }
    return t;
  }
  // Pivot-centred bake: the part is drawn in CREATURE-SPACE coordinates (the very
  // numbers the vector path uses) around a pivot (px,py) reaching +/- hw,hh. The
  // pivot lands on the canvas centre, so an anchor-0.5 sprite placed at that bone
  // and rotated about it behaves exactly like ctx.translate()+ctx.rotate().
  function bakeSpace(key, px, py, hw, hh, drawFn, ss) {
    let t = partCache.get(key);
    if (!t) {
      const lw = Math.max(1, hw * 2), lh = Math.max(1, hh * 2);
      const S = ss || 4;
      const c = document.createElement('canvas');
      c.width = Math.round(lw * S); c.height = Math.round(lh * S);
      const x = c.getContext('2d');
      x.scale(S, S);
      x.translate(lw / 2 - px, lh / 2 - py);
      drawFn(x, lw, lh);
      t = smooth(PIXI.Texture.from(c));
      partCache.set(key, t);
    }
    return t;
  }

  // ---- shared 2D shading primitives used by the bakes --------------------
  // Crisp eye: sclera gradient, dark limbal ring, pupil, specular highlight.
  function bakeEye(x, cx, cy, r, sclera, pupil, specR) {
    const g = x.createRadialGradient(cx - r * 0.28, cy - r * 0.3, r * 0.08, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, sclera || '#f4ecd8');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = Math.max(0.35, r * 0.14);
    x.beginPath(); x.arc(cx, cy, r * 0.93, 0, 7); x.stroke();
    x.fillStyle = pupil || '#100a04';
    x.beginPath(); x.ellipse(cx + r * 0.1, cy, r * 0.44, r * 0.56, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.beginPath(); x.arc(cx - r * 0.34, cy - r * 0.36, Math.max(0.5, specR || r * 0.24), 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.beginPath(); x.arc(cx + r * 0.32, cy + r * 0.3, Math.max(0.3, r * 0.11), 0, 7); x.fill();
  }
  // Clean fang/tooth with a shaded root so it reads as a solid cone.
  function bakeTooth(x, ax, ay, bx, by, cx2, cy2) {
    const g = x.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, '#fffdf4'); g.addColorStop(0.65, '#f0e6cf'); g.addColorStop(1, 'rgba(170,150,120,0.95)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(cx2, cy2); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 0.3; x.stroke();
  }
  // Soft top rim light + inner shadow, clipped to the part's own silhouette.
  function bakeVolume(x, pathFn, yTop, yBot, rimCol, shadowCol) {
    x.save(); pathFn(); x.clip();
    const g = x.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, rimCol); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, shadowCol);
    x.fillStyle = g; x.fillRect(-4096, -4096, 8192, 8192);
    x.restore();
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const shadeHex = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * f) | 0, g = Math.min(255, ((n >> 8) & 255) * f) | 0, b = Math.min(255, (n & 255) * f) | 0;
    return `rgb(${r},${g},${b})`;
  };
  const qpoint = (a, b, c, t) => { const m = 1 - t; return [m * m * a[0] + 2 * m * t * b[0] + t * t * c[0], m * m * a[1] + 2 * m * t * b[1] + t * t * c[1]]; };
  const qtan = (a, b, c, t) => { const m = 1 - t; return Math.atan2(2 * m * (b[1] - a[1]) + 2 * t * (c[1] - b[1]), 2 * m * (b[0] - a[0]) + 2 * t * (c[0] - b[0])); };

  // ---- generic sprite-skeleton driver --------------------------------------
  // Lazily grows a pool of PIXI.Sprite inside `container`; each frame you hand
  // frame() the ordered list of bone placements {tex,x,y,w,h,r,t,a,bm,v}. Slots
  // past the end of the list are hidden, so a creature that vanishes next frame
  // leaves no residue. Negative w/h mirrors a part (left/right pairs from one
  // bake). Same pattern the eel rig uses, generalised for everything else.
  function makeSkel(container) {
    const pool = [];
    return {
      frame(list) {
        for (let i = 0; i < list.length; i++) {
          let s = pool[i];
          if (!s) { s = new PIXI.Sprite(); s.anchor.set(0.5); container.addChild(s); pool[i] = s; }
          const pl = list[i];
          if (!pl || !pl.tex || pl.v === false) { s.visible = false; continue; }
          if (s._tex !== pl.tex) { s._tex = pl.tex; s.texture = pl.tex; }
          const bm = pl.bm || 'normal';
          if (s._bm !== bm) { s._bm = bm; s.blendMode = bm; }
          s.visible = true;
          s.position.set(pl.x, pl.y);
          s.rotation = pl.r || 0;
          // scale (not width/height) so a negative w mirrors a part cleanly and
          // pool reuse never inherits a stale mirror from the previous creature
          const o = pl.tex.orig;
          s.scale.set(pl.w / o.width, pl.h / o.height);
          s.tint = pl.t == null ? 0xffffff : pl.t;
          s.alpha = pl.a == null ? 1 : clamp(pl.a, 0, 1);
        }
        for (let i = list.length; i < pool.length; i++) pool[i].visible = false;
      },
      hide() { for (const s of pool) s.visible = false; },
    };
  }

  // ---- skeleton rigs ------------------------------------------------------
  // playerSkel hosts the player-form rigs (eel uses its own pooled arrays);
  // creatureSkel hosts every miniboss + the final boss, one shared pool.
  const playerRig = makeSkel(playerSkel);
  const creatureRig = makeSkel(creatureSkel);
  const cskel = [];   // per-frame bone list for creatureRig (minibosses push, boss finalizes)

  // ---- creature part atlas: every bake happens ONCE, lazily, at 4x -------
  let CREAT = null;
  function bakeCreatureParts() {
    const K = {}, ss = 5;
    // Generic bone-chain segment: a rounded capsule baked in grayscale so a
    // per-instance tint recolours it while the baked rim/shade survive. Used for
    // legs, tentacles, tails and any sampled curve (placed along the tangent).
    K.capsule = bakeLogical('capsule', 48, 16, (x, w, h) => {
      const r = h / 2 - 1;
      const path = () => { x.beginPath(); x.roundRect(1, 1, w - 2, h - 2, r); };
      x.fillStyle = '#efefef'; path(); x.fill();
      x.save(); path(); x.clip();
      const g = x.createLinearGradient(0, 1, 0, h - 1);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.restore();
    }, 3);
    // ================= ANGLER =================
    K.angBody = bakeSpace('angBody', 0, 0, 19, 14, (x) => {
      const path = () => { x.beginPath(); x.ellipse(0, 0, 17, 12.2, 0, 0, 7); };
      x.fillStyle = '#241705'; path(); x.fill();
      x.save(); path(); x.clip();
      let g = x.createLinearGradient(0, -12.2, 0, 12.2);
      g.addColorStop(0, 'rgba(255,209,102,0.30)'); g.addColorStop(0.42, 'rgba(255,209,102,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = g; x.fillRect(-20, -14, 40, 28);
      for (const [mx, my, mr] of [[-8, -5, 4.2], [-2, -7, 3.1], [-11, 2, 3.6], [-4, 4, 4.6], [3, -6, 2.8], [6, 5, 3.2]]) {
        const mg = x.createRadialGradient(mx, my, 0, mx, my, mr);
        mg.addColorStop(0, 'rgba(255,209,102,0.20)'); mg.addColorStop(1, 'rgba(255,209,102,0)');
        x.fillStyle = mg; x.beginPath(); x.ellipse(mx, my, mr, mr * 0.7, 0, 0, 7); x.fill();
      }
      let rg = x.createLinearGradient(0, -12.2, 0, -5);
      rg.addColorStop(0, 'rgba(255,236,180,0.62)'); rg.addColorStop(1, 'rgba(255,236,180,0)');
      x.fillStyle = rg; x.fillRect(-20, -13, 40, 8);
      // caudal-side rim so the body reads round against dark water
      let rr = x.createLinearGradient(-19, 0, -11, 0);
      rr.addColorStop(0, 'rgba(255,209,102,0.34)'); rr.addColorStop(1, 'rgba(255,209,102,0)');
      x.fillStyle = rr; x.fillRect(-20, -12, 9, 24);
      x.restore();
      x.strokeStyle = 'rgba(255,176,32,0.7)'; x.lineWidth = 1.7; path(); x.stroke();
      x.strokeStyle = 'rgba(255,176,32,0.5)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(4.5, -8.5); x.quadraticCurveTo(8.5, 0, 4.5, 9); x.stroke();
      x.beginPath(); x.moveTo(2.5, -7.5); x.quadraticCurveTo(6, 0, 2.5, 8); x.stroke();
      for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(255,176,32,0.85)'; x.beginPath(); x.arc(-12 + i * 4.2, 8.4, 1.1, 0, 7); x.fill(); }
      for (let i = 0; i < 5; i++) { x.fillStyle = 'rgba(255,176,32,0.45)'; x.beginPath(); x.arc(-11 + i * 4.4, -9.6, 0.9, 0, 7); x.fill(); }
    }, ss);
    K.angEye = bakeSpace('angEye', 5.6, -6.4, 5, 5, (x) => {
      bakeEye(x, 5.6, -6.4, 4.1, '#f7f2df', '#140c02');
    }, ss);
    K.angJaw = bakeSpace('angJaw', 3.5, 0.5, 21, 14, (x) => {
      x.beginPath(); x.moveTo(4, -7.5); x.quadraticCurveTo(22, -5, 19.5, 1.2); x.quadraticCurveTo(13, 10, 3, 8.8); x.closePath();
      const g = x.createLinearGradient(4, -8, 16, 10);
      g.addColorStop(0, '#1c1002'); g.addColorStop(1, '#070400');
      x.fillStyle = g; x.fill();
      x.strokeStyle = 'rgba(255,176,32,0.35)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(4, -7.5); x.quadraticCurveTo(22, -5, 19.5, 1.2); x.stroke();
      for (const [tx, ty, th] of [[6, -5.6, 3.4], [9.6, -4.4, 3.9], [13.2, -2.4, 3.1], [16, 0.4, 2.4], [7.2, 6.8, -3.4], [11, 5.6, -3.8], [14.2, 3.4, -2.8]]) bakeTooth(x, tx - 1.7, ty, tx, ty + th, tx + 1.7, ty);
      bakeTooth(x, 8.4, -5.8, 9.9, -1.2, 11.4, -5.4);
      bakeTooth(x, 9.4, 7.2, 10.8, 2.6, 12.2, 6.6);
    }, ss);
    K.angTail = bakeSpace('angTail', -14, 0, 14, 12, (x) => {
      x.beginPath(); x.moveTo(-14, 0); x.lineTo(-27, -11); x.lineTo(-21.5, 0); x.lineTo(-27, 11); x.closePath();
      const g = x.createLinearGradient(-27, 0, -14, 0);
      g.addColorStop(0, 'rgba(255,176,32,0.12)'); g.addColorStop(1, 'rgba(255,176,32,0.42)');
      x.fillStyle = g; x.fill();
      x.strokeStyle = 'rgba(255,176,32,0.45)'; x.lineWidth = 0.8; x.lineCap = 'round';
      for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(-15, 0); x.lineTo(-25, i * 4.2); x.stroke(); }
    }, ss);
    K.angDorsal = bakeSpace('angDorsal', -1, -13, 13, 8, (x) => {
      x.strokeStyle = '#ffd166'; x.lineWidth = 1.4; x.lineCap = 'round'; x.globalAlpha = 0.8;
      for (let i = 0; i < 6; i++) { const px = -11 + i * 3.9; x.beginPath(); x.moveTo(px, -10); x.lineTo(px - 1.8, -16.5 - (i % 3) * 2.6); x.stroke(); }
      x.globalAlpha = 1;
    }, ss);
    K.angPec = bakeSpace('angPec', 2, 5, 14, 13, (x) => {
      x.beginPath(); x.moveTo(2, 5); x.quadraticCurveTo(-3, 15, -11, 17); x.quadraticCurveTo(-7, 8.5, 2, 8); x.closePath();
      const g = x.createLinearGradient(2, 5, -11, 17);
      g.addColorStop(0, 'rgba(255,176,32,0.34)'); g.addColorStop(1, 'rgba(255,176,32,0.08)');
      x.fillStyle = g; x.fill();
      x.strokeStyle = 'rgba(255,209,102,0.3)'; x.lineWidth = 0.7;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(1.5, 5.5 + i * 0.7); x.quadraticCurveTo(-2 + i * 1.5, 11 + i * 1.2, -8 + i * 2, 15.5 - i * 0.8); x.stroke(); }
    }, ss);
    K.angRod = bakeSpace('angRod', 6.5, -11.5, 17, 16, (x) => {
      x.strokeStyle = '#ffd166'; x.lineWidth = 1.9; x.lineCap = 'round';
      x.beginPath(); x.moveTo(6.5, -11.5); x.quadraticCurveTo(19, -22, 22, -25); x.stroke();
      x.fillStyle = 'rgba(255,176,32,0.9)';
      for (let i = 1; i <= 3; i++) { const [bx, by] = qpoint([6.5, -11.5], [19, -22], [22, -25], i / 4); x.beginPath(); x.arc(bx, by, 1.2, 0, 7); x.fill(); }
    }, ss);
    K.angEsca = bakeLogical('angEsca', 20, 20, (x, w, h) => {
      const cx = w / 2, cy = h / 2;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 9);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,251,232,0.95)'); g.addColorStop(1, 'rgba(255,235,180,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 9, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,235,180,0.8)'; x.lineWidth = 0.9;
      for (let i = 0; i < 5; i++) { const a = i * (Math.PI * 2 / 5); x.beginPath(); x.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3); x.lineTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5); x.stroke(); }
    }, ss);
    // ================= JELLY =================
    K.jellyBell = bakeSpace('jellyBell', 0, -1, 16.5, 25.5, (x) => {
      const bellPath = () => {
        x.beginPath(); x.moveTo(-15.5, -1);
        x.bezierCurveTo(-15.5, -24.7, 15.5, -24.7, 15.5, -1);
        for (let i = 0; i <= 7; i++) { const tt = i / 7; x.lineTo(15.5 - 31 * tt, -1 + Math.sin(tt * Math.PI * 7) * 2.6); }
        x.closePath();
      };
      bellPath(); x.fillStyle = 'rgba(26,10,50,0.92)'; x.fill();
      x.save(); bellPath(); x.clip();
      const g = x.createLinearGradient(0, -24, 0, -1);
      g.addColorStop(0, 'rgba(224,170,255,0.35)'); g.addColorStop(0.5, 'rgba(199,125,255,0.10)'); g.addColorStop(1, 'rgba(224,170,255,0.22)');
      x.fillStyle = g; x.fillRect(-17, -27, 34, 28);
      x.strokeStyle = 'rgba(224,170,255,0.5)'; x.lineWidth = 1;
      for (let i = 0; i < 7; i++) { const tt = (i + 0.5) / 7; x.beginPath(); x.moveTo(0, -17.3); x.quadraticCurveTo((-15.5 + 31 * tt) * 0.5, -10.4, -15.5 + 31 * tt, -1.5); x.stroke(); }
      x.restore();
      bellPath(); x.strokeStyle = 'rgba(224,170,255,0.95)'; x.lineWidth = 1.9; x.stroke();
      for (let i = 0; i < 8; i++) { const tt = (i + 0.5) / 8; x.fillStyle = 'rgba(224,170,255,0.95)'; x.beginPath(); x.arc(-15.5 + 31 * tt, -2.6, 1.15, 0, 7); x.fill(); }
      for (const [gx, gy] of [[-4.4, -7.5], [4.4, -7.5], [-2.4, -11.5], [2.4, -11.5]]) {
        const gg = x.createRadialGradient(gx, gy, 0, gx, gy, 3.2);
        gg.addColorStop(0, 'rgba(224,170,255,0.85)'); gg.addColorStop(1, 'rgba(224,170,255,0.15)');
        x.fillStyle = gg; x.beginPath(); x.ellipse(gx, gy, 3.1, 2.4, 0, 0, 7); x.fill();
      }
      x.strokeStyle = 'rgba(224,170,255,0.6)'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(0, -6); x.lineTo(0, -1); x.stroke();
      const hg = x.createRadialGradient(-4.6, -13.4, 0, -4.6, -13.4, 3);
      hg.addColorStop(0, 'rgba(255,255,255,0.95)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = hg; x.beginPath(); x.ellipse(-4.6, -13.4, 2.6, 1.5, 0, 0, 7); x.fill();
    }, ss);
    K.jellyArm = bakeSpace('jellyArm', 0, 0, 8, 23, (x) => {
      x.beginPath(); x.moveTo(-2.4, 0); x.quadraticCurveTo(-2, 12, -1.2, 21); x.lineTo(1.2, 21); x.quadraticCurveTo(2, 12, 2.4, 0); x.closePath();
      const g = x.createLinearGradient(0, 0, 0, 21);
      g.addColorStop(0, 'rgba(199,125,255,0.5)'); g.addColorStop(1, 'rgba(199,125,255,0.12)');
      x.fillStyle = g; x.fill();
      x.strokeStyle = 'rgba(224,170,255,0.5)'; x.lineWidth = 0.9;
      x.beginPath(); x.moveTo(0, 1); x.quadraticCurveTo(0, 12, 0, 20); x.stroke();
    }, ss);
    K.jellyTent = bakeSpace('jellyTent', 0, 0, 12, 57, (x) => {
      const g = x.createLinearGradient(0, 0, 0, 57);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.55, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
      x.strokeStyle = g; x.lineWidth = 1.35; x.lineCap = 'round';
      x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(3, 20, -3, 38, 0, 57); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 1; k <= 3; k++) { const [bx, by] = qpoint([0, 0], [3, 20], [-3, 38], k / 3.4); x.beginPath(); x.arc(bx, by, 0.95, 0, 7); x.fill(); }
    }, ss);
    // Fake-3D ribbon bases (mid-tone so the per-vertex up-light shades them into a
    // rounded, lit body). Angler = warm amber flank; jelly = translucent violet dome.
    K.angRibbon = bakePart(120, 40, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, 'rgba(40,22,4,0)');
      g.addColorStop(0.10, 'rgba(58,34,8,0.96)');
      g.addColorStop(0.50, 'rgba(96,62,20,1)');
      g.addColorStop(0.90, 'rgba(58,34,8,0.96)');
      g.addColorStop(1.00, 'rgba(40,22,4,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(255,214,140,0.4)'; x.lineWidth = 1.1;
      x.beginPath(); x.moveTo(4, h * 0.46); x.lineTo(w - 4, h * 0.46); x.stroke();
    }, 5);
    K.jellyDome = bakePart(64, 64, (x, w, h) => {
      // mid-tone violet dome (the per-vertex up-light shades it into a rounded,
      // lit bell). Fills the canvas so a grid laid over the bell maps cleanly.
      const cx = w / 2, cy = h / 2, r = w / 2 - 2;
      const g = x.createRadialGradient(cx, cy - r * 0.15, r * 0.1, cx, cy, r);
      g.addColorStop(0.00, 'rgba(168,116,204,1)');
      g.addColorStop(0.55, 'rgba(120,76,160,0.98)');
      g.addColorStop(0.88, 'rgba(84,50,120,0.9)');
      g.addColorStop(1.00, 'rgba(52,28,80,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
      // ocelli (faint lighter rings near the margin) + a soft crown highlight
      x.strokeStyle = 'rgba(224,190,255,0.35)'; x.lineWidth = 1.4;
      for (let i = 0; i < 7; i++) { const a = Math.PI * (0.15 + 0.7 * i / 6); const ox = cx + Math.cos(a) * r * 0.72, oy = cy + Math.sin(a) * r * 0.72; x.beginPath(); x.arc(ox, oy, 2.4, 0, 7); x.stroke(); }
      const hg = x.createRadialGradient(cx - r * 0.3, cy - r * 0.45, 0, cx - r * 0.3, cy - r * 0.45, r * 0.5);
      hg.addColorStop(0, 'rgba(255,255,255,0.5)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = hg; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    }, 5);
    // ================= MINIBOSS: CRAB =================
    {
      const C = '#c8a06a', G = '#ffd9a0';
      K.crabShell = bakeSpace('crabShell', 0, 0, 24, 20, (x) => {
        x.fillStyle = '#5a3a1a'; x.beginPath(); x.ellipse(0, 6, 22, 8, 0, 0, 7); x.fill();
        const path = () => { x.beginPath(); x.ellipse(0, -4, 22, 16, 0, 0, 7); };
        x.fillStyle = C; path(); x.fill();
        x.save(); path(); x.clip();
        const g = x.createLinearGradient(0, -20, 0, 12);
        g.addColorStop(0, 'rgba(240,214,160,0.85)'); g.addColorStop(0.45, 'rgba(200,160,106,0.1)'); g.addColorStop(1, 'rgba(20,10,2,0.55)');
        x.fillStyle = g; x.fillRect(-24, -22, 48, 36);
        x.restore();
        x.strokeStyle = hexA(G, 0.6); x.lineWidth = 2; path(); x.stroke();
        x.strokeStyle = 'rgba(58,36,16,0.6)'; x.lineWidth = 1;
        for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * 8, -18); x.lineTo(i * 8, 8); x.stroke(); }
        for (const s of [-1, 1]) {
          x.fillStyle = '#0a0602'; x.beginPath(); x.arc(s * 6, -8, 3, 0, 7); x.fill();
          x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.arc(s * 6 - 0.9, -8.9, 0.8, 0, 7); x.fill();
        }
      }, ss);
      K.crabClaw = bakeSpace('crabClaw', 0, 0, 15, 9, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, 0, 10, 6, 0, 0, 7); };
        x.fillStyle = C; path(); x.fill();
        bakeVolume(x, path, -6, 6, 'rgba(240,214,160,0.6)', 'rgba(20,10,2,0.4)');
        x.strokeStyle = hexA(G, 0.7); x.lineWidth = 2; x.lineCap = 'round';
        x.beginPath(); x.moveTo(6, -4); x.lineTo(14, -6); x.stroke();
        x.beginPath(); x.moveTo(6, 4); x.lineTo(14, 6); x.stroke();
      }, ss);
    }
    // ================= MINIBOSS: MANTA =================
    {
      const C = '#7fa8ff', G = '#bcd4ff';
      // three flap poses (control y = -14 - flap*22, tip y = 6 + flap*10); the rig
      // cross-fades the two nearest so the beat reads as continuous motion
      for (const [pk, fv] of [['U', -0.5], ['M', 0], ['D', 0.5]]) {
        K['mantaWing' + pk] = bakeSpace('mantaWing' + pk, 0, -6, 42, 26, (x) => {
          const cy1 = -14 - fv * 22, ey = 6 + fv * 10;
          x.beginPath(); x.moveTo(0, -6); x.quadraticCurveTo(30, cy1, 40, ey); x.quadraticCurveTo(20, 10, 0, 12); x.closePath();
          const g = x.createLinearGradient(0, cy1, 40, 12);
          g.addColorStop(0, 'rgba(188,212,255,0.6)'); g.addColorStop(0.5, C); g.addColorStop(1, 'rgba(20,32,80,0.9)');
          x.fillStyle = g; x.fill();
          x.strokeStyle = hexA(G, 0.5); x.lineWidth = 1.5; x.stroke();
          x.strokeStyle = 'rgba(188,212,255,0.25)'; x.lineWidth = 0.8;
          for (let i = 1; i <= 3; i++) { x.beginPath(); x.moveTo(2, -6 + i * 4); x.quadraticCurveTo(20, cy1 * 0.4 + i * 5, 36, ey * 0.5 + i * 2); x.stroke(); }
        }, ss);
      }
      K.mantaBody = bakeSpace('mantaBody', 0, 0, 11, 23, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, 0, 9, 20, 0, 0, 7); };
        x.fillStyle = C; path(); x.fill();
        bakeVolume(x, path, -20, 20, 'rgba(188,212,255,0.6)', 'rgba(10,18,38,0.55)');
        for (const s of [-1, 1]) {
          x.fillStyle = '#0a1226'; x.beginPath(); x.arc(s * 4, -12, 2.4, 0, 7); x.fill();
          x.fillStyle = 'rgba(255,255,255,0.6)'; x.beginPath(); x.arc(s * 4 - 0.7, -12.8, 0.6, 0, 7); x.fill();
        }
      }, ss);
      K.mantaTail = bakeSpace('mantaTail', 0, 18, 14, 32, (x) => {
        x.strokeStyle = C; x.lineWidth = 2; x.lineCap = 'round';
        x.beginPath(); x.moveTo(0, 18); x.quadraticCurveTo(4, 33, 0, 48); x.stroke();
      }, ss);
    }
    // ================= MINIBOSS: URCHIN =================
    {
      const C = '#ff5d73', G = '#ff9db0';
      K.urchinCore = bakeSpace('urchinCore', 0, 0, 22, 22, (x) => {
        const g = x.createRadialGradient(-5, -6, 2, 0, 0, 20);
        g.addColorStop(0, '#ffd7de'); g.addColorStop(0.45, G); g.addColorStop(1, C);
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, 19.6, 0, 7); x.fill();
        x.strokeStyle = 'rgba(90,10,30,0.5)'; x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 19, 0, 7); x.stroke();
        x.fillStyle = '#3a0812'; x.beginPath(); x.arc(0, 0, 7.8, 0, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(-2.4, -2.6, 2, 0, 7); x.fill();
      }, ss);
      K.urchinSpike = bakeSpace('urchinSpike', 0, 0, 5, 42, (x) => {
        const g = x.createLinearGradient(0, 0, 0, -40);
        g.addColorStop(0, C); g.addColorStop(0.8, '#ff8ba0'); g.addColorStop(1, '#fff0f3');
        x.fillStyle = g;
        x.beginPath(); x.moveTo(-2.6, 0); x.lineTo(0, -40); x.lineTo(2.6, 0); x.closePath(); x.fill();
        x.fillStyle = '#fff'; x.beginPath(); x.arc(0, -40, 1.4, 0, 7); x.fill();
      }, ss);
    }
    // ================= MINIBOSS: MORAY =================
    {
      const C = '#8fd36a', G = '#d4ff9a';
      K.morayHead = bakeSpace('morayHead', 0, 0, 24, 14, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, 0, 14, 10, 0, 0, 7); };
        x.fillStyle = '#122a0e'; path(); x.fill();
        bakeVolume(x, path, -10, 10, 'rgba(143,211,106,0.75)', 'rgba(211,255,154,0.26)');
        x.strokeStyle = hexA(G, 0.5); x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(-10, 4); x.quadraticCurveTo(-2, 7, 8, 4); x.stroke();
        bakeEye(x, 2, -5, 2.4, '#ffffff', '#0a1408');
      }, ss);
      K.morayJawU = bakeSpace('morayJawU', 6, 0, 18, 10, (x) => {
        x.beginPath(); x.moveTo(6, 1.2); x.lineTo(22, -6); x.lineTo(22, 1.2); x.closePath();
        const g = x.createLinearGradient(6, 0, 22, -6);
        g.addColorStop(0, '#0a1408'); g.addColorStop(1, '#030a04');
        x.fillStyle = g; x.fill();
        x.strokeStyle = hexA(G, 0.4); x.lineWidth = 0.8; x.stroke();
        for (let i = -1; i <= 1; i++) bakeTooth(x, 8, i * 3, 14, i * 4, 8, i * 3 + 2);
      }, ss);
      K.morayJawL = bakeSpace('morayJawL', 6, 0, 18, 10, (x) => {
        x.beginPath(); x.moveTo(6, -1.2); x.lineTo(22, 6); x.lineTo(22, -1.2); x.closePath();
        const g = x.createLinearGradient(6, 0, 22, 6);
        g.addColorStop(0, '#0a1408'); g.addColorStop(1, '#030a04');
        x.fillStyle = g; x.fill();
        x.strokeStyle = hexA(G, 0.3); x.lineWidth = 0.8; x.stroke();
        for (let i = -1; i <= 1; i++) bakeTooth(x, 8, i * 3 + 1.6, 14, i * 4 + 1.6, 8, i * 3 + 3.2);
      }, ss);
    }
    // ================= MINIBOSS: LANTERNFISH KING =================
    {
      const C = '#ffd06a', G = '#fff0c0';
      K.kingBody = bakeSpace('kingBody', 0, 0, 32, 19, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, 0, 30, 17, 0, 0, 7); };
        x.fillStyle = '#3a2a08'; path(); x.fill();
        x.save(); path(); x.clip();
        const g = x.createLinearGradient(0, -17, 0, 17);
        g.addColorStop(0, 'rgba(255,232,160,0.8)'); g.addColorStop(0.5, 'rgba(255,208,106,0.55)'); g.addColorStop(1, 'rgba(30,18,2,0.6)');
        x.fillStyle = g; x.fillRect(-32, -19, 64, 38);
        x.restore();
        x.strokeStyle = hexA(G, 0.6); x.lineWidth = 2; path(); x.stroke();
        x.beginPath(); x.moveTo(24, 4); x.quadraticCurveTo(34, 8, 24, 12); x.closePath();
        x.fillStyle = '#0a0602'; x.fill();
        bakeEye(x, 18, -4, 4, '#ffffff', '#0a0602');
      }, ss);
      K.kingTail = bakeSpace('kingTail', -26, 0, 20, 16, (x) => {
        x.beginPath(); x.moveTo(-26, 0); x.lineTo(-44, -14); x.lineTo(-40, 0); x.lineTo(-44, 14); x.closePath();
        const g = x.createLinearGradient(-44, 0, -26, 0);
        g.addColorStop(0, 'rgba(255,208,106,0.25)'); g.addColorStop(1, 'rgba(255,208,106,0.85)');
        x.fillStyle = g; x.fill();
        x.strokeStyle = 'rgba(255,240,192,0.35)'; x.lineWidth = 0.8; x.stroke();
      }, ss);
      K.kingLanterns = bakeSpace('kingLanterns', 0, -12, 22, 14, (x) => {
        for (let i = -2; i <= 2; i++) {
          const lx = i * 9, ly = -16 + Math.abs(i) * 2;
          x.strokeStyle = hexA(G, 0.5); x.lineWidth = 1;
          x.beginPath(); x.moveTo(lx, -12); x.lineTo(lx, ly - 6); x.stroke();
          const lg = x.createRadialGradient(lx, ly - 8, 0, lx, ly - 8, 3.4);
          lg.addColorStop(0, '#fffdf2'); lg.addColorStop(0.45, 'rgba(255,246,208,0.75)'); lg.addColorStop(1, 'rgba(255,246,208,0)');
          x.fillStyle = lg; x.beginPath(); x.arc(lx, ly - 8, 3.4, 0, 7); x.fill();
        }
      }, ss);
    }
    // ================= MINIBOSS: KRAKEN =================
    {
      const C = '#b06ae0', G = '#e0aaff';
      K.krakenHead = bakeSpace('krakenHead', 0, -8, 24, 26, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, -8, 22, 24, 0, 0, 7); };
        x.fillStyle = C; path(); x.fill();
        bakeVolume(x, path, -32, 16, 'rgba(224,170,255,0.55)', 'rgba(24,6,40,0.5)');
        const ig = x.createRadialGradient(0, -14, 0, 0, -14, 16);
        ig.addColorStop(0, hexA(G, 0.55)); ig.addColorStop(1, hexA(G, 0));
        x.fillStyle = ig; x.beginPath(); x.ellipse(0, -14, 16, 14, 0, 0, 7); x.fill();
        for (const s of [-1, 1]) {
          x.fillStyle = 'rgba(255,255,255,0.92)'; x.beginPath(); x.ellipse(s * 9, -10, 5, 6, 0, 0, 7); x.fill();
          x.fillStyle = '#12041a'; x.beginPath(); x.ellipse(s * 9, -10, 1.6, 4, 0, 0, 7); x.fill();
          x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.arc(s * 9 - 1.6, -12.4, 0.9, 0, 7); x.fill();
        }
      }, ss);
    }
    // ================= MINIBOSS: SERPENT =================
    {
      const C = '#5ef2c8', G = '#a8ffe8';
      K.serpHead = bakeSpace('serpHead', 0, 0, 14, 10, (x) => {
        const path = () => { x.beginPath(); x.ellipse(0, 0, 12, 8, 0, 0, 7); };
        x.fillStyle = C; path(); x.fill();
        bakeVolume(x, path, -8, 8, 'rgba(220,255,240,0.6)', 'rgba(4,36,28,0.45)');
        bakeEye(x, 4, -3, 2.4, '#ffffff', '#04241c');
      }, ss);
      K.serpFin = bakeSpace('serpFin', 0, 0, 12, 12, (x) => {
        x.fillStyle = hexA(G, 0.45);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(-10, -9); x.lineTo(-10, 0); x.closePath(); x.fill();
      }, ss);
    }
    // ================= FINAL BOSS: MATRIARCH =================
    for (const enr of [false, true]) {
      const s = enr ? 'E' : '';
      const fill = enr ? '#5a1830' : '#3a1430', rim = enr ? '#ff5d73' : '#ff9db0';
      K['bossBell' + s] = bakeSpace('bossBell' + s, 0, -10, 54, 50, (x) => {
        const path = () => {
          x.beginPath(); x.moveTo(-44, 20);
          x.bezierCurveTo(-52, -30, -26, -54, 0, -54);
          x.bezierCurveTo(26, -54, 52, -30, 44, 20);
          x.quadraticCurveTo(0, 34, -44, 20); x.closePath();
        };
        x.fillStyle = fill; path(); x.fill();
        x.save(); path(); x.clip();
        const g = x.createLinearGradient(0, -54, 0, 30);
        g.addColorStop(0, hexA(rim, 0.5)); g.addColorStop(0.4, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
        x.fillStyle = g; x.fillRect(-54, -56, 108, 92);
        x.restore();
        path(); x.strokeStyle = rim; x.lineWidth = 2.5; x.stroke();
      }, ss);
      K['bossJaw' + s] = bakeSpace('bossJaw' + s, 0, 18, 28, 16, (x) => {
        x.beginPath(); x.moveTo(-26, 6); x.quadraticCurveTo(0, 40, 26, 6); x.quadraticCurveTo(0, 18, -26, 6); x.closePath();
        x.fillStyle = '#0a0208'; x.fill();
        for (let i = -3; i <= 3; i++) { const fx = i * 7; bakeTooth(x, fx - 2.5, 8, fx, 8 + (i % 2 ? 9 : 13), fx + 2.5, 8); }
      }, ss);
    }
    K.bossEyes = bakeSpace('bossEyes', 0, -22, 28, 10, (x) => {
      for (const s of [-1, 1]) bakeEye(x, s * 18, -22, 7, '#ffffff', '#0a0208', 1.7);
    }, ss);
    K.bossLure = bakeSpace('bossLure', 0, -52, 14, 52, (x) => {
      x.strokeStyle = '#ffd0d8'; x.lineWidth = 2; x.lineCap = 'round';
      x.beginPath(); x.moveTo(0, -52); x.quadraticCurveTo(6, -80, 2, -96); x.stroke();
      const lg = x.createRadialGradient(2, -96, 0, 2, -96, 6);
      lg.addColorStop(0, '#fffdf2'); lg.addColorStop(1, 'rgba(255,242,192,0)');
      x.fillStyle = lg; x.beginPath(); x.arc(2, -96, 6, 0, 7); x.fill();
    }, ss);
    return K;
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

  // ---- per-act underwater scenery: far parallax haze + readable mid layer ----
  function drawBackground() {
    const ww = game.ww, wh = game.wh;
    const key = game.levelIndex + ':' + ww + 'x' + wh;
    if (bgKey === key) return;
    bgKey = key;
    // ---- AI art plates: cover the world, tinted per act, two parallax depths ----
    if (bgImagesReady && bgImageCache.has(game.levelIndex)) {
      const tex = bgImageCache.get(game.levelIndex);
      bgFarSprite.texture = tex;
      bgNearSprite.texture = tex;
      // Plates are oversized so the parallax offsets (up to ~40% of the world at
      // small windows) never expose a gap at the world edges.
      const fw = ww * 1.8, fh = wh * 1.8;
      bgFarSprite.width = fw; bgFarSprite.height = fh;
      bgFarSprite.position.set(ww / 2, wh / 2);
      bgFarSprite.alpha = 0.5;
      bgFarSprite.tint = 0x7d93b4;          // push the far ghost cold + dim
      bgNearSprite.width = ww * 1.4; bgNearSprite.height = wh * 1.4;
      bgNearSprite.position.set(ww / 2, wh / 2);
      bgNearSprite.alpha = 1; bgNearSprite.tint = 0xffffff;
      bgFarSprite.visible = true; bgNearSprite.visible = true;
      bgG.visible = false; bgFarG.visible = false;   // procedural layers would double-draw
      return;
    }
    if (bgFarSprite) bgFarSprite.visible = false;
    if (bgNearSprite) bgNearSprite.visible = false;
    bgG.visible = true; bgFarG.visible = true;
    bgG.clear(); bgFarG.clear();
    const p = game.pal || { ray: '#9adeff', surf: '#afeeff' };
    const ray = hexInt(p.ray), surf = hexInt(p.surf);
    const floor = wh - TILE;
    const act = game.levelIndex;
    const hash = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
    const X0 = -ww * 0.4, X1 = ww * 1.4;

    // ================= FAR LAYER (scrolls slower = depth) =================
    for (let i = 0; i < 12; i++) {
      const y0 = (i / 12) * wh, y1 = ((i + 1) / 12) * wh + 1;
      bgFarG.rect(X0, y0, X1 - X0, y1 - y0).fill({ color: ray, alpha: 0.03 * (1 - i / 12) });
    }
    const ridge = (yBase, amp, col, a, step, ph) => {
      bgFarG.moveTo(X0, wh);
      for (let x = X0; x <= X1; x += step) {
        const y = yBase + Math.sin(x * 0.0017 + ph) * amp + Math.sin(x * 0.0043 + ph * 2) * amp * 0.42;
        bgFarG.lineTo(x, y);
      }
      bgFarG.lineTo(X1, wh).closePath().fill({ color: col, alpha: a });
    };
    ridge(floor - 200, 54, 0x0b1c30, 0.55, 96, 0.7);
    ridge(floor - 126, 34, 0x122941, 0.6, 72, 2.1);
    for (let i = 0; i < 7; i++) {
      const x = X0 + ((i + 0.5) / 7) * (X1 - X0);
      const hh = 120 + hash(i, 3) * 170;
      bgFarG.rect(x, floor - hh, 4, hh).fill({ color: ray, alpha: 0.05 });
      bgFarG.circle(x + 2, floor - hh, 6).fill({ color: surf, alpha: 0.07 });
    }
    for (let s = 0; s < 6; s++) {
      const sx = X0 + hash(s, 9) * (X1 - X0), sy = wh * (0.16 + hash(s, 4) * 0.52);
      for (let i = 0; i < 13; i++) {
        const fx = sx + (hash(s, i) - 0.5) * 240, fy = sy + (hash(i, s) - 0.5) * 62;
        bgFarG.ellipse(fx, fy, 4.6, 1.9).fill({ color: 0x9fd6ff, alpha: 0.10 });
      }
    }

    // ================= MID LAYER helpers =================
    const coral = (x, y, s, col, a) => {
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI / 2 + (i - 2) * 0.46;
        const len = s * (0.72 + (i % 3) * 0.24);
        const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
        bgG.moveTo(x, y)
          .quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + s * 0.16, y + Math.sin(ang) * len * 0.55, x1, y1)
          .stroke({ width: s * 0.2, color: col, alpha: a, cap: 'round' });
        bgG.circle(x1, y1, s * 0.11).fill({ color: col, alpha: a * 0.9 });
      }
      bgG.ellipse(x, y + 2, s * 0.34, s * 0.14).fill({ color: 0x101a24, alpha: a });
    };
    const kelpStalk = (x, y, h, col, a) => {
      const segs = 8;
      let px = x, py = y;
      for (let i = 1; i <= segs; i++) {
        const tt = i / segs;
        const bx = x + Math.sin(tt * 3.1 + x * 0.02) * h * 0.06;
        const by = y - h * tt;
        bgG.moveTo(px, py).lineTo(bx, by).stroke({ width: 7 - tt * 4, color: col, alpha: a, cap: 'round' });
        if (i % 2 === 0) bgG.ellipse(bx + 7, by, 9, 3).fill({ color: col, alpha: a * 0.55 });
        px = bx; py = by;
      }
    };
    const column = (x, y, w, h, broken) => {
      bgG.rect(x - w / 2, y - h, w, h).fill({ color: 0x2b3d52, alpha: 0.85 });
      bgG.rect(x - w / 2, y - h, 3, h).fill({ color: surf, alpha: 0.16 });
      for (let i = 1; i < 5; i++) {
        const fy = y - h + (h / 5) * i;
        bgG.moveTo(x - w / 2 + 4, fy).lineTo(x + w / 2 - 4, fy).stroke({ width: 1, color: 0x0a1420, alpha: 0.5 });
      }
      if (!broken) bgG.rect(x - w * 0.72, y - h - 9, w * 1.44, 9).fill({ color: 0x35495f, alpha: 0.9 });
      else bgG.moveTo(x - w / 2, y - h).lineTo(x + w / 2, y - h + 16).lineTo(x + w / 2, y - h + 26).lineTo(x - w / 2, y - h + 8).closePath().fill({ color: 0x223142, alpha: 0.9 });
    };
    const crystal = (x, y, s, col, a) => {
      bgG.moveTo(x, y - s).lineTo(x + s * 0.34, y - s * 0.3).lineTo(x + s * 0.2, y)
        .lineTo(x - s * 0.2, y).lineTo(x - s * 0.34, y - s * 0.3).closePath()
        .fill({ color: col, alpha: a });
      bgG.moveTo(x, y - s).lineTo(x, y).stroke({ width: 1, color: 0xffffff, alpha: a * 0.4 });
    };
    const ledge = (x, y, w, h, col) => {
      bgG.moveTo(x, y).lineTo(x + w * 0.18, y - h).lineTo(x + w * 0.82, y - h).lineTo(x + w, y)
        .closePath().fill({ color: col, alpha: 0.9 });
      bgG.moveTo(x + w * 0.18, y - h).lineTo(x + w * 0.82, y - h).stroke({ width: 2, color: surf, alpha: 0.14 });
    };
    const bubbles = (x, y, h, n, a) => {
      for (let i = 0; i < n; i++) {
        const tt = i / n;
        bgG.circle(x + Math.sin(tt * 7 + x) * 9, y - h * tt, 1.6 + hash(i, x) * 2.2)
          .fill({ color: surf, alpha: a * (1 - tt * 0.6) });
      }
    };

    // ================= MID LAYER per act =================
    if (act === 0) {
      // The Trench: canyon walls with ledges, coral gardens, a far trench mouth
      bgG.rect(0, 0, ww * 0.06, wh).fill({ color: 0x0e2135, alpha: 0.9 });
      bgG.rect(ww * 0.94, 0, ww * 0.06, wh).fill({ color: 0x0e2135, alpha: 0.9 });
      for (let i = 0; i < 9; i++) {
        const y = wh * (0.08 + i * 0.1);
        ledge(0, y, ww * (0.10 + hash(i, 1) * 0.05), 26 + hash(i, 2) * 22, 0x16304a);
        ledge(ww - ww * (0.10 + hash(i, 5) * 0.05), y + 40, ww * 0.12, 24 + hash(i, 6) * 20, 0x142c44);
      }
      for (let i = 0; i < 16; i++) {
        const x = ww * (0.08 + (i / 16) * 0.86);
        coral(x, floor - 4, 16 + hash(i, 7) * 20, i % 3 === 0 ? 0xff8f6a : (i % 3 === 1 ? 0x63e0c8 : 0xffd166), 0.5);
      }
      for (let i = 0; i < 7; i++) ledge(ww * (0.12 + i * 0.12), floor, 90 + hash(i, 8) * 60, 20 + hash(i, 9) * 18, 0x10253a);
      bgFarG.ellipse(ww * 0.5, floor - 250, ww * 0.16, 90).fill({ color: 0x01060e, alpha: 0.5 });
      bubbles(ww * 0.22, floor, wh * 0.5, 16, 0.16);
      bubbles(ww * 0.72, floor, wh * 0.42, 14, 0.14);
    } else if (act === 1) {
      // The Drift: a kelp forest under the light
      for (let i = 0; i < 26; i++) {
        const x = ww * (0.02 + (i / 26) * 0.96) + hash(i, 2) * 30;
        kelpStalk(x, floor + 6, wh * (0.42 + hash(i, 3) * 0.5), i % 4 === 0 ? 0x2f8f6b : 0x24735a, 0.55);
      }
      bgG.rect(0, 0, ww, wh * 0.1).fill({ color: surf, alpha: 0.10 });
      for (let i = 0; i < 12; i++) coral(ww * (0.05 + i * 0.078), floor - 2, 14 + hash(i, 4) * 14, 0x63e0c8, 0.42);
      for (let i = 0; i < 8; i++) ledge(ww * (0.06 + i * 0.115), floor, 80 + hash(i, 5) * 50, 16 + hash(i, 6) * 14, 0x123a34);
      bubbles(ww * 0.35, floor, wh * 0.7, 20, 0.15);
    } else if (act === 2) {
      // The Lure: a drowned temple
      for (let i = 0; i < 8; i++) {
        const x = ww * (0.08 + i * 0.115);
        column(x, floor, 34, 190 + hash(i, 1) * 90, i % 3 === 0);
      }
      bgG.moveTo(ww * 0.30, floor - 250).quadraticCurveTo(ww * 0.5, floor - 350, ww * 0.70, floor - 250)
        .lineTo(ww * 0.66, floor - 236).quadraticCurveTo(ww * 0.5, floor - 322, ww * 0.34, floor - 236).closePath()
        .fill({ color: 0x2b3d52, alpha: 0.8 });
      bgG.rect(ww * 0.2, floor, ww * 0.6, 12).fill({ color: 0x24344a, alpha: 0.9 });
      bgG.rect(ww * 0.24, floor - 12, ww * 0.52, 12).fill({ color: 0x2b3d52, alpha: 0.85 });
      for (let i = 0; i < 6; i++) {
        const x = ww * (0.14 + i * 0.14);
        bgG.moveTo(x, 0).lineTo(x + 2, wh * 0.24).stroke({ width: 1.4, color: 0x8fa8c8, alpha: 0.35 });
        bgG.circle(x + 2, wh * 0.24 + 6, 5).fill({ color: 0xffe6a8, alpha: 0.5 });
      }
      for (let i = 0; i < 10; i++) coral(ww * (0.07 + i * 0.09), floor + 8, 13 + hash(i, 7) * 12, 0x9d8cff, 0.42);
    } else if (act === 3) {
      // The Gauntlet: a ship graveyard
      const hx = ww * 0.5, hy = floor - 30, hl = ww * 0.46;
      bgG.moveTo(hx - hl, hy).quadraticCurveTo(hx, hy - 150, hx + hl, hy - 40)
        .lineTo(hx + hl * 0.9, hy + 30).quadraticCurveTo(hx, hy - 40, hx - hl * 0.92, hy + 30).closePath()
        .fill({ color: 0x2a2118, alpha: 0.85 });
      for (let i = 0; i < 11; i++) {
        const t0 = i / 10, x = hx - hl + t0 * hl * 2;
        const yTop = hy - 130 * Math.sin(Math.PI * t0) - 6;
        bgG.moveTo(x, hy + 20).lineTo(x, yTop).stroke({ width: 3, color: 0x4a3a26, alpha: 0.8 });
      }
      bgG.moveTo(hx, hy - 120).lineTo(hx, hy - 330).stroke({ width: 6, color: 0x4a3a26, alpha: 0.9 });
      bgG.moveTo(hx - 90, hy - 300).lineTo(hx + 80, hy - 292).stroke({ width: 3, color: 0x4a3a26, alpha: 0.7 });
      bgG.moveTo(hx + 4, hy - 320).quadraticCurveTo(hx + 90, hy - 250, hx + 30, hy - 170)
        .lineTo(hx + 6, hy - 180).closePath().fill({ color: 0x6b5a40, alpha: 0.35 });
      for (let i = 0; i < 5; i++) {
        const x = ww * (0.1 + i * 0.2);
        bgG.rect(x, floor - 34, 46, 34).fill({ color: 0x33291d, alpha: 0.85 });
        bgG.moveTo(x, floor - 34).lineTo(x + 46, floor).stroke({ width: 2, color: 0x4a3a26, alpha: 0.7 });
      }
      for (let i = 0; i < 12; i++) coral(ww * (0.06 + i * 0.077), floor - 2, 12 + hash(i, 3) * 14, i % 2 ? 0x63e0c8 : 0xff8f6a, 0.45);
      bubbles(hx - hl * 0.4, hy - 60, wh * 0.4, 16, 0.14);
    } else if (act === 4) {
      // The Ascent: terraces climbing toward the light
      bgG.rect(0, 0, ww, wh * 0.16).fill({ color: surf, alpha: 0.16 });
      for (let i = 0; i < 7; i++) {
        const y = wh * (0.9 - i * 0.115);
        const x = ww * (i % 2 ? 0.52 : 0.04);
        ledge(x, y, ww * 0.44, 30 + hash(i, 1) * 26, 0x14405a);
        for (let c = 0; c < 4; c++) crystal(x + 30 + c * 60, y - 6, 20 + hash(i, c) * 16, 0xbfeaff, 0.35);
      }
      for (let i = 0; i < 9; i++) bubbles(ww * (0.08 + i * 0.1), floor, wh * (0.5 + hash(i, 5) * 0.4), 14, 0.16);
      for (let i = 0; i < 10; i++) coral(ww * (0.05 + i * 0.095), floor - 2, 13 + hash(i, 7) * 12, 0x63e0c8, 0.4);
    } else if (act === 5) {
      // The Hollow: a crystal cavern
      for (let i = 0; i < 14; i++) {
        const x = ww * (0.03 + (i / 14) * 0.94), s = 60 + hash(i, 1) * 130;
        bgG.moveTo(x - 16, 0).lineTo(x, s).lineTo(x + 16, 0).closePath().fill({ color: 0x101a34, alpha: 0.9 });
      }
      for (let i = 0; i < 12; i++) {
        const x = ww * (0.05 + (i / 12) * 0.9), s = 70 + hash(i, 2) * 150;
        bgG.moveTo(x - 18, floor + 4).lineTo(x, floor - s).lineTo(x + 18, floor + 4).closePath().fill({ color: 0x0f1830, alpha: 0.92 });
        crystal(x + 4, floor - s + 8, 26 + hash(i, 3) * 20, 0x8fa8ff, 0.4);
      }
      for (let i = 0; i < 18; i++) crystal(ww * hash(i, 6), floor - 6 - hash(i, 8) * 40, 18 + hash(i, 9) * 26, 0xa8b8ff, 0.32);
      bgFarG.ellipse(ww * 0.5, floor - 120, 150, 60).fill({ color: 0x4a5cff, alpha: 0.10 });
    } else if (act === 6) {
      // The Matriarch: an ember-lit organic cathedral
      for (let i = 0; i < 10; i++) {
        const x = ww * (0.04 + (i / 10) * 0.92), s = 120 + hash(i, 1) * 190;
        bgG.moveTo(x - 26, floor + 6).quadraticCurveTo(x - 8, floor - s * 0.6, x, floor - s)
          .quadraticCurveTo(x + 8, floor - s * 0.6, x + 26, floor + 6).closePath().fill({ color: 0x2a0f22, alpha: 0.9 });
        bgG.moveTo(x, floor - s).lineTo(x + 4, floor - s * 0.4).stroke({ width: 2, color: 0xff9db0, alpha: 0.25 });
      }
      for (let i = 0; i < 16; i++) {
        const x = ww * hash(i, 3), y = wh * (0.12 + hash(i, 4) * 0.5);
        bgG.ellipse(x, y, 12 + hash(i, 5) * 10, 16 + hash(i, 6) * 12).fill({ color: 0x5a1830, alpha: 0.5 });
        bgG.circle(x, y + 2, 4).fill({ color: 0xffc2cd, alpha: 0.35 });
      }
      bgG.moveTo(0, wh * 0.1).quadraticCurveTo(ww * 0.5, wh * 0.24, ww, wh * 0.1).lineTo(ww, 0).lineTo(0, 0).closePath()
        .fill({ color: 0x1c0a18, alpha: 0.8 });
    } else {
      // The Surface: dawn over a last reef
      const wl = wh * 0.14;
      bgG.rect(0, 0, ww, wl).fill({ color: 0xffd9a0, alpha: 0.34 });
      bgG.rect(0, wl, ww, wh * 0.1).fill({ color: 0xffe6c0, alpha: 0.14 });
      bgG.circle(ww * 0.72, wl * 0.45, 46).fill({ color: 0xfff4d0, alpha: 0.5 });
      bgG.moveTo(ww * 0.16, wl).quadraticCurveTo(ww * 0.24, wl - 70, ww * 0.34, wl)
        .closePath().fill({ color: 0x123048, alpha: 0.8 });
      bgG.moveTo(0, wl).lineTo(ww, wl).stroke({ width: 3, color: 0xfff0cf, alpha: 0.5 });
      for (let i = 0; i < 24; i++) {
        const x = (i / 24) * ww;
        bgG.moveTo(x, wl + Math.sin(x * 0.05) * 3).lineTo(x + 8, wl + 10 + Math.sin(x * 0.05) * 4)
          .stroke({ width: 2, color: 0xfff0cf, alpha: 0.2 });
      }
      for (let i = 0; i < 14; i++) {
        const x = ww * (0.04 + i * 0.07);
        coral(x, floor - 2, 18 + hash(i, 2) * 18, i % 3 === 0 ? 0xff8f6a : (i % 3 === 1 ? 0xffd166 : 0x63e0c8), 0.55);
      }
      for (let i = 0; i < 8; i++) ledge(ww * (0.05 + i * 0.12), floor, 100 + hash(i, 5) * 60, 22 + hash(i, 6) * 16, 0x123048);
      bubbles(ww * 0.5, floor, wh * 0.7, 22, 0.18);
    }

    bgFarLayer.alpha = 1;
    bgLayer.alpha = 1;
  }

  // ---- themed obstacles: kelp, whirlpools, geysers, spine clusters ----
  function drawObstacles() {
    kelpG.clear();
    hazG.clear();
    const t = game.time;
    for (const kp of (game.kelp || [])) {
      const bx = kp.x * TILE + TILE / 2, by = (kp.y + 1) * TILE;
      const h = TILE * (1.5 + ((kp.x * 7 + kp.y * 13) % 5) * 0.28);
      for (let s = 0; s < 3; s++) {
        const off = (s - 1) * 5;
        const sway = Math.sin(t * 1.4 + kp.x * 0.8 + s * 1.1) * 10;
        let px0 = bx + off, py0 = by;
        for (let i = 1; i <= 6; i++) {
          const tt = i / 6;
          const x1 = bx + off + sway * tt * tt, y1 = by - h * tt;
          kelpG.moveTo(px0, py0).lineTo(x1, y1)
            .stroke({ width: 5 - tt * 2.8, color: s === 1 ? 0x3fae72 : 0x2b7d55, alpha: 0.8, cap: 'round' });
          px0 = x1; py0 = y1;
        }
        kelpG.ellipse(bx + off + sway * 0.55, by - h * 0.55, 6, 2.4).fill({ color: 0x4fc98a, alpha: 0.35 });
      }
    }
    for (const wp of (game.whirlpools || [])) {
      const spin = t * 1.9 + wp.ph;
      for (let a = 0; a < 4; a++) {
        const base = spin + (a / 4) * Math.PI * 2;
        for (let i = 0; i < 12; i++) {
          const tt = i / 12, tt2 = (i + 1) / 12;
          const r0 = 20 + tt * 118, r1 = 20 + tt2 * 118;
          const a0 = base + tt * 2.4, a1 = base + tt2 * 2.4;
          hazG.moveTo(wp.x + Math.cos(a0) * r0, wp.y + Math.sin(a0) * r0)
            .lineTo(wp.x + Math.cos(a1) * r1, wp.y + Math.sin(a1) * r1)
            .stroke({ width: 7 - tt * 4, color: 0x7fd4ff, alpha: 0.3 * (1 - tt), cap: 'round' });
        }
      }
      hazG.circle(wp.x, wp.y, 26).fill({ color: 0x010a16, alpha: 0.92 });
      hazG.circle(wp.x, wp.y, 26).stroke({ width: 2, color: 0x9fe8ff, alpha: 0.55 });
      glow(TEX_SOFT, wp.x, wp.y, 62, 0x4fb8ff, 0.24 + 0.08 * Math.sin(t * 3));
    }
    for (const gz of (game.geysers || [])) {
      const cyc = Math.sin(t * 1.35 + gz.ph);
      const heat = cyc > 0.35 ? clamp((cyc - 0.35) / 0.65, 0, 1) : 0;
      hazG.ellipse(gz.x, gz.y, 17, 7).fill({ color: 0x241a12, alpha: 1 });
      hazG.ellipse(gz.x, gz.y - 2, 11, 4).fill({ color: heat > 0 ? 0xff9a5a : 0x3a2a20, alpha: 0.9 });
      if (heat > 0) {
        for (let i = 0; i < 10; i++) {
          const tt = i / 10;
          const spread = 6 + tt * 24;
          const wob = Math.sin(t * 6 + i * 1.3) * spread * 0.5;
          hazG.ellipse(gz.x + wob, gz.y - 6 - tt * 220 * heat, spread * 0.55, 7)
            .fill({ color: 0x9fe8ff, alpha: 0.15 * (1 - tt) * heat });
        }
        glow(TEX_SOFT, gz.x, gz.y - 40 * heat, 48, 0x7fd4ff, 0.28 * heat);
      }
    }
    for (const sp of (game.spikes || [])) {
      const pulse = 1 + 0.06 * Math.sin(t * 2.4 + sp.ph);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.42;
        const len = (15 + (i % 3) * 5) * pulse;
        const x0 = sp.x + Math.cos(a) * 4, y0 = sp.y + 8 + Math.sin(a) * 3;
        const x1 = sp.x + Math.cos(a) * len, y1 = sp.y + 8 + Math.sin(a) * len;
        const mx = (x0 + x1) / 2 + Math.cos(a + 1.57) * 3, my = (y0 + y1) / 2;
        hazG.moveTo(x0, y0).quadraticCurveTo(mx, my, x1, y1)
          .stroke({ width: 4.2 - (i % 3), color: 0xb45cff, alpha: 0.9, cap: 'round' });
        hazG.circle(x1, y1, 1.9).fill({ color: 0xffc8ff, alpha: 0.9 });
      }
      hazG.ellipse(sp.x, sp.y + 9, 13, 5).fill({ color: 0x3a1050, alpha: 0.95 });
      glow(TEX_SOFT, sp.x, sp.y + 2, 28, 0xb45cff, 0.3);
    }
  }

  // ---- decorative life: flowy seaweed + coral on the floor, harmless animals ----
  // Pure scenery (no collision). Seeded per level so the layout is stable across
  // frames; seaweed sways with time, coral is static, and a few ambient creatures
  // (turtle / seahorse / dolphin / fish) drift through the water for life.
  function drawAmbient() {
    ambG.clear();
    const t = game.time, li = game.levelIndex | 0;
    const ww = game.ww, wh = game.wh, T = TILE;
    // small seeded RNG (mulberry32) so decor is stable per act
    let seed = 1337 + li * 991;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let z = Math.imul(seed ^ seed >>> 15, 1 | seed); z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z; return ((z ^ z >>> 14) >>> 0) / 4294967296; };
    const floor = wh - T * 0.2;

    // ---- flowy seaweed: long, streaming multi-blade strands rooted on the floor ----
    const nKelp = 10 + (li % 4) * 2;
    for (let i = 0; i < nKelp; i++) {
      const bx = (i / nKelp) * ww + rnd() * T * 1.8 + T * 0.3;
      const h = T * (3.6 + rnd() * 4.6);          // longer strands than before
      const blades = 4 + Math.floor(rnd() * 4);    // 4-7 blades per clump
      const hue = rnd();
      const col = hue < 0.5 ? 0x2f9e63 : (hue < 0.8 ? 0x37b06e : 0x2b8a5a);
      const basePh = i * 0.7 + rnd() * 6;
      const amp = 16 + h * 0.11;                   // sway scales with strand length
      for (let s = 0; s < blades; s++) {
        const off = (s - blades / 2) * 7;
        const ph = t * (0.8 + rnd() * 0.6) + basePh + s * 0.8;
        const seg = 16;
        const left = [], right = [];
        for (let k = 0; k <= seg; k++) {
          const tt = k / seg;
          // layered sway: a slow primary drift + a faster tip wave = a flowy stream
          const sway = Math.sin(ph + tt * 1.4) * amp * tt
                     + Math.sin(ph * 0.55 + tt * 3.1 + s) * (amp * 0.5) * tt * tt;
          const x1 = bx + off + sway + Math.sin(ph + tt * 4) * 3 * tt;
          const y1 = floor - h * tt;
          const wdt = (6.5 - tt * 5.6) * (0.72 + rnd() * 0.18);   // wide base, fine tip
          left.push([x1 - wdt / 2, y1]); right.push([x1 + wdt / 2, y1]);
        }
        ambG.moveTo(left[0][0], left[0][1]);
        for (const p of left) ambG.lineTo(p[0], p[1]);
        for (let k = right.length - 1; k >= 0; k--) ambG.lineTo(right[k][0], right[k][1]);
        ambG.closePath().fill({ color: col, alpha: 0.5 });
        // bright mid-rib
        ambG.moveTo(left[0][0], left[0][1]);
        for (const p of left) ambG.lineTo(p[0] + 2, p[1]);
        ambG.stroke({ width: 1.2, color: 0x7fe0a8, alpha: 0.35, cap: 'round' });
      }
    }

    // ---- coral: branching fan + brain mounds on the floor ----
    const nCoral = 6 + (li % 3) * 2;
    for (let i = 0; i < nCoral; i++) {
      const bx = (i / nCoral) * ww + rnd() * T * 1.2 + T * 0.3;
      const kind = rnd();
      if (kind < 0.55) {
        // branching fan coral
        const arms = 5 + Math.floor(rnd() * 4), h = T * (0.9 + rnd() * 1.1);
        const col = [0xe06a8a, 0xd98a4a, 0x9a6ad9, 0xe0c25a][Math.floor(rnd() * 4)];
        for (let a = 0; a < arms; a++) {
          const ang = -Math.PI / 2 + (a / (arms - 1) - 0.5) * 1.7;
          const len = h * (0.7 + rnd() * 0.5);
          const x1 = bx + Math.cos(ang) * len, y1 = floor + Math.sin(ang) * len;
          const mx = bx + Math.cos(ang + 0.25) * len * 0.5, my = floor + Math.sin(ang + 0.25) * len * 0.5;
          ambG.moveTo(bx, floor).quadraticCurveTo(mx, my, x1, y1)
            .stroke({ width: 4 - a * 0.2, color: col, alpha: 0.7, cap: 'round' });
          ambG.circle(x1, y1, 2.4).fill({ color: 0xffffff, alpha: 0.5 });
        }
        ambG.ellipse(bx, floor, 9, 4).fill({ color: col, alpha: 0.5 });
      } else {
        // brain / dome coral
        const r = T * (0.5 + rnd() * 0.5);
        const col = [0x5aa0c0, 0x8a6ad9, 0xc08a5a][Math.floor(rnd() * 3)];
        ambG.ellipse(bx, floor - r * 0.4, r, r * 0.7).fill({ color: col, alpha: 0.55 });
        for (let g = 0; g < 3; g++) {
          ambG.ellipse(bx + (rnd() - 0.5) * r, floor - r * 0.5 - rnd() * r * 0.4, r * (0.5 - g * 0.12), r * (0.3 - g * 0.08))
            .stroke({ width: 1.4, color: 0xffffff, alpha: 0.18 });
        }
      }
    }

    // ---- ambient animals: harmless, just swimming for looks ----
    const animals = [
      { kind: 'turtle', n: 1 + (li % 2) },
      { kind: 'seahorse', n: 1 + ((li + 1) % 2) },
      { kind: 'dolphin', n: 1 + (li % 2) },
      { kind: 'fish', n: 3 + (li % 3) },
    ];
    let ai = 0;
    for (const grp of animals) {
      for (let k = 0; k < grp.n; k++) {
        const sp = 22 + rnd() * 30, dir = rnd() < 0.5 ? 1 : -1;
        const baseY = T * (1.5 + rnd() * (wh / T - 3));
        const x0 = rnd() * ww;
        const bob = Math.sin(t * 0.6 + ai * 1.3) * 14;
        const x = ((x0 + t * sp * dir) % (ww + 200) + ww + 200) % (ww + 200) - 100;
        const y = baseY + bob;
        drawAmbientAnimal(ambG, grp.kind, x, y, dir, t, ai);
        ai++;
      }
    }
  }

  function drawAmbientAnimal(g, kind, x, y, dir, t, seed) {
    // PIXI.Graphics has no save/translate/rotate, so each animal is drawn in
    // local space and every point is mapped to world space by tf() (flip +
    // rotate + translate). Ellipses pass the animal's rotation directly.
    let ang = 0, d = dir;
    if (kind === 'turtle') ang = Math.sin(t * 1.1 + seed) * 0.1;
    else if (kind === 'seahorse') ang = Math.sin(t * 2 + seed) * 0.15;
    else if (kind === 'dolphin') ang = Math.sin(t * 0.8 + seed) * 0.12;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const tf = (lx, ly) => { const X = lx * d, Y = ly; return [x + X * ca - Y * sa, y + X * sa + Y * ca]; };
    const el = (lx, ly, rx, ry, col, a) => { const p = tf(lx, ly); g.ellipse(p[0], p[1], rx, ry, ang).fill({ color: col, alpha: a }); };
    const ci = (lx, ly, r, col, a) => { const p = tf(lx, ly); g.circle(p[0], p[1], r).fill({ color: col, alpha: a }); };
    if (kind === 'turtle') {
      el(0, 0, 16, 11, 0x3f7d5a, 0.85);
      el(0, 0, 11, 7, 0x5aa878, 0.7);
      for (let i = -1; i <= 1; i++) { const p = tf(i * 6, 0); g.ellipse(p[0], p[1], 4, 6, ang).stroke({ width: 1, color: 0x2b5a40, alpha: 0.5 }); }
      el(15, -1, 5, 4, 0x4f8d68, 0.85);
      el(-13, 4, 4, 3, 0x4f8d68, 0.7);
      el(11, -4, 4, 3, 0x4f8d68, 0.7);
      ci(17, -2, 1.4, 0x0a0a0a, 0.9);
    } else if (kind === 'seahorse') {
      el(0, -8, 4, 5, 0xd9a24a, 0.9);
      const b0 = tf(0, -4), b1 = tf(6, 2), b2 = tf(4, 10), b3 = tf(0, 12), b4 = tf(-3, 14), b5 = tf(-2, 18), b6 = tf(2, 18);
      g.moveTo(b0[0], b0[1]).bezierCurveTo(b1[0], b1[1], b2[0], b2[1], b3[0], b3[1])
        .bezierCurveTo(b4[0], b4[1], b5[0], b5[1], b6[0], b6[1])
        .stroke({ width: 5, color: 0xc98a3a, alpha: 0.9, cap: 'round' });
      el(0, 0, 3, 6, 0xe0b25a, 0.8);
      const s0 = tf(2, -12), s1 = tf(4, -15);
      g.moveTo(s0[0], s0[1]).lineTo(s1[0], s1[1]).stroke({ width: 1.5, color: 0xe0c25a, alpha: 0.9 });
      ci(1, -9, 1.2, 0x0a0a0a, 0.9);
    } else if (kind === 'dolphin') {
      el(0, 0, 20, 7, 0x6a93b8, 0.85);
      const n0 = tf(14, -2), n1 = tf(22, -8), n2 = tf(24, -2), n3 = tf(20, 0), n4 = tf(14, 2);
      g.moveTo(n0[0], n0[1]).quadraticCurveTo(n1[0], n1[1], n2[0], n2[1]).quadraticCurveTo(n3[0], n3[1], n4[0], n4[1]).closePath().fill({ color: 0x5a83a8, alpha: 0.85 });
      const t0 = tf(-16, 0), t1 = tf(-24, -6), t2 = tf(-22, 2), t3 = tf(-18, 4), t4 = tf(-14, 2);
      g.moveTo(t0[0], t0[1]).quadraticCurveTo(t1[0], t1[1], t2[0], t2[1]).quadraticCurveTo(t3[0], t3[1], t4[0], t4[1]).closePath().fill({ color: 0x5a83a8, alpha: 0.8 });
      const f0 = tf(2, 4), f1 = tf(6, 10), f2 = tf(2, 12);
      g.moveTo(f0[0], f0[1]).quadraticCurveTo(f1[0], f1[1], f2[0], f2[1]).stroke({ width: 3, color: 0x5a83a8, alpha: 0.8, cap: 'round' });
      el(4, 3, 12, 4, 0xcfe0f0, 0.5);
      ci(15, -2, 1.6, 0x0a0a0a, 0.9);
    } else {
      const wig = Math.sin(t * 4 + seed) * 0.3;
      el(0, 0, 6, 3, 0x8fb8d8, 0.8);
      const w0 = tf(-5, 0), w1 = tf(-9, -3 + wig * 4), w2 = tf(-9, 3 + wig * 4);
      g.moveTo(w0[0], w0[1]).lineTo(w1[0], w1[1]).lineTo(w2[0], w2[1]).closePath().fill({ color: 0x7aa8c8, alpha: 0.7 });
      ci(4, -0.5, 0.9, 0x0a0a0a, 0.9);
    }
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
  // Soft light shafts from the surface: each is a BEAM_TEX sprite (soft sides +
  // a smooth top->bottom fade) that sways gently about its top, so the light
  // reads as drifting water light instead of hard banded pillars.
  function drawGodRays() {
    rayG.clear();
    const p = game.pal, ray = hexInt(p.ray);
    const reach = game.wh * 0.92;
    const N = 6;
    for (let i = 0; i < N; i++) {
      let sp = raySprites[i];
      if (!sp) {
        sp = new PIXI.Sprite(BEAM_TEX);
        sp.anchor.set(0.5, 0);
        raySpr.addChild(sp);
        raySprites[i] = sp;
      }
      const base = ((i + 0.5) / N) * game.ww + Math.sin(i * 2.3) * TILE;
      const sway = Math.sin(game.time * 0.16 + i * 1.9) * 0.05;
      const w = 70 + (i % 3) * 46;
      const a = 0.10 + 0.05 * Math.sin(game.time * 0.4 + i * 1.3);
      sp.visible = true;
      sp.position.set(base, -4);
      sp.width = w;
      sp.height = reach;
      sp.rotation = sway;
      sp.tint = ray;
      sp.alpha = clamp(a, 0, 1);
    }
    for (let i = N; i < raySprites.length; i++) raySprites[i].visible = false;
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
    // pulsing beacon rings — one shared draw, so identical in every act
    for (let i = 0; i < 3; i++) {
      const t = (game.time * 0.5 + i / 3) % 1;
      goalG.circle(g0.x, g0.y, 18 + t * 48).stroke({ width: 2.4 * (1 - t) + 0.4, color: 0xffd98a, alpha: 0.5 * (1 - t) });
    }
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
      const lwag = Math.sin(t * 8 + l.ph) * 5;
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
      const wag = Math.sin(t * (7 + 5 * fspd) + f.ph) * (2.2 + 4.2 * fspd);
      const fwave = Math.sin(t * 8 + f.ph) * 0.09 * fspd;
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
      const rot = Math.atan2(v.vy, v.vx) * (Math.abs(v.vx) + Math.abs(v.vy) > 6 ? 0.9 : 0.15) + Math.sin(t * 10 + v.ph) * 0.08;
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
      const wag = Math.sin(t * 11 + v.ph) * (lunging ? 7 : 4);
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
      // pulsing rings — one shared draw, so identical in every act
      for (let i = 0; i < 2; i++) {
        const t = (game.time * 0.7 + p.ph + i / 2) % 1;
        powerG.circle(p.x, p.y, 13 + t * 24).stroke({ width: 2.6 * (1 - t) + 0.5, color: col, alpha: 0.85 * (1 - t) });
      }
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
      if (es.warn > 0) {
        // telegraphed zone: a pulsing warning ring, harmless until it fires
        const wp = 0.5 + 0.5 * Math.sin(game.time * 14);
        shotG.circle(es.x, es.y, es.r * (0.7 + 0.5 * wp)).stroke({ width: 2, color: 0xff5d73, alpha: 0.55 + 0.35 * wp });
        glow(TEX_TIGHT, es.x, es.y, es.r * 1.6, hexInt(es.c || '#ff5d73'), 0.25 + 0.2 * wp);
        continue;
      }
      glow(TEX_TIGHT, es.x, es.y, es.r * 2.4, hexInt(es.c || '#ff5d73'), 0.9 * a);
      shotG.circle(es.x, es.y, es.r * 0.5).fill({ color: 0xffffff, alpha: 0.7 * a });
    }
    for (const o of game.bossOrbs) {
      glow(TEX_TIGHT, o.x, o.y, 16, 0xff5d73, 0.9);
      shotG.circle(o.x, o.y, 4).fill({ color: 0xffd0d8, alpha: 0.95 });
    }
    // Matriarch shockwaves (secondary attack): telegraph ring, then a lethal band
    for (const w of game.bossWaves) {
      const wc = hexInt(w.c || '#ffd166');
      if (w.warn > 0) {
        const wp = 0.5 + 0.5 * Math.sin(game.time * 16);
        shotG.circle(w.x, w.y, 26 + 10 * wp).stroke({ width: 3, color: wc, alpha: 0.5 + 0.4 * wp });
        shotG.circle(w.x, w.y, 12).stroke({ width: 2, color: 0xffffff, alpha: 0.4 + 0.4 * wp });
        continue;
      }
      const a = clamp(w.life / 1.6, 0, 1);
      shotG.circle(w.x, w.y, w.r).stroke({ width: 12, color: wc, alpha: 0.55 * a });
      shotG.circle(w.x, w.y, w.r).stroke({ width: 4, color: 0xffffff, alpha: 0.85 * a });
      glow(TEX_TIGHT, w.x, w.y, w.r * 0.5, wc, 0.12 * a);
    }
  }

  // ---- skeleton helpers ---------------------------------------------------
  const Pp = (a) => ({ x: a[0], y: a[1] });
  const rotAbout = (px, py, ox, oy, a) => {
    const dx = px - ox, dy = py - oy, c = Math.cos(a), n = Math.sin(a);
    return [ox + dx * c - dy * n, oy + dx * n + dy * c];
  };
  // Lay a run of capsule sprites along a straight bone (legs, tails, spines).
  function chainLine(L, a, b, thick, tint, alpha, bm) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < 0.4) return;
    L.push({ tex: CREAT.capsule, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2,
      r: Math.atan2(b[1] - a[1], b[0] - a[0]), w: d * 1.14, h: thick, t: tint, a: alpha, bm: bm });
  }
  function chainPoly(L, pts, thick, tint, alpha, bm) {
    for (let i = 1; i < pts.length; i++) chainLine(L, pts[i - 1], pts[i], thick, tint, alpha, bm);
  }
  // Sample a quadratic curve into a tapered chain of capsules (tentacles).
  function chainQuad(L, A, B, C, n, w0, w1, tint, alpha, bm) {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const mid = qpoint(A, B, C, tm);
      const e = qpoint(A, B, C, Math.min(1, t1 + 0.02));
      const st = qpoint(A, B, C, Math.max(0, t0 - 0.02));
      const d = Math.hypot(e[0] - st[0], e[1] - st[1]);
      L.push({ tex: CREAT.capsule, x: mid[0], y: mid[1], r: Math.atan2(e[1] - st[1], e[0] - st[0]),
        w: d * 1.16, h: lerp(w0, w1, tm), t: tint, a: alpha, bm: bm });
    }
  }
  const flushCreatures = () => { creatureRig.frame(cskel); cskel.length = 0; };

  // ---- ANGLER sprite-skeleton ---------------------------------------------
  // 6 bones: tail, dorsal, pectoral, body, jaw (idle chomp), illicium; the esca
  // rides the rod tip and keeps a real glow() so it still lights the water.
  function drawAnglerSkel(cx, cy, aim, t, VS, fglow) {
    try {
      if (!CREAT) CREAT = bakeCreatureParts();
      const K = CREAT, s = VS;
      const P = (x, y, rot = aim) => {
        const xr = x * s, yr = y * s;
        return [cx + xr * Math.cos(rot) - yr * Math.sin(rot), cy + xr * Math.sin(rot) + yr * Math.cos(rot)];
      };
      const L = [];
      glow(TEX_SOFT, cx, cy, 34 * VS, fglow, 0.18);
      // flat 2D body (the fake-3D lit ribbon was removed)
      L.push({ tex: K.angBody, ...Pp(P(0, 0)), r: aim, w: 38 * s, h: 28 * s });
      const sw = Math.sin(t * 3.4);
      const wag = sw * 0.36;
      L.push({ tex: K.angTail, ...Pp(P(-14, sw * 3)), r: aim + wag, w: 28 * s, h: 24 * s });
      L.push({ tex: K.angDorsal, ...Pp(P(-1, -13 + sw * 1.2)), r: aim + sw * 0.05, w: 26 * s, h: 16 * s });
      L.push({ tex: K.angPec, ...Pp(P(2, 5)), r: aim + Math.sin(t * 2.8) * 0.5, w: 28 * s, h: 26 * s });
      const jaw = 0.13 + 0.11 * Math.sin(t * 2.1);
      L.push({ tex: K.angJaw, ...Pp(P(3.5, 0.5 + sw * 1.2)), r: aim + jaw, w: 42 * s, h: 28 * s });
      const rodRot = Math.sin(t * 1.8) * 0.16;
      L.push({ tex: K.angRod, ...Pp(P(6.5, -11.5)), r: aim + rodRot, w: 34 * s, h: 32 * s });
      const tip = rotAbout(22, -25, 6.5, -11.5, rodRot);
      const tp = P(tip[0], tip[1]);
      L.push({ tex: K.angEsca, x: tp[0], y: tp[1], r: t * 0.8, w: 20 * s, h: 20 * s, bm: 'add' });
      glow(TEX_TIGHT, tp[0], tp[1], 16 * VS, 0xfff6d2, 0.85);
      // (lit ribbon layout removed - flat 2D body)
      playerRig.frame(L);
      playerSkel.visible = true;
      return true;
    } catch (e) { return false; }
  }

  // ---- JELLY sprite-skeleton ----------------------------------------------
  // Baked bell (scalloped margin, ocelli, gonads, manubrium, highlight) pulsed
  // by the existing sq factor; arms and tentacle strands are baked sprites
  // fanned along the same sway math the vector path used.
  function drawJellySkel(cx, cy, aim, t, VS, fglow, fbody) {
    try {
      if (!CREAT) CREAT = bakeCreatureParts();
      const K = CREAT;
      const rot = aim + Math.PI / 2;
      const PJ = (x, y) => [cx + (x * Math.cos(rot) - y * Math.sin(rot)) * VS, cy + (x * Math.sin(rot) + y * Math.cos(rot)) * VS];
      const sq = 1 + Math.sin(t * 3.4) * 0.22;
      const L = [];
      glow(TEX_SOFT, cx, cy, 30 * VS, fglow, 0.2);
      for (let i = 0; i < 12; i++) {
        const ox = -13.5 + i * 2.45, len = 30 + (i % 4) * 9, sw = Math.sin(t * 3.0 + i * 0.7) * 12;
        const A = PJ(ox, 0), D = PJ(ox + sw * 0.6, len);
        const dist = Math.hypot(D[0] - A[0], D[1] - A[1]);
        const su = dist / (57 * VS);
        L.push({ tex: K.jellyTent, x: A[0], y: A[1], r: Math.atan2(D[1] - A[1], D[0] - A[0]) - Math.PI / 2,
          w: 24 * su, h: 114 * su, t: fglow, a: 0.5 });
      }
      for (let i = 0; i < 4; i++) {
        const ox = -6 + i * 4, sw = Math.sin(t * 2.8 + i * 1.1) * 9;
        const A = PJ(ox, 0), C = PJ(ox + sw, 21);
        L.push({ tex: K.jellyArm, x: A[0], y: A[1], r: Math.atan2(C[1] - A[1], C[0] - A[0]) - Math.PI / 2,
          w: 16 * VS, h: 46 * VS, t: fbody, a: 0.6 });
      }
      const B = PJ(0, -1);
      // flat 2D bell (the fake-3D lit dome was removed)
      L.push({ tex: K.jellyBell, x: B[0], y: B[1], r: rot, w: 33 * VS * sq, h: 51 * VS / sq, a: 1 });
      playerRig.frame(L);
      playerSkel.visible = true;
      return true;
    } catch (e) { return false; }
  }

  // ---- MINIBOSS rigs: one per kind, same motion params as the vector path --
  function drawMB(mb, t, scl, alpha, col, glw, P) {
    if (!CREAT) CREAT = bakeCreatureParts();
    const K = CREAT, L = cskel, k = mb.kind;
    if (k === 'crab') {
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 3; i++) {
        const base = (i - 1) * 9;
        const sw = Math.sin(t * 6 + i + (s > 0 ? 0 : 1.5)) * 9;
        chainLine(L, P(s * 12, base), P(s * (22 + sw), base + 12 + sw * 0.5), 3.4 * scl, col, 0.85 * alpha);
      }
      for (let s = -1; s <= 1; s += 2) {
        const open = 0.3 + 0.3 * Math.sin(t * 4 + (s > 0 ? 1 : 0));
        const r = s * (0.4 + open);
        const c = P(s * 24, -6, r);
        L.push({ tex: K.crabClaw, x: c[0], y: c[1], r, w: 30 * scl * s, h: 18 * scl, a: 0.95 * alpha });
      }
      const sh = P(0, 0);
      L.push({ tex: K.crabShell, x: sh[0], y: sh[1], r: 0, w: 48 * scl, h: 40 * scl, a: alpha });
      return true;
    }
    if (k === 'manta') {
      const flap = Math.sin(t * 2.6) * 0.7;
      const rot = mb.ph + Math.PI / 2;
      const poses = [[K.mantaWingU, -0.7], [K.mantaWingM, 0], [K.mantaWingD, 0.7]];
      let i0 = 0; while (i0 < 1 && flap > poses[i0 + 1][1]) i0++;
      const pa = poses[i0], pb = poses[Math.min(2, i0 + 1)];
      const ta = clamp((flap - pa[1]) / ((pb[1] - pa[1]) || 1), 0, 1);
      const A = P(0, -6, rot);
      for (const s of [-1, 1]) for (let j = 0; j < 2; j++) {
        const al = (j === 0 ? 1 - ta : ta);
        if (al <= 0.03) continue;
        L.push({ tex: (j === 0 ? pa : pb)[0], x: A[0], y: A[1], r: rot, w: 84 * scl * s, h: 52 * scl, a: 0.9 * al * alpha });
      }
      const bd = P(0, 0, rot);
      L.push({ tex: K.mantaBody, x: bd[0], y: bd[1], r: rot, w: 22 * scl, h: 46 * scl, a: alpha });
      chainQuad(L, P(0, 18, rot), P(Math.sin(t * 3) * 8, 34, rot), P(0, 48, rot), 5, 4 * scl, 2 * scl, col, 0.85 * alpha);
      return true;
    }
    if (k === 'urchin') {
      const rot = mb.spin * 0.8;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const len = mb.r + 8 + Math.sin(t * 3 + i) * 4;
        const A = P(Math.cos(a) * mb.r * 0.6, Math.sin(a) * mb.r * 0.6, rot);
        const h = 2 * (len - mb.r * 0.6) * scl, su = h / 80;
        L.push({ tex: K.urchinSpike, x: A[0], y: A[1], r: rot + a + Math.PI / 2, w: 10 * su, h, a: 0.95 * alpha });
      }
      const c = P(0, 0, rot);
      L.push({ tex: K.urchinCore, x: c[0], y: c[1], r: rot, w: 44 * scl, h: 44 * scl, a: alpha });
      return true;
    }
    if (k === 'moray') {
      const rot = mb.ph, seg = 10, spine = [];
      for (let i = 0; i <= seg; i++) {
        const tt = i / seg;
        spine.push(P(-tt * 60, Math.sin(t * 4 - tt * 4) * 14 * (1 - tt * 0.3), rot));
      }
      chainPoly(L, spine, 14 * scl, col, 0.95 * alpha);
      chainPoly(L, spine, 3.2 * scl, glw, 0.5 * alpha, 'add');
      const h0 = spine[0];
      const hRot = Math.atan2(spine[0][1] - spine[1][1], spine[0][0] - spine[1][0]);
      L.push({ tex: K.morayHead, x: h0[0], y: h0[1], r: hRot, w: 48 * scl, h: 28 * scl, a: alpha });
      const jaw = 0.4 + 0.4 * Math.sin(t * 5);
      const jv = [h0[0] + Math.cos(hRot) * 6, h0[1] + Math.sin(hRot) * 6];
      L.push({ tex: K.morayJawU, x: jv[0], y: jv[1], r: hRot - jaw * 0.3, w: 36 * scl, h: 20 * scl, a: 0.95 * alpha });
      L.push({ tex: K.morayJawL, x: jv[0], y: jv[1], r: hRot + jaw * 0.3, w: 36 * scl, h: 20 * scl, a: 0.95 * alpha });
      return true;
    }
    if (k === 'king') {
      const rot = mb.ph, kwag = Math.sin(t * 6 + mb.seed) * 11;
      const tl = P(-26, kwag * 0.3, rot);
      L.push({ tex: K.kingTail, x: tl[0], y: tl[1], r: rot + kwag * 0.014, w: 40 * scl, h: 32 * scl, a: 0.9 * alpha });
      const bc = P(0, 0, rot);
      L.push({ tex: K.kingBody, x: bc[0], y: bc[1], r: rot, w: 64 * scl, h: 38 * scl, a: alpha });
      const lp0 = P(0, -12, rot);
      L.push({ tex: K.kingLanterns, x: lp0[0], y: lp0[1], r: rot, w: 44 * scl, h: 28 * scl, a: alpha, bm: 'add' });
      for (let i = -2; i <= 2; i++) {
        const lp = P(i * 9, -16 + Math.abs(i) * 2 - 8, rot);
        glow(TEX_TIGHT, lp[0], lp[1], 7 * scl, 0xfff6d0, (0.7 + 0.3 * Math.sin(t * 5 + i)) * alpha);
      }
      return true;
    }
    if (k === 'kraken') {
      const bob = Math.sin(t * 2.2) * 4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 7 - 0.5) * 2.2, bx = Math.sin(a) * 16, ph = t * 2.4 + i * 0.8, len = 34 + (i % 2) * 12;
        const w0 = (6 - Math.abs(a)) * scl;
        chainQuad(L, P(bx, 10 + bob), P(bx + Math.sin(ph) * 14, 10 + bob + len * 0.6), P(bx + Math.sin(ph + 1) * 20, 10 + bob + len),
          6, w0, w0 * 0.45, col, (0.75 - Math.abs(a) * 0.1) * alpha);
      }
      const hc = P(0, -8 + bob);
      L.push({ tex: K.krakenHead, x: hc[0], y: hc[1], r: Math.sin(t * 1.6) * 0.06, w: 48 * scl, h: 52 * scl, a: alpha });
      return true;
    }
    if (k === 'serpent') {
      const rot = mb.ph, seg = 14, spine = [];
      for (let i = 0; i <= seg; i++) {
        const tt = i / seg;
        spine.push(P(-tt * 78, Math.sin(t * 3 - tt * 5) * 16 * (1 - tt * 0.2), rot));
      }
      for (let i = 1; i < seg; i += 2) {
        const tt = i / seg, p = spine[i];
        const b = P(-tt * 78 - 10, Math.sin(t * 3 - tt * 5) * 16 * (1 - tt * 0.2), rot);
        L.push({ tex: K.serpFin, x: p[0], y: p[1], r: Math.atan2(b[1] - p[1], b[0] - p[0]), w: 24 * scl, h: 24 * scl, t: glw, a: 0.5 * alpha });
      }
      chainPoly(L, spine, 11 * scl, col, 0.95 * alpha);
      chainPoly(L, spine, 3 * scl, glw, 0.5 * alpha, 'add');
      const hc = spine[0];
      const hRot = Math.atan2(spine[0][1] - spine[1][1], spine[0][0] - spine[1][0]);
      L.push({ tex: K.serpHead, x: hc[0], y: hc[1], r: hRot, w: 28 * scl, h: 20 * scl, a: alpha });
      return true;
    }
    return false;
  }

  // ---- FINAL BOSS (Matriarch) rig ------------------------------------------
  // ---- FINAL BOSS (Matriarch): a life-like jellyfish ----------------------
  // The Matriarch is now a giant jellyfish built from the SAME baked parts as the
  // player's jelly creature (bell + long flowing tentacles + frilly oral arms),
  // scaled up to boss size. It pulses, its tentacles stream and sway, and it
  // flushes red when enraged. The crown lure stays as its signature light.
  function drawBossSkel(b, t, scl, alpha, rot, P, sx, sy) {
    // THE MATRIARCH: a colossal bioluminescent anglerfish — the player's own
    // creature, grown to boss size. Reuses the polished baked angler parts
    // (body / jaw / tail / dorsal / pectoral / rod / esca / eye) with a
    // chomping mega-jaw, three lures, and pulsing flank lights.
    const K = CREAT, L = cskel, en = b.enraged;
    const BS = 3.2;                       // boss size vs the player angler
    const beat = 1 + Math.sin(t * 2.4) * 0.06;
    const bodyTint = en ? 0xff6a86 : 0xffd166;
    const glowC = en ? 0xff5d73 : 0xffd166;
    const sw = Math.sin(t * 3.2), wag = sw * 0.4;
    glow(TEX_SOFT, b.x, b.y, 120 * BS, glowC, 0.35 * alpha);
    // tail (behind)
    L.push({ tex: K.angTail, ...Pp(P(-14, sw * 3)), r: rot + wag, w: 30 * BS, h: 26 * BS, t: bodyTint, a: alpha });
    // dorsal spines
    L.push({ tex: K.angDorsal, ...Pp(P(-1, -13 + sw * 1.2)), r: rot + sw * 0.05, w: 28 * BS, h: 18 * BS, t: bodyTint, a: alpha });
    // pectoral fin
    L.push({ tex: K.angPec, ...Pp(P(2, 5)), r: rot + Math.sin(t * 2.6) * 0.5, w: 30 * BS, h: 28 * BS, t: bodyTint, a: alpha });
    // body (breathing)
    L.push({ tex: K.angBody, ...Pp(P(0, 0)), r: rot, w: 40 * BS * beat, h: 30 * BS / beat, t: bodyTint, a: alpha });
    // chomping mega-jaw
    const jaw = 0.16 + 0.16 * Math.sin(t * 2.2);
    L.push({ tex: K.angJaw, ...Pp(P(3.5, 0.5 + sw * 1.2)), r: rot + jaw, w: 46 * BS, h: 30 * BS, t: bodyTint, a: alpha });
    // eye
    L.push({ tex: K.angEye, ...Pp(P(5.6, -6.4)), r: rot, w: 9 * BS, h: 9 * BS, a: alpha });
    // main lure: rod + glowing esca
    const rodRot = Math.sin(t * 1.8) * 0.18;
    L.push({ tex: K.angRod, ...Pp(P(6.5, -11.5)), r: rot + rodRot, w: 36 * BS, h: 34 * BS, t: bodyTint, a: alpha });
    const tip = rotAbout(22, -25, 6.5, -11.5, rodRot);
    const tp = P(tip[0], tip[1]);
    L.push({ tex: K.angEsca, x: tp[0], y: tp[1], r: t * 0.8, w: 26 * BS, h: 26 * BS, bm: 'add' });
    glow(TEX_TIGHT, tp[0], tp[1], 26 * BS, 0xfff6d2, 0.9 * alpha);
    // two flanking lures (shorter, offset from the head)
    for (const sgn of [-1, 1]) {
      const bx = sgn * 8, by = -8;
      const extra = sgn * 0.55 + Math.sin(t * 1.6 + sgn) * 0.15;
      L.push({ tex: K.angRod, ...Pp(P(bx, by)), r: rot + extra, w: 22 * BS, h: 22 * BS, t: bodyTint, a: alpha * 0.9 });
      const ftip = rotAbout(bx + 15.5, by - 13.5, bx, by, extra);
      const fp = P(ftip[0], ftip[1]);
      L.push({ tex: K.angEsca, x: fp[0], y: fp[1], r: t * 0.6 + sgn, w: 15 * BS, h: 15 * BS, bm: 'add' });
      glow(TEX_TIGHT, fp[0], fp[1], 15 * BS, 0xfff2c0, 0.7 * alpha);
    }
    // pulsing bioluminescent spots along the flank
    for (let i = 0; i < 7; i++) {
      const px = -12 + i * 4.2, py = -6 + Math.sin(i * 1.3) * 3;
      const sp = P(px, py);
      const pu = 0.5 + 0.5 * Math.sin(t * 3 + i * 0.9);
      glow(TEX_TIGHT, sp[0], sp[1], 6 * BS, glowC, (0.3 + 0.5 * pu) * alpha);
    }
  }

  function drawMiniBosses() {
    miniG.clear();
    cskel.length = 0;
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
      // pulsing rings in the boss's own color — one shared draw for every mini-boss
      for (let i = 0; i < 3; i++) {
        const rt = (t * 0.45 + (mb.seed || 0) + i / 3) % 1;
        miniG.circle(cx, cy, mb.r + 8 + rt * 44).stroke({ width: 2.2 * (1 - rt) + 0.4, color: glw, alpha: 0.55 * (1 - rt) * alpha });
      }
      try { if (drawMB(mb, t, scl, alpha, col, glw, P)) continue; } catch (e) { /* vector fallback */ }
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
    if (!b) { flushCreatures(); return; }
    if (b.dead && b.dieT > 1.6) { flushCreatures(); return; }
    const t = game.time;
    const alpha = b.dead ? clamp(1 - b.dieT / 1.6, 0, 1) : 1;
    const BS = b.dead ? 3.2 + b.dieT * 0.6 : 3.2;
    const bbeat = 1 + Math.sin(t * 2.4) * 0.06;
    const rot = b.ph;                     // the Matriarch faces the player
    const sx = BS * bbeat, sy = BS / bbeat;
    const P = (x, y) => {
      const xr = x * sx, yr = y * sy;
      return [b.x + xr * Math.cos(rot) - yr * Math.sin(rot), b.y + xr * Math.sin(rot) + yr * Math.cos(rot)];
    };
    glow(TEX_SOFT, b.x, b.y, 120 * BS, b.enraged ? 0xff5d73 : 0xffd166, 0.35 * alpha);
    try {
      if (CREAT || (CREAT = bakeCreatureParts())) { drawBossSkel(b, t, BS, alpha, rot, P, sx, sy); flushCreatures(); return; }
    } catch (e) { /* vector fallback below */ }
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
    flushCreatures();
  }

  // ---- eel sprite-skeleton: a baked creature-part atlas driven by a bone chain ----
  // The spine below IS the skeleton (a 12-bone chain animated by a travelling
  // sine wave = the swim). Each bone carries a baked sprite (body segment, belly
  // glow, head, tail fin, pectoral fin) placed at the bone and rotated to the
  // bone's tangent — real sprite-skinning, not per-frame vector paths.
  let eelParts = null;
  const skelSegs = [], skelBelly = [], skelExtra = [];
  let eelRibbon = null, eelRibbonPos = null, eelRibbonCol = null, eelRibbonShader = null;
  // Fake-3D tube lighting: the light comes from the surface above (screen up,
  // -Y) with only a slight bias toward the camera (view V = +Z), so the
  // highlight band rides the upper flank no matter which way the eel swims.
  // L = (0,RLY,RLZ); H = normalize(L + V) = (0,RHY,RHZ). X components are 0.
  const RLY = -0.95, RLZ = 0.31, RHY = -0.5871, RHZ = 0.8095, RIB_ROWS = 9;
  // ---- shared fake-3D lit-ribbon (per-vertex up-light), reused by angler/jelly ----
  let angRB = null, jellyRB = null;
  function makeLitRibbon(label, tex, cols, rows, uvFn) {
    const nv = cols * rows;
    const pos = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 4);
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const idx = i * rows + j;
        const uvv = uvFn ? uvFn(i, j, cols, rows) : [i / (cols - 1), j / (rows - 1)];
        uv[idx * 2] = uvv[0]; uv[idx * 2 + 1] = uvv[1];
        col[idx * 4 + 3] = 1;
      }
    }
    const id = [];
    for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      id.push(a, a + 1, a + rows, a + 1, a + rows + 1, a + rows);
    }
    const geom = new PIXI.MeshGeometry({ positions: pos, uvs: uv, indices: new Uint32Array(id) });
    const colBuf = new PIXI.Buffer({ data: col, label: label + '-colors', usage: PIXI.BufferUsage.VERTEX | PIXI.BufferUsage.COPY_DST });
    geom.addAttribute('aColor', { buffer: colBuf, format: 'float32x4', stride: 16, offset: 0 });
    let shader = null;
    try {
      const glProgram = PIXI.compileHighShaderGlProgram({ name: label, bits: [PIXI.localUniformBitGl, PIXI.textureBitGl, PIXI.colorBitGl, PIXI.roundPixelsBitGl] });
      shader = new PIXI.Shader({ glProgram, resources: { uTexture: tex.source, uSampler: tex.source.style, textureUniforms: { uTextureMatrix: { type: 'mat3x3<f32>', value: new PIXI.Matrix() } } } });
    } catch (e) { shader = null; }
    const mesh = new PIXI.Mesh({ geometry: geom, texture: tex, shader });
    mesh.autoUpdate = true;
    return { mesh, pos, col, cols, rows };
  }
  function layoutLitRibbon(rb, spine, flip) {
    const { mesh, pos, col, rows } = rb;
    for (let i = 0; i < spine.length; i++) {
      const p = spine[i], a = p.ang;
      const px = -Math.sin(a), py = Math.cos(a);
      const pyL = flip ? -py : py;   // keep the highlight on top after the never-upside-down mirror
      for (let j = 0; j < rows; j++) {
        const v = j / (rows - 1);
        const th = Math.PI * (1 - v);
        const c = Math.cos(th), s = Math.sin(th);
        const idx = i * rows + j;
        pos[idx * 2] = p.x + px * p.r * c;
        pos[idx * 2 + 1] = p.y + py * p.r * c;
        const lambert = Math.max(0, RLY * pyL * c + RLZ * s);
        const nh = Math.max(0, RHY * pyL * c + RHZ * s);
        const diff = 0.10 + 0.90 * lambert;
        const spec = Math.pow(nh, 5) * 2.3;
        const b = diff + spec < 2.05 ? diff + spec : 2.05;
        col[idx * 4] = b; col[idx * 4 + 1] = b; col[idx * 4 + 2] = b; col[idx * 4 + 3] = 1;
      }
    }
    mesh.geometry.getBuffer('aPosition').update();
    mesh.geometry.getBuffer('aColor').update();
    mesh.visible = true;
  }
  // Fake-3D dome for the jelly bell: a grid laid over the bell's rotated box
  // (matching the bell sprite's w/h), lit by the same up+toward-camera light.
  // World-space normals (flip-compensated) keep the highlight on the rendered
  // top after the never-upside-down mirror.
  function layoutLitDome(rb, cx, cy, rot, hw, hh, flip) {
    const { mesh, pos, col, cols, rows } = rb;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1) * 2 - 1;          // -1..1 across the bell (local x)
      for (let j = 0; j < rows; j++) {
        const v = j / (rows - 1) * 2 - 1;        // -1..1 down the bell (local y)
        const idx = i * rows + j;
        const lx = u * hw, ly = v * hh;
        pos[idx * 2] = cx + lx * cr - ly * sr;
        pos[idx * 2 + 1] = cy + lx * sr + ly * cr;
        // dome normal: outward from the disc centre, biased toward the camera
        const nz = 0.62;
        const nx = u * 0.55, ny = v * 0.55;
        const wny = nx * sr + ny * cr;          // world normal y (x unused by the light)
        const nyL = flip ? -wny : wny;
        const lambert = Math.max(0, RLY * nyL + RLZ * nz);
        const nh = Math.max(0, RHY * nyL + RHZ * nz);
        const diff = 0.12 + 0.88 * lambert;
        const spec = Math.pow(nh, 6) * 2.1;
        const b = diff + spec < 2.05 ? diff + spec : 2.05;
        col[idx * 4] = b; col[idx * 4 + 1] = b; col[idx * 4 + 2] = b; col[idx * 4 + 3] = 1;
      }
    }
    mesh.geometry.getBuffer('aPosition').update();
    mesh.geometry.getBuffer('aColor').update();
    mesh.visible = true;
  }
  function bakeEelParts() {
    // Same logical art as before, but baked through the supersampled helper so
    // the parts stay crisp when the camera + VS scale them up. Bone geometry and
    // motion are unchanged — only the source resolution and filtering improved.
    const mk = (w, h, draw) => bakePart(w, h, draw, 5);
    const BODY = '#5ef2c8', GLOW = '#2affd5', DARK = '#04141c';
    // body segment: dark capsule, dorsal sheen on top, glowing belly on the bottom edge
    const seg = mk(64, 64, (x, w, h) => {
      const cy = h / 2, r = h / 2 - 3;
      x.fillStyle = DARK; x.beginPath();
      x.moveTo(6, cy - r); x.lineTo(w - 6, cy - r);
      x.arc(w - 6, cy, r, -Math.PI / 2, Math.PI / 2);
      x.lineTo(6, cy + r); x.arc(6, cy, r, Math.PI / 2, -Math.PI / 2);
      x.closePath(); x.fill();
      let g1 = x.createLinearGradient(0, cy - r, 0, cy - r + 11);
      g1.addColorStop(0, 'rgba(94,242,200,0.24)'); g1.addColorStop(1, 'rgba(94,242,200,0)');
      x.fillStyle = g1; x.fillRect(8, cy - r, w - 16, 11);
      let g2 = x.createLinearGradient(0, cy + r - 9, 0, cy + r);
      g2.addColorStop(0, 'rgba(42,255,213,0)'); g2.addColorStop(1, 'rgba(42,255,213,0.95)');
      x.fillStyle = g2; x.fillRect(8, cy + r - 9, w - 16, 9);
    });
    // belly glow strip (additive, white so it can be tinted to the form glow)
    const belly = mk(64, 32, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
    // head: skull + jaw + eye + teeth + barbels, eel colours baked in
    const head = mk(80, 64, (x, w, h) => {
      const cy = h / 2;
      x.fillStyle = BODY; x.beginPath(); x.ellipse(w * 0.42, cy - 1, 26, 20, 0, 0, 7); x.fill();
      x.fillStyle = DARK; x.beginPath(); x.ellipse(w * 0.5, cy + 3, 21, 15, 0, 0, 7); x.fill();
      x.fillStyle = '#eafff9'; x.beginPath(); x.arc(w * 0.34, cy - 8, 6.5, 0, 7); x.fill();
      x.fillStyle = '#03201b'; x.beginPath(); x.arc(w * 0.36, cy - 8, 3.2, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(w * 0.31, cy - 10, 1.7, 0, 7); x.fill();
      x.fillStyle = '#dff8f0';
      for (let i = 0; i < 4; i++) { const tx = w * 0.6 + i * 4; x.beginPath(); x.moveTo(tx, cy + 4); x.lineTo(tx + 2, cy + 10); x.lineTo(tx + 4, cy + 4); x.closePath(); x.fill(); }
      x.strokeStyle = 'rgba(42,255,213,0.6)'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(w * 0.7, cy + 6); x.quadraticCurveTo(w * 0.85, cy + 14, w * 0.96, cy + 18); x.stroke();
    });
    // translucent glow fin (tail / pectoral)
    const fin = mk(64, 64, (x, w, h) => {
      const g = x.createRadialGradient(w * 0.25, h * 0.5, 0, w * 0.25, h * 0.5, w * 0.7);
      g.addColorStop(0, 'rgba(42,255,213,0.55)'); g.addColorStop(1, 'rgba(42,255,213,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(w * 0.08, h * 0.5); x.lineTo(w * 0.98, h * 0.12); x.lineTo(w * 0.82, h * 0.5); x.lineTo(w * 0.98, h * 0.88); x.closePath(); x.fill();
    });
    // Continuous body-ribbon texture for the Mesh: a horizontal strip (u =
    // head->tail, v = dorsal->belly). It is a MID-TONE body (not near-black) so
    // the fake-3D per-vertex lighting has a base to shade into a rounded, lit
    // tube. Edges fade to transparent for a rounded silhouette; the per-frame
    // aColor attribute does the actual light/shadow/specular.
    const ribbon = bakePart(220, 44, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, 'rgba(18,72,64,0)');
      g.addColorStop(0.10, 'rgba(18,72,64,0.96)');
      g.addColorStop(0.50, 'rgba(30,110,96,1)');
      g.addColorStop(0.90, 'rgba(18,72,64,0.96)');
      g.addColorStop(1.00, 'rgba(18,72,64,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      // lateral line (a lighter ridge along the flank)
      x.strokeStyle = 'rgba(190,255,238,0.5)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(4, h * 0.46); x.lineTo(w - 4, h * 0.46); x.stroke();
      // subtle chevrons (muscle bands)
      x.strokeStyle = 'rgba(16,54,46,0.32)'; x.lineWidth = 1;
      for (let i = 0; i < 10; i++) { const cx = 16 + i * (w - 28) / 9; x.beginPath(); x.moveTo(cx, h * 0.24); x.lineTo(cx - 6, h * 0.5); x.lineTo(cx, h * 0.76); x.stroke(); }
    }, 5);
    return { seg, belly, head, fin, ribbon };
  }
  function drawEelSkel(cx, cy, aim, t, speed, VS, fglow) {
    try {
      if (!eelParts) {
        eelParts = bakeEelParts();
        // (flat 2D body: the fake-3D lit ribbon was removed - the baked segment
        //  sprites below draw the body)
        for (let i = 0; i < 12; i++) { const s = new PIXI.Sprite(eelParts.seg); s.anchor.set(0.5); playerSkel.addChild(s); skelSegs.push(s); }
        for (let i = 0; i < 11; i++) { const s = new PIXI.Sprite(eelParts.belly); s.anchor.set(0.5); s.blendMode = 'add'; playerSkel.addChild(s); skelBelly.push(s); }
        for (let i = 0; i < 3; i++) { const s = new PIXI.Sprite(eelParts.head); s.anchor.set(0.5); playerSkel.addChild(s); skelExtra.push(s); }
      }
      const seg = 11;
      const dashK = game.dashT > 0 ? clamp(game.dashT / 0.22, 0, 1) : 0;
      const pitch = 6.2 * (1 + dashK * 0.42);   // body stretches while dashing
      const spine = [];
      for (let i = 0; i <= seg; i++) {
        const tt = i / seg;
        const wob = Math.sin(t * 8 - i * 0.75) * (2.0 + speed * 0.014) * tt;
        const lx = -i * pitch * VS, ly = wob * VS;
        spine.push({ x: cx + lx * Math.cos(aim) - ly * Math.sin(aim), y: cy + lx * Math.sin(aim) + ly * Math.cos(aim), r: (7.4 * (1 - tt * 0.78) + 1.1) * VS * (1 - dashK * 0.10) });
      }
      const tang = [];
      for (let i = 0; i <= seg; i++) { const a = spine[Math.max(0, i - 1)], b = spine[Math.min(seg, i + 1)]; tang[i] = Math.atan2(a.y - b.y, a.x - b.x); }
      playerSkel.visible = true;
      for (let i = 0; i <= seg; i++) {
        const s = skelSegs[i], p = spine[i];
        s.position.set(p.x, p.y); s.rotation = tang[i];
        s.width = pitch * VS * 1.9; s.height = p.r * 2.05; s.visible = true;   // flat 2D body (lit ribbon retired)
      }
      // (lit ribbon update removed - flat 2D body)
      for (let i = 0; i < 11; i++) {
        const p = spine[i], a = tang[i], s = skelBelly[i];
        s.position.set(p.x - Math.sin(a) * p.r * 0.72, p.y + Math.cos(a) * p.r * 0.72);
        s.rotation = a; s.width = pitch * VS * 1.4; s.height = p.r * 0.9; s.tint = fglow; s.alpha = 0.28; s.visible = true;
      }
      const hd = skelExtra[0]; hd.texture = eelParts.head;
      hd.position.set(spine[0].x + Math.cos(aim) * 3 * VS, spine[0].y + Math.sin(aim) * 3 * VS);
      hd.rotation = aim; hd.width = 21 * VS; hd.height = 16 * VS; hd.tint = 0xffffff; hd.visible = true;
      const tl = spine[seg], tf = skelExtra[1]; tf.texture = eelParts.fin;
      tf.position.set(tl.x - Math.cos(aim) * 9 * VS, tl.y - Math.sin(aim) * 9 * VS);
      tf.rotation = aim; tf.width = 24 * VS; tf.height = 20 * VS; tf.tint = 0xffffff; tf.visible = true;
      const pf = skelExtra[2]; pf.texture = eelParts.fin;
      pf.position.set(spine[1].x + Math.sin(aim) * spine[1].r, spine[1].y - Math.cos(aim) * spine[1].r);
      pf.rotation = aim + Math.PI; pf.width = 14 * VS; pf.height = 12 * VS; pf.tint = 0xffffff; pf.visible = true;
      glow(TEX_SOFT, cx, cy, 26 * VS, fglow, 0.2);
      return true;
    } catch (e) { return false; }
  }

  function drawPlayer() {
    playerG.clear();
    playerSkel.visible = false;
    // the eel rig keeps its own sprite pool inside playerSkel; clear both pools
    // so a form switch never leaves last frame's bones on screen
    playerRig.hide();
    for (const s of skelSegs) s.visible = false;
    for (const s of skelBelly) s.visible = false;
    for (const s of skelExtra) s.visible = false;
    if (eelRibbon) eelRibbon.visible = false;
    if (angRB) angRB.mesh.visible = false;
    if (jellyRB) jellyRB.mesh.visible = false;
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
    const VS = f.key === 'eel' ? 1.42 : f.key === 'angler' ? 1.24 : 1.2;
    const P = (x, y, rot = aim) => {
      const xr = x * VS, yr = y * VS;
      return [cx + xr * Math.cos(rot) - yr * Math.sin(rot), cy + xr * Math.sin(rot) + yr * Math.cos(rot)];
    };

    // Never upside-down: mirror the whole player when its dorsal/dome would
    // point down. Eel/angler flip across the forward axis when facing left
    // (cos<0); jelly flips across the horizontal when facing down (sin>0).
    // pivot+position at the creature centre make the identity case a no-op.
    playerFlip.pivot.set(cx, cy);
    playerFlip.position.set(cx, cy);
    if (f.key === 'jelly') {
      // the jelly's bell leads toward the aim (mouse); no mirror, so the body
      // always faces the cursor
      playerFlip.rotation = 0;
      playerFlip.scale.set(1, 1);
      playerFlipped = false;
    } else {
      const flip = Math.cos(aim) < 0;
      playerFlip.rotation = flip ? 2 * aim : 0;
      playerFlip.scale.set(1, flip ? -1 : 1);
      playerFlipped = flip;
    }

    if (f.key === 'eel' && drawEelSkel(cx, cy, aim, t, speed, VS, fglow, fbody)) {
      /* sprite-skeleton swim: baked part atlas driven by a bone chain */
    } else if (f.key === 'eel') {
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
    } else if (f.key === 'angler' && drawAnglerSkel(cx, cy, aim, t, VS, fglow)) {
      /* sprite-skeleton: baked body/jaw/lure/fins on six bones */
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
    } else if (drawJellySkel(cx, cy, aim, t, VS, fglow, fbody)) {
      /* sprite-skeleton: baked bell + arms + tentacle strands */
    } else {
      // jelly fallback: rotated aim+90°, no directional scale
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
    // dash speed streaks — makes the dash readable at a glance
    if (game.dashT > 0) {
      const da = clamp(game.dashT / 0.22, 0, 1);
      const ddx = game.lastDirX || 1, ddy = game.lastDirY || 0;
      const dm = Math.hypot(ddx, ddy) || 1;
      const ux = ddx / dm, uy = ddy / dm;
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * 5 * VS;
        const ox = -uy * off, oy = ux * off;
        const tail = 30 + i * 5;
        playerG.moveTo(cx + ox - ux * 12 * VS, cy + oy - uy * 12 * VS)
          .lineTo(cx + ox - ux * tail * VS, cy + oy - uy * tail * VS)
          .stroke({ width: 2.4 - i * 0.35, color: fglow, alpha: 0.55 * da, cap: 'round' });
      }
      glow(TEX_SOFT, cx - ux * 16 * VS, cy - uy * 16 * VS, 34 * VS, fglow, 0.28 * da);
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
      darkG.rect(0, 0, w, h).fill({ color: 0x01050e, alpha: 0.6 });
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
      const a = 0.34 * Math.pow((i + 1) / N, 1.6) / N;
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
    const u = Math.min(w, h) / 700;
    const touch = typeof document !== 'undefined' && document.body.classList.contains('touch');
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
      const label = f.name;
      const tw = label.length * 7.6 + 16;
      const bx = cxp - tw;
      hudG.roundRect(bx, 10, tw, 22, 6).fill({ color: active ? hexInt(f.glow) : 0xffffff, alpha: active ? 0.18 : 0.04 });
      if (active) hudG.roundRect(bx, 10, tw, 22, 6).stroke({ width: 1.2, color: hexInt(f.glow), alpha: 0.8 });
      txt(label, cxp - 8, 21, `${active ? '700' : '500'} 12px ui-monospace, Menlo, monospace`, active ? f.body : 'rgba(190,215,240,0.45)', 'right', 1);
      cxp = bx - 6;
    }
    txt('SHIFT to shift form', sw - 18, 40, '500 10px ui-monospace, Menlo, monospace', 'rgba(170,205,235,0.5)', 'right', 1);
    // ability cooldown — on touch the bottom-left is the joystick, so park it top-left
    const cd = clamp(game.cooldown / 1.0, 0, 1);
    const dashBarY = touch ? 78 : sh - 30;
    const dashLblY = touch ? 68 : sh - 40;
    hudG.roundRect(18, dashBarY, 120, 5, 3).fill({ color: 0xffffff, alpha: 0.08 });
    hudG.roundRect(18, dashBarY, 120 * (1 - cd), 5, 3).fill({ color: hexInt(game.form ? game.form.glow : '#5ef2c8'), alpha: 0.85 });
    txt((game.form ? game.form.abilityName : '') + (game.form && game.form.ability === 'flare' ? ' (2 sparks)' : ''),
      18, dashLblY, '700 11px ui-monospace, Menlo, monospace', cd > 0 ? 'rgba(150,185,215,0.4)' : (game.form ? game.form.glow : '#5ef2c8'), 'left', 1);
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
    // hint + msg — on touch the bottom is the button cluster, so lift them below the top bar
    const hintY = touch ? 96 : sh - 24;
    const msgY = touch ? 114 : sh - 60;
    if (game.state === 'play' && game.time - game.startedAt < 9) {
      txt(game.hint, sw / 2, hintY, '500 12px ui-monospace, Menlo, monospace', 'rgba(200,230,255,1)', 'center', clamp(9 - (game.time - game.startedAt), 0, 1) * 0.7);
    }
    if (game.msg) {
      txt(game.msg.text, sw / 2, msgY, '600 13px ui-monospace, Menlo, monospace', 'rgba(255,200,140,1)', 'center', clamp(1 - game.msg.t / 2.2, 0, 1));
    }
  }

  // ---- overlays ----
  function overlayBase() {
    const w = W(), h = H();
    const u = Math.min(w, h) / 700;
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
    title('FISH N CHIPS', w / 2, cy, '700 74px Georgia, "Times New Roman", serif', '#dff3ff', 1, '#78dcff 40 0.9', 60, 40, 0.5);
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
    const touchT = typeof document !== 'undefined' && document.body.classList.contains('touch');
    txt(touchT ? 'joystick to swim · tap the water to aim & fire' : 'WASD / ARROWS swim · SHIFT shift form · R restart · M mute', w / 2, h * 0.92, '500 11px ui-monospace, Menlo, monospace', 'rgba(150,185,215,0.45)', 'center', 1);
  }

  function drawActCard() {
    hudG.clear();
    const { w, h } = overlayBase();
    const a = clamp(game.cardT / 0.6, 0, 1) * clamp((4.5 - game.cardT) / 0.8, 0, 1);
    hudG.rect(0, 0, w, h).fill({ color: 0x00040c, alpha: 0.55 * a });
    title(game.actName, w / 2, h * 0.44, '700 40px Georgia, serif', '#e1f5ff', a, '#78dcff 26 ' + (0.8 * a), 48, 30, 0.55 * a);
    txt(game.hint, w / 2, h * 0.53, '500 14px ui-monospace, Menlo, monospace', 'rgba(160,205,240,1)', 'center', 0.8 * a, null, Math.min(w * 0.82, 760));
    txt('any key to begin', w / 2, h * 0.66, '500 11px ui-monospace, Menlo, monospace', 'rgba(150,185,215,1)', 'center', 0.5 * a);
  }

  function drawWin() {
    hudG.clear();
    game.winT = (game.winT || 0) + 1 / 60;
    const { w, h } = overlayBase();
    const a = clamp(game.winT / 0.5, 0, 1);
    hudG.rect(0, 0, w, h).fill({ color: 0x00040c, alpha: 0.6 * a });
    title(game.levelIndex + 1 >= game.levels.length ? 'THE SURFACE' : 'ACT CLEARED', w / 2, h * 0.42, '700 44px Georgia, serif', '#fff0cd', a, '#ffd278 30 0.9', 52, 34, 0.55 * a);
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
    title('YOU REACHED THE LIGHT', w / 2, h * 0.36, '700 52px Georgia, serif', '#fff4dc', 1, '#ffe6a0 40 0.9', 56, 38, 0.5);
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
    title('RUN COMPLETE', w / 2, h * 0.24, '700 46px Georgia, serif', '#fff4dc', 1, '#ffe6a0 36 0.9', 52, 34, 0.5);
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
    title('HALL OF THE DEEP', w / 2, h * 0.16, '700 40px Georgia, serif', '#d6fff2', 1, '#78ffdc 28 0.7', 48, 30, 0.5);
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
    glowN = 0; partN = 0; textN = 0; tintN = 0; plateN = 0;
    for (const s of glowPool) s.visible = false;
    for (const s of partPool) s.visible = false;
    for (const t of textPool) t.visible = false;
    for (const s of tintPool) s.visible = false;
    for (const s of platePool) s.visible = false;
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
      // cheap parallax: the two baked scenery layers scroll at a fraction of the
      // camera rate, which is what sells depth between them and the play field
      const camL = -ox / s, camT = -oy / s;
      bgFarLayer.position.set(camL * 0.42, camT * 0.28);
      bgLayer.position.set(camL * 0.18, camT * 0.14);
      game._s = s * dpr; game._ox = ox * dpr; game._oy = oy * dpr;

      computeLights();
      drawWater();
      drawBackground();
      drawRock();
      drawObstacles();
      drawAmbient();
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
