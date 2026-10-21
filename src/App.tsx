import { useEffect, useState } from 'react';
import { Editor } from './Editor';
import type { Id } from './model/types';
import { ImportOverlay } from './projects/ImportOverlay';
import { ProjectList } from './projects/ProjectList';
import { useImport } from './store/importProgress';
import { flushAutosave, loadProject, startAutosave } from './store/persist';
import { useProject } from './store/project';
import { SELECT, useUi } from './store/ui';

const projectIdFromHash = () => (location.hash.match(/^#\/p\/(.+)$/)?.[1] ?? null) as Id | null;

export function App() {
  const [routeId, setRouteId] = useState(projectIdFromHash);
  const project = useProject((s) => s.project);
  const [missing, setMissing] = useState(false);
  const [openId, setOpenId] = useState<Id | null>(null);

  useEffect(() => startAutosave(), []);
  useEffect(() => {
    const onHash = () => setRouteId(projectIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setMissing(false);
    setOpenId(null);
    if (!routeId) {
      flushAutosave();
      return;
    }
    let live = true;
    void loadProject(routeId).then((p) => {
      if (!live) return;
      if (!p) return setMissing(true);
      useUi.setState({ tool: SELECT, selection: null, boxed: [], dock: null, panelOpen: false });
      // A project started from a plan is built by the plan editor's underlay menu, which the 3D-only view leaves out.
      if (useImport.getState().job && useUi.getState().view === '3d') useUi.setState({ view: 'split' });
      useProject.getState().open(p);
      setOpenId(routeId);
    });
    return () => {
      live = false;
    };
  }, [routeId]);

  return (
    <>
      <Screen routeId={routeId} missing={missing} ready={openId === routeId && project?.id === routeId} />
      <ImportOverlay />
    </>
  );
}

function Screen({ routeId, missing, ready }: { routeId: Id | null; missing: boolean; ready: boolean }) {
  if (!routeId) return <ProjectList />;
  if (missing)
    return (
      <div className="empty">
        ไม่พบโปรเจกต์ <a href="#/">กลับไปหน้ารายการ</a>
      </div>
    );
  if (!ready) return <div className="empty">กำลังโหลด…</div>;
  return <Editor />;
}
