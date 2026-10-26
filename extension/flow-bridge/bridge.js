// Runs on Factory Simulator's own pages (the live site and localhost; see manifest.json). It is the only way the page
// and the extension talk: the page posts a job with window.postMessage, this passes it to the background worker, and
// passes the worker's progress and the finished pictures back to the page the same way. Only messages from this very
// window with source 'factory-sim' are taken, so another site cannot start a job.
const VERSION = chrome.runtime.getManifest().version;
const PAGE = 'factory-sim';
const EXT = 'flow-bridge';

const toPage = (msg) => window.postMessage({ source: EXT, ...msg }, location.origin);

// The page can see the extension is there before it asks (the DOM is shared with the page; scripts are not).
document.documentElement.dataset.flowBridge = VERSION;
toPage({ type: 'ready', version: VERSION });

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || msg.source !== PAGE) return;
  if (msg.type === 'ping') return toPage({ type: 'ready', version: VERSION });
  if (msg.type === 'flow-job' && msg.job && typeof msg.job.id === 'string' && typeof msg.job.prompt === 'string') {
    chrome.runtime.sendMessage({ type: 'start', job: msg.job }).catch((err) => toPage({ type: 'error', jobId: msg.job.id, error: `ส่วนขยายไม่ตอบ: ${err.message}` }));
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.jobId && ['progress', 'done', 'error'].includes(msg.type)) toPage(msg);
});
