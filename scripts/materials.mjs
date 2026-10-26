// Draws the interior material textures (public/materials/<id>.png) procedurally: wood grain, tiles, marble, concrete,
// brick, carpet, slats, a T-bar ceiling grid. No image library and no photographs: every pixel is computed here, so
// the pictures are the project's own. 256 px square, RGB. Run with `node scripts/materials.mjs`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 256;
const OUT = 'public/materials';

/* ---------- PNG writer ---------- */
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- noise ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Tiling value noise: a lattice of `n` random values a side, read with bilinear interpolation, wrapping so the texture repeats. */
function lattice(n, seed) {
  const r = rng(seed);
  const v = Float32Array.from({ length: n * n }, () => r());
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = ((x % 1) + 1) % 1;
    const fy = ((y % 1) + 1) % 1;
    const gx = fx * n;
    const gy = fy * n;
    const x0 = Math.floor(gx) % n;
    const y0 = Math.floor(gy) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const tx = s(gx - Math.floor(gx));
    const ty = s(gy - Math.floor(gy));
    const a = v[y0 * n + x0] + (v[y0 * n + x1] - v[y0 * n + x0]) * tx;
    const b = v[y1 * n + x0] + (v[y1 * n + x1] - v[y1 * n + x0]) * tx;
    return a + (b - a) * ty;
  };
}
/** Several octaves of lattice noise, 0..1 centred on 0.5. */
function fbm(seed, octaves = 4, base = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => lattice(base * 2 ** i, seed + i * 101));
  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let total = 0;
    for (let i = 0; i < layers.length; i++) {
      sum += layers[i](x, y) * amp;
      total += amp;
      amp *= 0.5;
    }
    return sum / total;
  };
}

/* ---------- colour ---------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const shade = (c, k) => c.map((v) => v * k);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Runs `pixel(u, v)` over the square (u, v in 0..1) and writes the PNG. */
function draw(id, pixel) {
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixel((x + 0.5) / SIZE, (y + 0.5) / SIZE);
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp(r);
      buf[i + 1] = clamp(g);
      buf[i + 2] = clamp(b);
    }
  writeFileSync(`${OUT}/${id}.png`, png(SIZE, SIZE, buf));
  console.log(id);
}

/* ---------- patterns ---------- */
/** Planks across the square, grain running along x; `planks` planks a side. */
function wood(id, light, dark, planks, seed) {
  const grain = fbm(seed, 3, 2);
  const fine = lattice(64, seed + 7);
  const r = rng(seed + 3);
  const offs = Array.from({ length: planks }, () => r());
  const tone = Array.from({ length: planks }, () => 0.9 + r() * 0.2);
  const a = hex(light);
  const b = hex(dark);
  draw(id, (u, v) => {
    const p = Math.floor(v * planks);
    const inPlank = v * planks - p;
    // Grain: long waves along the plank, stretched 8:1, with a fine ripple on top.
    const g = grain(u * 0.5 + offs[p] * 3, v * 6 + offs[p] * 10);
    const streak = Math.abs(Math.sin((g * 8 + fine(u * 2, v * 2) * 0.6) * Math.PI));
    let c = mix(a, b, 0.25 + streak * 0.55);
    c = shade(c, tone[p]);
    // A dark seam between planks.
    if (inPlank < 0.02 || inPlank > 0.98) c = shade(c, 0.6);
    return c;
  });
}

