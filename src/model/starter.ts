import { catalogItem, machineFlow, machineFootprint, machineInfo } from './catalog';
import { newId } from './id';
import { addPolygon, OUTER_WALL, roomInnerPolygon, roomStats } from './plan';
import { autoStage } from './staging';
import { safetyOf } from './safety';
import { machineAir, COMPRESSOR_LPM } from './sitePrep';
import type { Id, Mm, PlacedObject, Project, Room, Vec2 } from './types';

/**
 * The starting point for a customer who does not know which machines they need: three questions (what they make, how
 * much, which level of machine) give a set of Mastrox machines with the reason for each, and the set goes down on the
 * plan as a line in working order, with room to set work down at each machine. The seller and customer move things
 * from there.
 */

export type Product = 'kitchen' | 'wardrobe' | 'office' | 'door';
export type Volume = 'small' | 'medium' | 'large';
export type Tier = 'startup' | 'pro' | 'premium';

export interface StarterAnswers {
  product: Product;
  volume: Volume;
  tier: Tier;
}

export const PRODUCT_LABEL: Record<Product, string> = {
  kitchen: 'ตู้ครัว / บิวท์อิน',
  wardrobe: 'ตู้เสื้อผ้า / เฟอร์นิเจอร์',
  office: 'เฟอร์นิเจอร์สำนักงาน',
  door: 'บานเมมเบรน',
};
export const VOLUME_LABEL: Record<Volume, string> = {
  small: '≤ 30 แผ่น/วัน',
  medium: '30–60 แผ่น/วัน',
  large: '> 60 แผ่น/วัน',
};
export const TIER_LABEL: Record<Tier, string> = {
  startup: 'Startup',
  pro: 'Professional',
  premium: 'Premium',
};

/** Boards a nesting CNC cuts in an 8-hour day, a rule of thumb to be confirmed by Mastrox. */
export const SHEETS_PER_DAY: Record<string, number> = { 'rakete-3500a': 30, 'rakete-3500ant': 45, 'rakete-4800ant': 55, 'rakete-5000af': 70 };

export interface Pick {
  assetId: string;
  why: string;
}

const nestingFor = (a: StarterAnswers): string =>
  a.tier === 'premium' ? 'rakete-5000af' : a.tier === 'pro' ? 'rakete-4800ant' : a.volume === 'small' ? 'rakete-3500a' : 'rakete-3500ant';
const edgeFor = (a: StarterAnswers): string =>
  a.tier === 'premium'
    ? 'moon-40d'
    : a.tier === 'pro'
      ? a.volume === 'small'
        ? 'moon-10'
        : 'moon-40'
      : { small: 'booster-e6', medium: 'booster-e7', large: 'booster-e10' }[a.volume];
const drillFor = (a: StarterAnswers): string => (a.tier === 'premium' ? 'nova-xs' : a.tier === 'pro' ? (a.product === 'kitchen' ? 'nova-x6' : 'nova-x4') : 'nova-x2');

/** The machines to start from, in working order, each with why it is there. */
export function recommend(a: StarterAnswers): Pick[] {
  const nesting = nestingFor(a);
  const out: Pick[] = [
    { assetId: nesting, why: `ตัดแผ่นไม้ทั้งแผ่นเป็นชิ้นตามแบบ ประมาณ ${SHEETS_PER_DAY[nesting]} แผ่นต่อวัน (8 ชม.)` },
    { assetId: edgeFor(a), why: 'ปิดขอบชิ้นงานที่ตัดแล้ว ให้ขอบเรียบกันชื้น' },
  ];
  // Two nesting machines when one cannot keep up with the volume asked for.
  if (a.volume === 'large' && SHEETS_PER_DAY[nesting] < 60) out.splice(1, 0, { assetId: nesting, why: 'เครื่องตัดตัวที่สอง ให้ทันปริมาณงานที่ต้องการ' });
  if (a.product !== 'door') out.push({ assetId: drillFor(a), why: 'เจาะรูข้างสำหรับเดือย บานพับ และอุปกรณ์ประกอบ' });
  if (a.product === 'door' || (a.product === 'kitchen' && a.tier !== 'startup'))
    out.push({ assetId: a.tier === 'premium' || a.volume === 'large' ? 'aurora-slide' : 'aurora-open', why: 'อัดฟิล์ม PVC บนหน้าบานที่กัดลาย (บานเมมเบรน)' });
  const air = out.reduce((s, p) => s + machineAir(p.assetId), 0) * 1.3;
  const vair = air <= COMPRESSOR_LPM['vair-10'] ? 'vair-10' : 'vair-20';
  out.push({ assetId: vair, why: `ปั๊มลมสำหรับทุกเครื่อง เครื่องในชุดนี้ใช้ลมประมาณ ${(air / 1000).toFixed(1)} ลบ.ม./นาที` });
  return out;
}

