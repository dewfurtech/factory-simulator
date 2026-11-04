import { MACHINES } from '../machines/data.js';
import { catalogItem, isMachine } from './catalog';
import type { Id, Project } from './types';
import { airPlan, dustPlan, electricalPlan } from './utilityCalc';
import { brochurePower, COMPRESSOR_LPM, machineUtility, utilitiesFor } from './utilities';

export { COMPRESSOR_LPM };

/**
 * What the building needs before the machines arrive, in words a customer can pass to their electrician: the power
 * the layout draws, the compressed air, the dust extraction, and the heaviest machine for the floor. Power comes from
 * the brochures where they give it; the rest are rules of thumb, marked as estimates, to be confirmed by Mastrox.
 */

interface Brochure {
  id: string;
  cat: string;
  name: string;
  weight?: number | null;
  specs?: Record<string, string>;
}
const BROCHURE = new Map((MACHINES as unknown as Brochure[]).map((m) => [m.id, m]));

export const machineAir = (assetId: string): number => machineUtility(assetId).airLpm;

/** A machine's connected power, and whether the figure is not from its brochure. */
export function machinePower(assetId: string): { kw: number; guess: boolean } | null {
  const u = machineUtility(assetId);
  return u.kw ? { kw: u.kw, guess: brochurePower(assetId) === null && u.source !== 'admin' } : null;
}

export interface PrepLine {
  id: Id;
  name: string;
  kw: number | null;
  kwGuess: boolean;
  air: number;
  dust: number;
  weight: number | null;
}

export interface SitePrep {
  lines: PrepLine[];
  /** Every machine's connected power added up, kW. */
  connected: number;
  /** What the layout draws with machines not all at full load at once, kW. */
  demand: number;
  amps: number;
  breaker: number;
  transformer: number;
  /** Free air the machines use, litres a minute, and with a margin for leaks and growth. */
  air: number;
  airNeeded: number;
  /** Air the compressors on the plan give, litres a minute. */
  airHave: number;
  /** The compressor set to suggest, when the plan has too little air. */
  compressor: { id: string; count: number } | null;
  dust: number;
  heaviest: { name: string; weight: number } | null;
  /** Some figures are rules of thumb, not from a brochure. */
  guesses: boolean;
  /** Things to sort out on site, plainly worded. */
  checklist: string[];
}

export function sitePrepOf(project: Project): SitePrep {
  const settings = utilitiesFor(project);
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const lines: PrepLine[] = machines.map((o) => {
    const u = machineUtility(o.assetId, settings);
    return {
      id: o.id,
      name: o.name || catalogItem(o.assetId)?.label || 'เครื่อง',
      kw: u.kw,
      kwGuess: u.source !== 'admin' && brochurePower(o.assetId) === null && u.kw !== null,
      air: u.airLpm,
      dust: u.dustM3h,
      weight: BROCHURE.get(o.assetId)?.weight ?? null,
    };
  });
  const power = electricalPlan(project, settings);
  const pipes = airPlan(project, settings);
  const { connected, demand, amps, breaker, kva: transformer } = power;
  const air = pipes.used;
  const airNeeded = pipes.needed;
  const airHave = pipes.have;
  let compressor: SitePrep['compressor'] = null;
  if (airNeeded > airHave && air > 0) {
    const short = airNeeded - airHave;
    compressor = short <= COMPRESSOR_LPM['vair-10'] ? { id: 'vair-10', count: 1 } : { id: 'vair-20', count: Math.ceil(short / COMPRESSOR_LPM['vair-20']) };
  }
  const dust = dustPlan(project, settings).total;
  const weighed = lines.filter((l) => l.weight);
  const heaviest = weighed.length ? weighed.reduce((a, b) => (b.weight! > a.weight! ? b : a)) : null;
  const guesses = machines.some((o) => machineUtility(o.assetId, settings).source !== 'admin');

  const checklist: string[] = [];
  if (connected > 0) {
    checklist.push(`ไฟ 3 เฟส 380V เบรกเกอร์ ≥ ${breaker}A`);
    if (demand > 100) checklist.push(`หม้อแปลง ≥ ${transformer} kVA`);
  }
  if (air > 0) {
    checklist.push(`ลมอัด ≥ ${(airNeeded / 1000).toFixed(2)} m³/นาที ตั้งปั๊ม ${pipes.setPressure.toFixed(1)} บาร์`);
    if (compressor) checklist.push(`ปั๊มลมไม่พอ: ${compressor.id === 'vair-10' ? 'VAir 10HP' : 'VAir 20HP'}${compressor.count > 1 ? ` × ${compressor.count}` : ''}`);
  }
  if (dust > 0) checklist.push(`ดูดฝุ่น ~${(Math.round(dust / 100) * 100).toLocaleString('en-US')} m³/ชม.`);
  if (heaviest && heaviest.weight! >= 2000) checklist.push(`พื้นรับ ${(heaviest.weight! / 1000).toFixed(1)} ตัน (${heaviest.name})`);
  if (lines.some((l) => l.kw === null)) checklist.push('บางเครื่องไม่มีข้อมูลไฟ');
  return {
    lines,
    connected,
    demand,
    amps,
    breaker,
    transformer,
    air,
    airNeeded,
    airHave,
    compressor,
    dust,
    heaviest: heaviest && { name: heaviest.name, weight: heaviest.weight! },
    guesses,
    checklist,
  };
}
