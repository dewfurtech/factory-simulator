import type { Id, Size3 } from './types';

/** A model of the user's own in the library: a named box or cylinder of a given size and colour, with tags to find it by. */
export interface CustomModel {
  id: Id;
  name: string;
  size: Size3;
  /** Hex colour of the box on the plan and in 3D. */
  color: string;
  tags: string[];
  shape: 'box' | 'cylinder';
  note?: string;
  createdAt: number;
  /** A 3D model file the user imported (exported from SketchUp): shown in 3D in place of the box (interior projects). */
  file?: ModelFile;
}

/**
 * An imported model's files, each kept in the asset store under its own id: the model, and what was picked with it
 * (an OBJ's .mtl, texture pictures), matched to the model by file name. Read again each time the model is shown.
 */
export interface ModelFile {
  name: string;
  assetId: Id;
  companions?: { name: string; assetId: Id }[];
  /** The unit the model is read in when the user corrected it (else the file's own, or the guess from its size). */
  unit?: 'mm' | 'cm' | 'm' | 'inch';
  /** Turn a Z-up model upright (OBJ and glTF). */
  zUp?: boolean;
  /** Size of all its files together, bytes. */
  bytes: number;
}

/** Every asset an imported model keeps. */
export const modelFileAssetIds = (m: Pick<CustomModel, 'file'>): Id[] => (m.file ? [m.file.assetId, ...(m.file.companions ?? []).map((c) => c.assetId)] : []);

export const CUSTOM_PREFIX = 'cm';

/** Tags typed as "a, b; c" become a clean, unique list. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const t = raw.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Every tag in use, most used first, then alphabetical. */
export function allTags(models: readonly CustomModel[]): string[] {
  const count = new Map<string, number>();
  for (const m of models) for (const t of m.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th')).map(([t]) => t);
}

export function matchesTag(m: CustomModel, tag: string | null): boolean {
  return !tag || m.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

export const DEFAULT_COLOR = '#94a3b8';
