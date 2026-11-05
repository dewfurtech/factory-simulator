import { MACHINES } from '../machines/data.js';
import type { PipeMaterial, Project } from './types';

/**
 * The figures behind the air, power and dust sums: what each machine draws and the rules the installation is designed
 * to. Each machine has built-in values, from its brochure where it gives one and otherwise from comparable machines;
 * the admin page overrides them, and a share link carries the settings it was made with.
 */

/** Where a figure comes from: the brochure, a comparable machine of another make, or a rule of thumb. */
export type UtilitySource = 'brochure' | 'comparable' | 'estimate' | 'admin';

export const SOURCE_LABEL: Record<UtilitySource, string> = { brochure: 'โบรชัวร์', comparable: 'เทียบเครื่องอื่น', estimate: 'ประมาณ', admin: 'ยืนยันแล้ว' };

export interface MachineUtility {
  /** Connected power, kW. */
  kw: number | null;
  /** Full-load current, A; worked out from kw when not given. */
  amps: number | null;
  /** The breaker the maker asks for, A; worked out when not given. */
  breaker: number | null;
  /** Free air used while working, litres a minute; 0 for none. */
  airLpm: number;
  /** Air pressure wanted at the machine, bar. */
  airBar: number | null;
  /** Dust extraction wanted, m³ an hour; 0 for none. */
  dustM3h: number;
  /** Dust ports, as printed: "4 × 100". */
  ports: string;
  /** Current while starting, as a multiple of the full-load current: about 1.5 on inverters, 6 for a motor started direct. */
  startFactor: number | null;
  /** Seconds of work per sheet that goes through it, for the line simulation. */
  secPerSheet: number | null;
  source: UtilitySource;
}

export interface PipeSize {
  label: string;
  /** Inside diameter, mm. */
  id: number;
}

export interface CableSize {
  mm2: number;
  /** Current it carries at 30 °C in conduit, A. */
  amps: number;
  /** And laid on a tray or clipped to a wall, A. */
  tray: number;
}

export interface DesignRules {
  // Compressed air
  pumpBar: number;
  pumpMaxBar: number;
  dryerDropBar: number;
  filterDropBar: number;
  filters: number;
  /** Most the main pipe may lose, bar. */
  pipeDropBar: number;
  /** Fastest the air may run in the main, m/s. */
  pipeVelocity: number;
  branchVelocity: number;
  pipeLayout: 'ring' | 'line';
  /** Length of each drop from the main to a machine, m. */
  branchLength: number;
  /** Bends and tees, as a share of extra length, where the pipe is not drawn. */
  fittingFactor: number;
  /** Most a drop from the main to a machine may lose, bar. */
  branchDropBar: number;
  /** Margin on the air used, for leaks and growth. */
  airMargin: number;
  pipes: PipeSize[];
  galvanizedPipes: PipeSize[];
  pprPipes: PipeSize[];
  // Power
  volts: number;
  powerFactor: number;
  /** Motor efficiency: a machine's kW is what its motors give, it draws more. */
  efficiency: number;
  /** Share of the connected load running at once. */
  diversity: number;
  /** Most the voltage may fall in a machine's feeder, in the main, and in both together, %. */
  voltDropPct: number;
  mainDropPct: number;
  totalDropPct: number;
  /** Most it may fall while a machine starts, %. */
  startDropPct: number;
  /** Cable from the transformer to the main board, m. */
  mainRun: number;
  /** How the feeders run together out of the board: laid side by side on a tray, or bunched in conduit. */
  install: 'tray' | 'conduit';
  /** Cable rating factor for the hot air it runs in. */
  ambientFactor: number;
  /** Breaker size over the full-load current. */
  breakerMargin: number;
  /** Up the wall and back down to a machine, m. */
  riser: number;
  /** Cable run assumed when the plan has no main board. */
  defaultRun: number;
  cableType: string;
  cables: CableSize[];
  // Dust
  ductVelocity: number;
  dustDiversity: number;
  ducts: number[];
}

/** Free floor each side of a machine must keep, mm; front is the side the operator works from. */
export interface SafetyDistances {
  front: number;
  back: number;
  left: number;
  right: number;
}