export const picksPrice = (picks: readonly Pick[]): { total: number; unpriced: number } =>
  picks.reduce(
    (s, p) => {
      const price = machineInfo(p.assetId)?.price;
      return price ? { ...s, total: s.total + price } : { ...s, unpriced: s.unpriced + 1 };
    },
    { total: 0, unpriced: 0 },
  );

/** Room around the line: the first and last machines' distances, and the walkway along it. */
const MARGIN: Mm = 1500;
const ROW_GAP: Mm = 1500;

const sizeOf = (assetId: string) => machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size;

/** Rotation that sends the work along +x: in at the -x end, out at the +x end. */
function alongX(assetId: string): number {
  const f = machineFlow(assetId, undefined);
  return f?.in === 'right' ? Math.PI : 0;
}

/** The safety distances of a machine turned by `rot` (0 or π), in plan directions: toward -x, +x, -y, +y. */
function spread(assetId: string, rot: number) {
  const s = safetyOf(assetId) ?? { front: 1000, back: 1000, left: 1000, right: 1000 };
  // Local +y (the front) is plan +y at 0 and plan -y at π.
  return Math.abs(rot - Math.PI) < 0.1 ? { lo: s.right, hi: s.left, top: s.front, bottom: s.back } : { lo: s.left, hi: s.right, top: s.back, bottom: s.front };
}

/** The floor a line of these machines needs, without walls: for a building drawn round it. */
function lineLength(ids: readonly string[]): Mm {
  let x = 0;
  ids.forEach((id, i) => {
    const sp = spread(id, alongX(id));
    x += (i ? Math.max(sp.lo, 1500) : sp.lo) + sizeOf(id).w;
    if (i === ids.length - 1) x += sp.hi;
  });
  return x;
}

/** The biggest indoor room, where the line goes. */
function mainRoom(project: Project): Room | null {
  const rooms = Object.values(project.plan.rooms).filter((r) => !r.outdoor && !r.hidden);
  if (!rooms.length) return null;
  const prod = rooms.filter((r) => r.zone === 'production');
  return (prod.length ? prod : rooms).reduce((a, b) => (roomStats(project.plan, b).area > roomStats(project.plan, a).area ? b : a));
}

/**
 * Lays the picks out on the draft project: the flow machines in a line (turning back in a second row when the room is
 * too short), compressors in a corner, a pallet or trolley at each machine, and the route in that order. With no room
 * on the plan, a building is drawn round the line with a roller door at the start. Returns the new machines' ids.
 */
