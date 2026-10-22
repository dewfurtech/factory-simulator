import { planAreas } from '../model/areas';
import { obbCorners, objectObb } from '../model/objects';
import type { Project, Vec2 } from '../model/types';
import { underlayRect } from '../model/underlay';
import { bounds } from '../model/vec';
import { columnOutline } from './hit';

/** Whitespace around the drawing, in plan units. */
const MARGIN = 1500;
/** No side of a picture is longer than this, whatever the zoom. */
const MAX_PX = 8000;

/** What is drawn on the plan, as a box with a margin: walls, columns, things, areas and the plan image beneath. */
export function planExtent(project: Project): { min: Vec2; max: Vec2 } | null {
  const pts: Vec2[] = Object.values(project.plan.corners);
  for (const c of Object.values(project.columns)) pts.push(...columnOutline(c));
  for (const o of project.objects) if (!o.hidden) pts.push(...obbCorners(objectObb(o)));
  for (const a of planAreas(project.plan)) pts.push(...a.points);
  const u = project.underlay;
  if (u && !u.hidden) {
    const r = underlayRect(u);
    pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
  }
  if (!pts.length) return null;
  const b = bounds(pts);
  return { min: { x: b.min.x - MARGIN, y: b.min.y - MARGIN }, max: { x: b.max.x + MARGIN, y: b.max.y + MARGIN } };
}

const rootVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Swaps `var(--x)` for its value: a picture has no stylesheet to look it up in. */
function inlineVars(el: Element) {
  const cache = new Map<string, string>();
  const resolve = (s: string) => s.replace(/var\((--[\w-]+)\)/g, (_, n: string) => {
    if (!cache.has(n)) cache.set(n, rootVar(n));
    return cache.get(n)!;
  });
  const walk = (e: Element) => {
    for (const a of Array.from(e.attributes)) if (a.value.includes('var(')) e.setAttribute(a.name, resolve(a.value));
    for (const c of Array.from(e.children)) walk(c);
  };
  walk(el);
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

/** Plan images are shown from blob: URLs, which a picture can't fetch: they go in as data. */
async function inlineImages(el: Element) {
  for (const img of Array.from(el.querySelectorAll('image'))) {
    const href = img.getAttribute('href') ?? img.getAttribute('xlink:href');
    if (!href || !href.startsWith('blob:')) continue;
    try {
      const blob = await (await fetch(href)).blob();
      img.setAttribute('href', await toDataUrl(blob));
    } catch {
      img.remove();
    }
  }
}

export interface PlanPicture {
  svg: string;
  width: number;
  height: number;
}

/**
 * The plan as a self-contained SVG: the whole drawing, drawn the way it shows on screen now (same zoom, so the same
 * labels), without the grid, cursor, guides or other editing marks. `scale` is pixels per millimetre.
 */
export async function planPicture(svg: SVGSVGElement, project: Project, scale: number): Promise<PlanPicture | null> {
  const ext = planExtent(project);
  if (!ext) return null;
  const w = ext.max.x - ext.min.x;
  const h = ext.max.y - ext.min.y;
  const s = Math.min(scale, MAX_PX / Math.max(w, h));
  const width = Math.round(w * s);
  const height = Math.round(h * s);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const e of Array.from(clone.querySelectorAll('[data-export="skip"]'))) e.remove();
  for (const a of ['class', 'style', 'data-testid']) clone.removeAttribute(a);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${ext.min.x} ${ext.min.y} ${w} ${h}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('font-family', "'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, sans-serif");
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(ext.min.x));
  bg.setAttribute('y', String(ext.min.y));
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', rootVar('--canvas') || '#fff');
  clone.insertBefore(bg, clone.firstChild);
  inlineVars(clone);
  await inlineImages(clone);
  return { svg: new XMLSerializer().serializeToString(clone), width, height };
}

/** Rasterises the picture; null where the browser cannot draw it (an SVG the image decoder refuses). */
export function toPng(p: PlanPicture): Promise<Blob | null> {
  return new Promise((ok) => {
    const url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = p.width;
      canvas.height = p.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return ok(null);
      ctx.drawImage(img, 0, 0, p.width, p.height);
      canvas.toBlob((b) => ok(b), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      ok(null);
    };
    img.src = url;
  });
}

export const svgBlob = (p: PlanPicture) => new Blob([p.svg], { type: 'image/svg+xml;charset=utf-8' });

/** Pixels per millimetre the plan is shown at right now, from its viewBox; a picture is taken at twice that. */
export function shownScale(svg: SVGSVGElement): number {
  const vb = svg.viewBox.baseVal;
  const w = svg.clientWidth || 1;
  return vb.width > 0 ? (w / vb.width) * 2 : 0.05;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
