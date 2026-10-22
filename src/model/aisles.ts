import { newId } from './id';
import type { Obb } from './objects';
import type { Aisle, AisleKind, Id, Mm, Plan, Vec2 } from './types';
import { add, dist, len, lineIntersect, norm, perp, projectOnSegment, scale, sub } from './vec';

/**
 * Aisle widths from the German workplace rule ASR A1.8 "Verkehrswege" (2022), the one standard found that gives
 * numbers: walkways by the number of people using them (Table 2), vehicle routes as the widest truck or load plus a
 * margin each side and between oncoming trucks (Table 3, under 20 km/h). OSHA 1910.22 and 1910.176 only ask for
 * marked aisles with "sufficient safe clearance"; no Thai figure was confirmed, so these are the defaults.
 */
export const EDGE_MARGIN: Mm = 500;
/** Each side of a lane that trucks and people share. */
export const SHARED_MARGIN: Mm = 750;
/** Between two trucks passing. */
export const PASSING_MARGIN: Mm = 400;
/** A counterbalance truck carrying a 1.2 m pallet the long way across. */
export const DEFAULT_VEHICLE: Mm = 1200;
/** Floor marking line: 50–100 mm is the usual range (OSHA once accepted 2 in and up); yellow per ANSI Z535 / EU 92/58. */
export const LINE_WIDTH: Mm = 75;
export const LINE_COLOR = '#eab308';

export interface AisleKindInfo {
  label: string;
  short: string;
  /** Floor tint between the lines. */
  fill: string;
  /** Where the standard width comes from, for the panel. */
  rule: string;
}

export const AISLE_KINDS: Record<AisleKind, AisleKindInfo> = {
  walk: { label: 'ทางเดินคน', short: 'คนเดิน', fill: '#16a34a', rule: 'ASR A1.8 ตาราง 2: คนใช้ ≤5 คน 0.90 ม. · ≤20 คน 1.00 ม. · ≤200 คน 1.20 ม. · ≤300 คน 1.80 ม.' },
  forklift: { label: 'ทางรถโฟล์คลิฟท์ (ทางเดียว)', short: 'รถทางเดียว', fill: '#2563eb', rule: 'ASR A1.8 ตาราง 3: กว้างรถหรือสินค้า + ระยะขอบ 0.50 ม. × 2' },
  forklift2: { label: 'ทางรถโฟล์คลิฟท์ (สวนกัน)', short: 'รถสวนกัน', fill: '#9333ea', rule: 'ASR A1.8 ตาราง 3: กว้างรถ × 2 + ระยะขอบ 0.50 ม. × 2 + ระยะสวน 0.40 ม.' },
  mixed: { label: 'ทางรถ + คนเดินร่วมกัน', short: 'รถ+คน', fill: '#ea580c', rule: 'ASR A1.8 ตาราง 3: กว้างรถ + ระยะขอบเมื่อมีคนเดินร่วม 0.75 ม. × 2' },
};

/**
 * What to write on an aisle, longest first, so the plan picks the longest that fits its run: always the type and
 * width, with the aisle's own name in front when the name does not already say the type.
 */
export function aisleTexts(a: Pick<Aisle, 'name' | 'kind' | 'width'>, fmt: (mm: Mm) => string): string[] {
  const short = AISLE_KINDS[a.kind].short;
  const typed = `${short} · ${fmt(a.width)}`;
  const named = a.name && !a.name.startsWith(short) ? `${a.name} · ${typed}` : a.name ? `${a.name} · ${fmt(a.width)}` : typed;
  return [...new Set([named, typed, short])];
}

export const AISLE_KIND_IDS = Object.keys(AISLE_KINDS) as AisleKind[];

/** People using a walkway, and the walkway width ASR A1.8 Table 2 asks for. */
export const WALK_WIDTHS: { people: number; width: Mm }[] = [
  { people: 5, width: 900 },
  { people: 20, width: 1000 },
  { people: 200, width: 1200 },
  { people: 300, width: 1800 },
  { people: 400, width: 2400 },
];

export const usesVehicle = (kind: AisleKind) => kind !== 'walk';

/** The narrowest the standard allows for this kind of aisle (a walkway for up to 20 people). */
export function standardWidth(kind: AisleKind, vehicle: Mm = DEFAULT_VEHICLE): Mm {
  switch (kind) {
    case 'walk':
      return 1000;
    case 'forklift':
      return vehicle + 2 * EDGE_MARGIN;
    case 'forklift2':
      return 2 * vehicle + 2 * EDGE_MARGIN + PASSING_MARGIN;
    case 'mixed':
      return vehicle + 2 * SHARED_MARGIN;
  }
}

/** The width a new aisle of this kind starts at: the standard, with a main walkway sized for up to 200 people. */
export const defaultWidth = (kind: AisleKind): Mm => (kind === 'walk' ? 1200 : standardWidth(kind));