export interface UtilitySettings {
  /** Only the machines and fields that were changed; the rest stay on the built-in values. */
  machines: Record<string, Partial<MachineUtility>>;
  design: DesignRules;
  /** Safety distances set on the admin page, by machine; the rest keep Mastrox's figures. */
  safety?: Record<string, SafetyDistances>;
}

interface Brochure {
  id: string;
  name: string;
  cat: string;
  specs?: Record<string, string>;
}
const BROCHURES = MACHINES as unknown as Brochure[];

const kwIn = (text: string): number | null => {
  const m = text.match(/([\d.]+)\s*kW/i);
  return m ? parseFloat(m[1]) : null;
};

/** A machine's connected power from its brochure: the total where given, else the motors and heaters listed added up. */
export function brochurePower(assetId: string): number | null {
  const specs = BROCHURES.find((m) => m.id === assetId)?.specs;
  if (!specs) return null;
  for (const key of ['Total power', 'Power']) {
    const v = specs[key] && kwIn(specs[key]);
    if (v) return v;
  }
  let sum = 0;
  for (const [key, value] of Object.entries(specs)) {
    if (/servo/i.test(key)) continue;
    const each = kwIn(value);
    if (!each) continue;
    const times = value.match(/[×x]\s*(\d+)/);
    sum += each * (times ? parseInt(times[1]) : 1);
  }
  return sum ? Math.round(sum * 10) / 10 : null;
}

const row = (airLpm: number, airBar: number | null, dustM3h: number, ports: string, kw?: number): Partial<MachineUtility> => ({
  airLpm,
  airBar,
  dustM3h,
  ports,
  ...(kw && { kw }),
});

/**
 * Figures the brochures leave out, taken from machines of the same kind (see docs/utility-data.md for each source).
 * Dust follows the port sizes where they are known, at 20 m/s.
 */
const COMPARABLE: Record<string, Partial<MachineUtility>> = {
  'rakete-3500a': row(300, 7, 3200, '1 × 200'),
  'rakete-3500ant': row(300, 7, 3200, '1 × 200'),
  'rakete-4800ant': row(350, 7, 3200, '1 × 200'),
  'rakete-5000af': row(400, 7, 6400, '2 × 200'),
  'booster-e6': row(200, 6, 1100, '2 × 100'),
  'booster-e7': row(200, 6, 1100, '2 × 100'),
  'booster-e10': row(250, 6, 1700, '3 × 100'),
  'moon-10': row(300, 6.5, 1700, '3 × 100', 18),
  'moon-40': row(400, 6.5, 2300, '4 × 100', 22),
  'moon-40d': row(500, 6.5, 2800, '5 × 100', 28),
  'moon-80': row(400, 6.5, 2300, '4 × 100'),
  'nova-x2': row(150, 6.5, 1300, '1 × 150'),
  'nova-x4': row(150, 6.5, 1300, '1 × 150'),
  'nova-x6': row(150, 6.5, 1300, '1 × 150'),
  'nova-xs': row(250, 6.5, 2200, '150 + 125'),
  nebula: row(0, null, 1800, '1 × 120'),
  'aurora-open': row(100, 6, 0, ''),
  'aurora-slide': row(100, 6, 0, ''),
  'cold-presso': row(0, null, 0, ''),
  'glue-spreader': row(0, null, 0, ''),
  'vair-10': row(0, null, 0, ''),
  'vair-20': row(0, null, 0, ''),
};

/**
 * Seconds of work per sheet's worth of parts: a rule of thumb, there to compare layouts. A nesting CNC from the sheets a
 * day in starter.ts; an edge bander from about 30 m of edge a sheet at its feed speed; a drill at about a minute a part.
 */
const SEC_PER_SHEET: Record<string, number> = {
  'rakete-3500a': 960,
  'rakete-3500ant': 640,
  'rakete-4800ant': 520,
  'rakete-5000af': 410,
  'booster-e6': 300,
  'booster-e7': 300,
  'booster-e10': 280,
  'moon-10': 180,
  'moon-40': 150,
  'moon-40d': 130,
  'moon-80': 170,
  'nova-x2': 560,
  'nova-x4': 480,
  'nova-x6': 420,
  'nova-xs': 260,
  nebula: 600,
  'aurora-open': 360,
  'aurora-slide': 240,
  'cold-presso': 300,
  'glue-spreader': 120,
};

