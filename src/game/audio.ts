/**
 * WebAudio 程序化音效：零外部资源，全部合成。
 * 首次用户手势后 resume()；同类并发限 2 个实例防爆音（符合单文件离线约束）。
 */

type Sfx =
  | 'pistol'
  | 'rifle'
  | 'empty'
  | 'reload'
  | 'melee'
  | 'drill'
  | 'hitMetal'
  | 'hitPaper'
  | 'taskDone'
  | 'score';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  /** 各音效当前并发实例数（限流） */
  private active = new Map<Sfx, number>();
  private drillNode: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;

  constructor(muted = false) {
    this.muted = muted;
  }

  /** 在用户手势（进入游戏/点击）时调用，初始化并解锁 */
  resume(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 同类并发上限 */
  private gate(kind: Sfx, max = 2): boolean {
    const n = this.active.get(kind) ?? 0;
    if (n >= max) return false;
    this.active.set(kind, n + 1);
    return true;
  }
  private release(kind: Sfx): void {
    const n = (this.active.get(kind) ?? 1) - 1;
    if (n <= 0) this.active.delete(kind);
    else this.active.set(kind, n);
  }

  /** 噪声脉冲 + 低通扫频（枪声） */
  private gun(kind: 'pistol' | 'rifle'): void {
    if (!this.gate(kind) || !this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = kind === 'pistol' ? 0.16 : 0.12;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(kind === 'pistol' ? 2200 : 3200, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp).connect(g).connect(this.master);
    // 低频“砰”
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + dur * 0.8);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(og).connect(this.master);
    src.start(t);
    osc.start(t);
    src.stop(t + dur);
    osc.stop(t + dur);
    const tag = kind;
    src.onended = () => this.release(tag);
  }

  pistol(): void {
    this.gun('pistol');
  }
  rifle(): void {
    this.gun('rifle');
  }

  /** 空仓咔哒 */
  empty(): void {
    if (!this.gate('empty') || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
    osc.onended = () => this.release('empty');
  }

  /** 换弹：两声短咔哒 */
  reload(): void {
    if (!this.gate('reload') || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const dt of [0, 0.18]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600 + dt * 200, t + dt);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
      osc.connect(g).connect(this.master);
      osc.start(t + dt);
      osc.stop(t + dt + 0.06);
    }
    window.setTimeout(() => this.release('reload'), 450);
  }

  /** 匕首挥空 */
  melee(): void {
    if (!this.gate('melee') || !this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(800, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.12);
    src.onended = () => this.release('melee');
  }

  /** 电钻：持续锯齿嗡鸣（start/stop） */
  drillStart(): void {
    if (!this.ctx || !this.master || this.drillNode) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 90;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.05);
    osc.connect(g).connect(this.master);
    osc.start();
    lfo.start();
    this.drillNode = { osc, gain: g, lfo };
  }
  drillStop(): void {
    if (!this.drillNode || !this.ctx) return;
    const { osc, gain, lfo } = this.drillNode;
    const t = this.ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0, t + 0.05);
    osc.stop(t + 0.08);
    lfo.stop(t + 0.08);
    osc.onended = () => {
      osc.disconnect();
      lfo.disconnect();
      gain.disconnect();
    };
    this.drillNode = null;
  }

  /** 金属命中：高频衰减正弦 */
  hitMetal(): void {
    if (!this.gate('hitMetal') || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.18);
    osc.onended = () => this.release('hitMetal');
  }

  /** 纸靶命中：短噪声 */
  hitPaper(): void {
    if (!this.gate('hitPaper') || !this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.08);
    src.onended = () => this.release('hitPaper');
  }

  /** 任务完成：双音上行 */
  taskDone(): void {
    if (!this.gate('taskDone') || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [523, 784].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const dt = i * 0.12;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.3, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.18);
      osc.connect(g).connect(this.master!);
      osc.start(t + dt);
      osc.stop(t + dt + 0.2);
    });
    window.setTimeout(() => this.release('taskDone'), 400);
  }

  /** 计分提示：短促清脆 */
  score(): void {
    if (!this.gate('score') || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.07);
    osc.onended = () => this.release('score');
  }
}
