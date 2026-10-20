import { MACHINE_CATEGORIES, machineInfo } from '../model/catalog';

const baht = (n: number) => `${n.toLocaleString('th-TH')} บาท`;

/** A Mastrox machine's brochure details: tier, price, size, weight and specs. Nothing for other objects. */
export function MachineSpec({ assetId }: { assetId: string }) {
  const m = machineInfo(assetId);
  if (!m) return null;
  const cat = MACHINE_CATEGORIES.find((c) => c.id === m.cat);
  const rows: [string, string][] = [
    ['รุ่น', m.name],
    ...(cat ? [['ประเภท', m.kind ?? cat.name] as [string, string]] : []),
    ...(m.tier ? [['ระดับ', m.tier] as [string, string]] : []),
    ['ราคา', m.price != null ? baht(m.price) : '—'],
    ...(m.size ? [['ขนาดเครื่อง (ย×ก×ส)', `${m.size.map((v) => v.toLocaleString('th-TH')).join(' × ')} มม.`] as [string, string]] : []),
    ...(m.weight ? [['น้ำหนัก', `${m.weight.toLocaleString('th-TH')} กก.`] as [string, string]] : []),
  ];
  const specs = Object.entries(m.specs ?? {});
  return (
    <div className="machine-spec" data-testid="machine-spec">
      {m.summary && <p className="ms-summary">{m.summary}</p>}
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
      {m.look &&<p className="muted small">ลักษณะ: {m.look}</p>}
    </div>
  );
}
