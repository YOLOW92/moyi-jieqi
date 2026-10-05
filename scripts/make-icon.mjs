// 生成应用图标（256×256 PNG）：宣纸底、一笔圆相、朱砂印。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const S = 256;
const px = new Uint8Array(S * S * 4);

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const cx = x - S / 2 + 0.5;
    const cy = y - S / 2 + 0.5;
    const r = Math.hypot(cx, cy);
    // 圆形宣纸底
    let a = r < 124 ? 255 : r < 127 ? Math.round(255 * (127 - r) / 3) : 0;
    let [R, G, B] = [239, 231, 214];
    const grain = (hash(x, y) - 0.5) * 12;
    R += grain; G += grain; B += grain;
    // 圆相：角度决定笔画粗细，留一个缺口
    const ang = Math.atan2(cy, cx);
    const t = ((ang + Math.PI * 0.62) / (Math.PI * 2) + 1) % 1;
    const width = t < 0.9 ? 9 + 9 * Math.sin(t * Math.PI) ** 0.6 + (hash(Math.floor(t * 200), 3) - 0.5) * 3 : 0;
    const wob = 92 + Math.sin(ang * 3) * 2.5;
    const d = Math.abs(r - wob);
    if (d < width) {
      const ink = Math.min(1, (width - d) / 2.2) * (t > 0.6 && hash(x * 3, y * 5) < (t - 0.6) * 0.9 ? 0.25 : 1);
      R = R * (1 - ink) + 28 * ink;
      G = G * (1 - ink) + 25 * ink;
      B = B * (1 - ink) + 21 * ink;
    }
    // 朱砂印
    const sx = x - 152;
    const sy = y - 150;
    if (sx >= 0 && sx < 40 && sy >= 0 && sy < 40) {
      const border = sx < 4 || sx > 35 || sy < 4 || sy > 35;
      const carved = !border && ((sx > 10 && sx < 30 && (sy === 14 || sy === 15 || sy === 25 || sy === 26)) || ((sx === 19 || sx === 20) && sy > 8 && sy < 32));
      if (!carved) { R = 176; G = 42; B = 31; }
    }
    px.set([Math.max(0, Math.min(255, R)), Math.max(0, Math.min(255, G)), Math.max(0, Math.min(255, B)), a], i);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log('build/icon.png', png.length, 'bytes');
