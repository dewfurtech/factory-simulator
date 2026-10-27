import { newId } from './id';
import type { Obb } from './objects';
import type { Aisle, AisleKind, Id, Mm, Plan, Vec2 } from './types';
import { add, dist, len, lineIntersect, norm, perp, projectOnSegment, scale, sub } from './vec';

/** Floor marking line: 50–100 mm is the usual range; yellow as factory floors are painted. */
export const LINE_WIDTH: Mm = 75;
export const LINE_COLOR = '#eab308';

export interface AisleKindInfo {
  label: string;
  short: string;
  /** Floor tint between the lines. */
  fill: string;
  /** Width a new one starts at. */
  width: Mm;
}

export const AISLE_KINDS: Record<AisleKind, AisleKindInfo> = {
  walk: { label: 'ทางเดิน', short: 'ทางเดิน', fill: '#16a34a', width: 1200 },
};

export const AISLE_KIND_IDS = Object.keys(AISLE_KINDS) as AisleKind[];

/** The width a new aisle of this kind starts at. */
export const defaultWidth = (kind: AisleKind): Mm => AISLE_KINDS[kind].width;

/** Aisles saved by older versions could be truck aisles or flow arrows; they are all walkways now, at their width. */
export const migrateAisle = (a: Aisle): Aisle => (AISLE_KINDS[a.kind] ? a : { ...a, kind: 'walk', width: Math.max(a.width, 600) });

export const planAisles = (plan: Plan): Aisle[] => Object.values(plan.aisles ?? {});

export const aisleLength = (a: Pick<Aisle, 'points'>): Mm => a.points.slice(1).reduce((s, p, i) => s + dist(a.points[i], p), 0);

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

/** The arrowhead at the end of a flow line: a triangle pointing along the last run, sized to the line. */
export function arrowHead(a: Pick<Aisle, 'points' | 'width'>): Vec2[] {
  const n = a.points.length;
  if (n < 2) return [];
  const tip = a.points[n - 1];
  const dir = norm(sub(tip, a.points[n - 2]));
  const l = Math.max(a.width * 3, 600);
  const back = add(tip, scale(dir, -l));
  const side = perp(dir);
  return [tip, add(back, scale(side, l * 0.55)), add(back, scale(side, -l * 0.55))];
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
  };
  return id;
}

export function moveAisle(plan: Plan, id: Id, by: Vec2): void {
  const a = plan.aisles?.[id];
  if (!a) return;
  a.points = a.points.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));
}
