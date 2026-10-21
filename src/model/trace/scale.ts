import type { Mm } from '../types';
import { dist } from '../vec';
import { detectPlan, DOOR_OPENING, type TracedPlan, type TraceOptions } from './detect';
import { shrink, type Gray } from './raster';

/**
 * How walls are drawn: filled or hatched dark, as two outlines with paper (or sparse hatching) between, or sketched
 * by hand in pencil, two wavering and broken outlines.
 */
export type WallStyle = 'solid' | 'hollow' | 'sketch';
export const WALL_STYLES: WallStyle[] = ['solid', 'hollow', 'sketch'];

export function traceOptions(mmPerPx: number, style: WallStyle): TraceOptions {
  const px = (mm: Mm) => mm / mmPerPx;
  return {
    minThick: px(80),
    maxThick: px(400),
    minLen: px(400),
    hollowGap: style === 'solid' ? 0 : px(style === 'sketch' ? 200 : 150),
    minOpening: px(450),
    maxOpening: px(2600),
    bridge: style === 'sketch' ? Math.max(2, Math.round(px(150))) : 0,
  };
}

export interface AutoTrace {
  traced: TracedPlan;
  mmPerPx: number;
  style: WallStyle;
  /** Single doors the scale was read from; 0 when the scale was given. */
  doors: number;
}

/** How far a door may measure from the standard opening and still be taken for one. */
const DOOR_SLACK = 0.25;
/** Long side the scale is searched at: fine enough that thin and dashed door swings still read. */
const SEARCH_PX = 1500;
/** Doors that must agree on a scale before it is trusted; one alone is as likely a window or furniture read as a door. */
const MIN_DOORS = 2;
/** Widths a drawing of one house spans, smallest to largest. */
const SPAN: [Mm, Mm] = [6000, 60000];
const STEP = 1.3;

const singleDoorWidths = (t: TracedPlan) => t.openings.flatMap((o) => (o.kind === 'door' && !o.double ? [o.width] : []));

function median(v: number[]): number {
  const s = [...v].sort((p, q) => p - q);
  return s[s.length >> 1];
}

const wallLength = (t: TracedPlan) => t.walls.reduce((sum, w) => sum + dist(w.a, w.b), 0);

/**
 * Solid unless it misses most of what hollow finds. Read as hollow, solid walls come out the same, but so do pairs of
 * lines that aren't walls (furniture edges, window frames), so hollow is taken only when solid finds little.
 */
function pickStyle(traces: { style: WallStyle; traced: TracedPlan }[]) {
  const solid = traces.find((t) => t.style === 'solid');
  const hollow = traces.find((t) => t.style === 'hollow');
  const sketch = traces.find((t) => t.style === 'sketch');
  const drawn = !solid || !hollow ? (solid ?? hollow) : wallLength(solid.traced) >= wallLength(hollow.traced) * 0.5 ? solid : hollow;
  // Read as a sketch, a drawn plan comes out about the same; taken only when the drawn styles miss a good part of it.
  if (!drawn || (sketch && wallLength(drawn.traced) < wallLength(sketch.traced) * 0.75)) return sketch ?? drawn!;
  return drawn;
}

/**
 * Traces the image at `given` mm per pixel, or, without one, reads the scale off its doors: the scale at which the most
 * doors measure a standard opening, then their median. Each wall style allowed is tried; see pickStyle.
 * Null when there is no scale to go on: none given and no doors found.
 */
export function autoTrace(gray: Gray, given?: number, styles: WallStyle[] = WALL_STYLES): AutoTrace | null {
  let mmPerPx = given;
  let doors = 0;
  let candidates = styles;
  if (mmPerPx === undefined) {
    // A sketch's doors are drawn too loosely to measure: the scale is read the drawn ways only.
    const searched = styles.length > 1 ? styles.filter((st) => st !== 'sketch') : styles;
    const f = Math.max(1, Math.ceil(Math.max(gray.w, gray.h) / SEARCH_PX));
    const small = shrink(gray, f);
    const long = Math.max(small.w, small.h);
    let best: { n: number; spread: number; scale: number; style: WallStyle } | null = null;
    for (let s = SPAN[0] / long; s <= SPAN[1] / long; s *= STEP) {
      for (const style of searched) {
        const implied = singleDoorWidths(detectPlan(small, { ...traceOptions(s, style), wallDoors: false }))
          .map((w) => DOOR_OPENING / w)
          .filter((m) => Math.abs(m / s - 1) <= DOOR_SLACK);
        if (!implied.length) continue;
        const scale = median(implied);
        const spread = implied.reduce((a, m) => a + Math.abs(m - scale), 0) / implied.length / scale;
        if (!best || implied.length > best.n || (implied.length === best.n && spread < best.spread)) best = { n: implied.length, spread, scale, style };
      }
    }
    if (!best || best.n < MIN_DOORS) return null;
    const guess = best.scale / f;
    candidates = styles.includes('sketch') && best.style !== 'sketch' ? [best.style, 'sketch'] : [best.style];
    // Read the doors again at full size, where their edges are sharper than in the search, and keep the scale only if they agree.
    const full = singleDoorWidths(detectPlan(gray, { ...traceOptions(guess, best.style), wallDoors: false }))
      .map((w) => DOOR_OPENING / w)
      .filter((m) => Math.abs(m / guess - 1) <= DOOR_SLACK);
    if (full.length < MIN_DOORS) return null;
    mmPerPx = median(full);
    doors = full.length;
  }
  const traces = candidates.map((style) => ({ style, traced: detectPlan(gray, traceOptions(mmPerPx!, style)) }));
  const pick = pickStyle(traces);
  return { traced: pick.traced, mmPerPx, style: pick.style, doors };
}
