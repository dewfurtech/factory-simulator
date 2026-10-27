import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { fmtBaht, quoteOf } from '../model/quote';
import { useProject } from '../store/project';
import { QuotePreview } from './QuotePreview';

/**
 * The layout's price, floating over the top-right of the view: every machine on the plan at its list price, and a
 * button that opens the quotation to look over and save as a PDF file. Machines the price list has no price for are counted beside the sum, not in it.
 * A click on the machine count opens the list: each model, how many, and what they come to.
 */
export function QuoteCard() {
  const project = useProject((s) => s.project!);
  const q = useMemo(() => quoteOf(project), [project]);
  const pieces = q.lines.reduce((n, l) => n + l.qty, 0);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const root = useRef<HTMLElement>(null);

  // The list closes on a click elsewhere or Escape, like the other pop-ups.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <aside className={`quote-card glass${open ? ' open' : ''}`} data-testid="quote-total" aria-label="ราคารวม" ref={root}>
      <div className="qc-label">
        ราคารวมเครื่องจักร
        {pieces > 0 && (
          <>
            {' · '}
            <button
              type="button"
              className="qc-count"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              title={open ? 'ซ่อนรายการ' : 'ดูว่าเครื่องไหนราคาเท่าไหร่'}
              data-testid="quote-count"
            >
              {pieces} เครื่อง
              <Icon name={open ? 'chevronUp' : 'chevronDown'} />
            </button>
          </>
        )}
      </div>
      <div className="qc-sum" data-testid="quote-sum">
        {fmtBaht(q.total)}
      </div>
      {q.unpriced > 0 && (
        <div className="qc-ask" data-testid="quote-ask">
          อีก {q.unpriced} รายการยังไม่มีราคา (สอบถาม)
        </div>
      )}
      {open && (
        <table className="qc-list" data-testid="quote-list">
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.key}>
                <td className="qc-name">
                  {l.name}
                  {l.addons.length > 0 && <small>+ {l.addons.join(', ')}</small>}
                  {l.unit !== null && l.qty > 1 && (
                    <small>
                      {fmtBaht(l.unit)} × {l.qty} เครื่อง
                    </small>
                  )}
                </td>
                <td className="qc-amount">{l.amount === null ? <i>สอบถาม</i> : fmtBaht(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="qc-print" onClick={() => (setOpen(false), setPreview(true))} data-testid="save-quote">
        <Icon name="doc" />
        ดูใบเสนอราคา
      </button>
      {preview && <QuotePreview project={project} quote={q} onClose={() => setPreview(false)} />}
    </aside>
  );
}
