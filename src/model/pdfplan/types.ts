import type { Vec2 } from '../types';

/**
 * A CAD drawing read straight out of a vector PDF: every stroke and fill as a flat polyline, with the AutoCAD layer
 * it was plotted on, and every piece of text. Nothing is interpreted here; the builders in this folder read walls,
 * columns, doors, zones and machines out of it.
 *
 * Coordinates are PDF points (1/72 in) on the page, y down from the top-left corner, so they line up with the page
 * rendered to an image (see editor2d/underlayFile.ts: image px = pt × PDF_PX / max(page width, page height)).
 */
export interface VectorPlan {
  /** Page size in points. */
  width: number;
  height: number;
  /** Layer names in the order first seen; a path on no layer has layer ''. */
  layers: string[];
  paths: VecPath[];
  texts: VecText[];
}

export interface VecPath {
  layer: string;
  /** Stroke (or fill, when only filled) colour as #rrggbb. */
  color: string;
  /** Stroke width in points, after the page transform. */
  width: number;
  /** Polyline vertices; curves are flattened. A subpath per element of a compound path is its own VecPath. */
  points: Vec2[];
  closed: boolean;
  stroked: boolean;
  filled: boolean;
  /** Drawn with a dash pattern (zone outlines, hidden lines). */
  dashed: boolean;
}

export interface VecText {
  text: string;
  /** Baseline start of the text run. */
  x: number;
  y: number;
  /** Advance width and glyph height in points. */
  width: number;
  height: number;
  /** Radians, counter-clockwise on the page as seen (y down), 0 for upright text. */
  rotation: number;
}

/** A segment of a path, with its path's attributes: what the builders mostly work on. */
export interface VecSegment {
  a: Vec2;
  b: Vec2;
  path: VecPath;
}

/** Every edge of every polyline, optionally only those on `layers`. */
export function segmentsOf(plan: VectorPlan, layers?: readonly string[]): VecSegment[] {
  const out: VecSegment[] = [];
  for (const path of plan.paths) {
    if (layers && !layers.includes(path.layer)) continue;
    const n = path.points.length;
    const edges = path.closed ? n : n - 1;
    for (let i = 0; i < edges; i++) out.push({ a: path.points[i], b: path.points[(i + 1) % n], path });
  }
  return out;
}

/** Layer names matched loosely: AutoCAD plots the same layer as `A-WALL`, `A-Wall` or `A_WALL` from one office to the next. */
export const layerKey = (name: string) => name.toUpperCase().replace(/[\s_-]+/g, '');

export const layersLike = (plan: VectorPlan, ...keys: string[]): string[] => plan.layers.filter((l) => keys.some((k) => layerKey(l).includes(layerKey(k))));
