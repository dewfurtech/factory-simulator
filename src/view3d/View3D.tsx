import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../store/library';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { moveWithStack, snapObject } from '../model/objects';
import { objectAt, placeObjectAt, rotateObject } from '../editor2d/tools';
import { ASSET_MIME, draggedAssetId } from '../editor2d/PlanEditor';
import type { Id, Vec2 } from '../model/types';
import { Icon } from '../editor2d/Toolbar';
import { FactoryScene, type PieceHooks } from './scene';
import type { FinishHooks } from './building3d';
import { locate } from '../model/locate';
import { download } from '../editor2d/exportImage';
import { IssuesChip, useTroubled } from '../panels/IssuesChip';
import { HelpButton } from '../ui/HelpButton';
import { Loading3D } from '../ui/Loading3D';
import { isFigure } from '../model/figures';

/**
 * The 3D pane: the factory, with the picked object highlighted. An interior project passes `finishes`, which puts
 * materials on finished surfaces, ceilings over the rooms, and a button to take the ceilings off; and `pieces`, which
 * draws its cabinets and furniture its own way, with a button that opens every cabinet.
 */
export default function View3D({ finishes, pieces }: { finishes?: FinishHooks; pieces?: PieceHooks } = {}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FactoryScene | null>(null);
  const project = useProject((s) => s.project!);
  const selection = useUi((s) => s.selection);
  // An interior keeps its own low-walls switch (off at first, so its wall materials show); a factory's stays its own.
  const cutawayKey = finishes ? 'interiorCutaway' : 'cutaway';
  const cutaway = useUi((s) => s[cutawayKey]);
  const areas = useUi((s) => !s.areasHidden);
  const ceilingsHidden = useUi((s) => s.ceilingsHidden);
  // Clay and shadows, kept apart for factories and interiors.
  const lookKind = finishes ? 'interior' : 'factory';
  const look = useUi((s) => s.look3d[lookKind]);
  // The life-size people: one switch hides them in both views; the idle sway is kept per kind of project.
  const figuresHidden = useUi((s) => s.figuresHidden);
  const idleKey = finishes ? 'interior' : 'factory';
  const idle = useUi((s) => s.figureIdle[idleKey]);
  const hasFigures = project.objects.some(isFigure);
  const [top, setTop] = useState(false);
  const [cabinetsOpen, setCabinetsOpen] = useState(false);
  // Move mode: dragging a machine slides it over the floor, as on the plan.
  const moving = useUi((s) => s.move3d);
  const setMoving = (on: boolean) => useUi.getState().set({ move3d: on });
  const goto = useUi((s) => s.goto);
  // The factory is built a moment after the pane appears, so the loading screen paints first; it fades once a frame is drawn.
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);

  // A go-to from the layers panel: fly in over the thing, closer the smaller it is.
  useEffect(() => {
    if (!goto) return;
    const spot = locate(project, goto.sel);
    if (spot) sceneRef.current?.focus(spot.center.x, spot.center.y, Math.min(80, Math.max(5, spot.extent * 0.0014 + 3)), spot.z * 0.001);
  }, [goto]);

  useEffect(() => {
    const s = new FactoryScene(host.current!);
    sceneRef.current = s;
    // The scene on window for the console and the browser tests (built with --mode e2e).
    if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') Object.assign(window, { __scene: s });
    // Where the middle of this view meets the floor: the library drops a new machine there.
    useUi.getState().set({
      floorCentre: () => {
        const r = s.renderer.domElement.getBoundingClientRect();
        return s.floorPoint(r.left + r.width / 2, r.top + r.height / 2);
      },
      snapshot3d: (longSide, look) => s.snapshot(longSide, look),
    });
    const start = setTimeout(() => setStarted(true), 40);
    return () => {
      clearTimeout(start);
      useUi.getState().set({ floorCentre: null, snapshot3d: null });
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (started) sceneRef.current?.setProject(project);
  }, [project, started]);
  useEffect(() => {
    if (!started) return;
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setShown(true))));
    return () => (cancelAnimationFrame(a), cancelAnimationFrame(b));
  }, [started]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setGone(true), 300);
    return () => clearTimeout(t);
  }, [shown]);
  // Placed copies of the user's own models follow edits to the library (colour, size, shape) and removals.
  const models = useLibrary((s) => s.models);
  const prevModels = useRef(models);
  useEffect(() => {
    const before = prevModels.current;
    prevModels.current = models;
    if (before === models) return;
    const changed = new Set<string>();
    for (const m of models) if (!before.includes(m)) changed.add(m.id);
    for (const m of before) if (!models.includes(m)) changed.add(m.id);
    if (changed.size) sceneRef.current?.refreshAssets(changed);
  }, [models]);
  useEffect(() => sceneRef.current?.select(selection?.kind === 'object' ? selection.id : null), [selection, started]);
  // Things that cannot stand where they are get a red frame in 3D, as they get a red outline on the plan.
  const troubled = useTroubled();
  useEffect(() => sceneRef.current?.markTroubled(troubled.map((t) => t.id)), [troubled, started]);
  useEffect(() => {
    const people = { figuresHidden, figureIdle: idle };
    sceneRef.current?.setOptions(finishes ? { cutaway, areas, finishes, ceilings: !ceilingsHidden && !top, pieces, ...people } : { cutaway, areas, ...people });
  }, [cutaway, areas, finishes, ceilingsHidden, top, pieces, figuresHidden, idle]);
  useEffect(() => sceneRef.current?.setLook(look), [look]);
  useEffect(() => sceneRef.current?.setPiecesOpen(cabinetsOpen ? 1 : 0), [cabinetsOpen]);
  useEffect(() => sceneRef.current?.setTopView(top), [top]);

  const down = useRef<{ x: number; y: number } | null>(null);
  /** A machine being dragged over the floor: which, and where under it the pointer took hold. */
  const drag = useRef<{ id: Id; grab: Vec2; moved: boolean } | null>(null);
  /**
   * Runs in the capture phase, before the orbit controls' own listener on the canvas: taking hold of a machine stops
   * the event there, so the camera never starts turning with it (and never gets stuck turning after the pointer
   * is captured away from the canvas).
   */
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
    if (!moving || e.button !== 0) return;
    const s = sceneRef.current!;
    const hit = s.pick(e.clientX, e.clientY);
    const o = hit.object && project.objects.find((x) => x.id === hit.object);
    const floor = s.floorPoint(e.clientX, e.clientY);
    if (!o || o.locked || !floor) return;
    e.stopPropagation();
    drag.current = { id: o.id, grab: { x: floor.x - o.x, y: floor.y - o.y }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    useUi.getState().set({ selection: { kind: 'object', id: o.id } });
    useProject.getState().beginGesture();
  };
  // A library card dragged in: its shape follows the pointer over the floor (snapped as it would be placed), and it
  // lands where it is dropped, selected and ready to move.
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const assetId = draggedAssetId();
    const at = assetId && sceneRef.current?.floorPoint(e.clientX, e.clientY);
    sceneRef.current?.showGhost(assetId && at ? objectAt(assetId, at, 300, e.altKey) : null);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!host.current?.contains(e.relatedTarget as Node | null)) sceneRef.current?.showGhost(null);
  };
  const onDrop = (e: React.DragEvent) => {
    sceneRef.current?.showGhost(null);
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    const at = assetId && sceneRef.current?.floorPoint(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    const id = placeObjectAt(assetId, at, 300, e.altKey);
    useUi.getState().set({ selection: { kind: 'object', id }, move3d: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const floor = sceneRef.current!.floorPoint(e.clientX, e.clientY);
    if (!floor) return;
    d.moved = true;
    const target = { x: floor.x - d.grab.x, y: floor.y - d.grab.y };
    useProject.getState().apply((p) => {
      const o = p.objects.find((x) => x.id === d.id);
      if (!o) return;
      // Snaps flush to walls and neighbours the way the plan does, unless snapping is off or Alt is held.
      const pose = useUi.getState().snapOn && !e.altKey ? snapObject(p.plan, p.objects, o, target, 250) : { ...target, z: o.z, rotation: o.rotation, guides: [] };
      moveWithStack(p.objects, d.id, pose);
    });
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    useProject.getState().endGesture();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (drag.current) {
      const dragged = drag.current.moved;
      endDrag();
      if (dragged) return;
    }
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return;
    const hit = sceneRef.current!.pick(e.clientX, e.clientY);
    // A locked object can't be picked here either, the same as on the plan.
    const locked = hit.object && project.objects.find((o) => o.id === hit.object)?.locked;
    // A click on nothing also tucks the panel away, even when it was opened by hand.
    useUi.getState().set(hit.object && !locked ? { selection: { kind: 'object', id: hit.object as never } } : { selection: null, panelOpen: false });
  };
  const onDouble = (e: React.MouseEvent) => {
    const p = sceneRef.current?.floorPoint(e.clientX, e.clientY);
    if (p) sceneRef.current!.focus(p.x, p.y, 16);
  };

  return (
    <div className="view3d">
      {!gone && <Loading3D leaving={shown} />}
      <div
        ref={host}
        className={`view3d-canvas${moving ? ' moving' : ''}`}
        onPointerDownCapture={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onDoubleClick={onDouble}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="view3d"
      />
      <div className="view-tools glass">
        {/* The move switch sits with the view buttons but in its own colour: it changes what a drag does. */}
        <button
          className={`ib sm move-3d${moving ? ' on' : ''}`}
          onClick={() => setMoving(!moving)}
          title={moving ? 'กำลังย้ายเครื่อง: ลากเครื่องเพื่อย้าย กด R หมุน · คลิกเพื่อกลับไปหมุนมุมมอง' : 'ย้ายเครื่องใน 3D: ลากเครื่องบนพื้นได้เลย'}
          aria-pressed={moving}
          data-testid="move-3d"
        >
          <Icon name="move" />
        </button>
        {moving && selection?.kind === 'object' && (
          <button className="ib sm" onClick={() => rotateObject(selection.id, Math.PI / 2)} title="หมุน 90° (R)" data-testid="rotate-3d">
            <Icon name="rotate" />
          </button>
        )}
        <span className="view-tools-sep" />
        <button
          className={`ib sm${cutaway ? ' on' : ''}`}
          onClick={() => useUi.getState().set({ [cutawayKey]: !cutaway })}
          title="ผนังเตี้ย (เปิด/ปิด): ลดผนังลงเกือบติดพื้น เห็นห้องและประตูชัด"
          aria-pressed={cutaway}
        >
          <Icon name="cut" />
        </button>
        <button className={`ib sm${top ? ' on' : ''}`} onClick={() => setTop(!top)} title="มุมมองจากด้านบน (Top view)" aria-pressed={top} data-testid="top-view">
          <Icon name="topView" />
        </button>
        {finishes && (
          <button
            className={`ib sm${ceilingsHidden ? ' on' : ''}`}
            onClick={() => useUi.getState().set({ ceilingsHidden: !ceilingsHidden })}
            title={ceilingsHidden ? 'ซ่อนฝ้าอยู่: คลิกเพื่อแสดงฝ้า' : 'ซ่อนฝ้า เพื่อมองเข้าไปในห้องจากด้านบน'}
            aria-pressed={ceilingsHidden}
            data-testid="ceilings-hidden"
          >
            <Icon name="ceiling" />
          </button>
        )}
        {pieces && (
          <button
            className={`ib sm${cabinetsOpen ? ' on' : ''}`}
            onClick={() => setCabinetsOpen(!cabinetsOpen)}
            title={cabinetsOpen ? 'ปิดตู้: ปิดบานและเก็บลิ้นชักของทุกตู้' : 'เปิดตู้: เปิดบานและดึงลิ้นชักของทุกตู้'}
            aria-pressed={cabinetsOpen}
            data-testid="cabinets-open"
          >
            <Icon name="cabinetOpen" />
          </button>
        )}
        <button
          className={`ib sm${look.clay ? ' on' : ''}`}
          onClick={() => useUi.getState().setLook(lookKind, { clay: !look.clay })}
          title={look.clay ? 'โหมดดินปั้นอยู่: คลิกเพื่อกลับไปเห็นสีและวัสดุ' : 'ดินปั้น: ดูแค่รูปทรงกับเงา ไม่มีสีและวัสดุ'}
          aria-pressed={look.clay}
          data-testid="clay-3d"
        >
          <Icon name="clay" />
        </button>
        <button
          className={`ib sm${look.shadows ? ' on' : ''}`}
          onClick={() => useUi.getState().setLook(lookKind, { shadows: !look.shadows })}
          title={look.shadows ? 'เงาเปิดอยู่: คลิกเพื่อปิดเงา' : 'เงา: เปิดเงาจากแดด'}
          aria-pressed={look.shadows}
          data-testid="shadows-3d"
        >
          <Icon name="sun" />
        </button>
        {hasFigures && (
          <button
            className={`ib sm${figuresHidden ? '' : ' on'}`}
            onClick={() => {
              const ui = useUi.getState();
              const sel = ui.selection;
              const picked = sel?.kind === 'object' && project.objects.find((o) => o.id === sel.id);
              // A hidden person cannot stay picked.
              ui.set({ figuresHidden: !figuresHidden, ...(!figuresHidden && picked && isFigure(picked) && { selection: null }) });
            }}
            title={figuresHidden ? 'แสดงหุ่นคน (ซ่อนอยู่ทั้งแปลนและ 3D)' : 'ซ่อนหุ่นคน: หุ่นเทียบขนาดหายจากแปลนและ 3D (ยังอยู่ในโปรเจกต์)'}
            aria-pressed={!figuresHidden}
            data-testid="figures-toggle"
          >
            <Icon name="person" />
          </button>
        )}
        {hasFigures && !figuresHidden && (
          <button
            className={`ib sm${idle ? ' on' : ''}`}
            onClick={() => useUi.getState().set({ figureIdle: { ...useUi.getState().figureIdle, [idleKey]: !idle } })}
            title={idle ? 'ท่าขยับ: เปิดอยู่ (หุ่นหายใจ ขยับตัวเล็กน้อย) คลิกเพื่อหยุด' : 'ท่าขยับ: ให้หุ่นหายใจและขยับตัวเล็กน้อย'}
            aria-pressed={idle}
            data-testid="figures-idle"
          >
            <Icon name="personIdle" />
          </button>
        )}
        <button className="ib sm" onClick={() => sceneRef.current?.frame()} title="มุมมองทั้งโรงงาน">
          <Icon name="fit" />
        </button>
        <button
          className="ib sm"
          onClick={() => void sceneRef.current?.snapshot().then((b) => b && download(b, `${project.name} 3D.png`))}
          title="บันทึกรูปมุมมองนี้ (PNG)"
          data-testid="snapshot-3d"
        >
          <Icon name="image" />
        </button>
      </div>
      <IssuesChip />
      <HelpButton
        className="view-help"
        sections={[
          moving
            ? { title: 'โหมดย้ายเครื่อง', items: ['ลากเครื่องเพื่อย้าย', 'R หรือปุ่มหมุน หมุน 90°', 'ลากพื้นว่างเพื่อหมุนมุมมอง', 'ลากการ์ดจากคลังมาวางบนพื้นได้'] }
            : top
              ? { title: 'มุมมองด้านบน', items: ['ลากเพื่อเลื่อน'] }
              : { title: 'มุมมอง 3D', items: ['ลากเพื่อหมุน', 'คลิกขวาลากเพื่อเลื่อน'] },
          { title: 'ทั่วไป', items: ['ลูกกลิ้งซูม', 'คลิกเครื่องเพื่อดูรูปและขนาด', 'ดับเบิลคลิกเพื่อซูมไปจุดนั้น', 'ปุ่มน้ำเงินด้านขวาบน = โหมดย้ายเครื่อง'] },
        ]}
      />
    </div>
  );
}
