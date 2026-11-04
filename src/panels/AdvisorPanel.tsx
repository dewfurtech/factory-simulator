import { useMemo, useState } from 'react';
import { Icon, setTool } from '../editor2d/Toolbar';
import { EMPTY_ENTRY } from '../editor2d/entry';
import { catalogItem } from '../model/catalog';
import { deliveryFor } from '../model/delivery';
import { newId } from '../model/id';
import { fmtBaht, quoteOf } from '../model/quote';
import { flowMachines, routeOf } from '../model/route';
import { scoreFor, SCORE_LABEL, type ScoreCard, type ScoreKey } from '../model/score';
import { prepSheet } from '../model/prepSheet';
import { sitePrepOf } from '../model/sitePrep';
import { autoStage, stagingFor } from '../model/staging';
import type { Id, PipeMaterial, Project, UtilityKind } from '../model/types';
import { RUN_COLOR, RUN_LABEL, runLength, runsOf } from '../model/utilityRuns';
import { PIPE_MATERIAL, pipeTable, utilitiesFor } from '../model/utilities';
import { airPlan, dustPlan, electricalPlan, REASON_LABEL } from '../model/utilityCalc';
import { applyEdit, useProject } from '../store/project';
import { useUi, type SummaryTab, type SystemTab } from '../store/ui';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { PrepBlock, PrepPreview } from './PrepPreview';
import { QuoteCard } from './QuoteCard';

/**
 * The two steps after the machines are placed. Systems: the work's way through them, then power, air and dust, each
 * drawn and sized. Summary: how the layout scores, what the customer has to prepare, whether the machines can be
 * brought in, and other arrangements to compare. Each page has the plan draw what it is about.
 */

const SYSTEM_TABS: { id: SystemTab; label: string }[] = [
  { id: 'route', label: 'โฟลว์งาน' },
  { id: 'power', label: 'ไฟฟ้า' },
  { id: 'air', label: 'ลม' },
  { id: 'dust', label: 'ฝุ่น' },
];
const SUMMARY_TABS: { id: SummaryTab; label: string }[] = [
  { id: 'score', label: 'ภาพรวม' },
  { id: 'prep', label: 'เตรียมงาน' },
  { id: 'delivery', label: 'ขนเข้า' },
  { id: 'compare', label: 'เทียบผัง' },
];

const m = (mm: number) => `${(mm / 1000).toFixed(1)} ม.`;
const nameOf = (p: Project, id: Id) => p.objects.find((o) => o.id === id)?.name ?? 'เครื่อง';
const goTo = (id: Id) => useUi.getState().goTo({ kind: 'object', id });

