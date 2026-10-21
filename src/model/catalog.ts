import { CATEGORIES, MACHINES } from '../machines/data.js';
import SIZES from '../machines/sizes.json';
import type { Mm, PlacedObject, Size3, Vec2 } from './types';
import { add, fromAngle, perp, scale } from './vec';

/** What people do at a thing in the simulation. */
export type UseKind =
  | 'machine'
  | 'desk'
  | 'meeting'
  | 'eat'
  | 'wait'
  | 'reception'
  | 'storage'
  | 'bench'
  | 'qc'
  | 'locker'
  | 'clock'
  | 'toilet'
  | 'water'
  | 'file'
  | 'tools'
  | 'display';

export type CatalogGroup = 'nesting' | 'edge' | 'drill' | 'other' | 'office' | 'production' | 'storage' | 'amenity' | 'decor';

export const GROUP_LABEL: Record<CatalogGroup, string> = {
  nesting: 'CNC Nesting (Rakete)',
  edge: 'Edge Banding (Booster / Moon)',
  drill: 'CNC Drilling (Nova)',
  other: 'เครื่องเสริม',
  office: 'สำนักงาน',
  production: 'โต๊ะงาน / ผลิต',
  storage: 'คลัง / จัดเก็บ',
  amenity: 'พนักงาน / ส่วนกลาง',
  decor: 'อื่น ๆ',
};

export interface CatalogItem {
  id: string;
  label: string;
  group: CatalogGroup;
  size: Size3;
  use?: UseKind;
  /** Mastrox machines: the model's plan-centre offset from its origin, in mm, so it sits centred in its box. */
  modelCenter?: [Mm, Mm];
  summary?: string;
  /** People that can use it at once (seats, stalls); 1 when absent. */
  seats?: number;
  /** Walkable: left out of the navigation grid (rugs, floor markings). */
  open?: boolean;
  /** A machine that runs without an operator (air compressor). */
  unattended?: boolean;
  /** Above head height (an upper floor, its railings): drawn as a dashed outline on the plan and walked under. */
  overhead?: boolean;
}

const sizes = SIZES as unknown as Record<string, { size: [Mm, Mm, Mm]; center: [Mm, Mm] }>;

const machineItems: CatalogItem[] = MACHINES.filter((m) => sizes[m.id]).map((m) => ({
  id: m.id,
  label: m.name,
  group: m.cat as CatalogGroup,
  size: { w: sizes[m.id].size[0], d: sizes[m.id].size[1], h: sizes[m.id].size[2] },
  modelCenter: sizes[m.id].center,
  use: 'machine' as const,
  summary: m.summary,
  ...(m.id.startsWith('vair') && { unattended: true }),
}));

const S = (w: Mm, d: Mm, h: Mm): Size3 => ({ w, d, h });

