import { catalogItem } from './catalog';
import { portPoint, routeOf, stageOf } from './route';
import type { Id, Mm, PlacedObject, Project, Vec2 } from './types';
import { machineUtility, utilitiesFor } from './utilities';

/**
 * The line at work: panels go through the machines on the route, and a trolley carries them from each machine to the
 * next. The figures come from each machine's seconds per sheet, so a slow machine shows as the queue that builds in
 * front of it, and a long route as the walking it costs. A planning picture, not a production schedule.
 */

/** Sheets on one trolley. */
export const BATCH = 4;
/** Sheets that may wait at a machine before the one before it has to stop. */
const BUFFER = 12;
/** A loaded trolley's pace, m/s. */
export const CART_SPEED = 1;
const HOURS_PER_DAY = 8;
/** Longest step of the simulation, seconds of factory time. */
const STEP = 1;

export interface Station {
  id: Id;
  name: string;
  /** Seconds of work per sheet. */
  sec: number;
  stage: number;
  /** Where sheets wait to go in, and the machine's middle and height, for drawing. */
  inAt: Vec2;
  at: Vec2;
  top: Mm;
  rotation: number;
}

export interface Line {
  stations: Station[];
  /** The way from each station to the next. */
  legs: { points: Vec2[]; metres: number }[];
}

export function lineOf(project: Project): Line {
  const route = routeOf(project);
  const settings = utilitiesFor(project);
  const byId = new Map(project.objects.map((o) => [o.id, o]));
  const stations = route.ids.map((id): Station => {
    const o = byId.get(id) as PlacedObject;
    return {
      id,
      name: o.name || catalogItem(o.assetId)?.label || 'เครื่อง',
      sec: Math.max(1, machineUtility(o.assetId, settings).secPerSheet ?? 300),
      stage: stageOf(o.assetId) ?? 0,
      inAt: portPoint(o, 'in'),
      at: { x: o.x, y: o.y },
      top: o.z + o.size.h,
      rotation: o.rotation,
    };
  });
  return { stations, legs: route.legs.map((l) => ({ points: l.points, metres: l.length / 1000 })) };
}

export interface LineStats {
  /** Sheets the line turns out, an hour and a working day. */
  perHour: number;
  perDay: number;
  /** Time one sheet takes through the line, minutes. */
  leadMinutes: number;
  /** The machine holding the line back, and how much of its time each machine is busy. */
  bottleneck: string | null;
  load: { id: Id; name: string; share: number }[];
  /** Distance trolleys are pushed in a day, there and back, metres. */
  metresPerDay: number;
}

/** What the line can do at steady running. Machines at the same stage share the work, so two saws count double. */
export function lineStats(line: Line): LineStats {
  const { stations, legs } = line;
  const rate = new Map<number, number>();
  for (const s of stations) rate.set(s.stage, (rate.get(s.stage) ?? 0) + 3600 / s.sec);
  const slowest = Math.min(...rate.values());
  const perHour = stations.length ? slowest : 0;
  const perDay = perHour * HOURS_PER_DAY;
  const load = stations.map((s) => ({ id: s.id, name: s.name, share: perHour / (rate.get(s.stage) ?? 1) }));
  const worst = stations.find((s) => rate.get(s.stage) === slowest);
  const walked = legs.reduce((t, l) => t + l.metres, 0);
  const oneOfEachStage = [...new Set(stations.map((s) => s.stage))].reduce((t, stage) => t + 3600 / (rate.get(stage) ?? 1), 0);
  const leadMinutes = (oneOfEachStage * BATCH + walked / CART_SPEED) / 60;
  return { perHour, perDay, leadMinutes, bottleneck: worst?.name ?? null, load, metresPerDay: (perDay / BATCH) * 2 * walked };
}

export type StationState = 'run' | 'idle' | 'blocked';

export interface SimStation {
  queue: number;
  /** Seconds left on the sheet in the machine; 0 when empty. */
  busy: number;
  /** Finished sheets waiting for the trolley. */
  out: number;
  state: StationState;
}

export interface SimCart {
  /** Metres along its leg. */
  pos: number;
  phase: 'wait' | 'go' | 'back';
  load: number;
}

export interface Sim {
  time: number;
  done: number;
  stations: SimStation[];
  carts: SimCart[];
}

export const startSim = (line: Line): Sim => ({
  time: 0,
  done: 0,
  stations: line.stations.map(() => ({ queue: 0, busy: 0, out: 0, state: 'idle' as StationState })),
  carts: line.legs.map(() => ({ pos: 0, phase: 'wait' as const, load: 0 })),
});

function tick(line: Line, sim: Sim, dt: number): void {
  const last = line.stations.length - 1;
  line.stations.forEach((spec, i) => {
    const s = sim.stations[i];
    if (s.busy > 0) {
      s.busy -= dt;
      if (s.busy <= 0) {
        s.busy = 0;
        if (i === last) sim.done++;
        else s.out++;
      }
    }
    // Boards are always waiting at the first machine.
    if (s.busy === 0 && (i === 0 || s.queue > 0) && s.out < BUFFER) {
      if (i > 0) s.queue--;
      s.busy = spec.sec;
    }
    s.state = s.busy > 0 ? 'run' : s.out >= BUFFER ? 'blocked' : 'idle';
  });
  line.legs.forEach((leg, i) => {
    const c = sim.carts[i];
    const from = sim.stations[i];
    const to = sim.stations[i + 1];
    if (c.phase === 'wait') {
      if (from.out >= BATCH && to.queue + BATCH <= BUFFER) {
        c.load = BATCH;
        from.out -= BATCH;
        c.phase = 'go';
      }
    } else if (c.phase === 'go') {
      c.pos += CART_SPEED * dt;
      if (c.pos >= leg.metres) {
        c.pos = leg.metres;
        to.queue += c.load;
        c.load = 0;
        c.phase = 'back';
      }
    } else {
      c.pos -= CART_SPEED * dt;
      if (c.pos <= 0) {
        c.pos = 0;
        c.phase = 'wait';
      }
    }
  });
  sim.time += dt;
}

/** Runs the line on by `seconds` of factory time. */
export function advance(line: Line, sim: Sim, seconds: number): void {
  if (!line.stations.length) return;
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(STEP, left);
    tick(line, sim, dt);
    left -= dt;
  }
}

/** A point `metres` along a run of points, and the way it is heading (radians, plan frame). */
export function pointOnLeg(points: readonly Vec2[], metres: number): { at: Vec2; heading: number } {
  let left = metres * 1000;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= d || i === points.length - 1) {
      const t = d ? Math.min(1, left / d) : 0;
      return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    left -= d;
  }
  return { at: points[0] ?? { x: 0, y: 0 }, heading: 0 };
}
