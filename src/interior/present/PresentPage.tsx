import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Icon } from '../../editor2d/Toolbar';
import { fmtArea } from '../../format';
import type { Project, Size3 } from '../../model/types';
import { useProject } from '../../store/project';
import { useUi } from '../../store/ui';
import { thumbnail } from '../../view3d/thumbs';
import { SURFACE_LABEL } from '../materials';
import { Swatch, useAssetUrl } from '../MaterialPicker';
import { dropView, keepCurrentView, takePictures } from './capture';
import { buildSheets, SECTIONS, sheetHeading, type CabinetLine, type PieceLine, type SectionId, type Sheet, type SheetImage } from './sheets';
import './present.css';

/** Whether the presentation is open; the top bar button and the main menu both open it. */
const usePresent = create<{ open: boolean }>(() => ({ open: false }));
export const openPresentation = () => usePresent.setState({ open: true });
const closePresentation = () => usePresent.setState({ open: false });

/** The top bar button, and the presentation itself while it is open (drawn straight into the page body, for print). */
export function PresentButton() {
  const open = usePresent((s) => s.open);
  return (
    <>
      <button className="tb-toggle tb-desk" onClick={openPresentation} title="นำเสนอลูกค้า: แผ่น A3 จากโปรเจกต์ พิมพ์หรือบันทึกเป็น PDF" data-testid="present-open">
        <Icon name="image" />
        <span>นำเสนอ</span>
      </button>
      {open && createPortal(<PresentPage close={closePresentation} />, document.body)}
    </>
  );
}

const fmtSize3 = (s: Size3) => `${(s.w / 1000).toFixed(2)} × ${(s.d / 1000).toFixed(2)} × ${(s.h / 1000).toFixed(2)} ม.`;
/** One sheet is 420 mm wide; the screen shows it at 96 px to the inch, before it is scaled to fit. */
const SHEET_PX = (420 / 25.4) * 96;

interface Taken {
  plan: string | null;
  view3d: string | null;
  busy: boolean;
}

/**
 * The client presentation: A3 landscape sheets, one under another, made from the project as it is now. Sections
 * can be ticked off; the print button sends just the sheets to the browser's print (save as PDF there).
 */
