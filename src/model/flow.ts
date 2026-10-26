import { machineFlow, sideOffset, type FlowSide } from './catalog';
import type { Mm, PlacedObject, Vec2 } from './types';

/**
 * The little arrows beside a machine that say where the work goes in (red, pointing in) and comes out (blue,
 * pointing away), so a layout reads as a line: this end takes the boards, that end gives the panels. Drawn in the
 * machine's own frame (x across, y toward the front), just outside its footprint; the plan and the 3D view each
 * map them into place.
 */
export const FLOW_IN = '#dc2626';
export const FLOW_OUT = '#2563eb';

export interface FlowArrow {
  kind: 'in' | 'out';
  /** Outline in the machine's local frame, mm: a shaft with a head. */
  points: Vec2[];
}

/** An arrow from `tail` to `tip` as an outline, `w` wide across the shaft. */
function arrow(tail: Vec2, tip: Vec2, w: Mm): Vec2[] {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const l = Math.hypot(dx, dy) || 1;
  const u = { x: dx / l, y: dy / l };
  const n = { x: -u.y, y: u.x };
  const head = Math.min(l * 0.45, w * 2.2);
  const neck = { x: tip.x - u.x * head, y: tip.y - u.y * head };
  const p = (b: Vec2, s: number) => ({ x: b.x + n.x * s, y: b.y + n.y * s });
  return [p(tail, -w / 2), p(neck, -w / 2), p(neck, -w * 1.1), tip, p(neck, w * 1.1), p(neck, w / 2), p(tail, w / 2)];
}

/** The in and out arrows of a placed machine in its local frame; none for things without a flow. */
export function flowArrows(o: Pick<PlacedObject, 'assetId' | 'options' | 'size' | 'flow'>, minLen: Mm = 0): FlowArrow[] {
  const flow = machineFlow(o.assetId, o.options, o.flow);
  if (!flow) return [];
  const len = Math.max(minLen, Math.min(700, Math.max(400, Math.min(o.size.w, o.size.d) * 0.3)));
  const w = len * 0.3;
  const same = flow.in === flow.out;
  const one = (side: FlowSide, kind: 'in' | 'out'): FlowArrow => {
    const off = sideOffset(side, o.size);
    // Outward unit direction and the direction along the edge.
    const n = { x: Math.sign(off.lx), y: Math.sign(off.ly) };
    const t = { x: n.y, y: -n.x };
    // In and out on one side sit side by side, the way in on the left as the operator sees it.
    const shift = same ? (kind === 'in' ? -1 : 1) * Math.max(w * 1.6, (side === 'front' || side === 'back' ? o.size.w : o.size.d) * 0.18) : 0;
    const edge = { x: off.lx + t.x * shift, y: off.ly + t.y * shift };
    const gap = 60;
    const near = { x: edge.x + n.x * gap, y: edge.y + n.y * gap };
    const far = { x: edge.x + n.x * (gap + len), y: edge.y + n.y * (gap + len) };
    return { kind, points: kind === 'in' ? arrow(far, near, w) : arrow(near, far, w) };
  };
  return [one(flow.in, 'in'), one(flow.out, 'out')];
}