/**
 * Starting current over running current for the whole machine. CNC spindles and pumps on inverters start soft; an edge
 * bander or saw starts its biggest motor direct while the rest are off, which comes to two or three times its total.
 */
const START_FACTOR: [string, number][] = [
  ['rakete', 1.5],
  ['nova', 1.5],
  ['nebula', 1.5],
  ['vair', 1.5],
  ['booster', 2.5],
  ['moon', 2.5],
  ['aurora', 3],
];

/** Free air each compressor gives at full speed, litres a minute (B&D catalogue, DHF-10PM and DHF-20PM). */
export const COMPRESSOR_LPM: Record<string, number> = { 'vair-10': 1350, 'vair-20': 2600 };

export const DEFAULT_DESIGN: DesignRules = {
  pumpBar: 7,
  pumpMaxBar: 8,
  dryerDropBar: 0.2,
  filterDropBar: 0.1,
  filters: 3,
  pipeDropBar: 0.1,
  pipeVelocity: 6,
  branchVelocity: 10,
  pipeLayout: 'ring',
  branchLength: 5,
  fittingFactor: 1.5,
  branchDropBar: 0.05,
  airMargin: 1.3,
  pipes: [
    { label: 'Ø20', id: 17 },
    { label: 'Ø25', id: 22 },
    { label: 'Ø32', id: 28 },
    { label: 'Ø40', id: 36 },
    { label: 'Ø50', id: 46 },
    { label: 'Ø63', id: 58 },
    { label: 'Ø80', id: 74 },
    { label: 'Ø100', id: 94 },
  ],
  // Bore of medium-weight steel pipe and of PPR PN20; rules of thumb, to be set against the supplier's table.
  galvanizedPipes: [
    { label: '1/2"', id: 16 },
    { label: '3/4"', id: 21 },
    { label: '1"', id: 27 },
    { label: '1 1/4"', id: 36 },
    { label: '1 1/2"', id: 42 },
    { label: '2"', id: 53 },
    { label: '2 1/2"', id: 68 },
    { label: '3"', id: 80 },
  ],
  pprPipes: [
    { label: 'Ø20', id: 13 },
    { label: 'Ø25', id: 16 },
    { label: 'Ø32', id: 21 },
    { label: 'Ø40', id: 26 },
    { label: 'Ø50', id: 33 },
    { label: 'Ø63', id: 42 },
    { label: 'Ø75', id: 50 },
    { label: 'Ø90', id: 60 },
  ],
  volts: 380,
  powerFactor: 0.85,
  efficiency: 0.9,
  diversity: 0.8,
  voltDropPct: 3,
  mainDropPct: 2,
  totalDropPct: 5,
  startDropPct: 10,
  mainRun: 15,
  install: 'tray',
  ambientFactor: 0.87,
  breakerMargin: 1.25,
  riser: 4,
  defaultRun: 30,
  cableType: 'THW',
  // IEC 60364-5-52 table B.52.4, PVC copper, three loaded conductors, 30 °C: method A1 in conduit, method C on a tray.
  cables: [
    { mm2: 2.5, amps: 18, tray: 24 },
    { mm2: 4, amps: 24, tray: 32 },
    { mm2: 6, amps: 31, tray: 41 },
    { mm2: 10, amps: 42, tray: 57 },
    { mm2: 16, amps: 56, tray: 76 },
    { mm2: 25, amps: 73, tray: 96 },
    { mm2: 35, amps: 89, tray: 119 },
    { mm2: 50, amps: 108, tray: 144 },
    { mm2: 70, amps: 136, tray: 184 },
    { mm2: 95, amps: 164, tray: 223 },
    { mm2: 120, amps: 188, tray: 259 },
    { mm2: 150, amps: 216, tray: 299 },
    { mm2: 185, amps: 245, tray: 341 },
    { mm2: 240, amps: 286, tray: 403 },
  ],
  ductVelocity: 20,
  dustDiversity: 0.8,
  ducts: [100, 125, 150, 180, 200, 250, 300, 350, 400, 450, 500],
};

