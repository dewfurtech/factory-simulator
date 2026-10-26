import { useEffect, useRef, useState } from 'react';
import type { RenderError } from '../ai/gemini';
import { dataUrlToBlob, sendToFlow, useFlowExtension } from '../ai/flowExtension';
import { chooseProject, GOOGLE_CLIENT_ID, prepareGoogle, renderAsUser, signedIn, signInWithGoogle, signOutOfGoogle, useGoogle } from '../ai/googleAccount';
import { download, planPicture, shownScale, toPng } from '../editor2d/exportImage';
import { Icon } from '../editor2d/Toolbar';
import { newId } from '../model/id';
import { isInterior } from '../interior/project';
import { buildInteriorPrompt } from '../interior/renderPrompt';
import { buildRenderPrompt, FLOW_URL } from '../model/renderPrompt';
import type { Id, Project, Render } from '../model/types';
import { loadAsset, saveAsset } from '../store/persist';
import { applyEdit, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { customDialog } from './Dialog';

/**
 * Whether the AI picture buttons show (top bar and main menu, factory and interior). Off for now: the owner is not
 * using it yet. The dialog, its prompts and the pictures already kept with projects stay as they are; true brings
 * the buttons back.
 */
export const AI_PICTURES = false;

/**
 * Pictures of the factory or the room from an image model. Two ways, side by side: the site's own server asks the Gemini API
 * (POST /api/render, src/server/render.ts) with the same prompt and reference picture and the picture lands in the
 * gallery by itself, when the server has a key; or Google Flow by hand, which has no API and no link that takes a
 * prompt, so the dialog does the hand-over both ways: it writes a prompt from the plan (editable, kept with the
 * project), gives a reference picture of the plan or the 3D view to upload there, and takes the finished picture back
 * by drop, paste or file. Either way the picture is kept with the project beside the plan image.
 */
export function openFlowDialog(): Promise<void> {
  return customDialog((close) => <FlowPanel close={close} />, { wide: true });
}

/**
 * The 3D view when it is on screen, else the 2D plan drawn as on screen now. With `clay`, the 3D view is taken in
 * plain clay with shadows (shapes and light only, which an AI picture tool follows best); the screen keeps its look.
 */
async function referencePicture(project: Project, clay: boolean): Promise<Blob | null> {
  const snap = useUi.getState().snapshot3d;
  if (snap) {
    const b = await snap(undefined, clay ? { clay: true, shadows: true } : undefined);
    if (b) return b;
  }
  const svg = document.querySelector<SVGSVGElement>('svg.plan-svg');
  if (!svg) return null;
  const pic = await planPicture(svg, project, shownScale(svg));
  return pic ? toPng(pic) : null;
}

/** The prompt written from the project: a room's for an interior, the factory hall's for a factory. */
const buildPrompt = (p: Project): string => (isInterior(p) ? buildInteriorPrompt(p) : buildRenderPrompt(p));

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'factory';

async function addRender(blob: Blob, prompt: string, model?: string): Promise<void> {
  const assetId = newId('r');
  await saveAsset(assetId, blob);
  const r: Render = { id: newId('rn'), assetId, createdAt: Date.now(), prompt, ...(model ? { model } : {}) };
  applyEdit((d) => {
    (d.renders ??= []).push(r);
  });
}

/** What the server says about making pictures itself: a key set or not, and which model it asks. */
interface RenderStatus {
  ready: boolean;
  model: string;
  error?: string;
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Asks the server for a picture; the answer is the picture, or an error line to show. */
async function renderOnServer(prompt: string, image: { mimeType: string; data: string } | undefined): Promise<{ blob: Blob; model: string } | RenderError> {
  let res: Response;
  try {
    res = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, image, aspectRatio: '16:9' }) });
  } catch {
    return { error: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' };
  }
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
    try {
      const body = (await res.json()) as RenderError;
      if (body.error) return body;
    } catch {
      /* not JSON: the status line below */
    }
    return { error: `เซิร์ฟเวอร์ตอบ ${res.status}` };
  }
  return { blob: await res.blob(), model: res.headers.get('x-render-model') ?? '' };
}