export function layOut(draft: Project, picks: readonly Pick[]): Id[] {
  const flow = picks.filter((p) => machineFlow(p.assetId, undefined)).map((p) => p.assetId);
  const rest = picks.filter((p) => !machineFlow(p.assetId, undefined)).map((p) => p.assetId);
  let room = mainRoom(draft);
  if (!room) {
    const L = Math.max(12000, lineLength(flow) + 2 * MARGIN);
    const D = 16000;
    addPolygon(
      draft.plan,
      [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: D },
        { x: 0, y: D },
      ],
      OUTER_WALL,
    );
    room = Object.values(draft.plan.rooms)[0];
    Object.assign(room, { name: 'ไลน์ผลิต', zone: 'production', ceilingHeight: 6000 });
    // A roller door in the wall at the start of the line, for the boards coming in and the machines arriving.
    const wall = Object.values(draft.plan.walls).find((w) => draft.plan.corners[w.a].x === 0 && draft.plan.corners[w.b].x === 0);
    if (wall) {
      const id = newId('o');
      draft.plan.openings[id] = { id, wallId: wall.id, kind: 'door', doorStyle: 'rolling', offset: D / 2, width: 4000, height: 4500, sill: 0, entrance: true };
    }
  }
  const inner = roomInnerPolygon(draft.plan, room);
  const x0 = Math.min(...inner.map((p) => p.x));
  const x1 = Math.max(...inner.map((p) => p.x));
  const y0 = Math.min(...inner.map((p) => p.y));
  const y1 = Math.max(...inner.map((p) => p.y));

  const placed: PlacedObject[] = [];
  const put = (assetId: string, c: Vec2, rotation: number) => {
    const item = catalogItem(assetId)!;
    const o: PlacedObject = { id: newId('obj'), assetId, name: item.label, x: c.x, y: c.y, z: 0, rotation, size: { ...sizeOf(assetId) } };
    placed.push(o);
    return o;
  };

  // Rows down the room, each as deep as its deepest machine with its distances; every other row runs back the other way.
  type Slot = { id: string; w: Mm; d: Mm; rot: number; sp: ReturnType<typeof spread> };
  const rows: Slot[][] = [[]];
  let used = 0;
  for (const id of flow) {
    const dir = rows.length % 2 ? 1 : -1;
    const rot = (alongX(id) + (dir > 0 ? 0 : Math.PI)) % (2 * Math.PI);
    const slot: Slot = { id, ...sizeOf(id), rot, sp: spread(id, rot) };
    // Toward the previous machine and toward the next, along the way the row runs.
    const back = dir > 0 ? slot.sp.lo : slot.sp.hi;
    const ahead = dir > 0 ? slot.sp.hi : slot.sp.lo;
    const row = rows[rows.length - 1];
    if (row.length && used + Math.max(back, 1500) + slot.w + ahead > x1 - x0) {
      rows.push([]);
      used = 0;
    }
    const first = !rows[rows.length - 1].length;
    used += (first ? back : Math.max(back, 1500)) + slot.w;
    rows[rows.length - 1].push(slot);
  }
  let rowTop = y0 + 300;
  rows.forEach((row, r) => {
    if (!row.length) return;
    const dir = r % 2 ? -1 : 1;
    const top = Math.max(...row.map((m) => m.sp.top));
    const deep = Math.max(...row.map((m) => m.d));
    const cy = rowTop + top + deep / 2;
    let cx = dir > 0 ? x0 : x1;
    row.forEach((m, i) => {
      const back = dir > 0 ? m.sp.lo : m.sp.hi;
      const prevAhead = i ? (dir > 0 ? row[i - 1].sp.hi : row[i - 1].sp.lo) : 0;
      cx += dir * ((i ? Math.max(back, prevAhead, 1500) : back) + m.w / 2);
      put(m.id, { x: cx, y: cy }, m.rot);
      cx += dir * (m.w / 2);
    });
    rowTop += top + deep + Math.max(...row.map((m) => m.sp.bottom)) + ROW_GAP;
  });
  // Compressors and the like by the far wall, out of the way.
  let cx = x1 - MARGIN;
  for (const id of rest) {
    const s = sizeOf(id);
    put(id, { x: cx - s.w / 2, y: Math.min(y1 - MARGIN - s.d / 2, rowTop + s.d / 2 + MARGIN) }, 0);
    cx -= s.w + MARGIN;
  }
  draft.objects.push(...placed);
  draft.route = placed.filter((o) => machineFlow(o.assetId, undefined)).map((o) => o.id);
  draft.objects.push(...autoStage(draft));
  return placed.map((o) => o.id);
}
