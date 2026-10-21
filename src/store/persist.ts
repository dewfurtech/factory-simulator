import { del, get, set } from 'idb-keyval';
import { newId } from '../model/id';
import { migrate, projectFacts, type ProjectFacts } from '../model/project';
import type { Id, Project } from '../model/types';
import { underlayImageIds, vectorAssetId } from '../model/underlay';
import { useProject } from './project';

export interface ProjectSummary extends Partial<ProjectFacts> {
  id: Id;
  name: string;
  updatedAt: number;
}

// Kept apart from the room planner's keys, which may live in the same browser profile.
const INDEX = 'factory:projects-index';
const projectKey = (id: Id) => `factory:project:${id}`;
const assetKey = (id: Id) => `factory:asset:${id}`;

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: Id): Promise<Project | undefined> {
  const saved = await get<Project>(projectKey(id));
  return saved && migrate(saved);
}

export async function saveProject(project: Project): Promise<void> {
  await set(projectKey(project.id), project);
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  const summary: ProjectSummary = { id: project.id, name: project.name, updatedAt: project.updatedAt, ...projectFacts(project) };
  await set(INDEX, [...index.filter((p) => p.id !== project.id), summary]);
}

export async function deleteProject(id: Id): Promise<void> {
  const project = await loadProject(id);
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  await set(INDEX, index.filter((p) => p.id !== id));
  await del(projectKey(id));
  if (project) for (const blobId of underlayImageIds(project)) await del(assetKey(blobId));
}

export async function duplicateProject(id: Id): Promise<Project | undefined> {
  const src = await loadProject(id);
  if (!src) return undefined;
  const copy: Project = { ...structuredClone(src), id: newId('p'), name: `${src.name} (สำเนา)`, updatedAt: Date.now() };
  if (copy.underlay) {
    const [image, drawing] = await Promise.all([loadAsset(copy.underlay.imageId), loadAsset(vectorAssetId(copy.underlay.imageId))]);
    copy.underlay.imageId = newId('u');
    if (image) await saveAsset(copy.underlay.imageId, image);
    if (drawing) await saveAsset(vectorAssetId(copy.underlay.imageId), drawing);
  }
  await saveProject(copy);
  return copy;
}

export const saveAsset = (id: Id, blob: Blob) => set(assetKey(id), blob);
export const loadAsset = (id: Id) => get<Blob>(assetKey(id));

interface Bundle {
  format: 'factory-sim';
  version: 1;
  project: Project;
  assets: Record<string, { type: string; base64: string }>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBlob(b64: string, type: string): Blob {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportProject(id: Id): Promise<Blob> {
  const project = await loadProject(id);
  if (!project) throw new Error('ไม่พบโปรเจกต์');
  const assets: Bundle['assets'] = {};
  for (const blobId of underlayImageIds(project)) {
    const blob = await loadAsset(blobId);
    if (blob) assets[blobId] = { type: blob.type, base64: await blobToBase64(blob) };
  }
  const bundle: Bundle = { format: 'factory-sim', version: 1, project, assets };
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' });
}

/** Reads a saved factory bundle; a bare project JSON (no bundle around it) is accepted too. */
export async function importProject(file: Blob): Promise<Project> {
  const raw = JSON.parse(await file.text()) as Partial<Bundle> & Partial<Project>;
  const src = raw.format === 'factory-sim' ? raw.project : raw.plan ? (raw as Project) : undefined;
  if (!src?.plan) throw new Error('ไฟล์ไม่ใช่โปรเจกต์โรงงาน');
  const project: Project = migrate({ ...src, id: newId('p'), updatedAt: Date.now() });
  for (const [id, a] of Object.entries(raw.assets ?? {})) await saveAsset(id as Id, base64ToBlob(a.base64, a.type));
  await saveProject(project);
  return project;
}

let pending: { timer: ReturnType<typeof setTimeout>; project: Project } | undefined;

/** Debounced autosave of whatever project is open. */
export function startAutosave(): () => void {
  const unsub = useProject.subscribe((s, prev) => {
    if (!s.project || s.project === prev.project) return;
    const p = s.project;
    if (pending) clearTimeout(pending.timer);
    pending = { project: p, timer: setTimeout(() => ((pending = undefined), void saveProject(p)), 400) };
  });
  return () => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
    unsub();
  };
}

export function flushAutosave(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  void saveProject(pending.project);
  pending = undefined;
}
