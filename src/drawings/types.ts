/** Shared 2D drawing primitives for construction sheets. Model space in mm with y up; sizes marked "paper" are mm on the printed sheet. */
export interface Pt {
  x: number;
  y: number;
}
/** Printed pen widths: thin 0.13, medium 0.25, thick 0.35, cut 0.5 mm. */
export type LineWeight = 'thin' | 'medium' | 'thick' | 'cut';
export type LineStyle = 'solid' | 'dashed' | 'hidden' | 'center';
export type Prim =
  | { kind: 'line'; a: Pt; b: Pt; weight: LineWeight; style?: LineStyle; layer: string }
  | { kind: 'poly'; pts: Pt[]; closed: boolean; weight: LineWeight; style?: LineStyle; fill?: 'poche' | 'none' | string; layer: string }
  | { kind: 'arc'; c: Pt; r: number; a0: number; a1: number; weight: LineWeight; style?: LineStyle; layer: string }
  | { kind: 'text'; at: Pt; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number; layer: string }
  | { kind: 'dim'; a: Pt; b: Pt; offset: number; text?: string; layer: string };
/** One view to place on a sheet: its primitives in model mm (y up). Text size and dim offset are paper mm. Arc angles are radians, counter-clockwise from +x. */
export interface Drawing {
  title: string;
  prims: Prim[];
}
