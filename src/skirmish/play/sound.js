// Small synthesised combat sounds (Web Audio): rifle cracks, SMG rattles, the lance's whoosh and
// blasts, all from one noise buffer, quieter with distance from the camera.

const VOICES = {
  rifle: { len: 0.18, freq: 1800, q: 0.7, gain: 0.5 },
  rifle_eng: { len: 0.18, freq: 1700, q: 0.7, gain: 0.45 },
  smg: { len: 0.08, freq: 2200, q: 0.9, gain: 0.32 },
  sniper: { len: 0.35, freq: 1200, q: 0.6, gain: 0.7 },
  lance: { len: 0.6, freq: 500, q: 0.5, gain: 0.8 },
  tank_cannon: { len: 0.9, freq: 300, q: 0.5, gain: 1 },
  tank_mg: { len: 0.07, freq: 1500, q: 0.9, gain: 0.3 },
  bunker_mg: { len: 0.07, freq: 1400, q: 0.9, gain: 0.35 }
};

export class Sound {
  constructor(camera) {
    this.camera = camera;
    this.ctx = null;
  }

  /** Browsers start audio only after a gesture: call from a click. */
  unlock() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const n = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  shot(weapon, at) {
    const ctx = this.ctx;
    const v = VOICES[weapon];
    if (!ctx || !v) return;
    const d = Math.hypot(at.x - this.camera.position.x, at.y - this.camera.position.y, at.z - this.camera.position.z);
    const vol = v.gain / (1 + d * 0.06);
    if (vol < 0.01) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(v.freq * (1 / (1 + d * 0.01)), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, v.freq * 0.15), t + v.len);
    f.Q.value = v.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.len);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, v.len + 0.05);
    // the punch: a short low thump under the crack, and a faint tail for distance
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(v.freq > 1000 ? 140 : 70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
    const tail = ctx.createBufferSource();
    tail.buffer = this.noise;
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 600;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.linearRampToValueAtTime(vol * 0.12, t + 0.05);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + v.len);
    tail.connect(tf).connect(tg).connect(this.master);
    tail.start(t, Math.random() * 0.5, 0.8 + v.len);
  }
}
