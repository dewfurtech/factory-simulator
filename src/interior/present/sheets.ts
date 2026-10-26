import { catalogItem } from '../../model/catalog';
import { roomStats } from '../../model/plan';
import type { Id, PlacedObject, Project, Render, Size3 } from '../../model/types';
import { BOARD_MATERIAL_TH, CABINET_KIND_TH } from '../cabinet/spec';
import { materialOf } from '../materials';
import { moodSummary, type MaterialLine } from '../summary';

/**
 * The client presentation: A3 landscape sheets put together from the project and nothing else. Every name, number
 * and picture comes from the project (its name and client, its rooms, materials, pieces and pictures); there are no
 * prices and no words the app makes up. This file only decides what goes on which sheet; PresentPage draws them.
 */

export type SectionId = 'cover' | 'plan' | 'mood' | 'furniture' | 'images';

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'cover', label: 'ปก' },
  { id: 'plan', label: 'แปลน' },
  { id: 'mood', label: 'Mood & Tone' },
  { id: 'furniture', label: 'เฟอร์นิเจอร์และตู้บิ้วอิน' },
  { id: 'images', label: 'ภาพห้อง' },
];

/** How many lines fit on one sheet; a longer list goes on to the next sheet. */
export const MATERIALS_PER_SHEET = 8;
export const PIECES_PER_SHEET = 12;
export const IMAGES_PER_SHEET = 4;

/** A picture kept with the project: one brought back from the image model, or a 3D view the user kept. */
export interface SheetImage {
  id: Id;
  assetId: Id;
  source: 'render' | 'shot';
  createdAt: number;
}

/** The cover's picture: the newest render, else the 3D view as it is now (taken when the page opens). */
export type CoverImage = { source: 'render'; assetId: Id } | { source: 'live3d' };

export interface PlanRoom {
  name: string;
  /** Square millimetres. */
  area: number;
  /** "ชั้น 1" / "ชั้น 2" when the project has a floor above; absent otherwise. */
  floor?: string;
}

export interface PieceLine {
  assetId: string;
  name: string;
  count: number;
  size: Size3;
}

export interface CabinetLine extends PieceLine {
  /** ตู้ล่าง, ตู้แขวน, ... */
  kind: string;
  /** Board and thickness of each part, as set in the cabinet panel. */
  boards: { part: string; text: string }[];
  /** What the doors and the carcass wear, by material name or colour code, when set. */
  colors: { part: string; text: string }[];
}

interface Part {
  /** 1-based, among the sheets of this section; with `parts`, for "(2/3)" in the title. */
  part: number;
  parts: number;
}

export type Sheet =
  | { section: 'cover'; title: string; client: string[]; date: string; image: CoverImage }
  | ({ section: 'plan'; rooms: PlanRoom[] } & Part)
  | ({ section: 'mood'; palette: string[]; materials: MaterialLine[] } & Part)
  | ({ section: 'furniture'; pieces: PieceLine[]; cabinets: CabinetLine[] } & Part)
  | ({ section: 'images'; images: SheetImage[] } & Part);

/** Why a section has no sheet, for the tick list; absent when it has one. */
export type Missing = Partial<Record<SectionId, string>>;

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export const thaiDate = (t: number) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

/** The client's company and contact person, those that are filled in. */
export const clientLines = (p: Project): string[] => [p.client?.company, p.client?.contact].map((s) => s?.trim()).filter((s): s is string => !!s);

/** Every picture to show: renders first, then the kept 3D views, each oldest first. */
export function sheetImages(p: Project): SheetImage[] {
  const of = (rs: Render[] | undefined, source: SheetImage['source']) =>
    [...(rs ?? [])].sort((a, b) => a.createdAt - b.createdAt).map((r) => ({ id: r.id, assetId: r.assetId, source, createdAt: r.createdAt }));
  return [...of(p.renders, 'render'), ...of(p.shots, 'shot')];
}

