import { useMemo, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { boardOf, WIRE_COLOR, type Wire } from '../model/board';
import { isMachine } from '../model/catalog';
import type { Id, Project } from '../model/types';
import { PIPE_MATERIAL, utilitiesFor } from '../model/utilities';
import { airPlan, electricalPlan, REASON_LABEL, runSegments } from '../model/utilityCalc';
import { applyEdit, useProject } from '../store/project';
import { useUi, type Selection } from '../store/ui';

/** The five wires of a feeder as coloured bands, each with its size. */
function Wires({ wires, type }: { wires: Wire[]; type: string }) {
  if (!wires.length) return <p className="bd-none">ใหญ่เกินตาราง ต้องเดินสายขนาน</p>;
  return (
    <ul className="bd-wires" data-testid="board-wires">
      {wires.map((w) => (
        <li key={w.role}>
          <b>{w.role}</b>
          <i style={{ background: WIRE_COLOR[w.role].css }} />
          <span>
            {type} {w.mm2} ตร.มม.
          </span>
          <small>{WIRE_COLOR[w.role].name}</small>
        </li>
      ))}
    </ul>
  );
}

/** How a feeder's cable was sized, and the cable the building already has, checked against it. */
function FeederCheck({ project, id }: { project: Project; id: Id }) {
  const plan = useMemo(() => electricalPlan(project), [project]);
  const d = utilitiesFor(project).design;
  const line = plan.lines.find((l) => l.id === id);
  if (!line) return null;
  const o = project.objects.find((x) => x.id === id);
  const k = line.existing;
  return (
    <>
      <div className="adv-kv" data-testid="feeder-check">
        <span>เลือกสาย {line.mm2 ?? '–'} ตร.มม. ตาม</span>
        <b>{REASON_LABEL[line.reason]}</b>
        <span>รับกระแสได้ (ลดพิกัดแล้ว)</span>
        <b>
          {line.rated.toFixed(0)} A ≥ {line.breaker} A
        </b>
        <span>แรงดันตก ใช้งาน / สตาร์ท</span>
        <b>
          {line.drop.toFixed(1)}% / {line.startDrop.toFixed(1)}%
        </b>
      </div>
      <label className="adv-run">
        <span>สายเดิมที่มีอยู่</span>
        <select
          value={o?.cableMm2 ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value) || undefined;
            applyEdit((p) => {
              const x = p.objects.find((y) => y.id === id);
              if (x) x.cableMm2 = v;
            });
          }}
          aria-label="สายเดิมที่มีอยู่"
          data-testid="feeder-existing"
        >
          <option value="">ไม่มี เดินใหม่</option>
          {d.cables.map((c) => (
            <option key={c.mm2} value={c.mm2}>
              {c.mm2} ตร.มม.
            </option>
          ))}
        </select>
      </label>
      {k && (
        <ul className={k.problems.length ? 'adv-warn' : 'adv-ok'} data-testid="feeder-existing-result">
          {k.problems.length ? k.problems.map((t) => <li key={t}>{t}</li>) : <li>สายเดิมใช้ได้</li>}
        </ul>
      )}
    </>
  );
}