/** How each pipe material looks, on the plan and in 3D. */
export const PIPE_MATERIAL: Record<PipeMaterial, { label: string; color: string; fitting: string; metalness: number; roughness: number }> = {
  aluminium: { label: 'อะลูมิเนียม', color: '#2563eb', fitting: '#1e3a8a', metalness: 0.5, roughness: 0.35 },
  galvanized: { label: 'เหล็กกัลวาไนซ์', color: '#aeb6bf', fitting: '#6b7280', metalness: 0.85, roughness: 0.45 },
  ppr: { label: 'PPR', color: '#2f9e5b', fitting: '#1f7a43', metalness: 0, roughness: 0.4 },
};

/** The sizes a pipe material comes in. */
export function pipeTable(d: DesignRules, material: PipeMaterial): PipeSize[] {
  return material === 'galvanized' ? d.galvanizedPipes : material === 'ppr' ? d.pprPipes : d.pipes;
}

export const defaultUtilities = (): UtilitySettings => ({ machines: {}, design: structuredClone(DEFAULT_DESIGN) });

/** Rules saved before a field was added get the built-in figure for it, a cable row its tray rating too. */
export function fillDesign(d: Partial<DesignRules> | undefined): DesignRules {
  const out = { ...DEFAULT_DESIGN, ...d };
  out.cables = out.cables.map((c) => (c.tray ? c : { ...c, tray: DEFAULT_DESIGN.cables.find((x) => x.mm2 === c.mm2)?.tray ?? c.amps }));
  return out;
}

/** The built-in figures for a machine. */
export function builtInUtility(assetId: string): MachineUtility {
  const c = COMPARABLE[assetId] ?? {};
  const kw = brochurePower(assetId) ?? c.kw ?? null;
  // A machine with nothing but brochure figures to its name counts as brochure; anything added is flagged.
  const uses = (c.airLpm ?? 0) + (c.dustM3h ?? 0);
  return {
    kw,
    amps: null,
    breaker: null,
    airLpm: 0,
    airBar: null,
    dustM3h: 0,
    ports: '',
    startFactor: START_FACTOR.find(([prefix]) => assetId.startsWith(prefix))?.[1] ?? 2,
    secPerSheet: SEC_PER_SHEET[assetId] ?? null,
    ...c,
    source: uses || c.kw ? 'comparable' : 'brochure',
  };
}

let active = defaultUtilities();
/** Set by the settings store whenever the settings change. */
export function setActiveUtilities(s: UtilitySettings): void {
  active = s;
}
export const activeUtilities = (): UtilitySettings => active;

let linked: UtilitySettings | null = null;
/** Set to the settings a plan from a share link came with while it is open, so its safety distances are the sender's. */
export function setLinkedUtilities(s: UtilitySettings | null): void {
  linked = s;
}
/** The safety distances set on the admin page: the share link's while one is open, else this browser's. */
export const safetyOverrides = (): Record<string, SafetyDistances> => (linked ?? active).safety ?? {};

/** The settings a project is worked out with: those it came with from a share link, else this browser's. */
export function utilitiesFor(project: Pick<Project, 'utilities'>): UtilitySettings {
  const own = project.utilities;
  if (!own) return active;
  // A link made before a rule was added carries no figure for it: the built-in one stands in.
  let full = filled.get(own);
  if (!full) filled.set(own, (full = { ...own, design: fillDesign(own.design) }));
  return full;
}
const filled = new WeakMap<UtilitySettings, UtilitySettings>();

/** A machine's figures with the admin's changes on top. Anything the admin changed counts as confirmed. */
export function machineUtility(assetId: string, s: UtilitySettings = active): MachineUtility {
  const own = s.machines[assetId];
  return own ? { ...builtInUtility(assetId), source: 'admin', ...own } : builtInUtility(assetId);
}

/** The machines the admin page lists: those that take power or air. */
export const utilityMachines = (): { id: string; name: string }[] => BROCHURES.filter((m) => COMPARABLE[m.id]).map((m) => ({ id: m.id, name: m.name }));
