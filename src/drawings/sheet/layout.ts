import type { Drawing, Pt } from '../types';
import { drawingBox, pickScale, type Box } from './geometry';

/** A3 landscape, paper mm. */
export const SHEET_W = 420;
export const SHEET_H = 297;
/** The border all round, inside which the frame is drawn. */
export const MARGIN = 10;
/** The title block: a column down the right of the frame. */
export const TITLE_W = 72;

/** Where drawings may go: inside the frame, left of the title block, less a little air. */
export const DRAW_AREA = { x: MARGIN + 6, y: MARGIN + 6, w: SHEET_W - 2 * MARGIN - TITLE_W - 12, h: SHEET_H - 2 * MARGIN - 12 };
/** Room under each view for its title and scale. */
export const LABEL_H = 14;

/** A view to place: a finished drawing, or one made for the scale it is drawn at (grid bubbles are paper-sized). */
export type ViewSource = Drawing | ((scale: number) => Drawing);

export interface PlacedView {
  drawing: Drawing;
  /** Model-space box of the ink at the sheet's scale. */
  box: Box;
  /** Paper position of model (0, 0); paper y runs down. */
  origin: Pt;
  /** Paper point under the view where its title goes (baseline middle). */
  label: Pt;
}

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Model mm → paper mm on a placed view. */
export const toPaper = (v: Pick<PlacedView, 'origin'>, scale: number, p: Pt): Pt => ({ x: v.origin.x + p.x / scale, y: v.origin.y - p.y / scale });

function cells(n: number, rows: number, area: Cell): Cell[] {
  const cols = Math.ceil(n / rows);
  const w = area.w / cols;
  const h = area.h / rows;
  return Array.from({ length: n }, (_, i) => ({ x: area.x + (i % cols) * w, y: area.y + Math.floor(i / cols) * h, w, h }));
}

const fitsIn = (box: Box, scale: number, cell: Cell) => (box.x1 - box.x0) / scale <= cell.w && (box.y1 - box.y0) / scale <= cell.h - LABEL_H;

/**
 * Lays views out on the drawing area at one scale for the sheet: the largest standard scale at which every view
 * fits its cell, trying each way of putting them in rows. Each view is centred in its cell with its title below.
 */
export function layoutViews(sources: ViewSource[], area: Cell = DRAW_AREA): { scale: number; views: PlacedView[] } {
  const n = sources.length;
  if (!n) return { scale: STANDARD_FIRST, views: [] };
  const made = new Map<number, Drawing[]>();
  const drawingsAt = (scale: number) => {
    let ds = made.get(scale);
    if (!ds) {
      ds = sources.map((s) => (typeof s === 'function' ? s(scale) : s));
      made.set(scale, ds);
    }
    return ds;
  };
  const tryAt = (scale: number) => {
    const ds = drawingsAt(scale);
    const boxes = ds.map((d) => drawingBox(d, scale) ?? { x0: 0, y0: 0, x1: 0, y1: 0 });
    for (let rows = 1; rows <= n; rows++) {
      const cs = cells(n, rows, area);
      if (boxes.every((b, i) => fitsIn(b, scale, cs[i]))) return { ds, boxes, cs };
    }
    return null;
  };
  const scale = pickScale((s) => !!tryAt(s));
  const fit =
    tryAt(scale) ??
    (() => {
      const ds = drawingsAt(scale);
      return { ds, boxes: ds.map((d) => drawingBox(d, scale) ?? { x0: 0, y0: 0, x1: 0, y1: 0 }), cs: cells(n, 1, area) };
    })();
  const views = fit.ds.map((drawing, i) => {
    const box = fit.boxes[i];
    const cell = fit.cs[i];
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + (cell.h - LABEL_H) / 2;
    const mx = (box.x0 + box.x1) / 2;
    const my = (box.y0 + box.y1) / 2;
    const origin = { x: cx - mx / scale, y: cy + my / scale };
    return { drawing, box, origin, label: { x: cx, y: cy + (box.y1 - box.y0) / scale / 2 + 7 } };
  });
  return { scale, views };
}

const STANDARD_FIRST = 50;
