// 程序化音效：全部实时合成，无需音频素材。

const PENTATONIC = [0, 2, 4, 7, 9]; // 宫商角徵羽

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private ambientTimer: number | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private pluckCache = new Map<string, AudioBuffer>();
  sfxOn = true;
  musicOn = true;

  /** 浏览器要求用户手势后才能启动音频。 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.55 : 0;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.startAmbient();
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.3);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return buffer;
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private out(bus: 'sfx' | 'music', wet = 0.3): AudioNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.connect(bus === 'sfx' ? this.sfx : this.music);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      gain.connect(send);
      send.connect(this.reverbSend);
    }
    return gain;
  }

  /** 木质棋子落盘声。 */
  clack(strength = 1, pitch = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dest = this.out('sfx', 0.18);
    // 敲击噪声
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.12);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200 * pitch;
    band.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.9 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    noise.connect(band).connect(ng).connect(dest);
    noise.start(t);
    // 木腔共鸣
    for (const [f, a, d] of [[720, 0.55, 0.12], [1180, 0.3, 0.08], [310, 0.35, 0.16]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * pitch * (0.97 + Math.random() * 0.06), t);
      osc.frequency.exponentialRampToValueAtTime(f * pitch * 0.92, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(a * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
  }

  /** 衣袖拂过的风声（走子）。 */
  whoosh(duration = 0.45): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(duration + 0.1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + duration * 0.6);
    filter.frequency.exponentialRampToValueAtTime(600, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + duration * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.out('sfx', 0.2));
    src.start(t);
  }

  /** Karplus-Strong 拨弦（古筝感）。 */
  private pluckBuffer(freq: number, seconds: number, brightness: number): AudioBuffer {
    const key = `${freq.toFixed(1)}:${seconds}:${brightness}`;
    const cached = this.pluckCache.get(key);
    if (cached) return cached;
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    const period = Math.floor(rate / freq);
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    for (let i = 0; i < data.length; i++) {
      const j = i % period;
      const v = ring[j];
      const averaged = 0.5 * (v + ring[(j + 1) % period]);
      ring[j] = 0.997 * (brightness * averaged + (1 - brightness) * (0.5 * (averaged + v)));
      data[i] = v * 0.6;
    }
    this.pluckCache.set(key, buffer);
    return buffer;
  }

  pluck(semitone: number, options: { gain?: number; delay?: number; bus?: 'sfx' | 'music'; bend?: boolean } = {}): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const freq = 293.66 * Math.pow(2, semitone / 12); // D4 为宫
    const t = ctx.currentTime + (options.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq, 2.6, 0.62);
    if (options.bend) {
      // 古筝的按音：先低后滑上
      src.playbackRate.setValueAtTime(0.94, t);
      src.playbackRate.linearRampToValueAtTime(1, t + 0.18);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(options.gain ?? 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    src.connect(g).connect(this.out(options.bus ?? 'sfx', 0.45));
    src.start(t);
  }

  private scaleNote(step: number): number {
    const octave = Math.floor(step / 5);
    return PENTATONIC[((step % 5) + 5) % 5] + octave * 12;
  }

  /** 翻面：上行琶音；倒戈：下行带滑音。 */
  reveal(switched: boolean): void {
    if (!this.ctx) return;
    const steps = switched ? [7, 5, 3, 1] : [3, 5, 7, 9];
    steps.forEach((s, i) => this.pluck(this.scaleNote(s) - (switched ? 12 : 0), { delay: i * 0.07, gain: 0.32, bend: switched && i === 3 }));
  }

  /** 低沉鼓声（吃子、将军）。 */
  drum(strength = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(g).connect(this.out('sfx', 0.35));
    osc.start(t);
    osc.stop(t + 0.65);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    noise.connect(lp).connect(ng).connect(this.out('sfx', 0.2));
    noise.start(t);
  }

  /** 铜锣（将军、终局）。 */
  gong(strength = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dest = this.out('sfx', 0.6);
    const partials = [1, 1.47, 2.09, 2.56, 3.18, 4.21];
    partials.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(110 * ratio, t);
      osc.frequency.linearRampToValueAtTime(110 * ratio * (1 - 0.01 * i), t + 2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((0.35 / (i + 1)) * strength, t + 0.02 + i * 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 - i * 0.3);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + 3.6);
    });
  }

  /** 木鱼般的轻敲（界面悬停 / 点击）。 */
  tick(high = false): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(high ? 1500 : 980, t);
    osc.frequency.exponentialRampToValueAtTime(high ? 1100 : 700, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(this.out('sfx', 0.1));
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** 选子时的短促拨弦。 */
  select(): void {
    this.pluck(this.scaleNote(5 + Math.floor(Math.random() * 3)), { gain: 0.18 });
  }

  victory(): void {
    this.gong(1);
    [0, 1, 2, 3, 4, 5, 6, 7, 9, 10].forEach((s, i) => this.pluck(this.scaleNote(s), { delay: 0.4 + i * 0.11, gain: 0.3 }));
  }

  defeat(): void {
    this.gong(0.7);
    [7, 5, 4, 2, 0].forEach((s, i) => this.pluck(this.scaleNote(s) - 12, { delay: 0.5 + i * 0.28, gain: 0.32, bend: true }));
  }

  /** 背景：松风 + 稀疏的五声音阶琴音。 */
  private startAmbient(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(6);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(lp).connect(g).connect(this.music);
    src.start();
    this.wind = src;

    let phrase = 0;
    const play = () => {
      if (this.musicOn) {
        const base = [0, 2, 4, 3, 1][phrase++ % 5];
        const notes = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < notes; i++) {
          const step = base + Math.floor(Math.random() * 4) - (i === 0 ? 0 : 2);
          this.pluck(this.scaleNote(step) - 12, { delay: i * (0.35 + Math.random() * 0.5), gain: 0.16 + Math.random() * 0.08, bus: 'music', bend: Math.random() < 0.3 });
        }
      }
      this.ambientTimer = window.setTimeout(play, 3200 + Math.random() * 4200);
    };
    this.ambientTimer = window.setTimeout(play, 1500);
  }

  dispose(): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    this.wind?.stop();
    void this.ctx?.close();
  }
}

export const sound = new Sound();
