import type { Mm, Vec2 } from './types';

export type ShapePresetId = 'rect' | 'L' | 'U' | 'chamfer';

export interface ShapePreset {
  label: string;
  /** Outline for a width × depth bounding box, origin at the top-left. */
  outline: (w: Mm, d: Mm) => Vec2[];
}

export const SHAPE_PRESETS: Record<ShapePresetId, ShapePreset> = {
  rect: {
    label: 'โซนสี่เหลี่ยม',
    outline: (w, d) => [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
  },
  L: {
    label: 'รูปตัว L',
    outline: (w, d) => [
      { x: 0, y: 0 },
      { x: w * 0.5, y: 0 },
      { x: w * 0.5, y: d * 0.5 },
      { x: w, y: d * 0.5 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
  },
  U: {
    label: 'รูปตัว U',
    outline: (w, d) => [
      { x: 0, y: 0 },
      { x: w / 3, y: 0 },
      { x: w / 3, y: d * 0.55 },
      { x: (2 * w) / 3, y: d * 0.55 },
      { x: (2 * w) / 3, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
  },
  chamfer: {
    label: 'โซนตัดมุม 45°',
    outline: (w, d) => {
      const c = Math.min(w, d) * 0.3;
      return [
        { x: 0, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: c },
        { x: w, y: d },
        { x: 0, y: d },
      ];
    },
  },
};

export const SHAPE_PRESET_IDS = Object.keys(SHAPE_PRESETS) as ShapePresetId[];
