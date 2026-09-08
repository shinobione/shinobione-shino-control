import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const PNG_SIG = Buffer.from([137,80,78,71,13,10,26,10]);
let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const scan = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    scan[dst] = 0;
    rgba.copy(scan, dst + 1, y * stride, (y + 1) * stride);
  }
  const png = Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
}

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }
function mix(a, b, t) { return a + (b - a) * t; }

function blend(base, over, alpha = 1) {
  const a = (over[3] / 255) * alpha;
  const ia = 1 - a;
  return [
    clamp(Math.round(over[0] * a + base[0] * ia)),
    clamp(Math.round(over[1] * a + base[1] * ia)),
    clamp(Math.round(over[2] * a + base[2] * ia)),
    clamp(Math.round((a + (base[3] / 255) * ia) * 255))
  ];
}

function roundedSquareSdf(x, y) {
  const qx = Math.abs(x) - 0.76;
  const qy = Math.abs(y) - 0.76;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.18;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const vv = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return Math.hypot(dx, dy);
}

function tri(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const p = [px, py];
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function normalizeDeg(d) {
  d %= 360;
  return d < 0 ? d + 360 : d;
}

function inArc(angle, start, end) {
  angle = normalizeDeg(angle); start = normalizeDeg(start); end = normalizeDeg(end);
  return start <= end ? angle >= start && angle <= end : angle >= start || angle <= end;
}

function renderIcon(size, mode = 'sync') {
  const ss = 4;
  const w = size * ss;
  const hi = new Uint8Array(w * w * 4);
  const darkA = [20, 31, 49, 255];
  const darkB = [8, 13, 22, 255];
  const border = [48, 72, 99, 255];
  const goldA = [244, 207, 113, 255];
  const goldB = [200, 148, 50, 255];
  const cyanA = [139, 232, 255, 255];
  const cyanB = [53, 174, 232, 255];

  for (let py = 0; py < w; py++) {
    for (let px = 0; px < w; px++) {
      const x = ((px + 0.5) / w) * 2 - 1;
      const y = ((py + 0.5) / w) * 2 - 1;
      const sdf = roundedSquareSdf(x, y);
      let c = [0, 0, 0, 0];
      if (sdf <= 0) {
        const t = clamp((x + y + 2) / 4, 0, 1);
        c = [mix(darkA[0], darkB[0], t), mix(darkA[1], darkB[1], t), mix(darkA[2], darkB[2], t), 255].map(Math.round);
        if (sdf > -0.035) c = blend(c, border, 0.9);

        if (mode === 'sync') {
          const r = Math.hypot(x, y);
          const angle = Math.atan2(y, x) * 180 / Math.PI;
          const ring = Math.abs(r - 0.67) <= 0.07;
          const activeArc = inArc(angle, 152, 344) || inArc(angle, -28, 164);
          if (ring && activeArc) {
            const ct = clamp((x + 1) / 2, 0, 1);
            c = blend(c, [mix(cyanA[0], cyanB[0], ct), mix(cyanA[1], cyanB[1], ct), mix(cyanA[2], cyanB[2], ct), 255], 0.95);
          }
          if (tri(x, y, [0.48,-0.80], [0.83,-0.64], [0.55,-0.42]) || tri(x, y, [-0.48,0.80], [-0.83,0.64], [-0.55,0.42])) {
            c = blend(c, cyanA, 1);
          }
        }

        const d1 = segDist(x, y, -0.27, 0.42, 0.00, -0.42);
        const d2 = segDist(x, y,  0.04, 0.42, 0.31, -0.42);
        if (Math.min(d1, d2) <= 0.085) {
          const gt = clamp((y + 1) / 2, 0, 1);
          c = blend(c, [mix(goldA[0], goldB[0], gt), mix(goldA[1], goldB[1], gt), mix(goldA[2], goldB[2], gt), 255], 1);
        }

        if (mode === 'control') {
          if (Math.hypot(x - 0.52, y + 0.52) < 0.105) c = blend(c, cyanA, 1);
          if (y > 0.55 && y < 0.60 && x > -0.58 && x < 0.58) c = blend(c, cyanB, 0.8);
        }
      }
      const i = (py * w + px) * 4;
      hi[i] = c[0]; hi[i + 1] = c[1]; hi[i + 2] = c[2]; hi[i + 3] = c[3];
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const i = (((y * ss + sy) * w) + (x * ss + sx)) * 4;
        r += hi[i]; g += hi[i + 1]; b += hi[i + 2]; a += hi[i + 3];
      }
      const n = ss * ss;
      const j = (y * size + x) * 4;
      out[j] = Math.round(r / n); out[j + 1] = Math.round(g / n); out[j + 2] = Math.round(b / n); out[j + 3] = Math.round(a / n);
    }
  }
  return out;
}

const extensionDir = path.join(ROOT, 'extension', 'shino-sync', 'icons');
for (const size of [16, 32, 48, 128]) {
  writePng(path.join(extensionDir, `shino-sync-${size}.png`), size, size, renderIcon(size, 'sync'));
}
writePng(path.join(ROOT, 'public', 'favicon-32.png'), 32, 32, renderIcon(32, 'control'));

console.log('SHINO brand assets generated: favicon + SHINO Sync 16/32/48/128 PNG icons');
