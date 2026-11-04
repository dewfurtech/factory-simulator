import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { keyLetter, toolKey } from './editor2d/shortcuts';
import { BoardCard } from './panels/BoardCard';
import { PlanEditor } from './editor2d/PlanEditor';
import { Icon, Toolbar } from './editor2d/Toolbar';
import { deleteSelection, dispatchKey, objectKey } from './editor2d/tools';
import { CatalogPanel } from './panels/CatalogPanel';
import { SummaryPanel, SystemsPanel } from './panels/AdvisorPanel';
import { BuildingPanel } from './panels/BuildingPanel';
import { LayersPanel } from './panels/LayersPanel';
import { StarterDialog } from './panels/StarterDialog';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { ProjectInfo } from './panels/ProjectInfo';
import { download, planPicture, shownScale, svgBlob, toPng } from './editor2d/exportImage';
import { fmtBaht, quoteOf } from './model/quote';
import { exportProject, flushAutosave } from './store/persist';
import { useProject } from './store/project';
import { createShare, lastSender, shareUrl } from './store/share';
import { SELECT, useUi, type Dock, type ViewMode } from './store/ui';
import { shareDialog } from './ui/Dialog';

import { Loading3D } from './ui/Loading3D';
const View3D = lazy(() => import('./view3d/View3D'));

/** The floor switch (ชั้น 1 / ชั้น 2) on the plan; hidden for the MVP. */
const LEVELS_ON = false;

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;
      // Held down, the backslash fades the drawing to show the plan image beneath; released, it comes back.
      if (e.key === '\\' && !mod) {
        e.preventDefault();
        if (!e.repeat && !ui.peek) ui.set({ peek: true });
        return;
      }
      if (mod && keyLetter(e) === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProject.getState().undo();
        return;
      }
      if (mod && (keyLetter(e) === 'y' || (keyLetter(e) === 'z' && e.shiftKey))) {
        e.preventDefault();
        useProject.getState().redo();
        return;
      }
      if (dispatchKey(e) || objectKey(e) || toolKey(e)) {
        e.preventDefault();
        return;
      }
      if (mod) return;
      if (e.key === 'Delete') deleteSelection();
      if (e.key === 'Escape') {
        if (ui.tool.kind !== 'select') ui.setTool(SELECT);
        else if (ui.selection || ui.boxed.length) ui.set({ selection: null });
        else if (ui.panelOpen) ui.set({ panelOpen: false });
      }
    };
    const endPeek = (e?: KeyboardEvent) => {
      if ((!e || e.key === '\\') && useUi.getState().peek) useUi.getState().set({ peek: false });
    };
    const onBlur = () => endPeek();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', endPeek);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', endPeek);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

const VIEWS: { id: ViewMode; label: string; icon: string }[] = [
  { id: '2d', label: '2D', icon: 'view2d' },
  { id: '3d', label: '3D', icon: 'view3d' },
];

/** The four steps of a proposal, in the order the work goes. A customer on a share link gets the two that are theirs. */
const STEPS: { id: Dock; label: string; icon: string; seller?: boolean }[] = [
  { id: 'building', label: 'อาคาร', icon: 'factory', seller: true },
  { id: 'catalog', label: 'เครื่องจักร', icon: 'machine' },
  { id: 'systems', label: 'งานระบบ', icon: 'elec', seller: true },
  { id: 'summary', label: 'สรุป', icon: 'report' },
];

