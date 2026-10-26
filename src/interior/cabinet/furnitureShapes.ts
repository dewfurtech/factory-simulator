import * as THREE from 'three';
import { FLAT, Parts } from '../../view3d/lowpoly';
import { buildCabinet } from './cabinet3d';
import { normalizeSpec, type HingeSide } from './spec';

/**
 * Flat low-poly furniture for the interior mode, drawn from a size and a main colour in the style of
 * src/view3d/furniture3d.ts. Sizes are mm (w across, d front to back, h up); every shape is a group centred in
 * x and z, standing on y = 0, front toward +z.
 */

export interface Size3mm {
  w: number;
  d: number;
  h: number;
}

export type ShapeBuilder = (size: Size3mm, color: string) => THREE.Group;

const DARK = '#3b4048';
const WOOD = '#b9895a';
const WHITE = '#f1f0ec';
const LINEN = '#ece7dc';
const GLASS = '#bfe0ee';

const m = (mm: number) => mm / 1000;

function groupOf(p: Parts, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const mesh = new THREE.Mesh(p.build(), FLAT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

/** A slightly darker and a slightly lighter version of the main colour, for cushions, legs and trim. */
function shades(color: string): { dark: string; light: string } {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const dark = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, hsl.l - 0.12));
  const light = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.12));
  return { dark: `#${dark.getHexString()}`, light: `#${light.getHexString()}` };
}

/** Seat cushions across a sofa body: one per seat, split by narrow gaps. */
function cushions(p: Parts, seats: number, x0: number, w: number, y: number, z: number, d: number, color: string) {
  const gap = 0.03;
  const cw = (w - gap * (seats - 1)) / seats;
  for (let i = 0; i < seats; i++) p.block(cw, 0.1, d, x0 + cw / 2 + i * (cw + gap), y, z, color);
}

/** A sofa of `seats` seats (1–3; by default from the width, about 0.8 m a seat). */
export function sofa(size: Size3mm, color: string, seats?: number): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const n = Math.min(3, Math.max(1, seats ?? Math.round(w / 0.8)));
  const { dark, light } = shades(color);
  const p = new Parts();
  const arm = Math.min(0.2, w * 0.12);
  const seatH = Math.min(0.42, h * 0.5);
  const back = Math.min(0.22, d * 0.3);
  p.block(w, seatH - 0.08, d, 0, 0.08, 0, dark);
  for (const s of [-1, 1]) p.block(0.05, 0.08, 0.05, s * (w / 2 - 0.06), 0, d / 2 - 0.06, DARK).block(0.05, 0.08, 0.05, s * (w / 2 - 0.06), 0, -d / 2 + 0.06, DARK);
  p.block(w, h - seatH, back, 0, seatH, -d / 2 + back / 2, color);
  for (const s of [-1, 1]) p.block(arm, Math.min(0.22, (h - seatH) * 0.7), d, s * (w / 2 - arm / 2), seatH, 0, color);
  cushions(p, n, -w / 2 + arm, w - 2 * arm, seatH - 0.08, back / 2 + 0.02, d - back - 0.06, light);
  return groupOf(p, 'sofa');
}

/** An L-shaped sofa: the long body along the back, the return running forward on the right. */
export function sofaL(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const { dark, light } = shades(color);
  const p = new Parts();
  const bodyD = Math.min(0.95, d * 0.5);
  const retW = Math.min(0.95, w * 0.4);
  const seatH = Math.min(0.42, h * 0.5);
  const back = 0.2;
  const arm = 0.18;
  // Body across the back.
  p.block(w, seatH - 0.08, bodyD, 0, 0.08, -d / 2 + bodyD / 2, dark);
  p.block(w, h - seatH, back, 0, seatH, -d / 2 + back / 2, color);
  p.block(arm, 0.2, bodyD, -w / 2 + arm / 2, seatH, -d / 2 + bodyD / 2, color);
  const bodySeats = Math.max(1, Math.round((w - retW) / 0.8));
  cushions(p, bodySeats, -w / 2 + arm, w - arm - retW, seatH - 0.08, -d / 2 + back + (bodyD - back - 0.04) / 2, bodyD - back - 0.04, light);
  // Return running toward the front on the right.
  const retD = d - bodyD;
  p.block(retW, seatH - 0.08, retD, w / 2 - retW / 2, 0.08, d / 2 - retD / 2, dark);
  p.block(back, h - seatH, retD, w / 2 - back / 2, seatH, d / 2 - retD / 2, color);
  p.block(retW, 0.2, arm, w / 2 - retW / 2, seatH, d / 2 - arm / 2, color);
  p.block(retW - back - 0.04, 0.1, retD - arm - 0.04, w / 2 - back - (retW - back - 0.04) / 2, seatH - 0.08, d / 2 - arm - (retD - arm - 0.04) / 2, light);
  // Cushion of the corner seat.
  p.block(retW - back - 0.04, 0.1, bodyD - back - 0.04, w / 2 - back - (retW - back - 0.04) / 2, seatH - 0.08, -d / 2 + back + (bodyD - back - 0.04) / 2, light);
  for (const [x, z] of [
    [-w / 2 + 0.06, -d / 2 + 0.06],
    [w / 2 - 0.06, -d / 2 + 0.06],
    [-w / 2 + 0.06, -d / 2 + bodyD - 0.06],
    [w / 2 - 0.06, d / 2 - 0.06],
    [w / 2 - retW + 0.06, d / 2 - 0.06],
  ])
    p.block(0.05, 0.08, 0.05, x, 0, z, DARK);
  return groupOf(p, 'sofa-l');
}

