// 程序化水墨纹理：宣纸、毛笔笔触、墨晕、远山、棋子面。

import * as THREE from 'three';
import { seededRandom, type Color, type Kind } from '../core/rules';
import { PIECE_CHAR } from '../core/notation';

export const PALETTE = {
  paper: '#efe7d6',
  paperDeep: '#e3d6bd',
  ink: '#1c1915',
  inkSoft: '#3b352f',
  cinnabar: '#b02a1f',
  cinnabarLight: '#cf4a36',
  ivory: '#f3ead7',
};

export const BRUSH_FONT = '"Ma Shan Zheng", "KaiTi", "STKaiti", serif';
export const CURSIVE_FONT = '"Liu Jian Mao Cao", "Ma Shan Zheng", "KaiTi", serif';

export type RGB = [number, number, number];
export const INK_RGB: RGB = [28, 25, 21];
export const CINNABAR_RGB: RGB = [176, 42, 31];

export function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d', { willReadFrequently: false })!];
}

export function toTexture(canvas: HTMLCanvasElement, options: { srgb?: boolean; repeat?: boolean; mipmaps?: boolean } = {}): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  if (options.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  if (options.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.generateMipmaps = options.mipmaps !== false;
  texture.needsUpdate = true;
  return texture;
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

// ---------------------------------------------------------------------------
// 宣纸
// ---------------------------------------------------------------------------

export function paintPaper(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number, base = PALETTE.paper): void {
  const random = seededRandom(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  // 大块的浅色晕染
  for (let i = 0; i < 46; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = (0.08 + random() * 0.35) * Math.max(width, height);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() < 0.5 ? 'rgba(160,128,84,0.045)' : 'rgba(255,252,240,0.06)';
    g.addColorStop(0, tone);
    g.addColorStop(1, 'rgba(160,128,84,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  // 纤维
  const fibers = Math.floor((width * height) / 1800);
  ctx.lineCap = 'round';
  for (let i = 0; i < fibers; i++) {
    const x = random() * width;
    const y = random() * height;
    const length = 4 + random() * 26;
    const angle = random() * Math.PI * 2;
    const bend = (random() - 0.5) * length;
    ctx.strokeStyle = random() < 0.65 ? `rgba(120,96,64,${0.04 + random() * 0.06})` : `rgba(255,255,248,${0.12 + random() * 0.12})`;
    ctx.lineWidth = 0.4 + random() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 - Math.sin(angle) * bend * 0.3,
      y + Math.sin(angle) * length * 0.5 + Math.cos(angle) * bend * 0.3,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }
  // 颗粒噪点
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * 10;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n * 0.9;
  }
  ctx.putImageData(image, 0, 0);
}

// ---------------------------------------------------------------------------
// 毛笔笔触（预先采样成“印章”，可逐帧增量绘制）
// ---------------------------------------------------------------------------

interface Stamp {
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface StrokeOptions {
  width: number;
  color?: RGB;
  seed?: number;
  /** 0..1，飞白程度 */
  dry?: number;
  /** 起笔顿挫 */
  press?: number;
  opacity?: number;
}

export class BrushStroke {
  readonly stamps: Stamp[] = [];
  private drawn = 0;
  readonly color: RGB;

  constructor(points: [number, number][], options: StrokeOptions) {
    const random = seededRandom(options.seed ?? 1);
    this.color = options.color ?? INK_RGB;
    const opacity = options.opacity ?? 1;
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const total = lengths[lengths.length - 1] || 1;
    const step = Math.max(0.7, options.width * 0.16);
    const press = options.press ?? 0.35;
    let segment = 0;
    let wobble = 0;
    for (let s = 0; s <= total; s += step) {
      while (segment < points.length - 2 && lengths[segment + 1] < s) segment++;
      const segLength = lengths[segment + 1] - lengths[segment] || 1;
      const local = (s - lengths[segment]) / segLength;
      const [ax, ay] = points[segment];
      const [bx, by] = points[segment + 1];
      const dx = (bx - ax) / segLength;
      const dy = (by - ay) / segLength;
      const x = ax + (bx - ax) * local;
      const y = ay + (by - ay) * local;
      const t = s / total;
      wobble += (random() - 0.5) * 0.18;
      wobble *= 0.92;
      // 起笔顿、收笔尖
      const head = t < 0.06 ? 1 + press * (1 - t / 0.06) : 1;
      const taper = Math.pow(Math.min(1, (1 - t) / 0.1), 0.55) * Math.pow(Math.min(1, t / 0.03 + 0.4), 0.5);
      const radius = (options.width / 2) * head * taper * (0.92 + wobble * 0.5 + random() * 0.08);
      const nx = -dy;
      const ny = dx;
      this.stamps.push({ x: x + nx * wobble * options.width * 0.3, y: y + ny * wobble * options.width * 0.3, r: Math.max(0.4, radius), a: 0.5 * opacity });
      if (random() < 0.05) this.stamps.push({ x, y, r: radius * 1.9, a: 0.04 * opacity });
      const dry = options.dry ?? 0;
      if (dry > 0 && t > 0.35) {
        // 飞白：在笔画后段用细丝覆盖并留空
        for (let k = 0; k < 3; k++) {
          if (random() < dry * t) {
            const off = (random() - 0.5) * options.width * 0.9;
            this.stamps.push({ x: x + nx * off, y: y + ny * off, r: options.width * 0.07, a: -1 });
          }
        }
      }
    }
  }

  get done(): boolean {
    return this.drawn >= this.stamps.length;
  }

  /** 增量绘制到 fraction（0..1）。 */
  drawTo(ctx: CanvasRenderingContext2D, fraction: number, background?: string): void {
    const target = Math.min(this.stamps.length, Math.ceil(this.stamps.length * fraction));
    for (; this.drawn < target; this.drawn++) {
      const stamp = this.stamps[this.drawn];
      if (stamp.a < 0) {
        if (!background) continue;
        ctx.fillStyle = background;
        ctx.globalAlpha = 0.55;
      } else {
        ctx.fillStyle = rgba(this.color, stamp.a);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(stamp.x, stamp.y, stamp.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawAll(ctx: CanvasRenderingContext2D, background?: string): void {
    this.drawTo(ctx, 1, background);
  }
}

export function circlePoints(cx: number, cy: number, r: number, from: number, to: number, seed: number, wobble = 0.02): [number, number][] {
  const random = seededRandom(seed);
  const points: [number, number][] = [];
  const steps = Math.max(24, Math.floor(Math.abs(to - from) * r * 0.3));
  let drift = 0;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    drift += (random() - 0.5) * wobble;
    drift *= 0.95;
    points.push([cx + Math.cos(a) * r * (1 + drift), cy + Math.sin(a) * r * (1 + drift)]);
  }
  return points;
}

// ---------------------------------------------------------------------------
// 墨晕 / 墨点
// ---------------------------------------------------------------------------

export function inkBlot(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, seed: number, color: RGB = [255, 255, 255], splatter = true): void {
  const random = seededRandom(seed);
  // 多层不规则晕染
  for (let layer = 0; layer < 7; layer++) {
    const r = radius * (1 - layer * 0.11);
    ctx.beginPath();
    const n = 42;
    const phase = random() * 10;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + 0.12 * Math.sin(a * 3 + phase) + 0.07 * Math.sin(a * 7 + phase * 2) + (random() - 0.5) * 0.08;
      const x = cx + Math.cos(a) * r * k;
      const y = cy + Math.sin(a) * r * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
    g.addColorStop(0, rgba(color, 0.32));
    g.addColorStop(0.7, rgba(color, 0.22));
    g.addColorStop(1, rgba(color, 0.05));
    ctx.fillStyle = g;
    ctx.fill();
  }
  if (!splatter) return;
  // 飞溅墨点与拖尾
  for (let i = 0; i < 22; i++) {
    const a = random() * Math.PI * 2;
    const d = radius * (1.05 + random() * 0.9);
    const r = radius * (0.02 + random() * 0.09);
    ctx.fillStyle = rgba(color, 0.55 + random() * 0.4);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
    if (random() < 0.35) {
      ctx.strokeStyle = rgba(color, 0.5);
      ctx.lineWidth = r * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radius * 0.8, cy + Math.sin(a) * radius * 0.8);
      ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      ctx.stroke();
    }
  }
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, build: () => THREE.Texture): THREE.Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = build();
    cache.set(key, texture);
  }
  return texture;
}

/** 白色墨迹（材质颜色负责着色）。 */
export function splatTexture(variant: number): THREE.Texture {
  return cached(`splat${variant}`, () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    inkBlot(ctx, 128, 128, 58 + (variant % 3) * 6, 100 + variant * 17);
    return toTexture(canvas);
  });
}

export function softDotTexture(): THREE.Texture {
  return cached('softdot', () => {
    const [canvas, ctx] = makeCanvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return toTexture(canvas);
  });
}

/** 浓墨点（可落之处）。 */
export function inkDotTexture(): THREE.Texture {
  return cached('inkdot', () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    for (let i = 0; i < 3; i++) inkBlot(ctx, 128, 128, 70 - i * 14, 20 + i, [255, 255, 255], false);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 52);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return toTexture(canvas);
  });
}

export function blotTexture(): THREE.Texture {
  return cached('blot', () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    inkBlot(ctx, 128, 128, 70, 7, [255, 255, 255], false);
    return toTexture(canvas);
  });
}

/** 一笔圆相（禅圆）。 */
export function ensoTexture(seed = 3, open = 0.3): THREE.Texture {
  return cached(`enso${seed}:${open}`, () => {
    const [canvas, ctx] = makeCanvas(512, 512);
    const start = -Math.PI * 0.4;
    const stroke = new BrushStroke(circlePoints(256, 256, 196, start, start + Math.PI * 2 * (1 - open * 0.25), seed, 0.03), {
      width: 34,
      color: [255, 255, 255],
      seed,
      dry: 0.6,
      press: 0.5,
    });
    stroke.drawAll(ctx);
    return toTexture(canvas);
  });
}

export function ringTexture(): THREE.Texture {
  return cached('ring', () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    const stroke = new BrushStroke(circlePoints(128, 128, 104, 0, Math.PI * 2.05, 9, 0.015), { width: 10, color: [255, 255, 255], seed: 9 });
    stroke.drawAll(ctx);
    return toTexture(canvas);
  });
}

