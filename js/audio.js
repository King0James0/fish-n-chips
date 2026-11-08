// Fish N Chips — procedural music + ocean soundscape + SFX (no asset files, all synthesized)
// Layered deep-sea ambience (swell, hiss, whale calls, bubbles), a slow ambient
// sequencer that can intensify for the boss, and per-form combat SFX.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.oceanGain = null;
    this.reverb = null;
    this.started = false;
    this.muted = false;
    this.droneNodes = [];
    this.seq = null;          // music sequencer state
    this.step = 0;
    this.nextNoteTime = 0;
    this.intensity = 0;       // 0 calm .. 1 boss
    this._timer = null;
  }

  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    // Safety limiter/compressor between the mix and the speakers. This is the
    // real fix for "volume keeps rising and becomes painful": even if the
    // reverb bed or a dense sequencer pass builds up, the compressor clamps the
    // output so it can never run away into a painful wall of sound.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    this.oceanGain = this.ctx.createGain();
    this.oceanGain.gain.value = 0.0;
    this.oceanGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.6;
    this.sfxGain.connect(this.master);

    // simple feedback-delay "space" send for bells + whales
    this.reverb = this.ctx.createGain();
    this.reverb.gain.value = 0.22;
    const d1 = this.ctx.createDelay(1.0); d1.delayTime.value = 0.19;
    const d2 = this.ctx.createDelay(1.0); d2.delayTime.value = 0.31;
    // Feedback kept well under the runaway threshold. With two delays summed and
    // re-fed, 0.42 gave an effective loop gain near 0.84 that slowly STACKED into
    // a louder and louder wash. 0.26 keeps the tail lush but self-limiting.
    const fb = this.ctx.createGain(); fb.gain.value = 0.26;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.reverb.connect(d1); this.reverb.connect(d2);
    d1.connect(lp); d2.connect(lp);
    lp.connect(fb); fb.connect(d1); fb.connect(d2);
    lp.connect(this.master);
    return true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setIntensity(x) { this.intensity = Math.max(0, Math.min(1, x)); }

  // ---- noise buffer helper ----
  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;      // brown-ish
      d[i] = last * 3.2;
    }
    return buf;
  }

  // ---- Ambient ocean bed: swell + hiss + scheduled whales & bubbles ----
  startAmbient() {
    if (!this.ensure() || this.started) return;
    this.started = true;
    const t = this.ctx.currentTime;

    // Low drone: detuned oscillators through a slow tremolo
    const drone = this.ctx.createGain();
    drone.gain.value = 0.13;
    drone.connect(this.musicGain);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.7;
    lp.connect(drone);
    [55, 82.4, 110].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = i === 2 ? 0.25 : 0.5;
      o.connect(g); g.connect(lp); o.start(t);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lg = this.ctx.createGain(); lg.gain.value = 0.18;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      this.droneNodes.push(o, lfo);
    });

    // Deep swell: brown noise through a lowpass whose gain breathes
    const swell = this.ctx.createBufferSource();
    swell.buffer = this._noise(4); swell.loop = true;
    const slp = this.ctx.createBiquadFilter();
    slp.type = 'lowpass'; slp.frequency.value = 180; slp.Q.value = 0.5;
    const sg = this.ctx.createGain(); sg.gain.value = 0.16;
    swell.connect(slp); slp.connect(sg); sg.connect(this.oceanGain);
    swell.start(t);
    const swellLfo = this.ctx.createOscillator(); swellLfo.frequency.value = 0.08;
    const swellLg = this.ctx.createGain(); swellLg.gain.value = 0.1;
    swellLfo.connect(swellLg); swellLg.connect(sg.gain); swellLfo.start(t);

    // Water hiss: bandpassed noise with a slow filter sweep
    const hiss = this.ctx.createBufferSource();
    hiss.buffer = this._noise(3); hiss.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.6;
    const hg = this.ctx.createGain(); hg.gain.value = 0.05;
    hiss.connect(bp); bp.connect(hg); hg.connect(this.oceanGain);
    hiss.start(t);
    const nlfo = this.ctx.createOscillator(); nlfo.frequency.value = 0.07;
    const ng2 = this.ctx.createGain(); ng2.gain.value = 320;
    nlfo.connect(ng2); ng2.connect(bp.frequency); nlfo.start(t);

    this.droneNodes.push(swell, swellLfo, hiss, nlfo);

    this.oceanGain.gain.setTargetAtTime(0.9, t, 2.0);
    this.musicGain.gain.setTargetAtTime(0.9, t, 3.0);

    this._startSequencer();
  }

  // ---- Music sequencer: sparse ambient bells over a slow chord pad ----
  _startSequencer() {
    if (this.seq) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.2;
    this.seq = true;
    this._timer = setInterval(() => this._schedule(), 90);
  }

  _schedule() {
    if (!this.ctx || !this.seq) return;
    const spb = 0.6;                       // seconds per step (~100 BPM / 2 feel)
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      this._playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 32;
    }
    // ambient one-shots (whales, bubbles) ride the same clock
    if (Math.random() < 0.012) this._whale(this.ctx.currentTime + rnd(0, 1));
    if (Math.random() < 0.05) this._bubble();
  }

  _playStep(s, t) {
    // A-minor pentatonic bells; denser + brighter as intensity rises
    const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
    const chordRoots = [110, 110, 87.3, 98];      // A2 A2 F2 G2, one per 8 steps
    const root = chordRoots[Math.floor(s / 8) % 4];
    // pad: a soft fifth on chord change
    if (s % 8 === 0) this._pad(root, t, 4.8);
    // melody: sparse, more notes when intense
    const density = 0.22 + this.intensity * 0.5;
    if (Math.random() < density) {
      const oct = Math.random() < 0.3 + this.intensity * 0.4 ? 2 : 1;
      const note = scale[Math.floor(Math.random() * scale.length)] * oct;
      this._bell(note, t, 0.9 + this.intensity * 0.6);
    }
    // a low pulse heartbeat during the boss
    if (this.intensity > 0.5 && s % 4 === 0) this._kick(t);
  }

  _bell(freq, t, dur) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.musicGain); g.connect(this.reverb);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  _pad(freq, t, dur) {
    [1, 1.5, 2].forEach((mult, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = freq * mult;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 / (i + 1), t + 1.2);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); lp.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }

  _kick(t) {
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    g.connect(this.musicGain); o.start(t); o.stop(t + 0.3);
  }

  _whale(t) {
    const base = rnd(90, 150);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.4, t + 1.4);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + 3.0);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5;
    const vg = this.ctx.createGain(); vg.gain.value = 4;
    vib.connect(vg); vg.connect(o.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g); g.connect(this.oceanGain); g.connect(this.reverb);
    o.start(t); vib.start(t); o.stop(t + 3.4); vib.stop(t + 3.4);
  }

  _bubble() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    const f = rnd(500, 1400);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.06);
    const g = this._env(o, t, 0.05, 0.003, 0.07);
    g.connect(this.oceanGain); o.start(t); o.stop(t + 0.12);
  }

  // ---- one-shot helpers ----
  _env(node, t, peak, atk, dec) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    node.connect(g);
    return g;
  }

  blip(freq = 880, dur = 0.12, type = 'sine', peak = 0.3) {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this._env(o, t, peak, 0.005, dur);
    g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }

  collect() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.14);
    const g = this._env(o, t, 0.28, 0.005, 0.18);
    g.connect(this.sfxGain); o.start(t); o.stop(t + 0.25);
  }

  shift() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const buf = this._noise(0.4);
    const n = this.ctx.createBufferSource(); n.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
    const ng = this._env(n, t, 0.22, 0.02, 0.34);
    n.connect(bp); bp.connect(ng); ng.connect(this.sfxGain); n.start(t); n.stop(t + 0.4);
    this.blip(523, 0.2, 'triangle', 0.18);
    this.blip(784, 0.25, 'sine', 0.12);
  }

  flare() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const g = this._env(o, t, 0.25, 0.005, 0.4);
    o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.5);
  }

  sting() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g = this._env(o, t, 0.3, 0.005, 0.45);
    g.connect(this.sfxGain); o.start(t); o.stop(t + 0.6);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise(0.3);
    const ng = this._env(n, t, 0.2, 0.005, 0.3);
    n.connect(ng); ng.connect(this.sfxGain); n.start(t); n.stop(t + 0.35);
  }

  // ---- new combat SFX ----
  // per-form shot: eel = fast zap, angler = heavy thump, jelly = soft shimmer
  shoot(form) {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    if (form === 'eel') {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(1200, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.12);
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const g = this._env(o, t, 0.16, 0.003, 0.12);
      o.connect(hp); hp.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.2);
    } else if (form === 'angler') {
      const o = this.ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      const g = this._env(o, t, 0.22, 0.004, 0.18);
      g.connect(this.sfxGain); o.start(t); o.stop(t + 0.28);
    } else {
      [880, 1320].forEach((f, i) => {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = this._env(o, t + i * 0.02, 0.1, 0.005, 0.16);
        g.connect(this.sfxGain); g.connect(this.reverb);
        o.start(t + i * 0.02); o.stop(t + 0.24);
      });
    }
  }

  hit() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this._noise(0.12);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
    const g = this._env(n, t, 0.18, 0.003, 0.1);
    n.connect(bp); bp.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + 0.14);
  }

  enemyDie() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const g = this._env(o, t, 0.2, 0.005, 0.32);
    g.connect(this.sfxGain); g.connect(this.reverb);
    o.start(t); o.stop(t + 0.4);
  }

  powerup() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this._env(o, t + i * 0.06, 0.18, 0.005, 0.3);
      g.connect(this.sfxGain); g.connect(this.reverb);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.4);
    });
  }

  bossRoar() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(48, t + 1.6);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(1200, t + 0.6);
    lp.frequency.linearRampToValueAtTime(200, t + 1.8);
    const g = this._env(o, t, 0.4, 0.1, 1.9);
    o.connect(lp); lp.connect(g); g.connect(this.sfxGain); g.connect(this.reverb);
    o.start(t); o.stop(t + 2.1);
  }

  bossHit() {
    if (!this.ensure()) return; this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const g = this._env(o, t, 0.16, 0.004, 0.12);
    g.connect(this.sfxGain); o.start(t); o.stop(t + 0.18);
  }

  win() {
    if (!this.ensure()) return; this.resume();
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.5, 'triangle', 0.22), i * 130));
  }

  ping() { this.blip(1046, 0.6, 'sine', 0.2); setTimeout(() => this.blip(1568, 0.4, 'sine', 0.1), 90); }
}

function rnd(a, b) { return a + Math.random() * (b - a); }
