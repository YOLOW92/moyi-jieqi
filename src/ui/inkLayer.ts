// 覆盖在 3D 之上的 2D 墨迹层：笔锋光标、点击溅墨、墨染转场、标题晕染。

interface TrailPoint {
  x: number;
  y: number;
  life: number;
  width: number;
  /** 新一笔的起点：不与上一个点相连 */
  start?: boolean;
}

interface Splash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  seed: number;
  drops: { a: number; d: number; r: number }[];
}

interface Blob {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

export class InkLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private trail: TrailPoint[] = [];
  private splashes: Splash[] = [];
  private last: { x: number; y: number; t: number } | null = null;
  private transition: { cover: boolean; blobs: Blob[]; t: number; duration: number; resolve: () => void } | null = null;
  private covered = false;
  private ratio = 1;
  cursorTrail = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => this.onMove(e.clientX, e.clientY));
    document.addEventListener('pointerleave', () => (this.last = null));
    window.addEventListener('blur', () => (this.last = null));
    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      this.draw(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    this.ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * this.ratio;
    this.canvas.height = window.innerHeight * this.ratio;
  }

  private onMove(x: number, y: number): void {
    if (!this.cursorTrail) return;
    const now = performance.now();
    // 指针跳得太远或停顿太久（如移出窗口再进入）：另起一笔，避免拉出直线
    if (this.last && (Math.hypot(x - this.last.x, y - this.last.y) > 140 || now - this.last.t > 160)) {
      this.trail.push({ x, y, life: 1, width: 1, start: true });
      this.last = null;
    }
    if (this.last) {
      const d = Math.hypot(x - this.last.x, y - this.last.y);
      const speed = d / Math.max(1, now - this.last.t);
      const steps = Math.min(8, Math.ceil(d / 6));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.trail.push({ x: this.last.x + (x - this.last.x) * t, y: this.last.y + (y - this.last.y) * t, life: 1, width: Math.max(0.8, 4.2 - speed * 1.6) });
      }
    }
    this.last = { x, y, t: now };
    if (this.trail.length > 220) this.trail.splice(0, this.trail.length - 220);
  }

  /** 点击处溅出一朵墨花。 */
  splash(x: number, y: number, options: { radius?: number; color?: string; life?: number } = {}): void {
    const radius = options.radius ?? 26;
    const drops = Array.from({ length: 10 + Math.floor(Math.random() * 8) }, () => ({
      a: Math.random() * Math.PI * 2,
      d: 0.9 + Math.random() * 1.4,
      r: 0.04 + Math.random() * 0.12,
    }));
    this.splashes.push({ x, y, radius: 0, maxRadius: radius, life: 0, maxLife: options.life ?? 1.1, color: options.color ?? '28,25,21', seed: Math.random() * 100, drops });
  }

  /** 墨染转场：cover=true 时墨从数点晕开盖满屏幕；false 时墨散去。 */
  ink(cover: boolean, duration = 0.85): Promise<void> {
    if (!cover && !this.covered) return Promise.resolve();
    return new Promise((resolve) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const blobs: Blob[] = Array.from({ length: 9 }, (_, i) => ({
        x: i === 0 ? w / 2 : Math.random() * w,
        y: i === 0 ? h / 2 : Math.random() * h,
        r: 0,
        // 中心那一团保证最终盖满/清空整个屏幕
        speed: i === 0 ? 1.4 : 0.5 + Math.random() * 0.6,
        phase: Math.random() * 10,
      }));
      this.transition?.resolve();
      this.transition = { cover, blobs, t: 0, duration, resolve };
    });
  }

  private blobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number): void {
    ctx.beginPath();
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + 0.1 * Math.sin(a * 5 + phase) + 0.06 * Math.sin(a * 11 + phase * 1.7) + 0.04 * Math.sin(a * 23 + phase * 0.3);
      const px = x + Math.cos(a) * r * k;
      const py = y + Math.sin(a) * r * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  private draw(dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 笔锋光标拖尾
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt * 1.7;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (b.start) continue;
      const life = b.life;
      ctx.strokeStyle = `rgba(28,25,21,${life * 0.42})`;
      ctx.lineWidth = b.width * (0.3 + life * 0.9);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 墨花
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        this.splashes.splice(i, 1);
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, t * 3), 3);
      const alpha = t < 0.3 ? 0.55 : 0.55 * (1 - (t - 0.3) / 0.7);
      ctx.fillStyle = `rgba(${s.color},${alpha * 0.5 * Math.min(1, 40 / s.maxRadius)})`;
      this.blobPath(ctx, s.x, s.y, s.maxRadius * grow * 0.55, s.seed);
      ctx.fill();
      ctx.strokeStyle = `rgba(${s.color},${alpha * 0.6})`;
      ctx.lineWidth = 2 * (1 - t);
      this.blobPath(ctx, s.x, s.y, s.maxRadius * (0.6 + t * 1.4), s.seed + 1);
      ctx.stroke();
      ctx.fillStyle = `rgba(${s.color},${alpha})`;
      for (const d of s.drops) {
        const dist = s.maxRadius * d.d * grow;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(d.a) * dist, s.y + Math.sin(d.a) * dist, s.maxRadius * d.r * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 墨染转场
    const tr = this.transition;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const diag = Math.hypot(w, h);
    if (tr) {
      tr.t += dt;
      const p = Math.min(1, tr.t / tr.duration);
      const eased = tr.cover ? p * p * (3 - 2 * p) : 1 - Math.pow(1 - p, 2);
      if (tr.cover) {
        ctx.fillStyle = 'rgb(24,21,18)';
        for (const b of tr.blobs) {
          this.blobPath(ctx, b.x, b.y, eased * diag * 0.75 * b.speed, b.phase + tr.t * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgb(24,21,18)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        for (const b of tr.blobs) {
          this.blobPath(ctx, b.x, b.y, eased * diag * 0.8 * b.speed, b.phase + tr.t * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      if (p >= 1) {
        this.covered = tr.cover;
        const resolve = tr.resolve;
        this.transition = null;
        resolve();
      }
    } else if (this.covered) {
      ctx.fillStyle = 'rgb(24,21,18)';
      ctx.fillRect(0, 0, w, h);
    }
  }
}
