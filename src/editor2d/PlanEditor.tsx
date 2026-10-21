import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catalogItem } from '../model/catalog';
import { levelOf, onLevel } from '../model/levels';
import { obbCorners, objectObb } from '../model/objects';
import { wallFootprints } from '../model/miter';
import { openingOffsetAt, roomLabelPoint, roomPolygon, roomStats, setWallLength, wallDir, wallLength } from '../model/plan';
import { OPENING_PRESETS, openingSymbol, type OpeningSymbol } from '../model/openings';
import type { Column, Id, PlacedObject, Plan, Project, Vec2, Wall } from '../model/types';
import { add, bounds, lerp, perp, scale, signedArea } from '../model/vec';
import { zoneColor } from '../model/zones';
import { fmtArea, fmtLen, fmtSize } from '../format';
import { editProject, useEditProject, useProject } from '../store/project';
import { useUi, type Selection, type Tool } from '../store/ui';
import { CalibrateInput, CalibrateOverlay, UnderlayImage } from './Underlay';
import { underlayRect } from '../model/underlay';
import { locate } from '../model/locate';
import { columnOutline, hitTest, isCrossing, isOutdoor, SNAP_PX } from './hit';
import { addDoorAt, columnGridPoints, dispatchPointer, objectAt, placeObjectAt, presetOutline, roomOutline } from './tools';
import { ENTRY_FIELDS, planDeg, rectCorner, wallEnd, type Entry, type EntryField } from './entry';

export const ASSET_MIME = 'application/x-factory-asset';

/** The catalog item being dragged right now: a drag's data can't be read until the drop. */
let draggedAsset: string | null = null;
export const setDraggedAsset = (id: string | null) => {
  draggedAsset = id;
};

interface View {
  cx: number;
  cy: number;
  /** Pixels per millimetre. */
  s: number;
}

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

