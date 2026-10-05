import * as THREE from 'three';
import { colOf, rowOf } from '../core/rules';
import { BRUSH_FONT, BrushStroke, CINNABAR_RGB, INK_RGB, makeCanvas, paintPaper, PALETTE, toTexture } from './textures';

export const BOARD_W = 9.6;
export const BOARD_D = 10.6;
export const BOARD_THICK = 0.5;

export function squareToWorld(square: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(colOf(square) - 4, 0, rowOf(square) - 4.5);
}

export function worldToSquare(point: THREE.Vector3): number | null {
  const col = Math.round(point.x + 4);
  const row = Math.round(point.z + 4.5);
  if (col < 0 || col > 8 || row < 0 || row > 9) return null;
  if (Math.hypot(point.x - (col - 4), point.z - (row - 4.5)) > 0.48) return null;
  return row * 9 + col;
}

interface TimedStroke {
  stroke: BrushStroke;
  start: number;
  duration: number;
}

/** 盘面绘制器：笔画按时间先后增量写到宣纸上。 */
class BoardPainter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private readonly strokes: TimedStroke[] = [];
  private textPasses = 0;
  private readonly W = 2048;
  private readonly H = Math.round((2048 * BOARD_D) / BOARD_W);
  private readonly u = 2048 / BOARD_W;
  readonly totalDuration: number;
  private paper: HTMLCanvasElement;

  constructor() {
    [this.canvas, this.ctx] = makeCanvas(this.W, this.H);
    const [paper, paperCtx] = makeCanvas(this.W, this.H);
    paintPaper(paperCtx, this.W, this.H, 4);
    this.decoratePaper(paperCtx);
    this.paper = paper;
    this.ctx.drawImage(paper, 0, 0);
    this.texture = toTexture(this.canvas);
    this.buildStrokes();
    this.totalDuration = Math.max(...this.strokes.map((s) => s.start + s.duration)) + 1.2;
  }

  private px(col: number, row: number): [number, number] {
    return [this.W / 2 + (col - 4) * this.u, this.H / 2 + (row - 4.5) * this.u];
  }

  /** 宣纸上的淡墨远山与水渍，作为盘面底色的点缀。 */
  private decoratePaper(ctx: CanvasRenderingContext2D): void {
    const [, riverTop] = this.px(0, 4);
    const [, riverBottom] = this.px(0, 5);
    const g = ctx.createLinearGradient(0, riverTop, 0, riverBottom);
    g.addColorStop(0, 'rgba(120,140,140,0.0)');
    g.addColorStop(0.5, 'rgba(110,130,128,0.10)');
    g.addColorStop(1, 'rgba(120,140,140,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, riverTop, this.W, riverBottom - riverTop);
    // 河中水纹
    ctx.strokeStyle = 'rgba(60,70,70,0.10)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = riverTop + ((riverBottom - riverTop) * (i + 1)) / 10;
      ctx.beginPath();
      for (let x = 0; x <= this.W; x += 16) {
        const yy = y + Math.sin(x * 0.012 + i * 1.7) * 6;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  private buildStrokes(): void {
    let t = 0;
    let seed = 1;
    const add = (points: [number, number][], width: number, duration: number, gap = 0.035, color = INK_RGB, dry = 0.35) => {
      this.strokes.push({ stroke: new BrushStroke(points, { width, seed: seed++, dry, color }), start: t, duration });
      t += gap;
    };
    const p = (c: number, r: number) => this.px(c, r);
    const lw = 7;

    // 外框（粗笔）
    const m = 0.42;
    add([p(-m, -m), p(8 + m, -m)], 16, 0.55, 0.12);
    add([p(8 + m, -m), p(8 + m, 9 + m)], 16, 0.55, 0.12);
    add([p(8 + m, 9 + m), p(-m, 9 + m)], 16, 0.55, 0.12);
    add([p(-m, 9 + m), p(-m, -m)], 16, 0.55, 0.2);
    // 横线
    for (let r = 0; r <= 9; r++) add([p(0, r), p(8, r)], lw, 0.45);
    // 竖线（中路在河界断开）
    add([p(0, 0), p(0, 9)], lw, 0.5);
    add([p(8, 0), p(8, 9)], lw, 0.5);
    for (let c = 1; c < 8; c++) {
      add([p(c, 0), p(c, 4)], lw, 0.32, 0.02);
      add([p(c, 5), p(c, 9)], lw, 0.32);
    }
    // 九宫斜线
    add([p(3, 0), p(5, 2)], lw - 1, 0.3);
    add([p(5, 0), p(3, 2)], lw - 1, 0.3);
    add([p(3, 7), p(5, 9)], lw - 1, 0.3);
    add([p(5, 7), p(3, 9)], lw - 1, 0.3);
    // 炮位兵位花记
    const marks: [number, number][] = [[1, 2], [7, 2], [1, 7], [7, 7]];
    for (const c of [0, 2, 4, 6, 8]) marks.push([c, 3], [c, 6]);
    const g = 0.09;
    const l = 0.22;
    for (const [c, r] of marks) {
      for (const sx of [-1, 1]) {
        if (c + sx < 0 || c + sx > 8) continue;
        for (const sy of [-1, 1]) {
          add([p(c + sx * (g + l), r + sy * g), p(c + sx * g, r + sy * g), p(c + sx * g, r + sy * (g + l))], 4, 0.12, 0.008, INK_RGB, 0);
        }
      }
    }
    // 落款印章
    this.textStart = t + 0.1;
  }

  private textStart = 0;

  private drawRiverText(alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(this.u * 0.62)}px ${BRUSH_FONT}`;
    ctx.fillStyle = `rgba(28,25,21,${alpha})`;
    const y = this.H / 2 + this.u * 0.04;
    ctx.fillText('楚', this.px(1.5, 0)[0], y);
    ctx.fillText('河', this.px(2.5, 0)[0], y);
    ctx.fillText('漢', this.px(5.5, 0)[0], y);
    ctx.fillText('界', this.px(6.5, 0)[0], y);
    ctx.restore();
  }

  private drawSeal(alpha: number): void {
    const ctx = this.ctx;
    const [x, y] = this.px(8.42, 9.62);
    const s = this.u * 0.42;
    ctx.save();
    ctx.translate(x - s, y - s * 0.2);
    ctx.rotate(-0.04);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${CINNABAR_RGB.join(',')})`;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.paper;
    ctx.font = `${Math.round(s * 0.42)}px ${BRUSH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('墨', s * 0.5, s * 0.28);
    ctx.fillText('弈', s * 0.5, s * 0.72);
    ctx.restore();
  }

  /** 推进到 time 秒；返回是否已全部绘完。 */
  update(time: number): boolean {
    let changed = false;
    for (const s of this.strokes) {
      if (s.stroke.done || time < s.start) continue;
      s.stroke.drawTo(this.ctx, Math.min(1, (time - s.start) / s.duration), PALETTE.paper);
      changed = true;
    }
    // 河界文字层层渗出
    const passes = Math.min(8, Math.floor(Math.max(0, time - this.textStart) / 0.12));
    while (this.textPasses < passes) {
      this.drawRiverText(0.16);
      this.textPasses++;
      changed = true;
      if (this.textPasses === 8) this.drawSeal(0.92);
    }
    if (changed) this.texture.needsUpdate = true;
    return this.textPasses >= 8 && this.strokes.every((s) => s.stroke.done);
  }

  finish(): void {
    this.update(1e9);
  }

  reset(): void {
    this.ctx.drawImage(this.paper, 0, 0);
    this.textPasses = 0;
    // 重新生成笔画（BrushStroke 记录了绘制进度）
    this.strokes.length = 0;
    this.buildStrokes();
    this.texture.needsUpdate = true;
  }
}

export class BoardView {
  readonly group = new THREE.Group();
  readonly painter = new BoardPainter();
  readonly pickPlane: THREE.Mesh;
  private paintTime = 0;
  private painting = false;

  constructor() {
    const lacquer = new THREE.MeshStandardMaterial({ color: 0x1d1814, roughness: 0.55, metalness: 0.05 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.3, BOARD_THICK, BOARD_D + 0.3), lacquer);
    slab.position.y = -BOARD_THICK / 2 - 0.005;
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.group.add(slab);

    // 金色细线描边
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.12, 0.02, BOARD_D + 0.12),
      new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.4, metalness: 0.6 }),
    );
    edge.position.y = -0.03;
    this.group.add(edge);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_D),
      new THREE.MeshStandardMaterial({ map: this.painter.texture, roughness: 0.92, metalness: 0 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    top.receiveShadow = true;
    this.group.add(top);

    // 四只矮脚
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 20), lacquer);
      foot.position.set(x * (BOARD_W / 2 - 0.4), -BOARD_THICK - 0.25, z * (BOARD_D / 2 - 0.4));
      foot.castShadow = true;
      this.group.add(foot);
    }

    this.pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.group.add(this.pickPlane);
  }

  startPainting(): number {
    this.painter.reset();
    this.paintTime = 0;
    this.painting = true;
    return this.painter.totalDuration;
  }

  finishPainting(): void {
    this.painter.finish();
    this.painting = false;
  }

  update(dt: number): void {
    if (!this.painting) return;
    this.paintTime += dt;
    if (this.painter.update(this.paintTime)) this.painting = false;
  }
}
