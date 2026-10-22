import type { Id, Size3 } from './types';

/**
 * A model of the user's own in the library: a named box or cylinder of a given size and colour, with tags to find it
 * by, and optionally a 3D file (GLB, glTF, OBJ or STL) drawn in its place, scaled to that size.
 */
export interface CustomModel {
  id: Id;
  name: string;
  size: Size3;
  /** Hex colour of the box on the plan and in 3D (and of a 3D file that brings no materials of its own). */
  color: string;
  tags: string[];
  shape: 'box' | 'cylinder';
  /** The uploaded 3D file, stored as an asset; absent for a plain box. */
  modelAssetId?: Id;
  modelFile?: string;
  note?: string;
  createdAt: number;
}

export const CUSTOM_PREFIX = 'cm';

export const MODEL_FILE_ACCEPT = '.glb,.gltf,.obj,.stl,model/gltf-binary,model/gltf+json';

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
