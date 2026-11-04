import { catalogItem, isMachine } from './catalog';
import type { Id, PipeMaterial, PlacedObject, Project, Vec2 } from './types';
import { routedRuns } from './runRoute';
import { drawnLengths, FITTING_LD, runLength, runTree } from './utilityRuns';
import { COMPRESSOR_LPM, machineUtility, pipeTable, utilitiesFor, type DesignRules, type PipeSize, type UtilitySettings } from './utilities';

/**
 * The sizing a customer asks about: cable and breaker for each machine, the main air pipe and the pressure left at
 * the far machine, and the dust ducts. Distances come off the plan, measured along the walls' directions as pipes and
 * cable trays run, from the main board and the compressor where they are placed.
 */

/** Resistivity of copper at running temperature, Ω·mm²/m, and a cable's reactance, Ω/km. */
const COPPER = 0.0225;
const REACTANCE = 0.08;

/** Standard breaker ratings, amps. */
const BREAKERS = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
const nextBreaker = (a: number) => BREAKERS.find((b) => b >= a) ?? BREAKERS[BREAKERS.length - 1];

const manhattan = (a: Vec2, b: Vec2) => (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / 1000;

/**
 * Rating factor for circuits run together (IEC 60364-5-52 table B.52.17): row 4, side by side on a perforated tray;
 * row 1, bunched in conduit. Past nine on a tray it falls no further.
 */
const GROUP_TRAY = [1, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72, 0.72];
const GROUP_CONDUIT = [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.48, 0.47, 0.45, 0.44, 0.43, 0.42, 0.41, 0.4, 0.4, 0.39, 0.38];
export function groupFactor(d: DesignRules, circuits: number): number {
  const t = d.install === 'conduit' ? GROUP_CONDUIT : GROUP_TRAY;
  return t[Math.min(t.length, Math.max(1, circuits)) - 1];
}

/** What a cable is sized by: the current it carries, the volts it loses running, or the volts it loses starting. */
export type CableReason = 'current' | 'drop' | 'start';
export const REASON_LABEL: Record<CableReason, string> = { current: 'กระแส', drop: 'แรงดันตก', start: 'ตอนสตาร์ท' };

export interface CableNeed {
  amps: number;
  breaker: number;
  metres: number;
  /** Rating factor for the heat and for the circuits beside it. */
  derate: number;
  /** Starting current over running. */
  start: number;
  /** Most it may lose running, %. */
  dropLimit: number;
}

export interface CableCheck {
  mm2: number;
  /** What it carries where it runs, A. */
  rated: number;
  drop: number;
  startDrop: number;
  /** What is wrong with it, in words; empty when it will do. */
  problems: string[];
}

export function checkCable(d: DesignRules, need: CableNeed, mm2: number): CableCheck {
  const table = d.cables.find((c) => c.mm2 === mm2) ?? [...d.cables].reverse().find((c) => c.mm2 < mm2);
  const base = d.install === 'conduit' ? table?.amps : (table?.tray ?? table?.amps);
  const rated = (base ?? 0) * d.ambientFactor * need.derate;
  const drop = voltDrop(d, need.amps, need.metres, mm2);
  const startDrop = voltDrop(d, need.amps * need.start, need.metres, mm2);
  const problems: string[] = [];
  if (rated < need.breaker) problems.push(`รับได้ ${rated.toFixed(0)}A ต่ำกว่าเบรกเกอร์ ${need.breaker}A สายร้อน`);
  if (drop > need.dropLimit) problems.push(`แรงดันตก ${drop.toFixed(1)}% เกิน ${need.dropLimit.toFixed(1)}%`);
  if (startDrop > d.startDropPct) problems.push(`ตอนสตาร์ทตก ${startDrop.toFixed(1)}% เกิน ${d.startDropPct}%`);
  return { mm2, rated, drop, startDrop, problems };
}

/** The smallest cable that carries the breaker's current where it runs and keeps the volts up, running and starting. */
export function pickCable(d: DesignRules, need: CableNeed): (CableCheck & { reason: CableReason }) | null {
  let reason: CableReason = 'current';
  for (const c of d.cables) {
    const k = checkCable(d, need, c.mm2);
    if (!k.problems.length) return { ...k, reason };
    // The last thing a size failed on is what the next one up was chosen for.
    reason = k.rated < need.breaker ? 'current' : k.drop > need.dropLimit ? 'drop' : 'start';
  }
  return null;
}

export interface CableLine {
  id: Id;
  name: string;
  kw: number | null;
  /** Full-load current, A. */
  amps: number;
  breaker: number;
  /** Run length, m. */
  length: number;
  /** The length is measured along drawn cable, not estimated. */
  drawn: boolean;
  /** Conductor size, mm²; null when the largest in the table is not enough. */
  mm2: number | null;
  /** Voltage drop at that size, running and starting, %. */
  drop: number;
  startDrop: number;
  /** What it carries where it runs, A. */
  rated: number;
  reason: CableReason;
  /** The cable already there, when one is given, and what is wrong with it. */
  existing: CableCheck | null;
}

export interface ElectricalPlan {
  lines: CableLine[];
  /** Whether the runs are measured from a main board on the plan. */
  hasBoard: boolean;
  connected: number;
  demand: number;
  amps: number;
  breaker: number;
  /** Size of the feeder to the main board, mm², or null when it needs cables in parallel. */
  mainMm2: number | null;
  /** How much the main loses, %; the feeders get what is left of the total. */
  mainDrop: number;
  /** Rating factor for the feeders lying together. */
  group: number;
  /** Transformer to suggest, kVA. */
  kva: number;
}

const TRANSFORMERS = [50, 100, 160, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000];

/** The voltage drop in a three-phase run, %. */
export function voltDrop(d: DesignRules, amps: number, metres: number, mm2: number): number {
  const sin = Math.sqrt(1 - d.powerFactor ** 2);
  const perMetre = (COPPER / mm2) * d.powerFactor + (REACTANCE / 1000) * sin;
  return ((Math.sqrt(3) * amps * metres * perMetre) / d.volts) * 100;
}

/** Full-load current from the motors' kW: what they give over how well they turn power into work. */
export const fullLoad = (d: DesignRules, kw: number) => (kw * 1000) / (Math.sqrt(3) * d.volts * d.powerFactor * d.efficiency);

export function electricalPlan(project: Project, s: UtilitySettings = utilitiesFor(project)): ElectricalPlan {
  const d = s.design;
  const board = project.objects.find((o) => o.assetId === 'mdb');
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const drawn = drawnLengths(routedRuns(project, 'power'), board, machines);
  const loads = machines.map((o) => {
    const u = machineUtility(o.assetId, s);
    const amps = u.amps ?? fullLoad(d, u.kw ?? 0);
    return { o, u, amps, breaker: u.breaker ?? nextBreaker(amps * d.breakerMargin) };
  });
  const connected = loads.reduce((t, l) => t + (l.u.kw ?? 0), 0);
  const demand = connected * d.diversity;
  const amps = loads.length ? fullLoad(d, demand) : 0;
  const breaker = nextBreaker(amps * d.breakerMargin);
  // The main sees the biggest machine starting while the rest run.
  const big = loads.reduce((m, l) => Math.max(m, l.amps * ((l.u.startFactor ?? 2) - 1)), 0);
  const main = pickCable(d, { amps, breaker, metres: d.mainRun, derate: 1, start: amps ? (amps + big) / amps : 1, dropLimit: d.mainDropPct });
  const mainDrop = main?.drop ?? d.mainDropPct;
  const group = groupFactor(d, loads.length);
  const dropLimit = Math.max(0.5, Math.min(d.voltDropPct, d.totalDropPct - mainDrop));
  const lines: CableLine[] = loads.map(({ o, u, amps, breaker }) => {
    const along = drawn.get(o.id);
    const length = (along ?? (board ? manhattan(board, o) : d.defaultRun)) + d.riser;
    const need: CableNeed = { amps, breaker, metres: length, derate: group, start: u.startFactor ?? 2, dropLimit };
    const pick = pickCable(d, need);
    const last = d.cables[d.cables.length - 1];
    const fallback = last ? checkCable(d, need, last.mm2) : { rated: 0, drop: 0, startDrop: 0 };
    return {
      id: o.id,
      name: o.name || catalogItem(o.assetId)?.label || 'เครื่อง',
      kw: u.kw,
      amps,
      breaker,
      length,
      drawn: along !== undefined,
      mm2: pick?.mm2 ?? null,
      drop: (pick ?? fallback).drop,
      startDrop: (pick ?? fallback).startDrop,
      rated: (pick ?? fallback).rated,
      reason: pick?.reason ?? 'current',
      existing: o.cableMm2 ? checkCable(d, need, o.cableMm2) : null,
    };
  });
  const kva = TRANSFORMERS.find((k) => k >= (demand / d.powerFactor / d.efficiency) * 1.25) ?? TRANSFORMERS[TRANSFORMERS.length - 1];
  return { lines, hasBoard: !!board, connected, demand, amps, breaker, mainMm2: main?.mm2 ?? null, mainDrop, group, kva };
}

/** Pressure lost in a straight pipe, bar: q free air in l/s, length m, inside diameter mm, inlet pressure bar absolute. */
export const pipeDrop = (lps: number, metres: number, id: number, absBar: number): number => (450 * lps ** 1.85 * metres) / (id ** 5 * absBar);

/** How fast the air runs, m/s: the free air squeezed to the pipe's pressure, through its bore. */
export function pipeSpeed(lps: number, id: number, absBar: number): number {
  const area = (Math.PI * (id / 1000) ** 2) / 4;
  return ((lps / 1000) * (1.013 / absBar)) / area;
}

/** One stretch of pipe on a machine's way from the compressor: its length, the air through it, the fittings at its start. */
interface Stretch {
  metres: number;
  lpm: number;
  fittingLd: number;
}

/** Pressure lost along a way at one bore, bar. */
const wayDrop = (way: Stretch[], id: number, abs: number) => way.reduce((t, w) => t + pipeDrop(w.lpm / 60, w.metres + (w.fittingLd * id) / 1000, id, abs), 0);

export interface AirBranch {
  id: Id;
  name: string;
  lpm: number;
  /** The drop's size, and what it loses with the valve and bends on it, bar. */
  pipe: PipeSize | null;
  branchDrop: number;
  /** Metres of main to it, and what that main loses on the way, bar. */
  metres: number;
  mainDrop: number;
  /** Pressure it wants, and what reaches it with the pump at the set pressure, bar. */
  want: number;
  at: number;
}

export interface AirPlan {
  /** Air used, and with the margin, litres a minute. */
  used: number;
  needed: number;
  /** Air the compressors on the plan give, litres a minute. */
  have: number;
  /** Length of main to the farthest machine, m. */
  mainLength: number;
  /** Metres of pipe drawn on the plan, and the air users it does not reach. */
  drawnMetres: number;
  unreached: string[];
  /** The ways are measured along drawn pipe. */
  drawn: boolean;
  layout: DesignRules['pipeLayout'];
  material: PipeMaterial;
  /** The main as sized, or the one the building has when it is given. */
  main: PipeSize | null;
  /** The size the app would pick, and whether the given main is too small. */
  suggested: PipeSize | null;
  tooSmall: boolean;
  /** Most the main loses to any machine, bar, and how fast the air leaves the compressor in it, m/s. */
  mainDrop: number;
  mainSpeed: number;
  /** Pressure lost in the dryer and filters, bar. */
  treatment: number;
  /** Pressure at the worst-off machine with the pump at its usual setting, bar. */
  atMachine: number;
  /** The highest pressure any machine wants, bar, and the machine that wants it. */
  wanted: number;
  wantedBy: string;
  /** What the pump must be set to for every machine to get its pressure, bar, and the machine that sets it. */
  setPressure: number;
  worst: string;
  /** The pump cannot reach it. */
  short: boolean;
  branches: AirBranch[];
}

export function airPlan(project: Project, s: UtilitySettings = utilitiesFor(project)): AirPlan {
  const d = s.design;
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const users = machines.filter((o) => machineUtility(o.assetId, s).airLpm > 0);
  const pumps = machines.filter((o) => COMPRESSOR_LPM[o.assetId]);
  const lpmOf = new Map(users.map((o) => [o.id as string, machineUtility(o.assetId, s).airLpm * d.airMargin]));
  const used = users.reduce((t, o) => t + machineUtility(o.assetId, s).airLpm, 0);
  const needed = used * d.airMargin;
  const have = pumps.reduce((t, o) => t + COMPRESSOR_LPM[o.assetId], 0);
  const from = pumps[0] ?? users[0];
  const runs = routedRuns(project, 'air');
  const tree = runTree(runs, pumps[0], users);
  // Each machine's way from the compressor, stretch by stretch, with the air of every machine beyond it.
  const ways = new Map<string, Stretch[]>();
  if (tree.paths.size) {
    for (const [id, path] of tree.paths) ways.set(id, path.steps.map((st) => ({ metres: st.edge.metres, lpm: st.edge.serves.reduce((t, x) => t + (lpmOf.get(x) ?? 0), 0), fittingLd: st.fittingLd })));
  } else if (from) {
    // Not drawn: the main runs past the machines in order of distance; a ring feeds them from both sides, half each way.
    const share = d.pipeLayout === 'ring' ? 0.5 : 1;
    const order = users.map((o) => ({ id: o.id as string, at: manhattan(from, o) })).sort((a, b) => a.at - b.at);
    order.forEach((m, i) => {
      const way: Stretch[] = [];
      for (let j = 0; j <= i; j++) {
        const beyond = order.slice(j).reduce((t, x) => t + (lpmOf.get(x.id) ?? 0), 0);
        way.push({ metres: (order[j].at - (j ? order[j - 1].at : 0)) * d.fittingFactor, lpm: beyond * share, fittingLd: 0 });
      }
      ways.set(m.id, way);
    });
  }
  const abs = d.pumpBar + 1;
  const lps = needed / 60;
  const material = project.airPipe ?? 'aluminium';
  const table = pipeTable(d, material);
  const firstFlow = Math.max(0, ...[...ways.values()].map((w) => w[0]?.lpm ?? 0)) / 60;
  const worstDrop = (id: number) => Math.max(0, ...[...ways.values()].map((w) => wayDrop(w, id, abs)));
  const fits = (p: PipeSize) => pipeSpeed(firstFlow || lps, p.id, abs) <= d.pipeVelocity && worstDrop(p.id) <= d.pipeDropBar;
  const suggested = table.find(fits) ?? null;
  const given = project.airMain ? (table.find((p) => p.label === project.airMain) ?? null) : null;
  const main = given ?? suggested;
  const sized = main ?? table[table.length - 1];
  const mainDrop = sized && lps ? worstDrop(sized.id) : 0;
  const mainSpeed = sized && lps ? pipeSpeed(firstFlow || lps, sized.id, abs) : 0;
  const treatment = d.dryerDropBar + d.filterDropBar * d.filters;
  // A drop: tee off the top of the main, two bends down, a valve, then its length to the machine.
  const dropLd = FITTING_LD.teeBranch + 2 * FITTING_LD.elbow + FITTING_LD.valve;
  const rows = users.map((o) => {
    const u = machineUtility(o.assetId, s);
    const lpm = lpmOf.get(o.id) ?? 0;
    const branchLoss = (p: PipeSize) => pipeDrop(lpm / 60, d.branchLength + (dropLd * p.id) / 1000, p.id, abs);
    const pipe = table.find((p) => pipeSpeed(lpm / 60, p.id, abs) <= d.branchVelocity && branchLoss(p) <= d.branchDropBar) ?? null;
    const way = ways.get(o.id);
    return {
      id: o.id,
      name: o.name,
      lpm: u.airLpm,
      pipe,
      branchDrop: branchLoss(pipe ?? table[table.length - 1]),
      metres: way ? way.reduce((t, w) => t + w.metres, 0) : 0,
      mainDrop: way && sized ? wayDrop(way, sized.id, abs) : 0,
      want: u.airBar ?? 0,
    };
  });
  let setPressure = 0;
  let worst = '';
  let wanted = 0;
  let wantedBy = '';
  for (const r of rows) {
    const need = r.want + treatment + r.mainDrop + r.branchDrop;
    if (need > setPressure) [setPressure, worst] = [need, r.name];
    if (r.want > wanted) [wanted, wantedBy] = [r.want, r.name];
  }
  const branches: AirBranch[] = rows.map((r) => ({ ...r, at: setPressure - treatment - r.mainDrop - r.branchDrop }));
  const lowest = Math.max(0, ...rows.map((r) => r.mainDrop + r.branchDrop));
  const unreached = runs.length ? users.filter((o) => !tree.paths.has(o.id)).map((o) => o.name) : [];
  return {
    used,
    needed,
    have,
    mainLength: Math.max(0, ...rows.map((r) => r.metres)),
    drawnMetres: runLength(runs) / 1000,
    unreached,
    drawn: tree.paths.size > 0,
    layout: d.pipeLayout,
    material,
    main,
    suggested,
    tooSmall: !!given && (!suggested || table.indexOf(given) < table.indexOf(suggested)),
    mainDrop,
    mainSpeed,
    treatment,
    atMachine: d.pumpBar - treatment - lowest,
    wanted,
    wantedBy,
    setPressure,
    worst,
    short: setPressure > d.pumpMaxBar,
    branches,
  };
}

/** The bore that carries `m3h` at this speed: the next standard size up. */
export function pickDuct(d: DesignRules, m3h: number): number | null {
  const bore = Math.sqrt((4 * (m3h / 3600)) / (Math.PI * d.ductVelocity)) * 1000;
  return d.ducts.find((x) => x >= bore) ?? null;
}

export interface DustPlan {
  total: number;
  /** With not every machine extracting at once. */
  demand: number;
  /** Metres of duct drawn on the plan. */
  drawnMetres: number;
  main: number | null;
  lines: { id: Id; name: string; m3h: number; ports: string; duct: number | null }[];
}

export function dustPlan(project: Project, s: UtilitySettings = utilitiesFor(project)): DustPlan {
  const d = s.design;
  const lines = project.objects
    .filter((o: PlacedObject) => isMachine(o) && !o.hidden && machineUtility(o.assetId, s).dustM3h > 0)
    .map((o) => {
      const u = machineUtility(o.assetId, s);
      return { id: o.id, name: o.name, m3h: u.dustM3h, ports: u.ports, duct: pickDuct(d, u.dustM3h) };
    });
  const total = lines.reduce((t, l) => t + l.m3h, 0);
  const demand = total * d.dustDiversity;
  return { total, demand, drawnMetres: runLength(routedRuns(project, 'dust')) / 1000, main: demand ? pickDuct(d, demand) : null, lines };
}

/** What one stretch of a drawn run carries: the machines beyond it, and the current or the air through it. */
export interface RunSegment {
  seg: number;
  /** Length as hung, round any columns, m, and the bends that takes. */
  metres: number;
  bends: number;
  /** The machines it feeds; empty when it is not joined to the board or the compressor. */
  serves: { id: Id; name: string }[];
  /** Power: the current through it and each machine's cable on it. */
  amps: number;
  cables: { name: string; mm2: number | null; amps: number; breaker: number }[];
  /** Air: litres a minute through it with the margin, how fast, what it loses, and the pressure where it ends. */
  lpm: number;
  speed: number;
  drop: number;
  at: number | null;
  pipe: string | null;
}

/** Stretch by stretch, what a drawn run carries; null when there is no such run. */
export function runSegments(project: Project, runId: string, s: UtilitySettings = utilitiesFor(project)): RunSegment[] | null {
  const run = project.runs?.find((r) => r.id === runId);
  if (!run) return null;
  const d = s.design;
  const routed = routedRuns(project, run.kind);
  const me = routed.find((r) => r.id === runId)!;
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const names = new Map(machines.map((o) => [o.id as string, o.name || catalogItem(o.assetId)?.label || 'เครื่อง']));
  const out: RunSegment[] = run.points.slice(1).map((_, i) => {
    const idx = me.segOf.flatMap((k, j) => (k === i ? [j] : []));
    const metres = idx.reduce((t, j) => t + Math.hypot(me.points[j + 1].x - me.points[j].x, me.points[j + 1].y - me.points[j].y), 0) / 1000;
    return { seg: i, metres, bends: Math.max(0, idx.length - 1), serves: [], amps: 0, cables: [], lpm: 0, speed: 0, drop: 0, at: null, pipe: null };
  });
  if (run.kind === 'dust') return out;
  const source = run.kind === 'power' ? project.objects.find((o) => o.assetId === 'mdb') : machines.find((o) => COMPRESSOR_LPM[o.assetId]);
  const targets = run.kind === 'power' ? machines : machines.filter((o) => machineUtility(o.assetId, s).airLpm > 0);
  const tree = runTree(routed, source, targets);
  const mine = tree.edges.filter((e) => e.run === runId);
  const power = run.kind === 'power' ? electricalPlan(project, s) : null;
  const air = run.kind === 'air' ? airPlan(project, s) : null;
  const lpmOf = (id: string) => machineUtility(machines.find((o) => o.id === id)!.assetId, s).airLpm * d.airMargin;
  const bore = air && (air.main ?? pipeTable(d, air.material).at(-1));
  const abs = d.pumpBar + 1;
  for (const seg of out) {
    const here = mine.filter((e) => e.seg === seg.seg);
    if (!here.length) continue;
    // The stretch's start carries the most: everything beyond any join along it.
    const head = here.reduce((m, e) => (e.serves.length > m.serves.length ? e : m));
    seg.serves = head.serves.map((id) => ({ id: id as Id, name: names.get(id) ?? '' }));
    if (power) {
      const lines = power.lines.filter((l) => head.serves.includes(l.id));
      seg.cables = lines.map((l) => ({ name: l.name, mm2: l.mm2, amps: l.amps, breaker: l.breaker }));
      seg.amps = lines.reduce((t, l) => t + l.amps, 0);
    }
    if (air && bore) {
      seg.pipe = bore.label;
      seg.lpm = head.serves.reduce((t, id) => t + lpmOf(id), 0);
      seg.speed = pipeSpeed(seg.lpm / 60, bore.id, abs);
      seg.drop = here.reduce((t, e) => t + pipeDrop(e.serves.reduce((u, id) => u + lpmOf(id), 0) / 60, e.metres, bore.id, abs), 0);
      // Along any machine's way through it, what is lost up to its far end.
      const way = tree.paths.get(head.serves[0]);
      if (way) {
        const last = way.steps.map((st) => st.edge.run === runId && st.edge.seg === seg.seg).lastIndexOf(true);
        let lost = 0;
        for (const st of way.steps.slice(0, last + 1)) lost += pipeDrop(st.edge.serves.reduce((u, id) => u + lpmOf(id), 0) / 60, st.edge.metres + (st.fittingLd * bore.id) / 1000, bore.id, abs);
        seg.at = air.setPressure - air.treatment - lost;
      }
    }
  }
  return out;
}
