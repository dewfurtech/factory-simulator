import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../editor2d/Toolbar';
import type { PrepSection } from '../model/prepSheet';
import { prepSheet } from '../model/prepSheet';
import type { Project } from '../model/types';

/** The plan as a PNG when it is on screen; from the 3D view the sheet goes without it. */
async function planPng(project: Project): Promise<Uint8Array | null> {
  const svg = document.querySelector<SVGSVGElement>('svg.plan-svg');
  if (!svg) return null;
  const { planPicture, shownScale, toPng } = await import('../editor2d/exportImage');
  const pic = await planPicture(svg, project, shownScale(svg));
  const blob = pic && (await toPng(pic));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export function PrepBlock({ section }: { section: PrepSection }) {
  return (
    <>
      <dl className="prep-rows">
        {section.rows.map((r) => (
          <div key={r.label} className={r.warn ? 'warn' : undefined}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="prep-todo">
        {section.todo.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}

/** What the customer has to prepare, as it will print, with the button that saves it as a PDF file. */
export function PrepPreview({ project, onClose }: { project: Project; onClose: () => void }) {
  const sections = useMemo(() => prepSheet(project), [project]);
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

  const savePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ prepPdf }, { download }] = await Promise.all([import('../model/prepPdf'), import('../editor2d/exportImage')]);
      const bytes = await prepPdf(project, sections, await planPng(project));
      download(new Blob([bytes], { type: 'application/pdf' }), `เตรียมหน้างาน ${project.name}.pdf`);
    } catch (e) {
      setError(`สร้าง PDF ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const client = [project.client?.company, project.client?.contact].filter(Boolean).join(' · ');
  return createPortal(
    <div className="qp-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-testid="prep-preview">
      <div className="qp-window" role="dialog" aria-modal="true" aria-label="เตรียมหน้างาน">
        <div className="qp-bar">
          <span className="qp-bar-title">เตรียมหน้างาน</span>
          <button className="btn btn-primary qp-save" onClick={() => void savePdf()} disabled={busy} data-testid="save-prep-pdf">
            <Icon name="download" />
            {busy ? 'กำลังสร้าง…' : 'บันทึก PDF'}
          </button>
          <button className="ib" onClick={onClose} title="ปิด (Esc)" aria-label="ปิด">
            <Icon name="close" />
          </button>
        </div>
        {error && <div className="qp-error">{error}</div>}
        <div className="qp-scroll">
          <article className="qp-sheet">
            <header className="qp-head">
              <div>
                <h1>เตรียมหน้างาน</h1>
                <div className="qp-muted">{[project.name, client].filter(Boolean).join(' · ')}</div>
              </div>
            </header>
            {sections.map((s) => (
              <section key={s.id} className="prep-sheet-part">
                <h2>{s.title}</h2>
                <PrepBlock section={s} />
                {s.table && (
                  <table className="adv-table">
                    <thead>
                      <tr>
                        {s.table.head.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
            <p className="qp-muted prep-note">ตัวเลขเป็นค่าประมาณจากผังนี้ ต้องให้วิศวกรตรวจกับหน้างานจริงก่อนติดตั้ง</p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
