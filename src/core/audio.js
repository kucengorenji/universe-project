// Procedural sound for the whole app: Web Audio only, no sample files.
//   ambience  a bed per scene (space drone, planet wind, town wind + birds or
//             crickets + city hum, a quiet room indoors), crossfaded
//   music     a slow generative pad whose chords follow the scene
//   voices    continuous engines (car, rover, ship) and tyre skid, driven
//             every frame by the mode; they fade out on their own when a mode
//             stops feeding them
//   sfx       one-shots: steps, doors, switches, pick up / put down, whooshes
//   radio/tv  diegetic loops inside houses
// Browsers only allow audio after a gesture, so the context starts on the
// first click or key press. Everything before that is a silent no-op.

const PREF_KEY = 'planet_globe_audio';
const DEFAULTS = { master: 0.8, music: 0.45, sfx: 0.9, muted: false };

// Chord sets per scene (MIDI notes); the pad walks through them slowly
const CHORDS = {
  space: [
    [45, 52, 59, 64, 71],
    [41, 48, 55, 60, 67],
    [43, 50, 57, 62, 69],
    [40, 47, 55, 59, 66]
  ],
  planet: [
    [48, 55, 62, 64, 71],
    [45, 52, 59, 60, 67],
    [41, 48, 57, 60, 64],
    [43, 50, 59, 62, 67]
  ],
  town: [
    [48, 55, 60, 64, 67],
    [45, 52, 57, 60, 64],
    [41, 48, 53, 57, 60],
    [43, 50, 55, 59, 62]
  ]
};
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.settings = { ...DEFAULTS, ...this.load() };
    this.ctx = null;
    this.voices = {};
    this.scene = null;
    this.night = 0;
    this.paused = false;
    this.listeners = new Set();
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => this.applySuspend());
    // A soft tick on every button: the UI feels physical
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('button')) this.ui('click');
    });
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    } catch {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.settings));
    } catch {
      /* optional */
    }
  }

  /** Change master / music / sfx (0..1) or muted, and persist. */
  set(key, value) {
    this.settings[key] = value;
    this.save();
    this.applyLevels();
    this.listeners.forEach((fn) => fn(this.settings));
  }

  toggleMute() {
    this.set('muted', !this.settings.muted);
  }

  setPaused(p) {
    this.paused = p;
    this.applySuspend();
  }

  applySuspend() {
    if (!this.ctx) return;
    if (document.hidden || this.paused) this.ctx.suspend();
    else this.ctx.resume();
  }

  // ------------------------------------------------------------------ graph

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.bus = {};
    for (const k of ['amb', 'music', 'sfx']) {
      this.bus[k] = ctx.createGain();
      this.bus[k].connect(this.master);
    }
    // A cheap room: feedback delay for the pad and the radio
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    tone.connect(this.bus.music);
    this.noise = this.makeNoise('white');
    this.brown = this.makeNoise('brown');
    this.applyLevels();
    this.applySuspend();
    if (this.scene) {
      const s = this.scene;
      this.scene = null;
      this.setScene(s);
    }
  }

  applyLevels() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.bus.amb.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
    this.bus.music.gain.setTargetAtTime(s.music * (this.radioOn ? 0.25 : 1), t, 0.3);
  }

  makeNoise(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  noiseSource(brown = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.5);
    return src;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  // ------------------------------------------------------------------ ambience + music

  /** Scene bed: 'space' | 'planet' | 'town' | 'interior' | null. */
  setScene(kind, { modern = true } = {}) {
    if (kind === this.scene) return;
    this.scene = kind;
    this.modern = modern;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Fade the old bed out and drop it
    if (this.bed) {
      const old = this.bed;
      old.out.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => old.stop(), 3000);
      this.bed = null;
    }
    if (kind) this.bed = this.makeBed(kind);
    this.nextChord = t + 0.5;
    this.chordIndex = 0;
  }

  makeBed(kind) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.gain(0);
    out.connect(this.bus.amb);
    const nodes = [];
    const keep = (...n) => nodes.push(...n);
    const bed = { out, kind, stop: () => nodes.forEach((n) => n.stop?.()) };
    if (kind === 'space') {
      // Deep drone with a slow breathing filter
      const lp = this.filter('lowpass', 420, 1.2);
      lp.connect(out);
      for (const [f, v] of [[55, 0.5], [82.6, 0.3], [110.4, 0.18], [164.5, 0.08]]) {
        const o = this.osc('sine', f);
        const g = this.gain(v);
        o.connect(g).connect(lp);
        keep(o);
      }
      const lfo = this.osc('sine', 0.05);
      const depth = this.gain(220);
      lfo.connect(depth).connect(lp.frequency);
      const hiss = this.noiseSource();
      const hp = this.filter('bandpass', 5200, 0.8);
      const hg = this.gain(0.012);
      hiss.connect(hp).connect(hg).connect(out);
      keep(lfo, hiss);
      out.gain.setTargetAtTime(0.16, t, 1.2);
    } else if (kind === 'planet' || kind === 'town' || kind === 'interior') {
      // Wind: noise through a wandering band-pass
      const wind = this.noiseSource();
      const bp = this.filter('bandpass', 420, 0.6);
      const wg = this.gain(kind === 'planet' ? 0.5 : kind === 'town' ? 0.22 : 0.05);
      wind.connect(bp).connect(wg).connect(out);
      const lfo = this.osc('sine', 0.07);
      const depth = this.gain(260);
      lfo.connect(depth).connect(bp.frequency);
      const lfo2 = this.osc('sine', 0.11);
      const d2 = this.gain(0.15);
      lfo2.connect(d2).connect(wg.gain);
      keep(wind, lfo, lfo2);
      if (kind !== 'planet') {
        // City hum (modern) or a low room tone
        const hum = this.noiseSource(true);
        const lp = this.filter('lowpass', kind === 'interior' ? 140 : 190, 0.7);
        const hg = this.gain(kind === 'interior' ? 0.35 : this.modern ? 0.5 : 0.18);
        hum.connect(lp).connect(hg).connect(out);
        keep(hum);
      }
      bed.birds = kind === 'town';
      out.gain.setTargetAtTime(kind === 'interior' ? 0.12 : 0.2, t, 1.2);
    }
    bed.nextCritter = t + 1;
    return bed;
  }

  /** 0 day .. 1 night: birds by day, crickets at night. */
  setNight(n) {
    this.night = n;
  }

  critter(bed, t) {
    const ctx = this.ctx;
    if (this.night > 0.5) {
      // Cricket: a pulsed high tone, a few chirps
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 4200 + Math.random() * 600;
      const g = this.gain(0);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(pan).connect(bed.out);
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const s = t + i * 0.09;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.05, s + 0.01);
        g.gain.linearRampToValueAtTime(0, s + 0.05);
      }
      o.start(t);
      o.stop(t + n * 0.09 + 0.1);
      return t + 0.4 + Math.random() * 1.6;
    }
    // Bird: two to four falling or rising chirps
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(bed.out);
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.11 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = this.gain(0);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), s);
      o.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 0.7 : 1.35), s + 0.08);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.06, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.12);
    }
    return t + 1.5 + Math.random() * 4;
  }

  /** One chord of the pad: soft attack, long release, into the echo. */
  padChord(notes, t, dur) {
    const ctx = this.ctx;
    const out = this.gain(0);
    const lp = this.filter('lowpass', this.scene === 'space' ? 1400 : 1100, 0.5);
    out.connect(lp);
    lp.connect(this.bus.music);
    lp.connect(this.echo);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.05, t + dur * 0.35);
    out.gain.setValueAtTime(0.05, t + dur * 0.7);
    out.gain.linearRampToValueAtTime(0, t + dur * 1.25);
    notes.forEach((n, i) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const g = this.gain(i === 0 ? 0.7 : 0.35 / (1 + i * 0.3));
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur * 1.3);
      }
    });
    // A sparse bell on top, sometimes
    if (Math.random() < 0.6) {
      const s = t + dur * (0.2 + Math.random() * 0.4);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(notes[notes.length - 1] + 12 + [0, 2, 7][Math.floor(Math.random() * 3)]);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.025, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 2.5);
      o.connect(g);
      g.connect(this.bus.music);
      g.connect(this.echo);
      o.start(s);
      o.stop(s + 2.6);
    }
  }

  // ------------------------------------------------------------------ continuous voices

  /**
   * Feed a continuous voice this frame. kind: 'car' | 'rover' | 'ship'.
   * p: { speed01, throttle, rpm (car), skid, boost }
   */
  engine(kind, p) {
    if (!this.ctx) return;
    let v = this.voices[kind];
    if (!v) v = this.voices[kind] = this.makeVoice(kind);
    v.fed = this.ctx.currentTime;
    v.set(p);
  }

  makeVoice(kind) {
    const out = this.gain(0);
    out.connect(this.bus.sfx);
    const nodes = [];
    const t0 = this.ctx.currentTime;
    const v = { out, level: 0, stop: () => nodes.forEach((n) => n.stop?.()) };
    if (kind === 'ship') {
      const lp = this.filter('lowpass', 300, 0.8);
      lp.connect(out);
      const hum1 = this.osc('sawtooth', 46);
      const hum2 = this.osc('sine', 69.3);
      const g1 = this.gain(0.18);
      const g2 = this.gain(0.4);
      hum1.connect(g1).connect(lp);
      hum2.connect(g2).connect(lp);
      const roar = this.noiseSource(true);
      const rf = this.filter('lowpass', 400, 0.5);
      const rg = this.gain(0.5);
      roar.connect(rf).connect(rg).connect(out);
      const hiss = this.noiseSource();
      const hf = this.filter('bandpass', 1800, 1.2);
      const hg = this.gain(0);
      hiss.connect(hf).connect(hg).connect(out);
      nodes.push(hum1, hum2, roar, hiss);
      v.set = ({ speed01 = 0, throttle = 0, boost = 0 }) => {
        const t = this.ctx.currentTime;
        lp.frequency.setTargetAtTime(220 + speed01 * 900 + throttle * 400, t, 0.1);
        hum1.frequency.setTargetAtTime(42 + speed01 * 30 + boost * 20, t, 0.2);
        rf.frequency.setTargetAtTime(250 + throttle * 900 + boost * 1400, t, 0.1);
        hg.gain.setTargetAtTime(boost * 0.12, t, 0.15);
        hf.frequency.setTargetAtTime(1200 + boost * 1600, t, 0.2);
        v.level = 0.1 + throttle * 0.12 + speed01 * 0.06 + boost * 0.08;
      };
    } else {
      // Car / rover: two detuned saws and a sub through a throttle-opened low-pass
      const lp = this.filter('lowpass', 400, 2);
      lp.connect(out);
      const a = this.osc('sawtooth', 40);
      const b = this.osc('sawtooth', 40);
      b.detune.value = 14;
      const sub = this.osc(kind === 'rover' ? 'sine' : 'square', 20);
      const ga = this.gain(0.35);
      const gb = this.gain(0.25);
      const gs = this.gain(kind === 'rover' ? 0.5 : 0.22);
      a.connect(ga).connect(lp);
      b.connect(gb).connect(lp);
      sub.connect(gs).connect(lp);
      // Electric whine for the rover
      const whine = kind === 'rover' ? this.osc('sine', 300) : null;
      const gw = this.gain(0);
      if (whine) whine.connect(gw).connect(out);
      // Tyres
      const tyre = this.noiseSource();
      const tf = this.filter('bandpass', 1500, 2.5);
      const tg = this.gain(0);
      tyre.connect(tf).connect(tg).connect(this.bus.sfx);
      const road = this.noiseSource(true);
      const rf = this.filter('lowpass', 260, 0.5);
      const rg = this.gain(0);
      road.connect(rf).connect(rg).connect(out);
      nodes.push(a, b, sub, tyre, road);
      if (whine) nodes.push(whine);
      const base = kind === 'rover' ? 28 : 34;
      v.set = ({ speed01 = 0, throttle = 0, rpm = 0.2, skid = 0 }) => {
        const t = this.ctx.currentTime;
        const f = base + rpm * (kind === 'rover' ? 60 : 105);
        a.frequency.setTargetAtTime(f, t, 0.05);
        b.frequency.setTargetAtTime(f, t, 0.05);
        sub.frequency.setTargetAtTime(f / 2, t, 0.05);
        lp.frequency.setTargetAtTime(260 + throttle * 1300 + rpm * 500, t, 0.06);
        if (whine) {
          whine.frequency.setTargetAtTime(220 + speed01 * 900, t, 0.1);
          gw.gain.setTargetAtTime(0.02 + speed01 * 0.05, t, 0.1);
        }
        tg.gain.setTargetAtTime(skid * 0.22, t, 0.05);
        tf.frequency.setTargetAtTime(1100 + speed01 * 900, t, 0.1);
        rg.gain.setTargetAtTime(speed01 * 0.8, t, 0.1);
        v.level = 0.07 + throttle * 0.08 + rpm * 0.05;
        v.tyreGain = tg;
      };
    }
    out.gain.setValueAtTime(0, t0);
    return v;
  }

  /** Per frame: level the voices, fade the unfed ones, schedule critters and chords. */
  update() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    for (const [k, v] of Object.entries(this.voices)) {
      const fed = t - v.fed < 0.25;
      v.out.gain.setTargetAtTime(fed ? v.level : 0, t, fed ? 0.08 : 0.25);
      if (!fed) v.tyreGain?.gain.setTargetAtTime(0, t, 0.1);
      if (t - v.fed > 3) {
        v.stop();
        delete this.voices[k];
      }
    }
    const bed = this.bed;
    if (bed?.birds && t > bed.nextCritter) bed.nextCritter = this.critter(bed, t + 0.05);
    // Pad chords (the scene picks the set; interiors keep the town's)
    const set = CHORDS[this.scene === 'interior' ? 'town' : this.scene];
    if (set && t > this.nextChord - 0.2 && this.settings.music > 0) {
      const dur = this.scene === 'space' ? 9 : 7;
      this.padChord(set[this.chordIndex % set.length], Math.max(t, this.nextChord), dur);
      this.chordIndex++;
      this.nextChord = Math.max(t, this.nextChord) + dur;
    }
    if (this.radioOn) this.scheduleRadio(t);
  }

  // ------------------------------------------------------------------ one-shots

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  burst({ type = 'lowpass', freq = 800, q = 0.8, peak = 0.3, a = 0.004, d = 0.1, brown = false, sweep = null, at = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    const f = this.filter(type, freq, q);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + a + d);
    const g = this.gain(0);
    src.connect(f).connect(g).connect(this.bus.sfx);
    this.env(g, t, a, peak, d);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + d + 0.05);
  }

  tone({ type = 'sine', freq = 440, to = null, peak = 0.2, a = 0.005, d = 0.15, at = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    const g = this.gain(0);
    o.connect(g).connect(this.bus.sfx);
    this.env(g, t, a, peak, d);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  /** Named one-shots. */
  sfx(name, opt = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const r = Math.random();
    switch (name) {
      case 'step': {
        const soft = opt.surface === 'grass';
        const wood = opt.surface === 'wood';
        this.burst({ freq: soft ? 700 : wood ? 900 : 1500 + r * 500, q: wood ? 2 : 0.7, peak: (soft ? 0.12 : 0.16) * (opt.run ? 1.3 : 1), d: soft ? 0.09 : 0.06 });
        if (wood) this.tone({ freq: 140 + r * 30, peak: 0.06, d: 0.06 });
        break;
      }
      case 'door':
        // Creak, then a soft knock at the end
        this.tone({ type: 'sawtooth', freq: 190 + r * 40, to: 120, peak: 0.035, a: 0.05, d: 0.45 });
        this.burst({ freq: 300, peak: 0.2, d: 0.12, brown: true, at: 0.4 });
        break;
      case 'switch':
        this.tone({ type: 'square', freq: 2400, peak: 0.05, d: 0.02 });
        this.burst({ type: 'highpass', freq: 3000, peak: 0.12, d: 0.025 });
        break;
      case 'pickup':
        this.tone({ freq: 520, to: 880, peak: 0.1, d: 0.1 });
        this.tone({ freq: 880, peak: 0.06, d: 0.12, at: 0.07 });
        break;
      case 'drop':
        this.burst({ freq: 400, peak: 0.3, d: 0.1, brown: true });
        this.tone({ freq: 160, to: 90, peak: 0.12, d: 0.1 });
        break;
      case 'sit':
        this.burst({ freq: 250, peak: 0.25, d: 0.18, brown: true });
        break;
      case 'carDoor':
        this.burst({ freq: 420, peak: 0.45, d: 0.12, brown: true });
        this.tone({ freq: 90, to: 60, peak: 0.25, d: 0.12 });
        this.burst({ type: 'highpass', freq: 2500, peak: 0.05, d: 0.04, at: 0.02 });
        break;
      case 'ignition':
        this.tone({ type: 'sawtooth', freq: 30, to: 70, peak: 0.12, a: 0.05, d: 0.5 });
        this.burst({ freq: 200, peak: 0.25, d: 0.5, brown: true });
        break;
      case 'hit':
        this.burst({ freq: 600, peak: Math.min(0.6, 0.15 + (opt.strength || 0.5) * 0.4), d: 0.18, brown: true });
        this.burst({ type: 'bandpass', freq: 2200, q: 1.5, peak: 0.12 * (opt.strength || 0.5), d: 0.25, at: 0.01 });
        break;
      case 'whoosh':
        this.burst({ type: 'bandpass', freq: 300, q: 0.8, peak: opt.peak || 0.35, a: (opt.dur || 1.4) * 0.45, d: (opt.dur || 1.4) * 0.55, sweep: 2200 });
        break;
      case 'land':
        this.burst({ type: 'bandpass', freq: 2400, q: 0.6, peak: 0.4, a: 0.6, d: 1.6, sweep: 180 });
        this.burst({ freq: 180, peak: 0.35, a: 0.5, d: 1.4, brown: true });
        break;
      case 'clunk':
        this.burst({ freq: 900, peak: 0.3, d: 0.08 });
        this.tone({ type: 'square', freq: 110, to: 70, peak: 0.1, d: 0.15, at: 0.05 });
        this.burst({ freq: 500, peak: 0.25, d: 0.1, brown: true, at: 0.2 });
        break;
      case 'jump':
        this.burst({ freq: 900, peak: 0.08, d: 0.06 });
        break;
      case 'tick':
        this.tone({ freq: 1320, peak: 0.07, d: 0.08 });
        this.tone({ freq: 1760, peak: 0.06, d: 0.12, at: 0.07 });
        break;
      default:
        break;
    }
  }

  ui(kind) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (kind === 'click') this.tone({ type: 'triangle', freq: 1800, peak: 0.035, d: 0.03 });
  }

  /** A short brass-ish arpeggio for finished missions. */
  fanfare() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = this.gain(0);
      o.type = 'sawtooth';
      o.frequency.value = f;
      const t = now + i * 0.13;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.9 : 0.25));
      const lp = this.filter('lowpass', 2400);
      o.connect(lp).connect(g).connect(this.bus.sfx);
      g.connect(this.echo);
      o.start(t);
      o.stop(t + 1);
    });
  }

  // ------------------------------------------------------------------ radio, tv, fire

  /** Lo-fi radio: drums, bass and chords, scheduled a bar ahead. */
  radio(on) {
    this.radioOn = on;
    if (!this.ctx) return;
    if (on) {
      this.radioBar = this.ctx.currentTime + 0.1;
      this.radioN = 0;
      this.radioOut = this.gain(0.9);
      const band = this.filter('bandpass', 1400, 0.4); // small speaker
      this.radioOut.connect(band).connect(this.bus.sfx);
      band.connect(this.echo);
    } else if (this.radioOut) {
      const o = this.radioOut;
      o.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => o.disconnect(), 400);
      this.radioOut = null;
    }
    this.applyLevels();
  }

  scheduleRadio(t) {
    if (!this.radioOut || t < this.radioBar - 0.5) return;
    const ctx = this.ctx;
    const beat = 60 / 84;
    const bar = this.radioBar;
    const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
    const ch = prog[this.radioN % 4];
    const out = this.radioOut;
    const hit = (time, fn) => fn(time);
    for (let b = 0; b < 4; b++) {
      const s = bar + b * beat;
      // Kick on 1 and 3, snare on 2 and 4, hats on eighths
      if (b % 2 === 0)
        hit(s, (tt) => {
          const o = ctx.createOscillator();
          const g = this.gain(0);
          o.frequency.setValueAtTime(120, tt);
          o.frequency.exponentialRampToValueAtTime(45, tt + 0.12);
          this.env(g, tt, 0.003, 0.5, 0.18);
          o.connect(g).connect(out);
          o.start(tt);
          o.stop(tt + 0.25);
        });
      else
        hit(s, (tt) => {
          const n = ctx.createBufferSource();
          n.buffer = this.noise;
          const f = this.filter('bandpass', 1800, 0.7);
          const g = this.gain(0);
          this.env(g, tt, 0.002, 0.25, 0.12);
          n.connect(f).connect(g).connect(out);
          n.start(tt, Math.random());
          n.stop(tt + 0.2);
        });
      for (const e of [0, 0.5]) {
        const tt = s + e * beat + (e ? 0.03 : 0); // a little swing
        const n = ctx.createBufferSource();
        n.buffer = this.noise;
        const f = this.filter('highpass', 7000, 0.7);
        const g = this.gain(0);
        this.env(g, tt, 0.001, 0.06, 0.04);
        n.connect(f).connect(g).connect(out);
        n.start(tt, Math.random());
        n.stop(tt + 0.08);
      }
      // Bass on the root
      const bo = ctx.createOscillator();
      bo.type = 'triangle';
      bo.frequency.value = midi(ch[0] - 24 + (b === 3 ? 7 : 0));
      const bg = this.gain(0);
      this.env(bg, s, 0.01, 0.28, beat * 0.8);
      bo.connect(bg).connect(out);
      bo.start(s);
      bo.stop(s + beat);
    }
    // Chord stabs
    for (const at of [0.5, 2.5]) {
      const s = bar + at * beat;
      const lp = this.filter('lowpass', 1600, 1);
      const g = this.gain(0);
      this.env(g, s, 0.01, 0.07, beat * 1.2);
      lp.connect(g).connect(out);
      ch.forEach((n) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = midi(n);
        o.connect(lp);
        o.start(s);
        o.stop(s + beat * 1.4);
      });
    }
    this.radioN++;
    this.radioBar += beat * 4;
  }

  /** TV: murmuring voices (band-passed noise with a syllable rhythm). */
  tv(on) {
    if (!this.ctx) return;
    if (on && !this.tvVoice) {
      const src = this.noiseSource();
      const f = this.filter('bandpass', 700, 2.5);
      const g = this.gain(0);
      const lfo = this.osc('square', 4.3);
      const lg = this.gain(0.05);
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.bus.sfx);
      const wobble = this.osc('sine', 0.7);
      const wg = this.gain(260);
      wobble.connect(wg).connect(f.frequency);
      g.gain.value = 0.06;
      this.tvVoice = { stop: () => [src, lfo, wobble].forEach((n) => n.stop()), g };
    } else if (!on && this.tvVoice) {
      this.tvVoice.stop();
      this.tvVoice = null;
    }
  }

  /** Fireplace: a low roar and random crackles. */
  fire(on) {
    if (!this.ctx) return;
    if (on && !this.fireVoice) {
      const src = this.noiseSource(true);
      const f = this.filter('lowpass', 500, 0.5);
      const g = this.gain(0.35);
      src.connect(f).connect(g).connect(this.bus.sfx);
      const timer = setInterval(() => {
        if (this.ctx.state !== 'running') return;
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.burst({ type: 'highpass', freq: 1500 + Math.random() * 3000, peak: 0.04 + Math.random() * 0.1, d: 0.02, at: Math.random() * 0.2 });
      }, 260);
      this.fireVoice = { stop: () => (src.stop(), clearInterval(timer)) };
    } else if (!on && this.fireVoice) {
      this.fireVoice.stop();
      this.fireVoice = null;
    }
  }

  /** Leaving a house: silence what lives in it. */
  stopRoom() {
    this.radio(false);
    this.tv(false);
    this.fire(false);
  }
}
