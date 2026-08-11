// 纯 Node 生成 256x256 icon.ico：PNG 数据直接内嵌 ICO（Vista+ 支持）
const zlib = require('zlib');
const fs = require('fs');

const SIZE = 256;

// 绘制：圆角矩形渐变底（深蓝→蓝紫）+ 白色 ">_" 终端符号（用矩形拼）
function pixel(x, y) {
  // 圆角矩形裁剪
  const r = 48;
  const inRound =
    (x >= r && x < SIZE - r) || (y >= r && y < SIZE - r) ||
    ((x - r) ** 2 + (y - r) ** 2 < r * r) ||
    ((x - (SIZE - r)) ** 2 + (y - r) ** 2 < r * r) ||
    ((x - r) ** 2 + (y - (SIZE - r)) ** 2 < r * r) ||
    ((x - (SIZE - r)) ** 2 + (y - (SIZE - r)) ** 2 < r * r);
  if (!inRound) return [0, 0, 0, 0];

  // 斜向渐变
  const t = (x + y) / (2 * SIZE);
  const rr = Math.round(30 + 40 * t);
  const gg = Math.round(80 + 60 * t);
  const bb = Math.round(200 + 55 * t);

  // ">_" 符号：">" 两条斜线 + "_" 下划线
  const thick = 18;
  // ">" 上半斜线: 从 (64,64) 到 (140,128)
  const onSeg = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let tt = ((x - x0) * dx + (y - y0) * dy) / len2;
    tt = Math.max(0, Math.min(1, tt));
    const px = x0 + tt * dx, py = y0 + tt * dy;
    return (x - px) ** 2 + (y - py) ** 2 < (thick / 2) ** 2;
  };
  const chevron = onSeg(70, 70, 150, 128) || onSeg(70, 186, 150, 128);
  const underscore = x >= 150 && x <= 216 && y >= 176 && y <= 194;
  if (chevron || underscore) return [255, 255, 255, 255];

  return [rr, gg, bb, 255];
}

// 组装 PNG：每行前置 filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y);
    raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO 头：1 个 PNG 图像条目
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; // 256
entry[1] = 0;
entry[2] = 0; // 无调色板
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

fs.writeFileSync('build/icon.ico', Buffer.concat([icoHeader, entry, png]));
console.log('icon.ico written:', png.length, 'bytes png');