/** 落点四角笔触框。 */
export function cornerTexture(): THREE.Texture {
  return cached('corner', () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    const c = 128;
    const d = 92;
    const l = 40;
    const corners: [number, number, number, number][] = [[-1, -1, 1, 1], [1, -1, -1, 1], [-1, 1, 1, -1], [1, 1, -1, -1]];
    corners.forEach(([sx, sy, ix, iy], i) => {
      const x = c + sx * d;
      const y = c + sy * d;
      new BrushStroke([[x + ix * l, y], [x, y], [x, y + iy * l]], { width: 11, color: [255, 255, 255], seed: 40 + i }).drawAll(ctx);
    });
    return toTexture(canvas);
  });
}

/** 毛笔箭头（提示与 AI 候选）。 */
export function arrowTexture(): THREE.Texture {
  return cached('arrow', () => {
    const [canvas, ctx] = makeCanvas(128, 512);
    new BrushStroke([[64, 500], [62, 300], [64, 60]], { width: 22, color: [255, 255, 255], seed: 51, dry: 0.5 }).drawAll(ctx);
    new BrushStroke([[18, 120], [64, 30]], { width: 16, color: [255, 255, 255], seed: 52 }).drawAll(ctx);
    new BrushStroke([[110, 120], [64, 30]], { width: 16, color: [255, 255, 255], seed: 53 }).drawAll(ctx);
    return toTexture(canvas);
  });
}

