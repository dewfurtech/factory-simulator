import { EMPTY_ENTRY } from './entry';
import { SELECT, useUi, type Tool } from '../store/ui';

/**
 * The letter on the key pressed, read from where the key sits on the keyboard, not from what it types: with the
 * keyboard on Thai, the R key types "พ" but still reads "r", so every shortcut works in either language.
 */
export function keyLetter(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export interface Shortcut {
  /** The letter, as keyLetter reads it ('space' for the space bar). */
  key: string;
  /** What it does, for the help. */
  label: string;
  tool: () => Tool;
  /** Not offered on a share link, where only the machines move. */
  builder?: boolean;
}

/**
 * One-key tools, after SketchUp where the app has the same thing (Space select, M move, L line, R rectangle,
 * T tape measure); the rest take the first letter of their English name.
 */
export const SHORTCUTS: Shortcut[] = [
  { key: 'space', label: 'เลือก', tool: () => SELECT },
  { key: 'm', label: 'เลือก / ย้าย', tool: () => SELECT },
  { key: 'l', label: 'วาดผนัง', tool: () => ({ kind: 'drawWall', last: null, entry: EMPTY_ENTRY, glass: false }), builder: true },
  { key: 'r', label: 'วาดห้อง (เมื่อไม่ได้เลือกอะไร)', tool: () => ({ kind: 'drawRoomRect', start: null, entry: EMPTY_ENTRY }), builder: true },
  { key: 'd', label: 'ประตู', tool: () => ({ kind: 'addOpening', preset: 'door', hingeEnd: false, openB: false }), builder: true },
  { key: 'c', label: 'เสา', tool: () => ({ kind: 'placeColumn', spec: { shape: 'rect', w: 400, d: 400, h: 6000 } }), builder: true },
  { key: 'a', label: 'พื้นที่', tool: () => ({ kind: 'drawArea', mode: 'box', start: null, points: [], entry: EMPTY_ENTRY }), builder: true },
  { key: 'w', label: 'ทางเดิน', tool: () => ({ kind: 'drawAisle', aisle: 'walk', points: [], entry: EMPTY_ENTRY }), builder: true },
  { key: 't', label: 'วัดระยะ', tool: () => ({ kind: 'measure', a: null, b: null }) },
];

/** The key shown after a tool's name in tooltips: "L" for the wall tool. */
export const shortcutFor = (kind: Tool['kind']): string | undefined => {
  const s = SHORTCUTS.find((x) => x.key !== 'space' && x.key !== 'm' && x.tool().kind === kind);
  return s?.key.toUpperCase();
};

/** B opens and closes the machine catalog. */
export const CATALOG_KEY = 'b';

/** Runs a one-key tool or the catalog key; true when the key was one. Keys with Ctrl, Alt or Cmd are left alone. */
export function toolKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  const k = e.code === 'Space' ? 'space' : keyLetter(e);
  const ui = useUi.getState();
  if (k === CATALOG_KEY && !e.shiftKey) {
    ui.set({ dock: ui.dock === 'catalog' ? null : 'catalog' });
    return true;
  }
  if (e.shiftKey) return false;
  const s = SHORTCUTS.find((x) => x.key === k);
  if (!s || (s.builder && ui.customer)) return false;
  ui.setTool(s.tool());
  return true;
}
