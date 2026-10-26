import { useEffect, useState } from 'react';

/**
 * Talking to the "Factory Simulator → Google Flow" Chrome extension (extension/flow-bridge/). The extension's script
 * on our pages (bridge.js) marks <html data-flow-bridge="<version>"> and passes messages both ways with
 * window.postMessage: the page posts a job (prompt + reference picture), the extension opens Flow, fills a new project
 * and posts back progress and, at the end, the pictures Flow made. Nothing here works without the extension; the
 * dialog then offers the hand-over by copy and paste as before.
 */

const PAGE = 'factory-sim';
const EXT = 'flow-bridge';

export interface FlowJob {
  id: string;
  prompt: string;
  image?: { mimeType: string; data: string };
}

export type FlowEvent =
  | { type: 'progress'; jobId: string; step: string; text: string }
  | { type: 'done'; jobId: string; images: string[] }
  | { type: 'error'; jobId: string; error: string };

/** The installed extension's version, or null when there is none. */
export function useFlowExtension(): string | null {
  const [version, setVersion] = useState<string | null>(() => document.documentElement.dataset.flowBridge ?? null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== EXT || e.data.type !== 'ready') return;
      setVersion(String(e.data.version ?? '?'));
    };
    window.addEventListener('message', onMessage);
    // The extension may have loaded after this page read the mark: ask again.
    window.postMessage({ source: PAGE, type: 'ping' }, location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return version;
}

/** Hands a job to the extension; `onEvent` hears its progress until it is done or fails. Returns a stop-listening. */
export function sendToFlow(job: FlowJob, onEvent: (e: FlowEvent) => void): () => void {
  const onMessage = (e: MessageEvent) => {
    const m = e.data;
    if (e.source !== window || m?.source !== EXT || m.jobId !== job.id) return;
    if (m.type === 'progress' || m.type === 'done' || m.type === 'error') onEvent(m as FlowEvent);
    if (m.type === 'done' || m.type === 'error') window.removeEventListener('message', onMessage);
  };
  window.addEventListener('message', onMessage);
  window.postMessage({ source: PAGE, type: 'flow-job', job }, location.origin);
  return () => window.removeEventListener('message', onMessage);
}

/** A data: URL (what the extension sends pictures back as) as a Blob. */
export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}