export function mistTexture(): THREE.Texture {
  return cached('mist', () => {
    const [canvas, ctx] = makeCanvas(512, 256);
    const random = seededRandom(77);
    for (let i = 0; i < 26; i++) {
      const x = 80 + random() * 352;
      const y = 90 + random() * 80;
      const r = 40 + random() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 256);
    }
    return toTexture(canvas);
  });
}

export function petalTexture(): THREE.Texture {
  return cached('petal', () => {
    const [canvas, ctx] = makeCanvas(64, 64);
    ctx.translate(32, 32);
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      const g = ctx.createRadialGradient(0, -12, 0, 0, -12, 14);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0.15)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -12, 8, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,230,120,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    return toTexture(canvas);
  });
}

// ---------------------------------------------------------------------------
// 远山（无缝全景）
// ---------------------------------------------------------------------------

export function mountainPanorama(seed: number, options: { height: number; ridge: number; dark: number; peaks: number; trees?: boolean }): THREE.Texture {
  const width = 4096;
  const height = 1024;
  const [canvas, ctx] = makeCanvas(width, height);
  const random = seededRandom(seed);
  const waves = Array.from({ length: 7 }, (_, i) => ({
    f: Math.round(options.peaks * (1 + i * 1.7) * (0.6 + random() * 0.8)) || 1,
    a: Math.pow(0.55, i) * (0.6 + random() * 0.6),
    p: random() * Math.PI * 2,
  }));
  const ridgeAt = (x: number) => {
    const u = (x / width) * Math.PI * 2;
    let v = 0;
    for (const w of waves) v += Math.sin(u * w.f + w.p) * w.a;
    return height * (1 - options.height) + v * options.ridge * height * 0.25;
  };
  // 山体：从山脊向下渐隐成雾
  for (let x = 0; x < width; x += 2) {
    const top = ridgeAt(x);
    const g = ctx.createLinearGradient(0, top, 0, top + height * 0.42);
    g.addColorStop(0, `rgba(28,25,21,${options.dark})`);
    g.addColorStop(0.18, `rgba(40,36,31,${options.dark * 0.7})`);
    g.addColorStop(1, 'rgba(40,36,31,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, 2.5, height - top);
  }
  // 皴法：沿山脊的短笔触
  for (let i = 0; i < 900; i++) {
    const x = random() * width;
    const top = ridgeAt(x);
    const y = top + random() * random() * height * 0.25;
    const slope = (ridgeAt(x + 6) - ridgeAt(x - 6)) / 12;
    const len = 6 + random() * 24;
    ctx.strokeStyle = `rgba(20,18,15,${options.dark * (0.25 + random() * 0.35)})`;
    ctx.lineWidth = 0.6 + random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + slope * len + (random() - 0.3) * 8);
    ctx.stroke();
  }
  if (options.trees) {
    // 山脊上的松树剪影
    for (let i = 0; i < 160; i++) {
      const x = random() * width;
      const base = ridgeAt(x) + 4;
      const h = 14 + random() * 30;
      ctx.strokeStyle = `rgba(20,18,15,${options.dark})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - h);
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const y = base - h + k * (h / 5);
        const w = 3 + k * 2.6;
        ctx.fillStyle = `rgba(20,18,15,${options.dark * 0.85})`;
        ctx.beginPath();
        ctx.ellipse(x, y, w, 2.2, (random() - 0.5) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = toTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// 棋子面
// ---------------------------------------------------------------------------

const FACE = 512;

function pieceBase(ctx: CanvasRenderingContext2D, seed: number, tone = PALETTE.ivory): void {
  const g = ctx.createRadialGradient(FACE * 0.42, FACE * 0.38, FACE * 0.05, FACE / 2, FACE / 2, FACE * 0.52);
  g.addColorStop(0, '#fbf5e8');
  g.addColorStop(0.7, tone);
  g.addColorStop(1, '#d9c9a8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FACE, FACE);
  const random = seededRandom(seed);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(140,110,70,${0.03 + random() * 0.05})`;
    ctx.lineWidth = 0.6;
    const x = random() * FACE;
    const y = random() * FACE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 30, y + (random() - 0.5) * 30);
    ctx.stroke();
  }
}

