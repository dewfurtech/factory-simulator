import { useEffect, useRef, useState } from 'react';
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
 * Pictures of the factory from Google Flow. Flow has no API and no link that takes a prompt, so the dialog does the
 * hand-over both ways: it writes a prompt from the plan (editable, kept with the project), gives a reference picture
 * of the plan or the 3D view to upload there, and takes the finished picture back by drop, paste or file, kept with
 * the project beside the plan image.
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

async function addRender(blob: Blob, prompt: string): Promise<void> {
  const assetId = newId('r');
  await saveAsset(assetId, blob);
  const r: Render = { id: newId('rn'), assetId, createdAt: Date.now(), prompt };
  applyEdit((d) => {
    (d.renders ??= []).push(r);
  });
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
        <Icon name="image" /> {room ? 'สร้างภาพห้องด้วย Google Flow' : 'สร้างภาพโรงงานด้วย Google Flow'}
      </h2>
      <p>
        Google Flow ยังไม่มี API ให้เว็บนี้สั่งสร้างและรับภาพกลับเองได้ จึงทำเป็น 3 ขั้น: คัดลอกพรอมต์ไปวางใน Flow → อัปโหลดภาพอ้างอิงจากแปลนนี้ให้ Flow ดูตำแหน่ง{what} →
        ได้ภาพแล้วลากหรือวาง (Ctrl+V) กลับมาที่นี่ ภาพจะเก็บไว้กับโปรเจกต์
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

      <section className="flow-step">
        <h3>2. ภาพอ้างอิงให้ Flow</h3>
        <div className="flow-ref">
          {ref ? <img src={ref.url} alt="ภาพอ้างอิงจากแปลน" /> : <div className="flow-ref-empty">{refBusy ? 'กำลังถ่ายภาพ…' : 'ไม่มีมุมมองให้ถ่าย'}</div>}
          <div className="flow-ref-text">
            <p>
              {has3d ? 'ถ่ายจากมุมมอง 3D ที่เปิดอยู่' : 'ถ่ายจากแปลน 2D'} ดาวน์โหลดแล้วอัปโหลดเป็นภาพอ้างอิง (Ingredients / Frames) ใน Flow เพื่อให้ตำแหน่ง{what}ตรงกับแปลน
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
        <h3>3. ภาพที่ได้กลับมา {renders.length ? `(${renders.length})` : ''}</h3>
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

      <div className="dialog-actions">
        <button className="btn" onClick={done}>
          ปิด
        </button>
        <button className="btn btn-primary" onClick={openFlow} data-testid="flow-open">
          <Icon name="forward" /> คัดลอกพรอมต์แล้วเปิด Google Flow
        </button>
      </div>
    </div>
  );
}

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
    <figure className="flow-thumb" title={r.prompt}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="เปิดภาพเต็มในแท็บใหม่">
          <img src={url} alt={`ภาพจาก Flow ${when}`} />
        </a>
      ) : (
        <div className="flow-ref-empty">…</div>
      )}
      <figcaption>
        <span>{when}</span>
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
