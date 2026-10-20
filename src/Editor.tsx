import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PlanEditor } from './editor2d/PlanEditor';
import { Icon, Toolbar } from './editor2d/Toolbar';
import { deleteSelection, dispatchKey, objectKey } from './editor2d/tools';
import { CatalogPanel } from './panels/CatalogPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { SimBar, Timeline, TrackingPanel } from './panels/SimPanels';
import { StaffPanel } from './panels/StaffPanel';
import { exportProject } from './store/persist';
import { useProject } from './store/project';
import { startSimLoop, useSim } from './store/sim';
import { SELECT, useUi, type Dock, type Mode, type ViewMode } from './store/ui';

const View3D = lazy(() => import('./view3d/View3D'));

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const ui = useUi.getState();
      if (ui.mode === 'sim') {
        if (e.key === ' ') {
          e.preventDefault();
          useSim.getState().set({ playing: !useSim.getState().playing });
        }
        if (e.key === 'Escape') ui.set({ agent: null, selection: null });
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
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
        if (ui.tool.kind === 'select') ui.set({ selection: null });
        else ui.setTool(SELECT);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const VIEWS: { id: ViewMode; label: string; icon: string }[] = [
  { id: '2d', label: '2D', icon: 'view2d' },
  { id: 'split', label: 'แบ่งจอ', icon: 'split' },
  { id: '3d', label: '3D', icon: 'view3d' },
];

function BarButton({ icon, label, on, disabled, onClick, testId }: { icon: string; label: string; on?: boolean; disabled?: boolean; onClick: () => void; testId?: string }) {
  return (
    <button className={`ib${on ? ' on' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on} title={label} data-testid={testId}>
      <Icon name={icon} />
    </button>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  return (
    <div className="tb-menu" ref={root}>
      <BarButton icon="menu" label="เมนู" on={open} onClick={() => setOpen(!open)} testId="main-menu" />
      {open && (
        <div className="tb-pop glass" role="menu">
          <a role="menuitem" href="#/">
            <Icon name="back" /> กลับไปรายการโรงงาน
          </a>
          <button role="menuitem" onClick={() => void exportProject(p.id).then((b) => download(b, `${p.name}.factory.json`)).then(() => setOpen(false))}>
            <Icon name="download" /> ส่งออกไฟล์ (.json)
          </button>
        </div>
      )}
    </div>
  );
}

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'layout', label: 'ออกแบบผัง', icon: 'edit' },
  { id: 'sim', label: 'จำลองการทำงาน', icon: 'play' },
];

function setMode(mode: Mode) {
  const ui = useUi.getState();
  if (ui.mode === mode) return;
  if (mode === 'sim') {
    useSim.getState().start(useProject.getState().project!);
    useSim.getState().set({ playing: true });
    ui.set({ mode, tool: SELECT, selection: null, agent: null, view: ui.view === '2d' ? 'split' : ui.view });
  } else {
    useSim.getState().stop();
    ui.set({ mode, agent: null, selection: null });
  }
}

export function Editor() {
  useKeyboard();
  const name = useProject((s) => s.project!.name);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const view = useUi((s) => s.view);
  const mode = useUi((s) => s.mode);
  const dock = useUi((s) => s.dock);
  const panelOpen = useUi((s) => s.panelOpen);
  const timeline = useUi((s) => s.timeline);
  const hasSelection = useUi((s) => !!s.selection || s.boxed.length > 0);
  const snapOn = useUi((s) => s.snapOn);
  const level = useProject((s) => s.level);
  const set = useUi.getState().set;
  const sim = mode === 'sim';
  useEffect(() => startSimLoop(), []);
  useEffect(() => () => setMode('layout'), []);
  const showDock = !sim && dock;

  return (
    <div className={`editor mode-${mode}${showDock ? ' with-dock' : ''}${panelOpen ? ' with-panel' : ''}`}>
      <header className="topbar">
        <div className="tb-group">
          <MainMenu />
          <div className="brand">
            <Icon name="factory" />
          </div>
          <span className="title" title={name}>
            {name}
          </span>
          {!sim && (
            <>
              <span className="tb-sep" />
              <BarButton icon="undo" label="เลิกทำ (Ctrl+Z)" disabled={!canUndo} onClick={() => useProject.getState().undo()} />
              <BarButton icon="redo" label="ทำซ้ำ (Ctrl+Y)" disabled={!canRedo} onClick={() => useProject.getState().redo()} />
              <BarButton icon="trash" label="ลบที่เลือก (Delete)" disabled={!hasSelection} onClick={deleteSelection} />
              <BarButton icon="snap" label={`Snap ${snapOn ? 'เปิด' : 'ปิด'}`} on={snapOn} onClick={() => set({ snapOn: !snapOn })} />
            </>
          )}
        </div>
        <div className="tb-group tb-center">
          <div className="mode-switch" role="tablist" aria-label="โหมด">
            {MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} data-testid={`mode-${m.id}`}>
                <Icon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tb-group tb-right">
          {!sim && (
            <div className="seg seg-icons" role="tablist" aria-label="แผงซ้าย">
              {(
                [
                  ['catalog', 'เครื่องจักร', 'machine'],
                  ['staff', 'พนักงาน', 'users'],
                ] as [Dock, string, string][]
              ).map(([id, label, icon]) => (
                <button key={id} className={dock === id ? 'on' : ''} onClick={() => useUi.getState().toggleDock(id)} title={label} data-testid={`dock-${id}`}>
                  <Icon name={icon} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
          {sim && <BarButton icon="timeline" label="ไทม์ไลน์ทั้งวัน" on={timeline} onClick={() => set({ timeline: !timeline })} />}
          <BarButton icon="props" label="แผงขวา" on={panelOpen} onClick={() => set({ panelOpen: !panelOpen })} />
          <span className="tb-sep" />
          {view !== '3d' && (
            <div className="seg" role="tablist" aria-label="ชั้น" title="ชั้นที่แสดงในแปลน 2D">
              {['ชั้น 1', 'ชั้น 2'].map((label, i) => (
                <button key={i} role="tab" aria-selected={level === i} className={level === i ? 'on' : ''} onClick={() => (set({ selection: null, boxed: [] }), useProject.getState().setLevel(i))} data-testid={`level-${i}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="seg seg-icons" role="tablist" aria-label="มุมมอง">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => set({ view: v.id })} title={v.label} data-testid={`view-${v.id}`}>
                <Icon name={v.icon} />
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      {showDock && <div className="dock-col">{dock === 'staff' ? <StaffPanel /> : <CatalogPanel />}</div>}
      <main className="viewport">
        <div className={`panes view-${view}`}>
          {view !== '3d' && (
            <div className="pane">
              {!sim && <Toolbar />}
              <PlanEditor />
            </div>
          )}
          {view !== '2d' && (
            <div className="pane">
              <Suspense fallback={<div className="empty">กำลังโหลด 3D…</div>}>
                <View3D />
              </Suspense>
            </div>
          )}
        </div>
        {sim && <SimBar />}
        {sim && timeline && <Timeline />}
      </main>
      {panelOpen && (sim ? <TrackingPanel /> : <PropertiesPanel />)}
    </div>
  );
}
