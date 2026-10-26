import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../editor2d/Toolbar';
import { download } from '../editor2d/exportImage';
import type { BoqOptions, BoqSpecOverride, Project } from '../model/types';
import { applyEdit, useProject } from '../store/project';
import { customDialog } from '../ui/Dialog';
import { boqCsv, quote, quoteCsv, UNPRICED_LABEL, type BoqLine, type MaterialSpec, type Quote } from './boq';
import { lineUses, projectBoq, SKIRTING_ID } from './boqSurfaces';
import { materialOf } from './materials';
import { Swatch } from './MaterialPicker';

/** Opens the BOQ and quote page for the open project. */
export const openBoq = () => customDialog((close) => <BoqPage close={close} />, { wide: true });

type Tab = 'takeoff' | 'quote';

const num = (x: number, d = 2) => x.toLocaleString('th-TH', { maximumFractionDigits: d });
const money = (x: number) => x.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const purchaseText = (l: BoqLine) => `${num(l.purchase.qty)} ${l.purchase.unit}`;

/**
 * Edits the project from the BOQ page. Typing in a box is one undo step: the step opens when the box takes focus
 * and closes when it loses it (or the page closes), as dragging on the plan does.
 */
const edit = (recipe: (d: Project) => void) => applyEdit(recipe);
const begin = () => useProject.getState().beginGesture();
const end = () => useProject.getState().endGesture();

/** A number box that may be left empty: empty gives undefined. Keeps what is typed until it reads as a number. */
function NumBox({
  value,
  onChange,
  label,
  testId,
  min = 0,
  step = 'any',
  width,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label: string;
  testId?: string;
  min?: number;
  step?: string;
  width?: number;
  /** Shown while empty: the value used when nothing is typed. */
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : String(value));
  }, [value, focused]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="boq-num"
      style={width ? { width } : undefined}
      onFocus={() => (setFocused(true), begin())}
      onBlur={() => (setFocused(false), end())}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') return onChange(undefined);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= min) onChange(v);
      }}
    />
  );
}

/** Sets or clears one field of the BOQ options, dropping what is left empty. */
function setOption<K extends keyof BoqOptions>(d: Project, key: K, value: BoqOptions[K] | undefined) {
  const o: BoqOptions = { ...d.boqOptions };
  if (value === undefined) delete o[key];
  else o[key] = value;
  if (Object.keys(o).length) d.boqOptions = o;
  else delete d.boqOptions;
}

function setRecord<T>(rec: Record<string, T> | undefined, id: string, value: T | undefined): Record<string, T> | undefined {
  const r = { ...rec };
  if (value === undefined) delete r[id];
  else r[id] = value;
  return Object.keys(r).length ? r : undefined;
}

const setWaste = (id: string, v: number | undefined) => edit((d) => setOption(d, 'wastePct', setRecord(d.boqOptions?.wastePct, id, v)));
const setSpec = (id: string, patch: BoqSpecOverride) =>
  edit((d) => {
    const next: BoqSpecOverride = { ...d.boqOptions?.specs?.[id], ...patch };
    for (const k of Object.keys(next) as (keyof BoqSpecOverride)[]) if (next[k] === undefined) delete next[k];
    setOption(d, 'specs', setRecord(d.boqOptions?.specs, id, Object.keys(next).length ? next : undefined));
  });
const setPrice = (id: string, patch: { unitPrice?: number; laborPerUnit?: number }) =>
  edit((d) => {
    const next = { ...d.priceBook?.[id], ...patch };
    if (next.unitPrice === undefined) delete next.unitPrice;
    if (next.laborPerUnit === undefined) delete next.laborPerUnit;
    const book = setRecord(d.priceBook, id, Object.keys(next).length ? next : undefined);
    if (book) d.priceBook = book;
    else delete d.priceBook;
  });

/**
 * The BOQ page: the take-off counted from the rooms' materials, and the quote priced from what the user types. No
 * price is filled in for them; a line left empty shows as not priced yet and stays out of the total.
 */
