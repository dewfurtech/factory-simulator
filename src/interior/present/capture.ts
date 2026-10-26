import { planExtent, planPicture, svgBlob } from '../../editor2d/exportImage';
import { newId } from '../../model/id';
import type { Project } from '../../model/types';
import { saveAsset } from '../../store/persist';
import { applyEdit } from '../../store/project';
import { useUi } from '../../store/ui';

/** Pixels along the longer side of a picture taken for print: about 145 dpi across the width of an A3 sheet. */
export const PRINT_PX = 2400;

const planSvg = () => document.querySelector<SVGSVGElement>('svg.plan-svg');

const delay = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function waitFor<T>(get: () => T | null | undefined, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) return null;
    await delay(50);
  }
}

/** The 2D plan as an SVG picture (sharp at any print size), drawn as the plan shows on screen; null without a plan. */
async function planOf(project: Project, svg: SVGSVGElement): Promise<Blob | null> {
  const ext = planExtent(project);
  if (!ext) return null;
  const long = Math.max(ext.max.x - ext.min.x, ext.max.y - ext.min.y);
  const pic = await planPicture(svg, project, PRINT_PX / long);
  return pic ? svgBlob(pic) : null;
}

export interface Pictures {
  plan: Blob | null;
  view3d: Blob | null;
}

/**
 * The plan and (when `want3d`) the 3D view, taken when the presentation opens. Each comes from the view on screen;
 * a view that is not up is brought up for the moment as the side-by-side view, then the screen goes back as it was.
 * The 3D view is taken first, before the side-by-side view would change its shape.
 */
export async function takePictures(project: Project, want3d: boolean): Promise<Pictures> {
  const ui = useUi.getState();
  const out: Pictures = { plan: null, view3d: null };
  const snapNow = ui.snapshot3d;
  if (want3d && snapNow) out.view3d = await snapNow(PRINT_PX).catch(() => null);
  const svgNow = planSvg();
  const needView = !svgNow || (want3d && !snapNow);
  const before = ui.view;
  // Nothing picked, so the plan shows no selection marks.
  ui.set({ selection: null, boxed: [], ...(needView && { view: 'split' as const }) });
  await delay(50);
  try {
    const svg = svgNow ?? (await waitFor(planSvg, 4000));
    if (svg) out.plan = await planOf(project, svg).catch(() => null);
    if (want3d && !out.view3d) {
      const snap = await waitFor(() => useUi.getState().snapshot3d, 8000);
      // A 3D view just brought up needs a moment to build the rooms and load the materials' pictures.
      if (snap) {
        await delay(1500);
        out.view3d = await snap(PRINT_PX).catch(() => null);
      }
    }
  } finally {
    if (needView) {
      useUi.getState().set({ view: before });
      // Until the 3D view has taken its own size again, a view kept from it would have the side-by-side shape.
      await delay(250);
    }
  }
  return out;
}

/** Keeps the 3D view as it shows now with the project, for the presentation's pictures. False when no 3D view is up. */
export async function keepCurrentView(): Promise<boolean> {
  const snap = useUi.getState().snapshot3d;
  if (!snap) return false;
  const blob = await snap(PRINT_PX);
  if (!blob) return false;
  const assetId = newId('r');
  await saveAsset(assetId, blob);
  applyEdit((d) => {
    (d.shots ??= []).push({ id: newId('sh'), assetId, createdAt: Date.now() });
  });
  return true;
}

export function dropView(id: string): void {
  applyEdit((d) => {
    d.shots = (d.shots ?? []).filter((s) => s.id !== id);
  });
}