export function pieceFaceTexture(color: Color, kind: Kind): THREE.Texture {
  return cached(`face:${color}:${kind}`, () => {
    const [canvas, ctx] = makeCanvas(FACE, FACE);
    const rgb = color === 'red' ? CINNABAR_RGB : INK_RGB;
    const seed = (color === 'red' ? 10 : 30) + ['general', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'soldier'].indexOf(kind);
    pieceBase(ctx, seed);
    new BrushStroke(circlePoints(256, 256, 214, -1.2, -1.2 + Math.PI * 2.02, seed, 0.012), { width: 15, color: rgb, seed, press: 0.6 }).drawAll(ctx);
    new BrushStroke(circlePoints(256, 256, 190, 0.6, 0.6 + Math.PI * 1.96, seed + 1, 0.008), { width: 4, color: rgb, seed: seed + 1, opacity: 0.7 }).drawAll(ctx);
    const char = PIECE_CHAR[color][kind];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `290px ${BRUSH_FONT}`;
    // 墨晕
    ctx.shadowColor = rgba(rgb, 0.55);
    ctx.shadowBlur = 14;
    ctx.fillStyle = rgba(rgb, 0.35);
    ctx.fillText(char, 256, 270);
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(rgb, 0.96);
    ctx.fillText(char, 256, 266);
    if (kind === 'general') {
      // 将帅加盖小印
      ctx.fillStyle = rgba(CINNABAR_RGB, 0.85);
      ctx.fillRect(330, 370, 44, 44);
      ctx.fillStyle = PALETTE.ivory;
      ctx.font = `34px ${BRUSH_FONT}`;
      ctx.fillText(color === 'red' ? '帅' : '将', 352, 394);
    }
    return toTexture(canvas);
  });
}