export function PlanEditor() {
  const project = useEditProject()!;
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const boxed = useUi((s) => s.boxed);
  const marked = useMemo(() => new Set(boxed.map((b) => b.id)), [boxed]);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>(() => initialView(project));
  const [editing, setEditing] = useState<{ wallId: Id; x: number; y: number; value: string } | null>(null);
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const [drawScale, setDrawScale] = useState(view.s);
  useEffect(() => {
    const t = setTimeout(() => setDrawScale(view.s), 150);
    return () => clearTimeout(t);
  }, [view.s]);

  const underlayId = project.underlay?.imageId;
  const shownUnderlay = useRef(underlayId);
  useEffect(() => {
    if (underlayId === shownUnderlay.current) return;
    shownUnderlay.current = underlayId;
    const u = project.underlay;
    if (!u) return;
    const r = underlayRect(u);
    setView({ cx: u.x, cy: u.y, s: Math.min(size.w / r.w, size.h / r.h) * 0.9 });
  }, [underlayId]);

  // A go-to from the layers panel: pan to the thing, zooming only when it would be too small or too big to see whole.
  const goto = useUi((s) => s.goto);
  useEffect(() => {
    if (!goto) return;
    const spot = locate(editProject(), goto.sel);
    if (!spot) return;
    setView((v) => {
      const onScreen = spot.extent * v.s;
      const fit = Math.min(size.w, size.h);
      const s = onScreen < 60 || onScreen > fit * 0.7 ? Math.min(0.3, Math.max(0.004, (fit * 0.4) / spot.extent)) : v.s;
      return { cx: spot.center.x, cy: spot.center.y, s };
    });
  }, [goto]);

  useEffect(() => {
    const el = wrapRef.current!;
    let fitted = false;
    const ro = new ResizeObserver(() => {
      const pane = { w: el.clientWidth, h: el.clientHeight };
      setSize(pane);
      if (!fitted && pane.w > 0) setView(initialView(editProject(), pane));
      fitted ||= pane.w > 0;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toPlan = (clientX: number, clientY: number): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.cx + (clientX - r.left - size.w / 2) / view.s, y: view.cy + (clientY - r.top - size.h / 2) / view.s };
  };
  const toScreen = (p: Vec2) => ({ x: (p.x - view.cx) * view.s + size.w / 2, y: (p.y - view.cy) * view.s + size.h / 2 });
  const input = (e: React.PointerEvent | React.MouseEvent) => ({ p: toPlan(e.clientX, e.clientY), radius: SNAP_PX / view.s, alt: e.altKey, shift: e.shiftKey });

  const onWheel = (e: React.WheelEvent) => {
    const before = toPlan(e.clientX, e.clientY);
    const s = Math.min(2, Math.max(0.004, view.s * Math.exp(-e.deltaY * 0.0015)));
    const r = svgRef.current!.getBoundingClientRect();
    setView({ s, cx: before.x - (e.clientX - r.left - size.w / 2) / s, cy: before.y - (e.clientY - r.top - size.h / 2) / s });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      pan.current = { x: e.clientX, y: e.clientY, view, moved: false };
      return;
    }
    if (e.button === 0) {
      const i = input(e);
      const prev = lastDown.current;
      // A press soon after another is the second half of a double-click: keep the first one's spot.
      if (!prev || e.timeStamp - prev.t > 600) firstClick.current = { p: i.p, radius: i.radius };
      lastDown.current = { t: e.timeStamp };
      dispatchPointer('down', i);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const { x, y, view: v } = pan.current;
      if (Math.hypot(e.clientX - x, e.clientY - y) > 3) pan.current.moved = true;
      setView({ ...v, cx: v.cx - (e.clientX - x) / v.s, cy: v.cy - (e.clientY - y) / v.s });
      return;
    }
    dispatchPointer('move', input(e));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null;
      return;
    }
    dispatchPointer('up', input(e));
  };

  // Double-clicking a wall while selecting puts a plain door there. The spot is where the first click
  // landed: that click can open the side panel and shift the plan under the second.
  const firstClick = useRef<{ p: Vec2; radius: number } | null>(null);
  const lastDown = useRef<{ t: number } | null>(null);
  const onDoubleClick = (e: React.MouseEvent) => {
    const at = firstClick.current ?? input(e);
    if (e.button !== 0 || useUi.getState().tool.kind !== 'select') return;
    const hit = hitTest(editProject(), at.p, at.radius);
    if (hit && hit.kind !== 'wall' && hit.kind !== 'room') return;
    addDoorAt(at.p, at.radius);
  };

  // While a catalog item is dragged over the plan, show where it would land.
  const [dragGhost, setDragGhost] = useState<PlacedObject | null>(null);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedAsset) return;
    const o = objectAt(draggedAsset, toPlan(e.clientX, e.clientY), SNAP_PX / view.s, e.altKey);
    setDragGhost((g) => (g && g.assetId === o.assetId && g.x === o.x && g.y === o.y && g.rotation === o.rotation ? g : o));
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setDragGhost(null);
  };
  const onDrop = (e: React.DragEvent) => {
    setDragGhost(null);
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    if (!assetId) return;
    e.preventDefault();
    placeObjectAt(assetId, toPlan(e.clientX, e.clientY), SNAP_PX / view.s, e.altKey);
  };

  const editDim = useRef<(w: Wall, at: Vec2) => void>(() => undefined);
  editDim.current = (w, at) => {
    const s = toScreen(at);
    setEditing({ wallId: w.id, x: s.x, y: s.y, value: (wallLength(project.plan, w) / 10).toFixed(1) });
  };
  const onEditDim = useCallback((w: Wall, at: Vec2) => editDim.current(w, at), []);

  const { plan, objects, columns } = project;
  const livePx = 1 / view.s;
  const px = 1 / drawScale;
  const vb = `${view.cx - size.w / 2 / view.s} ${view.cy - size.h / 2 / view.s} ${size.w / view.s} ${size.h / view.s}`;
  const grid = view.s > 0.08 ? 100 : 1000;
  const shared = { plan, selection, marked, px };

  const commitEdit = () => {
    if (!editing) return;
    const cm = parseFloat(editing.value);
    if (cm > 0) useProject.getState().apply((d) => setWallLength(d.plan, editing.wallId, cm * 10));
    setEditing(null);
  };

  const zoom = (k: number) => setView({ ...view, s: Math.min(2, Math.max(0.004, view.s * k)) });

  return (
    <div ref={wrapRef} className="plan-wrap" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="plan-svg"
        viewBox={vb}
        data-testid="plan"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => useUi.getState().set({ cursor: null })}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: tool.kind === 'select' ? 'default' : tool.kind === 'moveUnderlay' ? 'move' : 'crosshair' }}
      >
        <defs>
          <pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="var(--grid)" strokeWidth={livePx} />
          </pattern>
          <pattern id="grid-major" width={grid * 10} height={grid * 10} patternUnits="userSpaceOnUse">
            <rect width={grid * 10} height={grid * 10} fill="url(#grid)" />
            <path d={`M ${grid * 10} 0 L 0 0 0 ${grid * 10}`} fill="none" stroke="var(--grid-major)" strokeWidth={livePx} />
          </pattern>
        </defs>
        <rect x={-1e7} y={-1e7} width={2e7} height={2e7} fill="url(#grid-major)" />
        <UnderlayImage px={px} />
        <g mask="url(#outside-rooms)">
          <ObjectLayer objects={objects} outdoor {...shared} />
        </g>
        <PlanBase {...shared} />
        <ObjectLayer objects={objects} outdoor={false} {...shared} />
        <ColumnLayer columns={columns} {...shared} />
        <PlanLabels onEditDim={onEditDim} {...shared} />
        <ToolOverlay px={livePx} />
        {dragGhost && (
          <g opacity={0.7} pointerEvents="none" data-testid="drag-ghost">
            <ObjectShape o={dragGhost} px={livePx} sel />
          </g>
        )}
        <BoxOverlay px={livePx} />
        <CursorOverlay px={livePx} />
        <CalibrateOverlay px={livePx} />
      </svg>
      <CalibrateInput toScreen={toScreen} />
      <DrawEntry toScreen={toScreen} size={size} />
      {editing && (
        <input
          className="dim-input"
          autoFocus
          style={{ left: editing.x - 45, top: editing.y - 14 }}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(null);
          }}
          onBlur={commitEdit}
          aria-label="ความยาวผนัง (ซม.)"
        />
      )}
      <div className="zoom-ctl glass">
        <button onClick={() => zoom(1.25)} aria-label="ซูมเข้า">+</button>
        <button onClick={() => zoom(0.8)} aria-label="ซูมออก">−</button>
        <button onClick={() => setView(initialView(project, size))} aria-label="พอดีจอ" title="พอดีจอ">
          ⤢
        </button>
      </div>
      <Hud />
    </div>
  );
}

