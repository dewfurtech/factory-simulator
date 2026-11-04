import { useEffect, useState } from 'react';
import { Editor } from './Editor';
import type { Id } from './model/types';
import { AdminPage } from './projects/AdminPage';
import { ImportOverlay } from './projects/ImportOverlay';
import { ProjectList } from './projects/ProjectList';
import { useImport } from './store/importProgress';
import { flushAutosave, keepStorage, loadProject, startAutosave } from './store/persist';
import { useLibrary } from './store/library';
import { useProject } from './store/project';
import './store/utilities';
import { openShare, shareIdFromHash } from './store/share';
import { isPhone, SELECT, useUi } from './store/ui';
import { closeDialog } from './ui/Dialog';

/** `#/p/<id>` opens a project of this browser's; `#/s/<id>` a plan shared by link, in the customer view; `#/admin` the settings. */
type Route = { kind: 'project'; id: Id } | { kind: 'share'; id: string } | { kind: 'admin' } | null;

function routeFromHash(): Route {
  if (location.hash === '#/admin') return { kind: 'admin' };
  const project = location.hash.match(/^#\/p\/(.+)$/)?.[1] as Id | undefined;
  if (project) return { kind: 'project', id: project };
  const share = shareIdFromHash();
  return share ? { kind: 'share', id: share } : null;
}

const routeKey = (r: Route) => (r ? (r.kind === 'admin' ? 'admin' : `${r.kind}:${r.id}`) : '');

export function App() {
  const [route, setRoute] = useState(routeFromHash);
  const project = useProject((s) => s.project);
  const [problem, setProblem] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState('');

  useEffect(() => startAutosave(), []);
  useEffect(keepStorage, []);
  useEffect(() => void useLibrary.getState().load(), []);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setProblem(null);
    setOpenKey('');
    closeDialog();
    useUi.setState({ customer: null });
    if (!route || route.kind === 'admin') {
      flushAutosave();
      return;
    }
    let live = true;
    const opened = route.kind === 'project' ? loadProject(route.id).then((p) => p && { project: p, copy: null }) : openShare(route.id);
    opened
      .then((r) => {
        if (!live) return;
        if (!r) return setProblem('ไม่พบโปรเจกต์');
        useUi.setState({
          tool: SELECT,
          selection: null,
          boxed: [],
          // The machines are out from the start, ready to place; on a phone that panel would cover the plan.
          // A plan with no building yet opens on the building step, where the hall is made from its size.
          dock: isPhone() ? null : route.kind === 'project' && !Object.keys(r.project.plan.walls).length ? 'building' : 'catalog',
          underlayOpen: false,
          panelOpen: false,
          simOn: false,
          cursor: null,
          peek: false,
          customer: route.kind === 'share' && r.copy ? { shareId: route.id, from: r.copy.meta.from, note: r.copy.meta.note, sender: r.copy.meta.sender } : null,
          // The 3D move mode starts off for everyone; the button on the 3D pane turns it on.
          move3d: false,
          bannerClosed: false,
        });
        // A project started from a plan is built by the plan editor's underlay menu, which the 3D view leaves out;
        // and a plan with nothing drawn on it yet has nothing to show in 3D, so it opens on the plan.
        if (useImport.getState().job || !Object.keys(r.project.plan.walls).length) useUi.setState({ view: '2d' });
        useProject.getState().open(r.project);
        setOpenKey(routeKey(route));
      })
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [routeKey(route)]);

  return (
    <>
      <Screen route={route} problem={problem} ready={openKey === routeKey(route) && !!project} />
      <ImportOverlay />
    </>
  );
}

function Screen({ route, problem, ready }: { route: Route; problem: string | null; ready: boolean }) {
  if (!route) return <ProjectList />;
  if (route.kind === 'admin') return <AdminPage />;
  if (problem)
    return (
      <div className="empty" data-testid="route-problem">
        {problem} <a href="#/">ไปหน้ารายการโรงงาน</a>
      </div>
    );
  if (!ready) return <div className="empty">{route.kind === 'share' ? 'กำลังโหลดแปลนจากลิงก์…' : 'กำลังโหลด…'}</div>;
  return <Editor />;
}
