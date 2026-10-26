import { catalogItem, isMachine, machineInfo } from './catalog';
import type { CatalogGroup } from './catalog';
import { isFigure } from './figures';
import { roomPolygon } from './plan';
import type { Project, ZoneKind } from './types';
import { bounds, signedArea } from './vec';

/**
 * A text prompt for an image model (Google Flow, Imagen, …) describing the factory as drawn: the hall, its rooms,
 * the machines and furniture on the floor, and the doors. English, since that is what image models follow best; the
 * person edits it in the dialog before copying it out. Nothing here is invented: every line comes from the plan.
 */

const ZONE_EN: Record<ZoneKind, string> = {
  production: 'production area',
  warehouse: 'warehouse for raw boards and finished goods',
  office: 'office',
  meeting: 'meeting room',
  canteen: 'canteen',
  break: 'break area',
  toilet: 'toilets',
  locker: 'locker room',
  reception: 'reception',
  showroom: 'showroom',
  maintenance: 'maintenance workshop',
  qc: 'quality control room',
  loading: 'loading / shipping bay',
  corridor: 'corridor',
  other: 'room',
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
};

const MACHINE_KIND: Partial<Record<CatalogGroup, string>> = {
  nesting: 'CNC nesting machine',
  edge: 'edge banding machine',
  drill: 'CNC drilling machine',
  other: 'auxiliary machine',
};

/** English names for the built-in furniture, so the model knows the Thai labels' meaning. */
export const BUILTIN_EN: Record<string, string> = {
  desk: 'office desk with chair',
  'meeting-table': 'meeting table',
  'office-chair': 'office chair',
  cabinet: 'filing cabinet',
  reception: 'reception counter',
  sofa: 'sofa',
  display: 'product display stand',
  workbench: 'work bench',
  'qc-table': 'QC inspection table',
  'tool-cabinet': 'tool cabinet',
  conveyor: 'roller conveyor',
  rack: 'pallet rack',
  shelf: 'shelving unit',
  pallet: 'pallet stacked with wood panels',
  forklift: 'forklift',
  'time-clock': 'time clock',
  locker: 'locker',
  'canteen-table': 'canteen table with benches',
  toilet: 'toilet cubicle',
  sink: 'hand-wash sink',
  water: 'water dispenser',
  plant: 'potted plant',
  box: 'crate',
  stairs: 'straight stair',
  'stair-landing': 'stair landing',
  'floor-slab': 'mezzanine floor',
  railing: 'railing',
};

/** Things that are markings on the floor, not objects to draw. */
const SKIP = new Set(['floor-mark', 'zone-area']);

const metres = (mm: number) => (Math.round(mm / 100) / 10).toString();
const plural = (n: number, word: string) => {
  if (n === 1) return word;
  // "office desk with chair" → "office desks with chair": the head noun takes the s.
  const cut = word.search(/ (with|stacked|and) /);
  const head = cut < 0 ? word : word.slice(0, cut);
  const tail = cut < 0 ? '' : word.slice(cut);
  return `${/(s|x|ch|sh)$/.test(head) ? `${head}es` : `${head}s`}${tail}`;
};

function count<T>(items: T[], key: (t: T) => string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function buildRenderPrompt(project: Project): string {
  const { plan } = project;
  const lines: string[] = [];
  lines.push(
    'Photorealistic wide-angle interior photograph of a modern woodworking and furniture factory, daytime, bright even LED lighting, clean light-grey concrete floor, steel-frame hall.',
  );

  const corners = Object.values(plan.corners);
  if (corners.length >= 2) {
    const b = bounds(corners);
    const heights = Object.values(plan.walls)
      .map((w) => w.height)
      .filter((h) => h > 0);
    const h = heights.length ? Math.max(...heights) : 0;
    lines.push(`Building: about ${metres(b.max.x - b.min.x)} × ${metres(b.max.y - b.min.y)} m${h ? `, ceiling about ${metres(h)} m` : ''}.`);
  }

  const rooms = Object.values(plan.rooms).filter((r) => !r.hidden && !r.outdoor);
  if (rooms.length) {
    const parts = rooms.map((r) => {
      const poly = roomPolygon(plan, r).filter(Boolean);
      const b = bounds(poly);
      const area = Math.abs(signedArea(poly)) / 1e6;
      const glass = Object.values(plan.walls).some((w) => w.glass && r.cornerIds.includes(w.a) && r.cornerIds.includes(w.b));
      return `${ZONE_EN[r.zone] ?? ZONE_EN.other} ${metres(b.max.x - b.min.x)} × ${metres(b.max.y - b.min.y)} m (${Math.round(area)} m²)${glass ? ' with glass partition walls' : ''}`;
    });
    lines.push(`Rooms and zones: ${parts.join('; ')}.`);
  }

  const objects = project.objects.filter((o) => !o.hidden && !SKIP.has(o.assetId) && !isFigure(o));
  const machines = count(
    objects.filter((o) => isMachine(o)),
    (o) => {
      const item = catalogItem(o.assetId);
      if (!item) return null;
      const kind = MACHINE_KIND[item.group] ?? 'machine';
      const size = `${metres(o.size.w)} × ${metres(o.size.d)} m`;
      const extras = o.options?.length ? ` with ${o.options.map((id) => machineInfo(o.assetId)?.options?.find((x) => x.id === id)?.name ?? id).join(' and ')}` : '';
      return `Mastrox ${item.label} ${kind} (${size})${extras}`;
    },
  );
  if (machines.length) {
    lines.push(
      `Machines on the floor: ${machines.map(([k, n]) => `${n} × ${k}`).join('; ')}. Large industrial machines in their real proportions, in the colours of the reference image.`,
    );
  }

  const furniture = count(
    objects.filter((o) => !isMachine(o)),
    (o) => {
      const item = catalogItem(o.assetId);
      if (!item) return null;
      if (item.custom)
        return `${item.custom.name} (${metres(o.size.w)} × ${metres(o.size.d)} × ${metres(o.size.h)} m, ${item.custom.shape === 'cylinder' ? 'cylindrical' : 'box-shaped'})`;
      return BUILTIN_EN[o.assetId] ?? o.name;
    },
  );
  if (furniture.length) lines.push(`Also in the hall: ${furniture.map(([k, n]) => `${n} ${plural(n, k)}`).join(', ')}.`);

  const openings = Object.values(plan.openings);
  const doors = count(
    openings.filter((o) => o.kind === 'door'),
    (o) => (o.doorStyle === 'rolling' ? 'roll-up shutter door' : o.doorStyle === 'double' ? 'double door' : o.doorStyle?.startsWith('sliding') ? 'sliding door' : 'door'),
  );
  const windows = openings.filter((o) => o.kind === 'window').length;
  const ways = [...doors.map(([k, n]) => `${n} ${plural(n, k)}`), ...(windows ? [`${windows} ${plural(windows, 'window')}`] : [])];
  if (ways.length) lines.push(`Openings: ${ways.join(', ')}.`);

  lines.push(
    'Use the attached plan / 3D view as the reference: keep every machine exactly where it is and at its size. Camera at eye level, looking across the hall. No people, no text, no logos, no watermark.',
  );
  return lines.join('\n');
}

/** The Google Flow web app; it has no public API and no link that pre-fills a prompt, so the prompt goes via the clipboard. */
export const FLOW_URL = 'https://flow.google.com/';
