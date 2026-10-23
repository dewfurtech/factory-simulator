import { useEffect, useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import type { Client } from '../model/types';
import { applyEdit, useProject } from '../store/project';
import { useUi } from '../store/ui';

type Fields = { name: string } & Required<Client>;

const FIELDS: { key: keyof Fields; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'name', label: 'ชื่อโปรเจกต์', placeholder: 'เช่น โรงงาน ABC เฟส 2' },
  { key: 'company', label: 'บริษัทลูกค้า', placeholder: 'ชื่อบริษัทหรือร้าน' },
  { key: 'contact', label: 'ผู้ติดต่อ', placeholder: 'ชื่อคนที่คุยด้วย' },
  { key: 'phone', label: 'เบอร์โทร', placeholder: '08x-xxx-xxxx' },
  { key: 'note', label: 'หมายเหตุ', placeholder: 'ความต้องการ งบ กำหนดส่ง ฯลฯ', multiline: true },
];

/**
 * The project's name in the top bar, and a click opens what the plan is for: its name and the customer's company,
 * contact, phone and a note. Changes are saved when the panel closes, as one step that undo can take back.
 * A customer opening a share link sees the name only.
 */
export function ProjectInfo() {
  const name = useProject((s) => s.project!.name);
  const company = useProject((s) => s.project!.client?.company);
  const customer = useUi((s) => !!s.customer);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Fields | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const start = () => {
    const p = useProject.getState().project!;
    setDraft({ name: p.name, company: p.client?.company ?? '', contact: p.client?.contact ?? '', phone: p.client?.phone ?? '', note: p.client?.note ?? '' });
    setOpen(true);
  };
  // Closing writes back what changed; an empty name keeps the old one.
  const finish = (d: Fields | null = draft) => {
    setOpen(false);
    if (!d) return;
    applyEdit((p) => {
      const n = d.name.trim();
      if (n && n !== p.name) p.name = n;
      const client: Client = {};
      for (const k of ['company', 'contact', 'phone', 'note'] as const) {
        const v = d[k].trim();
        if (v) client[k] = v;
      }
      const before = JSON.stringify(p.client ?? {});
      if (JSON.stringify(client) === before) return;
      if (Object.keys(client).length) p.client = client;
      else delete p.client;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && finish();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, draft]);

  if (customer)
    return (
      <span className="title tb-desk" title={name}>
        {name}
      </span>
    );
  return (
    <div className="project-info tb-desk" ref={root}>
      <button className={`project-title${open ? ' on' : ''}`} onClick={() => (open ? finish() : start())} title="ชื่อโปรเจกต์และข้อมูลลูกค้า" data-testid="project-title">
        <span className="project-name">{name}</span>
        {company && <span className="project-company">{company}</span>}
        <Icon name="edit" />
      </button>
      {open && draft && (
        <form
          className="project-pop glass"
          data-testid="project-info"
          onSubmit={(e) => {
            e.preventDefault();
            finish();
          }}
        >
          {FIELDS.map((f) => (
            <label key={f.key} className="pi-field">
              <span>{f.label}</span>
              {f.multiline ? (
                <textarea rows={3} value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} data-testid={`pi-${f.key}`} />
              ) : (
                <input
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  autoFocus={f.key === 'name'}
                  inputMode={f.key === 'phone' ? 'tel' : undefined}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  data-testid={`pi-${f.key}`}
                />
              )}
            </label>
          ))}
          <div className="pi-actions">
            <span className="muted small">บันทึกเมื่อปิดแผงนี้ · ข้อมูลลูกค้าไม่ไปกับลิงก์แชร์</span>
            <button type="submit" className="btn btn-primary btn-sm" data-testid="pi-done">
              เสร็จ
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
