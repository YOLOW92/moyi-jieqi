// 构建后删除 .woff 字体副本：CSS 中 woff2 排在前面，Chromium 永远不会请求 woff。
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/assets';
let removed = 0;
for (const name of readdirSync(dir)) {
  if (name.endsWith('.woff')) {
    unlinkSync(join(dir, name));
    removed++;
  }
}
console.log(`removed ${removed} .woff files`);
