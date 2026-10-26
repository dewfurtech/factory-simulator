import { lazy, Suspense } from 'react';
import { BarButton, MainMenu, ShareBanner, shareProject, useKeyboard, VIEWS } from '../Editor';
import { PlanEditor } from '../editor2d/PlanEditor';
import { Icon, Toolbar } from '../editor2d/Toolbar';
import { deleteSelection } from '../editor2d/tools';
import { CatalogPanel } from '../panels/CatalogPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { ProjectInfo } from '../panels/ProjectInfo';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { Loading3D } from '../ui/Loading3D';
import { INTERIOR_FINISHES } from './interior3d';
import { RoomMaterials, WallMaterial } from './MaterialPicker';
import { openMoodBoard } from './MoodBoard';
import { HOME_ZONE_IDS } from './zones';

const View3D = lazy(() => import('../view3d/View3D'));

/**
 * The interior editor: the factory editor's plan, 3D view, library and panels, put together for a home. The
 * building tools stay (walls, rooms, doors and windows, the plan image, the tape); columns, aisles and areas
 * are left out, the library shows furniture and the user's own models, rooms take home zones and materials.
 */
export function InteriorEditor() {
  useKeyboard();
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const view = useUi((s) => s.view);
  const dock = useUi((s) => s.dock);
  const panelOpen = useUi((s) => s.panelOpen);
  const hasSelection = useUi((s) => !!s.selection || s.boxed.length > 0);
  const snapOn = useUi((s) => s.snapOn);
  const customer = useUi((s) => !!s.customer);
  const set = useUi.getState().set;
  const showPanel = hasSelection || panelOpen;

  return (
    <div className={`editor interior${dock ? ' with-dock' : ''}`} data-testid="interior-editor">
      <header className="topbar">
        <div className="tb-group tb-left">
          <MainMenu back="กลับไปรายการโปรเจกต์" />
          <div className="brand tb-desk">
            <Icon name="sofa" />
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
        </div>
        <div className="tb-group tb-right">
          <button className="tb-toggle" onClick={() => void openMoodBoard()} title="Mood & Tone: ชุดสี วัสดุที่ใช้ และเฟอร์นิเจอร์ของโครงการ" data-testid="mood-tone">
            <Icon name="palette" />
            <span>Mood &amp; Tone</span>
          </button>
          <button
            className="tb-toggle tb-accent"
            onClick={() => void shareProject()}
            title={customer ? 'สร้างลิงก์การจัดวางของคุณ ส่งกลับให้ผู้ส่ง' : 'สร้างลิงก์ให้ลูกค้าเปิดดูและย้ายเฟอร์นิเจอร์เอง'}
            data-testid="share-link"
          >
            <Icon name={customer ? 'reply' : 'share'} />
            <span>{customer ? 'ส่งกลับ' : 'แชร์ลิงก์'}</span>
          </button>
          <span className="tb-sep" />
          <div className="seg seg-icons seg-panels" role="group" aria-label="แผง">
            <button
              className={dock === 'catalog' ? 'on' : ''}
              onClick={() => useUi.getState().toggleDock('catalog')}
              aria-pressed={dock === 'catalog'}
              title="คลังเฟอร์นิเจอร์"
              data-testid="dock-catalog"
            >
              <Icon name="sofa" />
              <span>เฟอร์นิเจอร์</span>
            </button>
            {!customer && (
              <button
                className={dock === 'layers' ? 'on' : ''}
                onClick={() => useUi.getState().toggleDock('layers')}
                aria-pressed={dock === 'layers'}
                title="เลเยอร์: รายการห้อง ผนัง เฟอร์นิเจอร์ ซ่อน/ล็อก และไปดูได้"
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
              title="รายละเอียด / วัสดุ"
              data-testid="panel-toggle"
            >
              <Icon name="props" />
              <span>รายละเอียด</span>
            </button>
          </div>
        </div>
      </header>
      {dock && <div className="dock-col">{dock === 'catalog' ? <CatalogPanel interior /> : <LayersPanel />}</div>}
      <main className="viewport">
        <ShareBanner />
        <div className={`panes view-${view}`}>
          {view !== '3d' && (
            <div className="pane">
              <Toolbar interior />
              <PlanEditor />
            </div>
          )}
          {view !== '2d' && (
            <div className="pane">
              <Suspense fallback={<Loading3D />}>
                <View3D finishes={INTERIOR_FINISHES} />
              </Suspense>
            </div>
          )}
        </div>
      </main>
      {showPanel && <PropertiesPanel zoneIds={HOME_ZONE_IDS} roomExtra={(r) => <RoomMaterials room={r} />} wallExtra={(w) => <WallMaterial wall={w} />} />}
    </div>
  );
}
