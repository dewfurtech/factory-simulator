import { lazy, Suspense } from 'react';
import { MACHINE_CATEGORIES, machineInfo } from '../model/catalog';
import type { Size3 } from '../model/types';

const baht = (n: number) => `${n.toLocaleString('th-TH')} บาท`;
const mm = (n: number) => n.toLocaleString('th-TH');

const ModelViewer = lazy(() => import('../view3d/ModelViewer'));

/** The machine's footprint seen from above and its height from the side, with dimension lines in mm. */
function SizeDiagram({ size }: { size: [number, number, number] }) {
  const [l, w, h] = size;
  // Top view above, side view below, both to one scale; a compact machine is not blown up past ~90 px.
  const W = 300;
  const padL = 12;
  const padR = 64;
  const k = Math.min((W - padL - padR) / l, 90 / Math.max(w, h));
  const pw = l * k;
  const pd = Math.max(w * k, 6);
  const sh = Math.max(h * k, 6);
  const x = padL + (W - padL - padR - pw) / 2;
  const y0 = 22;
  const y1 = y0 + pd + 58;
  const H = y1 + sh + 12;
  const arrows = { markerStart: 'url(#ms-arrow)', markerEnd: 'url(#ms-arrow)' };
  return (
    <svg className="ms-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`ขนาด ${mm(l)} × ${mm(w)} × ${mm(h)} มม.`}>
      <defs>
        <marker id="ms-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L6 3 L0 6 z" fill="currentColor" />
        </marker>
      </defs>
      <text x={x} y={y0 - 8} className="ms-view-t">
        มองจากบน
      </text>
      <rect x={x} y={y0} width={pw} height={pd} rx={2} className="ms-shape" />
      <line x1={x + pw + 8} y1={y0} x2={x + pw + 8} y2={y0 + pd} className="ms-dim" {...arrows} />
      <text x={x + pw + 14} y={y0 + pd / 2} dominantBaseline="middle" className="ms-dim-t">
        ลึก {mm(w)}
      </text>
      <line x1={x} y1={y0 + pd + 10} x2={x + pw} y2={y0 + pd + 10} className="ms-dim" {...arrows} />
      <text x={x + pw / 2} y={y0 + pd + 23} textAnchor="middle" className="ms-dim-t">
        ยาว {mm(l)}
      </text>
      <text x={x} y={y1 - 8} className="ms-view-t">
        มองจากด้านหน้า
      </text>
      <rect x={x} y={y1} width={pw} height={sh} rx={2} className="ms-shape side" />
      <line x1={x - 6} y1={y1 + sh} x2={x + pw + 6} y2={y1 + sh} className="ms-floor" />
      <line x1={x + pw + 8} y1={y1} x2={x + pw + 8} y2={y1 + sh} className="ms-dim" {...arrows} />
      <text x={x + pw + 14} y={y1 + sh / 2} dominantBaseline="middle" className="ms-dim-t">
        สูง {mm(h)}
      </text>
    </svg>
  );
}

/** A Mastrox machine's details: its 3D model, size, price and brochure specs. Nothing for other objects. */
export function MachineSpec({ assetId, placed }: { assetId: string; placed?: Size3 }) {
  const m = machineInfo(assetId);
  if (!m) return null;
  const cat = MACHINE_CATEGORIES.find((c) => c.id === m.cat);
  const size: [number, number, number] | null = m.size ?? (placed ? [placed.w, placed.d, placed.h] : null);
  const rows: [string, string][] = [
    ...(cat ? [['ประเภท', m.kind ?? cat.name] as [string, string]] : []),
    ...(m.tier ? [['ระดับ', m.tier] as [string, string]] : []),
    ['ราคา', m.price != null ? baht(m.price) : '—'],
    ...(m.weight ? [['น้ำหนัก', `${mm(m.weight)} กก.`] as [string, string]] : []),
  ];
  const specs = Object.entries(m.specs ?? {});
  return (
    <div className="machine-spec" data-testid="machine-spec">
      <Suspense fallback={<div className="model-viewer loading"><span className="thumb-wait" /></div>}>
        <ModelViewer assetId={m.id} name={m.name} />
      </Suspense>
      {m.summary && <p className="ms-summary">{m.summary}</p>}
      {size && (
        <section className="ms-size">
          <h5>ขนาดเครื่อง</h5>
          <div className="ms-size-nums">
            <div>
              <b>{mm(size[0])}</b>
              <span>ยาว</span>
            </div>
            <div>
              <b>{mm(size[1])}</b>
              <span>ลึก</span>
            </div>
            <div>
              <b>{mm(size[2])}</b>
              <span>สูง</span>
            </div>
          </div>
          <SizeDiagram size={size} />
          <p className="muted small">
            หน่วย มม. {m.size ? 'ตามโบรชัวร์' : 'จากโมเดล 3D'}
            {m.size && placed && ` · พื้นที่ที่วางบนผัง ${mm(placed.w)} × ${mm(placed.d)} (รวมส่วนยื่นของโมเดล)`}
          </p>
        </section>
      )}
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {m.priceNote && <p className="muted small">หมายเหตุราคา: {m.priceNote}</p>}
      {specs.length > 0 && (
        <>
          <h5>สเปก</h5>
          <dl className="kv">
            {specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {m.stations && m.stations.length > 0 && (
        <>
          <h5>สถานีงาน ({m.stations.length})</h5>
          <ol className="ms-stations">
            {m.stations.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
