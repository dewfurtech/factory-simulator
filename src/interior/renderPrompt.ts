import { catalogItem } from '../model/catalog';
import { isFigure } from '../model/figures';
import { levelOf, planOf } from '../model/levels';
import { roomOf, roomStats, roomWalls, wallLength } from '../model/plan';
import { BUILTIN_EN } from '../model/renderPrompt';
import type { Opening, PlacedObject, Plan, Project, Room, ZoneKind } from '../model/types';
import { DEFAULT_CABINET_COLORS, type BayFront, type CabinetKind } from './cabinet/spec';
import { HOME_EN } from './catalog';
import { rectSize } from './boqSurfaces';
import { materialOf } from './materials';
import { plansOf, roomSurfaces } from './summary';

/**
 * The image-model prompt for an interior project (the factory's is src/model/renderPrompt.ts): room by room, its use,
 * size and ceiling height, what its floor, each wall and its ceiling are finished with (English name and colour code),
 * its doors and windows, and the furniture and built-in cabinets standing in it with their sizes. Nothing here is
 * invented: no style, no lighting, no décor that is not in the project. A surface without a material is left unsaid.
 */

const ROOM_EN: Partial<Record<ZoneKind, string>> = {
  living: 'living room',
  dining: 'dining room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bath: 'bathroom',
  study: 'study',
  dressing: 'dressing room',
  laundry: 'laundry room',
  balcony: 'balcony',
  hall: 'hallway',
  storeroom: 'storeroom',
  office: 'office',
  meeting: 'meeting room',
  reception: 'reception',
  showroom: 'showroom',
  toilet: 'toilet',
  corridor: 'corridor',
};

const CABINET_EN: Record<CabinetKind, string> = {
  base: 'base cabinet',
  wall: 'wall-hung cabinet',
  tall: 'tall cabinet',
  open: 'open shelving unit',
};

/** Markings on the floor, not things to draw. */
const SKIP = new Set(['floor-mark', 'zone-area']);

/** Metres, to the centimetre, without trailing zeros: 4, 2.6, 0.45. */
const m = (mm: number) => (Math.round(mm / 10) / 100).toString();
/** Centimetres, whole. */
const cm = (mm: number) => Math.round(mm / 10).toString();
const s = (n: number, word: string) => (n === 1 ? word : `${word}s`);

/** A material or a '#rrggbb' colour as the prompt names it: "walnut wood (#5e3d28)", "#c8a376". */
function finishName(id: string | undefined, project: Project): string | null {
  if (!id) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(id)) return id;
  const mat = materialOf(id, project);
  if (!mat) return null;
  // An uploaded material has the name the user gave it, and the average colour of its picture.
  return `${mat.en ?? mat.name} (${mat.color})`;
}

function frontEn(f: BayFront): string {
  switch (f.kind) {
    case 'door':
      return 'one door';
    case 'double':
      return 'a pair of doors';
    case 'drawers':
      return `${f.tiers} ${s(f.tiers, 'drawer')}`;
    default:
      return 'open';
  }
}

const size3 = (o: PlacedObject) => `${cm(o.size.w)} × ${cm(o.size.d)} × ${cm(o.size.h)} cm`;

/** One piece in words with its size: "three-seat sofa 220 × 90 × 80 cm (W × D × H)". */
function pieceEn(o: PlacedObject, project: Project): string {
  if (o.cabinet) {
    const c = o.cabinet;
    const kind = o.assetId === 'cab-wardrobe' ? 'built-in wardrobe' : `built-in ${CABINET_EN[c.kind]}`;
    const bays = c.bays.map((b) => frontEn(b.front));
    const parts = [`${kind} ${size3(o)}`];
    if (o.z > 0) parts.push(`hung ${cm(o.z)} cm above the floor`);
    parts.push(`${c.bays.length} ${s(c.bays.length, 'bay')}: ${bays.join(', ')}`);
    if (c.bays.some((b) => b.front.kind !== 'open')) parts.push(`fronts ${finishName(o.colors?.front, project) ?? DEFAULT_CABINET_COLORS.front}`);
    parts.push(`carcass ${finishName(o.colors?.carcass, project) ?? DEFAULT_CABINET_COLORS.carcass}`);
    if (c.top) parts.push('with a countertop');
    return parts.join(', ');
  }
  const item = catalogItem(o.assetId);
  const name = item?.custom?.name ?? HOME_EN[o.assetId] ?? BUILTIN_EN[o.assetId] ?? item?.label ?? o.name;
  const colour = item?.custom && !item.custom.file ? `, colour ${item.custom.color}` : '';
  return `${name} ${size3(o)}${colour}`;
}

