import { create } from 'zustand';
import { defaultUtilities, fillDesign, setActiveUtilities, setLinkedUtilities, type DesignRules, type MachineUtility, type SafetyDistances, type UtilitySettings } from '../model/utilities';
import { useProject } from './project';

/** The admin's air, power and dust settings: kept in this browser, carried to customers inside each share link. */
const KEY = 'factory-sim.utilities';

function read(): UtilitySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultUtilities();
    const s = JSON.parse(raw) as Partial<UtilitySettings>;
    return { machines: s.machines ?? {}, design: fillDesign(s.design), safety: s.safety ?? {} };
  } catch {
    return defaultUtilities();
  }
}

function write(s: UtilitySettings): void {
  setActiveUtilities(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private window: the settings last until the page closes */
  }
}

interface UtilitiesState {
  settings: UtilitySettings;
  setMachine(id: string, patch: Partial<MachineUtility>): void;
  resetMachine(id: string): void;
  setDesign(patch: Partial<DesignRules>): void;
  setSafety(id: string, distances: SafetyDistances): void;
  resetSafety(id: string): void;
  replace(s: UtilitySettings): void;
}

const initial = read();
setActiveUtilities(initial);

// A plan opened from a share link carries the sender's settings; its safety distances follow them while it is open.
setLinkedUtilities(useProject.getState().project?.utilities ?? null);
useProject.subscribe((s) => setLinkedUtilities(s.project?.utilities ?? null));

export const useUtilities = create<UtilitiesState>((set, get) => {
  const commit = (settings: UtilitySettings) => {
    write(settings);
    set({ settings });
  };
  return {
    settings: initial,
    setMachine: (id, patch) => {
      const s = get().settings;
      commit({ ...s, machines: { ...s.machines, [id]: { ...s.machines[id], ...patch } } });
    },
    resetMachine: (id) => {
      const s = get().settings;
      const { [id]: _gone, ...machines } = s.machines;
      void _gone;
      commit({ ...s, machines });
    },
    setDesign: (patch) => {
      const s = get().settings;
      commit({ ...s, design: { ...s.design, ...patch } });
    },
    setSafety: (id, distances) => {
      const s = get().settings;
      commit({ ...s, safety: { ...s.safety, [id]: distances } });
    },
    resetSafety: (id) => {
      const s = get().settings;
      const { [id]: _gone, ...safety } = s.safety ?? {};
      void _gone;
      commit({ ...s, safety });
    },
    replace: commit,
  };
});