/** A bed: a frame with its headboard at the back, mattress, two pillows and a folded cover. */
export function bed(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const { dark } = shades(color);
  const p = new Parts();
  const frameH = Math.min(0.3, h * 0.35);
  const headT = 0.06;
  p.block(w, frameH - 0.06, d - headT, 0, 0.06, headT / 2, color);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.06, 0.06, 0.06, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.08), dark);
  p.block(w, h - frameH + 0.1, headT, 0, frameH - 0.1, -d / 2 + headT / 2, color);
  const mattressH = 0.2;
  p.block(w - 0.06, mattressH, d - headT - 0.06, 0, frameH, headT / 2, WHITE);
  const pw = Math.min(0.6, (w - 0.12) / 2 - 0.03);
  const pillows = w > 1.2 ? [-1, 1] : [0];
  for (const s of pillows) p.block(pw, 0.1, 0.4, (s * (pw + 0.06)) / 2, frameH + mattressH, -d / 2 + headT + 0.28, LINEN);
  p.block(w - 0.04, 0.05, d * 0.5, 0, frameH + mattressH, d / 2 - 0.05 - d * 0.25, dark);
  return groupOf(p, 'bed');
}

/** A table: a slab top on four legs. */
export function table(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const { dark } = shades(color);
  const p = new Parts();
  const top = 0.04;
  p.block(w, top, d, 0, h - top, 0, color);
  const leg = Math.min(0.06, w * 0.08);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(leg, h - top, leg, sx * (w / 2 - leg / 2 - 0.02), 0, sz * (d / 2 - leg / 2 - 0.02), dark);
  p.block(w - 2 * leg - 0.04, 0.08, 0.02, 0, h - top - 0.08, d / 2 - leg - 0.03, dark);
  p.block(w - 2 * leg - 0.04, 0.08, 0.02, 0, h - top - 0.08, -d / 2 + leg + 0.03, dark);
  return groupOf(p, 'table');
}

/** A chair: seat, back rest and four legs, facing the front. */
export function chair(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const { dark } = shades(color);
  const p = new Parts();
  const seatH = Math.min(0.45, h * 0.5);
  p.block(w, 0.04, d, 0, seatH - 0.04, 0, color);
  const leg = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(leg, seatH - 0.04, leg, sx * (w / 2 - leg / 2), 0, sz * (d / 2 - leg / 2), dark);
  for (const sx of [-1, 1]) p.block(leg, h - seatH, leg, sx * (w / 2 - leg / 2), seatH, -d / 2 + leg / 2, dark);
  p.block(w, Math.min(0.2, (h - seatH) * 0.5), 0.03, 0, h - Math.min(0.2, (h - seatH) * 0.5), -d / 2 + 0.015, color);
  return groupOf(p, 'chair');
}

/** A wardrobe: a tall cabinet with a door per ~500 mm of width, hinges alternating so pairs open from the middle. */
export function wardrobe(size: Size3mm, color: string): THREE.Group {
  const n = Math.max(1, Math.round(size.w / 500));
  const bays = Array.from({ length: n }, (_, i) => ({ front: { kind: 'door' as const, hinge: (i % 2 === 0 ? 'left' : 'right') as HingeSide }, shelves: 1 }));
  const spec = normalizeSpec({ kind: 'tall', width: size.w, height: size.h, depth: size.d, bays, toeKick: 60 });
  const { dark } = shades(color);
  const g = buildCabinet(spec, { colors: { front: color, carcass: dark, back: dark } });
  g.name = 'wardrobe';
  return g;
}

