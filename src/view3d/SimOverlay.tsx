import { useEffect, useMemo, useRef, useState } from 'react';
import { advance, lineOf, lineStats, pointOnLeg, startSim, type StationState } from '../model/simulation';
import type { Project } from '../model/types';
import type { FactoryScene } from './scene';

const LAMP: Record<StationState, string> = { run: '#22c55e', idle: '#f59e0b', blocked: '#ef4444' };
/** Factory minutes that pass in a second on screen. */
const SPEEDS = [1, 5, 20];

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The running line: drives the trolleys in the 3D scene and shows what the line does in a few big figures. */
export function SimOverlay({ scene, project }: { scene: FactoryScene; project: Project }) {
  const line = useMemo(() => lineOf(project), [project]);
  const stats = useMemo(() => lineStats(line), [line]);
  const [speed, setSpeed] = useState(5);
  const [live, setLive] = useState({ done: 0, time: 0 });
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (line.stations.length < 2) return;
    const sim = startSim(line);
    scene.prepareSim(
      line.legs.length,
      line.stations.map((s) => ({ x: s.at.x, y: s.at.y, top: s.top })),
    );
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      advance(line, sim, dt * speedRef.current * 60);
      scene.showSim(
        sim.carts.map((c, i) => {
          const { at, heading } = pointOnLeg(line.legs[i].points, c.pos);
          return { x: at.x, y: at.y, heading: c.phase === 'back' ? heading + Math.PI : heading, loaded: c.load > 0 };
        }),
        sim.stations.map((s, i) => ({ x: line.stations[i].inAt.x, y: line.stations[i].inAt.y, queue: s.queue, color: LAMP[s.state] })),
      );
      if (now - shown > 250) {
        shown = now;
        setLive({ done: sim.done, time: sim.time });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      scene.endSim();
    };
  }, [line, scene]);

  if (line.stations.length < 2) return <div className="sim-empty">ต้องมีอย่างน้อย 2 เครื่องบนเส้นทางงาน</div>;
  return (
    <>
      <div className="sim-hud" data-testid="sim-hud">
        <div className="sim-card">
          <span>ผลิตได้</span>
          <b>{Math.round(stats.perDay)}</b>
          <small>แผ่น/วัน</small>
        </div>
        <div className="sim-card">
          <span>เวลาผ่านไลน์</span>
          <b>{Math.round(stats.leadMinutes)}</b>
          <small>นาที</small>
        </div>
        <div className="sim-card">
          <span>เข็นงาน</span>
          <b>{(stats.metresPerDay / 1000).toFixed(1)}</b>
          <small>กม./วัน</small>
        </div>
        <div className="sim-card alert">
          <span>คอขวด</span>
          <b>{stats.bottleneck}</b>
        </div>
        <div className="sim-card">
          <span>เสร็จแล้ว</span>
          <b data-testid="sim-done">{live.done}</b>
          <small>{clock(live.time)}</small>
        </div>
      </div>
      <div className="sim-speed" role="group" aria-label="ความเร็ว">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)} data-testid={`sim-speed-${s}`}>
            ×{s * 60}
          </button>
        ))}
      </div>
    </>
  );
}