function PresentPage({ close }: { close: () => void }) {
  const project = useProject((s) => s.project!);
  const [openedAt] = useState(() => Date.now());
  const { sheets, missing } = useMemo(() => buildSheets(project, openedAt), [project, openedAt]);
  const [off, setOff] = useState<Set<SectionId>>(() => new Set());
  const [taken, setTaken] = useState<Taken>({ plan: null, view3d: null, busy: true });
  const has3d = useUi((s) => !!s.snapshot3d);
  const [keeping, setKeeping] = useState(false);
  const [scale, setScale] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);

  // The plan and the 3D view are taken once, as the page opens; the 3D view only when the cover needs it.
  useEffect(() => {
    let gone = false;
    const urls: string[] = [];
    const url = (b: Blob | null) => (b ? (urls.push(URL.createObjectURL(b)), urls[urls.length - 1]) : null);
    const cover = sheets.find((s) => s.section === 'cover');
    // An empty project has nothing to show in 3D.
    const drawn = Object.keys(project.plan.rooms).length > 0 || project.objects.length > 0;
    void takePictures(project, drawn && cover?.section === 'cover' && cover.image.source === 'live3d').then((p) => {
      if (!gone) setTaken({ plan: url(p.plan), view3d: url(p.view3d), busy: false });
    });
    return () => {
      gone = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // Every sheet is drawn at its real size in mm and scaled down together to the width there is.
  useEffect(() => {
    const el = scroller.current!;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / SHEET_PX));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const shown = sheets.filter((s) => !off.has(s.section));
  const toggle = (id: SectionId) =>
    setOff((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const print = () => {
    const root = document.documentElement;
    root.classList.add('present-printing');
    const done = () => {
      root.classList.remove('present-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const keep = async () => {
    setKeeping(true);
    try {
      await keepCurrentView();
    } finally {
      setKeeping(false);
    }
  };

  const count = (id: SectionId) => sheets.filter((s) => s.section === id).length;
  const newestShot = [...(project.shots ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0];

  return (
    <div className="present-root" data-testid="present">
      <div className="present-bar">
        <div className="present-title">
          <b>นำเสนอลูกค้า</b>
          <span className="muted">A3 แนวนอน · {shown.length} แผ่น</span>
        </div>
        <div className="present-picks" role="group" aria-label="แผ่นที่จะใส่">
          {SECTIONS.map(({ id, label }) => (
            <label key={id} className={count(id) ? '' : 'off'} title={missing[id]}>
              <input type="checkbox" checked={!!count(id) && !off.has(id)} disabled={!count(id)} onChange={() => toggle(id)} data-testid={`present-pick-${id}`} />
              {label}
              {count(id) > 1 && <span className="muted"> ({count(id)})</span>}
            </label>
          ))}
        </div>
        <div className="present-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void keep()}
            disabled={!has3d || keeping || taken.busy}
            title={has3d ? 'เก็บภาพมุมมอง 3D ที่เปิดอยู่ไว้ในแผ่นภาพห้อง' : 'ปิดหน้านี้ เปิดมุมมอง 3D แล้วหมุนไปมุมที่ต้องการ แล้วเปิดนำเสนออีกครั้ง'}
            data-testid="present-keep-view"
          >
            <Icon name="plus" /> {keeping ? 'กำลังเก็บภาพ…' : 'เพิ่มมุมนี้'}
          </button>
          <button type="button" className="btn btn-primary" onClick={print} disabled={!shown.length || taken.busy} data-testid="present-print">
            <Icon name="download" /> พิมพ์ / บันทึก PDF
          </button>
          <button type="button" className="ib" onClick={close} title="ปิด (Esc)" aria-label="ปิด" data-testid="present-close">
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="present-scroll" ref={scroller}>
        <div className="present-sheets" style={{ '--present-scale': scale } as React.CSSProperties}>
          {shown.map((s, i) => (
            <div className="present-fit" key={`${s.section}-${'part' in s ? s.part : 0}`}>
              <SheetFrame sheet={s} page={i + 1} pages={shown.length} project={project}>
                {s.section === 'cover' && <Cover sheet={s} taken={taken} fallback={newestShot?.assetId} />}
                {s.section === 'plan' && <Plan sheet={s} taken={taken} />}
                {s.section === 'mood' && <Mood sheet={s} />}
                {s.section === 'furniture' && <Furniture sheet={s} />}
                {s.section === 'images' && <Images sheet={s} />}
              </SheetFrame>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SheetFrame({ sheet, page, pages, project, children }: { sheet: Sheet; page: number; pages: number; project: Project; children: React.ReactNode }) {
  return (
    <section className={`present-sheet present-sheet-${sheet.section}`} data-testid={`sheet-${sheet.section}`}>
      {sheet.section !== 'cover' && <h2 className="present-h">{sheetHeading(sheet)}</h2>}
      <div className="present-body">{children}</div>
      <footer className="present-foot">
        <span>{project.name}</span>
        <span>
          หน้า {page}/{pages}
        </span>
      </footer>
    </section>
  );
}

/** A picture from the asset store, or a note while it loads. */
function AssetImage({ assetId, alt, className }: { assetId: string; alt: string; className?: string }) {
  const url = useAssetUrl(assetId);
  return url ? <img className={className} src={url} alt={alt} /> : <div className={`present-noimg ${className ?? ''}`} />;
}

function Cover({ sheet, taken, fallback }: { sheet: Extract<Sheet, { section: 'cover' }>; taken: Taken; fallback?: string }) {
  const img = sheet.image;
  const picture =
    img.source === 'render' ? (
      <AssetImage className="present-cover-img" assetId={img.assetId} alt="ภาพหลักของโปรเจกต์" />
    ) : taken.view3d ? (
      <img className="present-cover-img" src={taken.view3d} alt="มุมมอง 3D" />
    ) : fallback ? (
      <AssetImage className="present-cover-img" assetId={fallback} alt="มุมมอง 3D" />
    ) : taken.plan ? (
      <img className="present-cover-img contain" src={taken.plan} alt="แปลน" />
    ) : taken.busy ? (
      <div className="present-noimg present-cover-img">กำลังถ่ายภาพ…</div>
    ) : null;
  return (
    <div className={`present-cover-in${picture ? '' : ' text-only'}`}>
      {picture && <div className="present-cover-pic">{picture}</div>}
      <div className="present-cover-text">
        <h1 data-testid="cover-title">{sheet.title}</h1>
        {sheet.client.map((c) => (
          <p key={c} className="present-cover-client" data-testid="cover-client">
            {c}
          </p>
        ))}
        <p className="present-cover-date">{sheet.date}</p>
      </div>
    </div>
  );
}

function Plan({ sheet, taken }: { sheet: Extract<Sheet, { section: 'plan' }>; taken: Taken }) {
  const total = sheet.rooms.reduce((s, r) => s + r.area, 0);
  return (
    <div className="present-plan-in">
      <div className="present-plan-pic">
        {taken.plan ? (
          <img src={taken.plan} alt="แปลน 2D" data-testid="plan-picture" />
        ) : (
          <div className="present-noimg">{taken.busy ? 'กำลังถ่ายภาพแปลน…' : 'ไม่มีแปลนให้ถ่าย'}</div>
        )}
      </div>
      <table className="present-table">
        <thead>
          <tr>
            <th>ห้อง</th>
            <th className="num">พื้นที่</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rooms.map((r, i) => (
            <tr key={i}>
              <td>
                {r.name}
                {r.floor && <span className="muted"> · {r.floor}</span>}
              </td>
              <td className="num">{fmtArea(r.area)}</td>
            </tr>
          ))}
        </tbody>
        {sheet.rooms.length > 1 && (
          <tfoot>
            <tr>
              <td>รวม</td>
              <td className="num">{fmtArea(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Mood({ sheet }: { sheet: Extract<Sheet, { section: 'mood' }> }) {
  return (
    <div className="present-mood-in">
      {sheet.palette.length > 0 && (
        <div className="present-palette" data-testid="present-palette">
          {sheet.palette.map((c) => (
            <div key={c}>
              <i style={{ background: c }} />
              <span>{c.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="present-materials">
        {sheet.materials.map((l) => (
          <div key={l.material.id} className="present-material" data-testid="present-material">
            <Swatch material={l.material} size={150} />
            <div>
              <b>{l.material.name}</b>
              <span className="muted"> {l.material.color.toUpperCase()}</span>
              {l.uses.map((u, i) => (
                <div key={i} className="present-use">
                  {u.room} · {SURFACE_LABEL[u.surface]} · {fmtArea(u.area)}
                </div>
              ))}
              <div className="present-use total">รวม {fmtArea(l.area)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function useThumb(id: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    thumbnail(id, (u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

function PieceCard({ line, cabinet }: { line: PieceLine; cabinet?: CabinetLine }) {
  const url = useThumb(line.assetId);
  return (
    <div className="present-piece" data-testid="present-piece">
      <div className="present-thumb">{url ? <img src={url} alt="" /> : null}</div>
      <div>
        <b>{line.name}</b>
        <span className="present-count"> × {line.count}</span>
        <div className="present-use">ก × ล × ส {fmtSize3(line.size)}</div>
        {cabinet?.kind && cabinet.kind !== line.name && <div className="present-use">{cabinet.kind}</div>}
        {cabinet?.boards.map((b) => (
          <div key={b.part} className="present-use">
            {b.part}: {b.text}
          </div>
        ))}
        {cabinet?.colors.map((b) => (
          <div key={b.part} className="present-use">
            {b.part}: {b.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Furniture({ sheet }: { sheet: Extract<Sheet, { section: 'furniture' }> }) {
  return (
    <div className="present-pieces">
      {sheet.pieces.map((l, i) => (
        <PieceCard key={`p${i}`} line={l} />
      ))}
      {sheet.cabinets.map((l, i) => (
        <PieceCard key={`c${i}`} line={l} cabinet={l} />
      ))}
    </div>
  );
}

const imageLabel = (i: SheetImage) =>
  `${i.source === 'render' ? 'ภาพ AI' : 'มุมมอง 3D'} · ${new Date(i.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`;

function Images({ sheet }: { sheet: Extract<Sheet, { section: 'images' }> }) {
  return (
    <div className={`present-images n${sheet.images.length}`}>
      {sheet.images.map((im) => (
        <figure key={im.id} data-testid={`present-image-${im.source}`}>
          <AssetImage assetId={im.assetId} alt={imageLabel(im)} />
          <figcaption>{imageLabel(im)}</figcaption>
          {im.source === 'shot' && (
            <button type="button" className="ib sm danger present-noprint" onClick={() => dropView(im.id)} title="ลบมุมนี้ออกจากโปรเจกต์" aria-label="ลบมุมนี้">
              <Icon name="trash" />
            </button>
          )}
        </figure>
      ))}
    </div>
  );
}
