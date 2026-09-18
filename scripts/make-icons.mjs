/**
 * Generates the extension icons.
 *
 * The icons are drawn here rather than committed as binaries, so the whole
 * repository stays reviewable as text and `npm run build` is fully
 * reproducible. Pure Node: signed-distance fields for antialiasing and the
 * built-in zlib for PNG encoding, no image dependencies.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'public/icons');
const SIZES = [16, 32, 48, 128];

const INK = [17, 22, 29];
const EDGE = [42, 52, 66];
const GREEN = [53, 201, 139];
const PAPER = [232, 237, 243];
const MUTED = [140, 152, 168];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Antialiased coverage from a signed distance, in pixels. */
const cover = (d, aa) => clamp(0.5 - d / aa);

function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdRing = (px, py, cx, cy, r, thickness) =>
  Math.abs(sdCircle(px, py, cx, cy, r)) - thickness / 2;

function blend(dst, colour, alpha) {
  if (alpha <= 0) return;
  const a = clamp(alpha);
  for (let i = 0; i < 3; i += 1) dst[i] = dst[i] * (1 - a) + colour[i] * a;
  dst[3] = dst[3] + (1 - dst[3]) * a;
}

/** Draws one icon at `size` and returns RGBA bytes. */
function render(size) {
  const s = size;
  const aa = 1.15;
  const px = Buffer.alloc(s * s * 4);

  const u = (v) => (v / 128) * s; // the design grid is 128x128
  const c = s / 2;

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      const rgba = [0, 0, 0, 0];

      // Card
      const card = sdRoundRect(fx, fy, c, c, u(60), u(60), u(16));
      blend(rgba, EDGE, cover(card, aa));
      blend(rgba, INK, cover(card + u(2.5), aa));

      // Life-ring
      blend(rgba, GREEN, cover(sdRing(fx, fy, c, c, u(37), u(11)), aa));

      // Document lines
      blend(rgba, PAPER, cover(sdRoundRect(fx, fy, c, c - u(16), u(16), u(3.2), u(3.2)), aa));
      blend(rgba, PAPER, cover(sdRoundRect(fx, fy, c, c, u(16), u(3.2), u(3.2)), aa));
      blend(rgba, MUTED, cover(sdRoundRect(fx, fy, c - u(4.5), c + u(16), u(11.5), u(3.2), u(3.2)), aa));

      const o = (y * s + x) * 4;
      px[o] = Math.round(clamp(rgba[0], 0, 255));
      px[o + 1] = Math.round(clamp(rgba[1], 0, 255));
      px[o + 2] = Math.round(clamp(rgba[2], 0, 255));
      px[o + 3] = Math.round(clamp(rgba[3]) * 255);
    }
  }
  return px;
}

// --- minimal PNG encoder -------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), data.length + 8);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10..12 stay zero: deflate, adaptive filtering, no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // per-scanline filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(OUT, `icon${size}.png`), encodePng(size, render(size)));
  console.log(`wrote icons/icon${size}.png`);
}
