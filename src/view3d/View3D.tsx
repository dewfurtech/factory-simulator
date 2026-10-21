import { useEffect, useRef } from 'react';
import { useProject } from '../store/project';
import { rememberRealistic, useUi } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { FactoryScene } from './scene';

/** The 3D pane: the factory, with the picked object highlighted. */
export default function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FactoryScene | null>(null);
  const project = useProject((s) => s.project!);
  const selection = useUi((s) => s.selection);
  const cutaway = useUi((s) => s.cutaway);
  const shadows = useUi((s) => s.shadows);
  const realistic = useUi((s) => s.realistic);

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
  useEffect(() => sceneRef.current?.select(null, selection?.kind === 'object' ? selection.id : null), [selection]);
  useEffect(() => sceneRef.current?.setOptions({ cutaway, shadows, names: false, paths: false, realistic }), [cutaway, shadows, realistic]);

  useEffect(() => rememberRealistic(realistic), [realistic]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => void (down.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return;
    const hit = sceneRef.current!.pick(e.clientX, e.clientY);
    useUi.getState().set({ selection: hit.object ? { kind: 'object', id: hit.object as never } : null });
  };
  const onDouble = (e: React.MouseEvent) => {
    const p = sceneRef.current?.floorPoint(e.clientX, e.clientY);
    if (p) sceneRef.current!.focus(p.x, p.y, 16);
  };

  const toggle = (k: 'cutaway' | 'shadows' | 'realistic') => useUi.getState().set({ [k]: !useUi.getState()[k] });

  return (
    <div className="view3d">
      <div ref={host} className="view3d-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onDoubleClick={onDouble} data-testid="view3d" />
      <div className="view-tools glass">
        <button className={`ib sm${cutaway ? ' on' : ''}`} onClick={() => toggle('cutaway')} title="ตัดผนังให้เตี้ย มองเห็นข้างใน" aria-pressed={cutaway}>
          <Icon name="cut" />
        </button>
        <button className={`ib sm${realistic ? ' on' : ''}`} onClick={() => toggle('realistic')} title="โหมดสมจริง: แสงเงาและวัสดุเหมือนจริง (ใช้เครื่องแรงขึ้น)" aria-pressed={realistic}>
          <Icon name="realistic" />
        </button>
        <button className={`ib sm${shadows ? ' on' : ''}`} onClick={() => toggle('shadows')} title="เงา (ใช้เครื่องแรงขึ้น)" aria-pressed={shadows}>
          <Icon name="shadow" />
        </button>
        <button className="ib sm" onClick={() => sceneRef.current?.frame()} title="มุมมองทั้งโรงงาน">
          <Icon name="fit" />
        </button>
      </div>
      <div className="view-hint">ลากเพื่อหมุน · คลิกขวาลากเพื่อเลื่อน · เลื่อนลูกกลิ้งเพื่อซูม · คลิกวัตถุเพื่อดูรายละเอียด · ดับเบิลคลิกเพื่อซูมไปจุดนั้น</div>
    </div>
  );
}
