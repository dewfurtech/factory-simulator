import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { OPENING_PRESET_IDS, OPENING_PRESETS, type OpeningPresetId } from '../model/openings';
import { useUi, type Tool } from '../store/ui';
import { EMPTY_ENTRY } from './entry';
import { AISLE_KIND_IDS, AISLE_KINDS, defaultWidth, isArrow } from '../model/aisles';
import type { AisleKind } from '../model/types';
import { fmtLen } from '../format';

const PATHS: Record<string, string> = {
  select: 'M6 3l12 7.5-5.5 1.5L10 18z',
  drawWall: 'M4 20V4h16 M8 20V8h12',
  glassWall: 'M4 4h16v16H4z M12 4v16 M7 9l3-3 M14 16l3-3',
  drawRoomRect: 'M4 6h16v12H4z M18 16l3 3',
  areaBox: 'M4 5h4 M12 5h4 M20 5v4 M20 13v4 M4 9v4 M4 17v2h2 M10 19h4 M18 19h2 M8 9h8v6H8z',
  areaPoly: 'M5 6l9-2 5 6-3 9-10-1z M5 6a1.5 1.5 0 1 0 .01 0 M14 4a1.5 1.5 0 1 0 .01 0 M19 10a1.5 1.5 0 1 0 .01 0 M16 19a1.5 1.5 0 1 0 .01 0 M6 18a1.5 1.5 0 1 0 .01 0',
  aisleWalk: 'M4 3v18 M20 3v18 M10 6a1.6 2.2 0 1 0 .01 0 M14 12a1.6 2.2 0 1 0 .01 0 M10 18a1.6 2.2 0 1 0 .01 0',
  aisleForklift: 'M4 3v18 M20 3v18 M12 5v13 M8.5 14.5L12 18l3.5-3.5',
  flowArrow: 'M4 18h6a4 4 0 0 0 4-4V6 M10 10l4-4 4 4',
  island: 'M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M6 13c1.5-1 3-1 4.5 0 M12 5c2 0 4 2 4 5v3H8v-3c0-3 2-5 4-5z M12 5v8',
  rect: 'M4 5h16v14H4z',
  L: 'M4 4h8v8h8v8H4z',
  U: 'M4 4h5v9h6V4h5v16H4z',
  chamfer: 'M4 4h11l5 5v11H4z',
  door: 'M4 20h16 M6 20V7 M6 7A13 13 0 0 1 19 20',
  doubleDoor: 'M3 20h18 M4 20v-8 M4 12a8 8 0 0 1 8 8 M20 20v-8 M20 12a8 8 0 0 0-8 8',
  slidingDoor: 'M3 19h18 M3 5h18 M4 12h16 M8 9l-3 3l3 3',
  slidingDoubleDoor: 'M3 19h18 M3 5h18 M4 12h7 M13 12h7 M7 9l-3 3l3 3 M17 9l3 3l-3 3',
  window: 'M4 4h16v16H4z M12 4v16 M4 12h16',
  opening: 'M2 12h6 M16 12h6 M8 7v10 M16 7v10',
  rollingDoor: 'M4 20V5h16v15 M4 8h16 M4 11h16 M4 14h16 M4 17h16',
  column: 'M8 3h8v18H8z M6 3h12 M6 21h12',
  columnRound: 'M12 3a4 2 0 1 0 0.01 0 M8 4v16a4 2 0 0 0 8 0V4',
  columnGrid: 'M4 4h3v3H4z M10.5 4h3v3h-3z M17 4h3v3h-3z M4 10.5h3v3H4z M10.5 10.5h3v3h-3z M17 10.5h3v3h-3z M4 17h3v3H4z M10.5 17h3v3h-3z M17 17h3v3h-3z',
  machine: 'M3 18V9h6l2-3h6v12z M3 18h18 M6 12h3 M14 9h3v3h-3z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7z M13 4h4v16h-4z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v4h4',
  users: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z M2 20v-1a6 6 0 0 1 12 0v1 M16 4a3.5 3.5 0 0 1 0 7 M22 20v-1a6 6 0 0 0-4.5-5.8',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2',
  target: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 11.5v1',
  route: 'M6 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  cut: 'M4 20h16 M6 20v-8h12v8 M6 12l2-6h8l2 6',
  shadow: 'M12 4a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M4 20h16 M7 20l3-4 M12 20l2-4',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
  timeline: 'M4 6h10 M4 12h16 M4 18h7 M2 3v18',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.6 M20 4v4h-4',
  factory: 'M3 21V10l5 3V10l5 3V10l5 3V4h3v17z M7 17h2 M12 17h2 M17 17h2',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  image: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M16 9a1 1 0 1 0 0.01 0',
  upload: 'M12 15V4 M7 9l5-5 5 5 M4 20h16',
  plus: 'M12 5v14 M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  topView: 'M4 4h16v16H4z M4 11h7v9 M11 14h9 M14 4v4',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  expand: 'M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7',
  follow: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  close: 'M6 6l12 12 M18 6L6 18',
  forward: 'M9 6l6 6-6 6',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  snap: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z M6 8h4 M14 8h4',
  orbit: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4',
  settings:
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  walk: 'M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M12 9v6 M12 15l-3 6 M12 15l3 6 M8 12h8',
  library: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  panel: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h4',
  switch: 'M7 3h10v18H7z M10 8h4v8h-4z M10 12h4',
  outlet: 'M5 5h14v14H5z M10 9v3 M14 9v3 M11 15.5h2',
  junction: 'M6 6h12v12H6z M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  wire: 'M4 18c4 0 4-12 8-12s4 12 8 12 M4 18h0 M20 18h0',
  elec: 'M13 2L5 14h6l-1 8 8-12h-6z',
  walker: 'M12 3a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z M6 21v-4a6 6 0 0 1 12 0v4',
  underlay: 'M4 5h16v14H4z M4 15l5-5 4 4 2-2 5 5 M15 8.5a1 1 0 1 0 0.01 0',
  ruler: 'M3 16L16 3l5 5L8 21z M7 12l2 2 M10 9l2 2 M13 6l2 2',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  share: 'M18 5a2.5 2.5 0 1 0 0.01 0 M6 12a2.5 2.5 0 1 0 0.01 0 M18 19a2.5 2.5 0 1 0 0.01 0 M8.2 10.8l7.6-4.4 M8.2 13.2l7.6 4.4',
  reply: 'M9 7L4 12l5 5 M4 12h10a6 6 0 0 1 6 6v1',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v6 M12 7.5v.5',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  eyeOff: 'M3 3l18 18 M10.5 5.3A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.3 6.5A17 17 0 0 0 2 12s4 7 10 7c1.6 0 3-.4 4.3-1 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 7.5-2',
  view2d: 'M4 4h16v16H4z M4 10h7v10 M11 14h9',
  split: 'M3 5h18v14H3z M12 5v14',
  view3d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  sidebar: 'M3 4h18v16H3z M9 4v16',
  props: 'M3 4h18v16H3z M15 4v16',
  palette:
    'M12 3a9 9 0 0 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z M7.5 11a1 1 0 1 0 0 .01 M10 7a1 1 0 1 0 0 .01 M15 7.5a1 1 0 1 0 0 .01',
  house: 'M3 11l9-7 9 7 M5 9.5V20h14V9.5 M10 20v-6h4v6',
  report: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  back: 'M15 6l-6 6 6 6',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M16 16l4.5 4.5',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
  sofa: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3 M3 13a2 2 0 0 1 4 0v4h10v-4a2 2 0 0 1 4 0v5H3z M5 21v-3 M19 21v-3',
  ceiling: 'M4 6h16 M4 6v3h16V6 M8 9v3 M16 9v3 M12 9v2',
  cabinetOpen: 'M4 4h8v16H4z M12 4l7 3v12l-7 1 M9 12h1 M14 12h1',
  // A lump of clay on a turntable: the 3D view in plain clay.
  clay: 'M7 15c-1.5-3 0-8 5-8s6.5 5 5 8z M5 15h14 M8 18h8 M12 15v3',
  person: 'M12 3a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4z M8.5 21v-6.5L7.5 10h9l-1 4.5V21 M12 15v6',
  personIdle: 'M12 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M10 21v-6l-1-4h6l-1 4v6 M5 8c-1.5 2-1.5 5 0 7 M19 8c1.5 2 1.5 5 0 7',
  swatch: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z M6 6l3 3 M15 6l3 3 M6 15l3 3 M15 15l3 3',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

interface Item {
  id: string;
  label: string;
  tool: () => Tool;
  isOn: (t: Tool) => boolean;
  testId: string;
}

const WALL_ITEMS: Item[] = [
  {
    id: 'drawWall',
    label: 'วาดผนัง',
    tool: () => ({ kind: 'drawWall', last: null, entry: EMPTY_ENTRY, glass: false }),
    isOn: (t) => t.kind === 'drawWall' && !t.glass,
    testId: 'tool-drawWall',
  },
  {
    id: 'glassWall',
    label: 'วาดผนังกระจก',
    tool: () => ({ kind: 'drawWall', last: null, entry: EMPTY_ENTRY, glass: true }),
    isOn: (t) => t.kind === 'drawWall' && t.glass,
    testId: 'tool-glassWall',
  },
];

const ROOM_ITEMS: Item[] = [
  {
    id: 'drawRoomRect',
    label: 'ห้องสี่เหลี่ยม (คลิก 2 มุม)',
    tool: () => ({ kind: 'drawRoomRect', start: null, entry: EMPTY_ENTRY }),
    isOn: (t) => t.kind === 'drawRoomRect',
    testId: 'tool-drawRoomRect',
  },
];

const AREA_ITEMS: Item[] = [
  {
    id: 'areaBox',
    label: 'กล่องพื้นที่ (คลิก 2 มุม)',
    tool: () => ({ kind: 'drawArea', mode: 'box', start: null, points: [], entry: EMPTY_ENTRY }),
    isOn: (t) => t.kind === 'drawArea' && t.mode === 'box',
    testId: 'tool-areaBox',
  },
  {
    id: 'areaPoly',
    label: 'วาดพื้นที่ทีละจุด (ปิดรอบเอง)',
    tool: () => ({ kind: 'drawArea', mode: 'poly', start: null, points: [], entry: EMPTY_ENTRY }),
    isOn: (t) => t.kind === 'drawArea' && t.mode === 'poly',
    testId: 'tool-areaPoly',
  },
];

const AISLE_ICON: Record<AisleKind, string> = { walk: 'aisleWalk', forklift: 'aisleForklift', flow: 'flowArrow' };

const AISLE_ITEMS: Item[] = AISLE_KIND_IDS.map(
  (kind): Item => ({
    id: AISLE_ICON[kind],
    label: isArrow(kind) ? AISLE_KINDS[kind].label : `${AISLE_KINDS[kind].label} · กว้าง ${fmtLen(defaultWidth(kind))}`,
    tool: () => ({ kind: 'drawAisle', aisle: kind, points: [], entry: EMPTY_ENTRY }),
    isOn: (t) => t.kind === 'drawAisle' && t.aisle === kind,
    testId: `tool-aisle-${kind}`,
  }),
);

/** The area flyout's footer: one switch that takes every area out of both views and brings them back. */
function AreasVisible() {
  const hidden = useUi((s) => s.areasHidden);
  return (
    <button
      className={`flyout-foot${hidden ? ' on' : ''}`}
      role="menuitemcheckbox"
      aria-checked={hidden}
      onClick={() => useUi.getState().set({ areasHidden: !hidden })}
      data-testid="areas-hidden"
    >
      <Icon name={hidden ? 'eyeOff' : 'eye'} />
      <span>{hidden ? 'ซ่อนพื้นที่ทั้งหมดอยู่ · คลิกเพื่อแสดง' : 'ซ่อนพื้นที่ทั้งหมด'}</span>
    </button>
  );
}

const OPENING_ITEMS: Item[] = OPENING_PRESET_IDS.map(
  (id: OpeningPresetId): Item => ({
    id,
    label: OPENING_PRESETS[id].label,
    tool: () => ({ kind: 'addOpening', preset: id, hingeEnd: false, openB: false }),
    isOn: (t) => t.kind === 'addOpening' && t.preset === id,
    testId: `tool-${id}`,
  }),
);

const COLUMN_ITEMS: Item[] = [
  {
    id: 'column',
    label: 'เสาเหลี่ยม 40×40 ซม.',
    tool: () => ({ kind: 'placeColumn', spec: { shape: 'rect', w: 400, d: 400, h: 6000 } }),
    isOn: (t) => t.kind === 'placeColumn' && t.spec.shape === 'rect',
    testId: 'tool-column',
  },
  {
    id: 'columnRound',
    label: 'เสากลม Ø40 ซม.',
    tool: () => ({ kind: 'placeColumn', spec: { shape: 'round', w: 400, d: 400, h: 6000 } }),
    isOn: (t) => t.kind === 'placeColumn' && t.spec.shape === 'round',
    testId: 'tool-column-round',
  },
  {
    id: 'columnGrid',
    label: 'ตารางเสา (ลากกรอบ ระยะ 8 ม.)',
    tool: () => ({ kind: 'columnGrid', spec: { shape: 'rect', w: 400, d: 400, h: 6000 }, start: null, spacing: 8000 }),
    isOn: (t) => t.kind === 'columnGrid',
    testId: 'tool-column-grid',
  },
];

// Importing, tracing and building walls from a plan is the seller's: a share link never loads it.
const UnderlayMenu = lazy(() => import('./UnderlayMenu').then((m) => ({ default: m.UnderlayMenu })));

export const setTool = (t: Tool) => useUi.getState().set({ tool: t, cursor: null, objectGuides: [] });

/** text: the short name printed under the icon; label: the full description in the tooltip. */
export function RailButton(props: {
  icon: string;
  text: string;
  label: string;
  on: boolean;
  onClick: () => void;
  testId: string;
  more?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      className={`rail-btn${props.on ? ' on' : ''}${props.className ? ` ${props.className}` : ''}`}
      onClick={props.onClick}
      draggable={!!props.onDragStart}
      onDragStart={props.onDragStart}
      aria-label={props.label}
      aria-pressed={props.on}
      data-tip={props.label}
      data-testid={props.testId}
    >
      <Icon name={props.icon} />
      <span className="rail-text">{props.text}</span>
      {props.more && <span className="rail-more" />}
      {props.children}
    </button>
  );
}

/** One rail slot standing for several tools: shows the last one used, lists all of them in a flyout. */
function ToolGroup({
  id,
  text,
  label,
  items,
  open,
  setOpen,
  footer,
}: {
  id: string;
  text: string;
  label: string;
  items: Item[];
  open: boolean;
  setOpen: (o: boolean) => void;
  footer?: ReactNode;
}) {
  const tool = useUi((s) => s.tool);
  const active = items.find((i) => i.isOn(tool));
  const [last, setLast] = useState(items[0]);
  const shown = active ?? last;
  useEffect(() => {
    if (active) setLast(active);
  }, [active]);

  return (
    <div className="rail-group">
      <RailButton
        icon={shown.id}
        text={text}
        label={`${label}: ${shown.label}`}
        on={!!active}
        more
        testId={`group-${id}`}
        onClick={() => {
          if (!active) setTool(shown.tool());
          setOpen(!open);
        }}
      />
      {open && (
        <div className="flyout glass" role="menu" data-testid={`flyout-${id}`}>
          <div className="flyout-title">{label}</div>
          {items.map((i) => (
            <button
              key={i.id}
              role="menuitemradio"
              aria-checked={i.isOn(tool)}
              className={i.isOn(tool) ? 'on' : ''}
              data-testid={i.testId}
              onClick={() => {
                setTool(i.tool());
                setOpen(false);
              }}
            >
              <Icon name={i.id} />
              <span>{i.label}</span>
            </button>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}

/** The rail of drawing tools. An interior project keeps the building tools and the library but has no columns, areas or aisles. */
export function Toolbar({ interior = false }: { interior?: boolean } = {}) {
  const tool = useUi((s) => s.tool);
  const dock = useUi((s) => s.dock);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const group = (id: string) => ({ open: open === id, setOpen: (o: boolean) => setOpen(o ? id : null) });
  // From a share link the building is the seller's: only the machines move, so the drawing tools stay out of the way.
  const customer = useUi((s) => !!s.customer);

  return (
    <nav className="toolbar rail glass" data-testid="toolbar" ref={ref}>
      <RailButton icon="select" text="เลือก" label="เลือก / ย้าย (Esc)" on={tool.kind === 'select'} onClick={() => setTool({ kind: 'select', drag: null })} testId="tool-select" />
      {/* Three groups in the order the work goes: the building, what goes in it, and checking it. */}
      {!customer && (
        <>
          <div className="rail-head">อาคาร</div>
          <ToolGroup id="wall" text="ผนัง" label="ผนัง" items={WALL_ITEMS} {...group('wall')} />
          <RailButton
            icon="drawRoomRect"
            text="ห้อง"
            label="ห้อง / โซน: คลิก 2 มุม"
            on={tool.kind === 'drawRoomRect'}
            onClick={() => setTool(ROOM_ITEMS[0].tool())}
            testId="tool-drawRoomRect"
          />
          <ToolGroup id="opening" text="ประตู" label="ประตู / หน้าต่าง" items={OPENING_ITEMS} {...group('opening')} />
          {!interior && <ToolGroup id="column" text="เสา" label="เสา" items={COLUMN_ITEMS} {...group('column')} />}
        </>
      )}
      <div className="rail-head">จัดวาง</div>
      <RailButton
        icon={interior ? 'sofa' : 'machine'}
        text={interior ? 'เฟอร์ฯ' : 'เครื่อง'}
        label={interior ? 'คลังเฟอร์นิเจอร์ (คอลัมน์ซ้าย)' : 'คลังเครื่องจักรและอุปกรณ์ (คอลัมน์ซ้าย)'}
        on={dock === 'catalog' || tool.kind === 'placeObject'}
        onClick={() => useUi.getState().set({ dock: dock === 'catalog' ? null : 'catalog' })}
        testId="tool-catalog"
        className="accent"
      />
      {!customer && !interior && (
        <>
          <ToolGroup id="area" text="พื้นที่" label="พื้นที่ (กล่องโปร่งแสง)" items={AREA_ITEMS} {...group('area')} footer={<AreasVisible />} />
          <ToolGroup id="aisle" text="ทางเดิน" label="ทางเดิน / ทางรถ / ทิศทางงาน" items={AISLE_ITEMS} {...group('aisle')} />
        </>
      )}
      <div className="rail-head">ดู</div>
      <RailButton
        icon="ruler"
        text="วัด"
        label="วัดระยะ: คลิก 2 จุด ดูดเข้าหามุม ผนัง และขอบเครื่อง"
        on={tool.kind === 'measure'}
        onClick={() => setTool({ kind: 'measure', a: null, b: null })}
        testId="tool-measure"
      />
      {!customer && (
        <Suspense fallback={null}>
          <UnderlayMenu />
        </Suspense>
      )}
    </nav>
  );
}
