// Tiny synthesized sound engine: every effect is built from filtered noise bursts and swept oscillators,
// pushed through a low-pass for a crunchy low-sample-rate feel. Includes a generative dark ambient bed.
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private nbuf!: AudioBuffer;
  private last: Record<string, number> = {};
  private ambTimer = 0;
  lx = 0; ly = 0; lz = 0; lyaw = 0;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
    const n = ctx.sampleRate * 2;
    this.nbuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.nbuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.ambient();
  }
  dispose() {
    window.clearTimeout(this.ambTimer);
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
  listener(x: number, y: number, z: number, yaw: number) { this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; }

  private dest(x?: number, y?: number, z?: number, vol = 1): AudioNode | null {
    const ctx = this.ctx!;
    let v = vol, pan = 0;
    if (x !== undefined && y !== undefined && z !== undefined) {
      const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      const a = Math.max(0, 1 - d / 1500);
      v *= a * a;
      if (v < 0.004) return null;
      if (d > 1) pan = ((dx * Math.cos(this.lyaw) - dz * Math.sin(this.lyaw)) / d) * 0.8;
    }
    const g = ctx.createGain();
    g.gain.value = v;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  private noise(out: AudioNode, t0: number, dur: number, f0: number, f1: number, vol: number, type: BiquadFilterType = 'lowpass', q = 1) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.nbuf; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.02);
  }
  private tone(out: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private ambient() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.085;
    g.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 170;
    lp.connect(g);
    for (const f of [36.7, 37.15, 55.3]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 70;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    const s = ctx.createBufferSource();
    s.buffer = this.nbuf; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 330; bp.Q.value = 1.4;
    const wg = ctx.createGain(); wg.gain.value = 0.045;
    const l2 = ctx.createOscillator(); l2.frequency.value = 0.11;
    const l2g = ctx.createGain(); l2g.gain.value = 150;
    l2.connect(l2g); l2g.connect(bp.frequency); l2.start();
    s.connect(bp); bp.connect(wg); wg.connect(this.master); s.start();
    const sched = () => {
      if (this.ctx && ctx.state === 'running') {
        const t = ctx.currentTime + 0.1;
        const d = this.dest(undefined, undefined, undefined, 0.09 + Math.random() * 0.09);
        if (d) {
          const f = 55 + Math.random() * 120;
          this.tone(d, t, 2.8, 'triangle', f, f * 0.6, 0.5);
          this.tone(d, t, 2.8, 'sine', f * 2.02, f * 1.1, 0.2);
          if (Math.random() < 0.4) this.noise(d, t, 1.6, 900, 200, 0.25, 'bandpass', 6);
        }
      }
      this.ambTimer = window.setTimeout(sched, 5000 + Math.random() * 9000);
    };
    sched();
  }

  play(name: string, x?: number, y?: number, z?: number, vol = 1, p = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.last[name] !== undefined && now - this.last[name] < 0.035) return;
    this.last[name] = now;
    const o = this.dest(x, y, z, vol);
    if (!o) return;
    const n = (dur: number, f0: number, f1: number, v: number, type: BiquadFilterType = 'lowpass', q = 1, delay = 0) => this.noise(o, now + delay, dur, f0, f1, v, type, q);
    const s = (type: OscillatorType, dur: number, f0: number, f1: number, v: number, delay = 0) => this.tone(o, now + delay, dur, type, f0, f1, v);
    switch (name) {
      case 'shotgun': n(0.28, 3200, 260, 1.0); s('sine', 0.2, 150 * p, 38, 0.9); n(0.06, 6000, 3000, 0.4, 'highpass'); break;
      case 'ssg': n(0.4, 2600, 180, 1.2); n(0.35, 2200, 160, 0.9, 'lowpass', 1, 0.025); s('sine', 0.32, 120, 30, 1.1); break;
      case 'nail': n(0.07, 4200, 1800, 0.5, 'bandpass', 2); s('square', 0.05, 820 * p, 300, 0.14); break;
      case 'rocket': n(0.5, 900, 180, 0.8); s('sawtooth', 0.35, 220, 55, 0.25); break;
      case 'explode': n(1.0, 1900, 70, 1.5); s('sine', 0.8, 95, 24, 1.3); n(0.25, 5000, 800, 0.5, 'highpass'); break;
      case 'axe': case 'swing': n(0.15, 1400 * p, 450, 0.35, 'bandpass', 1.5); break;
      case 'tink': s('triangle', 0.06, 1900 * p, 1100, 0.18); n(0.04, 5000, 3000, 0.15, 'highpass'); break;
      case 'flesh': n(0.09, 900, 300, 0.5, 'bandpass', 2); s('sine', 0.08, 140, 60, 0.4); break;
      case 'pickup': s('square', 0.07, 520, 520, 0.16); s('square', 0.1, 780, 780, 0.16, 0.07); break;
      case 'weapon': s('sawtooth', 0.18, 196, 392, 0.22); n(0.06, 3000, 1500, 0.3, 'bandpass', 3); s('square', 0.12, 588, 588, 0.12, 0.16); break;
      case 'health': s('sine', 0.16, 620, 930, 0.3); s('sine', 0.2, 930, 1240, 0.25, 0.1); break;
      case 'armor': s('triangle', 0.12, 330, 330, 0.35); s('triangle', 0.2, 440, 440, 0.35, 0.1); n(0.1, 2500, 1500, 0.2, 'bandpass', 4); break;
      case 'key': [660, 880, 990, 1320].forEach((f, i) => s('square', 0.1, f, f, 0.14, i * 0.08)); break;
      case 'power': s('sawtooth', 0.9, 90, 720, 0.3); s('sine', 0.9, 180, 1440, 0.25); n(0.9, 300, 4000, 0.2, 'bandpass', 5); break;
      case 'door': n(0.55, 260, 180, 0.6); s('sawtooth', 0.55, 62, 48, 0.25); break;
      case 'doorstop': s('square', 0.1, 72, 40, 0.4); n(0.07, 900, 300, 0.4); break;
      case 'locked': s('square', 0.07, 115, 110, 0.3); s('square', 0.09, 95, 90, 0.3, 0.1); break;
      case 'secret': [523, 659, 784, 1047].forEach((f, i) => s('triangle', 0.22, f, f, 0.25, i * 0.09)); break;
      case 'jump': s('sawtooth', 0.11, 150, 235, 0.14); n(0.05, 600, 300, 0.1); break;
      case 'land': n(0.12, 320, 90, 0.6); s('sine', 0.1, 90, 45, 0.5); break;
      case 'pain': s('sawtooth', 0.26, 230 * p, 115, 0.4); n(0.12, 1200, 500, 0.2, 'bandpass', 2); break;
      case 'death': s('sawtooth', 1.0, 210, 48, 0.5); n(0.6, 900, 150, 0.3); break;
      case 'msight': s('sawtooth', 0.5, 85 * p, 150 * p, 0.4); s('sawtooth', 0.35, 150 * p, 70 * p, 0.35, 0.3); n(0.6, 700 * p, 300 * p, 0.3, 'bandpass', 3); break;
      case 'mpain': s('sawtooth', 0.22, 170 * p, 85 * p, 0.4); n(0.15, 1000 * p, 400, 0.2, 'bandpass', 2); break;
      case 'mdeath': s('sawtooth', 0.7, 140 * p, 36 * p, 0.5); n(0.5, 800, 120, 0.4); break;
      case 'gib': n(0.35, 700, 120, 1.0, 'bandpass', 1.2); s('sine', 0.25, 85, 36, 0.8); n(0.2, 2400, 600, 0.3, 'bandpass', 3, 0.05); break;
      case 'tele': s('sine', 0.55, 190, 1300, 0.3); n(0.55, 400, 5000, 0.3, 'bandpass', 4); break;
      case 'bolt': n(0.45, 2500, 6000, 0.9, 'highpass'); s('square', 0.4, 52, 48, 0.4); n(0.3, 300, 100, 0.7); break;
      case 'charge': s('sawtooth', 0.7, 70, 420, 0.3); n(0.7, 500, 3500, 0.2, 'bandpass', 6); break;
      case 'spit': s('sine', 0.22, 640, 180, 0.3); n(0.15, 1500, 500, 0.25, 'bandpass', 3); break;
      case 'bounce': s('triangle', 0.06, 300, 190, 0.35); break;
      case 'burn': n(0.3, 2200, 500, 0.5, 'bandpass', 1.5); break;
      case 'splash': n(0.35, 900, 300, 0.5, 'bandpass', 1.2); break;
      case 'menu1': s('square', 0.04, 300, 300, 0.15); break;
      case 'menu2': s('square', 0.13, 200, 520, 0.2); break;
      case 'empty': s('square', 0.03, 180, 160, 0.2); break;
    }
  }
}
