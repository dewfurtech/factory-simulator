import { del, get, set } from 'idb-keyval';
import { newId } from '../model/id';
import { migrate, projectFacts, type ProjectFacts } from '../model/project';
import type { Id, Project, ProjectKind } from '../model/types';
import { underlayImageIds, vectorAssetId } from '../model/underlay';
import { modelFileAssetIds, type CustomModel } from '../model/library';
import { useLibrary } from './library';
import { withoutPrivate } from './private';
import { useProject } from './project';

/** Every blob a project keeps in the asset store: its plan image(s), the pictures made from it, and (interior projects) its uploaded materials. */
const projectAssetIds = (project: Project): Id[] => [
  ...underlayImageIds(project),
  ...(project.renders ?? []).map((r) => r.assetId),
  ...(project.materials ?? []).map((m) => m.imageId),
];

export interface ProjectSummary extends Partial<ProjectFacts> {
  id: Id;
  name: string;
  updatedAt: number;
  /** Absent for a factory (and on every summary written before interiors existed). */
  kind?: ProjectKind;
  /** The customer's company and contact, for the card and the search on the start page. */
  company?: string;
  contact?: string;
}

// Kept apart from the room planner's keys, which may live in the same browser profile.
const INDEX = 'factory:projects-index';
const projectKey = (id: Id) => `factory:project:${id}`;
const assetKey = (id: Id) => `factory:asset:${id}`;

/** Saves run one after another, and anything reading the list waits for the ones under way. */
let writing: Promise<void> = Promise.resolve();

export async function listProjects(): Promise<ProjectSummary[]> {
  await writing;
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: Id): Promise<Project | undefined> {
  const saved = await get<Project>(projectKey(id));
  return saved && migrate(saved);
}

export function saveProject(project: Project): Promise<void> {
  const run = writing.then(() => writeProject(project));
  // A failed save must not stop the ones after it.
  writing = run.catch(() => undefined);
  return run;
}

async function writeProject(project: Project): Promise<void> {
  await set(projectKey(project.id), project);
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    ...projectFacts(project),
    ...(project.kind && { kind: project.kind }),
    ...(project.client?.company && { company: project.client.company }),
    ...(project.client?.contact && { contact: project.client.contact }),
  };
  await set(INDEX, [...index.filter((p) => p.id !== project.id), summary]);
}

export async function deleteProject(id: Id): Promise<void> {
  const project = await loadProject(id);
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  await set(
    INDEX,
    index.filter((p) => p.id !== id),
  );
  await del(projectKey(id));
  if (project) for (const blobId of projectAssetIds(project)) await del(assetKey(blobId));
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
  // Uploaded materials get their own copies, so deleting either project leaves the other's pictures alone.
  for (const m of copy.materials ?? []) {
    const picture = await loadAsset(m.imageId);
    m.imageId = newId('u');
    if (picture) await saveAsset(m.imageId, picture);
  }
  for (const r of copy.renders ?? []) {
    const image = await loadAsset(r.assetId);
    r.assetId = newId('r');
    if (image) await saveAsset(r.assetId, image);
  }
  await saveProject(copy);
  return copy;
}

export const saveAsset = (id: Id, blob: Blob) => set(assetKey(id), blob);
export const loadAsset = (id: Id) => get<Blob>(assetKey(id));
export const deleteAsset = (id: Id) => del(assetKey(id));

export interface Bundle {
  format: 'factory-sim';
  version: 1;
  project: Project;
  assets: Record<string, { type: string; base64: string }>;
  /** The user's own models the project places, so another browser can show them. */
  library?: CustomModel[];
}

/** The picture as WebP when that is smaller; the original when it is not, or when the browser cannot. */
async function smaller(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/webp' || typeof createImageBitmap === 'undefined') return blob;
  try {
    const img = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    // A white ground under any transparency, as the plan shows it.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    img.close();
    const webp = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.85));
    return webp && webp.type === 'image/webp' && webp.size < blob.size ? webp : blob;
  } catch {
    return blob;
  }
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
  return new Blob([JSON.stringify(await bundleProject(project))], { type: 'application/json' });
}

