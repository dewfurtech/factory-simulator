import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtClock } from '../model/project';
import { ROLES } from '../model/roles';
import { ACTS, actColor, GROUP_IDS, GROUPS, MACHINE_STATES, type ActGroup } from '../sim/activities';
import { th, type Agent, type Engine, type MachineSim } from '../sim/engine';
import { SPEEDS, useSim } from '../store/sim';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { MachineSpec } from './MachineSpec';

const roleLabel = (a: Agent) => (a.kind === 'customer' ? 'ลูกค้า' : ROLES[a.role as keyof typeof ROLES]?.label ?? a.role);

function useEngine(): Engine | null {
  useSim((s) => s.version);
  return useSim((s) => s.engine);
}

/** Counts of people by what they are doing, for the status chips. */
function groupCounts(e: Engine) {
  const c = Object.fromEntries(GROUP_IDS.map((g) => [g, 0])) as Record<ActGroup, number>;
  for (const a of e.agents) if (a.present) c[ACTS[a.act].group]++;
  return c;
}

/** Clock, play controls, speed and the status chips over the views. */
export function SimBar() {
  const e = useEngine();
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const project = useProject((s) => s.project!);
  if (!e) return null;
  const counts = groupCounts(e);
  const present = e.agents.filter((a) => a.present).length;
  const ms = [...e.machines.values()];
  const running = ms.filter((m) => m.state === 'running').length;
  const down = ms.filter((m) => m.state === 'broken' || m.state === 'repair').length;
  const day0 = e.dayStart;
  const day1 = e.dayEnd;
  const brk = project.schedule.breaks.find((b) => e.t >= b.start && e.t < b.end);
  const phase = e.t < project.schedule.start ? 'ก่อนเข้างาน' : e.t >= project.schedule.end ? 'หลังเลิกงาน' : brk ? brk.label : 'เวลางาน';
  return (
    <div className="simbar glass" data-testid="simbar">
      <div className="sim-clock">
        <div className="time" data-testid="sim-clock">
          {fmtClock(e.t)}
        </div>
        <div className="phase">{phase}</div>
      </div>
      <div className="sim-ctl">
        <button className="ib big" onClick={() => useSim.getState().set({ playing: !playing })} aria-label={playing ? 'หยุด' : 'เล่น'} title={playing ? 'หยุดชั่วคราว (Space)' : 'เล่น (Space)'} data-testid="sim-play">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button className="ib" onClick={() => useSim.getState().start(project, useSim.getState().seed + 1)} title="เริ่มวันใหม่ (สุ่มเหตุการณ์ใหม่)" aria-label="เริ่มวันใหม่" data-testid="sim-reset">
          <Icon name="reset" />
        </button>
        <div className="seg sm" role="radiogroup" aria-label="ความเร็ว">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => useSim.getState().set({ speed: s })} data-testid={`speed-${s}`}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <input
        className="sim-scrub"
        type="range"
        min={day0}
        max={day1}
        step={1}
        value={Math.min(day1, e.t)}
        onChange={(ev) => useSim.getState().jumpTo(+ev.target.value)}
        aria-label="เลื่อนเวลา"
        style={{ ['--p' as string]: `${((e.t - day0) / (day1 - day0)) * 100}%` }}
      />
      {e.warnings().length > 0 && (
        <div className="sim-warn">
          {e.warnings().map((w) => (
            <span key={w}>⚠ {w}</span>
          ))}
        </div>
      )}
      <div className="chips">
        <span className="chip strong">
          <Icon name="users" /> {present} คน
        </span>
        {GROUP_IDS.map((g) => (
          <span key={g} className="chip" style={{ ['--c' as string]: GROUPS[g].color }} title={GROUPS[g].label}>
            <i />
            {GROUPS[g].label} {counts[g]}
          </span>
        ))}
        <span className="chip" style={{ ['--c' as string]: MACHINE_STATES.running.color }}>
          <Icon name="machine" /> เดิน {running}/{ms.length}
        </span>
        {down > 0 && (
          <span className="chip alert" style={{ ['--c' as string]: MACHINE_STATES.broken.color }}>
            เสีย {down}
          </span>
        )}
      </div>
    </div>
  );
}

type Tab = 'people' | 'machines' | 'events';