function Tabs<T extends string>({ tabs, value, onPick }: { tabs: { id: T; label: string }[]; value: T; onPick: (id: T) => void }) {
  return (
    <div className="adv-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onPick(t.id)} data-testid={`adv-tab-${t.id}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SystemsPanel() {
  const project = useProject((s) => s.project!);
  const tab = useUi((s) => s.systemTab);
  return (
    <div className="dock-body" data-testid="systems">
      <h3 className="dock-title">งานระบบ</h3>
      <Tabs tabs={SYSTEM_TABS} value={tab} onPick={(systemTab) => useUi.getState().set({ systemTab })} />
      <div className="dock-scroll adv-scroll">
        {tab === 'route' && (
          <>
            <RoutePage project={project} />
            <StagingPage project={project} />
          </>
        )}
        {tab === 'power' && <PowerPage project={project} />}
        {tab === 'air' && <AirPage project={project} />}
        {tab === 'dust' && <DustPage project={project} />}
      </div>
    </div>
  );
}

export function SummaryPanel() {
  const project = useProject((s) => s.project!);
  const tab = useUi((s) => s.summaryTab);
  return (
    <div className="dock-body" data-testid="summary">
      <h3 className="dock-title">สรุป</h3>
      <Tabs tabs={SUMMARY_TABS} value={tab} onPick={(summaryTab) => useUi.getState().set({ summaryTab })} />
      <div className="dock-scroll adv-scroll">
        {tab === 'score' && <ScorePage project={project} />}
        {tab === 'prep' && <PrepPage project={project} />}
        {tab === 'delivery' && <DeliveryPage project={project} />}
        {tab === 'compare' && <ComparePage project={project} />}
      </div>
    </div>
  );
}

function Grade({ card }: { card: ScoreCard }) {
  return (
    <div className={`adv-grade g-${card.grade}`} data-testid="adv-grade">
      <div className="adv-grade-letter">{card.grade}</div>
      <div>
        <div className="adv-grade-total">{card.total} / 100</div>
      </div>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  const tone = value >= 80 ? 'ok' : value >= 55 ? 'mid' : 'bad';
  return (
    <div className="adv-bar" aria-hidden>
      <div className={`adv-bar-fill ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function ScorePage({ project }: { project: Project }) {
  const card = scoreFor(project);
  if (card.empty)
    return (
      <>
        <div className="adv-empty">
          <p>ยังไม่มีเครื่องในผัง</p>
        </div>
        <QuoteCard />
      </>
    );
  return (
    <>
      <QuoteCard />
      <Grade card={card} />
      <ul className="adv-parts">
        {card.parts.map((p) => (
          <li key={p.key}>
            <button onClick={() => openPage(p.key)} title={p.note}>
              <span className="adv-part-label">{p.label}</span>
              <span className="adv-part-score">{p.score}</span>
              <Bar value={p.score} />
            </button>
          </li>
        ))}
      </ul>
      {card.tips.length > 0 && (
        <>
          <h5 className="adv-h">ควรแก้</h5>
          <ol className="adv-tips" data-testid="adv-tips">
            {card.tips.map((t, i) => (
              <li key={i}>
                {t.id ? (
                  <button className="adv-link" onClick={() => goTo(t.id!)}>
                    {t.text}
                  </button>
                ) : (
                  t.text
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/** From a line of the score to the page that fixes it. */
function openPage(key: ScoreKey) {
  const set = useUi.getState().set;
  if (key === 'flow' || key === 'staging') set({ dock: 'systems', systemTab: 'route' });
  if (key === 'delivery') set({ summaryTab: 'delivery' });
}

function RoutePage({ project }: { project: Project }) {
  const route = routeOf(project);
  const off = flowMachines(project).filter((o) => !route.ids.includes(o.id));
  const setRoute = (ids: Id[] | undefined) => applyEdit((d) => void (ids ? (d.route = ids) : delete d.route));
  const move = (i: number, by: number) => {
    const ids = [...route.ids];
    const [x] = ids.splice(i, 1);
    ids.splice(i + by, 0, x);
    setRoute(ids);
  };
  if (route.ids.length < 2)
    return (
      <div className="adv-empty">
        <p>ต้องมีอย่างน้อย 2 เครื่อง</p>
      </div>
    );
  return (
    <>
      <div className="adv-stat" data-testid="route-total">
        <b>{m(route.total)}</b>
        <span>งานวิ่งรวม</span>
      </div>
      {route.warnings.length > 0 && (
        <ul className="adv-warn" data-testid="route-warnings">
          {route.warnings.map((w, i) => (
            <li key={i}>{w.text}</li>
          ))}
        </ul>
      )}
      <h5 className="adv-h">ลำดับงาน</h5>
      <button className="btn btn-sm" onClick={() => setTool({ kind: 'pickRoute', started: false })} data-testid="tool-pick-route">
        คลิกเครื่องบนผังตามลำดับ
      </button>
      <ol className="adv-steps" data-testid="route-steps">
        {route.ids.map((id, i) => (
          <li key={id}>
            <span className="adv-step-no">{i + 1}</span>
            <button className="adv-link" onClick={() => goTo(id)}>
              {nameOf(project, id)}
            </button>
            {i > 0 && <small className="muted">{m(route.legs[i - 1].length)}</small>}
            <span className="adv-step-btns">
              <button className="ib sm" disabled={i === 0} onClick={() => move(i, -1)} title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น">
                <Icon name="chevronUp" />
              </button>
              <button className="ib sm" disabled={i === route.ids.length - 1} onClick={() => move(i, 1)} title="เลื่อนลง" aria-label="เลื่อนลง">
                <Icon name="chevronDown" />
              </button>
              <button className="ib sm" onClick={() => setRoute(route.ids.filter((x) => x !== id))} title="เอาออกจากเส้นทาง" aria-label="เอาออกจากเส้นทาง">
                <Icon name="close" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {off.length > 0 && (
        <div className="adv-off">
          {off.map((o) => (
            <button key={o.id} className="btn btn-sm" onClick={() => setRoute([...route.ids, o.id])}>
              + {o.name}
            </button>
          ))}
        </div>
      )}
      {!route.suggested && (
        <button className="btn btn-sm" onClick={() => setRoute(undefined)} data-testid="route-auto">
          เรียงอัตโนมัติ
        </button>
      )}
    </>
  );
}

function StagingPage({ project }: { project: Project }) {
  const stages = stagingFor(project);
  const blocked = stages.filter((s) => s.blockedBy);
  const canAdd = useMemo(() => autoStage(project).length, [project]);
  const kind = { in: 'ด้านเข้า', out: 'ด้านออก', both: 'หน้าเครื่อง' } as const;
  if (!stages.length) return null;
  return (
    <>
      <h5 className="adv-h">ที่วางงาน</h5>
      <div className="adv-stat">
        <b>
          {stages.length - blocked.length} / {stages.length}
        </b>
        <span>จุดวางงานว่าง</span>
      </div>
      {blocked.length > 0 && (
        <ul className="adv-warn" data-testid="staging-blocked">
          {blocked.map((s, i) => (
            <li key={i}>
              <button className="adv-link" onClick={() => goTo(s.machineId)}>
                {nameOf(project, s.machineId)}
              </button>{' '}
              {kind[s.kind]} ติด{s.blockedBy}
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-primary btn-sm" disabled={!canAdd} onClick={() => applyEdit((d) => void d.objects.push(...autoStage(d)))} data-testid="auto-stage">
        วางพาเลท / รถเข็นอัตโนมัติ
      </button>
    </>
  );
}

function DeliveryPage({ project }: { project: Project }) {
  const list = deliveryFor(project);
  const focus = useUi((s) => s.deliveryFocus);
  if (!list.length)
    return (
      <div className="adv-empty">
        <p>ยังไม่มีเครื่องในผัง</p>
      </div>
    );
  const icon = { ok: '✓', door: '✕', path: '✕', nodoor: '!', noplan: '!' } as const;
  return (
    <>
      <ul className="adv-deliv" data-testid="delivery-list">
        {list.map((d) => (
          <li key={d.id} className={`${d.status === 'ok' ? (d.tight ? 'mid' : 'ok') : 'bad'}${focus === d.id ? ' on' : ''}`}>
            <button
              onClick={() => {
                useUi.getState().set({ deliveryFocus: focus === d.id ? null : d.id });
                goTo(d.id);
              }}
            >
              <span className="adv-deliv-icon">{icon[d.status]}</span>
              <b>{d.name}</b>
              {d.text && <span>{d.text}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty() {
  return (
    <div className="adv-empty">
      <p>ยังไม่มีเครื่องในผัง</p>
    </div>
  );
}

/** One system's line on the plan: the way to draw more, how much there is, and the way to take it away. */
function RunRow({ project, kind }: { project: Project; kind: UtilityKind }) {
  const runs = runsOf(project, kind);
  const color = kind === 'air' ? PIPE_MATERIAL[project.airPipe ?? 'aluminium'].color : RUN_COLOR[kind];
  return (
    <div className="adv-run" data-testid="run-tools">
      <i style={{ background: color }} />
      <button className="btn btn-sm" onClick={() => setTool({ kind: 'drawRun', run: kind, points: [], entry: EMPTY_ENTRY })} data-testid={`draw-${kind}`}>
        วาด{RUN_LABEL[kind]}
      </button>
      <small className="muted">{runs.length ? `${(runLength(runs) / 1000).toFixed(1)} ม.` : ''}</small>
      {runs.length > 0 && (
        <button
          className="ib sm"
          onClick={() => applyEdit((d) => void (d.runs = (d.runs ?? []).filter((r) => r.kind !== kind)))}
          title={`ลบ${RUN_LABEL[kind]}ทั้งหมด`}
          aria-label={`ลบ${RUN_LABEL[kind]}ทั้งหมด`}
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

function PowerPage({ project }: { project: Project }) {
  const customer = useUi((s) => !!s.customer);
  const power = useMemo(() => electricalPlan(project), [project]);
  const d = utilitiesFor(project).design;
  if (!power.lines.length) return <Empty />;
  const board = project.objects.find((o) => o.assetId === 'mdb');
  const bad = power.lines.filter((l) => l.existing?.problems.length);
  return (
    <>
      <div className="adv-kpis">
        <div>
          <b>{power.demand.toFixed(0)} kW</b>
          <span>ไฟใช้งาน</span>
        </div>
        <div>
          <b>{power.breaker} A</b>
          <span>เบรกเกอร์เมน</span>
        </div>
      </div>
      <div className="adv-kv" data-testid="power-main">
        <span>สายเมน</span>
        <b>{power.mainMm2 ? `${d.cableType} ${power.mainMm2} ตร.มม.` : 'ต้องเดินสายขนาน'}</b>
        <span>หม้อแปลง</span>
        <b>≥ {power.kva} kVA</b>
        <span>แรงดันตก เมน / รวม</span>
        <b>
          {power.mainDrop.toFixed(1)}% / ≤ {d.totalDropPct}%
        </b>
        <span>สายวางรวม {power.lines.length} วงจร</span>
        <b>ลดพิกัด × {power.group.toFixed(2)}</b>
      </div>
      {bad.length > 0 && (
        <ul className="adv-warn" data-testid="power-existing">
          {bad.map((l) => (
            <li key={l.id}>
              {l.name} สายเดิม {l.existing!.mm2} ตร.มม. เล็กไป ใช้ {l.mm2 ?? '–'}
            </li>
          ))}
        </ul>
      )}
      {!customer &&
        (board ? (
          <button className="btn btn-sm" onClick={() => useUi.getState().set({ selection: { kind: 'object', id: board.id } })} data-testid="open-mdb">
            ดูตู้ MDB
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setTool({ kind: 'placeObject', assetId: 'mdb' })} data-testid="place-mdb">
            วางตู้ MDB บนผัง
          </button>
        ))}
      {!customer && <RunRow project={project} kind="power" />}
      <table className="adv-table" data-testid="power-table">
        <thead>
          <tr>
            <th>เครื่อง</th>
            <th>A</th>
            <th>เบรกเกอร์</th>
            <th>สาย</th>
            <th>%ตก</th>
            <th>ม.</th>
          </tr>
        </thead>
        <tbody>
          {power.lines.map((l) => (
            <tr key={l.id} className={l.existing?.problems.length ? 'adv-bad' : undefined}>
              <td className="adv-cut">{l.name}</td>
              <td>{l.amps.toFixed(1)}</td>
              <td>{l.breaker}</td>
              <td title={`เลือกตาม${REASON_LABEL[l.reason]} · รับได้ ${l.rated.toFixed(0)}A`} className={l.reason !== 'current' ? 'adv-up' : undefined}>
                {l.mm2 ?? 'เกินตาราง'}
              </td>
              <td>{l.drop.toFixed(1)}</td>
              <td className={l.drawn ? 'adv-drawn' : undefined}>{Math.round(l.length)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AirPage({ project }: { project: Project }) {
  const customer = useUi((s) => !!s.customer);
  const air = useMemo(() => airPlan(project), [project]);
  const prep = useMemo(() => sitePrepOf(project), [project]);
  if (air.used <= 0) return <Empty />;
  const want = prep.compressor;
  return (
    <>
      <div className="adv-kpis">
        <div>
          <b>{(air.needed / 1000).toFixed(2)}</b>
          <span>ลมอัด m³/นาที</span>
        </div>
        <div>
          <b>{air.setPressure.toFixed(1)} บาร์</b>
          <span>ตั้งปั๊ม</span>
        </div>
      </div>
      {!customer && want && (
        <button className="btn btn-primary btn-sm" onClick={() => setTool({ kind: 'placeObject', assetId: want.id })} data-testid="place-compressor">
          วางปั๊มลม {want.id === 'vair-10' ? 'VAir 10HP' : 'VAir 20HP'}
          {want.count > 1 ? ` × ${want.count}` : ''}
        </button>
      )}
      {!customer && (
        <label className="adv-run">
          <span>วัสดุท่อ</span>
          <select
            value={project.airPipe ?? 'aluminium'}
            onChange={(e) => applyEdit((d) => void (d.airPipe = e.target.value as PipeMaterial))}
            aria-label="วัสดุท่อลม"
            data-testid="air-material"
          >
            {(Object.keys(PIPE_MATERIAL) as PipeMaterial[]).map((k) => (
              <option key={k} value={k}>
                {PIPE_MATERIAL[k].label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!customer && (
        <label className="adv-run">
          <span>ท่อเมนเดิม</span>
          <select
            value={project.airMain ?? ''}
            onChange={(e) => applyEdit((d) => void (d.airMain = e.target.value || undefined))}
            aria-label="ท่อเมนที่มีอยู่"
            data-testid="air-existing"
          >
            <option value="">ไม่มี เดินใหม่</option>
            {pipeTable(utilitiesFor(project).design, air.material).map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!customer && <RunRow project={project} kind="air" />}
      <div className="adv-kv" data-testid="air-main">
        <span>ท่อเมน</span>
        <b>
          {PIPE_MATERIAL[air.material].label} {air.main?.label ?? 'เกินตาราง'} · {Math.round(air.mainLength)} ม.{air.drawn ? '' : ' (ประมาณ)'}
        </b>
        <span>ตก dryer + filter</span>
        <b>{air.treatment.toFixed(2)} บาร์</b>
        <span>ตกในท่อเมน สูงสุด</span>
        <b>
          {air.mainDrop.toFixed(3)} บาร์ · {air.mainSpeed.toFixed(1)} ม./วิ
        </b>
        <span>เครื่องที่กำหนดแรงดัน</span>
        <b className="adv-cut">{air.worst}</b>
      </div>
      {air.tooSmall && (
        <ul className="adv-warn" data-testid="air-small">
          <li>
            ท่อเมน {air.main?.label} เล็กไป ควรใช้ {air.suggested?.label ?? 'ใหญ่กว่าในตาราง'}
          </li>
        </ul>
      )}
      {air.unreached.length > 0 && (
        <ul className="adv-warn" data-testid="air-unreached">
          <li>ท่อยังไม่ถึง {air.unreached.join(', ')}</li>
        </ul>
      )}
      {air.short && (
        <ul className="adv-warn" data-testid="air-short">
          <li>
            {air.wantedBy} ต้องการ {air.wanted} บาร์ ปั๊มตั้งได้ไม่ถึง
          </li>
        </ul>
      )}
      <table className="adv-table" data-testid="air-table">
        <thead>
          <tr>
            <th>เครื่อง</th>
            <th>L/นาที</th>
            <th>ท่อแยก</th>
            <th>ตก</th>
            <th>ถึงเครื่อง</th>
          </tr>
        </thead>
        <tbody>
          {air.branches.map((b) => (
            <tr key={b.id}>
              <td className="adv-cut">{b.name}</td>
              <td>{b.lpm}</td>
              <td>{b.pipe?.label ?? '–'}</td>
              <td>{(b.mainDrop + b.branchDrop).toFixed(2)}</td>
              <td title={`ต้องการ ${b.want} บาร์`}>{b.at.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DustPage({ project }: { project: Project }) {
  const customer = useUi((s) => !!s.customer);
  const dust = useMemo(() => dustPlan(project), [project]);
  if (dust.total <= 0) return <Empty />;
  return (
    <>
      <div className="adv-kpis">
        <div>
          <b>{Math.round(dust.demand / 100) * 100}</b>
          <span>ดูดฝุ่น m³/ชม.</span>
        </div>
        <div>
          <b>{dust.main ? `Ø${dust.main}` : 'เกินตาราง'}</b>
          <span>ท่อเมน มม.</span>
        </div>
      </div>
      {!customer && <RunRow project={project} kind="dust" />}
      <table className="adv-table" data-testid="dust-table">
        <thead>
          <tr>
            <th>เครื่อง</th>
            <th>m³/ชม.</th>
            <th>ท่อ</th>
          </tr>
        </thead>
        <tbody>
          {dust.lines.map((l) => (
            <tr key={l.id}>
              <td className="adv-cut">{l.name}</td>
              <td>{l.m3h}</td>
              <td>{l.duct ? `Ø${l.duct}` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Everything the customer has to have ready, trade by trade, and the sheet to hand them. */
function PrepPage({ project }: { project: Project }) {
  const sections = useMemo(() => prepSheet(project), [project]);
  const [sheet, setSheet] = useState(false);
  if (!sections.length) return <Empty />;
  return (
    <>
      <button className="btn btn-primary btn-sm" onClick={() => setSheet(true)} data-testid="open-prep">
        <Icon name="doc" />
        เอกสารเตรียมหน้างาน
      </button>
      {sections.map((s) => (
        <section key={s.id} className="prep-part" data-testid={`prep-${s.id}`}>
          <h5 className="adv-h">{s.title}</h5>
          <PrepBlock section={s} />
        </section>
      ))}
      {sheet && <PrepPreview project={project} onClose={() => setSheet(false)} />}
    </>
  );
}

/** The project as it would be with a saved arrangement on the plan: for scoring and pricing it. */
const withVariant = (p: Project, objects: Project['objects'], route: Id[] | undefined): Project => ({ ...p, objects, route });

function ComparePage({ project }: { project: Project }) {
  const variants = project.variants ?? [];
  const rows = useMemo(
    () => [{ id: null as Id | null, name: 'ผังปัจจุบัน', p: project }, ...variants.map((v) => ({ id: v.id, name: v.name, p: withVariant(project, v.objects, v.route) }))],
    [project, variants],
  );
  const save = async () => {
    const name = await promptDialog({ title: 'บันทึกผังนี้เป็นแบบ', label: 'ชื่อแบบ', value: `แบบ ${String.fromCharCode(65 + variants.length)}`, ok: 'บันทึก' });
    if (!name) return;
    // Copied from the project as it stands, not from the edit's draft, which cannot be cloned.
    const now = useProject.getState().project!;
    const objects = structuredClone(now.objects);
    const route = now.route && [...now.route];
    applyEdit((d) => void (d.variants ??= []).push({ id: newId('v'), name, savedAt: Date.now(), objects, route }));
  };
  const load = async (id: Id) => {
    const v = variants.find((x) => x.id === id)!;
    const ok = await confirmDialog({
      title: `เปิด "${v.name}" บนผัง`,
      message: 'เครื่องบนผังตอนนี้จะถูกแทนด้วยแบบนี้ ถ้ายังไม่ได้บันทึกผังปัจจุบันเป็นแบบไว้ กด "เลิกทำ" ย้อนกลับได้',
      ok: 'เปิดแบบนี้',
    });
    if (!ok) return;
    applyEdit((d) => {
      d.objects = structuredClone(v.objects);
      if (v.route) d.route = [...v.route];
      else delete d.route;
    });
  };
  const remove = async (id: Id) => {
    const v = variants.find((x) => x.id === id)!;
    if (!(await confirmDialog({ title: `ลบ "${v.name}"`, ok: 'ลบ', danger: true }))) return;
    applyEdit((d) => void (d.variants = d.variants!.filter((x) => x.id !== id)));
  };
  return (
    <>
      <button className="btn btn-primary btn-sm" onClick={() => void save()} data-testid="variant-save">
        <Icon name="copy" />
        บันทึกเป็นแบบใหม่
      </button>
      <div className="adv-compare-wrap">
        <table className="adv-table adv-compare" data-testid="variant-table">
          <thead>
            <tr>
              <th />
              {rows.map((r) => (
                <th key={r.id ?? 'now'}>{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>คะแนนรวม</td>
              {rows.map((r) => {
                const c = scoreFor(r.p);
                return <td key={r.id ?? 'now'}>{c.empty ? '–' : <b className={`g-${c.grade}`}>{`${c.grade} · ${c.total}`}</b>}</td>;
              })}
            </tr>
            {(Object.keys(SCORE_LABEL) as ScoreKey[]).map((k) => (
              <tr key={k}>
                <td>{SCORE_LABEL[k]}</td>
                {rows.map((r) => (
                  <td key={r.id ?? 'now'}>{scoreFor(r.p).parts.find((p) => p.key === k)?.score ?? '–'}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td>งานวิ่งรวม</td>
              {rows.map((r) => (
                <td key={r.id ?? 'now'}>{m(routeOf(r.p).total)}</td>
              ))}
            </tr>
            <tr>
              <td>จำนวนเครื่อง</td>
              {rows.map((r) => (
                <td key={r.id ?? 'now'}>{r.p.objects.filter((o) => catalogItem(o.assetId)?.use === 'machine').length}</td>
              ))}
            </tr>
            <tr>
              <td>ราคาเครื่อง</td>
              {rows.map((r) => (
                <td key={r.id ?? 'now'}>{fmtBaht(quoteOf(r.p).total)}</td>
              ))}
            </tr>
            <tr>
              <td />
              {rows.map((r) => (
                <td key={r.id ?? 'now'}>
                  {r.id && (
                    <span className="adv-variant-btns">
                      <button className="btn btn-sm" onClick={() => void load(r.id!)} data-testid="variant-load">
                        เปิด
                      </button>
                      <button className="ib sm" onClick={() => void remove(r.id!)} title="ลบแบบนี้" aria-label="ลบแบบนี้">
                        <Icon name="trash" />
                      </button>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