export function coverImage(p: Project): CoverImage {
  const newest = [...(p.renders ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0];
  return newest ? { source: 'render', assetId: newest.assetId } : { source: 'live3d' };
}

/** Every room on every floor, in drawing order, with its area. */
export function planRooms(p: Project): PlanRoom[] {
  const floors = p.upper ? [p.plan, p.upper.plan] : [p.plan];
  return floors.flatMap((plan, i) => Object.values(plan.rooms).map((r) => ({ name: r.name, area: roomStats(plan, r).area, ...(p.upper && { floor: `ชั้น ${i + 1}` }) })));
}

const nameOf = (o: PlacedObject) => catalogItem(o.assetId)?.label ?? o.name;
const keyOf = (o: PlacedObject, name: string, extra = '') => `${o.assetId}|${name}|${o.size.w}|${o.size.d}|${o.size.h}|${extra}`;

const colorText = (id: string | undefined, p: Project): string | undefined => {
  if (!id) return undefined;
  if (id.startsWith('#')) return id.toUpperCase();
  const m = materialOf(id, p);
  return m ? m.name : undefined;
};

/** The pieces placed, alike ones counted together; built-in cabinets apart, with their boards. Hidden ones are left out. */
export function piecesAndCabinets(p: Project): { pieces: PieceLine[]; cabinets: CabinetLine[] } {
  const pieces = new Map<string, PieceLine>();
  const cabinets = new Map<string, CabinetLine>();
  for (const o of p.objects) {
    if (o.hidden) continue;
    const name = nameOf(o);
    const c = o.cabinet;
    if (!c) {
      const key = keyOf(o, name);
      const line = pieces.get(key);
      if (line) line.count++;
      else pieces.set(key, { assetId: o.assetId, name, count: 1, size: { ...o.size } });
      continue;
    }
    const boards = [
      { part: 'โครงตู้', text: `${BOARD_MATERIAL_TH[c.carcassMaterial]} ${c.boardThickness} มม.` },
      { part: 'หน้าบาน', text: `${BOARD_MATERIAL_TH[c.frontMaterial]} ${c.boardThickness} มม.` },
      { part: 'แผ่นหลัง', text: `${BOARD_MATERIAL_TH[c.backMaterial]} ${c.backThickness} มม.` },
      ...(c.top ? [{ part: 'ท็อป', text: `${c.top.material ? `${BOARD_MATERIAL_TH[c.top.material]} ` : ''}${c.top.thickness} มม.` }] : []),
    ];
    const colors = [
      { part: 'สีหน้าบาน', text: colorText(o.colors?.front, p) },
      { part: 'สีโครงตู้', text: colorText(o.colors?.carcass, p) },
    ].filter((x): x is { part: string; text: string } => !!x.text);
    const key = keyOf(o, name, JSON.stringify([c.kind, boards, colors]));
    const line = cabinets.get(key);
    if (line) line.count++;
    else cabinets.set(key, { assetId: o.assetId, name, count: 1, size: { ...o.size }, kind: CABINET_KIND_TH[c.kind], boards, colors });
  }
  const order = (a: PieceLine, b: PieceLine) => b.count - a.count || a.name.localeCompare(b.name, 'th');
  return { pieces: [...pieces.values()].sort(order), cabinets: [...cabinets.values()].sort(order) };
}

/** Sheets of one section, numbered within it. */
const parts = <T extends object>(xs: T[]): (T & Part)[] => xs.map((x, i) => ({ ...x, part: i + 1, parts: xs.length }));

/**
 * Every sheet the project has material for, in the fixed order cover, plan, Mood & Tone, furniture, pictures. A
 * section with nothing to show has no sheet; `missing` says why, for the tick list.
 */
export function buildSheets(p: Project, now = Date.now()): { sheets: Sheet[]; missing: Missing } {
  const sheets: Sheet[] = [];
  const missing: Missing = {};
  sheets.push({ section: 'cover', title: p.name, client: clientLines(p), date: thaiDate(now), image: coverImage(p) });

  const rooms = planRooms(p);
  if (rooms.length) sheets.push(...parts([{ section: 'plan' as const, rooms }]));
  else missing.plan = 'ยังไม่มีห้องบนแปลน';

  const mood = moodSummary(p);
  if (mood.materials.length)
    sheets.push(...parts(chunk(mood.materials, MATERIALS_PER_SHEET).map((materials, i) => ({ section: 'mood' as const, palette: i === 0 ? mood.palette : [], materials }))));
  else missing.mood = 'ยังไม่ได้กำหนดวัสดุพื้น ผนัง หรือฝ้า';

  const { pieces, cabinets } = piecesAndCabinets(p);
  const all = [...pieces.map((x) => ({ cabinet: false as const, x })), ...cabinets.map((x) => ({ cabinet: true as const, x }))];
  if (all.length)
    sheets.push(
      ...parts(
        chunk(all, PIECES_PER_SHEET).map((page) => ({
          section: 'furniture' as const,
          pieces: page.filter((e) => !e.cabinet).map((e) => e.x),
          cabinets: page.filter((e): e is { cabinet: true; x: CabinetLine } => e.cabinet).map((e) => e.x),
        })),
      ),
    );
  else missing.furniture = 'ยังไม่ได้วางเฟอร์นิเจอร์หรือตู้';

  const images = sheetImages(p);
  if (images.length) sheets.push(...parts(chunk(images, IMAGES_PER_SHEET).map((page) => ({ section: 'images' as const, images: page }))));
  else missing.images = 'ยังไม่มีภาพ: นำภาพ AI กลับมาจาก Google Flow หรือกด "เพิ่มมุมนี้" จากมุมมอง 3D';

  return { sheets, missing };
}

export const SHEET_TITLE: Record<SectionId, string> = {
  cover: 'ปก',
  plan: 'แปลนห้อง',
  mood: 'Mood & Tone',
  furniture: 'เฟอร์นิเจอร์และตู้บิ้วอิน',
  images: 'ภาพห้อง',
};

/** The heading a sheet prints: its section's title, with "(2/3)" when the section runs over more than one sheet. */
export const sheetHeading = (s: Sheet): string => SHEET_TITLE[s.section] + ('parts' in s && s.parts > 1 ? ` (${s.part}/${s.parts})` : '');