function BoardView({ project, onClose }: { project: Project; onClose: () => void }) {
  const board = useMemo(() => boardOf(project), [project]);
  const [picked, setPicked] = useState<Id | null>(null);
  const feeder = board.feeders.find((f) => f.id === picked);
  const bad = new Set(board.plan.lines.filter((l) => l.existing?.problems.length).map((l) => l.id));
  return (
    <>
      <div className="bd-head">
        <b>ตู้ MDB</b>
        <span className="muted">
          380V 3 เฟส · {board.plan.demand.toFixed(0)} kW · หม้อแปลง ≥ {board.plan.kva} kVA
        </span>
        <button className="ib sm" onClick={onClose} title="ปิด" aria-label="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <div className="bd-cabinet" data-testid="board-cabinet">
        <div className="bd-meters">
          <span className="bd-meter">V</span>
          <span className="bd-meter">A</span>
          <span className="bd-lamps">
            <i className="r" />
            <i className="s" />
            <i className="t" />
          </span>
        </div>
        <button className={`bd-main${picked ? '' : ' on'}`} onClick={() => setPicked(null)}>
          <span className="bd-toggle" />
          <b>{board.plan.breaker}A</b>
          <small>เมน 3P</small>
        </button>
        <div className="bd-bus">
          <i className="l1" />
          <i className="l2" />
          <i className="l3" />
          <i className="n" />
        </div>
        <div className="bd-row">
          {board.feeders.map((f) => (
            <button
              key={f.id}
              className={`bd-mccb${picked === f.id ? ' on' : ''}${bad.has(f.id) ? ' bad' : ''}`}
              onClick={() => setPicked(f.id)}
              title={f.name}
              data-testid="board-feeder"
            >
              <span className="bd-toggle" />
              <b>{f.breaker}A</b>
              <small>{f.name}</small>
              <span className="bd-tails">
                {f.wires.map((w) => (
                  <i key={w.role} style={{ background: WIRE_COLOR[w.role].css }} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <div className="bd-pe" title="บาร์กราวด์" />
      </div>
      <h5 className="adv-h">{feeder ? `${feeder.name} · ${feeder.amps.toFixed(1)} A · ${Math.round(feeder.metres)} ม.${feeder.drawn ? '' : ' (ประมาณ)'}` : 'สายเมนเข้าตู้'}</h5>
      <Wires wires={feeder ? feeder.wires : board.mainWires} type={board.cableType} />
      {feeder ? (
        <FeederCheck project={project} id={feeder.id} />
      ) : (
        <div className="adv-kv">
          <span>หม้อแปลงถึงตู้</span>
          <b>{utilitiesFor(project).design.mainRun} ม. · ตก {board.plan.mainDrop.toFixed(1)}%</b>
          <span>สายป้อนวางรวม {board.feeders.length} วงจร</span>
          <b>ลดพิกัด × {board.plan.group.toFixed(2)}</b>
        </div>
      )}
      <h5 className="adv-h">ของที่ต้องใช้</h5>
      <table className="adv-table" data-testid="board-bom">
        <tbody>
          {board.breakers.map((b) => (
            <tr key={b.amps}>
              <td>เบรกเกอร์ 3P {b.amps}A</td>
              <td>× {b.qty}</td>
            </tr>
          ))}
          {board.cable.map((c) => (
            <tr key={c.mm2}>
              <td>
                สาย {board.cableType} {c.mm2} ตร.มม.
              </td>
              <td>{c.metres} ม.</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AirView({ project, onClose }: { project: Project; onClose: () => void }) {
  const air = useMemo(() => airPlan(project), [project]);
  const d = utilitiesFor(project).design;
  const look = PIPE_MATERIAL[air.material];
  const far = air.branches.find((b) => b.name === air.worst) ?? air.branches[0];
  // The pressure step by step from the pump to the machine that sets it.
  const steps: [string, string][] = [
    ['ปั๊มลม', `${air.setPressure.toFixed(2)}`],
    ['Dryer', `−${d.dryerDropBar.toFixed(2)}`],
    [`Filter × ${d.filters}`, `−${(d.filterDropBar * d.filters).toFixed(2)}`],
    [`ท่อเมน ${look.label} ${air.main?.label ?? ''}`, `−${(far?.mainDrop ?? 0).toFixed(3)}`],
    [`ท่อแยก ${far?.pipe?.label ?? ''}`, `−${(far?.branchDrop ?? 0).toFixed(3)}`],
    [far?.name ?? 'เครื่อง', `${(far?.at ?? 0).toFixed(2)}`],
  ];
  return (
    <>
      <div className="bd-head">
        <b>ระบบลมอัด</b>
        <span className="muted">
          ตั้งปั๊ม {air.setPressure.toFixed(1)} บาร์ · ใช้ลม {(air.needed / 1000).toFixed(2)} m³/นาที
        </span>
        <button className="ib sm" onClick={onClose} title="ปิด" aria-label="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <ol className="bd-ladder" data-testid="air-chain">
        {steps.map(([name, bar], i) => (
          <li key={i} className={i === 0 || i === steps.length - 1 ? 'end' : undefined}>
            <span className="adv-cut">{name}</span>
            <b>{bar}</b>
          </li>
        ))}
      </ol>
      <div className="adv-kv">
        <span>ความยาวถึงเครื่องไกลสุด</span>
        <b>
          {Math.round(air.mainLength)} ม.{air.drawn ? '' : ' (ประมาณ)'}
        </b>
        <span>ความเร็วลมในท่อเมน</span>
        <b>{air.mainSpeed.toFixed(1)} ม./วิ</b>
        <span>ลมที่ปั๊มให้ได้</span>
        <b className={air.have < air.needed ? 'adv-bad-text' : undefined}>{(air.have / 1000).toFixed(2)} m³/นาที</b>
      </div>
      {air.tooSmall && (
        <ul className="adv-warn">
          <li>
            ท่อเมน {air.main?.label} เล็กไป ควรใช้ {air.suggested?.label ?? 'ใหญ่กว่าในตาราง'}
          </li>
        </ul>
      )}
      <table className="adv-table">
        <thead>
          <tr>
            <th>ท่อแยก</th>
            <th>L/นาที</th>
            <th>ขนาด</th>
            <th>บาร์</th>
          </tr>
        </thead>
        <tbody>
          {air.branches.map((b) => (
            <tr key={b.id}>
              <td className="adv-cut">{b.name}</td>
              <td>{b.lpm}</td>
              <td>{b.pipe?.label ?? '–'}</td>
              <td title={`ต้องการ ${b.want} บาร์`}>{b.at.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A cable or pipe run picked: what each stretch carries, the one clicked first. */
function RunView({ project, sel, onClose }: { project: Project; sel: Extract<Selection, { kind: 'run' }>; onClose: () => void }) {
  const run = project.runs?.find((r) => r.id === sel.id);
  const segs = useMemo(() => runSegments(project, sel.id), [project, sel.id]);
  const air = useMemo(() => (run?.kind === 'air' ? airPlan(project) : null), [project, run?.kind]);
  if (!run || !segs) return null;
  const pick = (seg: number) => useUi.getState().set({ selection: { kind: 'run', id: run.id, seg } });
  const g = segs[sel.seg ?? sel.node ?? 0] ?? segs[0];
  const total = segs.reduce((t, x) => t + x.metres, 0);
  const bends = segs.reduce((t, x) => t + x.bends, 0);
  const title = run.kind === 'air' ? `ท่อลม ${PIPE_MATERIAL[air!.material].label} ${g.pipe ?? ''}` : run.kind === 'power' ? 'รางสายไฟ' : 'ท่อดูดฝุ่น';
  const remove = (node?: number) =>
    applyEdit((d) => {
      const r = d.runs?.find((x) => x.id === run.id);
      if (r && node !== undefined && r.points.length > 2) r.points.splice(node, 1);
      else d.runs = (d.runs ?? []).filter((x) => x.id !== run.id);
    });
  return (
    <>
      <div className="bd-head">
        <b>{title}</b>
        <span className="muted">
          {total.toFixed(1)} ม. · {run.points.length} จุด{bends ? ` · หลบเสา ${bends} ข้องอ` : ''}
        </span>
        <button className="ib sm" onClick={onClose} title="ปิด" aria-label="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <h5 className="adv-h">
        ช่วงที่ {g.seg + 1} · {g.metres.toFixed(1)} ม.
      </h5>
      {!g.serves.length ? (
        <p className="muted bd-note">{run.kind === 'dust' ? 'ท่อดูดฝุ่นยังไม่คิดลมทีละช่วง' : `ยังไม่ต่อถึง${run.kind === 'power' ? 'ตู้ MDB' : 'ปั๊มลม'}`}</p>
      ) : run.kind === 'air' ? (
        <div className="adv-kv" data-testid="run-flow">
          <span>ลมผ่าน</span>
          <b>{Math.round(g.lpm)} L/นาที</b>
          <span>ความเร็วลม</span>
          <b className={g.speed > utilitiesFor(project).design.pipeVelocity ? 'adv-bad-text' : undefined}>{g.speed.toFixed(1)} ม./วิ</b>
          <span>ตกในช่วงนี้</span>
          <b>{g.drop.toFixed(3)} บาร์</b>
          <span>แรงดันปลายช่วง</span>
          <b>{g.at !== null ? `${g.at.toFixed(2)} บาร์` : '–'}</b>
          <span>ไปถึง</span>
          <b className="adv-cut">{g.serves.map((x) => x.name).join(', ')}</b>
        </div>
      ) : (
        <>
          <div className="adv-kv" data-testid="run-flow">
            <span>กระแสรวม</span>
            <b>{g.amps.toFixed(1)} A</b>
            <span>วงจรบนราง</span>
            <b>{g.cables.length}</b>
          </div>
          <table className="adv-table">
            <thead>
              <tr>
                <th>เครื่อง</th>
                <th>A</th>
                <th>เบรกเกอร์</th>
                <th>สาย</th>
              </tr>
            </thead>
            <tbody>
              {g.cables.map((c) => (
                <tr key={c.name}>
                  <td className="adv-cut">{c.name}</td>
                  <td>{c.amps.toFixed(1)}</td>
                  <td>{c.breaker}</td>
                  <td>{c.mm2 ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {segs.length > 1 && (
        <table className="adv-table bd-segs" data-testid="run-segs">
          <thead>
            <tr>
              <th>ช่วง</th>
              <th>ม.</th>
              <th>{run.kind === 'power' ? 'A' : 'L/นาที'}</th>
            </tr>
          </thead>
          <tbody>
            {segs.map((x) => (
              <tr key={x.seg} className={x.seg === g.seg ? 'on' : undefined} onClick={() => pick(x.seg)}>
                <td>{x.seg + 1}</td>
                <td>{x.metres.toFixed(1)}</td>
                <td>{!x.serves.length ? '–' : run.kind === 'power' ? x.amps.toFixed(0) : Math.round(x.lpm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!useUi.getState().customer && (
        <div className="bd-actions">
          {sel.node !== undefined && run.points.length > 2 && (
            <button className="btn btn-sm" onClick={() => remove(sel.node)} data-testid="run-remove-node">
              ลบจุดนี้
            </button>
          )}
          <button className="btn btn-sm btn-danger" onClick={() => (remove(), onClose())} data-testid="run-remove">
            ลบเส้นนี้
          </button>
        </div>
      )}
    </>
  );
}

/** What is behind the thing picked: the main board's breakers and wires, the air system at the compressor, or a run. */
export function BoardCard() {
  const project = useProject((s) => s.project!);
  const selection = useUi((s) => s.selection);
  const o = selection?.kind === 'object' ? project.objects.find((x) => x.id === selection.id) : undefined;
  const kind = selection?.kind === 'run' ? 'run' : o?.assetId === 'mdb' ? 'board' : o && isMachine(o) && o.assetId.startsWith('vair') ? 'air' : null;
  if (!kind) return null;
  const close = () => useUi.getState().set({ selection: null });
  return (
    <aside className="board-card glass" data-testid={kind === 'run' ? 'run-card' : 'board-card'}>
      {kind === 'run' ? (
        <RunView project={project} sel={selection as Extract<Selection, { kind: 'run' }>} onClose={close} />
      ) : kind === 'board' ? (
        <BoardView project={project} onClose={close} />
      ) : (
        <AirView project={project} onClose={close} />
      )}
    </aside>
  );
}
