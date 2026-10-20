import { catalogItem, localToPlan, needsOperator, isMachine, spotsOf, useOf, type Spot, type UseKind } from '../model/catalog';
import { levelOf, planOf } from '../model/levels';
import { roomAt, roomPolygon, wallDir, wallSideRooms } from '../model/plan';
import { fmtClock } from '../model/project';
import { CUSTOMER_COLOR, ROLES } from '../model/roles';
import type { Id, Mm, Place, PlacedObject, Project, RoleId, Room, Staff, Vec2 } from '../model/types';
import { add, bounds, dist, perp, pointInPolygon, scale, sub } from '../model/vec';
import type { Act, MachineState } from './activities';
import { buildNav, cellCenter, findPath, nearestFree, type NavGrid } from './nav';

/** Joins Thai words to a name, with a space only before a Latin name (เดินไป Moon 40, but เดินไปโรงอาหาร). */
export const th = (word: string, name: string) => (/^[A-Za-z0-9]/.test(name) ? `${word} ${name}` : `${word}${name}`);

// ————— random numbers —————

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A spot's points, marked with the floor they are on. */
const onFloor = (spot: Spot, level: number): Spot => (level ? { ...spot, at: { ...spot.at, level } as Place, approach: { ...spot.approach, level } as Place } : spot);

// ————— people and what they are doing —————

export type Step =
  | { k: 'goto'; to: Place; approach?: Place; facing?: number; label: string; seat?: string }
  | { k: 'stay'; act: Act; label: string; dur?: number; until?: number; interrupt?: boolean; uncapped?: boolean; machineId?: Id; facing?: number }
  | { k: 'sync'; tour: Tour; key: string; label: string }
  | { k: 'call'; fn: () => void };

export interface Segment {
  t0: number;
  t1: number;
  act: Act;
  label: string;
  place: string;
}

export interface Agent {
  id: string;
  kind: 'staff' | 'customer';
  staff?: Staff;
  name: string;
  role: RoleId | 'customer';
  color: string;
  /** Where the person is, and on which floor (and how high, on a stair). */
  pos: Place;
  facing: number;
  present: boolean;
  done: boolean;
  arrival: number;
  leaveAt: number;
  steps: Step[];
  cur: Step | null;
  path: Place[];
  /** The time the current stay ends. */
  until: number;
  act: Act;
  label: string;
  place: string;
  /** Where the current walk ends, and what is there. */
  dest?: Vec2;
  destLabel?: string;
  log: Segment[];
  trail: Place[];
  lastTrail: number;
  station?: PlacedObject;
  speed: Mm;
  seat?: string;
  /** Set while in a repair job or a customer tour, which the day's events don't cut short. */
  busy?: 'repair' | 'tour';
  breaksTaken: Set<Id>;
  meetingDone: boolean;
  leaving: boolean;
  nextPersonal: number;
  nextRound: number;
  /** Metres walked today. */
  walked: number;
}

export interface Tour {
  id: string;
  customer: Agent;
  host?: Agent;
  members: Agent[];
  since: number;
}

export interface MachineSim {
  obj: PlacedObject;
  state: MachineState;
  broken: boolean;
  operator?: Agent;
  tech?: Agent;
  /** Minutes spent in each state today. */
  totals: Record<MachineState, number>;
  breakdowns: number;
  brokeAt?: number;
}

export interface Repair {
  id: string;
  machine: MachineSim;
  t: number;
  tech?: Agent;
  started?: number;
}

export interface SimEvent {
  t: number;
  text: string;
  kind: 'arrive' | 'leave' | 'break' | 'machine' | 'repair' | 'customer' | 'info';
  agentId?: string;
}

const WALK: Mm = 75000; // 1.25 m/s, in mm per minute
const MAX_STEP = 0.05; // minutes per sub-step (3 s)

export class Engine {
  readonly project: Project;
  /** Walking grids, one per floor. */
  readonly navs: NavGrid[];
  t: number;
  readonly dayStart: number;
  readonly dayEnd: number;
  agents: Agent[] = [];
  machines = new Map<Id, MachineSim>();
  repairs: Repair[] = [];
  tours: Tour[] = [];
  events: SimEvent[] = [];
  private rand: () => number;
  private seats = new Map<string, string>();
  private entrance: { inside: Vec2; outside: Vec2; along: Vec2; found: boolean };
  private byUse = new Map<UseKind, PlacedObject[]>();
  private meeting?: { start: number; end: number; table: PlacedObject };
  private customerCount = 0;

  constructor(project: Project, seed = project.sim.seed) {
    this.project = project;
    this.navs = project.upper ? [buildNav(project, 0), buildNav(project, 1)] : [buildNav(project, 0)];
    this.rand = mulberry32(seed * 7919 + 17);
    const { schedule } = project;
    this.dayStart = schedule.start - 40;
    this.dayEnd = schedule.end + 45;
    this.t = this.dayStart;
    for (const o of project.objects) {
      const use = useOf(o);
      if (!use || o.hidden) continue;
      if (!this.byUse.has(use)) this.byUse.set(use, []);
      this.byUse.get(use)!.push(o);
      if (isMachine(o)) this.machines.set(o.id, { obj: o, state: 'off', broken: false, totals: { off: 0, running: 0, idle: 0, broken: 0, repair: 0 }, breakdowns: 0 });
    }
    this.entrance = this.findEntrance();
    const table = this.byUse.get('meeting')?.[0];
    if (table) this.meeting = { start: schedule.start + 30, end: schedule.start + 60, table };
    this.makeStaff();
    this.makeCustomers();
  }

  // ————— setup —————

  private r(a: number, b: number) {
    return a + (b - a) * this.rand();
  }

  private pick<T>(xs: T[]): T | undefined {
    return xs.length ? xs[Math.floor(this.rand() * xs.length)] : undefined;
  }

