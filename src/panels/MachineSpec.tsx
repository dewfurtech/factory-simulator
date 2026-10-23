import { useEffect, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { MACHINE_CATEGORIES, machineInfo, machineOptions } from '../model/catalog';
import { machinePhoto } from '../model/photos';
import type { Size3 } from '../model/types';

const mm = (n: number) => n.toLocaleString('th-TH');

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

/** The real machine's photo; a click or the expand button opens it full-screen. */
function MachinePhoto({ assetId, name }: { assetId: string; name: string }) {
  const photo = machinePhoto(assetId);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setBig(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [big]);
  if (!photo) return null;
  return (
    <figure className={`ms-photo${big ? ' big' : ''}`} data-testid="machine-photo">
      <img src={photo.url} alt={`ภาพจริง ${name}`} onClick={() => setBig(!big)} />
      {big && <div className="mv-title">{name}</div>}
      {photo.standIn && (
        <figcaption>
          ยังไม่มีรูป {name} · ใช้รูป {machineInfo(photo.standIn)?.name ?? photo.standIn} (รุ่นใกล้เคียง)
        </figcaption>
      )}
      <div className="mv-tools">
        <button className="ib sm" onClick={() => setBig(!big)} title={big ? 'ย่อ (Esc)' : 'ขยายเต็มจอ'}>
          <Icon name={big ? 'close' : 'expand'} />
        </button>
      </div>
    </figure>
  );
}

/** A Mastrox machine's details: its photo, what it is, its size, and the add-ons that make it longer. Nothing for other objects. */
export function MachineSpec({ assetId, placed, options, onOptions }: { assetId: string; placed?: Size3; options?: readonly string[]; onOptions?: (next: string[]) => void }) {
  const m = machineInfo(assetId);
  if (!m) return null;
  const addons = machineOptions(assetId);
  const chosen = options ?? [];
  const cat = MACHINE_CATEGORIES.find((c) => c.id === m.cat);
  // With add-ons ticked the brochure size no longer applies: the placed size is the machine measured with them.
  const withAddons = chosen.length > 0 && !!placed;
  const size: [number, number, number] | null = withAddons ? [placed.w, placed.d, placed.h] : (m.size ?? (placed ? [placed.w, placed.d, placed.h] : null));
  return (
    <div className="machine-spec" data-testid="machine-spec">
      <MachinePhoto key={m.id} assetId={m.id} name={m.name} />
      {(cat || m.summary) && (
        <p className="ms-summary">
          {cat && <b>{m.kind ?? cat.name}</b>}
          {cat && m.summary && ' · '}
          {m.summary}
        </p>
      )}
      {addons.length > 0 && onOptions && (
        <section className="ms-addons" data-testid="machine-addons">
          <h5>อุปกรณ์เสริม</h5>
          {addons.map((a) => {
            const on = chosen.includes(a.id);
            return (
              <label key={a.id} className={`addon${on ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(ev) => onOptions(ev.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))}
                  data-testid={`addon-${a.id}`}
                />
                <span className="addon-name">
                  <b>{a.name}</b>
                  {a.note && <small>{a.note}</small>}
                </span>
              </label>
            );
          })}
          <p className="muted small">ติ๊กแล้วพื้นที่ที่เครื่องใช้บนผังจะยาวขึ้นตาม</p>
        </section>
      )}
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
            หน่วย มม. {withAddons ? 'รวมอุปกรณ์เสริม' : m.size ? 'ตามโบรชัวร์' : 'วัดจากแบบเครื่อง'}
            {!withAddons && m.size && placed && ` · พื้นที่ที่กันไว้บนผัง ${mm(placed.w)} × ${mm(placed.d)}`}
          </p>
        </section>
      )}
    </div>
  );
}
