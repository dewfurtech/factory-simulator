import { cabinetFrame, cabinetPieces, type Piece } from '../../interior/cabinet/parts';
import type { CabinetSpec } from '../../interior/cabinet/spec';
import type { LineWeight, Prim, Pt } from '../types';

/**
 * A built-in cabinet seen from its front, drawn from the very pieces the cut list counts (cabinet/parts.ts): the
 * carcass outline, the plinth board, the countertop, every door leaf with its opening mark, every drawer front, and
 * the shelves and dividers that show in a bay with no front. Nothing is laid out here again; only the pieces are
 * projected onto the front plane.
 */

export interface CabinetFront {
  prims: Prim[];
  doors: number;
  drawers: number;
  /** Extent drawn, in elevation mm. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const LAYER = 'cabinet';

const rect = (x0: number, y0: number, x1: number, y1: number, weight: LineWeight): Prim => ({
  kind: 'poly',
  pts: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  closed: true,
  weight,
  layer: LAYER,
});

/** The front face of a piece: x across, y up, in cabinet space (centred in x, floor at y = 0). */
const faceOf = (p: Piece) => ({ x0: p.center[0] - p.size[0] / 2, x1: p.center[0] + p.size[0] / 2, y0: p.center[1] - p.size[1] / 2, y1: p.center[1] + p.size[1] / 2 });

/**
 * The cabinet's front as elevation primitives. `at` is where the middle of the cabinet's width meets the floor it
 * stands on (or, for a wall cabinet, its underside), in elevation mm. Seen from its front, a cabinet's own +x is
 * the viewer's right, so its pieces map straight across.
 */
export function cabinetFront(spec: CabinetSpec, at: Pt): CabinetFront {
  const f = cabinetFrame(spec);
  const pieces = cabinetPieces(spec);
  const X = (x: number) => at.x + x;
  const Y = (y: number) => at.y + y;
  const prims: Prim[] = [];
  const box = (p: Piece, weight: LineWeight) => {
    const r = faceOf(p);
    prims.push(rect(X(r.x0), Y(r.y0), X(r.x1), Y(r.y1), weight));
  };

  // The carcass box as one outline: sides, top and bottom all lie inside it.
  prims.push(rect(X(-spec.width / 2), Y(f.boxY0), X(spec.width / 2), Y(f.boxY0 + f.boxHeight), 'medium'));

  const fronts = pieces.filter((p) => p.role === 'door' || p.role === 'drawerFront').map(faceOf);
  const covered = (p: Piece) => {
    const [x, y] = p.center;
    return fronts.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
  };

  let doors = 0;
  let drawers = 0;
  for (const p of pieces) {
    switch (p.role) {
      case 'plinthFront':
        box(p, 'thin');
        break;
      case 'countertop':
        box(p, 'medium');
        break;
      case 'shelf':
      case 'divider':
        if (!covered(p)) box(p, 'thin');
        break;
      case 'drawerFront':
        drawers++;
        box(p, 'medium');
        break;
      case 'door': {
        doors++;
        box(p, 'medium');
        if (p.motion?.kind !== 'door') break;
        // The opening mark: two dashed lines from the free edge's corners meeting at the middle of the hinge edge.
        const r = faceOf(p);
        const hingeLeft = p.motion.hinge === 'left';
        const hx = hingeLeft ? r.x0 : r.x1;
        const fx = hingeLeft ? r.x1 : r.x0;
        const mid = (r.y0 + r.y1) / 2;
        prims.push(
          { kind: 'poly', pts: [{ x: X(fx), y: Y(r.y1) }, { x: X(hx), y: Y(mid) }, { x: X(fx), y: Y(r.y0) }], closed: false, weight: 'thin', style: 'dashed', layer: LAYER },
        );
        break;
      }
      default:
        break;
    }
  }

  return { prims, doors, drawers, x0: X(-spec.width / 2), x1: X(spec.width / 2), y0: Y(0), y1: Y(spec.height) };
}
