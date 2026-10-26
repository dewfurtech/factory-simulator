import { localToPlan } from '../../model/catalog';
import type { PlacedObject } from '../../model/types';
import type { CabinetSpec } from './spec';

/**
 * A cabinet on the plan, drawn over its box: a thin line at each divider between bays, and what fills each bay from
 * the front: a door leaf opened a little with its swing (hinge where the leaf turns), two for a pair, a dashed
 * drawer box for drawers, nothing for an open bay. Kept free of three.js and of the cut list: the plan draws it.
 */

/** Where the bays meet, across the width (cabinet frame, mm, centred): the middle of each divider board. */
export function bayEdges(spec: Pick<CabinetSpec, 'width' | 'boardThickness' | 'bays'>): number[] {
  const n = spec.bays.length;
  const t = spec.boardThickness;
  const bay = (spec.width - (n + 1) * t) / n;
  const edges = [-spec.width / 2];
  for (let i = 1; i < n; i++) edges.push(-spec.width / 2 + i * (bay + t) + t / 2);
  edges.push(spec.width / 2);
  return edges;
}

/** How far a leaf is drawn open on the plan. */
const OPEN = Math.PI / 6;

export function CabinetPlan({ o, px }: { o: PlacedObject; px: number }) {
  const spec = o.cabinet!;
  const P = (lx: number, ly: number) => localToPlan(o, lx, ly);
  const hd = o.size.d / 2;
  const edges = bayEdges(spec);
  const stroke = '#52525b';
  const thin = 0.8 * px;
  const out: JSX.Element[] = [];
  for (let i = 1; i < edges.length - 1; i++) {
    const a = P(edges[i], -hd);
    const b = P(edges[i], hd);
    out.push(<line key={`d${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={thin} />);
  }
  /** A leaf turning on a hinge at x = hx on the front, its free edge toward `dir` (+1 = +x). */
  const leaf = (key: string, hx: number, len: number, dir: 1 | -1) => {
    const h = P(hx, hd);
    const shut = P(hx + dir * len, hd);
    const open = P(hx + dir * len * Math.cos(OPEN), hd + len * Math.sin(OPEN));
    out.push(
      <g key={key}>
        <line x1={h.x} y1={h.y} x2={open.x} y2={open.y} stroke={stroke} strokeWidth={thin} />
        <path
          d={`M ${shut.x} ${shut.y} A ${len} ${len} 0 0 ${dir > 0 ? 1 : 0} ${open.x} ${open.y}`}
          fill="none"
          stroke={stroke}
          strokeWidth={thin}
          strokeDasharray={`${3 * px} ${2 * px}`}
        />
      </g>,
    );
  };
  spec.bays.forEach((bay, i) => {
    const x0 = edges[i];
    const x1 = edges[i + 1];
    const w = x1 - x0;
    const f = bay.front;
    if (f.kind === 'door') {
      if (f.hinge === 'left') leaf(`b${i}`, x0, w, 1);
      else leaf(`b${i}`, x1, w, -1);
    } else if (f.kind === 'double') {
      leaf(`b${i}l`, x0, w / 2, 1);
      leaf(`b${i}r`, x1, w / 2, -1);
    } else if (f.kind === 'drawers') {
      const inset = Math.min(60, w * 0.12);
      const corners = [P(x0 + inset, hd - inset), P(x1 - inset, hd - inset), P(x1 - inset, -hd + inset), P(x0 + inset, -hd + inset)];
      out.push(
        <polygon key={`b${i}`} points={corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke={stroke} strokeWidth={thin} strokeDasharray={`${4 * px} ${3 * px}`} />,
      );
    }
  });
  return (
    <g pointerEvents="none" data-testid="cabinet-plan">
      {out}
    </g>
  );
}
