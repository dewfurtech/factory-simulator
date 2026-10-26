import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser's IndexedDB, as a map: what idb-keyval keeps is what these tests read back.
const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (k: string) => db.get(k),
  set: async (k: string, v: unknown) => void db.set(k, v),
  del: async (k: string) => void db.delete(k),
}));

import { newProject } from '../model/project';
import { deleteProject } from './persist';
import { openShare } from './share';

const projectKeys = () => [...db.keys()].filter((k) => k.startsWith('factory:project:'));

/** A share server holding one plan inline, counting how often it is asked. */
function serve() {
  const share = { bundle: { format: 'factory-sim', version: 1, project: newProject('แปลนที่แชร์'), assets: {} }, meta: { from: 'customer', name: 'แปลนที่แชร์' }, createdAt: 1 };
  const fetch = vi.fn(async () => new Response(JSON.stringify(share), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('opening a share link', () => {
  beforeEach(() => db.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('two opens at once (StrictMode runs the effect twice) make one copy, not two', async () => {
    const fetch = serve();
    const [a, b] = await Promise.all([openShare('abc'), openShare('abc')]);
    expect(a.project.id).toBe(b.project.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(projectKeys()).toHaveLength(1);
  });

  it('opening the same link again opens the copy already there', async () => {
    const fetch = serve();
    const first = await openShare('abc');
    const again = await openShare('abc');
    expect(again.project.id).toBe(first.project.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(projectKeys()).toHaveLength(1);
  });

  it('once its copy is deleted from the list, the link imports afresh', async () => {
    serve();
    const first = await openShare('abc');
    await deleteProject(first.project.id);
    const again = await openShare('abc');
    expect(again.project.id).not.toBe(first.project.id);
    expect(projectKeys()).toHaveLength(1);
  });
});
