// The extension's background worker: opens Flow for a job from Factory Simulator, hands the job to the script on that
// Flow tab (flow.js), and sends its progress and pictures back to the Factory Simulator tab that asked. Jobs are kept in
// chrome.storage.session by Flow tab id, so they survive the worker being put to sleep in between.
const FLOW_URL = 'https://flow.google.com/';

const key = (flowTab) => `job:${flowTab}`;
const getJob = async (flowTab) => (await chrome.storage.session.get(key(flowTab)))[key(flowTab)];

async function tellSite(entry, msg) {
  try {
    await chrome.tabs.sendMessage(entry.siteTab, { ...msg, jobId: entry.job.id });
  } catch {
    // The Factory Simulator tab was closed or reloaded: nobody is left to tell.
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'start' && sender.tab) {
      const flowTab = await chrome.tabs.create({ url: FLOW_URL, active: true, index: sender.tab.index + 1 });
      const entry = { job: msg.job, siteTab: sender.tab.id, siteWindow: sender.tab.windowId, startedAt: Date.now() };
      await chrome.storage.session.set({ [key(flowTab.id)]: entry });
      await tellSite(entry, { type: 'progress', step: 'opened', text: 'เปิด Google Flow แล้ว' });
      return reply({ ok: true });
    }
    // From flow.js on a Flow tab.
    const flowTab = sender.tab && sender.tab.id;
    if (flowTab == null) return reply({});
    const entry = await getJob(flowTab);
    if (msg.type === 'get-job') return reply({ job: entry ? entry.job : null });
    if (!entry) return reply({});
    if (msg.type === 'progress') await tellSite(entry, { type: 'progress', step: msg.step, text: msg.text });
    if (msg.type === 'done' || msg.type === 'error') {
      await tellSite(entry, msg.type === 'done' ? { type: 'done', images: msg.images } : { type: 'error', error: msg.error });
      // Back to the plan, where the pictures now are.
      if (msg.type === 'done') chrome.tabs.update(entry.siteTab, { active: true }).catch(() => {});
      await chrome.storage.session.remove(key(flowTab));
    }
    reply({ ok: true });
  })();
  return true; // answers after the awaits above
});

// A Flow tab closed by hand before it finished: say so to the page waiting for it.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const entry = await getJob(tabId);
  if (!entry) return;
  await tellSite(entry, { type: 'error', error: 'แท็บ Google Flow ถูกปิดก่อนได้ภาพ' });
  await chrome.storage.session.remove(key(tabId));
});