/** The project with its plan images and the user's own models it places: everything another browser needs to show it. */
export async function bundleProject(project: Project, { light = false } = {}): Promise<Bundle> {
  const assets: Bundle['assets'] = {};
  for (const blobId of projectAssetIds(project)) {
    // A light bundle (a share link) leaves out the PDF's vector drawing, which is only for drawing walls over the
    // plan (megabytes for a CAD plan), and sends the plan picture as a smaller WebP.
    // (An interior's uploaded materials may be there without any plan image.)
    if (light && project.underlay && blobId === vectorAssetId(project.underlay.imageId)) continue;
    const stored = await loadAsset(blobId);
    const blob = stored && light ? await smaller(stored) : stored;
    if (blob) assets[blobId] = { type: blob.type, base64: await blobToBase64(blob) };
  }
  const used = useLibrary.getState().models.filter((m) => project.objects.some((o) => o.assetId === m.id));
  // A model imported from SketchUp travels with its files, as they are (a share link warns when they are large).
  for (const blobId of used.flatMap(modelFileAssetIds)) {
    const blob = await loadAsset(blobId);
    if (blob) assets[blobId] = { type: blob.type, base64: await blobToBase64(blob) };
  }
  // The seller's notes (the customer's details, the BOQ prices) stay with the seller: a share link leaves them out.
  const sent = light ? withoutPrivate(project) : project;
  return { format: 'factory-sim', version: 1, project: sent, assets, ...(used.length && { library: used }) };
}

interface Backup {
  format: 'factory-sim-backup';
  version: 1;
  bundles: Bundle[];
}

/** Every project with its plan images, in one file: the copy to keep outside the browser. */
export async function exportAll(): Promise<Blob> {
  const bundles: Bundle[] = [];
  for (const p of await listProjects()) bundles.push(JSON.parse(await (await exportProject(p.id)).text()) as Bundle);
  const backup: Backup = { format: 'factory-sim-backup', version: 1, bundles };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Saves the bundle's project as a new project here, with its images and models. */
export async function importBundle(raw: Partial<Bundle> & Partial<Project>): Promise<Project> {
  const src = raw.format === 'factory-sim' ? raw.project : raw.plan ? (raw as Project) : undefined;
  if (!src?.plan) throw new Error('ไฟล์ไม่ใช่โปรเจกต์โรงงาน');
  const project: Project = migrate({ ...src, id: newId('p'), updatedAt: Date.now() });
  for (const [id, a] of Object.entries(raw.assets ?? {})) await saveAsset(id as Id, base64ToBlob(a.base64, a.type));
  if (raw.library?.length) await useLibrary.getState().merge(raw.library);
  await saveProject(project);
  return project;
}

/** Reads a saved factory bundle; a bare project JSON (no bundle around it) is accepted too. */
export async function importProject(file: Blob): Promise<Project> {
  return importBundle(JSON.parse(await file.text()) as Partial<Bundle> & Partial<Project>);
}

/** Reads a project file or a backup of several; each comes in as a new project, so nothing here is overwritten. */
export async function importFile(file: Blob): Promise<Project[]> {
  const raw = JSON.parse(await file.text()) as Partial<Backup> | (Partial<Bundle> & Partial<Project>);
  if (raw.format === 'factory-sim-backup') {
    const out: Project[] = [];
    for (const b of (raw as Partial<Backup>).bundles ?? []) out.push(await importBundle(b));
    if (!out.length) throw new Error('ไฟล์สำรองไม่มีโปรเจกต์');
    return out;
  }
  return [await importBundle(raw as Partial<Bundle> & Partial<Project>)];
}

/**
 * Asks the browser to keep this site's data out of its storage clean-ups. Granted silently where the site is used
 * often; refused or ignored elsewhere, which is why the project list still asks for a backup file.
 */
export function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
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
  // A tab closed, reloaded or sent to the background within the wait still saves its last change.
  const onHide = () => flushAutosave();
  const onVisibility = () => document.visibilityState === 'hidden' && flushAutosave();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
    unsub();
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function flushAutosave(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  void saveProject(pending.project);
  pending = undefined;
}
