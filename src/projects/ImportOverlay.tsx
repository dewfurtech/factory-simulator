import { useEffect, useState } from 'react';
import { IMPORT_STAGES, useImport } from '../store/importProgress';

/** A loading screen over the app while a plan file is read and built into a project: what step it is on, and for how long. */
export function ImportOverlay() {
  const job = useImport((s) => s.job);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [!!job]);
  if (!job) return null;
  const at = IMPORT_STAGES.findIndex((s) => s.id === job.stage);
  const seconds = Math.floor((Date.now() - job.startedAt) / 1000);
  return (
    <div className="import-overlay" role="alertdialog" aria-busy="true" aria-label="กำลังนำเข้าแบบแปลน" data-testid="import-overlay">
      <div className="import-card glass">
        <div className="import-head">
          <span className="import-spinner" aria-hidden />
          <div>
            <b>กำลังนำเข้าแบบแปลน</b>
            <div className="muted small import-file" title={job.name}>
              {job.name}
            </div>
          </div>
        </div>
        <ol className="import-steps">
          {IMPORT_STAGES.map((s, i) => (
            <li key={s.id} className={i < at ? 'step-done' : i === at ? 'step-now' : undefined}>
              <i aria-hidden>{i < at ? '✓' : i + 1}</i>
              {s.label}
            </li>
          ))}
        </ol>
        <div className="muted small">ผ่านไป {seconds} วินาที · ไฟล์ PDF ใหญ่อาจใช้เวลาราว 1 นาที ระหว่างนี้หน้าจออาจค้างเป็นช่วงๆ</div>
      </div>
    </div>
  );
}