/** Right column in the simulation: everyone's whereabouts, the machines, and what happened. */
export function TrackingPanel() {
  const e = useEngine();
  const tab = useUi((s) => (s.selection?.kind === 'object' ? 'machines' : null));
  const [t, setT] = useState<Tab>('people');
  const shown = tab ?? t;
  const agent = useUi((s) => s.agent);
  if (!e) return null;
  return (
    <aside className="side-panel" data-testid="tracking">
      {agent ? (
        <PersonCard engine={e} id={agent} />
      ) : (
        <>
          <div className="tabs" role="tablist">
            {(
              [
                ['people', 'พนักงาน'],
                ['machines', 'เครื่องจักร'],
                ['events', 'เหตุการณ์'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={shown === id} className={shown === id ? 'on' : ''} onClick={() => (setT(id), useUi.getState().set({ selection: null }))}>
                {label}
              </button>
            ))}
          </div>
          {shown === 'people' && <PeopleList engine={e} />}
          {shown === 'machines' && <MachineList engine={e} />}
          {shown === 'events' && <EventList engine={e} />}
        </>
      )}
    </aside>
  );
}

function PeopleList({ engine }: { engine: Engine }) {
  const [filter, setFilter] = useState<string>('all');
  const roles = useMemo(() => [...new Set(engine.agents.map((a) => a.role))], [engine]);
  const list = engine.agents.filter((a) => filter === 'all' || a.role === filter);
  const order = (a: Agent) => (a.present ? 0 : a.done ? 2 : 1);
  return (
    <div className="panel-body tight">
      <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="กรองตามตำแหน่ง">
        <option value="all">ทุกตำแหน่ง ({engine.agents.length})</option>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r === 'customer' ? 'ลูกค้า' : ROLES[r as keyof typeof ROLES].label}
          </option>
        ))}
      </select>
      <div className="people">
        {[...list]
          .sort((a, b) => order(a) - order(b))
          .map((a) => (
            <button key={a.id} className={`person${a.present ? '' : ' away'}`} onClick={() => useUi.getState().set({ agent: a.id, selection: null })} data-testid={`person-${a.id}`}>
              <span className="avatar" style={{ background: a.color }}>
                {a.name.slice(0, 1)}
                <i style={{ background: a.present ? actColor(a.act) : '#cbd5e1' }} />
              </span>
              <span className="grow">
                <b>{a.name}</b> <small>{roleLabel(a)}</small>
                <span className="doing">{a.present ? a.label : a.done ? (a.kind === 'staff' ? 'ออกงานแล้ว' : 'กลับแล้ว') : `จะมา ~${fmtClock(a.arrival)}`}</span>
              </span>
              {a.present && <span className="where">{a.place.replace('→ ', '→')}</span>}
            </button>
          ))}
      </div>
    </div>
  );
}

const pct = (m: MachineSim) => {
  const on = m.totals.running + m.totals.idle + m.totals.broken + m.totals.repair;
  return on ? Math.round((m.totals.running / on) * 100) : 0;
};

function MachineList({ engine }: { engine: Engine }) {
  const sel = useUi((s) => (s.selection?.kind === 'object' ? s.selection.id : null));
  const ms = [...engine.machines.values()];
  return (
    <div className="panel-body tight">
      <div className="machines">
        {ms.map((m) => (
          <button key={m.obj.id} className={`machine-row${sel === m.obj.id ? ' on' : ''}`} onClick={() => useUi.getState().set({ selection: { kind: 'object', id: m.obj.id } })}>
            <span className="state-dot" style={{ background: MACHINE_STATES[m.state].color }} />
            <span className="grow">
              <b>{m.obj.name}</b>
              <small>
                {MACHINE_STATES[m.state].label}
                {m.operator ? ` · ${m.operator.name}` : ''}
                {m.tech && (m.state === 'repair' || m.state === 'broken') ? ` · ช่าง ${m.tech.name}` : ''}
              </small>
            </span>
            <span className="util">
              <b>{pct(m)}%</b>
              <small>ใช้งาน{m.breakdowns ? ` · เสีย ${m.breakdowns}` : ''}</small>
            </span>
          </button>
        ))}
      </div>
      {sel && engine.machines.get(sel as never) && <MachineDetail m={engine.machines.get(sel as never)!} />}
    </div>
  );
}

