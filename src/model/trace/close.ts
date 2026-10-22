import { OPENING_PRESETS } from '../openings';
import { addWall, cornerFor, DEFAULT_WALL, deleteWall, openingOffsetAt } from '../plan';
import { newId } from '../id';
import type { Id, Mm, Plan, Vec2 } from '../types';
import { dist, segmentIntersect } from '../vec';

/** Farthest a wall left standing free at one end is carried on to the nearest corner. */
const LOOSE_REACH: Mm = 2500;
/** A wall this short standing free at one end is a scrap of the reading (a jamb's corner), not a wall. */
const SCRAP: Mm = 300;
/** A traced wall still standing free at one end after closing, and shorter than this, is a stray stroke. */
const STRAY: Mm = 2500;
/** Ends this close are one corner the reader split, whichever way they lie. */
const SNAP: Mm = 300;
/** Most a traced wall carried on to a corner beyond a snap may tilt. */
const TILT = (5 * Math.PI) / 180;
/** Gaps this wide between a free end and the wall it is carried to are doorways (the door symbol unread). */
const DOORWAY: [Mm, Mm] = [600, 1500];

/** Two parallel walls closer than this, centre to centre, are one wall read twice (its two faces, a doubled line). */
const DOUBLED: Mm = 450;
/** Shortest a wall read twice is taken for one. */
const DOUBLED_LENGTH: Mm = 1000;
/** Lower than this a wall is a fence, which may stand right beside a wall. */
const FENCE_TOP: Mm = 2000;

/**
 * Merges walls read twice: of two parallel walls lying closer than a wall's width, the shorter goes where the longer
 * runs along most of it, leaving a sliver of a room between them otherwise. Fences, and walls `keep` holds, stay. The
 * walls that met the one taken away are left free at that end, for closeLooseEnds to carry on to the one kept.
 */
export function mergeDoubledWalls(plan: Plan, keep: (wallId: Id) => boolean = () => false): number {
  const hasOpening = (id: Id) => Object.values(plan.openings).some((o) => o.wallId === id);
  let merged = 0;
  for (let again = true; again; ) {
    again = false;
    const walls = Object.values(plan.walls).filter((w) => w.height >= FENCE_TOP && !keep(w.id));
    search: for (const p of walls) {
      for (const q of walls) {
        if (p === q) continue;
        const [a, b, c, d] = [plan.corners[p.a], plan.corners[p.b], plan.corners[q.a], plan.corners[q.b]];
        const lp = dist(a, b);
        const lq = dist(c, d);
        // q the shorter, its whole length looked at against p's line.
        // Short pieces side by side are a jamb, a fin, a step: a wall read twice is read twice along a good length.
        if (lq > lp || lq < DOUBLED_LENGTH) continue;
        const u = { x: (b.x - a.x) / lp, y: (b.y - a.y) / lp };
        const v = { x: (d.x - c.x) / lq, y: (d.y - c.y) / lq };
        if (Math.abs(u.x * v.y - u.y * v.x) > Math.sin((3 * Math.PI) / 180)) continue;
        const across = (z: Vec2) => Math.abs((z.x - a.x) * u.y - (z.y - a.y) * u.x);
        if (across(c) > DOUBLED || across(d) > DOUBLED) continue;
        const along = (z: Vec2) => (z.x - a.x) * u.x + (z.y - a.y) * u.y;
        const overlap = Math.min(lp, Math.max(along(c), along(d))) - Math.max(0, Math.min(along(c), along(d)));
        if (overlap < lq * 0.8) continue;
        // The one with a door or window in it is the one the drawing meant.
        const drop = hasOpening(q.id) && !hasOpening(p.id) ? p : q;
        if (hasOpening(drop.id)) continue;
        deleteWall(plan, drop.id);
        merged++;
        again = true;
        break search;
      }
    }
  }
  return merged;
}

export interface CloseOptions {
  /**
   * What a gap a doorway wide is closed with: 'solid' wall (a drawing whose owner said such ends close solid), or
   * 'doorway', a wall with an opening its whole width, for plans traced from a picture, where an unread door leaves
   * just such a gap.
   */
  doorways: 'solid' | 'doorway';
  /** Only carry a wall on along its own line (off it by at most its thickness): a traced plan's walls do not turn to meet a corner. */
  straight?: boolean;
}