interface LayerProps {
  plan: Plan;
  selection: Selection | null;
  marked: ReadonlySet<Id>;
  px: number;
}

const selId = (selection: Selection | null, kind: Selection['kind']) => (selection?.kind === kind ? selection.id : null);

/** Floors, walls and openings. */
const PlanBase = memo(function PlanBase({ plan, selection, marked, px }: LayerProps) {
  const footprints = useMemo(() => wallFootprints(plan), [plan]);
  const sel = (kind: Selection['kind'], id: Id) => selId(selection, kind) === id || marked.has(id);
  return (
    <>
      <defs>
        <mask id="outside-rooms" maskUnits="userSpaceOnUse" x={-1e7} y={-1e7} width={2e7} height={2e7}>
          <rect x={-1e7} y={-1e7} width={2e7} height={2e7} fill="#fff" />
          {Object.values(plan.rooms).map((r) => (
            <polygon key={r.id} points={pts(roomPolygon(plan, r))} fill="#000" />
          ))}
        </mask>
      </defs>
      {Object.values(plan.rooms)
        .sort((a, b) => Math.abs(signedArea(roomPolygon(plan, b))) - Math.abs(signedArea(roomPolygon(plan, a))))
        .map((r) => (
          <polygon
            key={r.id}
            opacity={r.hidden ? 0.15 : undefined}
            points={pts(roomPolygon(plan, r))}
            fill={zoneColor(r)}
            fillOpacity={sel('room', r.id) ? 1 : 0.85}
            stroke={sel('room', r.id) ? 'var(--select)' : 'none'}
            strokeWidth={3 * px}
          />
        ))}
      {footprints.map((f) => {
        const wall = plan.walls[f.wallId];
        if (!wall) return null;
        const glass = wall.glass;
        return (
          <polygon
            key={f.wallId}
            opacity={wall.hidden ? 0.15 : undefined}
            points={pts(f.polygon)}
            fill={sel('wall', f.wallId) ? 'var(--select)' : glass ? '#cfe8f3' : 'var(--wall)'}
            stroke={glass ? '#27272a' : 'var(--wall-edge)'}
            strokeWidth={px}
            strokeLinejoin="round"
          />
        );
      })}
      {Object.values(plan.openings).map((o) => {
        const wall = plan.walls[o.wallId];
        if (!wall) return null;
        return (
          <g key={o.id}>
            <OpeningShape symbol={openingSymbol(plan, wall, o)} px={px} stroke={sel('opening', o.id) ? 'var(--select)' : '#27272a'} />
            {o.entrance && <EntranceMark plan={plan} wall={wall} offset={o.offset} px={px} />}
          </g>
        );
      })}
    </>
  );
});