function BoqPage({ close }: { close: () => void }) {
  const project = useProject((s) => s.project!);
  const boq = useMemo(() => projectBoq(project), [project]);
  const q = useMemo(() => quote(boq.lines, project.priceBook ?? {}, { vatPct: project.boqOptions?.vatPct }), [boq, project.priceBook, project.boqOptions?.vatPct]);
  const [tab, setTab] = useState<Tab>('takeoff');
  // A box still focused when the page closes ends its undo step here.
  useEffect(() => end, []);
  const csv = () => {
    const text = tab === 'takeoff' ? boqCsv(boq.lines) : quoteCsv(q);
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${project.name} ${tab === 'takeoff' ? 'BOQ' : 'ใบเสนอราคา'}.csv`);
  };
  return (
    <div className="boq" data-testid="boq-page">
      <div className="mood-head boq-head">
        <div className="boq-title">
          <h2>BOQ / ใบเสนอราคา</h2>
          <p className="muted">{project.name}</p>
        </div>
        <div className="row gap boq-actions">
          <button type="button" className="btn" onClick={csv} disabled={!boq.lines.length} data-testid="boq-csv">
            <Icon name="download" /> ส่งออก CSV
          </button>
          {tab === 'quote' && (
            <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!boq.lines.length} data-testid="boq-print">
              <Icon name="report" /> พิมพ์ / บันทึก PDF
            </button>
          )}
        </div>
        <button type="button" className="ib boq-close" onClick={close} title="ปิด (Esc)" aria-label="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <div className="seg boq-tabs" role="tablist" aria-label="หน้า BOQ">
        <button role="tab" aria-selected={tab === 'takeoff'} className={tab === 'takeoff' ? 'on' : ''} onClick={() => setTab('takeoff')} data-testid="boq-tab-takeoff">
          ถอดปริมาณ
        </button>
        <button role="tab" aria-selected={tab === 'quote'} className={tab === 'quote' ? 'on' : ''} onClick={() => setTab('quote')} data-testid="boq-tab-quote">
          ใบเสนอราคา
        </button>
      </div>
      {tab === 'takeoff' ? <TakeOff project={project} boq={boq} /> : <QuoteTab project={project} q={q} />}
      {createPortal(<PrintSheet project={project} q={q} />, document.body)}
    </div>
  );
}

/* ---------- ถอดปริมาณ ---------- */

function TakeOff({ project, boq }: { project: Project; boq: ReturnType<typeof projectBoq> }) {
  const [open, setOpen] = useState<string | null>(null);
  const skirting = project.boqOptions?.skirting;
  return (
    <>
      <label className="boq-check">
        <input
          type="checkbox"
          checked={!!skirting}
          onChange={(e) => edit((d) => setOption(d, 'skirting', e.target.checked ? { name: 'บัวพื้น' } : undefined))}
          data-testid="boq-skirting"
        />
        คิดบัวพื้นรอบห้อง (เส้นรอบห้อง หักความกว้างประตู)
      </label>
      {!boq.lines.length ? (
        <p className="muted">ยังไม่มีอะไรให้ถอดปริมาณ เลือกห้องบนแปลนแล้วกำหนดวัสดุพื้น ผนัง หรือฝ้า หรือวางเฟอร์นิเจอร์จากคลัง</p>
      ) : (
        <div className="boq-scroll">
          <table className="mood-table boq-table" data-testid="boq-takeoff">
            <thead>
              <tr>
                <th>รายการ</th>
                <th>ใช้ที่</th>
                <th>หน่วย</th>
                <th className="num">สุทธิ</th>
                <th className="num">เผื่อ %</th>
                <th className="num">รวมเผื่อ</th>
                <th className="num">จำนวนซื้อ</th>
                <th className="num">แผ่นเต็ม / ตัด</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {boq.lines.map((l) => {
                const isOpen = open === l.id;
                const spec = boq.specs.find((s) => s.id === l.id);
                const uses = l.category === 'surface' ? lineUses(boq.surfaces, l.id) : l.rooms;
                return (
                  <Fragment key={l.id}>
                    <tr data-testid={`boq-line-${l.id}`}>
                      <td>
                        <div className="boq-item">
                          {l.category === 'surface' && l.id !== SKIRTING_ID && <Swatch material={materialOf(l.id, project)} size={28} />}
                          <b>{l.item}</b>
                        </div>
                      </td>
                      <td className="small">{uses.length ? uses.map((u) => <div key={u}>{u}</div>) : <span className="muted">—</span>}</td>
                      <td>{l.qtyUnit}</td>
                      <td className="num">{num(l.net)}</td>
                      <td className="num">
                        {l.category === 'furniture' ? (
                          <span className="muted">—</span>
                        ) : (
                          <NumBox
                            value={project.boqOptions?.wastePct?.[l.id]}
                            onChange={(v) => setWaste(l.id, v)}
                            label={`% เผื่อของ ${l.item} (ว่าง = ค่าตั้งต้น ${num(l.wastePct)}%)`}
                            testId={`boq-waste-${l.id}`}
                            width={64}
                            placeholder={num(l.wastePct)}
                          />
                        )}
                      </td>
                      <td className="num">{num(l.gross)}</td>
                      <td className="num">
                        <b>{purchaseText(l)}</b>
                        {l.purchase.perUnitLabel && <div className="muted small">{l.purchase.perUnitLabel}</div>}
                      </td>
                      <td className="num">
                        {l.pieces ? l.pieces.full !== null ? `${l.pieces.full} / ${l.pieces.cut}` : <span className="muted small">จากสูตร</span> : <span className="muted">—</span>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ib sm"
                          onClick={() => setOpen(isOpen ? null : l.id)}
                          aria-expanded={isOpen}
                          title="วิธีคิดและหน่วยคิด"
                          aria-label="วิธีคิด"
                        >
                          <Icon name={isOpen ? 'close' : 'info'} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="boq-detail">
                        <td colSpan={9}>
                          <p className="small">
                            <b>วิธีคิด:</b> {l.note}
                          </p>
                          {spec && <SpecEditor project={project} spec={spec} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        พื้นและฝ้าคิดตามพื้นที่ห้อง ผนังคิดทีละด้านตามความยาว × ความสูงฝ้า หักประตูและหน้าต่าง ห้องสี่เหลี่ยมนับแผ่นกระเบื้องจากการวางจริงจากมุมห้อง (แผ่นตัดนับเป็นแผ่น
        จึงไม่เผื่อเพิ่มเว้นแต่ตั้งเอง) ห้องรูปทรงอื่นคิดจากพื้นที่ + % เผื่อตามลายปู · วัสดุที่ขนาดต่างกันตามยี่ห้อคิดเป็น ตร.ม. ใส่ขนาดแผ่นเองได้ที่ปุ่มวิธีคิด
      </p>
    </>
  );
}

/** The user's own numbers for how one material is counted. */
function SpecEditor({ project, spec }: { project: Project; spec: MaterialSpec }) {
  const o = project.boqOptions?.specs?.[spec.id] ?? {};
  const u = spec.unit;
  if (spec.id === SKIRTING_ID) {
    const s = project.boqOptions!.skirting!;
    return (
      <div className="boq-spec">
        <label>
          ชื่อ
          <input
            type="text"
            value={s.name}
            onFocus={begin}
            onBlur={end}
            onChange={(e) => edit((d) => setOption(d, 'skirting', { ...d.boqOptions!.skirting!, name: e.target.value }))}
            aria-label="ชื่อบัวพื้น"
          />
        </label>
        <label>
          ยาวเส้นละ (มม.)
          <NumBox
            value={s.pieceLengthMm}
            onChange={(v) =>
              edit((d) => {
                const next = { ...d.boqOptions!.skirting!, pieceLengthMm: v };
                if (v === undefined) delete next.pieceLengthMm;
                setOption(d, 'skirting', next);
              })
            }
            label="ความยาวต่อเส้น มม. (ว่าง = ซื้อเป็นเมตร)"
            width={90}
          />
        </label>
        <span className="muted small">ว่าง = ซื้อเป็นเมตร</span>
      </div>
    );
  }
  const piece = u.kind === 'tile' ? u.tileMm : u.kind === 'sheet' ? u.sheetMm : undefined;
  return (
    <div className="boq-spec">
      {(piece || u.kind === 'area') && (
        <>
          <label>
            ขนาดแผ่น (มม.)
            <NumBox value={o.pieceW ?? piece?.w} onChange={(v) => setSpec(spec.id, { pieceW: v })} label="กว้างแผ่น มม." width={76} min={1} />×
            <NumBox value={o.pieceH ?? piece?.h} onChange={(v) => setSpec(spec.id, { pieceH: v })} label="ยาวแผ่น มม." width={76} min={1} />
          </label>
          <label>
            แผ่น/กล่อง
            <NumBox value={o.perBox} onChange={(v) => setSpec(spec.id, { perBox: v })} label="จำนวนแผ่นต่อกล่อง (ว่าง = ซื้อเป็นแผ่น)" width={64} min={1} step="1" />
          </label>
          {u.kind === 'area' && <span className="muted small">ใส่ขนาดแผ่นทั้งสองช่องเพื่อนับเป็นแผ่น</span>}
        </>
      )}
      {u.kind === 'paint' && (
        <>
          <label>
            ทาได้ (ม²/แกลลอน/ชั้น)
            <NumBox value={o.coverageM2 ?? u.coverageM2PerUnit} onChange={(v) => setSpec(spec.id, { coverageM2: v })} label="ตร.ม. ต่อแกลลอนต่อชั้น" width={70} min={1} />
          </label>
          <label>
            จำนวนชั้น
            <NumBox value={o.coats ?? u.coats} onChange={(v) => setSpec(spec.id, { coats: v })} label="จำนวนชั้นสี" width={56} min={1} step="1" />
          </label>
        </>
      )}
      {u.kind === 'roll' && (
        <>
          <label>
            หน้ากว้างม้วน (มม.)
            <NumBox value={o.rollW ?? u.widthMm} onChange={(v) => setSpec(spec.id, { rollW: v })} label="หน้ากว้างม้วน มม." width={80} min={1} />
          </label>
          <label>
            ยาวต่อม้วน (มม.)
            <NumBox value={o.rollL ?? u.lengthMm} onChange={(v) => setSpec(spec.id, { rollL: v })} label="ความยาวต่อม้วน มม." width={84} min={1} />
          </label>
        </>
      )}
      {Object.keys(o).length > 0 && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit((d) => setOption(d, 'specs', setRecord(d.boqOptions?.specs, spec.id, undefined)))}>
          กลับค่าตั้งต้น
        </button>
      )}
    </div>
  );
}

/* ---------- ใบเสนอราคา ---------- */

function ClientBlock({ project }: { project: Project }) {
  const c = project.client;
  return (
    <div className="boq-client">
      <div>
        <div className="muted small">ลูกค้า</div>
        {c?.company || c?.contact || c?.phone ? (
          <>
            {c.company && <b>{c.company}</b>}
            {c.contact && <div>{c.contact}</div>}
            {c.phone && <div>โทร {c.phone}</div>}
          </>
        ) : (
          <span className="muted">ยังไม่ใส่ข้อมูลลูกค้า (ใส่ได้ที่ชื่อโปรเจกต์บนแถบบน)</span>
        )}
      </div>
      <div className="boq-date">
        <div className="muted small">วันที่</div>
        {today()}
      </div>
    </div>
  );
}

/** The totals under the quote; `editable` on screen (VAT box, test ids), not on the print sheet. */
function Totals({ q, editable }: { q: Quote; editable?: boolean }) {
  const id = (name: string) => (editable ? name : undefined);
  return (
    <div className="boq-totals" data-testid={id('boq-totals')}>
      <div>
        <span>รวมก่อน VAT</span>
        <b data-testid={id('boq-subtotal')}>{money(q.subtotal)}</b>
      </div>
      <div>
        <span>
          VAT{' '}
          {editable ? (
            <NumBox value={q.vatPct || undefined} onChange={(v) => edit((d) => setOption(d, 'vatPct', v))} label="VAT % (ว่าง = ไม่คิด)" testId="boq-vat" width={56} />
          ) : (
            q.vatPct
          )}{' '}
          %
        </span>
        <b>{money(q.vat)}</b>
      </div>
      <div className="boq-grand">
        <span>รวมทั้งสิ้น (บาท)</span>
        <b data-testid={id('boq-total')}>{money(q.total)}</b>
      </div>
      {q.unpricedCount > 0 && (
        <p className="boq-unpriced" data-testid={id('boq-unpriced')}>
          {UNPRICED_LABEL} {q.unpricedCount} รายการ ไม่รวมในยอด
        </p>
      )}
    </div>
  );
}

function QuoteTab({ project, q }: { project: Project; q: Quote }) {
  if (!q.rows.length) return <p className="muted">ยังไม่มีรายการ กำหนดวัสดุให้ห้องหรือวางเฟอร์นิเจอร์ก่อน</p>;
  return (
    <>
      <ClientBlock project={project} />
      <div className="boq-scroll">
        <table className="mood-table boq-table" data-testid="boq-quote">
          <thead>
            <tr>
              <th>#</th>
              <th>รายการ</th>
              <th className="num">จำนวนซื้อ</th>
              <th className="num">ราคา/หน่วย</th>
              <th className="num">ค่าวัสดุ</th>
              <th className="num">ปริมาณสุทธิ</th>
              <th className="num">ค่าแรง/หน่วย</th>
              <th className="num">ค่าแรง</th>
              <th className="num">รวม</th>
            </tr>
          </thead>
          <tbody>
            {q.rows.map((r, i) => (
              <tr key={r.line.id} data-testid={`quote-line-${r.line.id}`}>
                <td>{i + 1}</td>
                <td>
                  <b>{r.line.item}</b>
                </td>
                <td className="num">{purchaseText(r.line)}</td>
                <td className="num">
                  <NumBox
                    value={r.unitPrice}
                    onChange={(v) => setPrice(r.line.id, { unitPrice: v })}
                    label={`ราคาต่อ${r.line.purchase.unit} ของ ${r.line.item} (บาท)`}
                    testId={`boq-price-${r.line.id}`}
                    width={90}
                  />
                </td>
                <td className="num">{r.materialCost !== undefined ? money(r.materialCost) : ''}</td>
                <td className="num">
                  {num(r.line.net)} {r.line.qtyUnit}
                </td>
                <td className="num">
                  <NumBox
                    value={r.laborPerUnit}
                    onChange={(v) => setPrice(r.line.id, { laborPerUnit: v })}
                    label={`ค่าแรงต่อ${r.line.qtyUnit} ของ ${r.line.item} (บาท)`}
                    testId={`boq-labor-${r.line.id}`}
                    width={84}
                  />
                </td>
                <td className="num">{r.laborCost !== undefined ? money(r.laborCost) : ''}</td>
                <td className="num">{r.total !== undefined ? <b>{money(r.total)}</b> : <span className="boq-unpriced">{UNPRICED_LABEL}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totals q={q} editable />
      <p className="muted small">
        ราคาทุกช่องใส่เอง ว่างได้ ค่าวัสดุ = จำนวนซื้อ × ราคา/หน่วย · ค่าแรง = ปริมาณสุทธิ × ค่าแรง/หน่วย · ราคาเก็บกับโปรเจกต์และไฟล์ที่ส่งออก ไม่ติดไปกับลิงก์แชร์
      </p>
    </>
  );
}

/* ---------- พิมพ์ ---------- */

/** The quote as it prints on A4: hidden on screen, the only thing on the page in print (see `.boq-print` in styles.css). */
function PrintSheet({ project, q }: { project: Project; q: Quote }) {
  return (
    <div className="boq-print" aria-hidden>
      <h1>ใบเสนอราคา</h1>
      <p className="boq-print-name">{project.name}</p>
      <ClientBlock project={project} />
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>รายการ</th>
            <th className="num">จำนวน</th>
            <th className="num">ราคา/หน่วย</th>
            <th className="num">ค่าวัสดุ</th>
            <th className="num">ค่าแรง</th>
            <th className="num">รวม (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {q.rows.map((r, i) => (
            <tr key={r.line.id}>
              <td>{i + 1}</td>
              <td>{r.line.item}</td>
              <td className="num">{purchaseText(r.line)}</td>
              <td className="num">{r.unitPrice !== undefined ? money(r.unitPrice) : ''}</td>
              <td className="num">{r.materialCost !== undefined ? money(r.materialCost) : ''}</td>
              <td className="num">{r.laborCost !== undefined ? money(r.laborCost) : ''}</td>
              <td className="num">{r.total !== undefined ? money(r.total) : UNPRICED_LABEL}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Totals q={q} />
    </div>
  );
}
