import { create } from 'zustand';

/** The steps of building a project from a plan file, in order. */
export type ImportStage = 'render' | 'read' | 'save' | 'open' | 'build';

export const IMPORT_STAGES: { id: ImportStage; label: string }[] = [
  { id: 'render', label: 'แปลงหน้าแบบเป็นภาพ' },
  { id: 'read', label: 'อ่านเส้นในแบบ (ผนัง ประตู เฟอร์นิเจอร์)' },
  { id: 'save', label: 'บันทึกไฟล์แปลน' },
  { id: 'open', label: 'เปิดโปรเจกต์' },
  { id: 'build', label: 'สร้างผนัง ห้อง และวางของ' },
];

export interface ImportJob {
  name: string;
  stage: ImportStage;
  startedAt: number;
}

interface ImportState {
  job: ImportJob | null;
  start(name: string): void;
  /** Moves to `stage` and yields a frame, so the step shows before the work behind it holds the page. */
  stage(stage: ImportStage): Promise<void>;
  done(): void;
}

/**
 * After the next frame is painted, so a step shows before the work behind it takes the page; a hidden tab paints no
 * frames, so a short timer stands in for one rather than holding the import until the tab is shown again.
 */
const nextPaint = () =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, 100);
    requestAnimationFrame(() => setTimeout(() => (clearTimeout(t), ok()), 0));
  });

/** The plan import under way, for the loading screen shown over the app while it runs. */
export const useImport = create<ImportState>((set, get) => ({
  job: null,
  start: (name) => set({ job: { name, stage: 'render', startedAt: Date.now() } }),
  stage: async (stage) => {
    const job = get().job;
    if (!job) return;
    set({ job: { ...job, stage } });
    await nextPaint();
  },
  done: () => set({ job: null }),
}));
