import { useEffect, useRef, useState } from 'react';
import { useProject } from '../store/project';
import { DRAWING_TOOLS, rememberRealistic, useUi } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { FactoryScene } from './scene';
import { locate } from '../model/locate';
import { download } from '../editor2d/exportImage';

/** The 3D pane: the factory, with the picked object highlighted. */
export default function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FactoryScene | null>(null);
  const project = useProject((s) => s.project!);
  const selection = useUi((s) => s.selection);
  const cutaway = useUi((s) => s.cutaway);
  const shadows = useUi((s) => s.shadows);
  const realistic = useUi((s) => s.realistic);
  const islandOn = useUi((s) => s.island);
  // While walls, rooms or areas are being drawn the whole ground is back, so there is somewhere to draw beyond the island.
  const drawing = useUi((s) => DRAWING_TOOLS.has(s.tool.kind));
  const island = islandOn && !drawing;
  const areas = useUi((s) => !s.areasHidden);
  const [top, setTop] = useState(false);
  const goto = useUi((s) => s.goto);

  // A go-to from the layers panel: fly in over the thing, closer the smaller it is.
  useEffect(() => {
    if (!goto) return;
    const spot = locate(project, goto.sel);
    if (spot) sceneRef.current?.focus(spot.center.x, spot.center.y, Math.min(80, Math.max(5, spot.extent * 0.0014 + 3)), spot.z * 0.001);
  }, [goto]);

  useEffect(() => {
    const s = new FactoryScene(host.current!);
    sceneRef.current = s;
    if (import.meta.env.DEV) Object.assign(window, { __scene: s });
    return () => {
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setProject(project), [project]);
  useEffect(() => sceneRef.current?.select(selection?.kind === 'object' ? selection.id : null), [selection]);
  useEffect(() => sceneRef.current?.setOptions({ cutaway, shadows, realistic, island, areas }), [cutaway, shadows, realistic, island, areas]);

  useEffect(() => rememberRealistic(realistic), [realistic]);
  useEffect(() => sceneRef.current?.setTopView(top), [top]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => void (down.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
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

  const toggle = (k: 'cutaway' | 'shadows' | 'realistic' | 'island') => useUi.getState().set({ [k]: !useUi.getState()[k] });

  return (
    <div className="view3d">
      <div ref={host} className="view3d-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onDoubleClick={onDouble} data-testid="view3d" />
      <div className="view-tools glass">
        <button
          className={`ib sm${cutaway ? ' on' : ''}`}
          onClick={() => toggle('cutaway')}
          title="ผนังเตี้ย (เปิด/ปิด): ลดผนังลงเกือบติดพื้น เห็นห้องและประตูชัด"
          aria-pressed={cutaway}
        >
          <Icon name="cut" />
        </button>
        <button
          className={`ib sm${realistic ? ' on' : ''}`}
          onClick={() => toggle('realistic')}
          title="โหมดสมจริง: แสงเงาและวัสดุเหมือนจริง (ใช้เครื่องแรงขึ้น)"
          aria-pressed={realistic}
        >
          <Icon name="realistic" />
        </button>
        <button className={`ib sm${shadows ? ' on' : ''}`} onClick={() => toggle('shadows')} title="เงา (ใช้เครื่องแรงขึ้น)" aria-pressed={shadows}>
          <Icon name="shadow" />
        </button>
        <button
          className={`ib sm${islandOn ? ' on' : ''}`}
          onClick={() => toggle('island')}
          title="พื้นแบบเกาะ: ตัดพื้นรอบนอกให้เหลือแค่รอบอาคาร (กลับมาเต็มเองตอนวาดผนัง/พื้นที่)"
          aria-pressed={islandOn}
          data-testid="island"
        >
          <Icon name="island" />
        </button>
        <button className={`ib sm${top ? ' on' : ''}`} onClick={() => setTop(!top)} title="มุมมองจากด้านบน (Top view)" aria-pressed={top} data-testid="top-view">
          <Icon name="topView" />
        </button>
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
      <div className="view-hint">
        {top ? 'มุมมองด้านบน · ลากเพื่อเลื่อน' : 'ลากเพื่อหมุน · คลิกขวาลากเพื่อเลื่อน'} · เลื่อนลูกกลิ้งเพื่อซูม · คลิกวัตถุเพื่อดูรายละเอียด · ดับเบิลคลิกเพื่อซูมไปจุดนั้น
      </div>
    </div>
  );
}
