import type { CatalogItem } from '../model/catalog';

/** The built-in pieces that make sense in a home: the furniture of the factory's office and staff areas, not its racks and forklifts. */
const FURNITURE = new Set([
  'desk',
  'meeting-table',
  'office-chair',
  'cabinet',
  'sofa',
  'display',
  'shelf',
  'canteen-table',
  'toilet',
  'sink',
  'water',
  'plant',
  'box',
  'stairs',
  'stair-landing',
  'railing',
]);

/** Whether a catalog item belongs on the interior editor's shelf (the user's own models always do). */
export const isFurniture = (c: Pick<CatalogItem, 'id' | 'group'>): boolean => c.group === 'custom' || FURNITURE.has(c.id);
