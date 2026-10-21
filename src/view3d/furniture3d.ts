import * as THREE from 'three';
import type { Size3 } from '../model/types';
import { Parts } from './lowpoly';

const WOOD = '#b9895a';
const WOOD_D = '#8a6440';
const STEEL = '#9aa3ad';
const DARK = '#3b4048';
const WHITE = '#f1f0ec';
const BLUE = '#3b6fb6';
const ORANGE = '#e8742a';
const FABRIC = '#5b6b82';

type Builder = (p: Parts, w: number, d: number, h: number) => void;

function chair(p: Parts, x: number, z: number, faceZ: 1 | -1, color = DARK) {
  p.block(0.46, 0.08, 0.46, x, 0.42, z, color);
  p.box(0.46, 0.5, 0.06, x, 0.72, z + faceZ * 0.22, color);
  p.cyl(0.03, 0.42, x, 0.21, z, STEEL, 5);
  p.box(0.5, 0.03, 0.06, x, 0.02, z, STEEL);
  p.box(0.06, 0.03, 0.5, x, 0.02, z, STEEL);
}

function table(p: Parts, w: number, d: number, h: number, top = WOOD, leg = DARK) {
  p.block(w, 0.04, d, 0, h - 0.04, 0, top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.05, h - 0.04, 0.05, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), leg);
}

