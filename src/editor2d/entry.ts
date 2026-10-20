import type { Mm, Vec2 } from '../model/types';
import { add, dist, sub } from '../model/vec';
import { deg, rad } from '../format';

/** Numbers keyed in while a drawing tool is active: the text of each field, and the field keys go to. */
export interface Entry {
  values: string[];
  field: number;
}

export interface EntryField {
  label: string;
  unit: string;
  signed?: boolean;
}

export const EMPTY_ENTRY: Entry = { values: ['', ''], field: 0 };

const SIZE: EntryField[] = [
  { label: 'กว้าง', unit: 'ซม.' },
  { label: 'ลึก', unit: 'ซม.' },
];

export const ENTRY_FIELDS = {
  drawWall: [
    { label: 'ยาว', unit: 'ซม.' },
    { label: 'มุม', unit: '°', signed: true },
  ],
  drawRoomRect: SIZE,
  placePreset: SIZE,
} satisfies Record<string, EntryField[]>;

const put = (entry: Entry, v: string): Entry => ({ ...entry, values: entry.values.map((x, i) => (i === entry.field ? v : x)) });

/** The entry after key `e`, or null when the entry doesn't take that key. Tab and Shift+Tab move between fields. */
export function entryKey(entry: Entry, fields: EntryField[], e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): Entry | null {
  const v = entry.values[entry.field];
  if (/^[0-9.]$/.test(e.key) || (e.key === '-' && fields[entry.field].signed && v === '')) return put(entry, v + e.key);
  if (e.key === 'Backspace' && v) return put(entry, v.slice(0, -1));
  if (e.key === 'Tab') return { ...entry, field: (entry.field + (e.shiftKey ? fields.length - 1 : 1)) % fields.length };
  return null;
}

/** Field i as a number, or null while it is blank or not yet a number. */
export function typedNum(entry: Entry, i: number): number | null {
  const n = parseFloat(entry.values[i]);
  return Number.isFinite(n) ? n : null;
}

export const hasTyped = (entry: Entry) => entry.values.some((v) => v !== '');

/** A direction's angle in whole-turn degrees, measured the way the wall panel's angle field measures it. */
export const planDeg = (d: Vec2) => (deg(Math.atan2(d.y, d.x)) + 360) % 360;

/** Where the wall drawn from `last` ends: at the pointer, unless a length (cm) or angle (°) was typed. */
export function wallEnd(last: Vec2, pointer: Vec2, entry: Entry): Vec2 {
  const len = typedNum(entry, 0);
  const a = typedNum(entry, 1);
  if (len === null && a === null) return pointer;
  const l: Mm = len === null ? dist(last, pointer) : len * 10;
  const r = rad(a ?? planDeg(sub(pointer, last)));
  return add(last, { x: l * Math.cos(r), y: l * Math.sin(r) });
}

/** The rectangle's far corner: at the pointer, or a typed width / depth (cm) from `start` toward it. */
export function rectCorner(start: Vec2, pointer: Vec2, entry: Entry): Vec2 {
  const w = typedNum(entry, 0);
  const d = typedNum(entry, 1);
  return {
    x: w === null ? pointer.x : start.x + (pointer.x < start.x ? -1 : 1) * w * 10,
    y: d === null ? pointer.y : start.y + (pointer.y < start.y ? -1 : 1) * d * 10,
  };
}
