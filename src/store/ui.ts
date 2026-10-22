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
  | { kind: 'column'; id: Id }
  | { kind: 'area'; id: Id };

export type Drag =
  | { kind: 'corner'; id: Id }
  | { kind: 'wall'; id: Id; origin: Vec2; applied: Mm }
  /** An area slides as a whole; `applied` is how far it has moved from where the drag began. */
  | { kind: 'area'; id: Id; origin: Vec2; applied: Vec2 }
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
  /** Marks out an area: a box from two corners, or point by point until the outline closes. */
  | { kind: 'drawArea'; mode: 'box' | 'poly'; start: Vec2 | null; points: Vec2[]; entry: Entry }
  | { kind: 'placePreset'; preset: ShapePresetId; w: Mm; d: Mm; entry: Entry }
  | { kind: 'placeObject'; assetId: string }
  | { kind: 'addOpening'; preset: OpeningPresetId; hingeEnd: boolean; openB: boolean }
  | { kind: 'placeColumn'; spec: ColumnSpec }
  /** Drags out a rectangle and fills it with a grid of columns at the given spacing. */
  | { kind: 'columnGrid'; spec: ColumnSpec; start: Vec2 | null; spacing: Mm }
  | { kind: 'calibrate'; a: Vec2 | null; b: Vec2 | null }
  /** A tape measure: two points on the plan, the distance between them read off. */
  | { kind: 'measure'; a: Vec2 | null; b: Vec2 | null }
  | { kind: 'moveUnderlay'; grab: Vec2 | null };

export type ToolKind = Tool['kind'];
export type ViewMode = '2d' | '3d' | 'split';
export type Dock = 'catalog' | 'layers';

interface UiState {
  view: ViewMode;
  tool: Tool;
  selection: Selection | null;
  boxed: Selection[];
  snapOn: boolean;
  grid: Mm;
  cursor: SnapResult | null;
  objectGuides: { from: Vec2; to: Vec2 }[];
  dock: Dock | null;
  /** The right panel with nothing selected (factory settings); picking something opens it on its own. */
  panelOpen: boolean;
  /** 3D walls cut down near the floor (on by default) so the layout and doorways read from above. */
  cutaway: boolean;
  shadows: boolean;
  /** 3D in the realistic look (PBR, AO) rather than low poly. */
  realistic: boolean;
  /** 3D ground as an island around the building rather than an endless plane; the plane comes back while drawing. */
  island: boolean;
  /** Every area out of sight in both views, without touching the areas' own flags. */
  areasHidden: boolean;
  /** A request from the layers panel to bring the views to this thing; n makes each request distinct. */
  goto: { sel: Selection; n: number } | null;
  /** Holding the peek key or button: the drawing fades so the plan image beneath it can be checked against. */
  peek: boolean;
  /** Selects something and asks the open views to move to it. */
  goTo(sel: Selection): void;
  set(patch: Partial<Omit<UiState, 'set' | 'setTool' | 'toggleDock' | 'goTo'>>): void;
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

/** Tools that put down walls, rooms or areas: while one is active the 3D ground shows whole, not as an island. */
export const DRAWING_TOOLS: ReadonlySet<ToolKind> = new Set<ToolKind>(['drawWall', 'drawRoomRect', 'drawArea', 'placePreset', 'columnGrid']);

export const useUi = create<UiState>((set) => ({
  view: '2d',
  tool: SELECT,
  selection: null,
  boxed: [],
  snapOn: true,
  grid: 100,
  cursor: null,
  objectGuides: [],
  dock: null,
  panelOpen: false,
  cutaway: true,
  shadows: false,
  realistic: storedRealistic(),
  island: true,
  areasHidden: false,
  goto: null,
  peek: false,
  goTo: (sel) => set((s) => ({ selection: sel, boxed: [], goto: { sel, n: (s.goto?.n ?? 0) + 1 } })),
  set: (patch) => set('selection' in patch && !('boxed' in patch) ? { ...patch, boxed: [] } : patch),
  setTool: (tool) => set({ tool, cursor: null, objectGuides: [] }),
  toggleDock: (dock) => set((s) => ({ dock: s.dock === dock ? null : dock })),
}));