const BUILDERS: Record<string, Builder> = {
  desk(p, w, d, h) {
    // The desk takes the back of the box, the chair the front.
    const dd = Math.min(0.75, d * 0.55);
    const z0 = -d / 2 + dd / 2;
    p.block(w, 0.04, dd, 0, h - 0.04, z0, WHITE);
    p.block(0.04, h - 0.04, dd, -w / 2 + 0.02, 0, z0, DARK);
    p.block(0.04, h - 0.04, dd, w / 2 - 0.02, 0, z0, DARK);
    p.block(0.4, 0.5, dd - 0.05, w / 2 - 0.25, 0, z0, '#d9d6cf');
    p.block(0.55, 0.32, 0.03, 0, h + 0.1, z0 - dd / 2 + 0.12, '#111827');
    p.block(0.08, 0.1, 0.08, 0, h, z0 - dd / 2 + 0.14, DARK);
    p.block(0.4, 0.02, 0.14, 0, h, z0 + 0.05, '#cbd5e1');
    chair(p, 0, d / 2 - 0.3, 1, '#334155');
  },
  'meeting-table'(p, w, d, h) {
    const tw = w - 0.6;
    const td = d - 1.2;
    table(p, tw, td, h, WOOD_D);
    // About 0.7 m a seat, so a longer table seats more.
    const n = Math.max(3, Math.round(tw / 0.7));
    for (let i = 0; i < n; i++) {
      const x = -tw / 2 + (tw / n) * (i + 0.5);
      chair(p, x, d / 2 - 0.3, 1, FABRIC);
      chair(p, x, -d / 2 + 0.3, -1, FABRIC);
    }
  },
  'canteen-table'(p, w, d, h) {
    const td = Math.max(0.7, d - 0.9);
    table(p, w, td, h, '#e6d3b3', STEEL);
    for (const s of [-1, 1]) {
      p.block(w, 0.05, 0.3, 0, 0.42, s * (d / 2 - 0.15), '#c08a4a');
      p.block(0.05, 0.42, 0.25, -w / 2 + 0.15, 0, s * (d / 2 - 0.15), STEEL);
      p.block(0.05, 0.42, 0.25, w / 2 - 0.15, 0, s * (d / 2 - 0.15), STEEL);
    }
  },
  // A swivel task chair: five-star base on casters, gas lift, padded seat, curved mesh back and armrests.
  'office-chair'(p, w, d, h) {
    const r = Math.min(w, d) / 2 - 0.04;
    const seatY = Math.min(0.47, h * 0.45);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      const [cx, cz] = [Math.cos(a) * r, Math.sin(a) * r];
      p.box(r, 0.04, 0.05, cx / 2, 0.09, cz / 2, DARK, -a);
      p.cyl(0.03, 0.04, cx, 0.03, cz, '#111827', 6, 'x');
      p.block(0.03, 0.04, 0.03, cx, 0.05, cz, STEEL);
    }
    p.cyl(0.05, 0.08, 0, 0.1, 0, DARK, 7);
    p.cyl(0.025, seatY - 0.16, 0, 0.14 + (seatY - 0.16) / 2, 0, STEEL, 6);
    p.block(0.2, 0.04, 0.2, 0, seatY - 0.06, 0, DARK);
    p.block(0.48, 0.08, 0.46, 0, seatY - 0.02, 0.02, '#334155');
    p.block(0.44, 0.02, 0.4, 0, seatY + 0.06, 0.03, '#3f4b5f');
    // The back stands on a spine from under the seat; its top tips back a little.
    const backZ = -0.23;
    p.block(0.05, 0.22, 0.04, 0, seatY - 0.04, backZ - 0.02, DARK);
    const backH = Math.max(0.35, h - seatY - 0.12);
    p.box(0.44, backH, 0.05, 0, seatY + 0.16 + backH / 2, backZ, '#1f2937');
    p.box(0.38, backH - 0.08, 0.02, 0, seatY + 0.16 + backH / 2, backZ + 0.03, '#475569');
    p.box(0.3, 0.06, 0.04, 0, seatY + 0.2, backZ + 0.03, '#334155');
    for (const s of [-1, 1]) {
      p.block(0.03, 0.2, 0.03, s * 0.25, seatY, -0.02, DARK);
      p.block(0.06, 0.03, 0.26, s * 0.25, seatY + 0.2, 0.01, '#1f2937');
    }
  },
  cabinet(p, w, d, h) {
    p.block(w, h, d, 0, 0, 0, '#cfd3d8');
    for (let i = 1; i < 4; i++) p.box(w - 0.04, 0.01, 0.01, 0, (h / 4) * i, d / 2 + 0.005, '#8b929b');
    for (let i = 0; i < 4; i++) p.box(0.12, 0.02, 0.02, 0, (h / 4) * (i + 0.5), d / 2 + 0.015, DARK);
  },
  reception(p, w, d, h) {
    const cd = Math.min(0.6, d * 0.45);
    const z = d / 2 - cd / 2;
    p.block(w, h, cd, 0, 0, z, WHITE);
    p.block(w + 0.04, 0.04, cd + 0.1, 0, h, z, WOOD);
    p.block(w * 0.8, 0.05, 0.05, 0, h * 0.55, z + cd / 2 + 0.01, ORANGE);
    p.block(w * 0.8, 0.03, 0.5, 0, 0.72, z - cd / 2 - 0.25, WOOD);
    p.block(0.5, 0.3, 0.03, -0.4, 0.78, z - cd / 2 - 0.1, '#111827');
    chair(p, -0.4, -d / 2 + 0.35, -1, '#334155');
  },
  sofa(p, w, d, h) {
    p.block(w, 0.4, d, 0, 0, 0, FABRIC);
    p.block(w, h - 0.4, 0.2, 0, 0.4, -d / 2 + 0.1, FABRIC);
    p.block(0.18, 0.25, d, -w / 2 + 0.09, 0.4, 0, '#4b5a70');
    p.block(0.18, 0.25, d, w / 2 - 0.09, 0.4, 0, '#4b5a70');
    for (let i = 0; i < 3; i++) p.block(w / 3 - 0.06, 0.1, d - 0.25, -w / 3 + (w / 3) * i, 0.4, 0.08, '#6b7c95');
  },
  display(p, w, d, h) {
    p.block(w, h * 0.9, d, 0, 0, 0, WHITE);
    p.block(w + 0.02, 0.04, d + 0.02, 0, h * 0.9, 0, DARK);
    p.block(w * 0.5, h * 0.12, d * 0.5, 0, h * 0.9 + 0.04, 0, '#c8a46e');
    p.block(w * 0.4, 0.02, 0.02, 0, h * 0.2, d / 2 + 0.01, ORANGE);
  },
  workbench(p, w, d, h) {
    table(p, w, d, h, '#8f6a42', BLUE);
    p.block(w - 0.1, 0.03, d - 0.1, 0, 0.18, 0, BLUE);
    p.block(w, 0.7, 0.03, 0, h, -d / 2 + 0.02, '#5d6b7a');
    p.block(0.25, 0.15, 0.2, -w / 3, h, 0, '#b91c1c');
    p.block(0.3, 0.08, 0.2, w / 4, h, 0.05, DARK);
  },
  'qc-table'(p, w, d, h) {
    table(p, w, d, h, WHITE, STEEL);
    p.block(0.4, 0.25, 0.3, -w / 4, h, -0.1, DARK);
    p.cyl(0.03, 0.45, w / 4, h + 0.22, -d / 2 + 0.1, STEEL, 5);
    p.cyl(0.12, 0.05, w / 4, h + 0.45, -d / 2 + 0.25, '#e2e8f0', 7);
    p.block(0.5, 0.02, 0.35, 0.1, h, 0.1, '#c8a46e');
  },
  'tool-cabinet'(p, w, d, h) {
    p.block(w, h, d, 0, 0, 0, '#b91c1c');
    for (let i = 1; i < 6; i++) p.box(w - 0.04, 0.012, 0.01, 0, (h / 6) * i, d / 2 + 0.005, '#7f1d1d');
    for (let i = 0; i < 6; i++) p.box(0.2, 0.02, 0.02, 0, (h / 6) * (i + 0.5), d / 2 + 0.015, STEEL);
  },
  conveyor(p, w, d, h) {
    p.block(w, 0.06, d, 0, h - 0.06, 0, '#2b2d30');
    p.block(w, 0.12, 0.05, 0, h - 0.1, d / 2 - 0.025, STEEL);
    p.block(w, 0.12, 0.05, 0, h - 0.1, -d / 2 + 0.025, STEEL);
    const legs = Math.max(2, Math.round(w / 1));
    for (let i = 0; i < legs; i++) {
      const x = -w / 2 + 0.1 + ((w - 0.2) / (legs - 1)) * i;
      p.block(0.05, h - 0.1, 0.05, x, 0, d / 2 - 0.05, STEEL).block(0.05, h - 0.1, 0.05, x, 0, -d / 2 + 0.05, STEEL);
    }
    p.block(0.6, 0.05, 0.45, -w / 4, h, 0, '#d8cbb3');
  },
  rack(p, w, d, h) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.08, h, 0.08, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04), BLUE);
    const levels = 3;
    for (let i = 0; i < levels; i++) {
      const y = 0.15 + (h / levels) * i;
      p.block(w, 0.1, 0.06, 0, y, d / 2 - 0.04, ORANGE).block(w, 0.1, 0.06, 0, y, -d / 2 + 0.04, ORANGE);
      for (const x of [-w / 4, w / 4]) {
        p.block(w / 2 - 0.2, 0.12, d - 0.1, x, y + 0.1, 0, '#c19a6b');
        p.block(w / 2 - 0.3, h / levels - 0.45, d - 0.25, x, y + 0.22, 0, i % 2 ? '#d8c9a7' : '#cdb48c');
      }
    }
  },
  shelf(p, w, d, h) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.04, h, 0.04, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02), STEEL);
    for (let i = 0; i < 4; i++) {
      const y = 0.1 + ((h - 0.15) / 3) * i;
      p.block(w, 0.03, d, 0, y, 0, '#cbd5e1');
      if (i < 3) p.block(w * 0.35, 0.25, d * 0.7, -w / 4 + (i % 2) * 0.3, y + 0.03, 0, i % 2 ? '#d6b98c' : '#7aa2c8');
    }
  },
  pallet(p, w, d, h) {
    p.block(w, 0.14, d, 0, 0, 0, '#a77b4f');
    p.block(w - 0.05, h - 0.14, d - 0.05, 0, 0.14, 0, '#e3d3b5');
    for (let i = 1; i < 6; i++) p.box(w - 0.04, 0.005, d - 0.04, 0, 0.14 + ((h - 0.14) / 6) * i, 0, '#cdb48c');
  },
  forklift(p, w, d, h) {
    const bw = w * 0.62;
    p.block(bw, 0.9, d, w / 2 - bw / 2, 0.25, 0, '#f2b705');
    p.block(bw * 0.55, 0.06, d, w / 2 - bw * 0.35, h - 0.06, 0, DARK);
    for (const sz of [-1, 1]) p.block(0.05, h - 1.15, 0.05, w / 2 - bw * 0.1, 1.15, sz * (d / 2 - 0.08), DARK).block(0.05, h - 1.15, 0.05, w / 2 - bw * 0.6, 1.15, sz * (d / 2 - 0.08), DARK);
    p.block(0.08, h - 0.1, d * 0.7, -w / 2 + bw * 0.06 + (w - bw) - 0.05, 0.1, 0, '#2b2d30');
    for (const sz of [-0.25, 0.25]) p.block(w - bw, 0.05, 0.12, -w / 2 + (w - bw) / 2, 0.08, sz * d, '#2b2d30');
    for (const x of [w / 2 - 0.25, w / 2 - bw + 0.25]) for (const sz of [-1, 1]) p.cyl(0.25, 0.2, x, 0.25, sz * (d / 2 - 0.1), '#1f2937', 8, 'z');
    p.block(0.4, 0.3, 0.4, w / 2 - bw * 0.45, 1.15, 0, DARK);
  },
  'time-clock'(p, w, d, h) {
    p.block(0.08, h - 0.3, 0.08, 0, 0, -d / 2 + 0.06, STEEL);
    p.block(w * 0.6, 0.35, d * 0.7, 0, h - 0.35, 0, DARK);
    p.box(w * 0.4, 0.15, 0.01, 0, h - 0.15, d * 0.35 + 0.01, '#38bdf8');
    p.box(0.12, 0.08, 0.02, 0, h - 0.3, d * 0.35 + 0.01, '#16a34a');
  },
  locker(p, w, d, h) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      p.block(w / n - 0.02, h, d, x, 0, 0, i % 2 ? '#7a9cc6' : '#6b8fbd');
      p.box(0.02, 0.18, 0.02, x + w / n / 2 - 0.08, h * 0.55, d / 2 + 0.01, STEEL);
      for (let k = 0; k < 3; k++) p.box(w / n - 0.12, 0.01, 0.005, x, h - 0.12 - k * 0.04, d / 2 + 0.003, '#4b6a96');
    }
  },
  toilet(p, w, d, h) {
    p.block(0.04, h, d, -w / 2 + 0.02, 0, 0, '#cbd5e1');
    p.block(0.04, h, d, w / 2 - 0.02, 0, 0, '#cbd5e1');
    p.block(w, h, 0.04, 0, 0, -d / 2 + 0.02, '#e2e8f0');
    p.block(w - 0.1, h - 0.15, 0.04, 0, 0.15, d / 2 - 0.02, '#94a3b8');
    p.block(0.38, 0.4, 0.55, 0, 0, -d / 2 + 0.35, WHITE);
    p.block(0.4, 0.35, 0.18, 0, 0.4, -d / 2 + 0.1, WHITE);
  },
  sink(p, w, d, h) {
    p.block(w, 0.08, d, 0, h - 0.08, 0, WHITE);
    p.block(w, h - 0.08, d - 0.05, 0, 0, -0.025, '#d6d3cd');
    const n = Math.max(1, Math.round(w / 0.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      p.block(0.35, 0.02, 0.28, x, h, 0.05, '#cbd5e1');
      p.cyl(0.015, 0.2, x, h + 0.1, -d / 2 + 0.08, STEEL, 5);
    }
    p.block(w, 0.6, 0.02, 0, h + 0.4, -d / 2 + 0.01, '#bfe3f2');
  },
  water(p, w, d, h) {
    p.block(w, h - 0.35, d, 0, 0, 0, WHITE);
    p.cyl(w * 0.38, 0.4, 0, h - 0.18, 0, '#7cc4e8', 8);
    p.box(w * 0.5, 0.06, 0.02, 0, h - 0.55, d / 2 + 0.01, '#2563eb');
  },
  plant(p, w, _d, h) {
    p.cyl(w * 0.3, 0.4, 0, 0.2, 0, '#e2e8f0', 7, 'y', w * 0.36);
    p.ico(w * 0.42, 0, 0.4 + (h - 0.4) * 0.45, 0, '#3f8f4a');
    p.ico(w * 0.3, w * 0.1, 0.4 + (h - 0.4) * 0.8, 0.05, '#56a85f');
  },
  // A plain pale block: a stand-in for anything not in the library (a machine read off a plan before its model is picked).
  box(p, w, d, h) {
    p.block(w, h, d, 0, 0, 0, '#f1f3f5');
  },
  // A straight flight rising from the front (+z) to the back, one riser above its last tread onto whatever
  // it arrives at; each tread a block with a sloping underside, so a flight set on a landing doesn't read as a slab.
  stairs(p, w, d, h) {
    const n = Math.max(2, Math.round(h / 0.178));
    const r = h / n;
    const t = d / (n - 1);
    for (let i = 0; i < n - 1; i++) {
      const top = (i + 1) * r;
      const bottom = Math.max(0, top - r - 0.18);
      p.block(w, top - bottom, t, 0, bottom, d / 2 - t * (i + 0.5), i % 2 ? '#c8c2b8' : '#d4cec4');
    }
  },
  'stair-landing'(p, w, d, h) {
    p.block(w, h, d, 0, 0, 0, '#d4cec4');
  },
  'floor-slab'(p, w, d, h) {
    p.block(w, h, d, 0, 0, 0, '#d9d3c7');
  },
  railing(p, w, d, h) {
    const n = Math.max(1, Math.round(w / 1.2));
    for (let i = 0; i <= n; i++) p.block(0.04, h, 0.04, -w / 2 + (w / n) * i, 0, 0, DARK);
    p.block(w, 0.05, Math.max(d, 0.05), 0, h - 0.05, 0, DARK);
    p.block(w, 0.03, 0.03, 0, h * 0.5, 0, DARK);
  },
  // An area marked out on the hall floor: a faint tint inside a painted green border, as on the drawing.
  'zone-area'(p, w, d) {
    p.block(w, 0.004, d, 0, 0, 0, '#dfeedd');
    const t = 0.1;
    for (const s of [-1, 1]) {
      p.block(w, 0.008, t, 0, 0, s * (d / 2 - t / 2), '#2f9e44');
      p.block(t, 0.008, d, s * (w / 2 - t / 2), 0, 0, '#2f9e44');
    }
  },
  'floor-mark'(p, w, d) {
    p.block(w, 0.01, d, 0, 0, 0, '#f2c218');
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 0; i < n; i++) p.box(0.28, 0.012, d * 0.9, -w / 2 + (w / n) * (i + 0.5), 0.006, 0, '#1f2937', 0.6);
  },
};

const cache = new Map<string, THREE.BufferGeometry>();

/** The low-poly geometry of a built-in piece at the given size (mm), centred, standing on y = 0, front toward +z. */
export function builtinGeometry(assetId: string, size: Size3): THREE.BufferGeometry {
  const key = `${assetId}:${size.w}x${size.d}x${size.h}`;
  let g = cache.get(key);
  if (!g) {
    const p = new Parts();
    (BUILDERS[assetId] ?? BUILDERS.box)(p, size.w / 1000, size.d / 1000, size.h / 1000);
    g = p.build();
    g.userData.shared = true;
    cache.set(key, g);
  }
  return g;
}
