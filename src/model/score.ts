import { isMachine } from './catalog';
import { checkClearance } from './clearance';
import { deliveryFor } from './delivery';
import { roomStats } from './plan';
import { routeOf } from './route';
import { safetyBox } from './safety';
import { stagingFor } from './staging';
import type { Id, Project, Vec2 } from './types';

/**
 * A report card for a layout, for a customer who cannot judge one: five plain marks out of 100 (how the work flows,
 * safety, use of space, room to set work down, getting the machines in), one overall grade, and the few things most
 * worth fixing, each pointing at the machine or spot it is about.
 */

export type ScoreKey = 'flow' | 'safety' | 'space' | 'staging' | 'delivery';

export interface ScorePart {
  key: ScoreKey;
  label: string;
  score: number;
  /** One line on why, in the customer's words. */
  note: string;
}

export interface Tip {
  text: string;
  /** The machine it is about, to go and look at. */
  id?: Id;
  at?: Vec2;
  /** How much fixing it would lift the score: bigger first. */
  weight: number;
}

export interface ScoreCard {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D';
  gradeText: string;
  parts: ScorePart[];
  tips: Tip[];
  /** Too little on the plan to score: no machines yet. */
  empty: boolean;
}

export const SCORE_LABEL: Record<ScoreKey, string> = {
  flow: 'การไหลของงาน',
  safety: 'ความปลอดภัย',
  space: 'การใช้พื้นที่',
  staging: 'ที่วางงาน',
  delivery: 'การขนเครื่องเข้า',
};

