import { create } from 'zustand';
import type { SnapResult } from '../model/snap';
import type { OpeningPresetId } from '../model/openings';
import type { AisleKind, Column, Id, Mm, Vec2 } from '../model/types';
import type { Entry } from '../editor2d/entry';

export type Selection =
  | { kind: 'corner'; id: Id }
  | { kind: 'wall'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'opening'; id: Id }
  | { kind: 'object'; id: Id }
  | { kind: 'column'; id: Id }
  | { kind: 'area'; id: Id }
  | { kind: 'aisle'; id: Id };

export type Drag =
  | { kind: 'corner'; id: Id }
  | { kind: 'wall'; id: Id; origin: Vec2; applied: Mm }
  /** An area slides as a whole; `applied` is how far it has moved from where the drag began. */
  | { kind: 'area'; id: Id; origin: Vec2; applied: Vec2 }
  | { kind: 'aisle'; id: Id; origin: Vec2; applied: Vec2 }
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
  /** Lays an aisle (or a flow arrow) along a centre line, point by point; Enter, a double-click or Esc ends it. */
  | { kind: 'drawAisle'; aisle: AisleKind; points: Vec2[]; entry: Entry }
  | { kind: 'placeObject'; assetId: string }
  | { kind: 'addOpening'; preset: OpeningPresetId; hingeEnd: boolean; openB: boolean }
  | { kind: 'placeColumn'; spec: ColumnSpec }
  /** Drags out a rectangle and fills it with a grid of columns at the given spacing. */
  | { kind: 'columnGrid'; spec: ColumnSpec; start: Vec2 | null; spacing: Mm }
  | { kind: 'calibrate'; a: Vec2 | null; b: Vec2 | null }
  /** A tape measure: the first point of the tape being laid; finished tapes are kept on the project. */
  | { kind: 'measure'; a: Vec2 | null; b: Vec2 | null }
  | { kind: 'moveUnderlay'; grab: Vec2 | null };

export type ToolKind = Tool['kind'];
export type ViewMode = '2d' | '3d' | 'split';
export type Dock = 'catalog' | 'layers';

/** A plan opened from a share link: the customer view, where only the machines and equipment can be moved. */
export interface CustomerMode {
  shareId: string;
  /** Who sent it: the seller, or a customer sending their arrangement back. */
  from: 'vendor' | 'customer';
  note?: string;
  /** Who sent it, when they gave a name. */
  sender?: string;
}

/**
 * How the 3D view looks: plain (both off), realistic (PBR materials, light from the surroundings, ambient occlusion)
 * or every surface in plain clay, never realistic and clay together; and shadows from the sun with any of them.
 */
export interface Look3D {
  clay: boolean;
  shadows: boolean;
  realistic: boolean;
}

/** Which kind of project a 3D look belongs to: each keeps its own. */
export type LookKind = 'factory' | 'interior';

/** A factory opens as it always has (no clay, no shadows); an interior opens with shadows. */
export const DEFAULT_LOOK: Record<LookKind, Look3D> = {
  factory: { clay: false, shadows: false, realistic: false },
  interior: { clay: false, shadows: true, realistic: false },
};

const LOOK_KEY = 'factory:look3d';

/** The looks last chosen in this browser, over the defaults; the defaults when nothing is kept or it can't be read. */
export function loadLook(): Record<LookKind, Look3D> {
  const out = { factory: { ...DEFAULT_LOOK.factory }, interior: { ...DEFAULT_LOOK.interior } };
  try {
    const kept = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as Partial<Record<LookKind, Partial<Look3D>>> | null;
    for (const k of ['factory', 'interior'] as const) {
      for (const f of ['clay', 'shadows', 'realistic'] as const) if (typeof kept?.[k]?.[f] === 'boolean') out[k][f] = kept[k]![f]!;
      if (out[k].clay && out[k].realistic) out[k].realistic = false;
    }
  } catch {
    /* no storage here (private window, blocked site data): the defaults */
  }
  return out;
}

function keepLook(look: Record<LookKind, Look3D>) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    /* not kept; the switch still works for this visit */
  }
}