/** `nx` by `ny` tiles with a grout line between them; each tile its own slight tint and a soft cloud across it. */
function tiles(id, base, grout, nx, ny, seed, { variance = 0.04, cloud = 0.05, groutW = 0.012, offsetRows = false } = {}) {
  const r = rng(seed);
  const tint = Array.from({ length: nx * ny * 2 }, () => 1 - variance / 2 + r() * variance);
  const soft = fbm(seed + 5, 3, 3);
  const a = hex(base);
  const gr = hex(grout);
  draw(id, (u, v) => {
    const row = Math.floor(v * ny);
    const uu = offsetRows && row % 2 ? u + 0.5 / nx : u;
    const col = Math.floor(uu * nx);
    const fx = uu * nx - col;
    const fy = v * ny - row;
    if (fx < groutW * nx * 0.5 || fx > 1 - groutW * nx * 0.5 || fy < groutW * ny * 0.5 || fy > 1 - groutW * ny * 0.5) return gr;
    const k = tint[((row % ny) * nx + (col % nx)) % tint.length];
    return shade(a, k * (1 - cloud / 2 + soft(u, v) * cloud));
  });
}

/** Marble: a pale ground with thin dark veins wandering through it. */
function marble(id, base, vein, seed) {
  const n = fbm(seed, 4, 2);
  const m = fbm(seed + 50, 3, 3);
  const a = hex(base);
  const b = hex(vein);
  draw(id, (u, v) => {
    const w = Math.sin((u + n(u, v) * 1.6) * Math.PI * 3 + m(u, v) * 6);
    const veinK = Math.pow(1 - Math.abs(w), 14);
    const cloud = 0.96 + m(v, u) * 0.08;
    return mix(shade(a, cloud), b, veinK * 0.8);
  });
}

/** Concrete: broad mottling with fine speckle; `trowel` adds faint curved sweeps of a polished floor. */
function concrete(id, base, seed, { contrast = 0.14, trowel = false } = {}) {
  const n = fbm(seed, 5, 2);
  const sp = lattice(128, seed + 9);
  const a = hex(base);
  draw(id, (u, v) => {
    let k = 1 - contrast / 2 + n(u, v) * contrast;
    k *= 0.97 + sp(u, v) * 0.06;
    if (trowel) k *= 0.985 + Math.abs(Math.sin((u * u + v * v) * Math.PI * 5)) * 0.03;
    return shade(a, k);
  });
}

/** Brickwork in stretcher bond: `cols` bricks across, each row half a brick over. */
function brick(id, base, mortar, cols, rows, seed, variance = 0.14) {
  const r = rng(seed);
  const tint = Array.from({ length: cols * rows * 2 }, () => 1 - variance / 2 + r() * variance);
  const grain = lattice(96, seed + 4);
  const a = hex(base);
  const m = hex(mortar);
  const gw = 0.09;
  draw(id, (u, v) => {
    const row = Math.floor(v * rows);
    const uu = row % 2 ? u + 0.5 / cols : u;
    const col = Math.floor(uu * cols);
    const fx = uu * cols - col;
    const fy = v * rows - row;
    if (fx < gw / 2 || fx > 1 - gw / 2 || fy < gw || fy > 1 - gw) return shade(m, 0.96 + grain(u, v) * 0.08);
    const k = tint[((row % rows) * cols + (col % cols)) % tint.length];
    return shade(a, k * (0.95 + grain(u * 3, v * 3) * 0.1));
  });
}

/** Carpet: dense fine speckle over a soft mottle. */
function carpet(id, base, seed) {
  const n = fbm(seed, 2, 3);
  const sp = lattice(128, seed + 1);
  const sp2 = lattice(256, seed + 2);
  const a = hex(base);
  draw(id, (u, v) => shade(a, 0.9 + n(u, v) * 0.08 + sp(u, v) * 0.08 + sp2(u, v) * 0.06));
}

/** Vertical wooden slats with a dark gap between them. */
function slats(id, light, dark, gap, n, seed) {
  const grain = fbm(seed, 3, 2);
  const r = rng(seed + 2);
  const tone = Array.from({ length: n }, () => 0.9 + r() * 0.2);
  const a = hex(light);
  const b = hex(dark);
  const g = hex(gap);
  const gapW = 0.3;
  draw(id, (u, v) => {
    const i = Math.floor(u * n);
    const f = u * n - i;
    if (f > 1 - gapW) return g;
    const streak = Math.abs(Math.sin(grain(u * 4, v * 0.4 + i) * 8 * Math.PI));
    const edge = f < 0.08 ? 0.85 : f > 1 - gapW - 0.08 ? 0.9 : 1;
    return shade(mix(a, b, 0.2 + streak * 0.5), tone[i] * edge);
  });
}

