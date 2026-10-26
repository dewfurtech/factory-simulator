import { produce } from 'immer';
import { create } from 'zustand';
import { DEFAULT_UPPER_Z, fromView, levelView } from '../model/levels';
import { emptyPlan } from '../model/plan';
import { migrate } from '../model/project';
import { homeRooms } from '../interior/rooms';
import type { Project } from '../model/types';

const HISTORY_LIMIT = 200;

interface ProjectState {
  project: Project | null;
  past: Project[];
  future: Project[];
  /** True between beginGesture and endGesture; edits inside coalesce into one undo step. */
  gesture: boolean;
  /** The floor the plan editor shows and edits: 0 ground, 1 the second floor. */
  level: number;
  /** Switches the edited floor, adding an empty second floor the first time it is opened. */
  setLevel(level: number): void;
  open(project: Project): void;
  apply(recipe: (draft: Project) => void): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  gesture: false,
  level: 0,
  open: (project) => set({ project: migrate(project), past: [], future: [], gesture: false, level: 0 }),
  setLevel: (level) => {
    const { project } = get();
    if (level && project && !project.upper) get().apply((d) => void (d.upper = { z: DEFAULT_UPPER_Z, plan: emptyPlan() }));
    set({ level });
  },
  apply: (recipe) => {
    const { project, past, gesture, level } = get();
    if (!project) return;
    // On the second floor the recipe edits a view whose plan is that floor's; it is written back after.
    const view = levelView(project, level);
    const edited = produce(view, (d) => {
      recipe(d);
      // An interior's new rooms are rooms of a home, not factory zones.
      if (d.kind === 'interior') homeRooms(d.plan, view.plan.rooms);
    });
    if (edited === view) return;
    const next = { ...fromView(project, edited, level), updatedAt: Date.now() };
    set({
      project: next,
      past: gesture ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
    });
  },
  beginGesture: () => {
    const { project, past, gesture } = get();
    if (!project || gesture) return;
    set({ gesture: true, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },
  endGesture: () => {
    const { past, project, gesture } = get();
    if (!gesture) return;
    // A click without movement shouldn't leave an empty undo step behind.
    set({ gesture: false, past: past[past.length - 1] === project ? past.slice(0, -1) : past });
  },
  undo: () => {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
  },
}));

export const applyEdit = (recipe: (draft: Project) => void) => useProject.getState().apply(recipe);

/** The project as the plan editor shows it: the floor being edited (see levelView). */
export const useEditProject = () => useProject((s) => (s.project ? levelView(s.project, s.level) : null));
export const editProject = () => {
  const { project, level } = useProject.getState();
  return levelView(project!, level);
};