function MachineDetail({ m }: { m: MachineSim }) {
  const total = Object.values(m.totals).reduce((s, v) => s + v, 0) || 1;
  const root = useRef<HTMLDivElement>(null);
  // Picked on the plan or in 3D: bring the detail into view below the machine list.
  useEffect(() => {
    root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [m.obj.id]);
  return (
    <div className="machine-detail" ref={root}>
      <h5>{m.obj.name} วันนี้</h5>
      <div className="bar">
        {(Object.keys(m.totals) as (keyof typeof m.totals)[]).map((k) =>
          m.totals[k] > 0 ? <span key={k} style={{ width: `${(m.totals[k] / total) * 100}%`, background: MACHINE_STATES[k].color }} title={`${MACHINE_STATES[k].label} ${Math.round(m.totals[k])} นาที`} /> : null,
        )}
      </div>
      <ul className="legend">
        {(Object.keys(m.totals) as (keyof typeof m.totals)[]).map((k) => (
          <li key={k}>
            <i style={{ background: MACHINE_STATES[k].color }} />
            {MACHINE_STATES[k].label} <b>{Math.round(m.totals[k])}</b> นาที
          </li>
        ))}
      </ul>
      <MachineSpec assetId={m.obj.assetId} />
    </div>
  );
}

function EventList({ engine }: { engine: Engine }) {
  const [kind, setKind] = useState<'all' | 'machine'>('all');
  const evs = engine.events.filter((e) => kind === 'all' || e.kind === 'machine' || e.kind === 'repair').slice(-150).reverse();
  return (
    <div className="panel-body tight">
      <div className="seg sm">
        <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>
          ทั้งหมด
        </button>
        <button className={kind === 'machine' ? 'on' : ''} onClick={() => setKind('machine')}>
          เครื่องเสีย / ซ่อม
        </button>
      </div>
      <ol className="events">
        {evs.map((ev, i) => (
          <li key={i} className={`ev ev-${ev.kind}`} onClick={() => ev.agentId && useUi.getState().set({ agent: ev.agentId })}>
            <time>{fmtClock(ev.t)}</time>
            <span>{ev.text}</span>
          </li>
        ))}
        {!evs.length && <li className="muted">ยังไม่มีเหตุการณ์</li>}
      </ol>
    </div>
  );
}

/** One person: what they do now, where they go next, and their day so far. */
function PersonCard({ engine, id }: { engine: Engine; id: string }) {
  const a = engine.agents.find((x) => x.id === id);
  if (!a) return null;
  const next = engine.upcoming(a, 5);
  const byGroup = Object.fromEntries(GROUP_IDS.map((g) => [g, 0])) as Record<ActGroup, number>;
  for (const s of a.log) byGroup[ACTS[s.act].group] += s.t1 - s.t0;
  const total = Object.values(byGroup).reduce((s, v) => s + v, 0) || 1;
  const recent = a.log.slice(-8).reverse();
  return (
    <div className="person-card" data-testid="person-card">
      <div className="panel-head">
        <span className="avatar lg" style={{ background: a.color }}>
          {a.name.slice(0, 1)}
        </span>
        <div className="grow">
          <div className="panel-title">{a.name}</div>
          <div className="panel-sub">
            {roleLabel(a)}
            {a.station ? ` · ประจำ ${a.station.name}` : ''}
          </div>
        </div>
        <button className="ib" onClick={() => useUi.getState().set({ agent: null })} aria-label="ปิด" title="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">
        <div className="now" style={{ ['--c' as string]: actColor(a.act) }}>
          <span className="tag">{a.present ? ACTS[a.act].label : a.done ? 'ออกไปแล้ว' : 'ยังไม่มา'}</span>
          <b>{a.present ? a.label : a.done ? 'จบวัน' : `จะมาถึงราว ${fmtClock(a.arrival)}`}</b>
          {a.present && (
            <small>
              <Icon name="target" /> {a.place}
              {a.cur?.k === 'stay' && Number.isFinite(a.until) ? ` · ถึง ${fmtClock(a.until)}` : ''}
            </small>
          )}
        </div>
        {a.present && (
          <>
            <h5>ต่อไปจะ</h5>
            <ol className="next">
              {a.cur?.k === 'goto' && <li className="cur">{th('กำลังเดินไป', a.destLabel ?? '')}</li>}
              {next.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
            {engine.agenda(a).length > 0 && (
              <>
                <h5>ตารางที่เหลือวันนี้</h5>
                <ul className="agenda">
                  {engine.agenda(a).map((x, i) => (
                    <li key={i}>
                      <time>{fmtClock(x.t)}</time>
                      <span>{x.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <h5>สรุปวันนี้</h5>
        <div className="bar">
          {GROUP_IDS.map((g) => (byGroup[g] > 0 ? <span key={g} style={{ width: `${(byGroup[g] / total) * 100}%`, background: GROUPS[g].color }} title={`${GROUPS[g].label} ${Math.round(byGroup[g])} นาที`} /> : null))}
        </div>
        <div className="stats">
          <div>
            <b>{Math.round(byGroup.work)}</b>
            <span>นาทีทำงาน</span>
          </div>
          <div>
            <b>{Math.round(byGroup.rest)}</b>
            <span>นาทีพัก</span>
          </div>
          <div>
            <b>{Math.round(a.walked)} ม.</b>
            <span>เดินไป</span>
          </div>
        </div>
        <h5>ไทม์ไลน์ล่าสุด</h5>
        <ol className="history">
          {recent.map((s, i) => (
            <li key={i}>
              <time>{fmtClock(s.t0)}</time>
              <i style={{ background: actColor(s.act) }} />
              <span>
                {s.label}
                <small>{s.place}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="row gap">
          <button className={`btn btn-sm${useUi.getState().showPaths ? '' : ''}`} onClick={() => window.dispatchEvent(new CustomEvent('factory:focus', { detail: a.id }))}>
            <Icon name="target" /> ซูมไปหา
          </button>
          <FollowButton />
        </div>
      </div>
    </div>
  );
}

function FollowButton() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('factory:follow', { detail: on }));
  }, [on]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent('factory:follow', { detail: false })), []);
  return (
    <button className={`btn btn-sm${on ? ' btn-primary' : ''}`} onClick={() => setOn(!on)}>
      <Icon name="follow" /> {on ? 'กำลังติดตาม' : 'กล้องติดตาม'}
    </button>
  );
}

/** Everyone's day as rows of colored bars, with the current time marked. Drawn on a canvas, it redraws cheaply. */
export function Timeline() {
  const e = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const picked = useUi((s) => s.agent);
  const ROW = 16;
  const LEFT = 120;
  const rows = e ? e.agents.filter((a) => a.kind === 'staff' || a.present || a.done) : [];
  useEffect(() => {
    const c = ref.current;
    if (!c || !e) return;
    const w = wrap.current!.clientWidth;
    const h = rows.length * ROW + 22;
    const dpr = Math.min(2, window.devicePixelRatio);
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const t0 = e.dayStart;
    const t1 = e.dayEnd;
    const x = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * (w - LEFT - 8);
    ctx.font = '11px "IBM Plex Sans Thai", system-ui, sans-serif';
    // Hours and breaks.
    for (const b of e.project.schedule.breaks) {
      ctx.fillStyle = 'rgba(245,158,11,0.10)';
      ctx.fillRect(x(b.start), 0, x(b.end) - x(b.start), h);
    }
    ctx.fillStyle = '#94a3b8';
    for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 60) {
      ctx.fillRect(x(t), 0, 1, h - 16);
      ctx.fillText(fmtClock(t), x(t) - 14, h - 4);
    }
    rows.forEach((a, i) => {
      const y = i * ROW;
      if (a.id === picked) {
        ctx.fillStyle = 'rgba(37,99,235,0.10)';
        ctx.fillRect(0, y, w, ROW);
      }
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(10, y + ROW / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      ctx.fillText(a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name, 20, y + 13);
      for (const s of a.log) {
        if (s.label === 'กลับบ้านแล้ว' || s.label === 'ออกไปแล้ว') continue;
        const xa = x(s.t0);
        const xb = Math.max(xa + 1, x(s.t1));
        ctx.fillStyle = actColor(s.act);
        ctx.fillRect(xa, y + 4, xb - xa, ROW - 8);
      }
    });
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(x(e.t) - 1, 0, 2, h - 14);
  });
  if (!e) return null;
  return (
    <div className="timeline glass" ref={wrap} data-testid="timeline">
      <div className="tl-head">
        <b>ไทม์ไลน์ทั้งวัน</b>
        <span className="legend inline">
          {GROUP_IDS.map((g) => (
            <span key={g}>
              <i style={{ background: GROUPS[g].color }} /> {GROUPS[g].label}
            </span>
          ))}
        </span>
        <button className="ib sm" onClick={() => useUi.getState().set({ timeline: false })} aria-label="ซ่อนไทม์ไลน์">
          <Icon name="close" />
        </button>
      </div>
      <div className="tl-scroll">
        <canvas
          ref={ref}
          onClick={(ev) => {
            const r = (ev.target as HTMLCanvasElement).getBoundingClientRect();
            const row = Math.floor((ev.clientY - r.top) / ROW);
            const a = rows[row];
            if (a) useUi.getState().set({ agent: a.id });
          }}
        />
      </div>
    </div>
  );
}
