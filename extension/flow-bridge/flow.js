// Runs on Google Flow (flow.google.com). When the background worker has a job for this tab, it does what a person would:
// New project → drop the reference picture on the project → type the prompt into the agent's box → Start generation,
// then waits for the pictures and sends them back. Every element is found the way Flow's page marks it (class names and
// aria-labels read from the live page on 2026-10-26); when Flow changes its page, these are the lines to update.
//
// Two things are left to the person on purpose: Flow's "Rights to use this image" agreement (accepting terms is theirs
// to do), and anything else Flow asks in a dialog. The script waits for them and says so on our page meanwhile.
const SEL = {
  newProject: 'button.new-project-button',
  projectPage: 'flow-project-page',
  emptyProject: '.empty-project-message',
  prompt: '.ProseMirror[contenteditable="true"]',
  send: 'button[aria-label="Start generation"]',
  dialog: 'mat-dialog-container',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (step, text) => chrome.runtime.sendMessage({ type: 'progress', step, text });
const fail = (error) => chrome.runtime.sendMessage({ type: 'error', error });

/** Waits until `find()` gives something, checking every 300 ms, for at most `ms`. */
async function waitFor(find, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    const got = find();
    if (got) return got;
    if (Date.now() > until) throw new Error(`ไม่เจอ${what}ในหน้า Flow (หน้าตา Flow อาจเปลี่ยน ต้องอัปเดตส่วนขยาย)`);
    await sleep(300);
  }
}

const base64ToFile = (image) => {
  const bin = atob(image.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = image.mimeType.split('/')[1] || 'png';
  return new File([bytes], `factory-plan-reference.${ext}`, { type: image.mimeType });
};

/** Drops the reference picture on the project page, as dragging a file from the desktop does. */
function dropFile(file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector(SEL.projectPage);
  for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
}

/** Waits while Flow shows a dialog (the rights agreement, mostly), telling our page that the person is needed. */
async function waitForDialogs(ms) {
  const until = Date.now() + ms;
  let told = false;
  while (document.querySelector(SEL.dialog)) {
    if (!told) {
      const title = document.querySelector(`${SEL.dialog} h1, ${SEL.dialog} h2, ${SEL.dialog} h3`)?.textContent.trim() ?? '';
      await progress('waiting-user', `Flow ถามว่า "${title || 'ยืนยัน'}" กรุณากดตอบในแท็บ Flow เอง`);
      told = true;
    }
    if (Date.now() > until) throw new Error('รอคำตอบในหน้าต่างของ Flow นานเกินไป');
    await sleep(500);
  }
}

function typePrompt(text) {
  const box = document.querySelector(SEL.prompt);
  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  document.execCommand('insertText', false, text);
}

async function run(job) {
  // 1. A new project, from Flow's home page.
  if (!location.pathname.startsWith('/project/')) {
    await progress('new-project', 'กำลังสร้าง New project ใน Flow');
    const button = await waitFor(() => document.querySelector(SEL.newProject), 30_000, 'ปุ่ม New project (ยังไม่ได้ login Flow หรือเปล่า?)');
    button.click();
    // Flow moves to /project/<id> in place; this same script keeps running.
    await waitFor(() => location.pathname.startsWith('/project/') && document.querySelector(SEL.prompt), 30_000, 'หน้าโปรเจกต์ใหม่');
  }
  await waitFor(() => document.querySelector(SEL.prompt), 30_000, 'ช่องพรอมต์');

  // 2. The reference picture, dropped on the project.
  if (job.image) {
    await progress('reference', 'กำลังใส่ภาพอ้างอิงจากแปลน');
    dropFile(base64ToFile(job.image));
    await sleep(800);
    await waitForDialogs(10 * 60_000);
  }

  // 3. The prompt, and send.
  await progress('prompt', 'กำลังใส่พรอมต์');
  typePrompt(job.prompt);
  const send = await waitFor(
    () => {
      const b = document.querySelector(SEL.send);
      return b && !b.disabled ? b : null;
    },
    15_000,
    'ปุ่ม Start generation',
  );
  send.click();
  await progress('sent', 'ส่งพรอมต์ให้ Flow แล้ว รอ Flow สร้างภาพ');

  // 4. The finished pictures: not written yet. Flow's agent answer and where its pictures appear have to be read from a
  // real generation first.
  throw new Error('ส่วนขยายรุ่นนี้ยังรับภาพกลับจาก Flow ไม่ได้ ภาพจะอยู่ในแท็บ Flow ให้ลากกลับมาเองก่อน');
}

(async () => {
  let job = null;
  try {
    ({ job } = await chrome.runtime.sendMessage({ type: 'get-job' }));
  } catch {
    return; // the extension was reloaded: nothing to do on this tab
  }
  if (!job) return;
  try {
    await run(job);
  } catch (e) {
    await fail(e.message || String(e));
  }
})();
