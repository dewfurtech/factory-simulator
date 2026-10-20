import type { Id, Mm, Plan, Project, Underlay, Vec2 } from './types';
import { add, bounds, dist, scale, sub } from './vec';

/** Width a fresh underlay is given before it is calibrated: about a house. */
const FIRST_WIDTH: Mm = 12000;

export const activeUnderlay = (project: Pick<Project, 'underlay'>): Underlay | undefined => project.underlay;

/** A new underlay centred on what's drawn so far, or where an empty plan opens, at a guessed scale to calibrate. */
export function placeUnderlay(image: { imageId: Id; name: string; w: number; h: number }, plan: Plan): Underlay {
  const ps = Object.values(plan.corners);
  const b = ps.length > 1 ? bounds(ps) : null;
  const centre = b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } : { x: 3000, y: 2500 };
  const width = b ? Math.max(FIRST_WIDTH, (b.max.x - b.min.x) * 1.2) : FIRST_WIDTH;
  return { ...image, ...centre, mmPerPx: width / image.w, rotation: 0, opacity: 0.5 };
}

/** Rescales the underlay about `a` so the distance from `a` to `b` on it becomes `length`. */
export function calibrate(u: Underlay, a: Vec2, b: Vec2, length: Mm): void {
  const k = length / dist(a, b);
  if (!Number.isFinite(k) || k <= 0) return;
  const c = add(a, scale(sub(u, a), k));
  u.x = c.x;
  u.y = c.y;
  u.mmPerPx *= k;
  u.calibrated = true;
}

/** The underlay's footprint on the plan, before rotation. */
export function underlayRect(u: Underlay): { x: Mm; y: Mm; w: Mm; h: Mm } {
  const w = u.w * u.mmPerPx;
  const h = u.h * u.mmPerPx;
  return { x: u.x - w / 2, y: u.y - h / 2, w, h };
}

/** Image blobs a project's underlays keep in the asset store. */
export const underlayImageIds = (project: Pick<Project, 'underlay'>): Id[] => (project.underlay ? [project.underlay.imageId] : []);