/**
 * Walls the reader left standing free at one end are carried on to the nearest corner within reach, or else straight
 * on to the first wall they meet; scraps a few centimetres long standing free go first. A corner on the wall's own line
 * counts only straight ahead, and a new wall may not cross one that stands.
 */
export function closeLooseEnds(plan: Plan, o: CloseOptions): void {
  const degree = () => {
    const d = new Map<Id, number>();
    for (const w of Object.values(plan.walls)) for (const id of [w.a, w.b]) d.set(id, (d.get(id) ?? 0) + 1);
    return d;
  };
  for (const w of Object.values(plan.walls)) {
    const d = degree();
    if (plan.walls[w.id] && dist(plan.corners[w.a], plan.corners[w.b]) < SCRAP && (d.get(w.a) === 1 || d.get(w.b) === 1)) deleteWall(plan, w.id);
  }
  const join = (from: Id, to: Id, thickness: Mm) => {
    const ids = addWall(plan, from, to, { ...DEFAULT_WALL, thickness });
    const gap = dist(plan.corners[from], plan.corners[to]);
    if (o.doorways !== 'doorway' || gap < DOORWAY[0] || gap > DOORWAY[1] || ids.length !== 1) return;
    const wall = plan.walls[ids[0]];
    const p = OPENING_PRESETS.opening;
    const mid = {
      x: (plan.corners[from].x + plan.corners[to].x) / 2,
      y: (plan.corners[from].y + plan.corners[to].y) / 2,
    };
    const id = newId('o');
    plan.openings[id] = {
      id,
      wallId: wall.id,
      kind: p.kind,
      offset: openingOffsetAt(plan, wall, mid, gap),
      width: gap,
      height: p.height,
      sill: p.sill,
    };
  };
  // A traced plan bridges a longer gap only between two free ends facing each other along one line (a wall the
  // reader broke); a free end with nothing facing it goes on a doorway at most, as it is as likely a stray stroke
  // (a window mark) as a wall.
  const reach = o.straight ? 2000 : LOOSE_REACH;
  /** Most a traced wall's end may stand off the line of the wall it is carried on from. */
  const offLine = (t: Mm) => Math.max(t, 250);
  const outward = (id: Id): Vec2 | null => {
    const w = Object.values(plan.walls).find((v) => v.a === id || v.b === id);
    if (!w) return null;
    const a = plan.corners[id];
    const b = plan.corners[w.a === id ? w.b : w.a];
    const l = dist(a, b) || 1;
    return { x: (a.x - b.x) / l, y: (a.y - b.y) / l };
  };
  const carry = () => {
    for (const c of Object.values(plan.corners)) {
      const deg = degree();
      if (deg.get(c.id) !== 1) continue;
      const own = Object.values(plan.walls).find((w) => w.a === c.id || w.b === c.id);
      if (!own) continue;
      const other = plan.corners[own.a === c.id ? own.b : own.a];
      let best: { id: Id; d: number } | null = null;
      /** The nearest corner ahead off the wall's line, for a drawing's walls, which may turn square to meet it. */
      let turn: { id: Id; d: number; elbow: Vec2 } | null = null;
      const u0 = { x: c.x - other.x, y: c.y - other.y };
      const l0 = Math.hypot(u0.x, u0.y) || 1;
      const clear = (s: Vec2, e: Vec2, ends: Id[]) =>
        !Object.values(plan.walls).some((w) => {
          if (ends.includes(w.a) || ends.includes(w.b)) return false;
          const x = segmentIntersect(s, e, plan.corners[w.a], plan.corners[w.b]);
          return !!x && x.t > 1e-6 && x.t < 1 - 1e-6;
        });
      for (const q of Object.values(plan.corners)) {
        if (q.id === c.id || q.id === other.id) continue;
        const d = dist(c, q);
        if (d < 1 || d > LOOSE_REACH || (best && d >= best.d)) continue;
        // Not back along the wall itself.
        const ahead = ((q.x - c.x) * (c.x - other.x) + (q.y - c.y) * (c.y - other.y)) / (d * (dist(c, other) || 1));
        if (ahead < 0) continue;
        // Off the wall's own line by no more than its thickness: anything wider would tilt the wall, and rooms are
        // mostly rectangles, a slanted wall closing one a misreading.
        const side = Math.abs((q.x - c.x) * (c.y - other.y) - (q.y - c.y) * (c.x - other.x)) / (dist(c, other) || 1);
        // Beyond a snap a traced wall's join may not tilt more than a few degrees either; a drawing's may, as little as
        // that is (its lines are true, the offset a corner drawn a wall's width over).
        if (side > offLine(own.thickness) || (o.straight && d > SNAP && side > d * Math.tan(TILT))) {
          // A drawing's wall turns square to the corner instead: on along its line, then across to it.
          const along = ((q.x - c.x) * u0.x + (q.y - c.y) * u0.y) / l0;
          const elbow = { x: c.x + (u0.x / l0) * along, y: c.y + (u0.y / l0) * along };
          if (
            !o.straight &&
            l0 >= SCRAP * 2 &&
            along >= SCRAP &&
            Math.abs(side) >= SCRAP &&
            d <= reach &&
            (!turn || d < turn.d) &&
            clear(c, elbow, [c.id]) &&
            clear(elbow, q, [q.id])
          )
            turn = { id: q.id, d, elbow };
          continue;
        }
        if (o.straight) {
          const back = deg.get(q.id) === 1 ? outward(q.id) : null;
          const facing = !!back && (back.x * (c.x - q.x) + back.y * (c.y - q.y)) / d > Math.cos(Math.PI / 12);
          if (d > reach && !facing) continue;
        } else if (d > reach) continue;
        const crosses = Object.values(plan.walls).some((w) => {
          if ([w.a, w.b].includes(c.id) || [w.a, w.b].includes(q.id)) return false;
          const a = plan.corners[w.a];
          const b = plan.corners[w.b];
          const side = (p: Vec2, s: Vec2, e: Vec2) => Math.sign((e.x - s.x) * (p.y - s.y) - (e.y - s.y) * (p.x - s.x));
          return side(a, c, q) !== side(b, c, q) && side(c, a, b) !== side(q, a, b);
        });
        if (!crosses) best = { id: q.id, d };
      }
      if (best) {
        join(c.id, best.id, own.thickness);
        continue;
      }
      if (turn) {
        // The elbow lands on the corner's own wall, a few millimetres either side of its line.
        const elbow = cornerFor(plan, turn.elbow, 30);
        join(c.id, elbow, own.thickness);
        const q = turn.id;
        if (elbow !== q && !Object.values(plan.walls).some((w) => (w.a === elbow && w.b === q) || (w.a === q && w.b === elbow))) join(elbow, q, own.thickness);
        continue;
      }
      // No corner ahead: the wall runs on straight to the first wall it meets.
      const u = { x: c.x - other.x, y: c.y - other.y };
      const l = Math.hypot(u.x, u.y) || 1;
      const far = {
        x: c.x + (u.x / l) * (o.straight ? reach : LOOSE_REACH * 2),
        y: c.y + (u.y / l) * (o.straight ? reach : LOOSE_REACH * 2),
      };
      let hit: { p: Vec2; t: number } | null = null;
      for (const w of Object.values(plan.walls)) {
        if (w.a === c.id || w.b === c.id) continue;
        const x = segmentIntersect(c, far, plan.corners[w.a], plan.corners[w.b]);
        if (x && x.t > 1e-6 && (!hit || x.t < hit.t)) hit = { p: x.p, t: x.t };
      }
      if (hit) join(c.id, cornerFor(plan, hit.p, 1), own.thickness);
    }
  };
  carry();
  if (!o.straight) return;
  // What a traced plan still leaves standing free and short after that is a stroke of some mark (a window's sash, a
  // section mark's line), not a wall: off it comes. Once only: a wall it leaves free was read standing.
  const d = degree();
  const strays = Object.values(plan.walls).filter((w) => (d.get(w.a) === 1 || d.get(w.b) === 1) && dist(plan.corners[w.a], plan.corners[w.b]) < STRAY);
  for (const w of strays) deleteWall(plan, w.id);
  // A wall the stray hung from may stand free now, and be carried on in its turn.
  if (strays.length) carry();
}