interface UiState {
  view: ViewMode;
  /** The 3D look of each kind of project, kept in this browser across visits. */
  look3d: Record<LookKind, Look3D>;
  /** Changes one kind's 3D look and keeps it. */
  setLook(kind: LookKind, patch: Partial<Look3D>): void;
  /** Set while a shared link is open; null in the full editor. */
  customer: CustomerMode | null;
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
  /** The same switch for interior projects, kept apart so neither kind changes the other's; off by default. */
  interiorCutaway: boolean;
  /** 3D move mode: dragging slides the machine under the pointer over the floor instead of turning the camera. */
  move3d: boolean;
  /** Set by the open 3D view: the plan point (mm) under the middle of its screen, where a new machine is dropped. */
  floorCentre: (() => Vec2 | null) | null;
  /**
   * Set by the open 3D view: the view as it shows, as a PNG, for a reference picture; `longSide` px or more across, when
   * given; in `look` for this one picture when given (the screen keeps its own look).
   */
  snapshot3d: ((longSide?: number, look?: Partial<Look3D>) => Promise<Blob | null>) | null;
  /** Every area out of sight in both views, without touching the areas' own flags. */
  areasHidden: boolean;
  /** Interior projects: the ceilings taken off in 3D, to look into the rooms from above. Off at first: the 3D view
   * opens from above, where a ceiling would hide the whole room; the button puts them back. */
  ceilingsHidden: boolean;
  /** The share link's banner, closed by the viewer for this visit. */
  bannerClosed: boolean;
  /** A request from the layers panel to bring the views to this thing; n makes each request distinct. */
  goto: { sel: Selection; n: number } | null;
  /** Holding the peek key or button: the drawing fades so the plan image beneath it can be checked against. */
  peek: boolean;
  /** The life-size people out of sight in both views (they stay in the project). Remembered in this browser. */
  figuresHidden: boolean;
  /** The people's idle sway in 3D, kept apart for factories (off at first: a factory view has no motion) and interiors (on). */
  figureIdle: { factory: boolean; interior: boolean };
  /** Selects something and asks the open views to move to it. */
  goTo(sel: Selection): void;
  set(patch: Partial<Omit<UiState, 'set' | 'setTool' | 'toggleDock' | 'goTo' | 'setLook'>>): void;
  setTool(tool: Tool): void;
  toggleDock(dock: Dock): void;
}

export const SELECT: Tool = { kind: 'select', drag: null };

const FIGURES_KEY = 'figures.view';
type FigurePrefs = Pick<UiState, 'figuresHidden' | 'figureIdle'>;

/** The people switches as this browser last left them; private windows and blocked storage just get the defaults. */
function readFigurePrefs(): FigurePrefs {
  const prefs: FigurePrefs = { figuresHidden: false, figureIdle: { factory: false, interior: true } };
  try {
    const raw = JSON.parse(localStorage.getItem(FIGURES_KEY) ?? 'null') as Partial<{ hidden: boolean; idleFactory: boolean; idleInterior: boolean }> | null;
    if (raw?.hidden === true) prefs.figuresHidden = true;
    if (typeof raw?.idleFactory === 'boolean') prefs.figureIdle.factory = raw.idleFactory;
    if (typeof raw?.idleInterior === 'boolean') prefs.figureIdle.interior = raw.idleInterior;
  } catch {
    /* nothing kept, or storage blocked */
  }
  return prefs;
}

export const useUi = create<UiState>((set) => ({
  view: '2d',
  look3d: loadLook(),
  setLook: (kind, patch) =>
    set((s) => {
      const next = { ...s.look3d[kind], ...patch };
      // Realistic and clay are two looks, not layers: turning one on turns the other off.
      if (patch.clay) next.realistic = false;
      else if (patch.realistic) next.clay = false;
      const look3d = { ...s.look3d, [kind]: next };
      keepLook(look3d);
      return { look3d };
    }),
  customer: null,
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
  interiorCutaway: false,
  move3d: false,
  floorCentre: null,
  snapshot3d: null,
  areasHidden: false,
  ceilingsHidden: true,
  bannerClosed: false,
  goto: null,
  peek: false,
  ...readFigurePrefs(),
  goTo: (sel) => set((s) => ({ selection: sel, boxed: [], goto: { sel, n: (s.goto?.n ?? 0) + 1 } })),
  set: (patch) => set('selection' in patch && !('boxed' in patch) ? { ...patch, boxed: [] } : patch),
  setTool: (tool) => set({ tool, cursor: null, objectGuides: [] }),
  toggleDock: (dock) => set((s) => ({ dock: s.dock === dock ? null : dock })),
}));

// The people switches are kept in this browser whenever they change.
useUi.subscribe((s, prev) => {
  if (s.figuresHidden === prev.figuresHidden && s.figureIdle === prev.figureIdle) return;
  try {
    localStorage.setItem(FIGURES_KEY, JSON.stringify({ hidden: s.figuresHidden, idleFactory: s.figureIdle.factory, idleInterior: s.figureIdle.interior }));
  } catch {
    /* private window: the choice just isn't remembered */
  }
});
