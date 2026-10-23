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

/** The stored record: the plan as gzip pieces, or (shares made before pieces) the whole bundle inline. */
interface Share {
  bundle?: Bundle;
  parts?: string[];
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
const PART_API = '/api/share-part';
/** The plan goes up and comes back in pieces of at most this much, so no one request is large (the server takes 5 MB a piece). */
const PART_BYTES = 3_500_000;
/** The server keeps at most this many pieces per share (about 140 MB compressed). */
const MAX_PARTS = 40;

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

const offline = () => new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Blob): Promise<string> {
  return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

async function uploadPart(data: Uint8Array): Promise<string> {
  let res: Response;
  try {
    res = await fetch(PART_API, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: data });
  } catch {
    throw offline();
  }
  if (!res.ok) throw await failure(res, 'ส่งแปลนขึ้นเซิร์ฟเวอร์ไม่สำเร็จ');
  return ((await res.json()) as { id: string }).id;
}

async function downloadPart(id: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${PART_API}/${encodeURIComponent(id)}`);
  } catch {
    throw offline();
  }
  if (!res.ok) throw await failure(res, 'เปิดลิงก์ไม่ได้');
  return res.blob();
}

/** Runs the tasks a few at a time, keeping their order in the answer. */
async function inBatches<T>(tasks: (() => Promise<T>)[], size = 3): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

/** Stores the project on the server (gzipped, in pieces) and gives back the new share's id. */
export async function createShare(project: Project, meta: Omit<ShareMeta, 'name'>): Promise<string> {
  const packed = await gzip(JSON.stringify(await bundleProject(project)));
  const count = Math.max(1, Math.ceil(packed.length / PART_BYTES));
  if (count > MAX_PARTS) throw new Error('แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์ ส่งออกเป็นไฟล์ .json แทน');
  const parts = await inBatches(Array.from({ length: count }, (_, i) => () => uploadPart(packed.subarray(i * PART_BYTES, (i + 1) * PART_BYTES))));
  let res: Response;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts, meta: { ...meta, name: project.name } }),
    });
  } catch {
    throw offline();
  }
  if (!res.ok) throw await failure(res, 'สร้างลิงก์ไม่สำเร็จ');
  return ((await res.json()) as { id: string }).id;
}

async function fetchShare(id: string): Promise<{ bundle: Bundle; meta: ShareMeta; createdAt: number }> {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(id)}`);
  } catch {
    throw offline();
  }
  if (!res.ok) throw await failure(res, 'เปิดลิงก์ไม่ได้');
  const share = (await res.json()) as Share;
  if (share.bundle) return { bundle: share.bundle, meta: share.meta, createdAt: share.createdAt };
  if (!share.parts?.length) throw new Error('เปิดลิงก์ไม่ได้');
  const pieces = await inBatches(share.parts.map((p) => () => downloadPart(p)));
  const bundle = JSON.parse(await gunzip(new Blob(pieces))) as Bundle;
  return { bundle, meta: share.meta, createdAt: share.createdAt };
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