function FlowPanel({ close }: { close: () => void }) {
  const project = useProject((s) => s.project!);
  const renders = project.renders ?? [];
  // An interior is pictured as its rooms and furniture; a factory as its hall and machines.
  const room = isInterior(project);
  const what = room ? 'เฟอร์นิเจอร์' : 'เครื่อง';
  const [prompt, setPrompt] = useState(() => project.renderPrompt ?? buildPrompt(project));
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [ref, setRef] = useState<{ url: string; blob: Blob } | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [clayShot, setClayShot] = useState(false);
  const has3d = !!useUi.getState().snapshot3d;
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const edited = prompt !== (project.renderPrompt ?? buildPrompt(project));
  // Making the picture here: whether the server can (it has a key), and how the one in progress is going.
  const [server, setServer] = useState<RenderStatus | null>(null);
  const [making, setMaking] = useState<{ busy: boolean; error?: RenderError; done?: number }>({ busy: false });
  // Signing in with Google: the person's own account and Cloud project instead of the server's key.
  const google = useGoogle();
  const viaGoogle = signedIn(google) && Boolean(google.project);
  const canMake = viaGoogle || Boolean(server?.ready);

  useEffect(() => prepareGoogle(), []);
  useEffect(() => {
    let gone = false;
    fetch('/api/render')
      .then((r) => r.json() as Promise<RenderStatus>)
      .then((s) => !gone && setServer(s))
      .catch(() => !gone && setServer({ ready: false, model: '', error: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' }));
    return () => {
      gone = true;
    };
  }, []);

  // The reference picture is taken when the dialog opens (the 3D view when it is up, else the plan), and again in
  // the other look when the clay switch changes.
  useEffect(() => {
    let gone = false;
    setRefBusy(true);
    void referencePicture(project, clayShot).then((blob) => {
      if (gone) return;
      if (!blob) return setRefBusy(false);
      setRef({ url: URL.createObjectURL(blob), blob });
      setRefBusy(false);
    });
    return () => {
      gone = true;
    };
  }, [clayShot]);
  useEffect(
    () => () => {
      if (ref) URL.revokeObjectURL(ref.url);
    },
    [ref],
  );

  // Ctrl+V anywhere in the dialog brings a picture in from the clipboard (Flow's "copy image").
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void addRender(file, prompt);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [prompt]);

  const keepPrompt = () => {
    const built = buildPrompt(project);
    const next = prompt.trim() === built.trim() ? undefined : prompt;
    if (next !== project.renderPrompt)
      applyEdit((d) => {
        if (next) d.renderPrompt = next;
        else delete d.renderPrompt;
      });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('no'), 2500);
  };

  const openFlow = () => {
    // The window opens first, in the click: after an await some browsers would block it as a pop-up.
    window.open(FLOW_URL, '_blank', 'noopener');
    keepPrompt();
    void copy();
  };

  const makeHere = async () => {
    if (making.busy || !canMake) return;
    keepPrompt();
    setMaking({ busy: true });
    const image = ref ? { mimeType: ref.blob.type || 'image/png', data: await blobToBase64(ref.blob) } : undefined;
    const input = { prompt, image, aspectRatio: '16:9' };
    // The signed-in account first: the person chose it over the site's key by signing in.
    const got = viaGoogle ? await renderAsUser({ token: google.token!, project: google.project }, input) : await renderOnServer(prompt, image);
    if ('error' in got) return setMaking({ busy: false, error: got });
    await addRender(got.blob, prompt, got.model || server?.model);
    setMaking({ busy: false, done: Date.now() });
  };

  // One click into Flow through the Chrome extension: it opens Flow, fills a new project and sends the pictures back.
  const extension = useFlowExtension();
  const [flowJob, setFlowJob] = useState<{ busy: boolean; text?: string; error?: string; got?: number }>({ busy: false });
  const sendViaExtension = async () => {
    if (flowJob.busy || !extension) return;
    keepPrompt();
    setFlowJob({ busy: true, text: 'กำลังส่งให้ส่วนขยาย…' });
    const image = ref ? { mimeType: ref.blob.type || 'image/png', data: await blobToBase64(ref.blob) } : undefined;
    const sentPrompt = prompt;
    sendToFlow({ id: newId('fj'), prompt: sentPrompt, image }, (e) => {
      if (e.type === 'progress') setFlowJob({ busy: true, text: e.text });
      else if (e.type === 'error') setFlowJob({ busy: false, error: e.error });
      else
        void (async () => {
          for (const url of e.images) await addRender(await dataUrlToBlob(url), sentPrompt, FLOW_MODEL);
          setFlowJob({ busy: false, got: e.images.length });
        })();
    });
  };

  const takeFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) if (f.type.startsWith('image/')) void addRender(f, prompt);
  };

  const done = () => {
    keepPrompt();
    close();
  };

  return (
    <div className="flow" data-testid="flow-dialog">
      <h2>
        <Icon name="image" /> {room ? 'สร้างภาพห้องด้วย AI' : 'สร้างภาพโรงงานด้วย AI'}
      </h2>
      <p>
        สองทาง: <b>สร้างในเว็บเลย</b> ให้เซิร์ฟเวอร์ส่งพรอมต์กับภาพอ้างอิงไปที่ Gemini แล้วภาพมาลงแกลเลอรีเอง หรือ <b>Google Flow</b> ซึ่งไม่มี API จึงทำเป็น 3 ขั้น:
        คัดลอกพรอมต์ไปวางใน Flow → อัปโหลดภาพอ้างอิงจากแปลนนี้ให้ Flow ดูตำแหน่ง{what} → ได้ภาพแล้วลากหรือวาง (Ctrl+V) กลับมาที่นี่ ภาพทั้งสองทางเก็บไว้กับโปรเจกต์
      </p>

      <section className="flow-step">
        <h3>1. พรอมต์ (แก้ได้ตามใจ)</h3>
        <textarea rows={9} value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false} data-testid="flow-prompt" />
        <div className="flow-row">
          <button
            className="btn btn-sm"
            onClick={() => setPrompt(buildPrompt(project))}
            disabled={!edited && !project.renderPrompt}
            title="ทิ้งที่แก้ไว้ แล้วเขียนใหม่จากแปลนตามที่เป็นอยู่ตอนนี้"
          >
            <Icon name="reset" /> เขียนใหม่จากแปลน
          </button>
          <button className="btn btn-sm" onClick={() => void copy()} data-testid="flow-copy">
            <Icon name="copy" /> {copied === 'yes' ? 'คัดลอกแล้ว' : copied === 'failed' ? 'คัดลอกไม่ได้ เลือกข้อความแล้ว Ctrl+C' : 'คัดลอกพรอมต์'}
          </button>
        </div>
      </section>

      <section className="flow-step flow-make" data-testid="flow-make">
        <h3>สร้างในเว็บเลย (Gemini)</h3>
        <GoogleConnect />
        <div className="flow-row">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void makeHere()}
            aria-busy={making.busy}
            disabled={!canMake || making.busy || !prompt.trim()}
            data-testid="flow-make-button"
          >
            {making.busy ? <span className="spinner" aria-hidden /> : <Icon name="bulb" />} {making.busy ? 'กำลังสร้างภาพ…' : 'สร้างภาพในเว็บเลย'}
          </button>
          <span className="flow-make-note" data-testid="flow-make-note">
            {viaGoogle
              ? `ใช้พรอมต์ข้างบนกับ${ref ? 'ภาพอ้างอิงข้างล่าง' : 'ไม่มีภาพอ้างอิง'} คิดเงินที่โปรเจกต์ ${google.project} ของคุณ ราว 20–40 วินาที`
              : !server
                ? 'กำลังถามเซิร์ฟเวอร์…'
                : server.ready
                  ? `ใช้พรอมต์ข้างบนกับ${ref ? 'ภาพอ้างอิงข้างล่าง' : 'ไม่มีภาพอ้างอิง'} ผ่านคีย์ของเว็บ รุ่น ${server.model} ราว 20–40 วินาที`
                  : GOOGLE_CLIENT_ID
                    ? 'เข้าสู่ระบบด้วย Google แล้วเลือกโปรเจกต์ก่อน'
                    : (server.error ?? 'เซิร์ฟเวอร์ยังไม่มีคีย์ Gemini')}
          </span>
        </div>
        {making.error && (
          <p className="flow-make-error" role="alert" data-testid="flow-make-error">
            สร้างภาพไม่สำเร็จ: {making.error.error}
            {making.error.link && (
              <>
                {' '}
                <a href={making.error.link.href} target="_blank" rel="noreferrer">
                  {making.error.link.label}
                </a>
              </>
            )}
          </p>
        )}
        {making.done && !making.busy && !making.error && <p className="flow-make-ok">ได้ภาพแล้ว อยู่ในแกลเลอรีข้างล่าง</p>}
      </section>

      <section className="flow-step">
        <h3>2. ภาพอ้างอิงให้ Flow</h3>
        <div className="flow-ref">
          {ref ? <img src={ref.url} alt="ภาพอ้างอิงจากแปลน" /> : <div className="flow-ref-empty">{refBusy ? 'กำลังถ่ายภาพ…' : 'ไม่มีมุมมองให้ถ่าย'}</div>}
          <div className="flow-ref-text">
            <p>
              {has3d ? 'ถ่ายจากมุมมอง 3D ที่เปิดอยู่' : 'ถ่ายจากแปลน 2D'} ปุ่ม "สร้างในเว็บเลย" ส่งภาพนี้ไปด้วย ส่วน Flow
              ให้ดาวน์โหลดแล้วอัปโหลดเป็นภาพอ้างอิง (Ingredients / Frames) เพื่อให้ตำแหน่ง{what}ตรงกับแปลน
            </p>
            {has3d && (
              <label className="flow-clay" title="ถ่ายมุมเดิมเป็นดินปั้นสีขาวพร้อมเงา ไม่มีสีและวัสดุ ให้ AI ยึดรูปทรงและแสงเงา (หน้าจอไม่เปลี่ยน)">
                <input type="checkbox" checked={clayShot} onChange={(e) => setClayShot(e.target.checked)} data-testid="flow-clay" /> ถ่ายแบบดินปั้น
              </label>
            )}
            <button className="btn btn-sm" disabled={!ref} onClick={() => ref && download(ref.blob, `${safeName(project.name)}-reference.png`)} data-testid="flow-ref-download">
              <Icon name="download" /> ดาวน์โหลดภาพอ้างอิง
            </button>
          </div>
        </div>
      </section>

      <section className="flow-step">
        <h3>3. ภาพที่ได้ {renders.length ? `(${renders.length})` : ''}</h3>
        <div
          className={`flow-drop${dragOver ? ' over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => (e.preventDefault(), setDragOver(false), takeFiles(e.dataTransfer.files))}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
          data-testid="flow-drop"
        >
          <Icon name="upload" /> ลากภาพจาก Flow มาวางที่นี่ กด Ctrl+V หรือคลิกเพื่อเลือกไฟล์
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => (e.target.files && takeFiles(e.target.files), (e.target.value = ''))} />
        </div>
        {renders.length > 0 && (
          <div className="flow-gallery">
            {[...renders].reverse().map((r) => (
              <RenderThumb key={r.id} r={r} name={project.name} />
            ))}
          </div>
        )}
      </section>

      {(flowJob.busy || flowJob.error || flowJob.got !== undefined) && (
        <p className={`flow-ext-status${flowJob.error ? ' flow-make-error' : ''}`} role="status" data-testid="flow-ext-status">
          {flowJob.busy && <span className="spinner dark" aria-hidden />}
          {flowJob.error ? `ส่งเข้า Flow ไม่สำเร็จ: ${flowJob.error}` : flowJob.busy ? flowJob.text : `ได้ภาพจาก Flow ${flowJob.got} ภาพ อยู่ในแกลเลอรีข้างบน`}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={done}>
          ปิด
        </button>
        <button className={`btn${extension ? '' : ' btn-primary'}`} onClick={openFlow} data-testid="flow-open">
          <Icon name="forward" /> คัดลอกพรอมต์แล้วเปิด Google Flow
        </button>
        {extension && (
          <button
            className="btn btn-primary"
            onClick={() => void sendViaExtension()}
            disabled={flowJob.busy || !prompt.trim()}
            aria-busy={flowJob.busy}
            data-testid="flow-ext-send"
          >
            <Icon name="forward" /> ส่งเข้า Flow ให้เลย
          </button>
        )}
      </div>
      {!extension && (
        <p className="flow-make-note">ติดตั้งส่วนขยาย Chrome "Factory Simulator → Google Flow" (ดู README) แล้วจะมีปุ่มส่งเข้า Flow ในคลิกเดียว และภาพกลับมาที่นี่เอง</p>
      )}
    </div>
  );
}

/**
 * Signing in with Google and choosing the Cloud project to bill. Hidden when the site has no OAuth client ID
 * (VITE_GOOGLE_CLIENT_ID); then only the server's key is offered.
 */
function GoogleConnect() {
  const g = useGoogle();
  if (!GOOGLE_CLIENT_ID) return null;
  const on = signedIn(g);
  const consoleLink = (path: string) => `https://console.cloud.google.com/${path}${g.project ? `?project=${encodeURIComponent(g.project)}` : ''}`;
  return (
    <div className="flow-google" data-testid="flow-google">
      {!on ? (
        <div className="flow-row">
          <button className="btn btn-sm" onClick={signInWithGoogle} disabled={g.phase !== 'ready'} data-testid="flow-google-signin">
            <GoogleMark /> {g.token ? 'เข้าสู่ระบบ Google อีกครั้ง' : 'เข้าสู่ระบบด้วย Google'}
          </button>
          <span className="flow-make-note">
            {g.phase === 'loading' || g.phase === 'idle'
              ? 'กำลังโหลดระบบเข้าสู่ระบบของ Google…'
              : g.token
                ? 'การเข้าสู่ระบบหมดอายุแล้ว (อยู่ได้ราว 1 ชั่วโมง)'
                : 'ใช้บัญชี Google และโปรเจกต์ Cloud ของคุณเอง ค่าภาพคิดที่โปรเจกต์นั้น ไม่ต้องไปเว็บอื่น'}
          </span>
        </div>
      ) : (
        <>
          <div className="flow-row">
            <span className="flow-google-who">
              <GoogleMark /> {g.email ?? 'เข้าสู่ระบบแล้ว'}
            </span>
            <label className="flow-google-project">
              โปรเจกต์ที่คิดเงิน
              {g.projects?.length ? (
                <select value={g.project} onChange={(e) => chooseProject(e.target.value)} data-testid="flow-google-project">
                  {g.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name === p.id ? p.id : `${p.name} (${p.id})`}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={g.project} onChange={(e) => chooseProject(e.target.value)} placeholder="project-id" spellCheck={false} data-testid="flow-google-project" />
              )}
            </label>
            <button className="btn btn-sm btn-ghost" onClick={signOutOfGoogle} data-testid="flow-google-signout">
              ออกจากระบบ
            </button>
          </div>
          {g.projects && !g.projects.length && <p className="flow-make-note">บัญชีนี้ยังไม่มีโปรเจกต์ Cloud สร้างใหม่ได้ที่ Google Cloud แล้วใส่รหัสโปรเจกต์ข้างบน</p>}
          {g.projectsError && <p className="flow-make-note">ดึงรายชื่อโปรเจกต์ไม่ได้ ({g.projectsError}) พิมพ์รหัสโปรเจกต์เองได้</p>}
          <p className="flow-make-note">
            โปรเจกต์ต้องเปิด{' '}
            <a href={consoleLink('apis/library/generativelanguage.googleapis.com')} target="_blank" rel="noreferrer">
              Generative Language API
            </a>{' '}
            และ{' '}
            <a href={consoleLink('billing/linkedaccount')} target="_blank" rel="noreferrer">
              billing
            </a>{' '}
            ไว้ (โมเดลสร้างภาพไม่มี free tier)
          </p>
        </>
      )}
      {g.error && (
        <p className="flow-make-error" role="alert">
          {g.error}
        </p>
      )}
    </div>
  );
}