/** A dressing table: a low table with a drawer front, a mirror standing on it at the back. */
export function dressingTable(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const d = m(size.d);
  const h = m(size.h);
  const { dark } = shades(color);
  const tableH = Math.min(0.75, h * 0.5);
  const g = table({ w: size.w, d: size.d, h: tableH * 1000 }, color);
  const p = new Parts();
  p.block(w - 0.1, 0.1, 0.02, 0, tableH - 0.14, d / 2 - 0.05, dark);
  p.block(0.12, 0.012, 0.012, 0, tableH - 0.1, d / 2 - 0.035, DARK);
  const mirrorW = Math.min(w * 0.6, 0.7);
  const mirrorH = h - tableH - 0.04;
  p.block(mirrorW, mirrorH, 0.03, 0, tableH + 0.04, -d / 2 + 0.08, color);
  p.block(mirrorW - 0.06, mirrorH - 0.06, 0.005, 0, tableH + 0.07, -d / 2 + 0.1, GLASS);
  for (const s of [-1, 1]) p.block(0.04, 0.04, 0.14, s * (mirrorW / 2 - 0.05), tableH, -d / 2 + 0.1, dark);
  const mesh = new THREE.Mesh(p.build(), FLAT);
  mesh.castShadow = true;
  g.add(mesh);
  g.name = 'dressing-table';
  return g;
}

/** An open shelving unit: a bay per ~400 mm, a shelf about every 350 mm. */
export function shelving(size: Size3mm, color: string): THREE.Group {
  const n = Math.max(1, Math.min(4, Math.round(size.w / 400)));
  const shelves = Math.max(1, Math.round(size.h / 350) - 1);
  const spec = normalizeSpec({
    kind: 'open',
    width: size.w,
    height: size.h,
    depth: size.d,
    bays: Array.from({ length: n }, () => ({ front: { kind: 'open' as const }, shelves })),
  });
  const g = buildCabinet(spec, { colors: { carcass: color, back: shades(color).light } });
  g.name = 'shelving';
  return g;
}

/** A floor lamp: a round base, a pole and a shade at the top. */
export function floorLamp(size: Size3mm, color: string): THREE.Group {
  const w = m(size.w);
  const h = m(size.h);
  const p = new Parts();
  const shadeH = Math.min(0.3, h * 0.2);
  p.cyl(w * 0.35, 0.02, 0, 0.01, 0, DARK, 10);
  p.cyl(0.015, h - shadeH - 0.02, 0, (h - shadeH) / 2, 0, DARK, 6);
  p.cyl(w / 2, shadeH, 0, h - shadeH / 2, 0, color, 10, 'y', w * 0.35);
  p.cyl(w / 2 - 0.02, 0.01, 0, h - shadeH + 0.01, 0, '#fff4d6', 10);
  return groupOf(p, 'floor-lamp');
}

export interface FurnitureShape {
  nameTh: string;
  defaultSize: Size3mm;
  defaultColor: string;
  build: ShapeBuilder;
}

/** Every shape by id, with the size it is drawn at when nothing else is known. */
export const FURNITURE_SHAPES: Record<string, FurnitureShape> = {
  'sofa-1': { nameTh: 'โซฟา 1 ที่นั่ง', defaultSize: { w: 900, d: 850, h: 800 }, defaultColor: '#5b6b82', build: (s, c) => sofa(s, c, 1) },
  'sofa-2': { nameTh: 'โซฟา 2 ที่นั่ง', defaultSize: { w: 1600, d: 850, h: 800 }, defaultColor: '#5b6b82', build: (s, c) => sofa(s, c, 2) },
  'sofa-3': { nameTh: 'โซฟา 3 ที่นั่ง', defaultSize: { w: 2200, d: 900, h: 800 }, defaultColor: '#5b6b82', build: (s, c) => sofa(s, c, 3) },
  'sofa-l': { nameTh: 'โซฟาตัว L', defaultSize: { w: 2600, d: 1800, h: 800 }, defaultColor: '#7a8699', build: sofaL },
  bed: { nameTh: 'เตียง', defaultSize: { w: 1800, d: 2000, h: 1000 }, defaultColor: WOOD, build: bed },
  table: { nameTh: 'โต๊ะ', defaultSize: { w: 1400, d: 800, h: 750 }, defaultColor: WOOD, build: table },
  chair: { nameTh: 'เก้าอี้', defaultSize: { w: 450, d: 480, h: 900 }, defaultColor: '#8a6440', build: chair },
  wardrobe: { nameTh: 'ตู้เสื้อผ้า', defaultSize: { w: 1600, d: 600, h: 2200 }, defaultColor: '#d9cfbf', build: wardrobe },
  'dressing-table': { nameTh: 'โต๊ะเครื่องแป้ง', defaultSize: { w: 1000, d: 450, h: 1500 }, defaultColor: WHITE, build: dressingTable },
  shelving: { nameTh: 'ชั้นวางของ', defaultSize: { w: 800, d: 300, h: 1800 }, defaultColor: '#c9b391', build: shelving },
  'floor-lamp': { nameTh: 'โคมไฟตั้งพื้น', defaultSize: { w: 400, d: 400, h: 1600 }, defaultColor: '#e8d9b5', build: floorLamp },
};