  /** The marked entrance, else a door in an outside wall, else the plan's bottom edge. */
  private findEntrance() {
    const { plan } = this.project;
    const doors = Object.values(plan.openings).filter((o) => o.kind !== 'window');
    const outer = doors
      .map((o) => {
        const wall = plan.walls[o.wallId];
        if (!wall) return null;
        const sides = wallSideRooms(plan, wall);
        if (sides.A && sides.B) return null;
        const c = add(plan.corners[wall.a], scale(wallDir(plan, wall), o.offset));
        const n = perp(wallDir(plan, wall));
        const inN = sides.A ? n : scale(n, -1);
        return { o, c, inN, along: wallDir(plan, wall), score: (o.entrance ? 0 : 10) + (o.kind === 'door' && o.doorStyle !== 'rolling' ? 0 : 5) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.score - b.score);
    const e = outer[0];
    if (e) return { inside: add(e.c, scale(e.inN, 1200)), outside: add(e.c, scale(e.inN, -2500)), along: e.along, found: true };
    const corners = Object.values(plan.corners);
    const b = corners.length ? bounds(corners) : { min: { x: 0, y: 0 }, max: { x: 10000, y: 10000 } };
    const mid = { x: (b.min.x + b.max.x) / 2, y: b.max.y };
    return { inside: add(mid, { x: 0, y: -1500 }), outside: add(mid, { x: 0, y: 3000 }), along: { x: 1, y: 0 }, found: false };
  }

  private makeStaff() {
    const { schedule, objects } = this.project;
    const taken = new Set<Id>();
    const people = this.project.staff.filter((s) => !s.absent);
    for (const s of people) if (s.stationId && objects.some((o) => o.id === s.stationId)) taken.add(s.stationId);
    for (const s of people) {
      let station = s.stationId ? objects.find((o) => o.id === s.stationId) : undefined;
      if (!station) {
        const want = ROLES[s.role].station;
        for (const use of want) {
          const free = (this.byUse.get(use) ?? []).filter((o) => !taken.has(o.id) && (use !== 'machine' || needsOperator(o)));
          if (free.length) {
            station = free[0];
            break;
          }
        }
        // Workbenches and QC tables are shared rather than left without a place.
        if (!station) station = want.flatMap((u) => (u === 'machine' || u === 'desk' ? [] : this.byUse.get(u) ?? []))[0];
      }
      if (station) taken.add(station.id);
      const start = s.start ?? schedule.start;
      const end = s.end ?? schedule.end;
      const arrival = start - this.r(6, 28);
      const a = this.newAgent({
        id: s.id,
        kind: 'staff',
        staff: s,
        name: s.name,
        role: s.role,
        color: ROLES[s.role]?.color ?? '#334155',
        arrival,
        leaveAt: end + this.r(0, 12),
        station,
        speed: s.role === 'cleaner' ? WALK * 0.8 : WALK * this.r(0.9, 1.1),
      });
      a.nextPersonal = start + this.r(80, 200);
      a.nextRound = start + this.r(40, 90);
      this.agents.push(a);
      if (station && this.machines.has(station.id) && s.role === 'operator') this.machines.get(station.id)!.operator = a;
    }
  }

  private makeCustomers() {
    const { schedule, sim } = this.project;
    const n = Math.max(0, Math.round(sim.customersPerDay));
    const open = schedule.start + 60;
    const close = schedule.end - 90;
    for (let i = 0; i < n; i++) {
      const arrival = open + ((close - open) * (i + this.r(0.1, 0.9))) / Math.max(1, n);
      this.customerCount++;
      this.agents.push(
        this.newAgent({ id: `cust-${i + 1}`, kind: 'customer', name: `ลูกค้า ${i + 1}`, role: 'customer', color: CUSTOMER_COLOR, arrival, leaveAt: Infinity, speed: WALK * 0.85 }),
      );
    }
  }

  private newAgent(p: Pick<Agent, 'id' | 'kind' | 'name' | 'role' | 'color' | 'arrival' | 'leaveAt' | 'speed'> & Partial<Agent>): Agent {
    return {
      pos: { ...this.entrance.outside },
      facing: 0,
      present: false,
      done: false,
      steps: [],
      cur: null,
      path: [],
      until: 0,
      act: 'walk',
      label: 'ยังไม่มา',
      place: 'ภายนอก',
      log: [],
      trail: [],
      lastTrail: -1,
      breaksTaken: new Set(),
      meetingDone: false,
      leaving: false,
      nextPersonal: Infinity,
      nextRound: Infinity,
      walked: 0,
      ...p,
    };
  }

  // ————— places —————

  private roomName(p: Place): string {
    return roomAt(planOf(this.project, p.level ?? 0), p)?.name ?? 'ภายนอก';
  }

  /** The floor each room is on, for rooms of either floor. */
  private roomLevel = new Map<Id, number>();

  private rooms(zone: Room['zone'][]): Room[] {
    const out: Room[] = [];
    for (let level = 0; level < this.navs.length; level++)
      for (const r of Object.values(planOf(this.project, level).rooms))
        if (zone.includes(r.zone)) {
          this.roomLevel.set(r.id, level);
          out.push(r);
        }
    return out;
  }

  /** A walkable point somewhere inside the room. */
  private pointIn(room: Room): Place | null {
    const level = this.roomLevel.get(room.id) ?? 0;
    const nav = this.navs[level];
    const poly = roomPolygon(planOf(this.project, level), room);
    const b = bounds(poly);
    for (let i = 0; i < 30; i++) {
      const p = { x: this.r(b.min.x, b.max.x), y: this.r(b.min.y, b.max.y) };
      if (!pointInPolygon(p, poly)) continue;
      const c = nearestFree(nav, p, 3);
      if (c) {
        const q = cellCenter(nav, c[0], c[1]);
        if (pointInPolygon(q, poly)) return { ...q, level };
      }
    }
    return null;
  }

  /** A free spot among the seats of these objects, claimed for `a`; or any spot when they are all taken. */
  private claimSpot(a: Agent, objs: PlacedObject[], prefer?: Vec2): { spot: Spot; key: string; obj: PlacedObject } | null {
    const all = objs.flatMap((o) => this.spots(o).map((spot, i) => ({ spot, key: `${o.id}:${i}`, obj: o })));
    if (!all.length) return null;
    const free = all.filter((s) => !this.seats.has(s.key) || this.seats.get(s.key) === a.id);
    const from = prefer ?? a.pos;
    const pool = free.length ? free : all;
    pool.sort((x, y) => dist(x.spot.approach, from) - dist(y.spot.approach, from));
    // Not always the very nearest seat, or everyone piles onto the same table end.
    const s = pool[Math.min(pool.length - 1, Math.floor(this.rand() * Math.min(3, pool.length)))];
    if (free.length) this.seats.set(s.key, a.id);
    return s;
  }

  private release(a: Agent) {
    if (a.seat && this.seats.get(a.seat) === a.id) this.seats.delete(a.seat);
    a.seat = undefined;
  }

  /**
   * A walk from one place to another: on one floor, a path over its grid; between floors, to the foot
   * (or head) of the stair, along it, and on over the other floor's grid.
   */
  private route(from: Place, to: Place): Place[] {
    const l0 = from.level ?? 0;
    const l1 = to.level ?? 0;
    const leg = (a: Place, b: Place, level: number): Place[] => (findPath(this.navs[level] ?? this.navs[0], a, b) ?? [a, b]).map((p) => ({ x: p.x, y: p.y, level }));
    const stair = this.project.upper?.stair;
    if (l0 === l1 || !stair || stair.length < 2 || this.navs.length < 2) {
      const path = leg(from, to, l0);
      path[path.length - 1] = { ...path[path.length - 1], level: l1 };
      return path;
    }
    const s = l1 > l0 ? stair : [...stair].reverse();
    return [...leg(from, s[0], l0), ...s.slice(1).map((p) => ({ ...p })), ...leg(s[s.length - 1], to, l1).slice(1)];
  }

  /** The places people stand at an object, marked with its floor. */
  private spots(o: PlacedObject): Spot[] {
    return spotsOf(o).map((spot) => onFloor(spot, levelOf(o)));
  }

  private gotoSpot(spot: Spot, label: string, seat?: string): Step {
    return { k: 'goto', to: spot.at, approach: spot.approach, facing: spot.facing, label, seat };
  }

  /** A spot beside a machine for someone other than its operator: the far end of its front. */
  private sideSpot(o: PlacedObject, k = -1): Spot {
    const hw = o.size.w / 2;
    const hd = o.size.d / 2;
    const p = { ...localToPlan(o, k * Math.min(hw * 0.5, 1400), hd + 650), level: levelOf(o) };
    return { at: p, approach: p, facing: o.rotation - Math.PI / 2 };
  }

  // ————— logging —————

  private setAct(a: Agent, act: Act, label: string, place = this.roomName(a.pos)) {
    if (a.act === act && a.label === label && a.place === place && a.log.length) return;
    const last = a.log[a.log.length - 1];
    if (last) last.t1 = this.t;
    a.act = act;
    a.label = label;
    a.place = place;
    if (last && last.t1 - last.t0 < 0.02 && last.act === act) a.log.pop();
    a.log.push({ t0: this.t, t1: this.t, act, label, place });
  }

  private event(text: string, kind: SimEvent['kind'], agentId?: string) {
    this.events.push({ t: this.t, text, kind, agentId });
    if (this.events.length > 400) this.events.shift();
  }

  // ————— the day's timetable for one person —————

  private currentBreak(a: Agent) {
    return this.project.schedule.breaks.find((b) => this.t >= b.start && this.t < b.end && !a.breaksTaken.has(b.id));
  }

  /** When the person must next drop what they are doing: a break, the meeting, a personal need, going home. */
  private nextEvent(a: Agent): number {
    let t = a.leaveAt;
    for (const b of this.project.schedule.breaks) if (!a.breaksTaken.has(b.id) && b.start > this.t) t = Math.min(t, b.start);
    if (this.attendsMeeting(a) && !a.meetingDone && this.meeting!.start > this.t) t = Math.min(t, this.meeting!.start);
    if (a.nextPersonal > this.t) t = Math.min(t, a.nextPersonal);
    if (a.role === 'technician' && a.nextRound > this.t) t = Math.min(t, a.nextRound);
    return t;
  }

  private attendsMeeting(a: Agent) {
    return !!this.meeting && (a.role === 'manager' || a.role === 'supervisor' || a.role === 'sales' || a.role === 'admin');
  }

  /** Whether something on the timetable is due now, so the rest of a work loop gives way to it. */
  private eventDue(a: Agent): boolean {
    if (a.busy || a.leaving || a.kind !== 'staff') return false;
    return this.t >= a.leaveAt || !!this.currentBreak(a) || (this.attendsMeeting(a) && !a.meetingDone && this.t >= this.meeting!.start && this.t < this.meeting!.end) || this.t >= a.nextPersonal;
  }

  private arriveSteps(a: Agent): Step[] {
    const steps: Step[] = [{ k: 'goto', to: this.entrance.inside, label: 'เข้าอาคาร' }];
    const clock = this.byUse.get('clock');
    if (clock?.length) {
      const s = this.claimSpot(a, clock, this.entrance.inside);
      if (s) steps.push(this.gotoSpot(s.spot, 'เครื่องสแกนนิ้ว'), { k: 'stay', act: 'clock', label: 'สแกนนิ้วเข้างาน', dur: 0.4, uncapped: true });
    }
    const lockers = this.byUse.get('locker');
    if (lockers?.length) {
      const s = this.claimSpot(a, lockers);
      if (s) steps.push(this.gotoSpot(s.spot, 'ล็อกเกอร์', s.key), { k: 'stay', act: 'clock', label: 'เปลี่ยนชุด เก็บของที่ล็อกเกอร์', dur: this.r(1.5, 3), uncapped: true });
    }
    return steps;
  }

  private leaveSteps(a: Agent): Step[] {
    const steps: Step[] = [];
    const lockers = this.byUse.get('locker');
    if (lockers?.length && a.kind === 'staff') {
      const s = this.claimSpot(a, lockers);
      if (s) steps.push(this.gotoSpot(s.spot, 'ล็อกเกอร์', s.key), { k: 'stay', act: 'clock', label: 'เก็บของ เตรียมกลับบ้าน', dur: this.r(1, 2.5), uncapped: true });
    }
    const clock = this.byUse.get('clock');
    if (clock?.length && a.kind === 'staff') {
      const s = this.claimSpot(a, clock);
      if (s) steps.push(this.gotoSpot(s.spot, 'เครื่องสแกนนิ้ว'), { k: 'stay', act: 'clock', label: 'สแกนนิ้วออกงาน', dur: 0.4, uncapped: true });
    }
    steps.push(
      { k: 'goto', to: this.entrance.inside, label: 'ทางออก' },
      { k: 'goto', to: this.exitPoint(), label: 'ออกจากโรงงาน' },
      {
        k: 'call',
        fn: () => {
          this.setAct(a, 'walk', a.kind === 'staff' ? 'กลับบ้านแล้ว' : 'ออกไปแล้ว', 'ภายนอก');
          a.present = false;
          a.done = true;
          a.log[a.log.length - 1].t1 = this.t;
          this.event(`${a.name} ${a.kind === 'staff' ? 'ออกงาน' : 'กลับออกไป'}`, 'leave', a.id);
        },
      },
    );
    return steps;
  }

  private exitPoint(): Vec2 {
    return add(this.entrance.outside, scale(this.entrance.along, this.r(-1500, 1500)));
  }

  /** What a person with nothing queued does next. */
  private decide(a: Agent) {
    const t = this.t;
    if (a.kind === 'customer') return this.decideCustomer(a);
    if (t >= a.leaveAt && !a.leaving) {
      a.leaving = true;
      a.steps = this.leaveSteps(a);
      return;
    }
    if (a.leaving) return;
    const brk = this.currentBreak(a);
    if (brk) {
      a.breaksTaken.add(brk.id);
      a.steps = this.breakSteps(a, brk.label, brk.end, !!brk.meal);
      return;
    }
    if (this.attendsMeeting(a) && !a.meetingDone && t >= this.meeting!.start && t < this.meeting!.end) {
      a.meetingDone = true;
      const s = this.claimSpot(a, [this.meeting!.table]);
      if (s) {
        a.steps = [this.gotoSpot(s.spot, 'ห้องประชุม', s.key), { k: 'stay', act: 'meeting', label: 'ประชุมเช้า', until: this.meeting!.end, uncapped: true }];
        return;
      }
    }
    if (t >= a.nextPersonal) {
      a.nextPersonal = t + this.r(110, 220);
      a.steps = this.personalSteps(a);
      if (a.steps.length) return;
    }
    a.steps = this.workSteps(a);
  }

  private breakSteps(a: Agent, label: string, end: number, meal: boolean): Step[] {
    this.event(`${a.name} ${label}`, 'break', a.id);
    const act: Act = meal ? 'meal' : 'break';
    const eat = this.byUse.get('eat') ?? [];
    const breakRooms = this.rooms(['break']);
    if (!meal && breakRooms.length) {
      const p = this.pointIn(this.pick(breakRooms)!);
      if (p) return [{ k: 'goto', to: p, label: 'มุมพัก' }, { k: 'stay', act, label, until: end, uncapped: true }];
    }
    if (eat.length) {
      const s = this.claimSpot(a, eat);
      if (s) return [this.gotoSpot(s.spot, meal ? 'โรงอาหาร' : 'จุดพัก', s.key), { k: 'stay', act, label, until: end, uncapped: true }];
    }
    const canteen = this.rooms(['canteen', 'break']);
    const p = canteen.length ? this.pointIn(this.pick(canteen)!) : null;
    if (p) return [{ k: 'goto', to: p, label: 'จุดพัก' }, { k: 'stay', act, label, until: end, uncapped: true }];
    return [{ k: 'stay', act, label, until: end, uncapped: true }];
  }

  private personalSteps(a: Agent): Step[] {
    const toilets = this.byUse.get('toilet') ?? [];
    const water = this.byUse.get('water') ?? [];
    if (toilets.length && (this.rand() < 0.65 || !water.length)) {
      const s = this.claimSpot(a, toilets);
      if (s) return [this.gotoSpot(s.spot, 'ห้องน้ำ', s.key), { k: 'stay', act: 'toilet', label: 'เข้าห้องน้ำ', dur: this.r(3, 7), uncapped: true }];
    }
    if (water.length) {
      const s = this.claimSpot(a, water);
      if (s) return [this.gotoSpot(s.spot, 'ตู้น้ำดื่ม'), { k: 'stay', act: 'break', label: 'ดื่มน้ำ', dur: this.r(1, 2), uncapped: true }];
    }
    return [];
  }

  private machinesList(filter: (m: MachineSim) => boolean = () => true): MachineSim[] {
    return [...this.machines.values()].filter(filter);
  }

  /** The role's normal work, one loop of it. */
  private workSteps(a: Agent): Step[] {
    const st = a.station;
    const name = st?.name ?? '';
    const atStation = (label: string, act: Act, dur?: number, interrupt = true): Step[] => {
      if (!st) return [];
      const spots = this.spots(st);
      const spot = st.assetId === 'reception' ? spots[0] : spots[0];
      return [this.gotoSpot(spot, name), { k: 'stay', act, label, dur, interrupt }];
    };
    const roam = (label: string, zones: Room['zone'][], dur: number, act: Act = 'work'): Step[] => {
      const rooms = this.rooms(zones);
      const room = this.pick(rooms.length ? rooms : Object.values(this.project.plan.rooms));
      const p = room && this.pointIn(room);
      return p ? [{ k: 'goto', to: p, label: room!.name }, { k: 'stay', act, label: `${label}${room!.name}`, dur }] : [{ k: 'stay', act: 'idle', label: 'รองาน', dur }];
    };
    const visitMachines = (n: number, label: string, act: Act, dur: [number, number]): Step[] => {
      const ms = this.machinesList((m) => needsOperator(m.obj));
      const out: Step[] = [];
      for (let i = 0; i < n && ms.length; i++) {
        const m = ms.splice(Math.floor(this.rand() * ms.length), 1)[0];
        out.push(this.gotoSpot(this.sideSpot(m.obj, this.rand() < 0.5 ? -1 : 1), m.obj.name), { k: 'stay', act, label: `${label} ${m.obj.name}`, dur: this.r(dur[0], dur[1]), interrupt: true });
      }
      return out;
    };

    switch (a.role) {
      case 'operator': {
        const m = st && this.machines.get(st.id);
        if (!m) return roam('ช่วยงานใน', ['production'], 25);
        const spot = this.spots(st)[0];
        if (m.broken) return [this.gotoSpot(spot, name), { k: 'stay', act: 'waitRepair', label: `รอช่างซ่อม ${name}`, machineId: st.id }];
        return [this.gotoSpot(spot, name), { k: 'stay', act: 'work', label: `คุมเครื่อง ${name}`, machineId: st.id }];
      }
      case 'technician': {
        if (this.t >= a.nextRound) {
          a.nextRound = this.t + this.r(80, 140);
          return [...visitMachines(2, 'ตรวจเช็กตามรอบ', 'inspect', [4, 9])];
        }
        const s = atStation('ประจำโต๊ะช่าง รอแจ้งซ่อม', 'idle');
        return s.length ? s : roam('รอแจ้งซ่อมที่', ['maintenance', 'production'], 30, 'idle');
      }
      case 'warehouse': {
        const racks = this.byUse.get('storage') ?? [];
        const rack = this.pick(racks);
        const targets = this.machinesList((m) => needsOperator(m.obj) && m.state !== 'off');
        const m = this.pick(targets.length ? targets : this.machinesList((m) => needsOperator(m.obj)));
        if (!rack) return roam('จัดของใน', ['warehouse', 'loading'], 20);
        const out: Step[] = [this.gotoSpot(this.spots(rack)[0], rack.name), { k: 'stay', act: 'work', label: 'หยิบวัตถุดิบ', dur: this.r(2, 4) }];
        if (m) out.push(this.gotoSpot(this.sideSpot(m.obj, 1), m.obj.name), { k: 'stay', act: 'deliver', label: `ส่งวัตถุดิบให้ ${m.obj.name}`, dur: this.r(0.8, 1.8) });
        const back = this.pick(racks)!;
        out.push(this.gotoSpot(this.spots(back)[0], back.name), { k: 'stay', act: 'work', label: 'จัดเรียงสต็อก', dur: this.r(3, 9) });
        return out;
      }
      case 'qc': {
        const desk = atStation('ตรวจชิ้นงาน', 'work', this.r(18, 35));
        return [...desk, ...visitMachines(1, 'สุ่มเก็บชิ้นงานจาก', 'inspect', [2, 4])];
      }
      case 'supervisor': {
        const desk = atStation('ทำเอกสาร / วางแผนงาน', 'work', this.r(15, 30));
        return [...desk, ...visitMachines(3, 'ตรวจไลน์ที่', 'patrol', [2, 4])];
      }
      case 'manager': {
        const desk = atStation('ทำงานที่โต๊ะ', 'work', this.r(30, 60));
        const walk = this.rand() < 0.6 ? visitMachines(2, 'เดินดูงานที่', 'patrol', [2, 5]) : roam('ตรวจพื้นที่ ', ['warehouse', 'qc', 'maintenance'], this.r(4, 8), 'patrol');
        return [...desk, ...walk];
      }
      case 'admin': {
        const desk = atStation('ทำงานเอกสาร / บัญชี', 'work', this.r(30, 60));
        const files = this.byUse.get('file') ?? [];
        const f = this.pick(files);
        return f ? [...desk, this.gotoSpot(this.spots(f)[0], f.name), { k: 'stay', act: 'work', label: 'ค้นแฟ้มเอกสาร', dur: this.r(2, 4) }] : desk.length ? desk : roam('ทำงานใน', ['office'], 30);
      }
      case 'sales': {
        const s = atStation('ทำงานที่โต๊ะ / โทรหาลูกค้า', 'work');
        return s.length ? s : roam('ทำงานใน', ['office', 'showroom'], 30);
      }
      case 'reception': {
        if (st?.assetId === 'reception') return [this.gotoSpot(this.spots(st)[0], name), { k: 'stay', act: 'work', label: 'ประจำเคาน์เตอร์ต้อนรับ', interrupt: false }];
        const s = atStation('ประจำจุดต้อนรับ', 'work');
        return s.length ? s : roam('ประจำ', ['reception', 'showroom'], 30);
      }
      case 'cleaner':
        return roam('ทำความสะอาด', ['production', 'office', 'canteen', 'toilet', 'warehouse', 'reception', 'showroom', 'meeting', 'locker'], this.r(8, 15), 'clean');
      default:
        return roam('ทำงานใน', ['production'], 20);
    }
  }

  // ————— customers —————

  private decideCustomer(a: Agent) {
    if (a.leaving) return;
    if (!a.log.some((s) => s.label === 'รอฝ่ายขาย')) {
      const steps: Step[] = [];
      const desk = this.byUse.get('reception')?.[0];
      if (desk) {
        const front = this.spots(desk)[1] ?? this.spots(desk)[0];
        steps.push(this.gotoSpot(front, 'เคาน์เตอร์ต้อนรับ'), { k: 'stay', act: 'visit', label: 'ติดต่อเคาน์เตอร์', dur: this.r(1.5, 3), uncapped: true });
      }
      const sofas = this.byUse.get('wait') ?? [];
      const s = sofas.length ? this.claimSpot(a, sofas) : null;
      if (s) steps.push(this.gotoSpot(s.spot, 'โซฟารับแขก', s.key));
      steps.push({ k: 'stay', act: 'visit', label: 'รอฝ่ายขาย', until: this.t + 60, uncapped: true, interrupt: true });
      steps.push({
        k: 'call',
        fn: () => {
          // Nobody came: give up and leave.
          this.tours = this.tours.filter((t) => t.customer !== a);
          this.event(`${a.name} รอนานเกินไป ไม่มีคนรับ กลับไปแล้ว`, 'customer', a.id);
          a.leaving = true;
          a.steps = this.leaveSteps(a);
        },
      });
      a.steps = steps;
      this.tours.push({ id: `tour-${a.id}`, customer: a, members: [a], since: this.t });
      return;
    }
    a.leaving = true;
    a.steps = this.leaveSteps(a);
  }

  private startTour(tour: Tour, host: Agent) {
    const c = tour.customer;
    tour.host = host;
    tour.members = [host, c];
    host.busy = 'tour';
    c.busy = 'tour';
    this.event(`${host.name} รับ${c.name} พาชมโรงงาน`, 'customer', host.id);
    const hostSteps: Step[] = [];
    const custSteps: Step[] = [];
    let n = 0;
    const together = (h: Spot | Vec2, cu: Spot | Vec2, place: string, act: { host: Act; cust: Act }, label: { host: string; cust: string }, dur: number) => {
      const key = `s${n++}`;
      const go = (s: Spot | Vec2, lbl: string): Step => ('at' in s ? this.gotoSpot(s, lbl) : { k: 'goto', to: s, label: lbl });
      hostSteps.push(go(h, place), { k: 'sync', tour, key, label: `รอ${c.name}` }, { k: 'stay', act: act.host, label: label.host, dur, uncapped: true });
      custSteps.push(go(cu, place), { k: 'sync', tour, key, label: `รอ${host.name}` }, { k: 'stay', act: act.cust, label: label.cust, dur, uncapped: true });
    };
    // Meet at the customer.
    const meet = add(c.pos, { x: 0, y: 0 });
    hostSteps.push({ k: 'goto', to: meet, label: `ไปรับ${c.name}` }, { k: 'sync', tour, key: 'meet', label: `ไปรับ${c.name}` });
    custSteps.push({ k: 'sync', tour, key: 'meet', label: 'รอฝ่ายขาย' });
    const pair = (o: PlacedObject): [Spot, Spot] => {
      const hd = o.size.d / 2;
      const f = o.rotation - Math.PI / 2;
      const s1 = localToPlan(o, -500, hd + 700);
      const s2 = localToPlan(o, 500, hd + 700);
      return [
        { at: s1, approach: s1, facing: f },
        { at: s2, approach: s2, facing: f },
      ];
    };
    for (const d of (this.byUse.get('display') ?? []).slice(0, 2)) {
      const [h, cu] = pair(d);
      together(h, cu, d.name, { host: 'host', cust: 'visit' }, { host: `แนะนำสินค้า ${d.name}`, cust: `ชมสินค้า ${d.name}` }, this.r(2, 4));
    }
    const ms = this.machinesList((m) => needsOperator(m.obj));
    for (let i = 0; i < 2 && ms.length; i++) {
      const m = ms.splice(Math.floor(this.rand() * ms.length), 1)[0];
      const [h, cu] = pair(m.obj);
      together(h, cu, m.obj.name, { host: 'host', cust: 'visit' }, { host: `สาธิตเครื่อง ${m.obj.name}`, cust: `ชมเครื่อง ${m.obj.name}` }, this.r(3, 6));
    }
    const table = this.byUse.get('meeting')?.[0];
    if (table) {
      const sp = this.spots(table);
      const half = Math.ceil(sp.length / 2);
      together(sp[1] ?? sp[0], sp[half + 1] ?? sp[sp.length - 1], 'ห้องประชุม', { host: 'meeting', cust: 'meeting' }, { host: `คุยรายละเอียดกับ${c.name}`, cust: 'คุยรายละเอียด / ใบเสนอราคา' }, this.r(10, 20));
    }
    const door = this.entrance.inside;
    together(door, add(door, scale(this.entrance.along, 700)), 'ทางออก', { host: 'host', cust: 'visit' }, { host: `ส่ง${c.name}`, cust: 'บอกลา' }, 0.5);
    hostSteps.push({
      k: 'call',
      fn: () => {
        host.busy = undefined;
        this.tours = this.tours.filter((t) => t !== tour);
      },
    });
    custSteps.push({
      k: 'call',
      fn: () => {
        c.busy = undefined;
        c.leaving = true;
        c.steps = [{ k: 'goto', to: this.exitPoint(), label: 'ออกจากโรงงาน' }, ...this.leaveSteps(c).slice(-1)];
      },
    });
    this.interrupt(host, hostSteps);
    this.interrupt(c, custSteps);
  }

  // ————— machines and repairs —————

  private interrupt(a: Agent, steps: Step[]) {
    this.release(a);
    a.cur = null;
    a.path = [];
    a.steps = steps;
  }

  private canTakeJob(a: Agent) {
    return a.present && !a.leaving && !a.busy && (!a.cur || (a.cur.k === 'stay' && !!a.cur.interrupt) || (a.cur.k === 'goto' && !a.steps.some((s) => s.k === 'stay' && (s.act === 'break' || s.act === 'meal' || s.act === 'toilet' || s.act === 'meeting'))));
  }

  private dispatch() {
    for (const req of this.repairs) {
      if (req.tech) continue;
      const techs = this.agents.filter((a) => a.role === 'technician' && this.canTakeJob(a) && !this.onBreak(a));
      if (!techs.length) continue;
      techs.sort((x, y) => dist(x.pos, req.machine.obj) - dist(y.pos, req.machine.obj));
      const tech = techs[0];
      req.tech = tech;
      req.machine.tech = tech;
      tech.busy = 'repair';
      const m = req.machine;
      const steps: Step[] = [];
      const tools = this.byUse.get('tools');
      if (tools?.length) {
        const s = this.claimSpot(tech, tools);
        if (s) steps.push(this.gotoSpot(s.spot, 'ตู้เครื่องมือ'), { k: 'stay', act: 'repair', label: `หยิบเครื่องมือไปซ่อม ${m.obj.name}`, dur: this.r(0.6, 1.2), uncapped: true });
      }
      const [lo, hi] = this.project.sim.repairMin;
      steps.push(
        this.gotoSpot(this.sideSpot(m.obj, -1), m.obj.name),
        {
          k: 'call',
          fn: () => {
            req.started = this.t;
            this.event(`${tech.name} เริ่มซ่อม ${m.obj.name}`, 'repair', tech.id);
          },
        },
        { k: 'stay', act: 'repair', label: `ซ่อม ${m.obj.name}`, dur: this.r(lo, Math.max(lo, hi)), uncapped: true },
        {
          k: 'call',
          fn: () => {
            m.broken = false;
            m.tech = undefined;
            tech.busy = undefined;
            this.repairs = this.repairs.filter((r) => r !== req);
            this.event(`${m.obj.name} ซ่อมเสร็จ ใช้เวลา ${Math.round(this.t - (m.brokeAt ?? this.t))} นาที`, 'repair', tech.id);
            const op = m.operator;
            if (op?.cur?.k === 'stay' && op.cur.act === 'waitRepair') op.until = this.t;
          },
        },
      );
      this.interrupt(tech, steps);
      this.event(`แจ้งซ่อม ${m.obj.name} → ${tech.name}`, 'repair', tech.id);
    }

    for (const tour of this.tours) {
      if (tour.host) continue;
      const c = tour.customer;
      if (!(c.cur?.k === 'stay' && c.cur.label === 'รอฝ่ายขาย')) continue;
      const hosts = this.agents.filter((a) => (a.role === 'sales' || (a.role === 'manager' && this.t - tour.since > 10)) && this.canTakeJob(a) && !this.onBreak(a));
      if (!hosts.length) continue;
      hosts.sort((x, y) => (x.role === 'sales' ? 0 : 1) - (y.role === 'sales' ? 0 : 1) || dist(x.pos, c.pos) - dist(y.pos, c.pos));
      this.startTour(tour, hosts[0]);
    }
  }

  private onBreak(a: Agent) {
    const s = a.cur?.k === 'stay' ? a.cur : a.steps.find((x) => x.k === 'stay');
    return !!s && s.k === 'stay' && (s.act === 'break' || s.act === 'meal' || s.act === 'meeting' || s.act === 'toilet' || s.act === 'clock');
  }

  private updateMachines(dt: number) {
    const { schedule, sim } = this.project;
    const work = Math.max(60, schedule.end - schedule.start - schedule.breaks.reduce((s, b) => s + (b.end - b.start), 0));
    const inShift = this.t >= schedule.start && this.t < schedule.end;
    for (const m of this.machines.values()) {
      const op = m.operator;
      const manned = !!op && op.present && op.cur?.k === 'stay' && op.cur.machineId === m.obj.id && op.cur.act === 'work';
      const unattended = !!catalogItem(m.obj.assetId)?.unattended;
      let state: MachineState;
      if (m.broken) state = m.tech && this.repairs.find((r) => r.machine === m)?.started !== undefined ? 'repair' : 'broken';
      else if (unattended) state = inShift ? 'running' : 'off';
      else if (manned) state = 'running';
      else state = inShift ? 'idle' : 'off';
      if (state !== m.state) m.state = state;
      m.totals[state] += dt;
      if (state === 'running' && !unattended) {
        const rate = (m.obj.breakdownsPerDay ?? sim.breakdownsPerDay) / work;
        if (this.rand() < rate * dt) {
          m.broken = true;
          m.breakdowns++;
          m.brokeAt = this.t;
          m.state = 'broken';
          this.repairs.push({ id: `rep-${m.obj.id}-${m.breakdowns}`, machine: m, t: this.t });
          this.event(`${m.obj.name} เครื่องเสีย!`, 'machine', op?.id);
          if (op) {
            op.cur = { k: 'stay', act: 'waitRepair', label: `รอช่างซ่อม ${m.obj.name}`, machineId: m.obj.id };
            op.until = this.nextEvent(op);
            this.setAct(op, 'waitRepair', op.cur.label);
          }
        }
      }
    }
  }

  // ————— moving through the day —————

  private startStep(a: Agent, s: Step) {
    a.cur = s;
    switch (s.k) {
      case 'goto': {
        this.release(a);
        if (s.seat) a.seat = s.seat;
        const target = s.approach ?? s.to;
        const path = this.route(a.pos, target);
        if (s.approach && dist(s.approach, s.to) > 1) path.push(s.to);
        a.path = path.slice(1);
        a.dest = s.to;
        a.destLabel = s.label;
        this.setAct(a, 'walk', th('เดินไป', s.label), `→ ${this.roomName(s.to)}`);
        break;
      }
      case 'stay': {
        const cap = s.uncapped ? Infinity : this.nextEvent(a);
        a.until = s.until ?? (s.dur !== undefined ? this.t + s.dur : cap);
        if (!s.uncapped) a.until = Math.min(a.until, cap);
        if (s.facing !== undefined) a.facing = s.facing;
        this.setAct(a, s.act, s.label);
        break;
      }
      case 'sync':
        this.setAct(a, a.kind === 'customer' ? 'visit' : 'host', s.label);
        break;
      case 'call':
        a.cur = null;
        s.fn();
        break;
    }
  }

  private finishStep(a: Agent) {
    const s = a.cur;
    a.cur = null;
    if (s?.k === 'goto') {
      a.dest = undefined;
      if (s.facing !== undefined) a.facing = s.facing;
    }
    if (s?.k === 'stay') this.release(a);
    if (this.eventDue(a)) a.steps = [];
  }

  private updateAgent(a: Agent, dt: number) {
    if (!a.present) {
      if (a.done || this.t < a.arrival) return;
      a.present = true;
      a.pos = { ...this.exitPoint() };
      a.steps = a.kind === 'staff' ? this.arriveSteps(a) : [{ k: 'goto', to: this.entrance.inside, label: 'เข้าอาคาร' }];
      this.event(`${a.name} ${a.kind === 'staff' ? `มาถึง (${ROLES[a.staff!.role].label})` : 'มาถึงโรงงาน'}`, a.kind === 'staff' ? 'arrive' : 'customer', a.id);
    }
    // Walk.
    if (a.cur?.k === 'goto') {
      let budget = a.speed * dt;
      while (budget > 0 && a.path.length) {
        const next = a.path[0];
        const d = sub(next, a.pos);
        const l = Math.hypot(d.x, d.y);
        if (l > 1) a.facing = Math.atan2(d.y, d.x);
        if (l <= budget) {
          a.pos = { ...next };
          a.path.shift();
          budget -= l;
          a.walked += l / 1000;
        } else {
          const f = budget / l;
          const z = next.z === undefined ? undefined : (a.pos.z ?? 0) + (next.z - (a.pos.z ?? 0)) * f;
          a.pos = { ...add(a.pos, scale(d, f)), level: a.pos.level, z };
          a.walked += budget / 1000;
          budget = 0;
        }
      }
      if (!a.path.length) this.finishStep(a);
    } else if (a.cur?.k === 'stay' && this.t >= a.until) this.finishStep(a);
    // Start whatever comes next; instant steps (calls) can chain.
    for (let guard = 0; guard < 8 && !a.cur && a.present; guard++) {
      if (!a.steps.length) this.decide(a);
      const next = a.steps.shift();
      if (!next) break;
      this.startStep(a, next);
    }
    if (this.t - a.lastTrail >= 0.25 && a.present) {
      a.trail.push({ ...a.pos });
      if (a.trail.length > 2400) a.trail.shift();
      a.lastTrail = this.t;
    }
  }

  private syncTours() {
    for (const tour of this.tours) {
      const keys = tour.members.map((m) => (m.cur?.k === 'sync' && m.cur.tour === tour ? m.cur.key : null));
      if (keys[0] && keys.every((k) => k === keys[0])) for (const m of tour.members) m.cur = null;
    }
  }

  /** Runs the day forward by dt minutes. */
  tick(dt: number) {
    let left = Math.max(0, dt);
    while (left > 1e-9) {
      const step = Math.min(MAX_STEP, left);
      left -= step;
      this.t += step;
      this.updateMachines(step);
      for (const a of this.agents) this.updateAgent(a, step);
      this.syncTours();
      this.dispatch();
      for (const a of this.agents) {
        const last = a.log[a.log.length - 1];
        if (last && a.present) last.t1 = this.t;
      }
    }
  }

  get finished() {
    return this.t >= this.dayEnd || (this.t > this.project.schedule.end && this.agents.every((a) => a.done));
  }

  clock() {
    return fmtClock(this.t);
  }

  /** Things in the layout that make the day unrealistic, for a note over the simulation. */
  warnings(): string[] {
    const out: string[] = [];
    if (!this.entrance.found) out.push('ยังไม่มีประตูที่ผนังด้านนอก คนจะเดินทะลุผนังเข้ามา (ใส่ประตูแล้วติ๊ก “ทางเข้า-ออกหลัก”)');
    if (!this.project.staff.length) out.push('ยังไม่มีพนักงาน ไปที่แผง “พนักงาน” เพื่อเพิ่มหรือสร้างทีมอัตโนมัติ');
    if (!this.machines.size) out.push('ยังไม่มีเครื่องจักรในผัง');
    if (!this.byUse.get('eat')?.length && !Object.values(this.project.plan.rooms).some((r) => r.zone === 'canteen' || r.zone === 'break')) out.push('ไม่มีโรงอาหาร/มุมพัก คนจะพักอยู่ที่เดิม');
    return out;
  }

  /** What `a` is going to do after the current step, in words. */
  upcoming(a: Agent, n = 4): string[] {
    const out: string[] = [];
    for (const s of a.steps) {
      if (out.length >= n) break;
      if (s.k === 'goto') out.push(th('ไป', s.label));
      else if (s.k === 'stay') out.push(s.label + (s.dur ? ` (~${Math.round(s.dur)} นาที)` : s.until && Number.isFinite(s.until) ? ` (ถึง ${fmtClock(s.until)})` : ''));
    }
    // Past the queued steps: where the role's routine takes them next.
    if (out.length < n && a.kind === 'staff' && !a.leaving && a.present) {
      if (a.station && a.cur?.k === 'stay' && a.cur.act !== 'work' && a.cur.act !== 'idle') out.push(th('กลับไปที่', a.station.name));
      else if (!a.steps.length) out.push(a.station ? `งานประจำที่ ${a.station.name}` : 'งานตามตำแหน่ง');
    }
    return out;
  }

  /** The person's fixed points for the rest of the day: breaks, the meeting, going home. */
  agenda(a: Agent): { t: number; label: string }[] {
    if (a.kind !== 'staff' || a.done) return [];
    const out: { t: number; label: string }[] = [];
    for (const b of this.project.schedule.breaks) if (b.end > this.t && !a.breaksTaken.has(b.id)) out.push({ t: b.start, label: `${b.label} (${fmtClock(b.start)}–${fmtClock(b.end)})` });
    if (this.attendsMeeting(a) && !a.meetingDone && this.meeting!.end > this.t) out.push({ t: this.meeting!.start, label: 'ประชุมเช้าที่ห้องประชุม' });
    out.push({ t: a.leaveAt, label: 'เลิกงาน สแกนออก' });
    return out.sort((x, y) => x.t - y.t);
  }
}