export const planAisles = (plan: Plan): Aisle[] => Object.values(plan.aisles ?? {});

export const aisleLength = (a: Pick<Aisle, 'points'>): Mm => a.points.slice(1).reduce((s, p, i) => s + dist(a.points[i], p), 0);

/** Narrower than the standard asks for. */
export const tooNarrow = (a: Pick<Aisle, 'kind' | 'width' | 'vehicle'>): boolean => a.width + 1 < standardWidth(a.kind, a.vehicle);

/** Drops repeated points and points in the middle of a straight run. */
export function cleanLine(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) >= 1) out.push(p);
  for (let i = 1; i + 1 < out.length; ) {
    const r = projectOnSegment(out[i], out[i - 1], out[i + 1]);
    if (r.distance < 1 && r.t > 0 && r.t < 1) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** The line offset sideways by d (positive to the left of travel in plan coordinates), mitred at the bends. */
export function offsetLine(points: Vec2[], d: Mm): Vec2[] {
  const n = points.length;
  if (n < 2) return points;
  const segs = points.slice(1).map((b, i) => {
    const dir = norm(sub(b, points[i]));
    return { p: add(points[i], scale(perp(dir), d)), dir };
  });
  return points.map((p, i) => {
    if (i === 0) return segs[0].p;
    if (i === n - 1) return add(p, scale(perp(segs[n - 2].dir), d));
    const a = segs[i - 1];
    const b = segs[i];
    const hit = lineIntersect(a.p, a.dir, b.p, b.dir);
    // A near-reversal mitres far out; fall back to the plain offset there.
    return hit && dist(hit, p) < Math.abs(d) * 4 ? hit : add(p, scale(perp(b.dir), d));
  });
}

/** The strip's outline: left edge out, right edge back. */
export function aisleOutline(a: Pick<Aisle, 'points' | 'width'>): Vec2[] {
  const left = offsetLine(a.points, a.width / 2);
  const right = offsetLine(a.points, -a.width / 2);
  return [...left, ...right.reverse()];
}

/** One box per straight run, standing to head height, for clash checks. */
export function aisleBoxes(a: Pick<Aisle, 'points' | 'width'>, z0: Mm = 0): Obb[] {
  return a.points.slice(1).flatMap((b, i) => {
    const p = a.points[i];
    const d = sub(b, p);
    const l = len(d);
    if (l < 1) return [];
    const u = scale(d, 1 / l);
    return [{ c: add(p, scale(d, 0.5)), u, v: perp(u), hu: l / 2, hv: a.width / 2, z0, z1: z0 + 2000 }];
  });
}

/** Whether p is on the strip, give or take `slack`. */
export function onAisle(a: Pick<Aisle, 'points' | 'width'>, p: Vec2, slack: Mm = 0): boolean {
  for (let i = 1; i < a.points.length; i++) if (projectOnSegment(p, a.points[i - 1], a.points[i]).distance <= a.width / 2 + slack) return true;
  return false;
}

/** Where to write the aisle's name: the middle of its longest run, along it. */
export function aisleLabel(a: Pick<Aisle, 'points'>): { at: Vec2; angle: number; length: Mm } {
  let best = { at: a.points[0], angle: 0, length: 0 };
  for (let i = 1; i < a.points.length; i++) {
    const p = a.points[i - 1];
    const q = a.points[i];
    const l = dist(p, q);
    if (l <= best.length) continue;
    let angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    best = { at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, angle, length: l };
  }
  return best;
}

export function addAisle(plan: Plan, points: Vec2[], props: Partial<Omit<Aisle, 'id' | 'points'>> & { kind: AisleKind }): Id {
  const aisles = (plan.aisles ??= {});
  const kind = props.kind;
  const n = Object.values(aisles).filter((a) => a.kind === kind).length;
  const id = newId('ai');
  aisles[id] = {
    id,
    name: props.name ?? `${AISLE_KINDS[kind].short} ${n + 1}`,
    kind,
    points: cleanLine(points).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    width: props.width ?? defaultWidth(kind),
    ...(usesVehicle(kind) && { vehicle: props.vehicle ?? DEFAULT_VEHICLE }),
    ...(props.auto && { auto: true as const }),
  };
  return id;
}

export function moveAisle(plan: Plan, id: Id, by: Vec2): void {
  const a = plan.aisles?.[id];
  if (!a) return;
  a.points = a.points.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));
}

/** A new kind keeps a width the user set only when it still meets the new standard. */
export function setAisleKind(a: Aisle, kind: AisleKind): void {
  a.kind = kind;
  if (usesVehicle(kind)) a.vehicle ??= DEFAULT_VEHICLE;
  else delete a.vehicle;
  if (tooNarrow(a) || a.width > defaultWidth(kind) * 1.6) a.width = defaultWidth(kind);
}