const builtins: CatalogItem[] = [
  { id: 'desk', label: 'โต๊ะทำงาน + เก้าอี้', group: 'office', size: S(1400, 1300, 750), use: 'desk' },
  { id: 'meeting-table', label: 'โต๊ะประชุม 6 ที่', group: 'office', size: S(3000, 2400, 750), use: 'meeting', seats: 6 },
  { id: 'office-chair', label: 'เก้าอี้สำนักงาน (ล้อเลื่อน)', group: 'office', size: S(650, 650, 1050) },
  { id: 'cabinet', label: 'ตู้เอกสาร', group: 'office', size: S(900, 450, 1800), use: 'file' },
  { id: 'reception', label: 'เคาน์เตอร์ต้อนรับ', group: 'office', size: S(2400, 1500, 1100), use: 'reception' },
  { id: 'sofa', label: 'โซฟารับแขก', group: 'office', size: S(1800, 850, 800), use: 'wait', seats: 3 },
  { id: 'display', label: 'แท่นโชว์สินค้า', group: 'office', size: S(1200, 1200, 900), use: 'display' },
  { id: 'workbench', label: 'โต๊ะช่าง', group: 'production', size: S(1800, 750, 900), use: 'bench' },
  { id: 'qc-table', label: 'โต๊ะตรวจ QC', group: 'production', size: S(1600, 800, 900), use: 'qc' },
  { id: 'tool-cabinet', label: 'ตู้เครื่องมือช่าง', group: 'production', size: S(1200, 500, 1800), use: 'tools' },
  { id: 'conveyor', label: 'สายพานลำเลียง', group: 'production', size: S(3000, 700, 800) },
  { id: 'rack', label: 'ชั้นวางพาเลท', group: 'storage', size: S(2700, 1100, 3000), use: 'storage' },
  { id: 'shelf', label: 'ชั้นวางของ', group: 'storage', size: S(1800, 600, 2000), use: 'storage' },
  { id: 'pallet', label: 'พาเลทวางแผ่นไม้', group: 'storage', size: S(2500, 1250, 600), use: 'storage' },
  { id: 'forklift', label: 'รถโฟล์คลิฟท์ (จอด)', group: 'storage', size: S(2300, 1100, 2100) },
  { id: 'time-clock', label: 'เครื่องสแกนเข้างาน', group: 'amenity', size: S(500, 300, 1500), use: 'clock' },
  { id: 'locker', label: 'ตู้ล็อกเกอร์', group: 'amenity', size: S(1800, 500, 1800), use: 'locker', seats: 4 },
  { id: 'canteen-table', label: 'โต๊ะอาหาร + ม้านั่ง', group: 'amenity', size: S(1800, 1600, 750), use: 'eat', seats: 6 },
  { id: 'toilet', label: 'ห้องสุขา', group: 'amenity', size: S(1000, 1500, 2000), use: 'toilet' },
  { id: 'sink', label: 'อ่างล้างมือ', group: 'amenity', size: S(1500, 550, 900) },
  { id: 'water', label: 'ตู้น้ำดื่ม', group: 'amenity', size: S(450, 450, 1150), use: 'water' },
  { id: 'plant', label: 'ต้นไม้', group: 'decor', size: S(600, 600, 1300) },
  { id: 'box', label: 'กล่อง / บล็อก', group: 'decor', size: S(1000, 1000, 1000) },
  { id: 'floor-mark', label: 'เส้นตีพื้นทางเดิน', group: 'decor', size: S(4000, 1500, 5), open: true },
  { id: 'zone-area', label: 'พื้นที่ตีเส้น (โซนงาน)', group: 'decor', size: S(6000, 4000, 5), open: true },
  { id: 'stairs', label: 'บันได (ช่วงตรง)', group: 'decor', size: S(1100, 3000, 1800) },
  { id: 'stair-landing', label: 'ชานพักบันได', group: 'decor', size: S(1100, 1100, 1100) },
  { id: 'floor-slab', label: 'พื้นชั้นลอย / ชั้น 2', group: 'decor', size: S(6000, 4000, 200), open: true, overhead: true },
  { id: 'railing', label: 'ราวกันตก', group: 'decor', size: S(3000, 50, 1000), overhead: true },
];

export const CATALOG: CatalogItem[] = [...machineItems, ...builtins];
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export const catalogItem = (id: string): CatalogItem | undefined => BY_ID.get(id);
export const isMachine = (o: Pick<PlacedObject, 'assetId'>) => BY_ID.get(o.assetId)?.use === 'machine';
/** A machine someone has to run. */
export const needsOperator = (o: Pick<PlacedObject, 'assetId'>) => isMachine(o) && !BY_ID.get(o.assetId)?.unattended;
export const useOf = (o: Pick<PlacedObject, 'assetId'>): UseKind | undefined => BY_ID.get(o.assetId)?.use;

/** A Mastrox machine's brochure data (price, specs, weight), from machines/data.js. */
export interface MachineInfo {
  id: string;
  name: string;
  cat: string;
  tier?: string;
  kind?: string;
  price: number | null;
  priceNote?: string;
  size: [Mm, Mm, Mm] | null;
  weight: number | null;
  summary?: string;
  look?: string;
  modelNote?: string;
  stations?: string[];
  specs: Record<string, string>;
}
const INFO = new Map((MACHINES as unknown as MachineInfo[]).map((m) => [m.id, m]));
export const machineInfo = (assetId: string): MachineInfo | undefined => INFO.get(assetId);