/** Google's "G", in its colours, for the sign-in button (as Google's branding guidelines show it). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The model a picture records when the extension brought it back from Flow. */
const FLOW_MODEL = 'google-flow';
const sourceLabel = (r: Render) => (!r.model || r.model === FLOW_MODEL ? 'Flow' : 'Gemini');

function RenderThumb({ r, name }: { r: Render; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void loadAsset(r.assetId).then((b) => {
      if (!b) return;
      u = URL.createObjectURL(b);
      setBlob(b);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [r.assetId]);
  const remove = () =>
    applyEdit((d) => {
      d.renders = (d.renders ?? []).filter((x) => x.id !== r.id);
    });
  const when = new Date(r.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <figure className="flow-thumb" title={r.model ? `${r.model}\n${r.prompt ?? ''}` : r.prompt}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="เปิดภาพเต็มในแท็บใหม่">
          <img src={url} alt={`ภาพจาก ${sourceLabel(r)} ${when}`} />
        </a>
      ) : (
        <div className="flow-ref-empty">…</div>
      )}
      <figcaption>
        <span>
          {when}
          {r.model && <small> · {sourceLabel(r)}</small>}
        </span>
        <button
          className="ib sm"
          disabled={!blob}
          onClick={() => blob && download(blob, `${safeName(name)}-flow-${r.createdAt}.${blob.type.split('/')[1] || 'png'}`)}
          title="ดาวน์โหลด"
          aria-label="ดาวน์โหลด"
        >
          <Icon name="download" />
        </button>
        <button className="ib sm danger" onClick={remove} title="ลบภาพนี้ออกจากโปรเจกต์" aria-label="ลบ">
          <Icon name="trash" />
        </button>
      </figcaption>
    </figure>
  );
}

export type { Id };
