import type { CatalogItem } from './catalog';
import type { Mm, PlacedObject, Size3 } from './types';

/**
 * Life-size people to read the scale of a room or a machine by: a figure stands where it is placed, faces its local
 * +y like everything else, and is only there to be looked at. It takes up no floor in the placement check, and is
 * left out of every list of what a project contains (BOQ, Mood & Tone, the presentation, the image prompt, the
 * construction drawings). The 3D body is built in src/view3d/figures3d.ts.
 */

export type FigureKind = 'man' | 'woman' | 'child' | 'worker';

export const FIGURE_IDS: Record<FigureKind, string> = {
  man: 'person-man',
  woman: 'person-woman',
  child: 'person-child',
  worker: 'person-worker',
};

const KIND_OF = new Map<string, FigureKind>(Object.entries(FIGURE_IDS).map(([k, id]) => [id, k as FigureKind]));

/** Which figure a catalog id is, or null for anything that is not a person. */
export const figureKind = (assetId: string): FigureKind | null => KIND_OF.get(assetId) ?? null;
export const isFigure = (o: Pick<PlacedObject, 'assetId'>): boolean => KIND_OF.has(o.assetId);

/** Heads to the full height: about 7.5 for an adult, about 6 for a child of seven or eight. */
export const headsTall = (kind: FigureKind): number => (kind === 'child' ? 6 : 7.5);

const S = (w: Mm, d: Mm, h: Mm): Size3 => ({ w, d, h });

/** The licence (CC BY 4.0) asks for the author's name with the model wherever it is used. */
export const MAN_MODEL_CREDIT = 'โมเดล 3D: "Business Man - Low Polygon game character" โดย manoeldarochadeoliveira (Sketchfab) สัญญาอนุญาต CC BY 4.0';

/**
 * Heights are round, typical figures, not anyone measured: 1.75 m for a man and 1.62 m for a woman are about the adult
 * averages of many countries (Thai averages run a few centimetres lower, about 1.70 and 1.58), and 1.20 m is a child
 * of about seven (the WHO growth reference median at seven is about 1.21–1.22 m). The footprint is the body with its
 * arms down: about 450 across the shoulders and arms and 250 front to back for an adult.
 */
export const FIGURE_ITEMS: CatalogItem[] = [
  // The man's 3D body is a model by another author, credited where the library shows the piece (src/view3d/figures3d.ts).
  { id: FIGURE_IDS.man, label: 'ผู้ชาย 1.75 ม.', group: 'people', size: S(450, 250, 1750), summary: MAN_MODEL_CREDIT },
  { id: FIGURE_IDS.woman, label: 'ผู้หญิง 1.62 ม.', group: 'people', size: S(410, 240, 1620) },
  { id: FIGURE_IDS.child, label: 'เด็ก 1.20 ม.', group: 'people', size: S(320, 180, 1200) },
  // A factory hand in plain overalls and an orange hard hat; the hat is inside the 1.75 m.
  { id: FIGURE_IDS.worker, label: 'พนักงาน 1.75 ม.', group: 'people', size: S(450, 260, 1750) },
];
