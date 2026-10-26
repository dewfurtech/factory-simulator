// Runs on Google Flow (flow.google.com). When the background worker has a job for this tab, it does what a person would:
// New project → drop the reference picture on the project → attach it to the prompt → type the prompt into the agent's
// box. Then the person presses Start generation themselves: Flow only acts on a real click there (a script's click or
// Enter is ignored, and the page runs reCAPTCHA), so the extension leaves that one click to them on purpose rather than
// working around it. After that it waits for the new pictures in the project, downloads them and sends them back. Every element is found the way Flow's page marks it (class names and
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
  // Every picture in the project is a tile; one still being made shows its progress as "40%".
  tile: 'flow-image-tile',
  // The "+" by the prompt opens a picker of the project's media; each item shows its file name, and picking one shows
  // a detail pane with "Add to prompt".
  addIngredient: 'button[aria-label="Add ingredients to the prompt box"]',
  pickerItem: 'flow-add-menu-asset-item',
  pickerItemTitle: '.asset-title',
  addToPrompt: 'flow-add-menu-detail-pane button',
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

const base64ToFile = (image, name) => {
  const bin = atob(image.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = image.mimeType.split('/')[1] || 'png';
  return new File([bytes], `${name}.${ext}`, { type: image.mimeType });
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

/** Picks the uploaded picture named `name` in the "+" picker and adds it to the prompt as an ingredient. */
async function addToPrompt(name) {
  const findItem = () => [...document.querySelectorAll(SEL.pickerItem)].find((i) => i.querySelector(SEL.pickerItemTitle)?.textContent.trim().startsWith(name));
  // The upload takes a moment to reach the picker: open it, look, close, and try again.
  const until = Date.now() + 90_000;
  let item = null;
  while (!item) {
    document.querySelector(SEL.addIngredient).click();
    await sleep(800);
    item = findItem();
    if (item) break;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (Date.now() > until) throw new Error('ภาพอ้างอิงที่อัปโหลดไม่ขึ้นในรายการของ Flow');
    await sleep(2000);
  }
  // Clicking the item attaches it and closes the picker (seen on the live page); "Add to prompt" in the detail pane is
  // only pressed when the picker is still open after that.
  item.click();
  await sleep(800);
  if (document.querySelector(SEL.pickerItem)) {
    const add = [...document.querySelectorAll(SEL.addToPrompt)].find((b) => /add to prompt/i.test(b.textContent) && !b.disabled);
    if (!add) throw new Error('แนบภาพอ้างอิงเข้ากับพรอมต์ไม่ได้ (ไม่เจอปุ่ม Add to prompt)');
    add.click();
    await sleep(600);
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
    // A name of its own, so the picker shows this very upload and not one from an earlier job.
    const name = `factory-plan-${job.id}`;
    dropFile(base64ToFile(job.image, name));
    await sleep(800);
    await waitForDialogs(10 * 60_000);
    await progress('reference', 'กำลังแนบภาพอ้างอิงเข้ากับพรอมต์');
    await addToPrompt(name);
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

  // 4. The person's one click. Pictures already in the project (the reference among them) are not the answer.
  const before = new Set(tileSources());
  send.style.outline = '3px solid #f97316';
  send.style.outlineOffset = '3px';
  send.scrollIntoView({ block: 'nearest' });
  await progress('your-turn', 'พร้อมแล้ว กดปุ่มลูกศร (Start generation) ที่มีกรอบสีส้มในแท็บ Flow หนึ่งครั้ง');
  await waitFor(() => !document.querySelector(SEL.prompt)?.innerText.trim() || newTiles(before).length > 0, 30 * 60_000, 'การกดส่ง (รอนานเกิน 30 นาที)');
  send.style.outline = '';
  await progress('generating', 'Flow กำลังสร้างภาพ (ถ้า Flow ถามยืนยัน ให้ตอบในแท็บ Flow)');

  // 5. The new pictures, once every one of them is finished and nothing more has come for a few seconds.
  const done = await waitForNewPictures(before, 15 * 60_000);
  await progress('downloading', `ได้ภาพ ${done.length} ภาพ กำลังส่งกลับ`);
  const images = [];
  for (const src of done) images.push(await toDataUrl(src));
  await chrome.runtime.sendMessage({ type: 'done', images });
}

/** The source of every finished picture tile in the project. */
function tileSources() {
  return [...document.querySelectorAll(`${SEL.tile} img`)].map((i) => i.src).filter(Boolean);
}

/** Tiles not in `before`: { src, finished }. */
function newTiles(before) {
  return [...document.querySelectorAll(SEL.tile)]
    .map((t) => {
      const img = t.querySelector('img');
      const busy = /d+%/.test(t.innerText);
      return { src: img?.src ?? '', finished: !busy && Boolean(img?.src) && img.naturalWidth > 0 };
    })
    .filter((t) => !t.src || !before.has(t.src));
}

async function waitForNewPictures(before, ms) {
  const until = Date.now() + ms;
  let last = '';
  let steadySince = 0;
  for (;;) {
    const fresh = newTiles(before);
    const allDone = fresh.length > 0 && fresh.every((t) => t.finished);
    const key = fresh.map((t) => t.src).join('|');
    if (allDone && key === last) {
      if (Date.now() - steadySince > 4000) return fresh.map((t) => t.src);
    } else {
      last = key;
      steadySince = Date.now();
    }
    if (Date.now() > until) throw new Error('Flow ยังสร้างภาพไม่เสร็จหลังรอ 15 นาที ภาพที่ได้จะอยู่ในแท็บ Flow');
    await sleep(1000);
  }
}

/** Downloads a picture Flow serves from its own site (with the person's sign-in) as a data: URL. */
async function toDataUrl(src) {
  const res = await fetch(src, { credentials: 'include' });
  if (!res.ok) throw new Error(`ดาวน์โหลดภาพจาก Flow ไม่ได้ (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
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
