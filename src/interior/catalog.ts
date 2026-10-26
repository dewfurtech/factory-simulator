import { addCatalogItems, type CatalogItem } from '../model/catalog';
import type { Mm, Size3 } from '../model/types';
import { normalizeSpec, type CabinetSpecInput } from './cabinet/spec';
import { sizeOfSpec, WALL_CABINET_Z } from './cabinet/sync';

export { WALL_CABINET_Z };

/**
 * What the interior library adds to the built-in catalog: built-in cabinets made to a spec, and home furniture drawn
 * from the shapes in cabinet/furnitureShapes.ts. Registered by id (catalogItem finds them) but never put on the
 * factory's shelves. Sizes are common sizes for Thai homes, given so a piece lands at a sensible size; every one can
 * be changed in the panel.
 */

const cabinet = (id: string, label: string, input: CabinetSpecInput, z = 0): CatalogItem => {
  const spec = normalizeSpec(input);
  return { id, label, group: 'cabinet', size: sizeOfSpec(spec), start: { cabinet: spec, ...(z && { z }) } };
};

export const CABINET_ITEMS: CatalogItem[] = [
  // Sizes by kind come from normalizeSpec: base 600×600×850 on a 100 mm plinth, wall 600×350×700, tall 600×600×2200,
  // open 800×300×1800.
  cabinet('cab-base', 'ตู้ล่าง', { kind: 'base' }),
  cabinet('cab-wall', 'ตู้แขวน', { kind: 'wall' }, WALL_CABINET_Z),
  cabinet('cab-tall', 'ตู้สูง', { kind: 'tall' }),
  cabinet('cab-open', 'ชั้นเปิด', { kind: 'open' }),
  // A two-door wardrobe 1200 wide, 600 deep (room for a hanger across), 2200 high; one shelf over the hanging space.
  cabinet('cab-wardrobe', 'ตู้เสื้อผ้า', { kind: 'tall', width: 1200, bays: [{ front: { kind: 'double' }, shelves: 1 }] }),
];

const S = (w: Mm, d: Mm, h: Mm): Size3 => ({ w, d, h });
const home = (id: string, label: string, size: Size3): CatalogItem => ({ id, label, group: 'home', size });

export const HOME_ITEMS: CatalogItem[] = [
  // Beds by mattress width: 3.5 ft ≈ 1050, 5 ft ≈ 1500, 6 ft ≈ 1800, all 2000 long; the height is the headboard's.
  home('home-bed-35', 'เตียง 3.5 ฟุต', S(1050, 2000, 1000)),
  home('home-bed-5', 'เตียง 5 ฟุต', S(1500, 2000, 1000)),
  home('home-bed-6', 'เตียง 6 ฟุต', S(1800, 2000, 1000)),
  // Sofas about 0.8 m a seat (the shape draws one cushion per seat), seat depth 850–900.
  home('home-sofa-1', 'โซฟา 1 ที่นั่ง', S(900, 850, 800)),
  home('home-sofa-2', 'โซฟา 2 ที่นั่ง', S(1600, 850, 800)),
  home('home-sofa-3', 'โซฟา 3 ที่นั่ง', S(2200, 900, 800)),
  home('home-sofa-l', 'โซฟาตัว L', S(2600, 1800, 800)),
  // Tables at the usual 750 mm; a coffee table at 450.
  home('home-dining-4', 'โต๊ะอาหาร 4 ที่นั่ง', S(1200, 800, 750)),
  home('home-dining-6', 'โต๊ะอาหาร 6 ที่นั่ง', S(1800, 900, 750)),
  home('home-coffee-table', 'โต๊ะกลาง', S(1000, 600, 450)),
  home('home-desk', 'โต๊ะทำงาน', S(1200, 600, 750)),
  home('home-chair', 'เก้าอี้', S(450, 480, 900)),
  home('home-dressing-table', 'โต๊ะเครื่องแป้ง', S(1000, 450, 1500)),
  home('home-shelving', 'ชั้นวางของ (ไม้)', S(800, 300, 1800)),
  home('home-floor-lamp', 'โคมไฟตั้งพื้น', S(400, 400, 1600)),
];

/** The shape each home piece is drawn with in 3D: an id of FURNITURE_SHAPES, or a builder taking a seat count. */
export const SHAPE_OF: Record<string, string> = {
  'home-bed-35': 'bed',
  'home-bed-5': 'bed',
  'home-bed-6': 'bed',
  'home-sofa-1': 'sofa-1',
  'home-sofa-2': 'sofa-2',
  'home-sofa-3': 'sofa-3',
  'home-sofa-l': 'sofa-l',
  'home-dining-4': 'table',
  'home-dining-6': 'table',
  'home-coffee-table': 'table',
  'home-desk': 'table',
  'home-chair': 'chair',
  'home-dressing-table': 'dressing-table',
  'home-shelving': 'shelving',
  'home-floor-lamp': 'floor-lamp',
};

addCatalogItems([...CABINET_ITEMS, ...HOME_ITEMS]);
