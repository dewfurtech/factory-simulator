import { useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { builtInUtility, defaultUtilities, fillDesign, machineUtility, SOURCE_LABEL, utilityMachines, type DesignRules, type MachineUtility, type UtilitySettings } from '../model/utilities';
import { useUtilities } from '../store/utilities';
import { CATALOG, machineFootprint } from '../model/catalog';
import { builtInSafety } from '../model/safety';
import type { SafetyDistances } from '../model/utilities';
import { confirmDialog } from '../ui/Dialog';

/**
 * Where the seller sets the figures behind the air, power and dust sums: each machine's, and the rules the
 * installation is designed to. Saved in this browser as they are typed; a file moves them to another computer.
 */

type Tab = 'machines' | 'safety' | 'air' | 'power' | 'dust';
const TABS: { id: Tab; label: string }[] = [
  { id: 'machines', label: 'เครื่องจักร' },
  { id: 'safety', label: 'ระยะปลอดภัย' },
  { id: 'air', label: 'ลมอัด' },
  { id: 'power', label: 'ไฟฟ้า' },
  { id: 'dust', label: 'ดูดฝุ่น' },
];

function Num({ value, onChange, step = 1, label }: { value: number | null; onChange: (v: number | null) => void; step?: number; label?: string }) {
  return (
    <input
      className="ad-num"
      type="number"
      step={step}
      min={0}
      value={value ?? ''}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

const COLUMNS: { key: keyof MachineUtility; label: string; step?: number }[] = [
  { key: 'kw', label: 'kW', step: 0.1 },
  { key: 'amps', label: 'กระแส A', step: 0.1 },
  { key: 'breaker', label: 'เบรกเกอร์ A' },
  { key: 'startFactor', label: 'กระแสสตาร์ท เท่า', step: 0.5 },
  { key: 'airLpm', label: 'ลม L/นาที', step: 10 },
  { key: 'airBar', label: 'แรงดัน บาร์', step: 0.1 },
  { key: 'dustM3h', label: 'ดูดฝุ่น m³/ชม.', step: 100 },
  { key: 'secPerSheet', label: 'วินาที/แผ่น', step: 10 },
];

function MachinesTab({ settings }: { settings: UtilitySettings }) {
  const { setMachine, resetMachine } = useUtilities.getState();
  return (
    <div className="ad-scroll">
      <table className="ad-table" data-testid="admin-machines">
        <thead>
          <tr>
            <th>รุ่น</th>
            {COLUMNS.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th>ช่องดูด</th>
            <th>ที่มา</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {utilityMachines().map((m) => {
            const u = machineUtility(m.id, settings);
            return (
              <tr key={m.id} data-testid={`admin-row-${m.id}`}>
                <td className="ad-name">{m.name}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key}>
                    <Num
                      value={u[c.key] as number | null}
                      step={c.step}
                      label={`${m.name} ${c.label}`}
                      onChange={(v) => setMachine(m.id, { [c.key]: c.key === 'airLpm' || c.key === 'dustM3h' ? (v ?? 0) : v })}
                    />
                  </td>
                ))}
                <td>
                  <input className="ad-text" value={u.ports} aria-label={`${m.name} ช่องดูด`} onChange={(e) => setMachine(m.id, { ports: e.target.value })} />
                </td>
                <td>
                  <span className={`ad-source s-${u.source}`}>{SOURCE_LABEL[u.source]}</span>
                </td>
                <td>
                  {settings.machines[m.id] && (
                    <button className="ib sm" onClick={() => resetMachine(m.id)} title={`คืนค่าเดิม (${SOURCE_LABEL[builtInUtility(m.id).source]})`} aria-label="คืนค่าเดิม">
                      <Icon name="undo" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SIDES: { key: keyof SafetyDistances; label: string }[] = [
  { key: 'front', label: 'หน้า' },
  { key: 'back', label: 'หลัง' },
  { key: 'left', label: 'ซ้าย' },
  { key: 'right', label: 'ขวา' },
];

/** The machine from above with its free floor round it, to scale: the front is the bottom edge, drawn thick. */
function SafetySketch({ size, s }: { size: { w: number; d: number }; s: SafetyDistances }) {
  const W = s.left + size.w + s.right;
  const D = s.back + size.d + s.front;
  const k = Math.min(64 / W, 40 / D);
  const x = (64 - W * k) / 2;
  const y = (40 - D * k) / 2;
  return (
    <svg className="ad-sketch" viewBox="0 0 64 40" width="64" height="40" aria-hidden>
      <rect x={x} y={y} width={W * k} height={D * k} fill="var(--accent)" fillOpacity={0.14} stroke="var(--accent)" strokeDasharray="2 1.5" strokeWidth={0.8} />
      <rect x={x + s.left * k} y={y + s.back * k} width={size.w * k} height={size.d * k} fill="var(--ink-3)" />
      <line x1={x + s.left * k} x2={x + (s.left + size.w) * k} y1={y + (s.back + size.d) * k} y2={y + (s.back + size.d) * k} stroke="var(--ink)" strokeWidth={2} />
    </svg>
  );
}

function SafetyTab({ settings }: { settings: UtilitySettings }) {
  const { setSafety, resetSafety } = useUtilities.getState();
  const machines = CATALOG.filter((c) => c.use === 'machine' && builtInSafety(c.id));
  return (
    <div className="ad-scroll">
      <p className="ad-note">ระยะพื้นว่างรอบเครื่องเป็นเมตร ด้านหน้าคือด้านที่คนยืนทำงาน ใช้ตรวจผังและขึ้นในแผนทั้ง 2D และ 3D</p>
      <table className="ad-table" data-testid="admin-safety">
        <thead>
          <tr>
            <th>รุ่น</th>
            {SIDES.map((c) => (
              <th key={c.key}>{c.label} ม.</th>
            ))}
            <th />
            <th>ที่มา</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const own = settings.safety?.[m.id];
            const s = own ?? builtInSafety(m.id)!;
            const size = machineFootprint(m.id, undefined) ?? m.size;
            return (
              <tr key={m.id} data-testid={`admin-safety-${m.id}`}>
                <td className="ad-name">{m.label}</td>
                {SIDES.map((c) => (
                  <td key={c.key}>
                    <Num
                      value={s[c.key] / 1000}
                      step={0.1}
                      label={`${m.label} ระยะ${c.label}`}
                      onChange={(v) => setSafety(m.id, { ...s, [c.key]: Math.max(0, Math.round((v ?? 0) * 1000)) })}
                    />
                  </td>
                ))}
                <td>
                  <SafetySketch size={size} s={s} />
                </td>
                <td>
                  <span className={`ad-source s-${own ? 'admin' : 'brochure'}`}>{own ? 'แก้แล้ว' : 'ค่า Mastrox'}</span>
                </td>
                <td>
                  {own && (
                    <button className="ib sm" onClick={() => resetSafety(m.id)} title="คืนค่า Mastrox" aria-label="คืนค่าเดิม">
                      <Icon name="undo" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Rule({ label, field, unit, step = 1, d }: { label: string; field: keyof DesignRules; unit?: string; step?: number; d: DesignRules }) {
  return (
    <label className="ad-rule">
      <span>{label}</span>
      <Num value={d[field] as number} step={step} label={label} onChange={(v) => useUtilities.getState().setDesign({ [field]: v ?? 0 })} />
      <em>{unit}</em>
    </label>
  );
}

type PipeKey = 'pipes' | 'galvanizedPipes' | 'pprPipes';
const PIPE_TABLES: { key: PipeKey; title: string }[] = [
  { key: 'pipes', title: 'ท่ออะลูมิเนียม' },
  { key: 'galvanizedPipes', title: 'ท่อเหล็กกัลวาไนซ์' },
  { key: 'pprPipes', title: 'ท่อ PPR' },
];

function AirTab({ d }: { d: DesignRules }) {
  const set = useUtilities.getState().setDesign;
  const setPipe = (key: PipeKey, i: number, patch: Partial<DesignRules['pipes'][number]>) => set({ [key]: d[key].map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="ad-cols">
      <section>
        <h3>ปั๊มลมและชุดกรอง</h3>
        <Rule d={d} field="pumpBar" label="แรงดันตั้งปั๊ม" unit="บาร์" step={0.1} />
        <Rule d={d} field="pumpMaxBar" label="แรงดันสูงสุดของปั๊ม" unit="บาร์" step={0.1} />
        <Rule d={d} field="dryerDropBar" label="แรงดันตกผ่าน dryer" unit="บาร์" step={0.05} />
        <Rule d={d} field="filterDropBar" label="แรงดันตกผ่าน filter ต่อตัว" unit="บาร์" step={0.05} />
        <Rule d={d} field="filters" label="จำนวน filter" unit="ตัว" />
        <Rule d={d} field="airMargin" label="ตัวคูณเผื่อ" unit="เท่า" step={0.05} />
      </section>
      <section>
        <h3>การเดินท่อ</h3>
        <label className="ad-rule">
          <span>รูปแบบท่อเมน</span>
          <select value={d.pipeLayout} onChange={(e) => set({ pipeLayout: e.target.value as DesignRules['pipeLayout'] })}>
            <option value="ring">วงรอบ</option>
            <option value="line">เส้นเดียว</option>
          </select>
        </label>
        <Rule d={d} field="pipeDropBar" label="แรงดันตกในท่อไม่เกิน" unit="บาร์" step={0.01} />
        <Rule d={d} field="pipeVelocity" label="ความเร็วลมท่อเมน" unit="ม./วิ" step={0.5} />
        <Rule d={d} field="branchVelocity" label="ความเร็วลมท่อแยก" unit="ม./วิ" step={0.5} />
        <Rule d={d} field="branchLength" label="ความยาวท่อแยก" unit="ม." />
        <Rule d={d} field="branchDropBar" label="แรงดันตกท่อแยกไม่เกิน" unit="บาร์" step={0.01} />
        <Rule d={d} field="fittingFactor" label="ตัวคูณข้อต่อ เมื่อไม่ได้วาดท่อ" unit="เท่า" step={0.1} />
      </section>
      {PIPE_TABLES.map(({ key, title }) => (
        <section key={key}>
          <h3>{title}</h3>
          <table className="ad-table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>รูใน มม.</th>
              </tr>
            </thead>
            <tbody>
              {d[key].map((p, i) => (
                <tr key={i}>
                  <td>
                    <input className="ad-text" value={p.label} aria-label="ชื่อท่อ" onChange={(e) => setPipe(key, i, { label: e.target.value })} />
                  </td>
                  <td>
                    <Num value={p.id} label="รูใน" onChange={(v) => setPipe(key, i, { id: v ?? 0 })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function PowerTab({ d }: { d: DesignRules }) {
  const set = useUtilities.getState().setDesign;
  const setCable = (i: number, patch: Partial<DesignRules['cables'][number]>) => set({ cables: d.cables.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="ad-cols">
      <section>
        <h3>โหลด</h3>
        <Rule d={d} field="volts" label="แรงดันไฟ" unit="V" />
        <Rule d={d} field="powerFactor" label="Power factor" step={0.01} />
        <Rule d={d} field="efficiency" label="ประสิทธิภาพมอเตอร์" step={0.01} />
        <Rule d={d} field="diversity" label="ตัวคูณใช้งานพร้อมกัน" step={0.05} />
        <Rule d={d} field="breakerMargin" label="ตัวคูณเบรกเกอร์" unit="เท่า" step={0.05} />
      </section>
      <section>
        <h3>การเดินสาย</h3>
        <label className="ad-rule">
          <span>ชนิดสาย</span>
          <input className="ad-text" value={d.cableType} aria-label="ชนิดสาย" onChange={(e) => set({ cableType: e.target.value })} />
        </label>
        <label className="ad-rule">
          <span>การวางสายป้อน</span>
          <select value={d.install} onChange={(e) => set({ install: e.target.value as DesignRules['install'] })}>
            <option value="tray">เรียงบนราง</option>
            <option value="conduit">รวมในท่อ</option>
          </select>
        </label>
        <Rule d={d} field="voltDropPct" label="แรงดันตกสายป้อนไม่เกิน" unit="%" step={0.5} />
        <Rule d={d} field="mainDropPct" label="แรงดันตกสายเมนไม่เกิน" unit="%" step={0.5} />
        <Rule d={d} field="totalDropPct" label="แรงดันตกรวมไม่เกิน" unit="%" step={0.5} />
        <Rule d={d} field="startDropPct" label="แรงดันตกตอนสตาร์ทไม่เกิน" unit="%" step={1} />
        <Rule d={d} field="mainRun" label="หม้อแปลงถึงตู้ MDB" unit="ม." />
        <Rule d={d} field="ambientFactor" label="ตัวคูณอุณหภูมิ" step={0.01} />
        <Rule d={d} field="riser" label="ระยะขึ้น-ลง" unit="ม." />
        <Rule d={d} field="defaultRun" label="ระยะเมื่อไม่มีตู้ MDB" unit="ม." />
      </section>
      <section>
        <h3>พิกัดกระแสสาย</h3>
        <p className="ad-warn">ค่าเริ่มต้นจาก IEC 60364-5-52 ที่ 30 °C ตรวจกับตาราง วสท. ก่อนใช้จริง</p>
        <table className="ad-table" data-testid="admin-cables">
          <thead>
            <tr>
              <th>ตร.มม.</th>
              <th>A ในท่อ</th>
              <th>A บนราง</th>
            </tr>
          </thead>
          <tbody>
            {d.cables.map((c, i) => (
              <tr key={i}>
                <td>
                  <Num value={c.mm2} step={0.5} label="ขนาดสาย" onChange={(v) => setCable(i, { mm2: v ?? 0 })} />
                </td>
                <td>
                  <Num value={c.amps} label="กระแสในท่อ" onChange={(v) => setCable(i, { amps: v ?? 0 })} />
                </td>
                <td>
                  <Num value={c.tray} label="กระแสบนราง" onChange={(v) => setCable(i, { tray: v ?? 0 })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function DustTab({ d }: { d: DesignRules }) {
  const [text, setText] = useState(d.ducts.join(', '));
  return (
    <div className="ad-cols">
      <section>
        <h3>ท่อดูดฝุ่น</h3>
        <Rule d={d} field="ductVelocity" label="ความเร็วลมในท่อ" unit="ม./วิ" />
        <Rule d={d} field="dustDiversity" label="ตัวคูณใช้งานพร้อมกัน" step={0.05} />
        <label className="ad-rule ad-wide">
          <span>ขนาดท่อ (มม.)</span>
          <input
            className="ad-text"
            value={text}
            aria-label="ขนาดท่อดูดฝุ่น"
            onChange={(e) => {
              setText(e.target.value);
              const ducts = e.target.value
                .split(/[,\s]+/)
                .map(Number)
                .filter((n) => n > 0)
                .sort((a, b) => a - b);
              if (ducts.length) useUtilities.getState().setDesign({ ducts });
            }}
          />
        </label>
      </section>
    </div>
  );
}

export function AdminPage() {
  const settings = useUtilities((s) => s.settings);
  const [tab, setTab] = useState<Tab>('machines');
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const save = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factory-utilities.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const load = async (f: File) => {
    try {
      const s = JSON.parse(await f.text()) as UtilitySettings;
      if (!s.machines || !s.design) throw new Error();
      useUtilities.getState().replace({ machines: s.machines, design: fillDesign(s.design), safety: s.safety ?? {} });
      setError(null);
    } catch {
      setError('ไฟล์นี้ไม่ใช่ไฟล์ตั้งค่า');
    }
  };
  const reset = async () => {
    if (await confirmDialog({ title: 'คืนค่าเริ่มต้นทั้งหมด', ok: 'คืนค่า', danger: true })) useUtilities.getState().replace(defaultUtilities());
  };
  return (
    <div className="admin" data-testid="admin">
      <header className="ad-head">
        <a className="ib" href="#/" title="กลับ" aria-label="กลับ">
          <Icon name="back" />
        </a>
        <h1>ตั้งค่าระบบลมและไฟฟ้า</h1>
        <span className="ad-actions">
          <button className="btn btn-sm" onClick={save} data-testid="admin-export">
            <Icon name="download" />
            ส่งออก
          </button>
          <button className="btn btn-sm" onClick={() => file.current?.click()}>
            <Icon name="upload" />
            นำเข้า
          </button>
          <button className="btn btn-sm" onClick={() => void reset()} data-testid="admin-reset">
            คืนค่าเริ่มต้น
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        </span>
      </header>
      {error && <p className="ad-warn">{error}</p>}
      <div className="adv-tabs ad-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`admin-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'machines' && <MachinesTab settings={settings} />}
      {tab === 'safety' && <SafetyTab settings={settings} />}
      {tab === 'air' && <AirTab d={settings.design} />}
      {tab === 'power' && <PowerTab d={settings.design} />}
      {tab === 'dust' && <DustTab d={settings.design} />}
    </div>
  );
}
