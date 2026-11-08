// Fish N Chips — a bioluminescent shapeshifting descent
// Core engine: grid world, three forms, lure lighting, hazards, particles.

import { TILE, LEVELS } from './levels.js';
import { Audio } from './audio.js';

// ---------------------------------------------------------------- forms
const FORMS = {
  eel: {
    key: 'eel', name: 'EEL', num: 1, r: 8, speed: 250, accel: 1500, drag: 3.4,
    body: '#5ef2c8', glow: '#2affd5', accent: '#0b3f3a',
    ability: 'dash', abilityName: 'DASH',
    burns: false, narrow: true,
  },
  angler: {
    key: 'angler', name: 'ANGLER', num: 2, r: 15, speed: 165, accel: 900, drag: 4.2,
    body: '#ffd166', glow: '#ffb020', accent: '#4a2c07',
    ability: 'flare', abilityName: 'LURE / FLARE',
    burns: false, narrow: false,
  },
  jelly: {
    key: 'jelly', name: 'JELLY', num: 3, r: 11, speed: 130, accel: 620, drag: 2.2,
    body: '#c77dff', glow: '#e0aaff', accent: '#2b1055',
    ability: 'pulse', abilityName: 'PULSE',
    burns: true, narrow: false,
  },
};
const FORM_ORDER = ['eel', 'angler', 'jelly'];

const POWERS = {
  overcharge: { color: '#ffd166', name: 'OVERCHARGE', dur: 16, blurb: 'shots x2 · pierce' },
  storm:      { color: '#c77dff', name: 'STORM',      dur: 16, blurb: 'fire rate x2.4' },
  aegis:      { color: '#7ae7ff', name: 'AEGIS',      dur: 22, blurb: 'one death forgiven' },
};

// Per-act ocean palettes — every act reads as a DIFFERENT depth of the sea,
// but all stay ocean-themed (a top->bottom deep gradient). Indexed by levelIndex.
// top/mid/deep/bot = water gradient stops · ray = god-ray colour · surf = crest.
const PALETTES = [
  { top:'#0a2b4d', mid:'#06203a', deep:'#031425', bot:'#01060e', ray:'#9adeff', surf:'#afeeff' }, // I  Trench (teal-blue)
  { top:'#0c3a34', mid:'#062a28', deep:'#03181a', bot:'#010a0c', ray:'#9dffd8', surf:'#b6ffe9' }, // II Drift (kelp green)
  { top:'#2a1e46', mid:'#1a1436', deep:'#0e0a22', bot:'#05030f', ray:'#e6b8ff', surf:'#f0d2ff' }, // III Lure (violet dusk)
  { top:'#12324f', mid:'#0c2440', deep:'#071628', bot:'#02080f', ray:'#bcd8ff', surf:'#d4e6ff' }, // IV Gauntlet (steel blue)
  { top:'#0e4a5e', mid:'#0a3548', deep:'#06202f', bot:'#020b12', ray:'#c8f4ff', surf:'#d8fbff' }, // V Ascent (ice cyan)
  { top:'#101a44', mid:'#0a1230', deep:'#060a1e', bot:'#02040c', ray:'#8fa8ff', surf:'#c0ccff' }, // VI Hollow (abyssal indigo)
  { top:'#2a0f22', mid:'#1c0a18', deep:'#120610', bot:'#08030a', ray:'#ff9db0', surf:'#ffc2cd' }, // VII Matriarch (ember)
  { top:'#1a3a52', mid:'#16324a', deep:'#0e2236', bot:'#06121f', ray:'#ffe6a8', surf:'#fff0cf' }, // VIII Surface (dawn gold)
];

const SOLID = new Set(['#', 'h']);
const HAZARD_BURN = new Set(['a']);

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
// shortest signed angle from a to b (radians) — used for smoothed aim
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Mini-boss roster: one distinct creature per act (index = levelIndex), each with
// its own attack 'surprise'. The final act instead carries the Matriarch ('B').
const MINIBOSSES = [
  { kind: 'crab',    name: 'STONE-CRAB',       hp: 22, c: '#c8a06a', glow: '#ffd9a0', r: 26 },
  { kind: 'manta',   name: 'DROWNED MANTA',    hp: 26, c: '#7fa8ff', glow: '#bcd4ff', r: 30 },
  { kind: 'urchin',  name: 'URCHIN COLOSSUS',  hp: 30, c: '#ff5d73', glow: '#ff9db0', r: 28 },
  { kind: 'moray',   name: 'MORAY TITAN',      hp: 34, c: '#8fd36a', glow: '#d4ff9a', r: 27 },
  { kind: 'king',    name: 'LANTERNFISH KING', hp: 38, c: '#ffd06a', glow: '#fff0c0', r: 30 },
  { kind: 'kraken',  name: 'THE INK-KRAKEN',   hp: 44, c: '#b06ae0', glow: '#e0aaff', r: 32 },
  { kind: 'serpent', name: 'REEF SERPENT',     hp: 50, c: '#5ef2c8', glow: '#a8ffe8', r: 28 },
];