function EntranceMark({ plan, wall, offset, px }: { plan: Plan; wall: Wall; offset: number; px: number }) {
  const c = add(plan.corners[wall.a], scale(wallDir(plan, wall), offset));
  return (
    <g pointerEvents="none">
      <circle cx={c.x} cy={c.y} r={11 * px} fill="var(--accent)" />
      <text x={c.x} y={c.y} fontSize={11 * px} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>
        ⇆
      </text>
    </g>
  );
}

/** Wall dimensions, room names and corner handles, drawn over the objects. */
const PlanLabels = memo(function PlanLabels({ plan, selection, px, onEditDim }: LayerProps & { onEditDim: (w: Wall, at: Vec2) => void }) {
  const rooms = useMemo(
    () =>
      Object.values(plan.rooms).map((r) => ({ r, c: roomLabelPoint(plan, r), st: roomStats(plan, r) })),
    [plan],
  );
  const selCorner = selId(selection, 'corner');
  return (
    <>
      {Object.values(plan.walls).map((w) => {
          if (w.hidden) return null;
          const a = plan.corners[w.a];
          const b = plan.corners[w.b];
          const n = perp(wallDir(plan, w));
          const at = add(lerp(a, b, 0.5), scale(n, w.thickness / 2 + 14 * px));
          let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
          if (wallLength(plan, w) < 110 * px) return null;
          return (
            <text
              key={w.id}
              x={at.x}
              y={at.y}
              fontSize={11 * px}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${angle} ${at.x} ${at.y})`}
              fill="var(--ink-2)"
              stroke="var(--canvas)"
              strokeWidth={3 * px}
              paintOrder="stroke"
              style={{ cursor: 'text' }}
              onPointerDown={(e) => {
                if (w.locked) return;
                e.stopPropagation();
                onEditDim(w, at);
              }}
            >
              {fmtLen(wallLength(plan, w))}
            </text>
          );
        })}
      {rooms.filter(({ st }) => st.width > 40 * px).map(({ r, c, st }) => (
        <g key={r.id} opacity={r.hidden ? 0.15 : undefined} pointerEvents="none" fontSize={12 * px} textAnchor="middle" fill="var(--ink)">
          <text x={c.x} y={c.y - 8 * px} fontWeight={700} fontSize={14 * px} stroke="var(--canvas)" strokeWidth={3 * px} paintOrder="stroke" opacity={0.85}>
            {r.name}
          </text>
          {st.width > 130 * px && (
            <text x={c.x} y={c.y + 9 * px} fill="var(--ink-3)" stroke="var(--canvas)" strokeWidth={3 * px} paintOrder="stroke">
              {fmtArea(st.area)} · {fmtSize(st.width, st.depth)}
            </text>
          )}
        </g>
      ))}
      {Object.values(plan.corners).map((c) => (
          <circle key={c.id} cx={c.x} cy={c.y} r={(selCorner === c.id ? 5 : 2.5) * px} fill={selCorner === c.id ? 'var(--select)' : '#fff'} stroke="#18181b" strokeWidth={px} />
        ))}
    </>
  );
});

const ColumnLayer = memo(function ColumnLayer({ columns, selection, marked, px }: LayerProps & { columns: Record<Id, Column> }) {
  return (
    <>
      {Object.values(columns).map((c) => {
        const sel = selId(selection, 'column') === c.id || marked.has(c.id);
        const fill = sel ? 'var(--select)' : '#6b7280';
        return c.shape === 'round' ? (
          <circle key={c.id} cx={c.x} cy={c.y} r={c.w / 2} fill={fill} stroke="#111827" strokeWidth={px} opacity={c.hidden ? 0.2 : 1} />
        ) : (
          <g key={c.id} opacity={c.hidden ? 0.2 : 1}>
            <polygon points={pts(columnOutline(c))} fill={fill} stroke="#111827" strokeWidth={px} />
            <path d={`M ${columnOutline(c)[0].x} ${columnOutline(c)[0].y} L ${columnOutline(c)[2].x} ${columnOutline(c)[2].y} M ${columnOutline(c)[1].x} ${columnOutline(c)[1].y} L ${columnOutline(c)[3].x} ${columnOutline(c)[3].y}`} stroke="#d1d5db" strokeWidth={0.8 * px} />
          </g>
        );
      })}
    </>
  );
});

const GROUP_FILL: Record<string, string> = { machine: '#fff4e8', office: '#ffffff', production: '#eef2ff', storage: '#fbf3e4', amenity: '#f0f9ff', decor: '#ffffff' };

const ObjectLayer = memo(function ObjectLayer({ plan, selection, marked, px, objects, outdoor }: LayerProps & { objects: PlacedObject[]; outdoor: boolean }) {
  const level = useProject((s) => s.level);
  const shown = objects.filter((o) => onLevel(o, level) && isOutdoor(plan, o) === outdoor);
  const selObject = selId(selection, 'object');
  return (
    <>
      {shown.map((o) => (
        <ObjectShape key={o.id} o={o} px={px} sel={selObject === o.id || marked.has(o.id)} above={levelOf(o) > level} />
      ))}
    </>
  );
});

const ObjectShape = memo(function ObjectShape({ o, px, sel, above }: { o: PlacedObject; px: number; sel: boolean; above?: boolean }) {
  const poly = obbCorners(objectObb(o));
  const item = catalogItem(o.assetId);
  const machine = item?.use === 'machine';
  const open = item?.open;
  const front = lerp(poly[2], poly[3], 0.5);
  if (item?.overhead && above)
    // An upper floor or its railing: a dashed outline over whatever stands beneath.
    return <polygon points={pts(poly)} fill="none" stroke={sel ? 'var(--select)' : '#7c3aed'} strokeWidth={(sel ? 2.5 : 1.2) * px} strokeDasharray={`${6 * px} ${4 * px}`}opacity={o.hidden ? 0.15 : 0.8} pointerEvents="none" />;
  if (o.assetId === 'zone-area')
    // A marked-out floor area: its dashed border and name, under whatever stands in it.
    return (
      <g opacity={o.hidden ? 0.15 : undefined}>
        <polygon points={pts(poly)} fill="#16a34a" fillOpacity={0.06} stroke={sel ? 'var(--select)' : '#16a34a'} strokeWidth={(sel ? 2.5 : 1.5) * px} strokeDasharray={`${8 * px} ${5 * px}`} />
        <text x={o.x} y={o.y} fontSize={12 * px} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill="#15803d">
          {o.name}
        </text>
      </g>
    );
  const fill = machine ? GROUP_FILL.machine : open ? '#fde68a' : GROUP_FILL[item?.group ?? 'decor'] ?? '#fff';
  return (
    <g opacity={o.hidden ? 0.15 : undefined}>
      <polygon points={pts(poly)} fill={fill} fillOpacity={open ? 0.6 : 0.95} stroke={sel ? 'var(--select)' : machine ? '#c2410c' : '#52525b'} strokeWidth={(sel ? 2.5 : machine ? 1.6 : 1) * px} />
      {!open && <line x1={poly[2].x} y1={poly[2].y} x2={poly[3].x} y2={poly[3].y} stroke={machine ? '#ea580c' : '#18181b'} strokeWidth={(machine ? 3.5 : 2) * px} />}
      {Math.min(o.size.w, o.size.d) > 14 * px && Math.max(o.size.w, o.size.d) > o.name.length * 6.5 * px && (
        <text x={o.x} y={o.y} fontSize={(machine ? 11 : 10) * px} fontWeight={machine ? 700 : 400} textAnchor="middle" dominantBaseline="middle" fill={machine ? '#9a3412' : '#3f3f46'}>
          {o.name}
        </text>
      )}
      <circle cx={front.x} cy={front.y} r={2 * px} fill="#18181b" />
    </g>
  );
});

function CursorOverlay({ px }: { px: number }) {
  const tool = useUi((s) => s.tool);
  const cursor = useUi((s) => s.cursor);
  const objectGuides = useUi((s) => s.objectGuides);
  return (
    <>
      {cursor?.guides.map((g, i) => (
        <line key={i} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} stroke="#db2777" strokeDasharray={`${4 * px} ${4 * px}`} strokeWidth={px} />
      ))}
      {objectGuides.map((g, i) => (
        <line key={`o${i}`} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} stroke="#db2777" strokeWidth={2.5 * px} />
      ))}
      {cursor && cursor.kind !== 'free' && tool.kind !== 'addOpening' && (
        <g pointerEvents="none">
          {cursor.kind === 'corner' && <circle cx={cursor.point.x} cy={cursor.point.y} r={7 * px} fill="none" stroke="#db2777" strokeWidth={2 * px} />}
          {(cursor.kind === 'wall' || cursor.kind === 'midpoint') && (
            <rect x={cursor.point.x - 5 * px} y={cursor.point.y - 5 * px} width={10 * px} height={10 * px} fill="none" stroke="#db2777" strokeWidth={2 * px} transform={cursor.kind === 'midpoint' ? `rotate(45 ${cursor.point.x} ${cursor.point.y})` : undefined} />
          )}
          {(cursor.kind === 'grid' || cursor.kind === 'angle' || cursor.kind === 'align') && (
            <path d={`M ${cursor.point.x - 6 * px} ${cursor.point.y} h ${12 * px} M ${cursor.point.x} ${cursor.point.y - 6 * px} v ${12 * px}`} stroke="#db2777" strokeWidth={1.5 * px} />
          )}
        </g>
      )}
    </>
  );
}

function BoxOverlay({ px }: { px: number }) {
  const drag = useUi((s) => (s.tool.kind === 'select' && s.tool.drag?.kind === 'box' ? s.tool.drag : null));
  if (!drag) return null;
  const { from, to } = drag;
  const crossing = isCrossing(from, to);
  const color = crossing ? '#16a34a' : '#2563eb';
  return (
    <rect
      x={Math.min(from.x, to.x)}
      y={Math.min(from.y, to.y)}
      width={Math.abs(to.x - from.x)}
      height={Math.abs(to.y - from.y)}
      fill={color}
      fillOpacity={0.08}
      stroke={color}
      strokeWidth={px}
      strokeDasharray={crossing ? `${6 * px} ${4 * px}` : undefined}
      pointerEvents="none"
    />
  );
}

function ToolOverlay({ px }: { px: number }) {
  const tool = useUi((s) => s.tool);
  const cursor = useUi((s) => s.cursor);
  if (!cursor) return null;
  const p = cursor.point;
  const ghost = { fill: '#18181b', fillOpacity: 0.08, stroke: '#18181b', strokeWidth: px, strokeDasharray: `${6 * px} ${4 * px}`, pointerEvents: 'none' as const };
  if (tool.kind === 'drawWall' && tool.last) {
    const e = wallEnd(tool.last, p, tool.entry);
    return (
      <g pointerEvents="none">
        <line x1={tool.last.x} y1={tool.last.y} x2={e.x} y2={e.y} stroke="#18181b" strokeWidth={150} strokeOpacity={0.35} />
        <line x1={tool.last.x} y1={tool.last.y} x2={e.x} y2={e.y} stroke="#18181b" strokeWidth={px} />
      </g>
    );
  }
  const placing = { alt: cursor.kind === 'free', radius: SNAP_PX * px };
  if (tool.kind === 'drawRoomRect' && tool.start) {
    const a = tool.start;
    const b = rectCorner(a, p, tool.entry);
    return <polygon points={pts(roomOutline([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], placing))} {...ghost} />;
  }
  if (tool.kind === 'placePreset') return <polygon points={pts(roomOutline(presetOutline(tool, p), placing))} {...ghost} />;
  if (tool.kind === 'placeColumn') return <polygon points={pts(columnOutline({ ...tool.spec, x: p.x, y: p.y, rotation: 0 }))} {...ghost} />;
  if (tool.kind === 'columnGrid') {
    const ps = tool.start ? columnGridPoints(tool.start, p, tool.spacing) : [p];
    return (
      <g pointerEvents="none">
        {tool.start && <rect x={Math.min(tool.start.x, p.x)} y={Math.min(tool.start.y, p.y)} width={Math.abs(p.x - tool.start.x)} height={Math.abs(p.y - tool.start.y)} fill="none" stroke="#18181b" strokeWidth={px} strokeDasharray={`${6 * px} ${4 * px}`} />}
        {ps.map((q, i) => (
          <rect key={i} x={q.x - tool.spec.w / 2} y={q.y - tool.spec.d / 2} width={tool.spec.w} height={tool.spec.d} fill="#6b7280" fillOpacity={0.6} />
        ))}
      </g>
    );
  }
  if (tool.kind === 'placeObject') {
    const item = catalogItem(tool.assetId);
    if (!item) return null;
    return <polygon points={pts(obbCorners(objectObb({ x: p.x, y: p.y, z: 0, rotation: 0, size: item.size })))} {...ghost} />;
  }
  if (tool.kind === 'addOpening' && cursor.wallId) {
    const plan = editProject().plan;
    const wall = plan.walls[cursor.wallId];
    if (!wall) return null;
    const preset = OPENING_PRESETS[tool.preset];
    const offset = openingOffsetAt(plan, wall, p, preset.width);
    const symbol = openingSymbol(plan, wall, { ...preset, offset, hingeEnd: tool.hingeEnd, openB: tool.openB });
    return (
      <g pointerEvents="none" opacity={0.75}>
        <OpeningShape symbol={symbol} px={px} stroke="#db2777" />
      </g>
    );
  }
  return null;
}

function entryState(tool: Tool, p: Vec2): { fields: EntryField[]; entry: Entry; live: number[]; at: Vec2 } | null {
  if (tool.kind === 'drawWall' && tool.last) {
    const e = wallEnd(tool.last, p, tool.entry);
    const d = { x: e.x - tool.last.x, y: e.y - tool.last.y };
    return { fields: ENTRY_FIELDS.drawWall, entry: tool.entry, live: [Math.hypot(d.x, d.y) / 10, planDeg(d)], at: e };
  }
  if (tool.kind === 'drawRoomRect' && tool.start) {
    const b = rectCorner(tool.start, p, tool.entry);
    return { fields: ENTRY_FIELDS.drawRoomRect, entry: tool.entry, live: [Math.abs(b.x - tool.start.x) / 10, Math.abs(b.y - tool.start.y) / 10], at: b };
  }
  if (tool.kind === 'placePreset') return { fields: ENTRY_FIELDS.placePreset, entry: tool.entry, live: [tool.w / 10, tool.d / 10], at: p };
  return null;
}

function DrawEntry({ toScreen, size }: { toScreen: (p: Vec2) => Vec2; size: { w: number; h: number } }) {
  const tool = useUi((s) => s.tool);
  const cursor = useUi((s) => s.cursor);
  const state = cursor && entryState(tool, cursor.point);
  if (!state) return null;
  const s = toScreen(state.at);
  const left = s.x + 240 > size.w;
  const up = s.y + 120 > size.h;
  const style = { left: s.x + (left ? -18 : 18), top: s.y + (up ? -18 : 18), transform: `translate(${left ? -100 : 0}%, ${up ? -100 : 0}%)` };
  return (
    <div className="draw-entry glass" style={style}>
      {state.fields.map((f, i) => {
        const typed = state.entry.values[i];
        return (
          <div key={f.label} className={`draw-field${state.entry.field === i ? ' on' : ''}`}>
            <span className="draw-label">{f.label}</span>
            <span className={`draw-value${typed ? ' typed' : ''}`}>{typed || (f.unit === '°' ? Math.round(state.live[i]) : state.live[i].toFixed(1))}</span>
            <span className="draw-unit">{f.unit}</span>
          </div>
        );
      })}
      <div className="draw-keys">พิมพ์ตัวเลข • Tab สลับช่อง • Enter ยืนยัน</div>
    </div>
  );
}

function OpeningShape({ symbol, px, stroke }: { symbol: OpeningSymbol; px: number; stroke: string }) {
  return (
    <g>
      <polygon points={pts(symbol.cut)} fill="#ffffff" />
      {symbol.panels.map((q, i) => (
        <polygon key={i} points={pts(q)} fill="#ffffff" stroke={stroke} strokeWidth={1.2 * px} strokeLinejoin="round" />
      ))}
      {symbol.arcs.map((a, i) => (
        <path key={i} d={`M ${a.from.x} ${a.from.y} A ${a.r} ${a.r} 0 0 ${a.sweep} ${a.to.x} ${a.to.y}`} fill="none" stroke={stroke} strokeWidth={px} strokeDasharray={`${4 * px} ${3 * px}`} />
      ))}
      {symbol.lines.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={1.2 * px} strokeLinecap="round" />
      ))}
    </g>
  );
}

const HINTS: Record<string, string> = {
  select: 'คลิกเพื่อเลือก • ดับเบิลคลิกผนัง = ใส่ประตู • ลากมุม/ผนัง/วัตถุ/เสาเพื่อย้าย • R หมุน 90° • Ctrl+D ทำสำเนา • คลิกขวาลากเพื่อเลื่อน • Alt = ไม่ Snap',
  drawWall: 'คลิกเพื่อวางจุด • พิมพ์ความยาว (ซม.) • Tab แล้วพิมพ์มุม (°) • Enter วางผนัง • Esc จบ',
  drawRoomRect: 'คลิกมุมแรก แล้วคลิกมุมตรงข้าม หรือพิมพ์กว้าง • Tab • ลึก (ซม.) แล้ว Enter',
  placePreset: 'พิมพ์กว้าง • Tab • ลึก (ซม.) แล้วคลิกเพื่อวางโซน',
  placeObject: 'คลิกเพื่อวาง (ติดผนังให้เอง) • วางต่อได้หลายตัว • Alt = ไม่ติดผนัง • Esc จบ',
  addOpening: 'คลิกบนผนังเพื่อวาง • ขยับเมาส์ไปฝั่งที่ต้องการให้ประตูเปิด • กด F สลับด้านบานพับ',
  placeColumn: 'คลิกเพื่อวางเสา (ติดตาราง) • วางต่อได้หลายต้น • Esc จบ',
  columnGrid: 'คลิกมุมแรก แล้วคลิกมุมตรงข้าม เพื่อวางเสาเป็นตาราง • ปรับระยะห่างที่แผงขวา • Esc จบ',
  calibrate: 'คลิก 2 จุดบนแปลนที่รู้ระยะจริง แล้วพิมพ์ระยะ • Shift = แนวตรง • Esc ยกเลิก',
  moveUnderlay: 'ลากเพื่อย้ายแปลนพื้นหลัง • Esc จบ',
};

function Hud() {
  const tool = useUi((s) => s.tool);
  const cursor = useUi((s) => s.cursor);
  return (
    <div className="hud glass">
      {HINTS[tool.kind]}
      {cursor && cursor.kind !== 'free' ? ` • Snap: ${cursor.kind}` : ''}
    </div>
  );
}

const RAIL_PX = 84;

function initialView(project: Project, pane = { w: 800, h: 600 }): View {
  const rail = RAIL_PX;
  const room = { w: Math.max(200, pane.w - rail - 48), h: Math.max(160, pane.h - 96) };
  const fit = (c: Vec2, w: number, h: number, fill: number): View => {
    const s = Math.min(room.w / w, room.h / h) * fill;
    return { cx: c.x - rail / 2 / s, cy: c.y, s };
  };
  const u = project.underlay;
  const ps = Object.values(project.plan.corners);
  if (ps.length < 2 && u) {
    const r = underlayRect(u);
    return fit(u, r.w, r.h, 0.9);
  }
  if (ps.length < 2) return fit({ x: 10000, y: 7000 }, 24000, 16000, 1);
  const b = bounds(ps);
  return fit({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }, Math.max(2000, b.max.x - b.min.x), Math.max(2000, b.max.y - b.min.y), 0.92);
}
