import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { download } from '../editor2d/exportImage';
import { Icon } from '../editor2d/Toolbar';
import { useProject } from '../store/project';
import { LENGTH_UNITS, scaleLabel, UNIT_TH, type LengthUnit } from './sheet/geometry';
import { SHEET_H, SHEET_W } from './sheet/layout';
import { SheetSvg } from './sheet/SheetSvg';
import { buildDrawingSet, sheetDxf, type ViewsSheet } from './sheets';
import './drawings.css';

/** Whether the drawing set is open; the top bar button and the main menu both open it. */
const useDrawings = create<{ open: boolean }>(() => ({ open: false }));
export const openDrawings = () => useDrawings.setState({ open: true });
const closeDrawings = () => useDrawings.setState({ open: false });

/** The top bar button, and the drawing set itself while it is open (drawn straight into the page body, for print). */
export function DrawingsButton() {
  const open = useDrawings((s) => s.open);
  return (
    <>
      <button className="tb-toggle tb-desk" onClick={openDrawings} title="แบบก่อสร้าง: ชุดแบบ A3 แปลนพร้อมมิติ พิมพ์เป็น PDF หรือส่งออก DXF" data-testid="drawings-open">
        <Icon name="ruler" />
        <span>แบบก่อสร้าง</span>
      </button>
      {open && createPortal(<DrawingsPage close={closeDrawings} />, document.body)}
    </>
  );
}

/** The unit of the dimension numbers, remembered in this browser. */
const UNIT_KEY = 'drawings-unit';
function savedUnit(): LengthUnit {
  try {
    const u = localStorage.getItem(UNIT_KEY);
    return LENGTH_UNITS.includes(u as LengthUnit) ? (u as LengthUnit) : 'mm';
  } catch {
    return 'mm';
  }
}

/** A sheet on screen at 96 px to the inch, before zoom. */
const PX_PER_MM = 96 / 25.4;
const SHEET_PX = { w: SHEET_W * PX_PER_MM, h: SHEET_H * PX_PER_MM };

interface ViewState {
  zoom: number;
  x: number;
  y: number;
}

/**
 * The construction drawing set: the sheets listed on the left, the chosen one on the right to zoom (wheel, buttons)
 * and move (drag). Printing sends every sheet to the browser's print as one A3 landscape page each; DXF saves the
 * floor plan at full size in mm.
 */
