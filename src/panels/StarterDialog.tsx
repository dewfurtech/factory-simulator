import { useEffect, useMemo, useState } from 'react';
import { machineInfo } from '../model/catalog';
import { fmtBaht } from '../model/quote';
import { layOut, picksPrice, PRODUCT_LABEL, recommend, TIER_LABEL, VOLUME_LABEL, type Product, type StarterAnswers, type Tier, type Volume } from '../model/starter';
import { applyEdit } from '../store/project';
import { useUi } from '../store/ui';

/**
 * Three questions for a customer who does not know which machines they need, then the set the answers point to, with
 * why each is there and what it comes to, and a button that lays it out on the plan as a working line.
 */
export function StarterDialog() {
  const [a, setA] = useState<StarterAnswers>({ product: 'kitchen', volume: 'small', tier: 'startup' });
  const [step, setStep] = useState(0);
  const picks = useMemo(() => recommend(a), [a]);
  const price = picksPrice(picks);
  const close = () => useUi.getState().set({ starterOpen: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const place = () => {
    applyEdit((d) => void layOut(d, picks));
    useUi.getState().set({ starterOpen: false, dock: 'summary', summaryTab: 'score', view: '2d' });
  };

  const choice = <K extends keyof StarterAnswers>(key: K, labels: Record<StarterAnswers[K], string>) => (
    <div className="st-choices" role="radiogroup">
      {(Object.keys(labels) as StarterAnswers[K][]).map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={a[key] === v}
          className={a[key] === v ? 'on' : ''}
          onClick={() => setA({ ...a, [key]: v })}
          data-testid={`starter-${String(key)}-${v}`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid="starter">
      <div className="dialog glass st-dialog" role="dialog" aria-modal="true" aria-label="ตัวช่วยเริ่มต้น">
        {step === 0 && (
          <>
            <h2>ผลิตอะไร</h2>
            {choice('product', PRODUCT_LABEL as Record<Product, string>)}
          </>
        )}
        {step === 1 && (
          <>
            <h2>ปริมาณต่อวัน</h2>
            {choice('volume', VOLUME_LABEL as Record<Volume, string>)}
          </>
        )}
        {step === 2 && (
          <>
            <h2>ระดับเครื่อง</h2>
            {choice('tier', TIER_LABEL as Record<Tier, string>)}
          </>
        )}
        {step === 3 && (
          <>
            <h2>ชุดที่แนะนำ</h2>
            <ol className="st-picks" data-testid="starter-picks">
              {picks.map((p, i) => {
                const info = machineInfo(p.assetId);
                return (
                  <li key={i} title={p.why}>
                    <b>{info?.name}</b>
                    <span className="st-price">{info?.price ? fmtBaht(info.price) : 'สอบถาม'}</span>
                  </li>
                );
              })}
            </ol>
            <div className="st-total">
              รวม <b>{fmtBaht(price.total)}</b>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => (step ? setStep(step - 1) : close())}>
            {step ? 'ย้อนกลับ' : 'ยกเลิก'}
          </button>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)} data-testid="starter-next">
              ถัดไป
            </button>
          ) : (
            <button className="btn btn-primary" onClick={place} data-testid="starter-place">
              วางชุดนี้ลงผัง
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
