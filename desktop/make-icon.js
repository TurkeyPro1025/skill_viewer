'use strict';

/* 零依赖生成 Tauri 图标源图:品牌蓝紫渐变圆角方 + 三层白色"层叠"符号
   (与网页版 brand-mark SVG 同构),输出 1024x1024 RGBA PNG。 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024;
const H = 1024;

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function roundedOutside(x, y, r) {
  // 圆角矩形外部判定(整体是全幅方形,仅切四角)
  const cx = Math.max(r, Math.min(W - r, x));
  const cy = Math.max(r, Math.min(H - r, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy > r * r;
}

const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 4); // filter byte 0 + RGBA
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);
    let r = lerp(79, 122, t);   // #4f7cf0 → #7a4fe0
    let g = lerp(124, 79, t);
    let b = lerp(240, 224, t);
    let a = 255;
    if (roundedOutside(x, y, 200)) { a = 0; }

    // 三道白色圆角"层叠"条(与网页版 brand-mark 的层叠符号呼应)
    const bars = [[330, 410, 0.95], [500, 580, 0.85], [670, 750, 0.6]];
    for (const [y0, y1, alpha] of bars) {
      if (y >= y0 && y <= y1 && x >= 280 && x <= 744) {
        const edge = Math.min(x - 280, 744 - x, y - y0, y1 - y);
        if (edge > 14) {
          r = 255; g = 255; b = 255;
          a = Math.round(alpha * 255);
        }
      }
    }

    const i = 1 + (y * W + x) * 4;
    row[i] = r; row[i + 1] = g; row[i + 2] = b; row[i + 3] = a;
  }
  rows.push(row);
}

const raw = Buffer.concat(rows);
const idat = zlib.deflateSync(raw, { level: 9 });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, 'app-icon.png');
fs.writeFileSync(out, png);
console.log(`written ${out} (${png.length} bytes)`);
