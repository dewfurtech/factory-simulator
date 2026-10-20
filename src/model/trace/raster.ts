/** A one-bit image, row-major: 1 where there is ink. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

/** An 8-bit grey image, row-major, 0 black. */
export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

export const emptyMask = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });

/** The grey level that best splits a scan into paper and ink (Otsu's method). */
export function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Walls are drawn in near-black; coloured floors, lawns and shading sit above this whatever the image's own split. */
const DARKEST_FILL = 120;

export function inkMask({ w, h, data }: Gray): Mask {
  const t = Math.min(otsu(data), DARKEST_FILL);
  const m = emptyMask(w, h);
  for (let i = 0; i < data.length; i++) m.data[i] = data[i] <= t ? 1 : 0;
  return m;
}

/** How much darker than its surroundings a pixel must be to count as part of a drawn line. */
const LINE_CONTRAST = 35;

/**
 * Drawn lines, however faint: pixels clearly darker than the mean of the (2r+1)² box around them. Flat fills,
 * whatever their colour, have nothing darker around them to stand out from.
 */
export function lineMask({ w, h, data }: Gray, r: number): Mask {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const m = emptyMask(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      if (data[y * w + x] < mean - LINE_CONTRAST) m.data[y * w + x] = 1;
    }
  }
  return m;
}

/** Summed-area table, (w+1)×(h+1), so any box's ink count is four lookups. */
function integral(m: Mask): Int32Array {
  const { w, h, data } = m;
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return I;
}

/** Ink in the box [x0, x1) × [y0, y1), clipped to the image. */
function boxSum(I: Int32Array, m: Mask, x0: number, y0: number, x1: number, y1: number): number {
  const W = m.w + 1;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(m.w, x1);
  y1 = Math.min(m.h, y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
}

/** Keeps a pixel only where the whole (2rx+1)×(2ry+1) box around it is ink; off-image counts as paper. */
export function erode(m: Mask, rx: number, ry: number): Mask {
  const I = integral(m);
  const out = emptyMask(m.w, m.h);
  const full = (2 * rx + 1) * (2 * ry + 1);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x] && boxSum(I, m, x - rx, y - ry, x + rx + 1, y + ry + 1) === full) out.data[y * m.w + x] = 1;
  return out;
}

/** Inks every pixel with any ink in the (2rx+1)×(2ry+1) box around it. */
export function dilate(m: Mask, rx: number, ry: number): Mask {
  const I = integral(m);
  const out = emptyMask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (boxSum(I, m, x - rx, y - ry, x + rx + 1, y + ry + 1) > 0) out.data[y * m.w + x] = 1;
  return out;
}

export function union(a: Mask, b: Mask): Mask {
  const out = emptyMask(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] | b.data[i];
  return out;
}

export function minus(a: Mask, b: Mask): Mask {
  const out = emptyMask(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] & (b.data[i] ^ 1);
  return out;
}

/** Removes ink strokes the box can't fit inside. */
export const open = (m: Mask, rx: number, ry: number) => dilate(erode(m, rx, ry), rx, ry);
/** Fills paper gaps narrower than the box. */
export const close = (m: Mask, rx: number, ry: number) => erode(dilate(m, rx, ry), rx, ry);

export interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  /** Mean pixel position. */
  cx: number;
  cy: number;
  /** Indices of the region's pixels. */
  pixels: number[];
}

/** 4-connected ink regions. */
export function components(m: Mask): Component[] {
  const { w, h, data } = m;
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!data[start] || seen[start]) continue;
    const c: Component = { minX: w, minY: h, maxX: 0, maxY: 0, area: 0, cx: 0, cy: 0, pixels: [] };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      c.pixels.push(i);
      c.area++;
      c.cx += x;
      c.cy += y;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && data[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    c.cx /= c.area;
    c.cy /= c.area;
    out.push(c);
  }
  return out;
}

/** Whether there is ink within r pixels of (x, y). */
export function inkNear(m: Mask, x: number, y: number, r: number): boolean {
  const x0 = Math.max(0, Math.round(x - r));
  const x1 = Math.min(m.w - 1, Math.round(x + r));
  const y0 = Math.max(0, Math.round(y - r));
  const y1 = Math.min(m.h - 1, Math.round(y + r));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (m.data[yy * m.w + xx]) return true;
  return false;
}

/** The image at 1/f of its size, each pixel the mean of the f×f block it stands for. */
export function shrink({ w, h, data }: Gray, f: number): Gray {
  if (f <= 1) return { w, h, data };
  const sw = Math.floor(w / f);
  const sh = Math.floor(h / f);
  const out = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) sum += data[(y * f + j) * w + x * f + i];
      out[y * sw + x] = sum / (f * f);
    }
  }
  return { w: sw, h: sh, data: out };
}