/** A suspended-ceiling grid: panels with a thin pale bar between, each panel finely speckled. */
function tbar(id, panel, bar, n, seed) {
  const sp = lattice(128, seed);
  const a = hex(panel);
  const b = hex(bar);
  draw(id, (u, v) => {
    const fx = (u * n) % 1;
    const fy = (v * n) % 1;
    if (fx < 0.03 || fy < 0.03) return b;
    return shade(a, 0.95 + sp(u, v) * 0.1);
  });
}

/** Terrazzo: a plain ground with scattered chips of a few colours. */
function terrazzo(id, base, chips, seed) {
  const r = rng(seed);
  const dots = Array.from({ length: 900 }, () => ({ x: r(), y: r(), rad: 0.004 + r() * 0.012, c: hex(chips[Math.floor(r() * chips.length)]), s: 0.6 + r() * 0.8 }));
  const a = hex(base);
  const n = lattice(64, seed + 1);
  draw(id, (u, v) => {
    for (const d of dots) {
      // Wrapping distance so chips at the edge continue on the far side.
      const dx = Math.abs(u - d.x);
      const dy = Math.abs(v - d.y);
      const ex = Math.min(dx, 1 - dx) / d.s;
      const ey = Math.min(dy, 1 - dy) * d.s;
      if (ex * ex + ey * ey < d.rad * d.rad) return d.c;
    }
    return shade(a, 0.97 + n(u, v) * 0.06);
  });
}

/* ---------- the set ---------- */
mkdirSync(OUT, { recursive: true });
wood('oak', '#d9b98a', '#a97c4f', 6, 11);
wood('walnut', '#7a5236', '#3f2a1b', 6, 12);
wood('ash-grey', '#c9c3bb', '#8f8880', 6, 13);
wood('teak', '#b8824a', '#6f4a29', 6, 14);
tiles('tile-white-600', '#f1f0ec', '#c9c7c1', 2, 2, 21, { variance: 0.03 });
tiles('tile-grey-600', '#9ea2a6', '#6f7378', 2, 2, 22, { variance: 0.05 });
tiles('tile-charcoal-600', '#4a4d52', '#2b2d31', 2, 2, 23, { variance: 0.06 });
tiles('wood-tile', '#c9a57a', '#8a6a48', 1, 6, 24, { variance: 0.1, cloud: 0.12, groutW: 0.006 });
terrazzo('terrazzo', '#e6e2da', ['#7c7a76', '#b89a7a', '#4e4a46', '#d8c7b0', '#9aa39b'], 25);
marble('marble-white', '#f2f0ec', '#8f9298', 31);
marble('marble-black', '#2e3034', '#9ea3aa', 32);
concrete('concrete-polished', '#b9b7b1', 41, { contrast: 0.12, trowel: true });
concrete('concrete-raw', '#a7a49e', 42, { contrast: 0.22 });
carpet('carpet-grey', '#8e9097', 51);
carpet('carpet-beige', '#c9b89f', 52);
brick('brick-red', '#a8563c', '#cfc6b8', 3, 9, 61);
brick('brick-white', '#ebe7e0', '#cfcac2', 3, 9, 62, 0.06);
tiles('subway-white', '#f3f2ee', '#b9b6af', 4, 8, 63, { variance: 0.03, cloud: 0.06, groutW: 0.01, offsetRows: true });
slats('wood-slats', '#c89b68', '#8a6136', '#2a241f', 10, 71);
tbar('tbar-600', '#f4f3ef', '#d4d2cc', 2, 81);