function openingEn(o: Opening): string {
  if (o.kind === 'window') return `window ${m(o.width)} × ${m(o.height)} m${o.sill ? `, sill ${m(o.sill)} m` : ''}`;
  if (o.kind === 'opening') return `open doorway ${m(o.width)} × ${m(o.height)} m`;
  const style =
    o.doorStyle === 'double' ? 'double door' : o.doorStyle?.startsWith('sliding') ? 'sliding door' : o.doorStyle === 'rolling' ? 'roll-up door' : 'door';
  return `${style} ${m(o.width)} × ${m(o.height)} m`;
}

/** "2 × a, 1 × b" in order of first appearance. */
function tally(items: string[]): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} × ${k}`).join('; ');
}

function roomLines(plan: Plan, room: Room, n: number, pieces: PlacedObject[], project: Project): string[] {
  const out: string[] = [];
  const stats = roomStats(plan, room);
  const rect = rectSize(plan, room);
  const dims = rect ? `${m(rect.w)} × ${m(rect.h)} m` : `about ${m(stats.width)} × ${m(stats.depth)} m overall`;
  const area = Math.round(stats.area / 1e5) / 10;
  out.push(`Room ${n}, ${ROOM_EN[room.zone] ?? 'room'}: ${dims} (${area} m²), ceiling height ${m(room.ceilingHeight)} m.`);

  const surfaces = roomSurfaces(plan, room);
  const finishes: string[] = [];
  const floor = finishName(surfaces.find((x) => x.surface === 'floor')?.material, project);
  if (floor) finishes.push(`Floor: ${floor}.`);
  // Walls go wall by wall: one material on every wall reads as one; else each material with how many walls and how long.
  const walls = roomWalls(plan, room);
  const byMaterial = new Map<string, { count: number; length: number }>();
  for (const x of surfaces)
    if (x.surface === 'wall' && x.wall) {
      const name = finishName(x.material, project);
      if (!name) continue;
      const g = byMaterial.get(name) ?? { count: 0, length: 0 };
      g.count++;
      g.length += wallLength(plan, x.wall);
      byMaterial.set(name, g);
    }
  if (byMaterial.size === 1 && [...byMaterial.values()][0].count === walls.length) finishes.push(`Walls: ${[...byMaterial.keys()][0]}.`);
  else if (byMaterial.size)
    finishes.push(
      `Walls: ${[...byMaterial].map(([name, g]) => `${name} on ${g.count} ${s(g.count, 'wall')} (${m(g.length)} m long${g.count > 1 ? ' in all' : ''})`).join('; ')}.`,
    );
  const ceiling = finishName(surfaces.find((x) => x.surface === 'ceiling')?.material, project);
  if (ceiling) finishes.push(`Ceiling: ${ceiling}.`);
  if (finishes.length) out.push(finishes.join(' '));

  const glass = walls.filter((w) => w.glass).length;
  if (glass) out.push(`${glass} ${s(glass, 'wall')} of framed glass.`);

  const wallIds = new Set(walls.map((w) => w.id));
  const openings = Object.values(plan.openings).filter((o) => wallIds.has(o.wallId));
  if (openings.length) out.push(`Doors and windows: ${tally(openings.map(openingEn))}.`);

  const loose = pieces.filter((o) => !o.cabinet);
  const cabinets = pieces.filter((o) => o.cabinet);
  if (loose.length) out.push(`Furniture (W × D × H): ${tally(loose.map((o) => pieceEn(o, project)))}.`);
  if (cabinets.length) out.push(`Built-in cabinets (W × D × H): ${tally(cabinets.map((o) => pieceEn(o, project)))}.`);
  return out;
}

export function buildInteriorPrompt(project: Project): string {
  const lines: string[] = [
    'Photorealistic interior photograph of the rooms below, exactly as designed: every size, material, colour and piece of furniture is listed, and nothing else is in them.',
  ];
  const pieces = project.objects.filter((o) => !o.hidden && !SKIP.has(o.assetId) && !isFigure(o));
  const placed = new Set<PlacedObject>();
  const plans = plansOf(project);
  let n = 0;
  plans.forEach((plan, level) => {
    const rooms = Object.values(plan.rooms).filter((r) => !r.hidden && !r.outdoor);
    if (!rooms.length) return;
    if (plans.length > 1) lines.push(level ? 'Upper floor:' : 'Ground floor:');
    for (const room of rooms) {
      const inside = pieces.filter((o) => levelOf(o) === level && roomOf(planOf(project, level), o)?.id === room.id);
      inside.forEach((o) => placed.add(o));
      lines.push(...roomLines(plan, room, ++n, inside, project));
    }
  });
  const outside = pieces.filter((o) => !placed.has(o));
  if (outside.length) lines.push(`Outside the rooms (W × D × H): ${tally(outside.map((o) => pieceEn(o, project)))}.`);
  lines.push(
    'Use the attached plan / 3D view as the reference: keep every piece exactly where it is and at its size, and every surface in the material and colour listed. No people, no text, no logos, no watermark.',
  );
  return lines.join('\n');
}
