import { create } from 'zustand';
import type { ShapePresetId } from '../model/presets';
import type { SnapResult } from '../model/snap';
import type { OpeningPresetId } from '../model/openings';
import type { Column, Id, Mm, Vec2 } from '../model/types';
import type { Entry } from '../editor2d/entry';

export type Selection =
  | { kind: 'corner'; id: Id }
  | { kind: 'wall'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'opening'; id: Id }
  | { kind: 'object'; id: Id }
  | { kind: 'column'; id: Id };

export type Drag =
  | { kind: 'corner'; id: Id }
  | { kind: 'wall'; id: Id; origin: Vec2; applied: Mm }
  | { kind: 'opening'; id: Id }
  | { kind: 'object'; id: Id; grab: Vec2 }
  | { kind: 'column'; id: Id; grab: Vec2 }
  | { kind: 'box'; from: Vec2; to: Vec2 };

export type ColumnSpec = Pick<Column, 'shape' | 'w' | 'd' | 'h'>;

/** The editor's tool state machine; each variant carries only the state that tool needs. */
export type Tool =
  | { kind: 'select'; drag: Drag | null }
  | { kind: 'drawWall'; last: Vec2 | null; entry: Entry; glass: boolean }
  | { kind: 'drawRoomRect'; start: Vec2 | null; entry: Entry }
  | { kind: 'placePreset'; preset: ShapePresetId; w: Mm; d: Mm; entry: Entry }
  | { kind: 'placeObject'; assetId: string }
  | { kind: 'addOpening'; preset: OpeningPresetId; hingeEnd: boolean; openB: boolean }
  | { kind: 'placeColumn'; spec: ColumnSpec }
  /** Drags out a rectangle and fills it with a grid of columns at the given spacing. */
  | { kind: 'columnGrid'; spec: ColumnSpec; start: Vec2 | null; spacing: Mm }
  | { kind: 'calibrate'; a: Vec2 | null; b: Vec2 | null }
  | { kind: 'moveUnderlay'; grab: Vec2 | null };

export type ToolKind = Tool['kind'];
export type ViewMode = '2d' | '3d' | 'split';
/** The two halves of the app: drawing the factory, and watching a working day in it. */
export type Mode = 'layout' | 'sim';
export type Dock = 'catalog' | 'staff';

interface UiState {
  mode: Mode;
  view: ViewMode;
  tool: Tool;
  selection: Selection | null;
  boxed: Selection[];
  snapOn: boolean;
  grid: Mm;
  cursor: SnapResult | null;
  objectGuides: { from: Vec2; to: Vec2 }[];
  dock: Dock | null;
  panelOpen: boolean;
  /** The agent picked in the simulation: its card, path and timeline are shown. */
  agent: string | null;
  /** 3D walls cut down to waist height so the floor reads from above. */
  cutaway: boolean;
  shadows: boolean;
  /** 3D in the realistic look (detailed people, PBR, AO) rather than low poly. */
  realistic: boolean;
  /** Paths and trails of everyone, not only the picked agent. */
  showPaths: boolean;
  /** Bottom timeline of the simulation. */
  timeline: boolean;
  set(patch: Partial<Omit<UiState, 'set' | 'setTool' | 'toggleDock'>>): void;
  setTool(tool: Tool): void;
  toggleDock(dock: Dock): void;
}

const REALISTIC_KEY = 'factory.realistic3d';
const storedRealistic = () => {
  try {
    return localStorage.getItem(REALISTIC_KEY) === '1';
  } catch {
    return false;
  }
};
/** Remembers the 3D look for next time, in this browser only. */
export function rememberRealistic(on: boolean) {
  try {
    localStorage.setItem(REALISTIC_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

export const SELECT: Tool = { kind: 'select', drag: null };

export const useUi = create<UiState>((set) => ({
  mode: 'layout',
  view: 'split',
  tool: SELECT,
  selection: null,
  boxed: [],
  snapOn: true,
  grid: 100,
  cursor: null,
  objectGuides: [],
  dock: 'catalog',
  panelOpen: true,
  agent: null,
  cutaway: false,
  shadows: false,
  realistic: storedRealistic(),
  showPaths: false,
  timeline: true,
  set: (patch) => set('selection' in patch && !('boxed' in patch) ? { ...patch, boxed: [] } : patch),
  setTool: (tool) => set({ tool, cursor: null, objectGuides: [] }),
  toggleDock: (dock) => set((s) => ({ dock: s.dock === dock ? null : dock })),
}));
