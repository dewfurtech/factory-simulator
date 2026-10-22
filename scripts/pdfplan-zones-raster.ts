// A minimal RGB rasterizer + PNG writer so preview scripts can save an image to look at without any native dependency.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import type { Vec2 } from '../src/model/types';

export class Raster {
  readonly buf: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly scale: number,
  ) {
    this.buf = new Uint8Array(w * h * 3).fill(255);
  }
  private px(x: number, y: number, rgb: [number, number, number], alpha = 1) {
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 3;
    for (let k = 0; k < 3; k++) this.buf[i + k] = Math.round(this.buf[i + k] * (1 - alpha) + rgb[k] * alpha);
  }
  line(a: Vec2, b: Vec2, rgb: [number, number, number], width = 1, alpha = 1) {
    const s = this.scale;
    const x0 = a.x * s,
      y0 = a.y * s,
      x1 = b.x * s,
      y1 = b.y * s;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = Math.floor(width / 2);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n,
        y = y0 + ((y1 - y0) * i) / n;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) this.px(x + dx, y + dy, rgb, alpha);
    }
  }
  poly(pts: Vec2[], rgb: [number, number, number], width = 1, alpha = 1, close = true) {
    for (let i = 0; i < (close ? pts.length : pts.length - 1); i++) this.line(pts[i], pts[(i + 1) % pts.length], rgb, width, alpha);
  }
  /** Even-odd scanline fill. */
  fill(pts: Vec2[], rgb: [number, number, number], alpha: number) {
    const s = this.scale;
    const ys = pts.map((p) => p.y * s);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))),
      y1 = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length];
        const ay = a.y * s,
          by = b.y * s;
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push((a.x + ((y / s - a.y) * (b.x - a.x)) / (b.y - a.y)) * s);
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x <= xs[i + 1]; x++) this.px(x, y, rgb, alpha);
    }
  }
  /** Crude 5x7 bitmap-free "text": draws a small box with the string's length so labels can be located; real text goes in the SVG. */
  mark(at: Vec2, rgb: [number, number, number], size = 6) {
    const s = this.scale;
    this.poly(
      [
        { x: at.x - size / s, y: at.y - size / s },
        { x: at.x + size / s, y: at.y - size / s },
        { x: at.x + size / s, y: at.y + size / s },
        { x: at.x - size / s, y: at.y + size / s },
      ],
      rgb,
      2,
    );
  }
  save(file: string) {
    const raw = new Uint8Array((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      raw.set(this.buf.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1);
    }
    const chunk = (type: string, data: Uint8Array) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
  }
}
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
