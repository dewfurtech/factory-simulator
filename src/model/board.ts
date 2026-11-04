import type { Id, Project } from './types';
import { electricalPlan, type ElectricalPlan } from './utilityCalc';
import { utilitiesFor } from './utilities';

/**
 * The main board as a customer or electrician wants to see it: its main breaker, one breaker per machine, the five
 * wires of each feeder (three phases, neutral, earth), and what all of it comes to as a shopping list.
 */

export type WireRole = 'L1' | 'L2' | 'L3' | 'N' | 'PE';

/** Thai wiring colours (TIS 11-2553): brown, black, grey, blue, green and yellow. */
export const WIRE_COLOR: Record<WireRole, { name: string; css: string }> = {
  L1: { name: 'น้ำตาล', css: '#7b4a21' },
  L2: { name: 'ดำ', css: '#17191d' },
  L3: { name: 'เทา', css: '#8a9099' },
  N: { name: 'ฟ้า', css: '#2b7fd4' },
  PE: { name: 'เขียวแถบเหลือง', css: 'repeating-linear-gradient(90deg, #2f9e44 0 12px, #f2c218 12px 24px)' },
};

export interface Wire {
  role: WireRole;
  mm2: number;
}

const SIZES = [2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
const atLeast = (mm2: number) => SIZES.find((s) => s >= mm2) ?? SIZES[SIZES.length - 1];

/** The five wires of a feeder from its phase size: neutral and earth drop to half on big cables (IEC 60364-5-54). */
export function wiresFor(mm2: number): Wire[] {
  const earth = mm2 <= 16 ? mm2 : mm2 <= 35 ? 16 : atLeast(mm2 / 2);
  const neutral = mm2 <= 16 ? mm2 : atLeast(mm2 / 2);
  return [
    { role: 'L1', mm2 },
    { role: 'L2', mm2 },
    { role: 'L3', mm2 },
    { role: 'N', mm2: neutral },
    { role: 'PE', mm2: earth },
  ];
}

export interface Feeder {
  id: Id;
  name: string;
  amps: number;
  breaker: number;
  metres: number;
  drawn: boolean;
  /** Empty when the largest cable in the table is not enough. */
  wires: Wire[];
}

export interface Board {
  plan: ElectricalPlan;
  cableType: string;
  mainWires: Wire[];
  feeders: Feeder[];
  /** The breakers to buy, biggest first. */
  breakers: { amps: number; qty: number }[];
  /** The wire to buy, by size, in metres. */
  cable: { mm2: number; metres: number }[];
}

export function boardOf(project: Project): Board {
  const plan = electricalPlan(project);
  const d = utilitiesFor(project).design;
  const feeders: Feeder[] = plan.lines.map((l) => ({
    id: l.id,
    name: l.name,
    amps: l.amps,
    breaker: l.breaker,
    metres: l.length,
    drawn: l.drawn,
    wires: l.mm2 ? wiresFor(l.mm2) : [],
  }));
  const count = new Map<number, number>([[plan.breaker, 1]]);
  for (const f of feeders) count.set(f.breaker, (count.get(f.breaker) ?? 0) + 1);
  const metres = new Map<number, number>();
  for (const f of feeders) for (const w of f.wires) metres.set(w.mm2, (metres.get(w.mm2) ?? 0) + f.metres);
  return {
    plan,
    cableType: d.cableType,
    mainWires: plan.mainMm2 ? wiresFor(plan.mainMm2) : [],
    feeders,
    breakers: [...count].map(([amps, qty]) => ({ amps, qty })).sort((a, b) => b.amps - a.amps),
    cable: [...metres].map(([mm2, m]) => ({ mm2, metres: Math.ceil(m) })).sort((a, b) => b.mm2 - a.mm2),
  };
}