/** 暗子背面：一笔圆相 + 中心墨晕。颜色只表示公开的暂时控制方。 */
export function pieceBackTexture(controllerColor: Color): THREE.Texture {
  return cached(`back:${controllerColor}`, () => {
    const [canvas, ctx] = makeCanvas(FACE, FACE);
    pieceBase(ctx, controllerColor === 'red' ? 61 : 62, '#ece0c6');
    const rgb = controllerColor === 'red' ? CINNABAR_RGB : INK_RGB;
    const cloud = ctx.createRadialGradient(256, 256, 0, 256, 256, 150);
    cloud.addColorStop(0, 'rgba(28,25,21,0.32)');
    cloud.addColorStop(0.6, 'rgba(28,25,21,0.12)');
    cloud.addColorStop(1, 'rgba(28,25,21,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(0, 0, FACE, FACE);
    inkBlot(ctx, 256, 256, 46, controllerColor === 'red' ? 5 : 6, INK_RGB, false);
    const start = controllerColor === 'red' ? -2.2 : 0.9;
    new BrushStroke(circlePoints(256, 256, 176, start, start + Math.PI * 1.82, 71, 0.03), { width: 30, color: rgb, seed: 71, dry: 0.7, press: 0.7 }).drawAll(ctx, '#ece0c6');
    return toTexture(canvas);
  });
}

/** 翻面之前的正面：一张空白素面（真实身份要到翻面瞬间才写上去）。 */
export function pieceBlankTexture(): THREE.Texture {
  return cached('blank', () => {
    const [canvas, ctx] = makeCanvas(FACE, FACE);
    pieceBase(ctx, 90);
    return toTexture(canvas);
  });
}