function StepNav() {
  const dock = useUi((s) => s.dock);
  const customer = useUi((s) => !!s.customer);
  return (
    <nav className="step-nav" aria-label="ขั้นตอน" data-testid="step-nav">
      {STEPS.filter((s) => !customer || !s.seller).map((s) => {
        const on = dock === s.id || (s.id === 'building' && dock === 'layers');
        return (
          <button key={s.id} className={on ? 'on' : undefined} onClick={() => useUi.getState().toggleDock(s.id)} aria-pressed={on} data-testid={`dock-${s.id}`}>
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** What the layout comes to so far; a click opens the summary with the quotation. */
function PriceChip() {
  const project = useProject((s) => s.project!);
  const total = useMemo(() => quoteOf(project).total, [project]);
  return (
    <button className="tb-price" onClick={() => useUi.getState().set({ dock: 'summary', summaryTab: 'score' })} title="ราคารวมเครื่องจักร" data-testid="price-chip">
      {fmtBaht(total)}
    </button>
  );
}

function BarButton({
  icon,
  label,
  on,
  disabled,
  onClick,
  testId,
  className,
}: {
  icon: string;
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      className={`ib${on ? ' on' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      data-testid={testId}
    >
      <Icon name={icon} />
    </button>
  );
}

/** The plan as a picture, PNG or SVG, when the 2D plan is on screen to take it from. */
async function savePlanPicture(name: string, format: 'png' | 'svg') {
  const svg = document.querySelector<SVGSVGElement>('svg.plan-svg');
  const project = useProject.getState().project;
  if (!svg || !project) return;
  const pic = await planPicture(svg, project, shownScale(svg));
  if (!pic) return;
  const blob = format === 'svg' ? svgBlob(pic) : await toPng(pic);
  if (blob) download(blob, `${name}.${format}`);
}

/**
 * Makes a link to the open project as it stands. From the full editor it goes out to a customer; from a share link
 * it is the customer's arrangement going back to the seller.
 */
function shareProject() {
  const { customer } = useUi.getState();
  flushAutosave();
  const make = async (note: string, sender: string) => {
    const project = useProject.getState().project!;
    const who = sender || undefined;
    const id = await createShare(project, customer ? { from: 'customer', note, parent: customer.shareId, sender: who } : { from: 'vendor', note, sender: who });
    return shareUrl(id);
  };
  const sender = lastSender();
  return customer
    ? shareDialog({
        title: 'ส่งการจัดวางกลับ',
        message: 'สร้างลิงก์ของแปลนตามที่คุณย้ายเครื่องไว้ แล้วส่งลิงก์นั้นกลับให้ผู้ขาย',
        ok: 'สร้างลิงก์',
        sender,
        make,
      })
    : shareDialog({
        title: 'แชร์ลิงก์ให้ลูกค้า',
        message: 'ลูกค้าเปิดลิงก์แล้วเห็นแปลนนี้ ย้ายเครื่องเองได้ และส่งการจัดวางกลับมาเป็นลิงก์ใหม่ แปลนในลิงก์เป็นสำเนา ณ ตอนนี้ แก้ต่อที่นี่ไม่กระทบลิงก์',
        ok: 'สร้างลิงก์',
        sender,
        make,
      });
}

/** The strip over the plan when it came from a share link: whose it is, their note, and the way to send it back. */
function ShareBanner() {
  const customer = useUi((s) => s.customer);
  const closed = useUi((s) => s.bannerClosed);
  if (!customer || closed) return null;
  const reply = customer.from === 'customer';
  return (
    <div className="share-banner glass" data-testid="share-banner">
      <Icon name={reply ? 'reply' : 'share'} />
      <div className="share-text">
        <strong>
          {reply ? 'การจัดวางที่ลูกค้าส่งกลับมา' : 'แปลนที่ผู้ขายส่งมาให้ดู'}
          {customer.sender && <span className="share-from"> · จาก {customer.sender}</span>}
        </strong>
        <span>{reply ? 'เปิดในโหมดแก้ไขเต็มได้จากเมนูมุมซ้ายบน' : 'ลากเครื่องเพื่อย้าย กด R หมุน แล้วกด "ส่งกลับ" เพื่อส่งการจัดวางของคุณ'}</span>
        {customer.note && <q data-testid="share-note-shown">{customer.note}</q>}
      </div>
      <button className="ib sm share-close" onClick={() => useUi.getState().set({ bannerClosed: true })} title="ปิด" aria-label="ปิด" data-testid="share-banner-close">
        <Icon name="close" />
      </button>
    </div>
  );
}

function MainMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  const p = useProject((s) => s.project!);
  const hasPlan = useUi((s) => s.view === '2d');
  const customer = useUi((s) => !!s.customer);
  return (
    <div className="tb-menu" ref={root}>
      <BarButton icon="menu" label="เมนู" on={open} onClick={() => setOpen(!open)} testId="main-menu" />
      {open && (
        <div className="tb-pop glass" role="menu">
          {customer ? (
            <a role="menuitem" href={`#/p/${p.id}`} data-testid="open-full-editor">
              <Icon name="edit" /> เปิดในโหมดแก้ไขเต็ม
            </a>
          ) : (
            <a role="menuitem" href="#/">
              <Icon name="back" /> กลับไปรายการโรงงาน
            </a>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), void shareProject())} data-testid="menu-share">
            <Icon name={customer ? 'reply' : 'share'} /> {customer ? 'ส่งการจัดวางกลับเป็นลิงก์' : 'แชร์ลิงก์ให้ลูกค้า'}
          </button>
          {!customer && (
            <a role="menuitem" href="#/admin" data-testid="open-admin">
              <Icon name="settings" /> ตั้งค่าระบบลมและไฟฟ้า
            </a>
          )}
          <button
            role="menuitem"
            onClick={() =>
              void exportProject(p.id)
                .then((b) => download(b, `${p.name}.factory.json`))
                .then(() => setOpen(false))
            }
          >
            <Icon name="download" /> ส่งออกไฟล์ (.json)
          </button>
          <button
            role="menuitem"
            disabled={!hasPlan}
            title={hasPlan ? undefined : 'เปิดมุมมอง 2D ก่อน'}
            onClick={() => void savePlanPicture(p.name, 'png').then(() => setOpen(false))}
            data-testid="export-png"
          >
            <Icon name="image" /> บันทึกแปลนเป็นรูป (PNG)
          </button>
          <button
            role="menuitem"
            disabled={!hasPlan}
            title={hasPlan ? undefined : 'เปิดมุมมอง 2D ก่อน'}
            onClick={() => void savePlanPicture(p.name, 'svg').then(() => setOpen(false))}
            data-testid="export-svg"
          >
            <Icon name="image" /> บันทึกแปลนเป็นไฟล์ SVG
          </button>
        </div>
      )}
    </div>
  );
}

export function Editor() {
  useKeyboard();
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const view = useUi((s) => s.view);
  const dock = useUi((s) => s.dock);
  const panelOpen = useUi((s) => s.panelOpen);
  const level = useProject((s) => s.level);
  // Floors are off for the MVP: the plan always shows floor 1. Set LEVELS_ON to bring the floor switch back.
  const hasUpper = useProject((s) => LEVELS_ON && !!s.project!.upper);
  const customer = useUi((s) => !!s.customer);
  const set = useUi.getState().set;
  // Measuring the scale is the one thing to do then: the panels and other tools step aside until it is done or skipped.
  const calibrating = useUi((s) => s.tool.kind === 'calibrate');
  // The right panel opens only when asked for: from the right-click menu or the button in the top bar.
  const showPanel = panelOpen && !calibrating;
  const starterOpen = useUi((s) => s.starterOpen);

  return (
    <div className={`editor${dock && !calibrating ? ' with-dock' : ''}${calibrating ? ' calibrating' : ''}`}>
      <header className="topbar">
        <div className="tb-group tb-left">
          <MainMenu />
          <div className="brand nf nf-logo tb-desk">
            <i>[</i>neofurtech<i>]</i>
          </div>
          <ProjectInfo />
          <span className="tb-sep tb-desk" />
          <BarButton icon="undo" label="เลิกทำ (Ctrl+Z)" disabled={!canUndo} onClick={() => useProject.getState().undo()} />
          <BarButton icon="redo" label="ทำซ้ำ (Ctrl+Y)" disabled={!canRedo} onClick={() => useProject.getState().redo()} className="tb-desk" />
        </div>
        <div className="tb-center">
          <div className="seg seg-icons seg-view" role="tablist" aria-label="มุมมอง">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                className={view === v.id ? 'on' : ''}
                onClick={() => set(v.id === '2d' ? { view: '2d', simOn: false } : { view: '3d' })}
                title={v.label}
                data-testid={`view-${v.id}`}
              >
                <Icon name={v.icon} />
                <span>{v.label}</span>
              </button>
            ))}
          </div>
          {view !== '3d' && hasUpper && (
            <div className="seg" role="tablist" aria-label="ชั้น" title="ชั้นที่แสดงในแปลน 2D">
              {['ชั้น 1', 'ชั้น 2'].map((label, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={level === i}
                  className={level === i ? 'on' : ''}
                  onClick={() => (set({ selection: null, boxed: [] }), useProject.getState().setLevel(i))}
                  data-testid={`level-${i}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tb-group tb-right">
          <PriceChip />
          <button
            className="tb-toggle tb-accent"
            onClick={() => void shareProject()}
            title={customer ? 'สร้างลิงก์การจัดวางของคุณ ส่งกลับให้ผู้ขาย' : 'สร้างลิงก์ให้ลูกค้าเปิดดูและย้ายเครื่องเอง'}
            data-testid="share-link"
          >
            <Icon name={customer ? 'reply' : 'share'} />
            <span>{customer ? 'ส่งกลับ' : 'แชร์ลิงก์'}</span>
          </button>
        </div>
      </header>
      {!calibrating && <StepNav />}
      {dock && !calibrating && (
        <div className="dock-col">
          {/* Phones only: the panel is a sheet over the plan, closed from its corner. */}
          <button className="ib dock-close" onClick={() => set({ dock: null })} title="ปิด" aria-label="ปิด" data-testid="dock-close">
            <Icon name="close" />
          </button>
          {dock === 'catalog' && <CatalogPanel />}
          {dock === 'building' && <BuildingPanel />}
          {dock === 'systems' && <SystemsPanel />}
          {dock === 'summary' && <SummaryPanel />}
          {dock === 'layers' && <LayersPanel />}
        </div>
      )}
      <main className="viewport">
        <ShareBanner />
        {!calibrating && <BoardCard />}
        <div className={`panes view-${view}`}>
          {view === '2d' && (
            <div className="pane">
              <Toolbar />
              <PlanEditor />
            </div>
          )}
          {view === '3d' && (
            <div className="pane">
              <Suspense fallback={<Loading3D />}>
                <View3D />
              </Suspense>
            </div>
          )}
        </div>
      </main>
      {showPanel && <PropertiesPanel />}
      {starterOpen && <StarterDialog />}
    </div>
  );
}
