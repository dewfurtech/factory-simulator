import { create } from 'zustand';
import type { Project } from '../model/types';
import { Engine } from '../sim/engine';

export const SPEEDS = [1, 10, 30, 60, 120, 300] as const;

interface SimState {
  engine: Engine | null;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  /** Bumped a few times a second while running, so panels re-read the engine. */
  version: number;
  seed: number;
  start(project: Project, seed?: number): void;
  stop(): void;
  set(patch: Partial<Pick<SimState, 'playing' | 'speed'>>): void;
  /** Runs the day forward to a clock time (minutes after midnight) as fast as possible. */
  jumpTo(t: number): void;
  bump(): void;
}

export const useSim = create<SimState>((set, get) => ({
  engine: null,
  playing: false,
  speed: 60,
  version: 0,
  seed: 1,
  start: (project, seed) => {
    const s = seed ?? get().seed;
    set({ engine: new Engine(project, s), seed: s, version: get().version + 1 });
  },
  stop: () => set({ engine: null, playing: false }),
  set: (patch) => set(patch),
  jumpTo: (t) => {
    const e = get().engine;
    if (!e) return;
    if (t < e.t) {
      // Time only runs forward: restart the same day and run up to the time asked for.
      const fresh = new Engine(e.project, get().seed);
      fresh.tick(Math.max(0, t - fresh.t));
      set({ engine: fresh, version: get().version + 1 });
      return;
    }
    e.tick(t - e.t);
    set({ version: get().version + 1 });
  },
  bump: () => set({ version: get().version + 1 }),
}));

let raf = 0;
let last = 0;
let lastBump = 0;

/** Drives the running simulation from animation frames; returns a stopper. */
export function startSimLoop(): () => void {
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const s = useSim.getState();
    const e = s.engine;
    if (!e || !s.playing) return;
    e.tick((dt * s.speed) / 60);
    if (e.finished) s.set({ playing: false });
    if (now - lastBump > 200) {
      lastBump = now;
      s.bump();
    }
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    last = 0;
  };
}
