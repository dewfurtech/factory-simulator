import { get, set } from 'idb-keyval';
import type { Id, Project } from '../model/types';
import { bundleProject, importBundle, loadProject, type Bundle } from './persist';

/**
 * Plans shared by link. A share is a project bundle kept on the server under a short id; the link `#/s/<id>` opens it
 * in the customer view, where machines can be moved and the result sent back as a new share.
 */

export interface ShareMeta {
  /** Who made this share: the seller sending a plan out, or the customer sending their arrangement back. */
  from: 'vendor' | 'customer';
  /** A line to the person receiving it. */
  note?: string;
  /** The share this one answers, when it is a customer's reply. */
  parent?: string;
  name: string;
}

interface Share {
  bundle: Bundle;
  meta: ShareMeta;
  createdAt: number;
}

/** The link's local copy: the project it was imported into, so a reopened link shows the moves made since. */
export interface SharedCopy {
  projectId: Id;
  meta: ShareMeta;
  createdAt: number;
}

const API = '/api/share';
/** Under Netlify's limit on a function's request body; a bundle over it can only go as a file. */
const MAX_BYTES = 5_500_000;

export const shareUrl = (id: string) => `${location.origin}${location.pathname}#/s/${id}`;

export const shareIdFromHash = (hash = location.hash): string | null => hash.match(/^#\/s\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;

async function failure(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* no JSON in the answer: the fallback stands */
  }
  return new Error(message);
}

/** Stores the project on the server and gives back the new share's id. */
export async function createShare(project: Project, meta: Omit<ShareMeta, 'name'>): Promise<string> {
  const body = JSON.stringify({ bundle: await bundleProject(project), meta: { ...meta, name: project.name } });
  if (body.length > MAX_BYTES) throw new Error('แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์ (ภาพแปลนหรือโมเดลที่อัปโหลดใหญ่เกิน 5 MB) ส่งออกเป็นไฟล์ .json แทน');
  let res: Response;
  try {
    res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch {
    throw new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  if (!res.ok) throw await failure(res, 'สร้างลิงก์ไม่สำเร็จ');
  return ((await res.json()) as { id: string }).id;
}

async function fetchShare(id: string): Promise<Share> {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(id)}`);
  } catch {
    throw new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  if (!res.ok) throw await failure(res, 'เปิดลิงก์ไม่ได้');
  return (await res.json()) as Share;
}

const copyKey = (id: string) => `factory:share:${id}`;

/**
 * Opens a shared link: the local copy made the first time it was opened in this browser (with any moves made since),
 * or a fresh import of the share.
 */
export async function openShare(id: string): Promise<{ project: Project; copy: SharedCopy }> {
  const copy = await get<SharedCopy>(copyKey(id));
  if (copy) {
    const project = await loadProject(copy.projectId);
    if (project) return { project, copy };
  }
  const share = await fetchShare(id);
  const project = await importBundle(share.bundle);
  const fresh: SharedCopy = { projectId: project.id, meta: share.meta, createdAt: share.createdAt };
  await set(copyKey(id), fresh);
  return { project, copy: fresh };
}