const WEIGHT: Record<ScoreKey, number> = { flow: 0.3, safety: 0.25, space: 0.15, staging: 0.15, delivery: 0.15 };

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function scoreOf(project: Project): ScoreCard {
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const name = (id: Id) => project.objects.find((o) => o.id === id)?.name ?? 'เครื่อง';
  const tips: Tip[] = [];
  if (!machines.length) return { total: 0, grade: 'D', gradeText: 'ยังไม่มีเครื่องในผัง', parts: [], tips: [], empty: true };

  // Flow: each warning costs, and a long average leg does too.
  const route = routeOf(project);
  const penalty = { blocked: 25, back: 15, cross: 15, long: 10 } as const;
  let flow = 100;
  for (const w of route.warnings) {
    flow -= penalty[w.kind];
    tips.push({ text: w.text, at: w.at, weight: penalty[w.kind] * WEIGHT.flow });
  }
  const avg = route.legs.length ? route.total / route.legs.length : 0;
  if (avg > 8000) flow -= Math.min(20, (avg - 8000) / 500);
  const flowNote = route.legs.length
    ? `งานวิ่งรวม ${(route.total / 1000).toFixed(1)} ม. ผ่าน ${route.ids.length} เครื่อง${route.warnings.length ? ` มีจุดต้องแก้ ${route.warnings.length} จุด` : ' ไหลไปทางเดียว'}`
    : 'มีเครื่องเดียว ยังไม่มีเส้นทางให้ดู';

  // Safety: machines that cannot stand where they are, or crowd their safety distances.
  const issues = checkClearance(project);
  const troubled = machines.filter((m) => issues.has(m.id));
  const safety = 100 - (troubled.length / machines.length) * 100 * 0.9 - (troubled.length ? 10 : 0);
  for (const m of troubled.slice(0, 3)) tips.push({ text: `${m.name}: วางไม่ปลอดภัย`, id: m.id, weight: 20 * WEIGHT.safety });

  // Space: machines with their safety distances against the production floor. A half to two thirds used is right.
  const rooms = Object.values(project.plan.rooms).filter((r) => !r.outdoor && (r.zone === 'production' || r.zone === 'other' || r.zone === 'warehouse'));
  const floor = rooms.reduce((s, r) => s + roomStats(project.plan, r).area, 0);
  const used = machines.reduce((s, m) => {
    const b = safetyBox(m);
    return s + (b ? 4 * b.hu * b.hv : m.size.w * m.size.d);
  }, 0);
  const share = floor ? used / floor : 0;
  let space = 100;
  let spaceNote = floor ? `เครื่องรวมระยะปลอดภัยใช้พื้นที่ ${Math.round(share * 100)}% ของพื้นที่ผลิต` : 'ยังไม่มีห้องในผัง';
  if (!floor) space = 50;
  else if (share > 0.85) {
    space = 40;
    spaceNote += ' แน่นเกินไป ไม่มีที่ขยาย';
    tips.push({ text: 'พื้นที่ผลิตแน่นเกินไป', weight: 12 });
  } else if (share > 0.7) {
    space = 70;
    spaceNote += ' ค่อนข้างแน่น';
  } else if (share < 0.2) {
    space = 75;
    spaceNote += ' ยังเหลือที่ว่างมาก วางเครื่องชิดกันขึ้นได้ ระยะเข็นงานจะสั้นลง';
  } else spaceNote += ' พอดี เหลือที่ขยายในอนาคต';

  // Staging: the waiting spots that are clear.
  const stages = stagingFor(project);
  const clear = stages.filter((s) => !s.blockedBy).length;
  const staging = stages.length ? (clear / stages.length) * 100 : 100;
  for (const s of stages.filter((s) => s.blockedBy).slice(0, 3))
    tips.push({
      text: `${name(s.machineId)}: ไม่มีที่วางงาน`,
      id: s.machineId,
      weight: (100 / stages.length) * WEIGHT.staging,
    });

  // Delivery: machines that can be brought in.
  const deliveries = deliveryFor(project);
  const known = deliveries.filter((d) => d.status !== 'noplan');
  const ok = known.filter((d) => d.status === 'ok').length;
  const delivery = known.length ? (ok / known.length) * 100 - (known.some((d) => d.tight) ? 5 : 0) : 50;
  for (const d of known.filter((d) => d.status !== 'ok').slice(0, 3)) tips.push({ text: `${d.name}: ขนเข้าไม่ได้`, id: d.id, weight: (100 / known.length) * WEIGHT.delivery });

  const parts: ScorePart[] = [
    { key: 'flow', label: SCORE_LABEL.flow, score: clamp(flow), note: flowNote },
    { key: 'safety', label: SCORE_LABEL.safety, score: clamp(safety), note: troubled.length ? `${troubled.length} เครื่องยังวางไม่ปลอดภัย` : 'ทุกเครื่องมีระยะปลอดภัยครบ' },
    { key: 'space', label: SCORE_LABEL.space, score: clamp(space), note: spaceNote },
    { key: 'staging', label: SCORE_LABEL.staging, score: clamp(staging), note: stages.length ? `มีที่วางงานว่าง ${clear} จาก ${stages.length} จุด` : 'ไม่มีเครื่องที่ต้องป้อนงาน' },
    {
      key: 'delivery',
      label: SCORE_LABEL.delivery,
      score: clamp(delivery),
      note: known.length ? `ขนเข้าได้ ${ok} จาก ${known.length} เครื่อง` : 'วาดห้องและประตูก่อนจึงเช็กได้',
    },
  ];
  const total = clamp(parts.reduce((s, p) => s + p.score * WEIGHT[p.key], 0));
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D';
  const gradeText = { A: 'ผังดีมาก พร้อมคุยรายละเอียด', B: 'ผังใช้ได้ แก้อีกนิดจะดีขึ้น', C: 'ยังมีจุดที่ควรแก้หลายจุด', D: 'ผังยังมีปัญหาสำคัญ ควรแก้ก่อน' }[grade];
  return { total, grade, gradeText, parts, tips: tips.sort((a, b) => b.weight - a.weight).slice(0, 6), empty: false };
}

const cache = new WeakMap<Project, ScoreCard>();
export function scoreFor(project: Project): ScoreCard {
  let s = cache.get(project);
  if (!s) {
    s = scoreOf(project);
    cache.set(project, s);
  }
  return s;
}
