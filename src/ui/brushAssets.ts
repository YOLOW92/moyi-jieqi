// 运行时生成界面用的笔触图片，并注入为 CSS 变量。

import { BrushStroke, circlePoints, inkBlot, makeCanvas, paintPaper } from '../scene/textures';

function strokeImage(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  const [canvas, ctx] = makeCanvas(width, height);
  draw(ctx);
  return `url(${canvas.toDataURL('image/png')})`;
}

export function installBrushAssets(): void {
  const root = document.documentElement.style;
  // 横向浓墨一笔（按钮底）
  root.setProperty(
    '--brush-bar',
    strokeImage(600, 120, (ctx) => {
      new BrushStroke([[30, 66], [200, 58], [420, 62], [570, 56]], { width: 78, seed: 3, dry: 0.8, press: 0.4 }).drawAll(ctx);
    }),
  );
  // 细长横线（分隔）
  root.setProperty(
    '--brush-line',
    strokeImage(800, 40, (ctx) => {
      new BrushStroke([[10, 22], [300, 18], [790, 21]], { width: 7, seed: 8, dry: 0.6 }).drawAll(ctx);
    }),
  );
  // 竖向笔触（面板左边缘）
  root.setProperty(
    '--brush-edge',
    strokeImage(60, 1200, (ctx) => {
      new BrushStroke([[30, 10], [26, 600], [32, 1190]], { width: 14, seed: 12, dry: 0.7 }).drawAll(ctx);
    }),
  );
  // 圆相
  root.setProperty(
    '--brush-enso',
    strokeImage(300, 300, (ctx) => {
      new BrushStroke(circlePoints(150, 150, 118, -1.1, -1.1 + Math.PI * 1.85, 4, 0.03), { width: 18, seed: 4, dry: 0.7, press: 0.6 }).drawAll(ctx);
    }),
  );
  // 朱砂圆相
  root.setProperty(
    '--brush-enso-red',
    strokeImage(300, 300, (ctx) => {
      new BrushStroke(circlePoints(150, 150, 118, 2.1, 2.1 + Math.PI * 1.85, 6, 0.03), { width: 16, seed: 6, dry: 0.6, color: [176, 42, 31] }).drawAll(ctx);
    }),
  );
  // 墨团
  root.setProperty(
    '--brush-blot',
    strokeImage(256, 256, (ctx) => inkBlot(ctx, 128, 128, 66, 3, [28, 25, 21])),
  );
  // 宣纸
  root.setProperty(
    '--paper-tex',
    strokeImage(512, 512, (ctx) => paintPaper(ctx, 512, 512, 31, '#efe7d6')),
  );
}
