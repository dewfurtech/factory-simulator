import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PlanEditor } from './editor2d/PlanEditor';
import { Icon, Toolbar } from './editor2d/Toolbar';
import { deleteSelection, dispatchKey, objectKey } from './editor2d/tools';
import { CatalogPanel } from './panels/CatalogPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { ProjectInfo } from './panels/ProjectInfo';
import { download, planPicture, shownScale, svgBlob, toPng } from './editor2d/exportImage';
import { exportProject, flushAutosave } from './store/persist';
import { useProject } from './store/project';
import { createShare, lastSender, shareUrl } from './store/share';
import { SELECT, useUi, type ViewMode } from './store/ui';
import { shareDialog } from './ui/Dialog';
import { openFlowDialog } from './ui/FlowDialog';

import { Loading3D } from './ui/Loading3D';
const View3D = lazy(() => import('./view3d/View3D'));

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/** The editor's shortcuts: undo, redo, delete, Escape, the peek key, and each tool's own. The interior editor shares them. */
export function useKeyboard() {
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
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProject.getState().undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        useProject.getState().redo();
        return;
      }
      if (dispatchKey(e) || objectKey(e)) {
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

export const VIEWS: { id: ViewMode; label: string; icon: string }[] = [
  { id: '2d', label: '2D', icon: 'view2d' },
  { id: 'split', label: 'แบ่งจอ', icon: 'split' },
  { id: '3d', label: '3D', icon: 'view3d' },
];

export function BarButton({
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
/** What a customer moves about on a shared plan: machines in a factory, furniture in an interior. */
const movable = () => (useProject.getState().project?.kind === 'interior' ? 'เฟอร์นิเจอร์' : 'เครื่อง');

export function shareProject() {
  const { customer } = useUi.getState();
  flushAutosave();
  const make = async (note: string, sender: string) => {
    const project = useProject.getState().project!;
    const who = sender || undefined;
    const id = await createShare(project, customer ? { from: 'customer', note, parent: customer.shareId, sender: who } : { from: 'vendor', note, sender: who });
    return shareUrl(id);
  };
  const sender = lastSender();
  const thing = movable();
  return customer
    ? shareDialog({
        title: 'ส่งการจัดวางกลับ',
        message: `สร้างลิงก์ของแปลนตามที่คุณย้าย${thing}ไว้ แล้วส่งลิงก์นั้นกลับให้ผู้ขาย`,
        ok: 'สร้างลิงก์',
        sender,
        make,
      })
    : shareDialog({
        title: 'แชร์ลิงก์ให้ลูกค้า',
        message: `ลูกค้าเปิดลิงก์แล้วเห็นแปลนนี้ ย้าย${thing}เองได้ และส่งการจัดวางกลับมาเป็นลิงก์ใหม่ แปลนในลิงก์เป็นสำเนา ณ ตอนนี้ แก้ต่อที่นี่ไม่กระทบลิงก์`,
        ok: 'สร้างลิงก์',
        sender,
        make,
      });
}

/** The strip over the plan when it came from a share link: whose it is, their note, and the way to send it back. */
export function ShareBanner() {
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
        <span>{reply ? 'เปิดในโหมดแก้ไขเต็มได้จากเมนูมุมซ้ายบน' : `ลาก${movable()}เพื่อย้าย กด R หมุน แล้วกด "ส่งกลับ" เพื่อส่งการจัดวางของคุณ`}</span>
        {customer.note && <q data-testid="share-note-shown">{customer.note}</q>}
      </div>
      <button className="ib sm share-close" onClick={() => useUi.getState().set({ bannerClosed: true })} title="ปิด" aria-label="ปิด" data-testid="share-banner-close">
        <Icon name="close" />
      </button>
    </div>
  );
}

/** The menu behind the top-left button; `back` is the list it goes back to (the factory list by default). */
/** The main menu; `extra` adds items of the caller's own at its end (each gets a `close` to call when picked). */
export function MainMenu({ back = 'กลับไปรายการโรงงาน', extra }: { back?: string; extra?: (close: () => void) => React.ReactNode } = {}) {
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
  const hasPlan = useUi((s) => s.view !== '3d');
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
              <Icon name="back" /> {back}
            </a>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), void shareProject())} data-testid="menu-share">
            <Icon name={customer ? 'reply' : 'share'} /> {customer ? 'ส่งการจัดวางกลับเป็นลิงก์' : 'แชร์ลิงก์ให้ลูกค้า'}
          </button>
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
            title={hasPlan ? undefined : 'เปิดมุมมอง 2D หรือแบ่งจอก่อน'}
            onClick={() => void savePlanPicture(p.name, 'png').then(() => setOpen(false))}
            data-testid="export-png"
          >
            <Icon name="image" /> บันทึกแปลนเป็นรูป (PNG)
          </button>
          <button
            role="menuitem"
            disabled={!hasPlan}
            title={hasPlan ? undefined : 'เปิดมุมมอง 2D หรือแบ่งจอก่อน'}
            onClick={() => void savePlanPicture(p.name, 'svg').then(() => setOpen(false))}
            data-testid="export-svg"
          >
            <Icon name="image" /> บันทึกแปลนเป็นไฟล์ SVG
          </button>
          {/* The dialog writes a factory hall's prompt for a factory, a room's for an interior. */}
          <button role="menuitem" onClick={() => (setOpen(false), void openFlowDialog())} data-testid="menu-flow">
            <Icon name="bulb" /> {p.kind === 'interior' ? 'สร้างภาพห้องด้วย Google Flow' : 'สร้างภาพโรงงานด้วย Google Flow'}
          </button>
          {extra?.(() => setOpen(false))}
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
  const hasSelection = useUi((s) => !!s.selection || s.boxed.length > 0);
  const snapOn = useUi((s) => s.snapOn);
  const level = useProject((s) => s.level);
  const hasUpper = useProject((s) => !!s.project!.upper);
  const customer = useUi((s) => !!s.customer);
  const set = useUi.getState().set;
  // The right panel slides out whenever something is picked, and on demand for the factory's own settings.
  const showPanel = hasSelection || panelOpen;

  return (
    <div className={`editor${dock ? ' with-dock' : ''}`}>
      <header className="topbar">
        <div className="tb-group tb-left">
          <MainMenu />
          <div className="brand tb-desk">
            <Icon name="factory" />
          </div>
          <ProjectInfo />
          <span className="tb-sep tb-desk" />
          <BarButton icon="undo" label="เลิกทำ (Ctrl+Z)" disabled={!canUndo} onClick={() => useProject.getState().undo()} />
          <BarButton icon="redo" label="ทำซ้ำ (Ctrl+Y)" disabled={!canRedo} onClick={() => useProject.getState().redo()} className="tb-desk" />
          <BarButton icon="trash" label="ลบที่เลือก (Delete)" disabled={!hasSelection} onClick={deleteSelection} className="tb-desk" />
          <span className="tb-sep tb-desk" />
          <button
            className={`tb-chip tb-desk${snapOn ? ' on' : ''}`}
            onClick={() => set({ snapOn: !snapOn })}
            aria-pressed={snapOn}
            title={`Snap ${snapOn ? 'เปิด' : 'ปิด'}: ดูดเข้าหากริด มุม และผนัง`}
          >
            <Icon name="snap" />
            <span>Snap</span>
          </button>
        </div>
        <div className="tb-center">
          {/* A plain 2D/3D switch; side by side is a small extra beside it, for wide screens. */}
          <div className="seg seg-icons seg-view" role="tablist" aria-label="มุมมอง">
            {VIEWS.filter((v) => v.id !== 'split').map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                className={view === v.id ? 'on' : ''}
                onClick={() => set({ view: v.id })}
                title={v.label}
                data-testid={`view-${v.id}`}
              >
                <Icon name={v.icon} />
                <span>{v.label}</span>
              </button>
            ))}
          </div>
          <button
            className={`ib split-toggle tb-desk${view === 'split' ? ' on' : ''}`}
            onClick={() => set({ view: view === 'split' ? '2d' : 'split' })}
            aria-pressed={view === 'split'}
            title="แบ่งจอ: แปลน 2D กับ 3D ข้างกัน"
            data-testid="view-split"
          >
            <Icon name="split" />
          </button>
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
          <button
            className="tb-toggle tb-accent"
            onClick={() => void shareProject()}
            title={customer ? 'สร้างลิงก์การจัดวางของคุณ ส่งกลับให้ผู้ขาย' : 'สร้างลิงก์ให้ลูกค้าเปิดดูและย้ายเครื่องเอง'}
            data-testid="share-link"
          >
            <Icon name={customer ? 'reply' : 'share'} />
            <span>{customer ? 'ส่งกลับ' : 'แชร์ลิงก์'}</span>
          </button>
          {/* Desktop only: on a phone the bar is full, and the main menu has the same entry. */}
          <button
            className="tb-toggle tb-desk"
            onClick={() => void openFlowDialog()}
            title="สร้างภาพโรงงานจากแปลนนี้ด้วย Google Flow: พรอมต์ ภาพอ้างอิง และรับภาพกลับ"
            data-testid="flow-button"
          >
            <Icon name="bulb" />
            <span>ภาพ AI</span>
          </button>
          <span className="tb-sep" />
          <div className="seg seg-icons seg-panels" role="group" aria-label="แผง">
            <button
              className={dock === 'catalog' ? 'on' : ''}
              onClick={() => useUi.getState().toggleDock('catalog')}
              aria-pressed={dock === 'catalog'}
              title="คลังโมเดล"
              data-testid="dock-catalog"
            >
              <Icon name="machine" />
              <span>คลังโมเดล</span>
            </button>
            {!customer && (
              <button
                className={dock === 'layers' ? 'on' : ''}
                onClick={() => useUi.getState().toggleDock('layers')}
                aria-pressed={dock === 'layers'}
                title="เลเยอร์: รายการห้อง ผนัง เสา เครื่องจักร ซ่อน/ล็อก และไปดูได้"
                data-testid="dock-layers"
              >
                <Icon name="layers" />
                <span>เลเยอร์</span>
              </button>
            )}
            <button
              className={showPanel ? 'on' : ''}
              onClick={() => (showPanel ? set({ panelOpen: false, selection: null }) : set({ panelOpen: true }))}
              aria-pressed={showPanel}
              title="รายละเอียด / ตั้งค่าโรงงาน"
              data-testid="panel-toggle"
            >
              <Icon name="props" />
              <span>รายละเอียด</span>
            </button>
          </div>
        </div>
      </header>
      {dock && <div className="dock-col">{dock === 'catalog' ? <CatalogPanel /> : <LayersPanel />}</div>}
      <main className="viewport">
        <ShareBanner />
        <div className={`panes view-${view}`}>
          {view !== '3d' && (
            <div className="pane">
              <Toolbar />
              <PlanEditor />
            </div>
          )}
          {view !== '2d' && (
            <div className="pane">
              <Suspense fallback={<Loading3D />}>
                <View3D />
              </Suspense>
            </div>
          )}
        </div>
      </main>
      {showPanel && <PropertiesPanel />}
    </div>
  );
}