// ---------------------------------------------------------------- score store
// Persisted high scores (item 7). Survives reloads; every read is defensive so
// a disabled/quota-busted localStorage can never take the game down.
const SCORE_KEY = 'fishnchips_scores';
function loadScores() {
  try {
    const raw = window.localStorage.getItem(SCORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e === 'object' && typeof e.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  } catch (e) { return []; }
}
function saveScore(entry) {
  const all = loadScores();
  all.push(entry);
  const top = all.sort((a, b) => b.score - a.score).slice(0, 10);
  try { window.localStorage.setItem(SCORE_KEY, JSON.stringify(top)); } catch (e) { /* quota / disabled */ }
  return top;
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  // a missing/odd color must never take the renderer down — fall back to water-light
  if (typeof hex !== 'string' || hex[0] !== '#') return `rgba(200,232,255,${a})`;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------- game
class Game {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    // bloom buffer: quarter-res copy of the frame, blurred and added back
    this.bloom = document.createElement('canvas');
    this.blctx = this.bloom.getContext('2d');
    this.bloomOn = true;
    // When true, the Canvas 2D bloom + vignette post-passes are skipped so an
    // external GPU compositor (the PixiJS build) can own those effects instead.
    // Defaults false: the shipping Canvas build is unaffected.
    this.externalFX = false;
    // baked static rock layer, rebuilt per level (frees frame budget for the glow)
    this.rock = document.createElement('canvas');
    this.rctx = this.rock.getContext('2d');
    this.rings = [];
    // combat / aim state
    this.aim = 0;
    this.aimTarget = 0;   // smoothed aim: target angle from cursor / right-stick
    this.mouse = null;
    this.padAim = { x: 0, y: 0 };
    this.firing = false;
    this.shotCd = 0;
    this.shots = [];
    this.eshots = [];
    this.powerups = [];
    this.power = null;
    this.boss = null;
    this.bossOrbs = [];
    this.minibosses = [];   // per-act mini-bosses spawned from level char 'M'
    this.inkClouds = [];    // kraken ink: light-eating clouds
    this._s = 0; this._ox = 0; this._oy = 0;

    this.canBlur = (() => {
      try {
        const t = document.createElement('canvas').getContext('2d');
        t.filter = 'blur(3px)';
        return /blur/.test(t.filter || '');
      } catch (e) { return false; }
    })();
    this.au = new Audio();

    this.state = 'title'; // title | play | actcard | win | ending | score | leaderboard
    this.levelIndex = 0;
    this.sparks = 0;
    this.deaths = 0;
    this.time = 0;
    this.startedAt = 0;
    this.muted = false;
    // score system (item 7): per-run elapsed time + total enemy kills
    this.kills = 0;
    this.runStats = null;
    this.lastScore = null;
    this.lastRank = -1;
    this.nameEntry = '';
    this.scores = loadScores();

    this.keys = new Set();
    this.pressed = new Set();
    this.pad = { prev: [] };

    this.particles = [];
    this.motes = [];
    this.litSources = [];
    this.flash = 0;
    this.shake = 0;
    this.fade = 1;
    this.msg = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    this.cv.addEventListener('pointerdown', (e) => {
      this.tap();
      if (this.state === 'play') { this.setMouse(e); this.firing = true; }
    });
    window.addEventListener('pointermove', (e) => { if (this.state === 'play') this.setMouse(e); });
    window.addEventListener('pointerup', () => { this.firing = false; });

    this.initMotes();
    this.loop = this.loop.bind(this);
    // When hosted by the PixiJS build, the Pixi ticker drives update+draw
    // instead of this self-scheduling Canvas loop.
    if (!window.__PIXI_HOST__) requestAnimationFrame(this.loop);
  }

  tap() {
    if (this.state === 'title') this.begin();
    else if (this.state === 'actcard') this.state = 'play';
    else if (this.state === 'win') this.nextAct();
    else if (this.state === 'score') this.submitScore();
    else if (this.state === 'leaderboard') this.restartRun();
    else if (this.state === 'ending') this.restartRun();
  }

  restartRun() {
    this.levelIndex = 0; this.sparks = 0; this.deaths = 0; this.kills = 0;
    this.lastScore = null; this.nameEntry = '';
    this.begin();
  }

  onKey(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    if (down && !this.keys.has(k)) this.pressed.add(k);
    down ? this.keys.add(k) : this.keys.delete(k);

    if (!down) return;

    if (this.state === 'title') { this.begin(); return; }
    if (this.state === 'actcard') { this.state = 'play'; return; }
    if (this.state === 'win') { this.nextAct(); return; }
    if (this.state === 'ending') { this.restartRun(); return; }
    // score screen: type a name, Enter submits. leaderboard: R (or any key) replays.
    if (this.state === 'score') { this.scoreKey(k, e.key); return; }
    if (this.state === 'leaderboard') { if (k === 'r' || e.key === 'Enter' || e.key === ' ') this.restartRun(); return; }

    if (k === 'm') { this.muted = !this.muted; this.au.setMuted(this.muted); }
    if (k === 'b') { this.bloomOn = !this.bloomOn; }
    if (k === 'r') { this.die(true); }
    if (k === '1') this.setForm('eel');
    if (k === '2') this.setForm('angler');
    if (k === '3') this.setForm('jelly');
    if (k === 'q') this.cycleForm(-1);
    if (k === 'e') this.cycleForm(1);
    if (k === ' ' || k === 'Shift') this.ability();
    if (k === 'f') this.firing = down;
  }

  cycleForm(d) {
    const i = FORM_ORDER.indexOf(this.form.key);
    this.setForm(FORM_ORDER[(i + d + FORM_ORDER.length) % FORM_ORDER.length]);
  }

  // Is a given radius free of solids at (x,y)? Used by the form-swap nudge.
  fitsAt(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      if (!this.isSolid(this.map[ty][tx])) continue;
      const cx = clamp(x, tx * TILE, tx * TILE + TILE);
      const cy = clamp(y, ty * TILE, ty * TILE + TILE);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
    }
    return true;
  }

  // Item 2: swapping next to a wall used to be refused outright. Instead, nudge
  // a few pixels along the 8 compass directions (and their mid-steps) to find a
  // spot where the NEW form fits, so you can shift while hugging rock.
  findSwapSpot(r) {
    if (this.fitsAt(this.px, this.py, r)) return { x: this.px, y: this.py };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];
    for (let d = 2; d <= 10; d += 2) {
      for (const [ux, uy] of dirs) {
        const nx = this.px + ux * d, ny = this.py + uy * d;
        if (this.fitsAt(nx, ny, r)) return { x: nx, y: ny };
      }
    }
    return null;
  }

  setForm(key) {
    if (this.state !== 'play' || this.form.key === key) return;
    const f = FORMS[key];
    // don't let a form change drop you inside rock — but first try a small nudge
    const old = this.form;
    const spot = this.findSwapSpot(f.r);
    this.form = f;
    if (!spot) { this.form = old; this.au.blip(200, 0.08, 'square', 0.12); return; }
    if (spot.x !== this.px || spot.y !== this.py) {
      this.px = spot.x; this.py = spot.y;
      this.ring(this.px, this.py, f.glow, 3, 30, 0.3);
    }
    this.au.shift();
    this.shake = Math.max(this.shake, 6);
    this.flash = Math.max(this.flash, 0.35);
    this.ring(this.px, this.py, f.glow, 6, 78, 0.55);
    for (let i = 0; i < 26; i++) {
      this.particles.push({
        x: this.px, y: this.py, vx: rnd(-160, 160), vy: rnd(-160, 160),
        life: rnd(0.3, 0.8), max: 0.8, c: f.glow, s: rnd(1.5, 3.5), g: 0,
      });
    }
  }

  // -------------------------------------------------- level loading
  begin() {
    this.au.startAmbient();
    this.startedAt = this.time;
    this.kills = 0;
    this.loadLevel(this.levelIndex);
  }

  loadLevel(i) {
    this.levelIndex = clamp(i, 0, LEVELS.length - 1);
    const L = LEVELS[this.levelIndex];
    this.map = L.map.slice();
    this.w = this.map[0].length;
    this.h = this.map.length;
    this.ww = this.w * TILE;
    this.wh = this.h * TILE;
    // distinct ocean-depth palette for this act (shared by Canvas + Pixi draws)
    this.pal = PALETTES[this.levelIndex % PALETTES.length];

    this.plankton = [];
    this.urchins = [];
    this.fish = [];
    this.vipers = [];
    this.lanterns = [];
    this.stingers = [];
    this.shots = [];
    this.eshots = [];
    this.powerups = [];
    this.bossOrbs = [];
    this.boss = null;
    this.minibosses = [];
    this.inkClouds = [];
    this.power = null;
    this.bulbs = [];
    this.anemones = [];
    this.currents = [];
    this.checkpoints = [];
    this.goal = null;
    this.spawn = { x: TILE * 1.5, y: TILE * 1.5 };

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.map[y][x];
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        if (c === 'S') this.spawn = { x: cx, y: cy };
        else if (c === '*') this.plankton.push({ x: cx, y: cy, got: false, ph: Math.random() * 6 });
        else if (c === 'U') this.urchins.push({ x: cx, y: cy, ph: Math.random() * 6, hp: 2, dead: false });
        else if (c === 'F') this.fish.push({ x: cx, y: cy, x0: cx, dir: 1, stun: 0, ph: Math.random() * 6, hp: 2, dead: false });
        else if (c === 'V') this.vipers.push({ x: cx, y: cy, x0: cx, y0: cy, dir: 1, stun: 0, charge: 0, rest: 0, vx: 0, vy: 0, ph: Math.random() * 6, hp: 3, dead: false });
        else if (c === 'L') this.lanterns.push({ x: cx, y: cy, x0: cx, y0: cy, stun: 0, ph: Math.random() * 6, hp: 2, dead: false });
        else if (c === 'T') this.stingers.push({ x: cx, y: cy, ph: Math.random() * 6, reach: 0, stun: 0 });
        else if (c === 'b') this.bulbs.push({ x: cx, y: cy, ph: Math.random() * 6 });
        else if (c === 'a') this.anemones.push({ x, y });
        else if (c === '^' || c === 'v' || c === '<' || c === '>') this.currents.push({ x, y, dx: c, ph: Math.random() * 6 });
        else if (c === 'D') this.checkpoints.push({ x: cx, y: cy, on: false, ph: Math.random() * 6 });
        else if (c === 'G') this.goal = { x: cx, y: cy };
        else if (c === 'P') this.powerups.push({ x: cx, y: cy, type: ['overcharge', 'storm', 'aegis'][Math.floor(Math.random() * 3)], got: false, ph: Math.random() * 6 });
        else if (c === 'B') this.boss = { x: cx, y: cy, x0: cx, y0: cy, hp: 60, maxhp: 60, t: 0, fireT: 1.4, enraged: false, dead: false, dieT: 0, ph: 0, final: true };
        else if (c === 'M') {
          // one mini-boss per act, kind chosen by act index (item 4)
          const spec = MINIBOSSES[this.levelIndex % MINIBOSSES.length];
          this.minibosses.push({
            kind: spec.kind, name: spec.name, color: spec.c, glow: spec.glow, glowC: spec.glow, r: spec.r,
            x: cx, y: cy, x0: cx, y0: cy, hp: spec.hp, maxhp: spec.hp,
            t: 0, fireT: 1.2, ph: 0, enraged: false, dead: false, dieT: 0,
            swoop: 0, charge: 0, rest: 0, vx: 0, vy: 0, spin: 0, seed: Math.random() * 6,
          });
        }
      }
    }

    // group contiguous vertical anemone tiles into runs so the curtain reads as
    // long tentacles instead of a stack of per-tile chevrons
    this.anemoneRuns = [];
    const acols = {};
    for (const a of this.anemones) (acols[a.x] = acols[a.x] || []).push(a.y);
    for (const x in acols) {
      const ys = acols[x].sort((p, q) => p - q);
      let s = ys[0], prev = ys[0];
      for (let i = 1; i <= ys.length; i++) {
        if (i < ys.length && ys[i] === prev + 1) { prev = ys[i]; continue; }
        this.anemoneRuns.push({ x: Number(x), y0: s, y1: prev });
        if (i < ys.length) { s = ys[i]; prev = ys[i]; }
      }
    }

    this.px = this.spawn.x; this.py = this.spawn.y;
    this.vx = 0; this.vy = 0;
    this.form = FORMS.eel;
    this.respawn = { ...this.spawn };
    this.cooldown = 0;
    this.pulse = 0;
    this.dashT = 0;
    this.trail = [];
    this.state = 'actcard';
    this.cardT = 0;
    this.fade = 1;
    this.actName = L.name;
    this.hint = L.hint;
    this.rings = [];
    this.flare = null;
    this.initMotes();
    this.bakeRock();
  }

  nextAct() {
    // the last act's win screen hands off to the score screen (item 7)
    if (this.levelIndex + 1 >= LEVELS.length) { this.finalizeRun(); return; }
    this.loadLevel(this.levelIndex + 1);
  }

  // -------------------------------------------------- score + leaderboard (item 7)
  finalizeRun() {
    const clear = Math.max(0, this.time - this.startedAt);
    const base = 1000;
    const killPts = this.kills * 50;
    const timeBonus = Math.max(0, 3000 - Math.floor(clear * 12));
    this.runStats = { time: clear, kills: this.kills, score: base + killPts + timeBonus, timeBonus };
    this.nameEntry = '';
    this.state = 'score';
    this.au.win();
  }

  submitScore() {
    if (!this.runStats) return;
    const nm = (this.nameEntry || 'DIVER').toUpperCase().slice(0, 12).trim() || 'DIVER';
    const entry = {
      name: nm,
      time: Math.round(this.runStats.time * 100) / 100,
      kills: this.runStats.kills,
      score: this.runStats.score,
      date: new Date().toISOString().slice(0, 10),
    };
    this.scores = saveScore(entry);
    this.lastScore = entry;
    this.lastRank = this.scores.indexOf(entry);
    this.state = 'leaderboard';
    this.au.ping();
  }

  // name-entry typing for the score screen: A-Z 0-9, backspace, enter
  scoreKey(k, raw) {
    if (raw === 'Backspace') { this.nameEntry = this.nameEntry.slice(0, -1); return true; }
    if (raw === 'Enter') { this.submitScore(); return true; }
    if (k && k.length === 1 && /[a-z0-9 ]/.test(k) && this.nameEntry.length < 12) {
      this.nameEntry += k.toUpperCase();
      this.au.blip(700, 0.04, 'square', 0.06);
      return true;
    }
    return false;
  }

  initMotes() {
    this.motes = [];
    const n = 260;
    for (let i = 0; i < n; i++) {
      this.motes.push({
        x: Math.random() * 1600, y: Math.random() * 900,
        s: rnd(0.6, 2.2), a: rnd(0.15, 0.7),
        vx: rnd(-6, 6), vy: rnd(-14, -3), ph: Math.random() * 6,
      });
    }
  }

  // -------------------------------------------------- geometry / collision
  tileAt(wx, wy) {
    const x = Math.floor(wx / TILE), y = Math.floor(wy / TILE);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return '#';
    return this.map[y][x];
  }

  isSolid(c) { return SOLID.has(c); }

  overlapsSolid() {
    const r = this.form.r;
    const x0 = Math.floor((this.px - r) / TILE), x1 = Math.floor((this.px + r) / TILE);
    const y0 = Math.floor((this.py - r) / TILE), y1 = Math.floor((this.py + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      if (this.isSolid(this.map[y][x])) {
        const cx = clamp(this.px, x * TILE, x * TILE + TILE);
        const cy = clamp(this.py, y * TILE, y * TILE + TILE);
        if ((this.px - cx) ** 2 + (this.py - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  resolveSolid() {
    const r = this.form.r;
    const x0 = Math.floor((this.px - r) / TILE), x1 = Math.floor((this.px + r) / TILE);
    const y0 = Math.floor((this.py - r) / TILE), y1 = Math.floor((this.py + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      if (!this.isSolid(this.map[y][x])) continue;
      const cx = clamp(this.px, x * TILE, x * TILE + TILE);
      const cy = clamp(this.py, y * TILE, y * TILE + TILE);
      let dx = this.px - cx, dy = this.py - cy;
      let d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 0.0001) { // center inside tile: push along smaller axis
        const l = this.px - x * TILE, rr = (x + 1) * TILE - this.px;
        const t = this.py - y * TILE, b = (y + 1) * TILE - this.py;
        const m = Math.min(l, rr, t, b);
        if (m === l) { this.px = x * TILE - r; this.vx = Math.min(this.vx, 0); }
        else if (m === rr) { this.px = (x + 1) * TILE + r; this.vx = Math.max(this.vx, 0); }
        else if (m === t) { this.py = y * TILE - r; this.vy = Math.min(this.vy, 0); }
        else { this.py = (y + 1) * TILE + r; this.vy = Math.max(this.vy, 0); }
        continue;
      }
      const push = (r - d) / d;
      this.px += dx * push; this.py += dy * push;
      // kill velocity into the surface
      const nx = dx / d, ny = dy / d;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) { this.vx -= vn * nx; this.vy -= vn * ny; }
    }
  }

  // -------------------------------------------------- abilities
  ability() {
    if (this.cooldown > 0) return;
    const a = this.form.ability;
    if (a === 'dash') {
      const dx = this.lastDirX || 1, dy = this.lastDirY || 0;
      const m = Math.hypot(dx, dy) || 1;
      this.vx += (dx / m) * 460; this.vy += (dy / m) * 460;
      this.dashT = 0.22; this.cooldown = 0.55;
      this.au.blip(320, 0.14, 'triangle', 0.22);
      this.burst(this.px, this.py, 10, this.form.glow, 120);
      this.ring(this.px, this.py, this.form.glow, 5, 52, 0.35);
    } else if (a === 'flare') {
      if (this.sparks < 2) { this.au.blip(160, 0.12, 'square', 0.14); this.say('need 2 sparks'); return; }
      this.sparks -= 2;
      this.flare = { x: this.px, y: this.py, t: 0, life: 1.1, r: 0 };
      this.cooldown = 1.0; this.flash = 0.5; this.shake = 8;
      this.au.flare();
      this.ring(this.px, this.py, '#ffe8a3', 10, 250, 0.7);
      for (const f of this.fish) {
        if (Math.hypot(f.x - this.px, f.y - this.py) < 240) { f.stun = 3.2; this.burst(f.x, f.y, 8, '#8ecae6', 60); }
      }
      for (const v of this.vipers) {
        if (Math.hypot(v.x - this.px, v.y - this.py) < 260) { v.stun = 3.4; v.charge = 0; v.rest = 1.2; this.burst(v.x, v.y, 10, '#9d8cff', 70); }
      }
      for (const l of this.lanterns) {
        if (Math.hypot(l.x - this.px, l.y - this.py) < 260) { l.stun = 4.0; this.burst(l.x, l.y, 8, '#ffe08a', 60); }
      }
      this.burst(this.px, this.py, 34, '#ffe8a3', 200);
    } else if (a === 'pulse') {
      this.vy = -230; this.pulse = 0.5; this.cooldown = 0.45;
      this.au.blip(520, 0.2, 'sine', 0.2);
      this.ring(this.px, this.py + 6, '#e0aaff', 6, 46, 0.4);
      for (let i = 0; i < 12; i++) {
        this.particles.push({ x: this.px + rnd(-8, 8), y: this.py + 8, vx: rnd(-40, 40), vy: rnd(30, 90), life: rnd(0.3, 0.7), max: 0.7, c: '#e0aaff', s: rnd(1.5, 3), g: -20 });
      }
    }
  }

  burst(x, y, n, c, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(sp * 0.3, sp);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.8), max: 0.8, c, s: rnd(1.2, 3.2), g: 0 });
    }
  }

  losClear(x1, y1, x2, y2) {
    const n = 14;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const tc = this.tileAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      if (tc === '#' || tc === 'h') return false;
    }
    return true;
  }

  say(t) { this.msg = { text: t, t: 0 }; }

  die(silentForm) {
    if (this.power && this.power.type === 'aegis' && this.power.t > 0) {
      this.power = null; this.shake = 10; this.flash = 0.5; this.au.powerup();
      this.ring(this.px, this.py, '#7ae7ff', 8, 130, 0.6);
      this.burst(this.px, this.py, 34, '#7ae7ff', 170);
      this.vx = 0; this.vy = 0; this.pulse = 0.4; this.say('aegis absorbed the hit'); return;
    }
    this.deaths++;
    this.au.sting();
    this.shake = 14; this.flash = 0.6;
    this.burst(this.px, this.py, 40, '#ff5d73', 220);
    this.ring(this.px, this.py, '#ff5d73', 8, 130, 0.6);
    this.px = this.respawn.x; this.py = this.respawn.y;
    this.vx = 0; this.vy = 0;
    this.form = FORMS.eel;
    for (const c of this.checkpoints) if (c.on) { /* keep */ }
    this.fade = 1;
  }

  // -------------------------------------------------- update
  loop(ts) {
    const now = ts / 1000;
    let dt = Math.min(0.033, now - (this.last || now));
    this.last = now; this.time += dt;
    this.pollPad();
    this.update(dt);
    this.draw();
    this.pressed.clear();
    requestAnimationFrame(this.loop);
  }

  pollPad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...gps].find((g) => g);
    this.padAxis = { x: 0, y: 0 };
    if (!gp) return;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.abs(ax) > 0.2) this.padAxis.x = ax;
    if (Math.abs(ay) > 0.2) this.padAxis.y = ay;
    const b = gp.buttons;
    const hit = (i) => b[i] && b[i].pressed && !this.pad.prev[i];
    if (this.state !== 'play') { if (b[0] && b[0].pressed) this.tap(); }
    else {
      this.padAim = { x: gp.axes[2] || 0, y: gp.axes[3] || 0 };
      const trig = (b[7] && b[7].value > 0.4) || (b[5] && b[5].pressed);
      this.firing = !!trig;
      if (hit(0)) this.ability();
      if (hit(2)) this.cycleForm(1);
      if (hit(1)) this.cycleForm(-1);
      if (hit(3)) this.die();
    }
    this.pad.prev = b.map((x) => x.pressed);
  }

  update(dt) {
    // motes always drift
    for (const m of this.motes) {
      m.x += (m.vx + Math.sin(this.time * 0.6 + m.ph) * 4) * dt;
      m.y += m.vy * dt;
      if (m.y < -20) { m.y = (this.wh || 756) + 20; m.x = Math.random() * (this.ww || 1344); }
      if (m.x < -20) m.x = (this.ww || 1344) + 20;
    }
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) + (p.g || 0) * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.fade = Math.max(0, this.fade - dt * 1.4);
    if (this.msg) { this.msg.t += dt; if (this.msg.t > 2.2) this.msg = null; }
    if (this.flare) { this.flare.t += dt; this.flare.r = lerp(this.flare.r, 260, dt * 8); if (this.flare.t > this.flare.life) this.flare = null; }

    if (this.state === 'actcard') { this.cardT += dt; if (this.cardT > 4.5) this.state = 'play'; return; }
    if (this.state !== 'play') return;

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.pulse = Math.max(0, this.pulse - dt);

    // input axis
    let ix = 0, iy = 0;
    if (this.keys.has('a') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('d') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('w') || this.keys.has('ArrowUp')) iy -= 1;
    if (this.keys.has('s') || this.keys.has('ArrowDown')) iy += 1;
    if (this.padAxis.x) ix += this.padAxis.x;
    if (this.padAxis.y) iy += this.padAxis.y;
    if (this.touchAxis) { ix += this.touchAxis.x; iy += this.touchAxis.y; }
    const im = Math.hypot(ix, iy);
    if (im > 1) { ix /= im; iy /= im; }
    if (Math.abs(ix) + Math.abs(iy) > 0.05) { this.lastDirX = ix; this.lastDirY = iy; }

    // ---- aim (item 1): target from cursor / right-stick / heading, then a
    // dt-based shortest-arc lerp toward it. SMOOTH ~11 keeps it responsive but
    // removes the snap/twitch of the old direct atan2 assignment. ----
    const SMOOTH = 11;
    let wantAim = false;
    if (this.padAim && (Math.abs(this.padAim.x) > 0.25 || Math.abs(this.padAim.y) > 0.25)) {
      this.aimTarget = Math.atan2(this.padAim.y, this.padAim.x); wantAim = true;
    } else if (this.mouse && this._s) {
      const wx = (this.mouse.x - this._ox) / this._s, wy = (this.mouse.y - this._oy) / this._s;
      if (Math.hypot(wx - this.px, wy - this.py) > 8) { this.aimTarget = Math.atan2(wy - this.py, wx - this.px); wantAim = true; }
    } else if (Math.hypot(this.vx, this.vy) > 22) {
      this.aimTarget = Math.atan2(this.vy, this.vx); wantAim = true;
    }
    if (wantAim) this.aim += angDiff(this.aim, this.aimTarget) * Math.min(1, dt * SMOOTH);
    else this.aim = this.aimTarget;
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.power) { this.power.t -= dt; if (this.power.t <= 0 && this.power.type !== 'aegis') this.power = null; }
    if (this.firing) this.fire();

    const f = this.form;
    const drag = f.drag * (this.pulse > 0 ? 0.5 : 1);
    this.vx += ix * f.accel * dt;
    this.vy += iy * f.accel * dt;
    // buoyancy: jelly floats, eel sinks a touch
    this.vy += (f.key === 'jelly' ? -12 : f.key === 'eel' ? 26 : 10) * dt;
    // currents
    const tc = this.tileAt(this.px, this.py);
    if (tc === '^') this.vy -= 300 * dt;
    else if (tc === 'v') this.vy += 300 * dt;
    else if (tc === '<') this.vx -= 300 * dt;
    else if (tc === '>') this.vx += 300 * dt;
    // drag
    this.vx -= this.vx * drag * dt;
    this.vy -= this.vy * drag * dt;
    const vmax = f.speed * (this.dashT > 0 ? 2.1 : 1.35);
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > vmax) { this.vx *= vmax / sp; this.vy *= vmax / sp; }

    this.px += this.vx * dt; this.py += this.vy * dt;
    this.resolveSolid();

    // trail
    this.trail.push({ x: this.px, y: this.py, t: 0 });
    for (const t of this.trail) t.t += dt;
    this.trail = this.trail.filter((t) => t.t < 0.55);

    // trail bubbles
    if (Math.random() < dt * 22) {
      this.particles.push({ x: this.px + rnd(-4, 4), y: this.py + rnd(-4, 4), vx: rnd(-8, 8), vy: rnd(-30, -12), life: rnd(0.4, 1), max: 1, c: f.glow, s: rnd(0.8, 1.8), g: -8 });
    }

    // hazards
    const r = f.r;
    for (const u of this.urchins) {
      if (Math.hypot(u.x - this.px, u.y - this.py) < r + 11) { this.die(); return; }
    }
    for (const fi of this.fish) {
      fi.stun = Math.max(0, fi.stun - dt);
      if (fi.stun <= 0) {
        fi.x += fi.dir * 78 * dt;
        if (Math.abs(fi.x - fi.x0) > 150) fi.dir *= -1;
        if (this.tileAt(fi.x + fi.dir * 16, fi.y) === '#' || this.tileAt(fi.x + fi.dir * 16, fi.y) === 'h') fi.dir *= -1;
      }
      if (Math.hypot(fi.x - this.px, fi.y - this.py) < r + 13 && fi.stun <= 0) { this.die(); return; }
    }

    // ---- VIPERFISH: lurks, then charges what it can see -----------------------
    for (const v of this.vipers) {
      v.stun = Math.max(0, v.stun - dt);
      const dx = this.px - v.x, dy = this.py - v.y;
      const d = Math.hypot(dx, dy);
      if (v.stun > 0) {
        v.vx *= 0.86; v.vy *= 0.86;
      } else if (v.charge > 0) {
        v.charge -= dt;
        v.x += v.vx * dt; v.y += v.vy * dt;
        if (this.tileAt(v.x, v.y) === '#' || this.tileAt(v.x, v.y) === 'h') {
          v.x -= v.vx * dt; v.y -= v.vy * dt; v.charge = 0; v.rest = 1.1;
        }
        if (Math.random() < 0.5) this.particles.push({ x: v.x, y: v.y, vx: rnd(-12, 12), vy: rnd(-12, 12), life: 0.35, max: 0.35, c: '#8f7dff', s: rnd(1, 2.4), g: 0 });
      } else if (v.rest > 0) {
        v.rest -= dt;
        v.x += (v.x0 - v.x) * 1.6 * dt; v.y += (v.y0 - v.y) * 1.6 * dt;
      } else {
        // drift on station, watching
        v.x += Math.sin(this.time * 0.8 + v.ph) * 9 * dt + (v.x0 - v.x) * 0.6 * dt;
        v.y += Math.cos(this.time * 0.6 + v.ph) * 7 * dt + (v.y0 - v.y) * 0.6 * dt;
        v.shootCd = (v.shootCd || 0) - dt;
        if (d < 250 && this.losClear(v.x, v.y, this.px, this.py)) {
          v.charge = 0.62; v.rest = 1.15;
          const u = 1 / Math.max(d, 1), sp = 330;
          v.vx = dx * u * sp; v.vy = dy * u * sp;
          this.au.blip(230, 0.1, 'sawtooth', 0.12);
          this.ring(v.x, v.y, '#8f7dff', 4, 40, 0.3);
          if (v.shootCd <= 0) {
            v.shootCd = 1.7;
            const bs = 240;
            this.eshots.push({ x: v.x, y: v.y, vx: dx * u * bs, vy: dy * u * bs, life: 2.2, r: 4, c: '#b79bff' });
            this.au.blip(520, 0.08, 'square', 0.1);
          }
        }
      }
      if (Math.abs(v.vx) > 4) v.dir = v.vx < 0 ? -1 : 1;
      v.glow = v.charge > 0 ? 1 : (v.stun > 0 ? 0.25 : 0.55 + 0.2 * Math.sin(this.time * 2 + v.ph));
      if (v.stun <= 0 && Math.hypot(v.x - this.px, v.y - this.py) < r + 14) { this.say('viperfish — it charges what it can see'); this.die(); return; }
    }

    // ---- LANTERNFISH: slow, drawn to your light -------------------------------
    for (const l of this.lanterns) {
      l.stun = Math.max(0, l.stun - dt);
      const dx = this.px - l.x, dy = this.py - l.y;
      const d = Math.hypot(dx, dy) || 1;
      if (l.stun > 0) {
        l.x -= dx / d * 46 * dt; l.y -= dy / d * 46 * dt;
      } else if (d < 300) {
        l.x += dx / d * 34 * dt; l.y += dy / d * 34 * dt;
      } else {
        l.x += (l.x0 - l.x) * 0.4 * dt + Math.sin(this.time * 0.5 + l.ph) * 8 * dt;
        l.y += (l.y0 - l.y) * 0.4 * dt + Math.cos(this.time * 0.4 + l.ph) * 8 * dt;
      }
      if (this.tileAt(l.x, l.y) === '#' || this.tileAt(l.x, l.y) === 'h') { l.x -= dx / d * 40 * dt; l.y -= dy / d * 40 * dt; }
      l.dir = dx < 0 ? -1 : 1;
      l.pulse = 0.6 + 0.4 * Math.sin(this.time * 1.6 + l.ph);
      if (l.stun <= 0 && Math.hypot(l.x - this.px, l.y - this.py) < r + 12) { this.say('lanternfish hunts your glow — flare it away'); this.die(); return; }
    }

    // ---- STINGER: a timed gate, lethal only while extended --------------------
    for (const s of this.stingers) {
      s.stun = Math.max(0, (s.stun || 0) - dt);
      const cyc = Math.sin(this.time * 1.15 + s.ph);
      s.reach = (cyc > 0 && s.stun <= 0) ? cyc * 40 : 0;
      if (s.reach > 12 && Math.hypot(s.x - this.px, s.y - this.py) < r + s.reach * 0.78) {
        this.say('stinger — wait for it to retract, then pass');
        this.die(); return;
      }
    }
    if (!f.burns) {
      const t2 = this.tileAt(this.px, this.py);
      if (HAZARD_BURN.has(t2)) { this.au.blip(120, 0.2, 'sawtooth', 0.18); this.say(f.name + ' burns in the anemone — shift to JELLY'); this.die(); return; }
    }

    // ---- COMBAT: projectiles, boss, boss orbs, power-ups -------------------
    for (const es of this.eshots) {
      // homing enemy pulses (lanternfish king / reef serpent) curve after the player
      if (es.home && es.maxs) {
        const hx = this.px - es.x, hy = this.py - es.y, hd = Math.hypot(hx, hy) || 1;
        const turn = 3.2 * dt; es.vx += (hx / hd) * es.maxs * turn; es.vy += (hy / hd) * es.maxs * turn;
        const sp = Math.hypot(es.vx, es.vy) || 1; if (sp > es.maxs) { es.vx *= es.maxs / sp; es.vy *= es.maxs / sp; }
      }
      es.x += es.vx * dt; es.y += es.vy * dt; es.life -= dt;
      if (es.g) es.vy += es.g * dt;   // lobbed rock shards arc and fall
      const t = this.tileAt(es.x, es.y);
      if (t === '#' || t === 'h') { es.life = 0; if (es.g) this.burst(es.x, es.y, 5, '#c9a06a', 60); }
      if (es.life > 0 && Math.hypot(es.x - this.px, es.y - this.py) < r + es.r) {
        es.life = 0; this.say(es.msg || 'viperfish spit — break its line of sight'); this.die(); return;
      }
    }
    this.eshots = this.eshots.filter((es) => es.life > 0);

    if (this.updateMiniBosses(dt, r)) return;
    this.updateCombat(dt, r);

    // pickups
    for (const p of this.plankton) {
      if (p.got) continue;
      if (Math.hypot(p.x - this.px, p.y - this.py) < r + 12) {
        p.got = true; this.sparks++;
        this.au.collect(); this.burst(p.x, p.y, 14, '#a0f0c8', 90);
      }
    }
    for (const c of this.checkpoints) {
      if (c.on) continue;
      if (Math.hypot(c.x - this.px, c.y - this.py) < r + 14) {
        c.on = true; this.respawn = { x: c.x, y: c.y };
        this.au.ping(); this.burst(c.x, c.y, 20, '#7ae7ff', 120);
        this.ring(c.x, c.y, '#7ae7ff', 8, 90, 0.7);
      }
    }
    // GOAL MAGNET: once the beacon is live, gently pull the player in so a fast
    // approach gets absorbed into it instead of orbiting or skimming past the
    // hitbox (the old bug: swimming toward the beacon circled it). Bigger radius.
    if (this.goal && !this.bossAlive()) {
      const gdx = this.goal.x - this.px, gdy = this.goal.y - this.py;
      const gd = Math.hypot(gdx, gdy) || 1;
      if (gd < 130) { this.vx += gdx / gd * 260 * dt; this.vy += gdy / gd * 260 * dt; }
    }
    if (this.goal && !this.bossAlive() && Math.hypot(this.goal.x - this.px, this.goal.y - this.py) < r + 22) {
      this.au.win(); this.state = 'win'; this.winT = 0;
      this.burst(this.goal.x, this.goal.y, 80, '#ffe08a', 240);
      this.ring(this.goal.x, this.goal.y, '#ffe08a', 10, 300, 1.2);
    }
  }

  // -------------------------------------------------- sizing
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.floor(window.innerWidth * dpr);
    this.cv.height = Math.floor(window.innerHeight * dpr);
    this.cv.style.width = window.innerWidth + 'px';
    this.cv.style.height = window.innerHeight + 'px';
    this.light.width = this.cv.width; this.light.height = this.cv.height;
    this.bloom.width = Math.max(1, Math.floor(this.cv.width / 3));
    this.bloom.height = Math.max(1, Math.floor(this.cv.height / 3));
    this.dpr = dpr;
  }

  fit() {
    const ww = this.ww || 1344, wh = this.wh || 756;
    // Fixed, readable zoom (creatures stay legible) + a camera that follows the
    // player. When the world is larger than the screen the view scrolls; when it
    // fits, it centers. This is what lets acts be genuinely longer vertically AND
    // horizontally instead of just shrinking to fit one screen.
    let s = Math.min(this.cv.width / 1380, this.cv.height / 770);
    s = clamp(s, 0.6, 1.05);
    const vw = ww * s, vh = wh * s;
    let ox = this.cv.width / 2 - (this.px != null ? this.px : ww / 2) * s;
    let oy = this.cv.height / 2 - (this.py != null ? this.py : wh / 2) * s;
    if (vw <= this.cv.width) ox = (this.cv.width - vw) / 2; else ox = clamp(ox, this.cv.width - vw, 0);
    if (vh <= this.cv.height) oy = (this.cv.height - vh) / 2; else oy = clamp(oy, this.cv.height - vh, 0);
    return { s, ox, oy };
  }

  // -------------------------------------------------- draw
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);

    // page background (outside the level)
    const bg = ctx.createLinearGradient(0, 0, 0, this.cv.height);
    bg.addColorStop(0, (this.pal || PALETTES[0]).bot); bg.addColorStop(1, '#000106');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.cv.width, this.cv.height);

    if (this.state === 'title') { this.drawTitle(); return; }

    const { s, ox, oy } = this.fit();
    this._s = s; this._ox = ox; this._oy = oy;
    const sh = this.shake > 0 ? this.shake : 0;
    ctx.save();
    ctx.translate(ox + (sh ? rnd(-sh, sh) : 0), oy + (sh ? rnd(-sh, sh) : 0));
    ctx.scale(s, s);

    this.drawWater();
    this.drawBackground();
    this.drawGodRays();
    this.drawCurrents();
    this.drawRock();
    this.drawHidden();
    this.drawAnemones();
    this.drawGoal();
    this.drawCheckpoints();
    this.drawPlankton();
    this.drawPowerups();
    this.drawUrchins();
    this.drawStingers();
    this.drawLanterns();
    this.drawFish();
    this.drawVipers();
    this.drawBulbs();
    this.drawParticles();
    this.drawRings();
    this.drawMiniBosses();
    this.drawBoss();
    this.drawShots();
    this.drawPlayer();

    ctx.restore();

    this.drawLighting(s, ox, oy);
    this.drawLightTint(s, ox, oy);
    if (!this.externalFX) { this.drawBloom(); this.drawVignette(); }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHUD(s);
    if (this.flash > 0) { ctx.fillStyle = `rgba(190,230,255,${this.flash * 0.35})`; ctx.fillRect(0, 0, this.cv.width, this.cv.height); }
    if (this.fade > 0) { ctx.fillStyle = `rgba(0,2,8,${this.fade})`; ctx.fillRect(0, 0, this.cv.width, this.cv.height); }

    if (this.state === 'actcard') this.drawActCard(s);
    if (this.state === 'win') this.drawWin(s);
    if (this.state === 'ending') this.drawEnding(s);
    if (this.state === 'score') this.drawScore(s);
    if (this.state === 'leaderboard') this.drawLeaderboard(s);
  }

  drawWater() {
    const ctx = this.ctx;
    const p = this.pal || PALETTES[0];
    const g = ctx.createLinearGradient(0, 0, 0, this.wh);
    g.addColorStop(0, p.top); g.addColorStop(0.28, p.mid);
    g.addColorStop(0.65, p.deep); g.addColorStop(1, p.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.ww, this.wh);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // the surface itself: a rippling crest of light where the world ends
    const surf = TILE * 0.5;
    ctx.strokeStyle = rgba(p.surf, 0.4); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= this.ww; x += 8) {
      const y = surf + Math.sin(x * 0.03 + this.time * 1.3) * 3 + Math.sin(x * 0.011 - this.time * 0.8) * 4;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    const sg = ctx.createLinearGradient(0, 0, 0, TILE * 2.4);
    sg.addColorStop(0, rgba(p.surf, 0.24));
    sg.addColorStop(1, rgba(p.surf, 0));
    ctx.fillStyle = sg; ctx.fillRect(0, 0, this.ww, TILE * 2.4);
    // caustic ribbons drifting just beneath it
    for (let i = 0; i < 9; i++) {
      const y = TILE * 1.1 + i * 13 + Math.sin(this.time * 0.7 + i) * 5;
      const a = 0.06 - i * 0.0055;
      if (a <= 0) continue;
      ctx.fillStyle = rgba(p.ray, a);
      ctx.beginPath();
      for (let x = 0; x <= this.ww; x += 24) {
        const yy = y + Math.sin(x * 0.02 + this.time * 1.1 + i * 0.6) * 4;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.lineTo(this.ww, y + 7); ctx.lineTo(0, y + 7);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // motes
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const a = m.a * (0.5 + 0.5 * Math.sin(this.time * 1.4 + m.ph));
      ctx.fillStyle = `rgba(160,230,255,${a * 0.5})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  drawCurrents() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const c of this.currents) {
      const bx = c.x * TILE, by = c.y * TILE;
      const ph = (this.time * 1.6 + c.ph) % 1;
      for (let k = 0; k < 3; k++) {
        const t = (ph + k / 3) % 1;
        let x = bx + TILE / 2, y = by + TILE / 2;
        if (c.dx === '^') y = by + TILE * (1 - t);
        if (c.dx === 'v') y = by + TILE * t;
        if (c.dx === '<') x = bx + TILE * (1 - t);
        if (c.dx === '>') x = bx + TILE * t;
        ctx.fillStyle = `rgba(120,200,255,${0.28 * (1 - Math.abs(t - 0.5) * 2)})`;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---- rock is static: bake it once per level, blit it every frame ----
  bakeRock() {
    const RS = 2;
    this.rock.width = this.ww * RS;
    this.rock.height = this.wh * RS;
    const ctx = this.rctx;
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.clearRect(0, 0, this.ww, this.wh);
    const rockAt = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.map[y][x] === '#';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!rockAt(x, y)) continue;
      const bx = x * TILE, by = y * TILE;
      const d = clamp(by / this.wh, 0, 1);
      ctx.fillStyle = `rgb(${Math.round(9 - d * 6)},${Math.round(24 - d * 14)},${Math.round(41 - d * 24)})`;
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.fillStyle = 'rgba(2,8,16,0.5)';
      ctx.fillRect(bx, by + 6, TILE, TILE - 6);
      // rim light on every face that touches water
      const wUp = !rockAt(x, y - 1), wL = !rockAt(x - 1, y);
      const wR = !rockAt(x + 1, y), wD = !rockAt(x, y + 1);
      if (wUp) {
        const rg = ctx.createLinearGradient(0, by, 0, by + 12);
        rg.addColorStop(0, 'rgba(140,215,255,0.55)');
        rg.addColorStop(1, 'rgba(140,215,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(bx, by, TILE, 12);
        ctx.fillStyle = 'rgba(212,246,255,0.6)'; ctx.fillRect(bx, by, TILE, 1.5);
      }
      if (wL) { ctx.fillStyle = 'rgba(105,190,240,0.32)'; ctx.fillRect(bx, by, 1.5, TILE); }
      if (wR) { ctx.fillStyle = 'rgba(80,160,215,0.22)'; ctx.fillRect(bx + TILE - 1.5, by, 1.5, TILE); }
      if (wD) { ctx.fillStyle = 'rgba(3,10,20,0.85)'; ctx.fillRect(bx, by + TILE - 2, TILE, 2); }
      // mineral flecks that catch the light
      const hsh = (x * 73 + y * 151) % 11;
      if (hsh < 3) {
        ctx.fillStyle = hsh === 0 ? 'rgba(150,232,255,0.11)' : 'rgba(120,200,235,0.06)';
        ctx.fillRect(bx + 5 + hsh * 5, by + 8 + hsh * 3, 2.5, 2.5);
      }
      if (hsh === 7) {
        ctx.fillStyle = 'rgba(120,255,220,0.12)';
        ctx.beginPath(); ctx.arc(bx + 15, by + 17, 1.6, 0, 7); ctx.fill();
      }
    }
    // the water just above every rock face picks up a faint bounce light
    ctx.globalCompositeOperation = 'lighter';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!rockAt(x, y) || rockAt(x, y - 1)) continue;
      const g = ctx.createLinearGradient(0, y * TILE - 18, 0, y * TILE);
      g.addColorStop(0, 'rgba(70,150,200,0)');
      g.addColorStop(1, 'rgba(95,185,235,0.11)');
      ctx.fillStyle = g; ctx.fillRect(x * TILE, y * TILE - 18, TILE, 18);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRock() {
    this.ctx.drawImage(this.rock, 0, 0, this.ww, this.wh);
  }

  // hidden blocks live or fade with the light you carry, so they stay dynamic
  frameLights() {
    const f = this.form;
    const out = [];
    if (f) out.push({ x: this.px, y: this.py, r: f.key === 'angler' ? 178 : f.key === 'jelly' ? 120 : 134 });
    if (this.flare) out.push({ x: this.flare.x, y: this.flare.y, r: this.flare.r * 1.6 });
    for (const b of this.bulbs) out.push({ x: b.x, y: b.y, r: 55 });
    return out;
  }

  drawHidden() {
    const ctx = this.ctx;
    const lights = this.frameLights();
    const lit = (x, y) => {
      for (const l of lights) {
        const d = Math.hypot(x - l.x, y - l.y);
        if (d < l.r) return clamp(1 - d / l.r, 0, 1);
      }
      return 0;
    };
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.map[y][x] !== 'h') continue;
      const bx = x * TILE, by = y * TILE;
      const l = lit(bx + TILE / 2, by + TILE / 2);
      if (l <= 0.02) {
        // a barely-there shimmer: something is in the dark, shape unknown
        const tw = 0.05 + 0.05 * Math.sin(this.time * 2 + x * 0.7 + y);
        ctx.fillStyle = `rgba(140,190,255,${tw})`;
        ctx.fillRect(bx + 6, by + 6, TILE - 12, TILE - 12);
        continue;
      }
      ctx.fillStyle = `rgba(66,49,26,${0.55 + l * 0.45})`;
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.fillStyle = 'rgba(22,15,7,0.6)';
      ctx.fillRect(bx, by + 6, TILE, TILE - 6);
      ctx.fillStyle = `rgba(255,206,120,${0.14 + l * 0.3})`;
      ctx.fillRect(bx, by, TILE, 2.5);
      ctx.strokeStyle = `rgba(255,228,172,${l * 0.35})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, TILE - 1, TILE - 1);
    }
  }

  // ---- volumetric shafts falling from the surface ----
  drawGodRays() {
    const ctx = this.ctx;
    const reach = this.wh * 0.8;
    const p = this.pal || PALETTES[0];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const base = (i / 7) * this.ww + TILE * 2;
      const sway = Math.sin(this.time * 0.22 + i * 1.7) * 42;
      const wTop = 26 + (i % 3) * 15;
      const wBot = wTop * 3.4;
      const a = 0.05 + 0.018 * Math.sin(this.time * 0.5 + i);
      const g = ctx.createLinearGradient(0, 0, 0, reach);
      g.addColorStop(0, rgba(p.ray, a * 1.7));
      g.addColorStop(0.5, rgba(p.ray, a * 0.5));
      g.addColorStop(1, rgba(p.ray, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base - wTop / 2, 0);
      ctx.lineTo(base + wTop / 2, 0);
      ctx.lineTo(base + sway + wBot / 2, reach);
      ctx.lineTo(base + sway - wBot / 2, reach);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---- expanding shock rings: shift, dash, flare, checkpoint, death ----
  ring(x, y, c, r0, r1, life) { this.rings.push({ x, y, c, r0, r1, t: 0, life }); }

  drawRings() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const t = clamp(r.t / r.life, 0, 1);
      const rad = lerp(r.r0, r.r1, t * (2 - t));
      ctx.strokeStyle = rgba(r.c, (1 - t) * 0.55);
      ctx.lineWidth = 2.4 * (1 - t) + 0.4;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 7); ctx.stroke();
      ctx.strokeStyle = rgba(r.c, (1 - t) * 0.16);
      ctx.lineWidth = 8 * (1 - t);
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- two-tier bloom: downscale the frame, blur it, add it back ----
  drawBloom() {
    if (!this.canBlur || !this.bloomOn) return;
    if (this.cv.width > 3000) return; // keep low-end devices smooth
    const bc = this.blctx;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    bc.globalAlpha = 1;
    bc.clearRect(0, 0, this.bloom.width, this.bloom.height);
    bc.drawImage(this.cv, 0, 0, this.bloom.width, this.bloom.height);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34;
    ctx.filter = 'blur(9px)';
    ctx.drawImage(this.bloom, 0, 0, this.cv.width, this.cv.height);
    ctx.globalAlpha = 0.16;
    ctx.filter = 'blur(24px)';
    ctx.drawImage(this.bloom, 0, 0, this.cv.width, this.cv.height);
    ctx.filter = 'none';
    ctx.restore();
  }

  // ---- colored light bleeding into the water (not just a punched hole) ----
  drawLightTint(s, ox, oy) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.litSources) {
      if (!l.c) continue;
      const x = ox + l.x * s, y = oy + l.y * s, r = l.r * s * 1.15;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(l.c, 0.1));
      g.addColorStop(0.45, rgba(l.c, 0.03));
      g.addColorStop(1, rgba(l.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ---- lens vignette ----
  drawVignette() {
    const ctx = this.ctx;
    const W = this.cv.width, H = this.cv.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.33, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,2,10,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawAnemones() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const run of (this.anemoneRuns || [])) {
      const cx = run.x * TILE + TILE / 2;
      const top = run.y0 * TILE;
      const bot = (run.y1 + 1) * TILE;
      const len = bot - top;
      // one long tentacle per strand, spanning the whole run and swaying as a piece
      for (let i = 0; i < 6; i++) {
        const off = (i - 2.5) * 4.2;
        const seed = run.x * 1.7 + i * 0.9;
        const amp = 7 + (i % 3) * 3;
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, 'rgba(255,125,195,0.5)');
        g.addColorStop(0.55, 'rgba(210,80,255,0.3)');
        g.addColorStop(1, 'rgba(150,50,230,0.02)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.2 - (i % 2) * 0.5;
        ctx.beginPath();
        const steps = 14;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const y = top + len * t;
          // sway grows toward the free end so the strand whips, not zips
          const x = cx + off + Math.sin(this.time * 1.5 + seed + t * 3.2) * amp * t;
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        // glowing tip + a few bulbs along the strand
        const tx = cx + off + Math.sin(this.time * 1.5 + seed + 3.2) * amp;
        ctx.fillStyle = 'rgba(255,200,235,0.55)';
        ctx.beginPath(); ctx.arc(tx, bot, 1.8, 0, 7); ctx.fill();
        if (i % 2 === 0) {
          const bt = 0.4 + 0.2 * Math.sin(this.time + seed);
          ctx.fillStyle = 'rgba(255,170,225,0.35)';
          ctx.beginPath();
          ctx.arc(cx + off + Math.sin(this.time * 1.5 + seed + bt * 3.2) * amp * bt, top + len * bt, 1.4, 0, 7);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  drawPlankton() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of this.plankton) {
      if (p.got) continue;
      const pu = 0.6 + 0.4 * Math.sin(this.time * 2.2 + p.ph);
      const y = p.y + Math.sin(this.time * 1.1 + p.ph) * 3;
      const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 16 * pu);
      g.addColorStop(0, 'rgba(190,255,220,0.95)');
      g.addColorStop(0.35, 'rgba(90,240,180,0.35)');
      g.addColorStop(1, 'rgba(60,220,160,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, y, 16 * pu, 0, 7); ctx.fill();
      ctx.fillStyle = '#eafff5'; ctx.beginPath(); ctx.arc(p.x, y, 2.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  drawUrchins() {
    const ctx = this.ctx;
    for (const u of this.urchins) {
      const pu = 1 + 0.06 * Math.sin(this.time * 3 + u.ph);
      ctx.save(); ctx.translate(u.x, u.y); ctx.scale(pu, pu);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ug = ctx.createRadialGradient(0, 0, 0, 0, 0, 21);
      ug.addColorStop(0, 'rgba(255,95,125,0.4)');
      ug.addColorStop(1, 'rgba(255,60,100,0)');
      ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(0, 0, 21, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,105,132,0.95)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + Math.sin(this.time + u.ph) * 0.2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
        ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      g.addColorStop(0, '#5a0f1c'); g.addColorStop(1, '#2a040c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,140,160,0.9)'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  drawUrchinBody(ctx, ph, scale) {
    // shared urchin shell: test tube feet, primary + secondary spines, apex organ
    const t = this.time;
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(255,105,132,0.95)'; ctx.lineWidth = 2.1; ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.sin(t * 0.9 + ph) * 0.22;
      const sway = Math.sin(t * 2.2 + i * 0.7 + ph) * 0.1;
      const r0 = 4.5, r1 = 13.5 + (i % 3) * 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.quadraticCurveTo(Math.cos(a + sway) * (r0 + r1) * 0.55, Math.sin(a + sway) * (r0 + r1) * 0.55,
                           Math.cos(a + sway * 2) * r1, Math.sin(a + sway * 2) * r1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,190,205,0.95)';
      ctx.beginPath(); ctx.arc(Math.cos(a + sway * 2) * r1, Math.sin(a + sway * 2) * r1, 0.95, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,80,110,0.55)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * Math.PI * 2 + Math.sin(t * 0.9 + ph) * 0.22;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); ctx.stroke();
    }
    const g = ctx.createRadialGradient(-1.5, -1.5, 0, 0, 0, 11);
    g.addColorStop(0, '#6d1322'); g.addColorStop(0.7, '#3a0710'); g.addColorStop(1, '#22030a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, 7); ctx.fill();
    // tube feet
    ctx.strokeStyle = 'rgba(255,170,190,0.8)'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.4;
      const w = 1 + Math.sin(t * 4 + i) * 0.5;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
      ctx.lineTo(Math.cos(a) * (5 + w), Math.sin(a) * (5 + w)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,150,170,0.95)'; ctx.beginPath(); ctx.arc(0, 0, 2.1, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,240,0.9)'; ctx.beginPath(); ctx.arc(-0.7, -0.7, 0.8, 0, 7); ctx.fill();
  }

  drawUrchins() {
    const ctx = this.ctx;
    for (const u of this.urchins) {
      const pu = 1 + 0.07 * Math.sin(this.time * 3 + u.ph);
      ctx.save(); ctx.translate(u.x, u.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ug = ctx.createRadialGradient(0, 0, 0, 0, 0, 24);
      ug.addColorStop(0, 'rgba(255,95,125,0.38)');
      ug.addColorStop(1, 'rgba(255,60,100,0)');
      ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.scale(pu, pu);
      this.drawUrchinBody(ctx, u.ph, 1);
      ctx.restore();
      ctx.restore();
    }
  }

  // ------------------------------------------------- STINGER (T)
  drawStingers() {
    const ctx = this.ctx;
    for (const s of this.stingers) {
      const ext = s.reach / 40;
      const hot = ext > 0.3;
      const base = hot ? '#ff7ba8' : '#5d7f96';
      ctx.save(); ctx.translate(s.x, s.y);
      // bulb base anchored to the ceiling
      const bg = ctx.createRadialGradient(0, -3, 0, 0, 0, 13);
      bg.addColorStop(0, hot ? '#a02650' : '#2c4a5c');
      bg.addColorStop(1, hot ? '#3a0a1e' : '#12222c');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, -4, 11, 8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = hot ? 'rgba(255,140,180,1)' : 'rgba(155,205,230,0.9)';
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, -4, 11, 8, 0, 0, 7); ctx.stroke();
      // warts
      ctx.fillStyle = hot ? 'rgba(255,180,205,0.8)' : 'rgba(150,190,210,0.5)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.time * 0.3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 6, -4 + Math.sin(a) * 4, 1.1, 0, 7); ctx.fill();
      }
      // tentacle column
      ctx.lineCap = 'round';
      const n = 9;
      for (let i = 0; i < n; i++) {
        const ox = -10 + i * (20 / (n - 1));
        const len = 6 + ext * (30 + (i % 3) * 7);
        const sw = Math.sin(this.time * 2.4 + i * 0.9 + s.ph) * (2 + ext * 6);
        ctx.strokeStyle = hot ? `rgba(255,120,168,${0.5 + ext * 0.5})` : 'rgba(155,205,230,0.6)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(ox, 2);
        ctx.bezierCurveTo(ox + sw * 0.3, 2 + len * 0.4, ox + sw, 2 + len * 0.7, ox + sw * 0.7, 2 + len);
        ctx.stroke();
        // cnidocyte knobs at the tip
        ctx.fillStyle = hot ? 'rgba(255,200,222,0.95)' : 'rgba(150,190,210,0.5)';
        for (let k = 1; k <= 3; k++) {
          const t = k / 3.4;
          ctx.beginPath(); ctx.arc(ox + sw * t * 0.8, 2 + len * t, 0.95, 0, 7); ctx.fill();
        }
      }
      // warning ring as it arms
      if (ext > 0.02 && ext < 0.34) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,150,190,${0.5 - ext * 1.2})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 6, 20 + ext * 40, 0, 7); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------- LANTERNFISH (L)
  drawLanterns() {
    const ctx = this.ctx;
    for (const l of this.lanterns) {
      const stunned = l.stun > 0;
      const pu = l.pulse || 0.7;
      const bob = Math.sin(this.time * 1.8 + l.ph) * 3;
      ctx.save(); ctx.translate(l.x, l.y + bob);
      ctx.rotate(Math.sin(this.time * 1.1 + l.ph) * 0.12 + (stunned ? this.time * 3 : 0));
      ctx.scale(l.dir, 1);
      // body: elongated, dark, with a ventral lantern row
      ctx.fillStyle = '#4a3710';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,130,0.95)'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.4, 0, 0, 7); ctx.stroke();
      // tail (flicks with a beat)
      const lwag = Math.sin(this.time * 8 + l.ph) * 3.2;
      ctx.fillStyle = 'rgba(255,200,110,0.3)';
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-19, -5.5 + lwag); ctx.lineTo(-16, lwag * 0.4); ctx.lineTo(-19, 5.5 + lwag);
      ctx.closePath(); ctx.fill();
      // dorsal fin
      ctx.beginPath(); ctx.moveTo(-4, -6); ctx.quadraticCurveTo(1, -12, 6, -6);
      ctx.closePath(); ctx.fill();
      // photophore ladder along the belly
      for (let i = 0; i < 7; i++) {
        const x = -9 + i * 3;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 3 + i * 0.8 + l.ph));
        ctx.fillStyle = `rgba(255,226,150,${a * (stunned ? 0.3 : 1)})`;
        ctx.beginPath(); ctx.arc(x, 5.2, 1.35, 0, 7); ctx.fill();
      }
      // the big sub-ocular lantern it hunts with
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(8, 3.5, 0, 8, 3.5, 20 * pu);
      lg.addColorStop(0, `rgba(255,240,190,${0.85 * (stunned ? 0.25 : 1)})`);
      lg.addColorStop(0.3, `rgba(255,205,110,${0.3 * (stunned ? 0.25 : 1)})`);
      lg.addColorStop(1, 'rgba(255,190,80,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(8, 3.5, 20 * pu, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff3d2'; ctx.beginPath(); ctx.arc(8, 3.5, 2.3, 0, 7); ctx.fill();
      // eye + snout teeth
      ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(8, -2.6, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#171002'; ctx.beginPath(); ctx.arc(8.8, -2.6, 1.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff6e2';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(11 + i * 1.7, -1); ctx.lineTo(11.6 + i * 1.7, 1.4); ctx.lineTo(12.5 + i * 1.7, -1);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const a = this.time * 5 + i * 1.6;
          ctx.fillStyle = 'rgba(255,225,160,0.75)';
          ctx.beginPath(); ctx.arc(l.x + Math.cos(a) * 17, l.y - 18 + Math.sin(a) * 5, 2, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------- DRAGONFISH (F)
  drawFish() {
    const ctx = this.ctx;
    for (const f of this.fish) {
      const stunned = f.stun > 0;
      const fspd = stunned ? 0 : 1;
      const bob = Math.sin(this.time * 3 + f.ph) * (1.1 + 1.5 * fspd);
      const wag = Math.sin(this.time * (7 + 5 * fspd) + f.ph) * (1.4 + 2.6 * fspd);
      const fwave = Math.sin(this.time * 8 + f.ph) * 0.05 * fspd;
      ctx.save(); ctx.translate(f.x, f.y + bob); ctx.scale(f.dir, 1); ctx.rotate(fwave);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 28);
      fg.addColorStop(0, stunned ? 'rgba(140,200,255,0.28)' : 'rgba(255,110,130,0.24)');
      fg.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, 28, 0, 7); ctx.fill();
      ctx.restore();
      // caudal fin with rays
      ctx.save(); ctx.rotate(wag * 0.05);
      ctx.fillStyle = stunned ? 'rgba(150,200,240,0.35)' : 'rgba(255,120,140,0.35)';
      ctx.beginPath(); ctx.moveTo(-16, 0);
      ctx.lineTo(-26, -7 + wag); ctx.lineTo(-22, wag * 0.4); ctx.lineTo(-26, 7 + wag);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = stunned ? 'rgba(180,220,250,0.5)' : 'rgba(255,170,185,0.5)'; ctx.lineWidth = 0.8;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-25, i * 4.5 + wag); ctx.stroke();
      }
      ctx.restore();
      // dorsal + anal fins
      const fc = stunned ? 'rgba(150,200,240,0.3)' : 'rgba(255,120,140,0.3)';
      ctx.fillStyle = fc;
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.quadraticCurveTo(-2, -13, 5, -6.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9, 6); ctx.quadraticCurveTo(-3, 12, 3, 6.5); ctx.closePath(); ctx.fill();
      // body
      const body = stunned ? 'rgba(140,185,225,0.9)' : 'rgba(176,40,64,0.95)';
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.quadraticCurveTo(4, -8.5, -8, -5.5);
      ctx.quadraticCurveTo(-14, -3.2, -18, 0);
      ctx.quadraticCurveTo(-14, 3.2, -8, 5.5);
      ctx.quadraticCurveTo(4, 8.5, 15, 0);
      ctx.fill();
      ctx.strokeStyle = stunned ? 'rgba(180,225,255,0.85)' : 'rgba(255,145,165,0.95)';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.quadraticCurveTo(4, -8.5, -8, -5.5);
      ctx.quadraticCurveTo(-14, -3.2, -18, 0);
      ctx.quadraticCurveTo(-14, 3.2, -8, 5.5);
      ctx.quadraticCurveTo(4, 8.5, 15, 0);
      ctx.stroke();
      // lateral line + myomere chevrons
      ctx.strokeStyle = stunned ? 'rgba(210,240,255,0.4)' : 'rgba(255,150,170,0.4)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -1.5, 14, 0); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const x = -9 + i * 5;
        ctx.beginPath(); ctx.moveTo(x + 2, -4.5); ctx.lineTo(x - 2, 0); ctx.lineTo(x + 2, 4.5); ctx.stroke();
      }
      // photophore row
      ctx.fillStyle = stunned ? 'rgba(200,235,255,0.6)' : 'rgba(255,200,150,0.85)';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-11 + i * 4.6, 4.6, 1, 0, 7); ctx.fill(); }
      // gape with fangs
      ctx.fillStyle = '#1a0308';
      ctx.beginPath(); ctx.moveTo(6, -4.5); ctx.quadraticCurveTo(17, -3, 15, 1.5); ctx.quadraticCurveTo(11, 6, 5.5, 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff2f4';
      ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(9.2, 0.6); ctx.lineTo(10.6, -3.8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(12, -3); ctx.lineTo(13, 0.2); ctx.lineTo(14.2, -2.8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8.5, 5); ctx.lineTo(9.6, 1.6); ctx.lineTo(10.8, 4.8); ctx.closePath(); ctx.fill();
      // eye
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8.5, -3.4, 2.4, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(9.2, -3.4, 1.15, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(7.7, -4.2, 0.6, 0, 7); ctx.fill();
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const a = this.time * 4 + i * 2.1;
          ctx.fillStyle = 'rgba(150,220,255,0.7)';
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 16, f.y - 16 + Math.sin(a) * 5, 2, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------- VIPERFISH (V)
  drawVipers() {
    const ctx = this.ctx;
    for (const v of this.vipers) {
      const stunned = v.stun > 0;
      const lunging = v.charge > 0;
      const glow = v.glow || 0.6;
      ctx.save(); ctx.translate(v.x, v.y);
      ctx.rotate(Math.atan2(v.vy, v.vx) * (Math.abs(v.vx) + Math.abs(v.vy) > 6 ? 0.9 : 0.15) + Math.sin(this.time * 10 + v.ph) * 0.045);
      ctx.scale(v.dir, 1);
      if (lunging) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
        hg.addColorStop(0, 'rgba(150,130,255,0.4)'); hg.addColorStop(1, 'rgba(120,100,255,0)');
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
        ctx.restore();
      }
      // spine-backed dorsal fin
      ctx.strokeStyle = `rgba(160,140,255,${0.5 * glow + 0.2})`; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -12 + i * 3.6;
        ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x - 1.4, -11 - (i % 2) * 2); ctx.stroke();
      }
      // tail
      const wag = Math.sin(this.time * 11 + v.ph) * (lunging ? 4.5 : 2.5);
      ctx.fillStyle = `rgba(150,130,255,${0.3 + glow * 0.2})`;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-27, -8 + wag); ctx.lineTo(-22, wag * 0.4); ctx.lineTo(-27, 8 + wag);
      ctx.closePath(); ctx.fill();
      // long slim body
      ctx.fillStyle = stunned ? '#3a3458' : '#241a44';
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.quadraticCurveTo(6, -6.5, -8, -4.6);
      ctx.quadraticCurveTo(-14, -2.6, -18, 0);
      ctx.quadraticCurveTo(-14, 2.6, -8, 4.6);
      ctx.quadraticCurveTo(6, 6.5, 18, 0);
      ctx.fill();
      ctx.strokeStyle = lunging ? `rgba(255,110,130,${0.75 + glow * 0.25})` : `rgba(175,155,255,${0.7 + glow * 0.3})`;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.quadraticCurveTo(6, -6.5, -8, -4.6);
      ctx.quadraticCurveTo(-14, -2.6, -18, 0);
      ctx.quadraticCurveTo(-14, 2.6, -8, 4.6);
      ctx.quadraticCurveTo(6, 6.5, 18, 0);
      ctx.stroke();
      // photophore ladder
      ctx.fillStyle = `rgba(190,175,255,${0.5 + glow * 0.5})`;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-13 + i * 4.4, 3.9, 1.05, 0, 7); ctx.fill(); }
      // the huge eye that gave it away
      ctx.fillStyle = stunned ? '#8f9bc0' : '#e8e2ff'; ctx.beginPath(); ctx.arc(11, -2.2, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0618'; ctx.beginPath(); ctx.arc(12, -2.2, 1.9, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(9.8, -3.3, 0.95, 0, 7); ctx.fill();
      // needle jaw — the whole reason to keep your distance
      ctx.fillStyle = '#f2eeff';
      const fangs = [[8, -2.6, 5.5], [11, -1.8, 6.5], [14, -0.8, 5], [9, 3.6, -5], [12.5, 2.8, -6]];
      for (const [fx, fy, fl] of fangs) {
        ctx.beginPath(); ctx.moveTo(fx - 1.1, fy); ctx.lineTo(fx, fy + fl); ctx.lineTo(fx + 1.1, fy);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (stunned) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const a = this.time * 5 + i * 1.6;
          ctx.fillStyle = 'rgba(180,165,255,0.8)';
          ctx.beginPath(); ctx.arc(v.x + Math.cos(a) * 18, v.y - 19 + Math.sin(a) * 5, 2.1, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
    }
  }


  drawBulbs() {
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bulbs) {
      const pu = 0.7 + 0.3 * Math.sin(this.time * 0.9 + b.ph);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 46 * pu);
      g.addColorStop(0, 'rgba(120,220,255,0.5)');
      g.addColorStop(0.4, 'rgba(60,150,220,0.16)');
      g.addColorStop(1, 'rgba(40,120,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, 46 * pu, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(210,245,255,0.9)'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.4, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  drawCheckpoints() {
    const ctx = this.ctx;
    for (const c of this.checkpoints) {
      const pu = c.on ? 1 : 0.5 + 0.5 * Math.sin(this.time * 2 + c.ph);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const col = c.on ? '120,255,220' : '120,200,255';
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 26 * pu);
      g.addColorStop(0, `rgba(${col},${0.5 * pu})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 26 * pu, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(${col},${0.6 * pu})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(c.x, c.y, 9 + pu * 2, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  drawGoal() {
    if (!this.goal) return;
    const ctx = this.ctx;
    const g0 = this.goal;
    const pu = 0.8 + 0.2 * Math.sin(this.time * 1.6);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(g0.x, g0.y, 0, g0.x, g0.y, 90 * pu);
    g.addColorStop(0, 'rgba(255,235,170,0.75)');
    g.addColorStop(0.3, 'rgba(255,190,90,0.28)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(g0.x, g0.y, 90 * pu, 0, 7); ctx.fill();
    // rising spire of light
    for (let i = 0; i < 14; i++) {
      const t = (this.time * 0.5 + i / 14) % 1;
      ctx.fillStyle = `rgba(255,225,160,${0.5 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(g0.x + Math.sin(t * 6 + i) * 8, g0.y + 24 - t * 70, 2.4 * (1 - t) + 0.6, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,240,200,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g0.x, g0.y, 15 + pu * 3, 0, 7); ctx.stroke();
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    if (this.gpuParticles) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const rad = p.s * (0.5 + a * 0.7);
      ctx.fillStyle = rgba(p.c, a * 0.16);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad * 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(p.c, a * 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  setMouse(e) {
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
    if (e.hp <= 0) { e.dead = true; this.kills++; this.au.enemyDie(); this.burst(e.x, e.y, 22, '#ff9db0', 150); this.ring(e.x, e.y, '#ff9db0', 6, 70, 0.5); }
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
        if (b.hp <= 0) { b.dead = true; b.dieT = 0; this.kills++; this.au.bossRoar(); this.shake = 20; this.flash = 0.8; this.burst(b.x, b.y, 120, '#ffe08a', 320); this.ring(b.x, b.y, '#ffe08a', 12, 400, 1.4); }
        if (sh.boom) { this._boom(sh); sh.life = 0; break; }
        sh.pierce -= 1; if (sh.pierce < 0) { sh.life = 0; break; }
      }
      // mini-bosses (item 4): shootable, same rules as the final boss
      for (const mb of this.minibosses) {
        if (mb.dead || sh.hit.includes(mb)) continue;
        if (Math.hypot(mb.x - sh.x, mb.y - sh.y) < sh.r + mb.r) {
          sh.hit.push(mb); mb.hp -= sh.dmg; this.au.bossHit(); this.burst(sh.x, sh.y, 8, mb.glowC, 90);
          if (mb.hp <= 0) { mb.dead = true; mb.dieT = 0; this.kills++; this.au.bossRoar(); this.shake = 16; this.flash = 0.6; this.burst(mb.x, mb.y, 90, mb.glowC, 300); this.ring(mb.x, mb.y, mb.glowC, 10, 340, 1.2); }
          if (sh.boom) { this._boom(sh); sh.life = 0; break; }
          sh.pierce -= 1; if (sh.pierce < 0) { sh.life = 0; break; }
        }
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
    for (const mb of this.minibosses) if (!mb.dead && Math.hypot(mb.x - sh.x, mb.y - sh.y) < 116) { mb.hp -= 1; if (mb.hp <= 0) { mb.dead = true; mb.dieT = 0; this.kills++; this.au.bossRoar(); this.burst(mb.x, mb.y, 90, mb.glowC, 300); } this.au.bossHit(); }
  }

  _nearestEnemy(x, y) {
    let best = null, bd = 260;
    for (const e of [...this.fish, ...this.vipers, ...this.lanterns, ...this.urchins]) {
      if (e.dead) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; }
    }
    if (this.boss && !this.boss.dead) { const d = Math.hypot(this.boss.x - x, this.boss.y - y); if (d < bd) { bd = d; best = this.boss; } }
    for (const mb of this.minibosses) if (!mb.dead) { const d = Math.hypot(mb.x - x, mb.y - y); if (d < bd) { bd = d; best = mb; } }
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
    // enemy bolts (viperfish spit)
    for (const es of this.eshots) {
      const a = clamp(es.life / 2.2, 0, 1);
      const g = ctx.createRadialGradient(es.x, es.y, 0, es.x, es.y, es.r * 2.4);
      g.addColorStop(0, rgba(es.c, 0.9 * a)); g.addColorStop(1, rgba(es.c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(es.x, es.y, es.r * 2.4, 0, 7); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.7 * a); ctx.beginPath(); ctx.arc(es.x, es.y, es.r * 0.5, 0, 7); ctx.fill();
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

  // ---- beacon gate: the final Matriarch OR any live mini-boss holds the beacon
  bossAlive() {
    if (this.boss && !this.boss.dead) return true;
    for (const mb of this.minibosses) if (!mb.dead) return true;
    return false;
  }

  // -------------------------------------------------- mini-boss AI (item 4)
  // Each kind owns a distinct lethal attack delivered through this.eshots (or
  // direct contact). Returns true ONLY immediately after this.die() so the
  // caller skips the rest of update(); otherwise false.
  updateMiniBosses(dt, r) {
    if (!this.minibosses.length) return false;
    const shoot = (mb, vx, vy, msg, life, rr, g, home, c) => {
      this.eshots.push({ x: mb.x, y: mb.y, vx, vy, life: life || 3.4, r: rr || 5, msg, g: g || 0, home: !!home, maxs: home ? (rr || 5) * 42 : 0, c: c || mb.glow });
    };
    for (const mb of this.minibosses) {
      if (mb.dead) { mb.dieT += dt; continue; }
      mb.t += dt; mb.fireT -= dt; mb.spin += dt;
      const dx = this.px - mb.x, dy = this.py - mb.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      mb.ph = Math.atan2(dy, dx);
      mb.enraged = mb.hp <= mb.maxhp * 0.5;
      // contact kills
      if (d < mb.r + r) { this.say(mb.name + ' — do not touch it'); this.die(); return true; }
      const fast = mb.enraged ? 1.55 : 1;

      if (mb.kind === 'crab') {
        // hugs the floor, lobs arcing rock shards (g:true) that fall on you
        const floorY = this.wh - TILE * 2;
        mb.y = lerp(mb.y, floorY, Math.min(1, dt * 1.4));
        mb.x += Math.cos(mb.t * 0.5 + mb.seed) * 26 * dt;
        mb.x = clamp(mb.x, TILE * 2, this.ww - TILE * 2);
        if (mb.fireT <= 0) {
          mb.fireT = (mb.enraged ? 0.85 : 1.5);
          const n = mb.enraged ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const spread = (i - (n - 1) / 2) * 0.42;
            const ang = Math.atan2(dy - 130, dx) + spread;
            const sp = 250 + Math.abs(dx) * 0.32;
            shoot(mb, Math.cos(ang) * sp, Math.sin(ang) * sp - 175, 'stone-crab shard — mind the arc', 4, 6, 300, false, '#e0b070');
          }
          this.au.blip(180, 0.08, 'square', 0.12);
        }
      } else if (mb.kind === 'manta') {
        // glides in a swoop toward the player, then bursts a radial fan of orbs
        mb.swoop = mb.swoop || 0;
        const want = d > 150 ? 1 : (mb.swoop > 0 ? 1 : -0.4);
        mb.x += ux * 70 * want * dt + Math.cos(mb.t * 0.7) * 20 * dt;
        mb.y += uy * 70 * want * dt + Math.sin(mb.t * 0.9) * 26 * dt;
        mb.x = clamp(mb.x, TILE * 2, this.ww - TILE * 2);
        mb.y = clamp(mb.y, TILE * 2, this.wh - TILE * 2);
        if (d < 200) mb.swoop = Math.min(1, mb.swoop + dt * 2);
        if (mb.fireT <= 0 && d < 240) {
          mb.fireT = (mb.enraged ? 1.1 : 1.7); mb.swoop = 0;
          const n = mb.enraged ? 10 : 7;
          for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + mb.t; shoot(mb, Math.cos(a) * 165, Math.sin(a) * 165, 'drowned manta burst', 3.2, 5, 0, false, '#bcd4ff'); }
          this.au.blip(360, 0.1, 'sine', 0.12);
        }
      } else if (mb.kind === 'urchin') {
        // slow drift, periodic slow radial spine ring you must weave through
        mb.x += (mb.x0 - mb.x) * 0.2 * dt + Math.sin(mb.t * 0.4 + mb.seed) * 14 * dt;
        mb.y += (mb.y0 - mb.y) * 0.2 * dt + Math.cos(mb.t * 0.33) * 14 * dt;
        if (mb.fireT <= 0) {
          mb.fireT = (mb.enraged ? 1.5 : 2.2);
          const n = mb.enraged ? 16 : 12;
          for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + mb.spin; shoot(mb, Math.cos(a) * 92, Math.sin(a) * 92, 'urchin spine ring', 5, 5, 0, false, '#ff9db0'); }
          this.au.blip(140, 0.14, 'sawtooth', 0.1);
        }
      } else if (mb.kind === 'moray') {
        // locks its row and charges toward the player along it, spitting as it goes
        mb.charge = mb.charge || 0;
        if (mb.charge > 0) {
          mb.charge -= dt;
          mb.x += mb.vx * dt; mb.y += mb.vy * dt;
        } else {
          mb.y = lerp(mb.y, this.py, Math.min(1, dt * 0.8));
          mb.x += Math.cos(mb.t * 0.6 + mb.seed) * 30 * dt;
          if (mb.fireT <= 0) {
            mb.fireT = (mb.enraged ? 1.4 : 2.1);
            const sp = 360 * fast;
            mb.vx = ux * sp; mb.vy = uy * sp * 0.4; mb.charge = 0.7;
            this.au.blip(220, 0.1, 'sawtooth', 0.12);
            shoot(mb, ux * 200, uy * 200, 'moray spit', 2.4, 5, 0, false, '#d4ff9a');
          }
        }
        mb.x = clamp(mb.x, TILE * 2, this.ww - TILE * 2);
        mb.y = clamp(mb.y, TILE * 2, this.wh - TILE * 2);
      } else if (mb.kind === 'king') {
        // prowls, then fires a fast homing pulse that tracks you
        mb.x += (mb.x0 - mb.x) * 0.15 * dt + Math.cos(mb.t * 0.5) * 30 * dt;
        mb.y += Math.sin(mb.t * 0.6 + mb.seed) * 24 * dt;
        mb.y = clamp(mb.y, TILE * 3, this.wh - TILE * 3);
        if (mb.fireT <= 0) {
          mb.fireT = (mb.enraged ? 1.2 : 1.9);
          shoot(mb, ux * 150, uy * 150, 'lanternfish king pulse — keep moving', 4.5, 7, 0, true, '#fff0c0');
          this.au.blip(520, 0.1, 'triangle', 0.12);
        }
      } else if (mb.kind === 'kraken') {
        // sprays a spread of ink orbs and drops lingering tentacle-hit zones
        mb.x += (mb.x0 - mb.x) * 0.12 * dt + Math.cos(mb.t * 0.4 + mb.seed) * 26 * dt;
        mb.y += (mb.y0 - mb.y) * 0.12 * dt + Math.sin(mb.t * 0.5) * 20 * dt;
        mb.x = clamp(mb.x, TILE * 3, this.ww - TILE * 3);
        mb.y = clamp(mb.y, TILE * 3, this.wh - TILE * 3);
        if (mb.fireT <= 0) {
          mb.fireT = (mb.enraged ? 1.5 : 2.3);
          const n = mb.enraged ? 7 : 5;
          for (let i = 0; i < n; i++) { const a = mb.ph + (i - (n - 1) / 2) * 0.3; shoot(mb, Math.cos(a) * 150, Math.sin(a) * 150, 'ink spray', 3, 8, 0, false, '#c78aff'); }
          // two lingering tentacle-hit zones near the player's path
          for (let k = 0; k < 2; k++) {
            const zx = clamp(this.px + rnd(-90, 90), TILE * 2, this.ww - TILE * 2);
            const zy = clamp(this.py + rnd(-90, 90), TILE * 2, this.wh - TILE * 2);
            this.eshots.push({ x: zx, y: zy, vx: 0, vy: 0, life: 2.6, r: 20, msg: 'kraken tentacle', c: '#b06ae0' });
          }
          this.au.blip(90, 0.18, 'sawtooth', 0.14);
        }
      } else if (mb.kind === 'serpent') {
        // weaves along, spitting 3 homing orbs that curve after you
        mb.x += Math.cos(mb.t * 0.5 + mb.seed) * 40 * dt;
        mb.y += (mb.y0 - mb.y) * 0.15 * dt + Math.sin(mb.t * 0.7) * 30 * dt;
        mb.x = clamp(mb.x, TILE * 2, this.ww - TILE * 2);
        mb.y = clamp(mb.y, TILE * 3, this.wh - TILE * 3);
        if (mb.fireT <= 0) {
          mb.fireT = (mb.enraged ? 1.6 : 2.4);
          for (let i = 0; i < 3; i++) { const a = mb.ph + (i - 1) * 0.5; shoot(mb, Math.cos(a) * 120, Math.sin(a) * 120, 'reef serpent orb', 4, 6, 0, true, '#a8ffe8'); }
          this.au.blip(440, 0.1, 'sine', 0.12);
        }
      }
    }
    return false;
  }

  // -------------------------------------------------- mini-boss art (item 4)
  drawMiniBosses() {
    if (!this.minibosses.length) return;
    const ctx = this.ctx;
    for (const mb of this.minibosses) {
      if (mb.dead && mb.dieT > 1.6) continue;
      this.litSources.push({ x: mb.x, y: mb.y, r: mb.r * 4, c: mb.glow });
      const alpha = mb.dead ? clamp(1 - mb.dieT / 1.6, 0, 1) : 1;
      const scl = mb.dead ? 1 + mb.dieT * 0.4 : 1;
      ctx.save();
      ctx.translate(mb.x, mb.y);
      ctx.scale(scl, scl);
      ctx.globalAlpha = alpha;
      // additive glow halo
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, mb.r * 2.2);
      g.addColorStop(0, rgba(mb.glow, 0.4 * alpha)); g.addColorStop(1, rgba(mb.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, mb.r * 2.2, 0, 7); ctx.fill();
      ctx.restore();

      if (mb.kind === 'crab') {
        // legs
        ctx.strokeStyle = rgba(mb.color, 0.8 * alpha); ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 3; i++) {
          const base = (i - 1) * 9; const sw = Math.sin(this.time * 6 + i + (s > 0 ? 0 : 1.5)) * 6;
          ctx.beginPath(); ctx.moveTo(s * 12, base); ctx.lineTo(s * (22 + sw), base + 12 + sw * 0.4); ctx.stroke();
        }
        // claws
        for (let s = -1; s <= 1; s += 2) {
          const open = 0.3 + 0.3 * Math.sin(this.time * 4 + (s > 0 ? 1 : 0));
          ctx.save(); ctx.translate(s * 24, -6); ctx.rotate(s * (0.4 + open));
          ctx.fillStyle = rgba(mb.color, 0.9 * alpha); ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = rgba(mb.glow, 0.7 * alpha); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(14, -6); ctx.moveTo(6, 4); ctx.lineTo(14, 6); ctx.stroke();
          ctx.restore();
        }
        // armored shell
        const sg = ctx.createLinearGradient(0, -18, 0, 14);
        sg.addColorStop(0, rgba(mb.color, 0.95 * alpha)); sg.addColorStop(1, rgba('#5a3a1a', 0.95 * alpha));
        ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(0, 0, 22, 16, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = rgba(mb.glow, 0.6 * alpha); ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = rgba('#3a2410', 0.6 * alpha); ctx.lineWidth = 1;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 8, -14); ctx.lineTo(i * 8, 12); ctx.stroke(); }
        // eyes
        for (let s = -1; s <= 1; s += 2) { ctx.fillStyle = rgba('#0a0602', alpha); ctx.beginPath(); ctx.arc(s * 6, -8, 3, 0, 7); ctx.fill(); }
      } else if (mb.kind === 'manta') {
        const flap = Math.sin(this.time * 2.4) * 0.5;
        ctx.save(); ctx.rotate(mb.ph + Math.PI / 2);
        for (let s = -1; s <= 1; s += 2) {
          ctx.fillStyle = rgba(mb.color, 0.85 * alpha);
          ctx.beginPath(); ctx.moveTo(0, -6);
          ctx.quadraticCurveTo(s * 30, -14 - flap * 22, s * 40, 6 + flap * 10);
          ctx.quadraticCurveTo(s * 20, 10, 0, 12); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = rgba(mb.glow, 0.5 * alpha); ctx.lineWidth = 1.5; ctx.stroke();
        }
        // body + tail
        const bg = ctx.createLinearGradient(0, -18, 0, 20);
        bg.addColorStop(0, rgba(mb.glow, 0.7 * alpha)); bg.addColorStop(1, rgba(mb.color, 0.9 * alpha));
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 0, 9, 20, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = rgba(mb.color, 0.8 * alpha); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 18); ctx.quadraticCurveTo(Math.sin(this.time * 3) * 8, 34, 0, 48); ctx.stroke();
        for (let s = -1; s <= 1; s += 2) { ctx.fillStyle = rgba('#0a1226', alpha); ctx.beginPath(); ctx.arc(s * 4, -12, 2.4, 0, 7); ctx.fill(); }
        ctx.restore();
      } else if (mb.kind === 'urchin') {
        const rot = mb.spin * 0.8;
        ctx.save(); ctx.rotate(rot);
        ctx.strokeStyle = rgba(mb.color, 0.9 * alpha); ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const len = mb.r + 8 + Math.sin(this.time * 3 + i) * 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * mb.r * 0.6, Math.sin(a) * mb.r * 0.6); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke(); }
        ctx.restore();
        const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, mb.r);
        cg.addColorStop(0, rgba(mb.glow, 0.9 * alpha)); cg.addColorStop(1, rgba(mb.color, 0.9 * alpha));
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, mb.r * 0.7, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#3a0812', alpha); ctx.beginPath(); ctx.arc(0, 0, mb.r * 0.28, 0, 7); ctx.fill();
      } else if (mb.kind === 'moray') {
        ctx.save(); ctx.rotate(mb.ph);
        // undulating eel body
        const seg = 10; const spine = [];
        for (let i = 0; i <= seg; i++) { const t = i / seg; const bx = -t * 60; const by = Math.sin(this.time * 4 - t * 4) * 10 * (1 - t * 0.3); spine.push([bx, by]); }
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? rgba(mb.glow, 0.5 * alpha) : rgba(mb.color, 0.9 * alpha);
          ctx.lineWidth = pass ? 3 : 14;
          ctx.beginPath(); ctx.moveTo(spine[0][0], spine[0][1]);
          for (const p of spine) ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
        // gaping jaw
        const jaw = 0.4 + 0.4 * Math.sin(this.time * 5);
        ctx.fillStyle = rgba('#0a1408', 0.95 * alpha);
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(22, -6 - jaw * 6); ctx.lineTo(22, 6 + jaw * 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba('#eaffd0', 0.9 * alpha);
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(8, i * 3); ctx.lineTo(14, i * 4); ctx.lineTo(8, i * 3 + 2); ctx.fill(); }
        ctx.fillStyle = rgba('#fff', alpha); ctx.beginPath(); ctx.arc(2, -5, 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#0a1408', alpha); ctx.beginPath(); ctx.arc(2.6, -5, 1.2, 0, 7); ctx.fill();
        ctx.restore();
      } else if (mb.kind === 'king') {
        ctx.save(); ctx.rotate(mb.ph);
        // tail (beats with a swim stroke)
        const kwag = Math.sin(this.time * 6 + mb.seed) * 7;
        ctx.fillStyle = rgba(mb.color, 0.8 * alpha);
        ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-44, -14 + kwag); ctx.lineTo(-40, kwag * 0.4); ctx.lineTo(-44, 14 + kwag); ctx.closePath(); ctx.fill();
        // body
        const bg = ctx.createLinearGradient(-26, 0, 30, 0);
        bg.addColorStop(0, rgba('#7a5010', 0.95 * alpha)); bg.addColorStop(1, rgba(mb.color, 0.95 * alpha));
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 0, 30, 17, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = rgba(mb.glow, 0.6 * alpha); ctx.lineWidth = 2; ctx.stroke();
        // crown of glowing lures
        for (let i = -2; i <= 2; i++) {
          const lx = i * 9, ly = -16 - Math.abs(i) * -2;
          ctx.strokeStyle = rgba(mb.glow, 0.5 * alpha); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, -12); ctx.lineTo(lx, ly - 6); ctx.stroke();
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const lg = ctx.createRadialGradient(lx, ly - 8, 0, lx, ly - 8, 7);
          lg.addColorStop(0, rgba('#fff6d0', (0.7 + 0.3 * Math.sin(this.time * 5 + i)) * alpha)); lg.addColorStop(1, rgba(mb.glow, 0));
          ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly - 8, 7, 0, 7); ctx.fill(); ctx.restore();
        }
        // eye + jaw
        ctx.fillStyle = rgba('#fff', alpha); ctx.beginPath(); ctx.arc(18, -4, 4, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#0a0602', alpha); ctx.beginPath(); ctx.arc(19.5, -4, 2, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#0a0602', 0.9 * alpha); ctx.beginPath(); ctx.moveTo(24, 4); ctx.quadraticCurveTo(34, 8, 24, 12); ctx.fill();
        ctx.restore();
      } else if (mb.kind === 'kraken') {
        // swaying tentacles
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
          const a = (i / 7 - 0.5) * 2.2; const bx = Math.sin(a) * 16;
          const ph = this.time * 2 + i * 0.8; const len = 34 + (i % 2) * 12;
          ctx.strokeStyle = rgba(mb.color, (0.7 - Math.abs(a) * 0.1) * alpha); ctx.lineWidth = 6 - Math.abs(a);
          ctx.beginPath(); ctx.moveTo(bx, 10);
          ctx.quadraticCurveTo(bx + Math.sin(ph) * 12, 10 + len * 0.6, bx + Math.sin(ph + 1) * 18, 10 + len);
          ctx.stroke();
        }
        // bulbous head
        const hg = ctx.createRadialGradient(0, -6, 2, 0, -6, 26);
        hg.addColorStop(0, rgba(mb.glow, 0.9 * alpha)); hg.addColorStop(1, rgba(mb.color, 0.9 * alpha));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(0, -8, 22, 24, 0, 0, 7); ctx.fill();
        // eyes
        for (let s = -1; s <= 1; s += 2) { ctx.fillStyle = rgba('#fff', 0.9 * alpha); ctx.beginPath(); ctx.ellipse(s * 9, -10, 5, 6, 0, 0, 7); ctx.fill(); ctx.fillStyle = rgba('#12041a', alpha); ctx.beginPath(); ctx.ellipse(s * 9, -10, 1.6, 4, 0, 0, 7); ctx.fill(); }
      } else if (mb.kind === 'serpent') {
        ctx.save(); ctx.rotate(mb.ph);
        const seg = 14; const spine = [];
        for (let i = 0; i <= seg; i++) { const t = i / seg; const bx = -t * 78; const by = Math.sin(this.time * 3 - t * 5) * 12 * (1 - t * 0.2); spine.push([bx, by]); }
        ctx.lineCap = 'round';
        // fins
        for (let i = 1; i < seg; i += 2) { const p = spine[i]; ctx.fillStyle = rgba(mb.glow, 0.4 * alpha); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - 5, p[1] - 9); ctx.lineTo(p[0] - 10, p[1]); ctx.closePath(); ctx.fill(); }
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? rgba(mb.glow, 0.5 * alpha) : rgba(mb.color, 0.92 * alpha);
          ctx.lineWidth = pass ? 3 : 11;
          ctx.beginPath(); ctx.moveTo(spine[0][0], spine[0][1]);
          for (const p of spine) ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
        // head
        ctx.fillStyle = rgba(mb.color, 0.95 * alpha); ctx.beginPath(); ctx.ellipse(6, 0, 12, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#fff', alpha); ctx.beginPath(); ctx.arc(10, -3, 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = rgba('#04241c', alpha); ctx.beginPath(); ctx.arc(10.8, -3, 1.2, 0, 7); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // -------------------------------------------------- per-act ruin silhouettes (item 3)
  // Cached to an offscreen canvas keyed on levelIndex; rebuilt only when the act
  // changes. Very dark, low-alpha, near the bottom/mid so it reads behind play.
  drawBackground() {
    const ctx = this.ctx;
    const ww = this.ww, wh = this.wh;
    if (!this._bg || this._bgLevel !== this.levelIndex) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.floor(ww)); cv.height = Math.max(1, Math.floor(wh));
      const c = cv.getContext('2d');
      c.save();
      c.globalAlpha = 1;
      const floor = wh - TILE;
      const dark = (a) => `rgba(22,40,66,${a})`;
      const act = this.levelIndex;
      if (act === 0) {
        // bare trench basalt ridges
        c.fillStyle = dark(0.5);
        c.beginPath(); c.moveTo(0, floor);
        for (let x = 0; x <= ww; x += ww / 7) { c.lineTo(x + ww / 14, floor - 60 - (x % 3) * 26); c.lineTo(x + ww / 7, floor - 10); }
        c.lineTo(ww, wh); c.lineTo(0, wh); c.closePath(); c.fill();
      } else if (act === 1) {
        // drowned coral arches
        c.fillStyle = dark(0.42);
        for (let i = 0; i < 4; i++) { const cx = ww * (0.15 + i * 0.24); c.beginPath(); c.arc(cx, floor - 40, 90, Math.PI, 0); c.lineTo(cx + 90, floor); c.lineTo(cx - 90, floor); c.closePath(); c.fill(); }
      } else if (act === 2) {
        // sunken Greek colonnade
        c.fillStyle = dark(0.5);
        c.fillRect(ww * 0.1, floor - 210, ww * 0.7, 18);
        c.beginPath(); c.moveTo(ww * 0.08, floor - 210); c.lineTo(ww * 0.45, floor - 268); c.lineTo(ww * 0.82, floor - 210); c.closePath(); c.fill();
        for (let i = 0; i < 7; i++) { const x = ww * 0.12 + i * (ww * 0.66 / 6); const hh = 150 + (i % 2) * 40; c.fillRect(x, floor - hh, 22, hh); c.fillRect(x - 3, floor - hh, 28, 8); }
        c.save(); c.translate(ww * 0.5, floor - 18); c.rotate(0.12); c.fillRect(0, 0, 150, 18); c.restore();
        c.fillRect(ww * 0.09, floor - 24, ww * 0.72, 10); c.fillRect(ww * 0.07, floor - 14, ww * 0.76, 10);
      } else if (act === 3) {
        // flooded temple with a broken statue
        c.fillStyle = dark(0.44);
        c.fillRect(ww * 0.2, floor - 200, ww * 0.6, 16);
        for (let i = 0; i < 5; i++) { const x = ww * 0.22 + i * (ww * 0.52 / 4); c.fillRect(x, floor - 170, 20, 170); }
        c.beginPath(); c.moveTo(ww * 0.5, floor - 170); c.lineTo(ww * 0.44, floor - 90); c.lineTo(ww * 0.56, floor - 110); c.closePath(); c.fill();
      } else if (act === 4) {
        // drowned city skyline
        let x = ww * 0.05; while (x < ww * 0.95) { const bw = 40 + (x % 5) * 12; const bh = 90 + ((x / 30) % 5) * 44;
          c.fillStyle = dark(0.46); c.fillRect(x, floor - bh, bw, bh); c.fillRect(x + bw * 0.4, floor - bh - 22, 4, 22);
          c.fillStyle = 'rgba(140,190,235,0.12)';
          for (let wy = floor - bh + 12; wy < floor - 14; wy += 20) for (let wx = x + 6; wx < x + bw - 6; wx += 14) c.fillRect(wx, wy, 5, 8);
          x += bw + 14; }
      } else if (act === 5) {
        // giant sunken galleon hull
        c.fillStyle = dark(0.45);
        c.beginPath(); c.moveTo(ww * 0.2, floor - 40); c.quadraticCurveTo(ww * 0.5, floor - 210, ww * 0.8, floor - 40); c.lineTo(ww * 0.8, floor); c.lineTo(ww * 0.2, floor); c.closePath(); c.fill();
        c.fillRect(ww * 0.48, floor - 300, 12, 260);
      } else if (act === 6) {
        // coral throne hall
        c.fillStyle = dark(0.44);
        for (let i = 0; i < 5; i++) { const x = ww * 0.14 + i * (ww * 0.6 / 4); c.beginPath(); c.arc(x, floor - 120, 46, Math.PI, 0); c.lineTo(x + 46, floor); c.lineTo(x - 46, floor); c.closePath(); c.fill(); }
        c.fillRect(ww * 0.44, floor - 150, ww * 0.12, 150);
      } else if (act === 7) {
        // Atlantean crystal palace (angular crystals)
        c.fillStyle = dark(0.46);
        for (let i = 0; i < 8; i++) { const x = ww * (0.08 + i * 0.11); const hh = 140 + (i % 3) * 70; c.beginPath(); c.moveTo(x, floor); c.lineTo(x + 18, floor - hh); c.lineTo(x + 40, floor - hh * 0.55); c.lineTo(x + 56, floor); c.closePath(); c.fill(); }
        c.beginPath(); c.moveTo(ww * 0.46, floor); c.lineTo(ww * 0.5, floor - 300); c.lineTo(ww * 0.56, floor - 150); c.lineTo(ww * 0.6, floor); c.closePath(); c.fill();
        c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(120,180,255,0.10)';
        for (let i = 0; i < 8; i++) { const x = ww * (0.08 + i * 0.11); const hh = 140 + (i % 3) * 70; c.beginPath(); c.moveTo(x + 18, floor - hh); c.lineTo(x + 24, floor - hh * 0.5); c.lineTo(x + 30, floor - hh * 0.7); c.closePath(); c.fill(); }
        c.restore();
      }
      c.restore();
      this._bg = cv; this._bgLevel = this.levelIndex;
    }
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.drawImage(this._bg, 0, 0, ww, wh);
    ctx.restore();
  }

  // -------------------------------------------------- score + leaderboard screens (item 4)
  drawScore(s) {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);
    ctx.fillStyle = 'rgba(0,3,10,0.86)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.shadowColor = 'rgba(255,230,160,0.9)'; ctx.shadowBlur = 36;
    ctx.font = '700 46px Georgia, serif'; ctx.fillStyle = '#fff4dc';
    ctx.fillText('RUN COMPLETE', w / 2, h * 0.24);
    ctx.restore();
    const rs = this.runStats || { time: 0, kills: 0, score: 0, timeBonus: 0 };
    ctx.font = '500 18px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(190,220,245,0.92)';
    ctx.fillText(`TIME   ${fmtTime(rs.time)}`, w / 2, h * 0.38);
    ctx.fillText(`KILLS  ${rs.kills}`, w / 2, h * 0.44);
    ctx.fillText(`TIME BONUS  ${rs.timeBonus}`, w / 2, h * 0.50);
    ctx.save(); ctx.shadowColor = 'rgba(120,255,220,0.6)'; ctx.shadowBlur = 20;
    ctx.font = '700 30px Georgia, serif'; ctx.fillStyle = '#a8ffe8';
    ctx.fillText(`SCORE  ${rs.score}`, w / 2, h * 0.58);
    ctx.restore();
    const caret = (Math.sin(this.time * 5) > 0) ? '_' : ' ';
    ctx.font = '600 22px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(`> ${this.nameEntry}${caret}`, w / 2, h * 0.70);
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(220,245,255,${0.4 + 0.5 * Math.sin(this.time * 2.5)})`;
    ctx.fillText('type your name · ENTER to save', w / 2, h * 0.78);
    ctx.textAlign = 'left';
  }

  drawLeaderboard(s) {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);
    ctx.fillStyle = 'rgba(0,3,10,0.88)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.shadowColor = 'rgba(120,255,220,0.7)'; ctx.shadowBlur = 28;
    ctx.font = '700 40px Georgia, serif'; ctx.fillStyle = '#d6fff2';
    ctx.fillText('HALL OF THE DEEP', w / 2, h * 0.16);
    ctx.restore();
    const list = loadScores();
    ctx.font = '500 14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(150,190,225,0.6)';
    ctx.fillText('#   NAME            SCORE     TIME    KILLS', w / 2, h * 0.28);
    ctx.textAlign = 'left';
    const left = w / 2 - 220; let y = h * 0.34;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mine = this.lastScore && e === this.lastScore;
      ctx.font = `${mine ? '700' : '500'} 15px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = mine ? '#ffe08a' : 'rgba(200,225,248,0.85)';
      const row = `${String(i + 1).padStart(2, ' ')}   ${(e.name || 'DIVER').padEnd(12, ' ')}   ${String(e.score).padStart(6, ' ')}   ${fmtTime(e.time).padStart(5, ' ')}   ${String(e.kills).padStart(4, ' ')}`;
      ctx.fillText(row, left, y);
      y += 24;
    }
    if (!list.length) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(180,210,240,0.6)'; ctx.fillText('no dives recorded yet', w / 2, y); }
    ctx.textAlign = 'center';
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(220,245,255,${0.4 + 0.5 * Math.sin(this.time * 2.5)})`;
    ctx.fillText('R / any key to dive again', w / 2, h * 0.86);
    ctx.textAlign = 'left';
  }

  drawBoss() {
    const b = this.boss;
    if (!b) return;
    const ctx = this.ctx;
    if (b.dead && b.dieT > 1.6) return;
    this.litSources.push({ x: b.x, y: b.y, r: b.enraged ? 250 : 205, c: b.enraged ? '#ff5d73' : '#ff9db0' });
    const alpha = b.dead ? clamp(1 - b.dieT / 1.6, 0, 1) : 1;
    const scl = b.dead ? 1.5 + b.dieT * 0.5 : 1.5;
    const bbeat = 1 + Math.sin(this.time * 2.4) * 0.05;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ph + Math.PI / 2); ctx.scale(scl * bbeat, scl * (2 - bbeat));
    ctx.globalAlpha = alpha;
    // glow
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 90);
    g.addColorStop(0, rgba(b.enraged ? '#ff5d73' : '#ff9db0', 0.4)); g.addColorStop(1, rgba('#ff9db0', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 90, 0, 7); ctx.fill();
    ctx.restore();
    // tentacles (jelly heritage)
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.5;
      const bx = Math.sin(a) * 26;
      const len = 120 + (i % 2) * 34;
      const sway = 10 + (i % 3) * 5;
      const ph = this.time * 2.2 + i * 0.9;
      const midx = bx + Math.sin(ph) * sway * 0.5;
      const endx = bx + Math.sin(ph + 1.1) * sway;
      ctx.strokeStyle = rgba('#b06a86', (0.55 - Math.abs(a) * 0.12) * alpha); ctx.lineWidth = 5 - Math.abs(a);
      ctx.beginPath(); ctx.moveTo(bx, 26);
      ctx.quadraticCurveTo(midx, 26 + len * 0.55, endx, 26 + len);
      ctx.stroke();
      // glowing tip
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ff9db0', 0.5 * alpha); ctx.beginPath(); ctx.arc(endx, 26 + len, 2.4, 0, 7); ctx.fill();
      ctx.restore();
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

  drawPlayer() {
    const ctx = this.ctx;
    const f = this.form;
    // light sources for this frame (used by terrain + lighting pass)
    this.litSources = [];
    let lr = f.key === 'angler' ? 200 : f.key === 'jelly' ? 138 : 154;
    this.litSources.push({ x: this.px, y: this.py, r: this.power ? lr * 1.05 : lr, c: this.power ? this.power.color : f.glow });
    if (this.flare) this.litSources.push({ x: this.flare.x, y: this.flare.y, r: this.flare.r * 1.6, c: '#ffd88a' });
    for (const b of this.bulbs) this.litSources.push({ x: b.x, y: b.y, r: 55, c: '#6fd0ff' });
    for (const v of this.vipers) this.litSources.push({ x: v.x, y: v.y, r: 68 + (v.charge > 0 ? 48 : 0), c: v.charge > 0 ? '#ff5a72' : '#8f7dff' });
    for (const l of this.lanterns) this.litSources.push({ x: l.x, y: l.y, r: 64 + (l.pulse || 0) * 26, c: '#ffd06a' });
    for (const s of this.stingers) this.litSources.push({ x: s.x, y: s.y + 12, r: s.reach > 12 ? 66 + s.reach : 42, c: s.reach > 12 ? '#ff5c96' : '#7fa8bd' });
    if (this.goal) this.litSources.push({ x: this.goal.x, y: this.goal.y, r: 110, c: '#ffcf7a' });
    for (const c of this.checkpoints) if (c.on) this.litSources.push({ x: c.x, y: c.y, r: 60, c: '#78ffdc' });

    // trail
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const t of this.trail) {
      const a = 1 - t.t / 0.55;
      ctx.fillStyle = rgba(f.glow, a * 0.07);
      ctx.beginPath(); ctx.arc(t.x, t.y, f.r * (0.6 + a * 1.2), 0, 7); ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(this.px, this.py);
    if (this.power) {
      // item 5: the powered aura used to swallow the creature into an unreadable
      // orb. Keep it a subtle halo so the anatomy still reads while powered.
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const pc = this.power.color;
      const pr = f.r * (1.6 + 0.12 * Math.sin(this.time * 6));
      const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      pg.addColorStop(0, rgba(pc, 0.12)); pg.addColorStop(1, rgba(pc, 0));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(pc, 0.4); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, f.r * 1.35, 0, 7); ctx.stroke();
      ctx.restore();
    }
    const ang = Math.atan2(this.vy, this.vx);
    const speed = Math.hypot(this.vx, this.vy);
    const VS = f.key === 'eel' ? 1.3 : f.key === 'angler' ? 1.24 : 1.2;
    if (f.key === 'eel') {
      ctx.rotate(this.aim);
      ctx.scale(VS, VS);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, rgba(f.glow, 0.2)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.restore();
      // ---- EEL: undulating tapered body, fin membrane, chevrons, gills, barbels
      const seg = 11, pitch = 6.2;
      const spine = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const wob = Math.sin(this.time * 8 - i * 0.75) * (2.0 + speed * 0.014) * t;
        spine.push({ x: -i * pitch, y: wob, r: 7.4 * (1 - t * 0.78) + 1.1 });
      }
      const tl = spine[spine.length - 1];
      // caudal fin
      ctx.fillStyle = rgba(f.glow, 0.3);
      ctx.beginPath();
      ctx.moveTo(tl.x + 1.5, tl.y);
      ctx.lineTo(tl.x - 10, tl.y - 7.6); ctx.lineTo(tl.x - 5, tl.y); ctx.lineTo(tl.x - 10, tl.y + 7.6);
      ctx.closePath(); ctx.fill();
      // dorsal + anal fin membranes (translucent ribbons riding the spine)
      ctx.fillStyle = rgba(f.glow, 0.15);
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y - spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y - s.r - 3.4);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y - spine[i].r);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y + spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y + s.r + 2.6);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y + spine[i].r);
      ctx.closePath(); ctx.fill();
      // body silhouette
      ctx.fillStyle = '#04141c';
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y - spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y - s.r);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y + spine[i].r);
      ctx.closePath(); ctx.fill();
      // volume + muscle chevrons, clipped to the body
      ctx.save(); ctx.clip();
      const bg = ctx.createLinearGradient(0, -9, 0, 9);
      bg.addColorStop(0, rgba(f.body, 0.32)); bg.addColorStop(0.55, 'rgba(4,20,28,0)');
      bg.addColorStop(1, rgba(f.glow, 0.12));
      ctx.fillStyle = bg; ctx.fillRect(-80, -12, 100, 24);
      ctx.strokeStyle = rgba(f.body, 0.26); ctx.lineWidth = 1;
      for (let i = 1; i < spine.length - 2; i++) {
        const s = spine[i];
        ctx.beginPath();
        ctx.moveTo(s.x + 2.2, s.y - s.r * 0.82);
        ctx.lineTo(s.x - 2.4, s.y);
        ctx.lineTo(s.x + 2.2, s.y + s.r * 0.82);
        ctx.stroke();
      }
      ctx.restore();
      // lateral line
      ctx.setLineDash([2.4, 3]); ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < spine.length; i++) {
        const s = spine[i];
        i ? ctx.lineTo(s.x, s.y - s.r * 0.18) : ctx.moveTo(s.x, s.y - s.r * 0.18);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // glowing belly
      ctx.strokeStyle = rgba(f.glow, 0.85); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < spine.length; i++) {
        const s = spine[i];
        i ? ctx.lineTo(s.x, s.y + s.r) : ctx.moveTo(s.x, s.y + s.r);
      }
      ctx.stroke();
      // flank speckles
      ctx.fillStyle = rgba(f.glow, 0.5);
      for (let i = 2; i < spine.length - 1; i += 2) {
        const s = spine[i];
        ctx.beginPath(); ctx.arc(s.x - 1, s.y - s.r * 0.45, 0.85, 0, 7); ctx.fill();
      }
      // pectoral fin
      ctx.save(); ctx.rotate(Math.sin(this.time * 6) * 0.18);
      ctx.fillStyle = rgba(f.glow, 0.26);
      ctx.beginPath(); ctx.moveTo(-0.5, 4);
      ctx.quadraticCurveTo(-4, 11.5, -9.5, 12.5);
      ctx.quadraticCurveTo(-5.5, 6.5, -0.5, 6.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // gill slits
      ctx.strokeStyle = rgba(f.glow, 0.7); ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const x = -2.4 - i * 2.7;
        ctx.beginPath(); ctx.moveTo(x, -4.6); ctx.quadraticCurveTo(x - 1.8, 0, x, 4.8); ctx.stroke();
      }
      // head: collar, skull, jaw, eye, barbels
      ctx.fillStyle = rgba(f.body, 0.95);
      ctx.beginPath(); ctx.ellipse(2.4, 0, 9.2, 7.1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#04141c';
      ctx.beginPath(); ctx.ellipse(3.2, 0.8, 7.4, 5.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10.6, 1.8); ctx.lineTo(3.6, 5.2); ctx.stroke();
      ctx.fillStyle = '#dff8f0';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(9.6 - i * 1.9, 3.4); ctx.lineTo(9 - i * 1.9, 5.1); ctx.lineTo(8.2 - i * 1.9, 3.4);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(9.5, 2.6);
      ctx.quadraticCurveTo(13.5, 5 + Math.sin(this.time * 5) * 0.9, 16, 7.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9.5, 3.4);
      ctx.quadraticCurveTo(12.5, 6.5 + Math.cos(this.time * 4.4) * 0.9, 14, 9.2); ctx.stroke();
      ctx.fillStyle = '#eafff9'; ctx.beginPath(); ctx.arc(5.8, -2.8, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#03201b'; ctx.beginPath(); ctx.arc(6.5, -2.8, 1.35, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(4.9, -3.7, 0.7, 0, 7); ctx.fill();
    } else if (f.key === 'angler') {
      ctx.rotate(this.aim);
      ctx.scale(VS, VS);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      g.addColorStop(0, rgba(f.glow, 0.18)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
      ctx.restore();
      // ---- ANGLERFISH: huge jaw, canines, operculum, fin fans, photophores
      // caudal fin with rays
      ctx.save(); ctx.rotate(Math.sin(this.time * 5.5) * 0.16);
      ctx.fillStyle = rgba(f.glow, 0.3);
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-27, -11); ctx.lineTo(-21.5, 0); ctx.lineTo(-27, 11);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 0.8;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-25, i * 4.2); ctx.stroke();
      }
      ctx.restore();
      // dorsal spines
      ctx.strokeStyle = rgba(f.body, 0.75); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -11 + i * 3.9;
        ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x - 1.8, -16.5 - (i % 3) * 2.6); ctx.stroke();
      }
      // pectoral fin fan
      ctx.save(); ctx.rotate(Math.sin(this.time * 4.4) * 0.22);
      ctx.fillStyle = rgba(f.glow, 0.22);
      ctx.beginPath(); ctx.moveTo(2, 5);
      ctx.quadraticCurveTo(-3, 15, -11, 17);
      ctx.quadraticCurveTo(-7, 8.5, 2, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // body
      ctx.fillStyle = '#241705';
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 12.2, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.clip();
      const bg2 = ctx.createLinearGradient(0, -13, 0, 13);
      bg2.addColorStop(0, rgba(f.body, 0.3)); bg2.addColorStop(0.5, 'rgba(36,23,5,0)');
      bg2.addColorStop(1, rgba(f.glow, 0.14));
      ctx.fillStyle = bg2; ctx.fillRect(-20, -14, 40, 28);
      // mottled hide
      ctx.fillStyle = rgba(f.body, 0.13);
      const mott = [[-8, -5, 4.2], [-2, -7, 3.1], [-11, 2, 3.6], [-4, 4, 4.6], [3, -6, 2.8], [6, 5, 3.2]];
      for (const [mx, my, mr] of mott) { ctx.beginPath(); ctx.ellipse(mx, my, mr, mr * 0.7, 0.4, 0, 7); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = rgba(f.glow, 0.7); ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 12.2, 0, 0, 7); ctx.stroke();
      // operculum (gill cover)
      ctx.strokeStyle = rgba(f.glow, 0.55); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(4.5, -8.5); ctx.quadraticCurveTo(8.5, 0, 4.5, 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2.5, -7.5); ctx.quadraticCurveTo(6, 0, 2.5, 8); ctx.stroke();
      // photophore rows along the belly
      ctx.fillStyle = rgba(f.glow, 0.8);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-12 + i * 4.2, 8.4, 1.1, 0, 7); ctx.fill(); }
      ctx.fillStyle = rgba(f.glow, 0.45);
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-11 + i * 4.4, -9.6, 0.9, 0, 7); ctx.fill(); }
      // gaping jaw
      ctx.fillStyle = '#120a01';
      ctx.beginPath();
      ctx.moveTo(4, -7.5); ctx.quadraticCurveTo(22, -5, 19.5, 1.2);
      ctx.quadraticCurveTo(13, 10, 3, 8.8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4, -7.5); ctx.quadraticCurveTo(22, -5, 19.5, 1.2); ctx.stroke();
      // teeth: two long canines plus a full set
      ctx.fillStyle = '#fff6dd';
      const teeth = [[6, -5.6, 3.4], [9.6, -4.4, 3.9], [13.2, -2.4, 3.1], [16, 0.4, 2.4],
                     [7.2, 6.8, -3.4], [11, 5.6, -3.8], [14.2, 3.4, -2.8]];
      for (const [tx, ty, th] of teeth) {
        ctx.beginPath(); ctx.moveTo(tx - 1.7, ty); ctx.lineTo(tx, ty + th); ctx.lineTo(tx + 1.7, ty);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#fffbe9';
      ctx.beginPath(); ctx.moveTo(8.4, -5.8); ctx.lineTo(9.9, -1.2); ctx.lineTo(11.4, -5.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9.4, 7.2); ctx.lineTo(10.8, 2.6); ctx.lineTo(12.2, 6.6); ctx.closePath(); ctx.fill();
      // eye with lid + catchlight
      ctx.fillStyle = '#f7f2df'; ctx.beginPath(); ctx.arc(5.6, -6.4, 4.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#140c02'; ctx.beginPath(); ctx.arc(6.6, -6.4, 2.1, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(4.4, -7.7, 1.1, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.body, 0.8); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(5.6, -6.4, 4.1, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      // illicium (segmented rod) + esca (lure) with filaments
      const lx = 22 + Math.sin(this.time * 2.1) * 2.6, ly = -25 + Math.cos(this.time * 1.6) * 2.6;
      ctx.strokeStyle = rgba(f.body, 0.95); ctx.lineWidth = 1.9;
      ctx.beginPath(); ctx.moveTo(6.5, -11.5); ctx.quadraticCurveTo(19, -22, lx, ly); ctx.stroke();
      ctx.fillStyle = rgba(f.glow, 0.9);
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const bx = (1 - t) * (1 - t) * 6.5 + 2 * (1 - t) * t * 19 + t * t * lx;
        const by = (1 - t) * (1 - t) * -11.5 + 2 * (1 - t) * t * -22 + t * t * ly;
        ctx.beginPath(); ctx.arc(bx, by, 1.2, 0, 7); ctx.fill();
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 16);
      lg.addColorStop(0, 'rgba(255,246,210,0.85)'); lg.addColorStop(0.35, 'rgba(255,205,110,0.32)'); lg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 16, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,235,180,0.7)'; ctx.lineWidth = 0.9;
      for (let i = 0; i < 5; i++) {
        const a = i * (Math.PI * 2 / 5) + this.time * 0.8;
        ctx.beginPath(); ctx.moveTo(lx + Math.cos(a) * 3, ly + Math.sin(a) * 3);
        ctx.lineTo(lx + Math.cos(a) * 7.5, ly + Math.sin(a) * 7.5); ctx.stroke();
      }
      ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, 7); ctx.fill();
    } else {
      ctx.scale(VS, VS);
      ctx.rotate(this.aim + Math.PI / 2);
      // ---- JELLY: domed bell, ocelli, lappets, radial canals, gonads, beaded arms
      const sq = 1 + Math.sin(this.time * 3.0) * 0.13;
      const bw = 15.5 * sq, bh = 11.5 / sq;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -4, 0, 0, -4, 30);
      g.addColorStop(0, rgba(f.glow, 0.2)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -4, 30, 0, 7); ctx.fill();
      ctx.restore();
      ctx.lineCap = 'round';
      // long beaded tentacles, drawn first so the bell laps over their roots
      for (let i = 0; i < 12; i++) {
        const ox = -13.5 + i * 2.45;
        const len = 30 + (i % 4) * 9;
        const sw = Math.sin(this.time * 2.5 + i * 0.7) * 7;
        ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(ox, 0);
        ctx.bezierCurveTo(ox + sw * 0.4, len * 0.4, ox + sw, len * 0.72, ox + sw * 0.6, len);
        ctx.stroke();
        ctx.fillStyle = rgba(f.glow, 0.75);
        for (let k = 1; k <= 3; k++) {
          const t = k / 4;
          const bx = ox + sw * t * 0.85, by = len * t;
          ctx.beginPath(); ctx.arc(bx, by, 0.9, 0, 7); ctx.fill();
        }
      }
      // oral arms: frilled ribbons hanging centrally
      for (let i = 0; i < 4; i++) {
        const ox = -6 + i * 4;
        const sw = Math.sin(this.time * 2.2 + i * 1.1) * 5;
        ctx.fillStyle = rgba(f.body, 0.4);
        ctx.beginPath();
        ctx.moveTo(ox - 2.4, 0);
        ctx.quadraticCurveTo(ox + sw * 0.6 - 2, 12, ox + sw - 1.2, 21);
        ctx.lineTo(ox + sw + 1.2, 21);
        ctx.quadraticCurveTo(ox + sw * 0.6 + 2.4, 12, ox + 2.4, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(ox, 1);
        ctx.quadraticCurveTo(ox + sw * 0.6, 12, ox + sw, 20); ctx.stroke();
      }
      // bell path: domed exumbrella over a scalloped margin
      const lobes = 7;
      const bellPath = () => {
        ctx.beginPath();
        ctx.moveTo(-bw, -1);
        ctx.bezierCurveTo(-bw, -bh * 2.15, bw, -bh * 2.15, bw, -1);
        for (let i = 0; i <= lobes; i++) {
          const t = i / lobes;
          ctx.lineTo(bw - 2 * bw * t, -1 + Math.sin(t * Math.PI * lobes) * 2.6);
        }
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(26,10,50,0.9)'; bellPath(); ctx.fill();
      ctx.save(); bellPath(); ctx.clip();
      const bg3 = ctx.createLinearGradient(0, -bh * 2.1, 0, 2);
      bg3.addColorStop(0, rgba(f.glow, 0.3)); bg3.addColorStop(0.6, rgba(f.body, 0.18));
      bg3.addColorStop(1, 'rgba(26,10,50,0)');
      ctx.fillStyle = bg3; ctx.fillRect(-bw, -bh * 2.2, bw * 2, bh * 2.4);
      // radial canals
      ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const t = (i + 0.5) / 7;
        ctx.beginPath(); ctx.moveTo(0, -bh * 1.5);
        ctx.quadraticCurveTo((-bw + 2 * bw * t) * 0.5, -bh * 0.9, -bw + 2 * bw * t, -1.5);
        ctx.stroke();
      }
      ctx.restore();
      // rim: circular canal + outer membrane
      ctx.strokeStyle = rgba(f.glow, 0.95); ctx.lineWidth = 1.9; bellPath(); ctx.stroke();
      ctx.strokeStyle = rgba(f.glow, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -1.5, bw * 0.86, bh * 0.72, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke();
      // ocelli around the margin
      ctx.fillStyle = rgba(f.glow, 0.95);
      for (let i = 0; i < 8; i++) {
        const t = (i + 0.5) / 8;
        ctx.beginPath(); ctx.arc(-bw + 2 * bw * t, -2.6, 1.15, 0, 7); ctx.fill();
      }
      // gonad cluster + manubrium + highlight
      ctx.fillStyle = rgba(f.glow, 0.72);
      for (const [gx, gy] of [[-4.4, -7.5], [4.4, -7.5], [-2.4, -11.5], [2.4, -11.5]]) {
        ctx.beginPath(); ctx.ellipse(gx, gy, 3.1, 2.4, 0, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -1); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.ellipse(-4.6, -13.4, 2.6, 1.5, -0.5, 0, 7); ctx.fill();
    }
    ctx.restore();

    // flare ring
    if (this.flare) {
      const t = this.flare.t / this.flare.life;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,235,180,${(1 - t) * 0.8})`; ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(this.flare.x, this.flare.y, this.flare.r * (0.4 + t * 1.2), 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  drawLighting(s, ox, oy) {
    const lc = this.lctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, this.light.width, this.light.height);
    lc.fillStyle = 'rgba(1,5,14,0.86)';
    lc.fillRect(0, 0, this.light.width, this.light.height);
    lc.globalCompositeOperation = 'destination-out';
    for (const l of this.litSources) {
      const x = ox + l.x * s, y = oy + l.y * s, r = l.r * s;
      const g = lc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.72)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath(); lc.arc(x, y, r, 0, 7); lc.fill();
    }
    lc.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.light, 0, 0);
  }

  // -------------------------------------------------- HUD
  drawHUD(s) {
    const ctx = this.ctx;
    const W = this.cv.width, H = this.cv.height;
    const u = Math.max(1, Math.min(W, H) / 700);
    ctx.save();
    ctx.scale(u, u);
    const w = W / u, h = H / u;

    // scrim so the HUD still reads over the bloom
    const scrim = ctx.createLinearGradient(0, 0, 0, 74);
    scrim.addColorStop(0, 'rgba(0,6,16,0.6)');
    scrim.addColorStop(1, 'rgba(0,6,16,0)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, 74);

    // top bar
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const L = LEVELS[this.levelIndex];
    ctx.fillStyle = 'rgba(190,225,255,0.75)';
    ctx.fillText((L.name || '').toUpperCase(), 18, 20);

    // sparks
    ctx.fillStyle = 'rgba(160,255,210,0.95)';
    ctx.beginPath(); ctx.arc(24, 40, 4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(200,255,230,0.9)';
    ctx.fillText(String(this.sparks), 34, 40);

    // deaths
    ctx.fillStyle = 'rgba(255,140,160,0.6)';
    ctx.fillText('×' + this.deaths, 64, 40);

    // elapsed time + kills (item 7): keep the score legible mid-run
    if (this.state === 'play') {
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(200,230,255,0.8)';
      ctx.fillText(`${fmtTime(this.time - this.startedAt)}   ·   ${this.kills} kills`, w / 2, 20);
      ctx.textAlign = 'left';
    }

    // form chips
    const chips = FORM_ORDER.map((k) => FORMS[k]);
    let cx = w - 18;
    ctx.textAlign = 'right';
    for (let i = chips.length - 1; i >= 0; i--) {
      const f = chips[i];
      const active = this.form.key === f.key;
      const label = `${f.num} ${f.name}`;
      ctx.font = `${active ? '700' : '500'} 12px ui-monospace, Menlo, monospace`;
      const tw = ctx.measureText(label).width + 16;
      const bx = cx - tw;
      ctx.fillStyle = active ? rgba(f.glow, 0.18) : 'rgba(255,255,255,0.04)';
      this.rr(bx, 10, tw, 22, 6); ctx.fill();
      if (active) { ctx.strokeStyle = rgba(f.glow, 0.8); ctx.lineWidth = 1.2; this.rr(bx, 10, tw, 22, 6); ctx.stroke(); }
      ctx.fillStyle = active ? f.body : 'rgba(190,215,240,0.45)';
      ctx.fillText(label, cx - 8, 21);
      cx = bx - 6;
    }
    ctx.textAlign = 'left';

    // ability cooldown bar
    const cd = clamp(this.cooldown / 1.0, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.rr(18, h - 30, 120, 5, 3); ctx.fill();
    ctx.fillStyle = rgba(this.form.glow, 0.85);
    this.rr(18, h - 30, 120 * (1 - cd), 5, 3); ctx.fill();
    ctx.font = '500 10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(180,210,240,0.5)';
    ctx.fillText('SPACE · ' + this.form.abilityName + (this.form.ability === 'flare' ? ' (2 sparks)' : ''), 18, h - 40);

    // boss / mini-boss health bar (item 7): the Matriarch takes priority; else the
    // first live mini-boss shows its own name + hp in its glow colour.
    {
      let hb = null, hlabel = '', hcol = '#ff8fa3', hcol2 = 'rgba(255,150,170,0.5)';
      if (this.boss && !this.boss.dead) {
        hb = this.boss; hlabel = 'THE MATRIARCH'; hcol = this.boss.enraged ? '#ff5d73' : '#ff8fa3';
      } else {
        for (const mb of this.minibosses) if (!mb.dead) { hb = mb; hlabel = mb.name; hcol = mb.glow || mb.color; break; }
      }
      if (hb) {
        const bw = Math.min(420, w * 0.6), bx = (w - bw) / 2, by = 54;
        ctx.textAlign = 'center';
        ctx.font = '700 11px ui-monospace, Menlo, monospace';
        ctx.fillStyle = hcol;
        ctx.fillText(hlabel, w / 2, by - 8);
        ctx.fillStyle = 'rgba(0,10,24,0.7)'; ctx.fillRect(bx, by, bw, 8);
        const frac = clamp(hb.hp / hb.maxhp, 0, 1);
        ctx.fillStyle = hcol;
        ctx.fillRect(bx, by, bw * frac, 8);
        ctx.strokeStyle = rgba(hcol, 0.5); ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 8);
      }
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

    // hint line
    if (this.state === 'play' && this.time - this.startedAt < 9) {
      ctx.textAlign = 'center';
      ctx.font = '500 12px ui-monospace, Menlo, monospace';
      ctx.fillStyle = `rgba(200,230,255,${clamp(9 - (this.time - this.startedAt), 0, 1) * 0.7})`;
      ctx.fillText(this.hint, w / 2, h - 24);
      ctx.textAlign = 'left';
    }
    if (this.msg) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-monospace, Menlo, monospace';
      ctx.fillStyle = `rgba(255,200,140,${clamp(1 - this.msg.t / 2.2, 0, 1)})`;
      ctx.fillText(this.msg.text, w / 2, h - 60);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  centerText(t, y, font, color, align = 'center') {
    const ctx = this.ctx;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(t, this.cv.width / (2 * (this.uScale || 1)), y);
  }

  overlayBase(u) {
    const ctx = this.ctx;
    this.uScale = u;
    ctx.setTransform(u, 0, 0, u, 0, 0);
    const w = this.cv.width / u, h = this.cv.height / u;
    return { w, h };
  }

  drawTitle() {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);

    // drifting glow field
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const x = (Math.sin(i * 12.9898 + this.time * 0.08) * 0.5 + 0.5) * w;
      const y = ((i * 37.7 + this.time * 12) % (h + 60)) - 30;
      const r = 18 + (i % 5) * 9;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(90,200,255,${0.05 + (i % 3) * 0.02})`);
      g.addColorStop(1, 'rgba(60,150,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cy = h * 0.40;
    ctx.save();
    ctx.shadowColor = 'rgba(120,220,255,0.9)'; ctx.shadowBlur = 40;
    ctx.font = '700 74px Georgia, "Times New Roman", serif';
    ctx.fillStyle = '#dff3ff';
    ctx.fillText('FISH N CHIPS', w / 2, cy);
    ctx.restore();

    ctx.font = '500 15px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(150,200,235,0.85)';
    ctx.fillText('a bioluminescent descent · GITHUB GAME OFF 2026 — theme: SHIFT', w / 2, cy + 46);

    const forms = ['eel', 'angler', 'jelly'];
    const labels = { eel: 'FAST · fits narrow gaps', angler: 'LURE reveals the hidden', jelly: 'passes the burning curtain' };
    forms.forEach((k, i) => {
      const f = FORMS[k];
      const y = cy + 96 + i * 30;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(w / 2 - 130, y, 0, w / 2 - 130, y, 22);
      g.addColorStop(0, rgba(f.glow, 0.55)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2 - 130, y, 22, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = f.body; ctx.beginPath(); ctx.arc(w / 2 - 130, y, 5, 0, 7); ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = '700 14px ui-monospace, Menlo, monospace';
      ctx.fillStyle = f.body;
      ctx.fillText(f.name, w / 2 - 108, y - 7);
      ctx.font = '500 12px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(180,210,240,0.6)';
      ctx.fillText(labels[k], w / 2 - 108, y + 8);
      ctx.textAlign = 'center';
    });

    const pulse = 0.55 + 0.45 * Math.sin(this.time * 2.4);
    ctx.font = '600 16px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(220,245,255,${pulse})`;
    ctx.fillText('press any key · tap · or press A', w / 2, h * 0.86);

    ctx.font = '500 11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(150,185,215,0.45)';
    ctx.fillText('WASD / ARROWS swim · Q E shift form · SPACE ability · R restart · M mute', w / 2, h * 0.92);
    ctx.textAlign = 'left';
  }

  drawActCard(u0) {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);
    const a = clamp(this.cardT / 0.6, 0, 1) * clamp((4.5 - this.cardT) / 0.8, 0, 1);
    ctx.fillStyle = `rgba(0,4,12,${0.55 * a})`;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.shadowColor = `rgba(120,220,255,${0.8 * a})`; ctx.shadowBlur = 26;
    ctx.font = '700 40px Georgia, serif';
    ctx.fillStyle = `rgba(225,245,255,${a})`;
    ctx.fillText(this.actName, w / 2, h * 0.44);
    ctx.restore();
    ctx.font = '500 14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(160,205,240,${0.8 * a})`;
    this.wrap(this.hint, w / 2, h * 0.53, 520, 22, a);
    ctx.font = '500 11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(150,185,215,${0.5 * a})`;
    ctx.fillText('any key to begin', w / 2, h * 0.66);
    ctx.textAlign = 'left';
  }

  drawWin() {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);
    this.winT = (this.winT || 0) + 1 / 60;
    const a = clamp(this.winT / 0.5, 0, 1);
    ctx.fillStyle = `rgba(0,4,12,${0.6 * a})`; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.shadowColor = 'rgba(255,210,120,0.9)'; ctx.shadowBlur = 30;
    ctx.font = '700 44px Georgia, serif'; ctx.fillStyle = `rgba(255,240,205,${a})`;
    ctx.fillText(this.levelIndex + 1 >= LEVELS.length ? 'THE SURFACE' : 'ACT CLEARED', w / 2, h * 0.42);
    ctx.restore();
    ctx.font = '500 14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(190,220,245,${0.8 * a})`;
    ctx.fillText(`sparks ${this.sparks} · deaths ${this.deaths}`, w / 2, h * 0.52);
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(220,245,255,${0.4 + 0.5 * Math.sin(this.time * 2.5)})`;
    ctx.fillText('press any key to descend further', w / 2, h * 0.62);
    ctx.textAlign = 'left';
  }

  drawEnding() {
    const ctx = this.ctx;
    const u = Math.max(1, Math.min(this.cv.width, this.cv.height) / 700);
    const { w, h } = this.overlayBase(u);
    ctx.fillStyle = 'rgba(0,3,10,0.82)'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const x = (Math.sin(i * 78.233) * 0.5 + 0.5) * w;
      const y = ((i * 23.5 + this.time * 26) % (h + 40)) - 20;
      ctx.fillStyle = `rgba(180,240,255,${0.1 + (i % 4) * 0.05})`;
      ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.8, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.shadowColor = 'rgba(255,230,160,0.9)'; ctx.shadowBlur = 40;
    ctx.font = '700 52px Georgia, serif'; ctx.fillStyle = '#fff4dc';
    ctx.fillText('YOU REACHED THE LIGHT', w / 2, h * 0.36);
    ctx.restore();
    ctx.font = '500 15px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(190,220,245,0.85)';
    ctx.fillText(`${this.sparks} sparks gathered · ${this.deaths} times the dark took you · ${Math.round(this.time - this.startedAt)}s`, w / 2, h * 0.47);
    ctx.font = 'italic 500 14px Georgia, serif';
    ctx.fillStyle = 'rgba(160,200,235,0.7)';
    ctx.fillText('every creature you were carried you somewhere the others could not go.', w / 2, h * 0.55);
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = `rgba(220,245,255,${0.4 + 0.5 * Math.sin(this.time * 2.5)})`;
    ctx.fillText('press any key to dive again', w / 2, h * 0.66);
    ctx.textAlign = 'left';
  }

  wrap(text, x, y, maxW, lh, a = 1) {
    const ctx = this.ctx;
    const words = text.split(' ');
    let line = '', yy = y;
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy); line = wd; yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }
}

// Boot only when a #game canvas is present on the page. This lets the same
// verified Game class be imported by the PixiJS build (pixi.html) without
// auto-starting a second Canvas renderer there.
const canvas = document.getElementById('game');
if (canvas) {
const game = new Game(canvas);
window.__game = game; // exposed for the headless smoke test

// ---- touch controls (mobile / itch.io) ----
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick');
  const knob = stick.querySelector('.knob');
  let pid = null;
  const R = 46;
  const move = (e) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    game.touchAxis = { x: clamp(dx / R, -1, 1), y: clamp(dy / R, -1, 1) };
  };
  stick.addEventListener('pointerdown', (e) => { pid = e.pointerId; stick.setPointerCapture(pid); move(e); });
  stick.addEventListener('pointermove', (e) => { if (pid === e.pointerId) move(e); });
  const end = (e) => {
    if (pid !== e.pointerId) return;
    pid = null; knob.style.transform = ''; game.touchAxis = null;
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  document.querySelectorAll('.tb').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (game.state !== 'play') { game.tap(); return; }
      const act = b.dataset.act;
      if (act === 'form') game.cycleForm(1);
      else if (act === 'fire') { game.firing = true; game.aim = Math.atan2(game.vy, game.vx); }
      else game.ability();
    });
    const stopFire = (e) => { if (b.dataset.act === 'fire') game.firing = false; };
    b.addEventListener('pointerup', stopFire);
    b.addEventListener('pointercancel', stopFire);
    b.addEventListener('pointerleave', stopFire);
  });
}
}

// Exported so the PixiJS build (pixi.html) can reuse the exact same verified
// game logic (physics, enemies, boss, powerups, levels) under a Pixi renderer.
export { Game, FORMS, FORM_ORDER, POWERS };

