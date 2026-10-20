import { useEffect, useRef, useState } from 'react';
import { ACTS, actColor } from '../sim/activities';
import { useProject } from '../store/project';
import { useSim } from '../store/sim';
import { rememberRealistic, useUi } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { FactoryScene } from './scene';

/** The 3D pane: the low-poly factory, with the simulation's people when it runs. */
export default function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FactoryScene | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const project = useProject((s) => s.project!);
  const mode = useUi((s) => s.mode);
  const engine = useSim((s) => s.engine);
  const agent = useUi((s) => s.agent);
  const selection = useUi((s) => s.selection);
  const cutaway = useUi((s) => s.cutaway);
  const shadows = useUi((s) => s.shadows);
  const showPaths = useUi((s) => s.showPaths);
  const realistic = useUi((s) => s.realistic);
  const [names, setNames] = useState(true);

  useEffect(() => {
    const s = new FactoryScene(host.current!);
    sceneRef.current = s;
    if (import.meta.env.DEV) Object.assign(window, { __scene: s });
    s.onAgentScreen = (p) => {
      const el = card.current;
      if (!el) return;
      if (!p || !p.visible) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    };
    const onFocus = (e: Event) => {
      const a = useSim.getState().engine?.agents.find((x) => x.id === (e as CustomEvent).detail);
      if (a) s.focusAgent(a);
    };
    const onFollow = (e: Event) => void (s.follow = !!(e as CustomEvent).detail);
    window.addEventListener('factory:focus', onFocus);
    window.addEventListener('factory:follow', onFollow);
    return () => {
      window.removeEventListener('factory:focus', onFocus);
      window.removeEventListener('factory:follow', onFollow);
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setProject(project), [project]);
  useEffect(() => sceneRef.current?.setEngine(mode === 'sim' ? engine : null), [engine, mode]);
  useEffect(() => sceneRef.current?.select(agent, selection?.kind === 'object' ? selection.id : null), [agent, selection]);
  useEffect(() => sceneRef.current?.setOptions({ cutaway, shadows, names, paths: showPaths, realistic }), [cutaway, shadows, names, showPaths, realistic]);

  useEffect(() => rememberRealistic(realistic), [realistic]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => void (down.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return;
    const s = sceneRef.current!;
    const hit = s.pick(e.clientX, e.clientY);
    const ui = useUi.getState();
    if (hit.agent) ui.set({ agent: hit.agent, selection: null });
    else if (hit.object) ui.set({ selection: { kind: 'object', id: hit.object as never }, agent: null });
    else ui.set({ selection: null, agent: null });
  };
  const onDouble = (e: React.MouseEvent) => {
    const p = sceneRef.current?.floorPoint(e.clientX, e.clientY);
    if (p) sceneRef.current!.focus(p.x, p.y, 16);
  };

  const a = agent && engine?.agents.find((x) => x.id === agent);
  useSim((s) => s.version);
  const toggle = (k: 'cutaway' | 'shadows' | 'showPaths' | 'realistic') => useUi.getState().set({ [k]: !useUi.getState()[k] });

  return (
    <div className="view3d">
      <div ref={host} className="view3d-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onDoubleClick={onDouble} data-testid="view3d" />
      {mode === 'sim' && a && a.present && (
        <div ref={card} className="agent-pop" style={{ ['--c' as string]: a.color }}>
          <b>{a.name}</b>
          <span>
            <i style={{ background: actColor(a.act) }} />
            {ACTS[a.act].label} · {a.label}
          </span>
        </div>
      )}
      <div className="view-tools glass">
        <button className={`ib sm${cutaway ? ' on' : ''}`} onClick={() => toggle('cutaway')} title="ตัดผนังให้เตี้ย มองเห็นข้างใน" aria-pressed={cutaway}>
          <Icon name="cut" />
        </button>
        <button className={`ib sm${realistic ? ' on' : ''}`} onClick={() => toggle('realistic')} title="โหมดสมจริง: คนแบบละเอียด แสงเงาและวัสดุเหมือนจริง (ใช้เครื่องแรงขึ้น)" aria-pressed={realistic}>
          <Icon name="realistic" />
        </button>
        <button className={`ib sm${shadows ? ' on' : ''}`} onClick={() => toggle('shadows')} title="เงา (ใช้เครื่องแรงขึ้น)" aria-pressed={shadows}>
          <Icon name="shadow" />
        </button>
        {mode === 'sim' && (
          <>
            <button className={`ib sm${names ? ' on' : ''}`} onClick={() => setNames(!names)} title="ชื่อคน" aria-pressed={names}>
              <Icon name="tag" />
            </button>
            <button className={`ib sm${showPaths ? ' on' : ''}`} onClick={() => toggle('showPaths')} title="เส้นทางเดินของทุกคน" aria-pressed={showPaths}>
              <Icon name="route" />
            </button>
          </>
        )}
        <button className="ib sm" onClick={() => sceneRef.current?.frame()} title="มุมมองทั้งโรงงาน">
          <Icon name="fit" />
        </button>
      </div>
      <div className="view-hint">ลากเพื่อหมุน · คลิกขวาลากเพื่อเลื่อน · เลื่อนลูกกลิ้งเพื่อซูม · {mode === 'sim' ? 'คลิกคนเพื่อดูข้อมูลและเส้นทาง · ' : 'คลิกวัตถุเพื่อเลือก · '}ดับเบิลคลิกเพื่อซูมไปจุดนั้น</div>
    </div>
  );
}