function DrawingsPage({ close }: { close: () => void }) {
  const project = useProject((s) => s.project!);
  const [openedAt] = useState(() => Date.now());
  const [unit, pickUnit] = useState<LengthUnit>(savedUnit);
  const setUnit = (u: LengthUnit) => {
    pickUnit(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      // Storage off: the choice lasts while the page is open.
    }
  };
  const set = useMemo(() => buildDrawingSet(project, openedAt, unit), [project, openedAt, unit]);
  const [current, setCurrent] = useState(0);
  const sheet = set.sheets[Math.min(current, set.sheets.length - 1)];
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ zoom: 0.5, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const zoom = Math.max(0.05, Math.min((el.clientWidth - 32) / SHEET_PX.w, (el.clientHeight - 32) / SHEET_PX.h));
    setView({ zoom, x: (el.clientWidth - SHEET_PX.w * zoom) / 2, y: (el.clientHeight - SHEET_PX.h * zoom) / 2 });
  }, []);

  // Each sheet opens fitted to the stage, and stays fitted as the window changes until it is zoomed.
  const fitted = useRef(true);
  useLayoutEffect(() => {
    fitted.current = true;
    fit();
  }, [current, fit]);
  useEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => fitted.current && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

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

  /** Zooms by a factor about a point of the stage (its middle when none is given). */
  const zoomBy = useCallback((k: number, at?: { x: number; y: number }) => {
    const el = stage.current!;
    const p = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    fitted.current = false;
    setView((v) => {
      const zoom = Math.min(8, Math.max(0.05, v.zoom * k));
      const f = zoom / v.zoom;
      return { zoom, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f };
    });
  }, []);

  // The wheel zooms about the pointer; registered by hand so it can stop the page from scrolling.
  useEffect(() => {
    const el = stage.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    fitted.current = false;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const print = () => {
    const root = document.documentElement;
    root.classList.add('drawings-printing');
    const done = () => {
      root.classList.remove('drawings-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  // DXF: the sheet on screen when it has one, otherwise the first sheet that does (the floor plan).
  const dxfSheet = (sheet.kind === 'views' && sheet.dxf ? sheet : set.sheets.find((s): s is ViewsSheet => s.kind === 'views' && s.dxf)) ?? null;
  const exportDxf = () => {
    if (!dxfSheet) return;
    const name = `${project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'drawing'} ${dxfSheet.id}.dxf`;
    download(new Blob([sheetDxf(dxfSheet, unit)], { type: 'application/dxf' }), name);
  };

  const pages = set.sheets.length;
  return (
    <div className="drawings-root" data-testid="drawings">
      <div className="drawings-bar">
        <div className="drawings-title">
          <b>แบบก่อสร้าง</b>
          <span className="muted">A3 แนวนอน · {pages} แผ่น</span>
        </div>
        <div className="seg drawings-unit" role="radiogroup" aria-label="หน่วยของตัวเลขมิติ" title="หน่วยของตัวเลขมิติบนแบบ (เส้นและมาตราส่วนเท่าเดิม)">
          {LENGTH_UNITS.map((u) => (
            <button key={u} type="button" role="radio" aria-checked={unit === u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)} data-testid={`drawings-unit-${u}`}>
              {UNIT_TH[u]}
            </button>
          ))}
        </div>
        <div className="drawings-zoom" role="group" aria-label="ซูม">
          <button type="button" className="ib" onClick={() => zoomBy(1 / 1.25)} title="ซูมออก" aria-label="ซูมออก" data-testid="drawings-zoom-out">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M5 12h14" />
            </svg>
          </button>
          <span className="drawings-zoom-pct" data-testid="drawings-zoom">
            {Math.round(view.zoom * 100)}%
          </span>
          <button type="button" className="ib" onClick={() => zoomBy(1.25)} title="ซูมเข้า" aria-label="ซูมเข้า" data-testid="drawings-zoom-in">
            <Icon name="plus" />
          </button>
          <button type="button" className="ib" onClick={() => ((fitted.current = true), fit())} title="พอดีจอ" aria-label="พอดีจอ" data-testid="drawings-fit">
            <Icon name="fit" />
          </button>
        </div>
        <div className="drawings-actions">
          <button
            type="button"
            className="btn"
            onClick={exportDxf}
            disabled={!dxfSheet}
            title={dxfSheet ? `บันทึกแผ่น ${dxfSheet.id} เป็นไฟล์ DXF ขนาดจริง (พิกัดหน่วย มม. ตัวเลขมิติหน่วย ${UNIT_TH[unit]}) แยก layer` : 'ไม่มีแผ่นที่ส่งออก DXF ได้'}
            data-testid="drawings-dxf"
          >
            <Icon name="download" /> ส่งออก DXF
          </button>
          <button type="button" className="btn btn-primary" onClick={print} data-testid="drawings-print">
            <Icon name="download" /> พิมพ์ / บันทึก PDF
          </button>
          <button type="button" className="ib" onClick={close} title="ปิด (Esc)" aria-label="ปิด" data-testid="drawings-close">
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="drawings-body">
        <nav className="drawings-list" aria-label="สารบัญแผ่น">
          {set.sheets.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={i === current ? 'on' : ''}
              aria-current={i === current ? 'page' : undefined}
              onClick={() => setCurrent(i)}
              data-testid={`drawings-item-${s.id}`}
            >
              <b>{s.id}</b>
              <span>{s.title}</span>
              {s.scale && <span className="muted">{scaleLabel(s.scale)}</span>}
            </button>
          ))}
        </nav>
        <div className="drawings-stage" ref={stage} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="drawings-paper" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} data-testid="drawing-sheet" data-sheet={sheet.id}>
            <SheetSvg sheet={sheet} info={set.info} page={current + 1} pages={pages} />
          </div>
        </div>
      </div>
      {/*
        While this page is open the default print page is A3 landscape too. Chrome lays the whole document out at the
        default page's width; left at the BOQ's A4 (styles.css) the 420 mm sheets would be shrunk to fit it.
      */}
      <style>{'@media print { @page { size: A3 landscape; margin: 0; } }'}</style>
      {/* Every sheet once more at paper size, for print only. */}
      <div className="drawings-print" aria-hidden>
        {set.sheets.map((s, i) => (
          // A block around each sheet: Chrome gives a named @page to blocks, not to an <svg>.
          <div key={s.id} className="drawings-print-sheet">
            <SheetSvg sheet={s} info={set.info} page={i + 1} pages={pages} />
          </div>
        ))}
      </div>
    </div>
  );
}
