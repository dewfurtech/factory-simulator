import { useEffect, useState } from 'react';
import { Editor } from './Editor';
import type { Id } from './model/types';
import { ImportOverlay } from './projects/ImportOverlay';
import { ProjectList } from './projects/ProjectList';
import { useImport } from './store/importProgress';
import { flushAutosave, keepStorage, loadProject, startAutosave } from './store/persist';
import { useLibrary } from './store/library';
import { useProject } from './store/project';
import { openShare, shareIdFromHash } from './store/share';
import { SELECT, useUi } from './store/ui';
import { closeDialog } from './ui/Dialog';

/** `#/p/<id>` opens a project of this browser's; `#/s/<id>` a plan shared by link, in the customer view. */
type Route = { kind: 'project'; id: Id } | { kind: 'share'; id: string } | null;

function routeFromHash(): Route {
  const project = location.hash.match(/^#\/p\/(.+)$/)?.[1] as Id | undefined;
  if (project) return { kind: 'project', id: project };
  const share = shareIdFromHash();
  return share ? { kind: 'share', id: share } : null;
}

const routeKey = (r: Route) => (r ? `${r.kind}:${r.id}` : '');

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
    if (!route) {
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
          dock: null,
          panelOpen: false,
          cursor: null,
          peek: false,
          customer: route.kind === 'share' && r.copy ? { shareId: route.id, from: r.copy.meta.from, note: r.copy.meta.note } : null,
          // A customer has no plan tools: in 3D they move machines straight away.
          move3d: route.kind === 'share',
        });
        // A project started from a plan is built by the plan editor's underlay menu, which the 3D-only view leaves out;
        // and a plan with nothing drawn on it yet has nothing to show in 3D, so it opens on the plan.
        if (useUi.getState().view === '3d') {
          if (useImport.getState().job) useUi.setState({ view: 'split' });
          else if (!Object.keys(r.project.plan.walls).length) useUi.setState({ view: '2d' });
        }
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
  if (problem)
    return (
      <div className="empty" data-testid="route-problem">
        {problem} <a href="#/">ไปหน้ารายการโรงงาน</a>
      </div>
    );
  if (!ready) return <div className="empty">{route.kind === 'share' ? 'กำลังโหลดแปลนจากลิงก์…' : 'กำลังโหลด…'}</div>;
  return <Editor />;
}
