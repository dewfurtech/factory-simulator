import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../editor2d/Toolbar';
import { fmtBaht, type Quote } from '../model/quote';
import type { Project } from '../model/types';

/**
 * The quotation as it will print, over the whole screen, with the button that saves it as a PDF file. The page is
 * laid out for the screen it is on: a table on a desktop, one card per line on a phone.
 */
export function QuotePreview({ project, quote, onClose }: { project: Project; quote: Quote; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The PDF is built in the browser and handed over as a download; nothing goes to a printer.
  const savePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ quotationPdf, quotationFileName }, { download }] = await Promise.all([import('../model/quotePdf'), import('../editor2d/exportImage')]);
      const bytes = await quotationPdf(project, quote);
      download(new Blob([bytes], { type: 'application/pdf' }), quotationFileName(project));
    } catch (e) {
      setError(`สร้าง PDF ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const date = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const client = project.client ?? {};
  const who = [client.company, client.contact, client.phone].filter(Boolean) as string[];
  const notes: string[] = [];
  if (quote.unpriced) notes.push('รายการที่ระบุ “สอบถาม” ยังไม่มีราคาในรายการราคา และไม่รวมอยู่ในยอดรวม');
  if (quote.lines.some((l) => l.addonsUnpriced)) notes.push('อุปกรณ์เสริมที่ติ๊กไว้ยังไม่มีราคาในรายการราคา เสนอแยกต่างหาก');

  return createPortal(
    <div className="qp-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-testid="quote-preview">
      <div className="qp-window" role="dialog" aria-modal="true" aria-label="ตัวอย่างใบเสนอราคา">
        <div className="qp-bar">
          <span className="qp-bar-title">ตัวอย่างใบเสนอราคา</span>
          <button className="btn btn-primary qp-save" onClick={() => void savePdf()} disabled={busy} data-testid="save-quote-pdf">
            <Icon name="download" />
            {busy ? 'กำลังสร้าง…' : 'บันทึก PDF'}
          </button>
          <button className="ib" onClick={onClose} title="ปิด (Esc)" aria-label="ปิด" data-testid="quote-preview-close">
            <Icon name="close" />
          </button>
        </div>
        {error && <div className="qp-error">{error}</div>}
        <div className="qp-scroll">
          <article className="qp-sheet">
            <header className="qp-head">
              <div>
                <h1>ใบเสนอราคา</h1>
                <div className="qp-muted">Quotation</div>
              </div>
              <div className="qp-who">
                <b>{project.name}</b>
                {who.length > 0 && <div>{who.join(' · ')}</div>}
                <div className="qp-muted">วันที่ {date}</div>
              </div>
            </header>
            <table className="qp-table">
              <thead>
                <tr>
                  <th className="n">#</th>
                  <th>รายการ</th>
                  <th className="n">จำนวน</th>
                  <th className="n">ราคา/เครื่อง</th>
                  <th className="n">รวม</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="qp-muted">
                      ยังไม่มีเครื่องจักรในผัง
                    </td>
                  </tr>
                )}
                {quote.lines.map((l, i) => (
                  <tr key={l.key}>
                    <td className="n qp-no">{i + 1}</td>
                    <td className="qp-item">
                      <b>{l.name}</b>
                      {l.addons.length > 0 && <small>+ {l.addons.join(', ')}</small>}
                      {l.note && <small className="qp-muted">{l.note}</small>}
                    </td>
                    <td className="n" data-label="จำนวน">
                      {l.qty}
                    </td>
                    <td className="n" data-label="ราคา/เครื่อง">
                      {l.unit === null ? <i>สอบถาม</i> : fmtBaht(l.unit)}
                    </td>
                    <td className="n qp-amount" data-label="รวม">
                      {l.amount === null ? <i>สอบถาม</i> : fmtBaht(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="qp-total">
              <span>รวมทั้งสิ้น</span>
              <b>{fmtBaht(quote.total)}</b>
            </div>
            {notes.length > 0 && (
              <ul className="qp-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="qp-sign">
              <div>ผู้เสนอราคา</div>
              <div>ผู้อนุมัติ</div>
            </div>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