export const MACHINE_CATEGORIES = CATEGORIES as { id: string; name: string; series: string }[];

export const GROUP_ORDER: CatalogGroup[] = ['nesting', 'edge', 'drill', 'other', 'office', 'production', 'storage', 'amenity', 'decor'];

/** A point in the object's own frame (x along its width, y toward its front) in plan coordinates. */
export function localToPlan(o: Pick<PlacedObject, 'x' | 'y' | 'rotation'>, lx: Mm, ly: Mm): Vec2 {
  const u = fromAngle(o.rotation);
  return add(add({ x: o.x, y: o.y }, scale(u, lx)), scale(perp(u), ly));
}

export interface Spot {
  /** Where the person ends up, possibly inside the object's footprint (a chair). */
  at: Vec2;
  /** Where they walk to before stepping onto `at`: a free spot just outside the footprint. */
  approach: Vec2;
  /** Plan angle the person faces once there. */
  facing: number;
}

const GAP: Mm = 450;

/** The places people stand or sit at an object: one per seat, in front of it by default. */
export function spotsOf(o: PlacedObject): Spot[] {
  const item = catalogItem(o.assetId);
  const hw = o.size.w / 2;
  const hd = o.size.d / 2;
  // Facing the object means looking along its −front direction.
  const faceIn = o.rotation - Math.PI / 2;
  const faceOut = o.rotation + Math.PI / 2;
  const front = (lx: Mm): Spot => ({ at: localToPlan(o, lx, hd + GAP), approach: localToPlan(o, lx, hd + GAP), facing: faceIn });
  switch (item?.use) {
    case 'desk':
      // The chair is part of the desk's box, at its front half.
      return [{ at: localToPlan(o, 0, hd - 300), approach: localToPlan(o, 0, hd + GAP), facing: faceIn }];
    case 'reception':
      // Staff stand behind the counter (its back half); visitors come to the front.
      return [{ at: localToPlan(o, 0, -hd + 350), approach: localToPlan(o, hw + GAP, -hd + 350), facing: faceOut }, front(0)];
    case 'wait': {
      const n = item.seats ?? 1;
      return Array.from({ length: n }, (_, i) => {
        const lx = -hw + (o.size.w / n) * (i + 0.5);
        return { at: localToPlan(o, lx, 0), approach: localToPlan(o, lx, hd + GAP), facing: faceOut };
      });
    }
    case 'meeting':
    case 'eat': {
      // A meeting table seats one a side per 0.7 m, matching the chairs drawn in 3D.
      const n = item.use === 'meeting' ? Math.max(item.seats ?? 2, 2 * Math.round((o.size.w - 600) / 700)) : item.seats ?? 2;
      const perSide = Math.ceil(n / 2);
      const out: Spot[] = [];
      for (let side = 0; side < 2 && out.length < n; side++) {
        const sy = side === 0 ? 1 : -1;
        for (let i = 0; i < perSide && out.length < n; i++) {
          const lx = -hw + 300 + ((o.size.w - 600) / perSide) * (i + 0.5);
          // Seats sit in the outer band of the footprint (the chairs or benches), facing the table.
          out.push({ at: localToPlan(o, lx, sy * (hd - 300)), approach: localToPlan(o, lx, sy * (hd + GAP)), facing: sy > 0 ? faceIn : faceOut });
        }
      }
      return out;
    }
    case 'toilet':
      return [{ at: localToPlan(o, 0, 0), approach: localToPlan(o, 0, hd + GAP), facing: faceOut }];
    case 'locker': {
      const n = item.seats ?? 1;
      return Array.from({ length: n }, (_, i) => front(-hw + (o.size.w / n) * (i + 0.5)));
    }
    case 'machine':
      // The operator stands at the front, a little off centre toward the control end.
      return [front(Math.min(hw * 0.35, 900))];
    default:
      return [front(0)];
  }
}
