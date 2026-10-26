import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

/**
 * The app's own ask-and-wait dialogs in place of the browser's prompt() and confirm(): one at a time, answered by a
 * button, Enter or Escape, and awaited by whoever asked. `DialogHost` draws the open one; mount it once.
 */

type Open =
  | { kind: 'confirm'; title: string; message?: string; ok: string; danger?: boolean; resolve: (yes: boolean) => void }
  | { kind: 'prompt'; title: string; label?: string; value: string; ok: string; resolve: (text: string | null) => void }
  | { kind: 'share'; title: string; message: string; ok: string; sender: string; make: (note: string, sender: string) => Promise<string>; resolve: () => void }
  /** Any content, drawn by the caller; `wide` for a page-like dialog. Closed by the backdrop, Escape, or `closeDialog()`. */
  | { kind: 'custom'; render: (close: () => void) => React.ReactNode; wide?: boolean; resolve: () => void };

interface DialogState {
  open: Open | null;
}

const useDialog = create<DialogState>(() => ({ open: null }));

const close = () => useDialog.setState({ open: null });

/** Drops whatever dialog is open without an answer, e.g. when the page moves to another project. */
export function closeDialog(): void {
  const { open } = useDialog.getState();
  if (!open) return;
  close();
  if (open.kind === 'confirm') open.resolve(false);
  else if (open.kind === 'prompt') open.resolve(null);
  else open.resolve();
}

/** Yes or no. Resolves false when dismissed. */
export function confirmDialog(opts: { title: string; message?: string; ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialog.setState({ open: { kind: 'confirm', ok: 'ตกลง', ...opts, resolve } });
  });
}

/** A line of text. Resolves null when dismissed or left empty. */
export function promptDialog(opts: { title: string; label?: string; value?: string; ok?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialog.setState({ open: { kind: 'prompt', ok: 'ตกลง', value: '', ...opts, resolve } });
  });
}

/**
 * Makes a share link: an optional note, then `make` is called with it and the link it answers is shown to copy.
 * Resolves when the dialog closes.
 */
export function shareDialog(opts: { title: string; message: string; ok: string; sender: string; make: (note: string, sender: string) => Promise<string> }): Promise<void> {
  return new Promise((resolve) => {
    useDialog.setState({ open: { kind: 'share', ...opts, resolve } });
  });
}

/** A dialog of the caller's own content. Resolves when it closes. */
export function customDialog(render: (close: () => void) => React.ReactNode, opts: { wide?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    useDialog.setState({ open: { kind: 'custom', render, wide: opts.wide, resolve } });
  });
}

export function DialogHost() {
  const open = useDialog((s) => s.open);
  if (!open) return null;
  if (open.kind === 'custom') return <Custom d={open} />;
  if (open.kind === 'share') return <Share d={open} />;
  return open.kind === 'confirm' ? <Confirm d={open} /> : <Prompt d={open} />;
}

function Custom({ d }: { d: Extract<Open, { kind: 'custom' }> }) {
  const done = () => {
    close();
    d.resolve();
  };
  return (
    <Backdrop onDismiss={done} wide={d.wide}>
      {d.render(done)}
    </Backdrop>
  );
}

function Backdrop({ onDismiss, wide, children }: { onDismiss: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onDismiss()} data-testid="dialog">
      <div className={`dialog glass${wide ? ' dialog-wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function Confirm({ d }: { d: Extract<Open, { kind: 'confirm' }> }) {
  const answer = (yes: boolean) => {
    close();
    d.resolve(yes);
  };
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => okRef.current?.focus(), []);
  return (
    <Backdrop onDismiss={() => answer(false)}>
      <h2>{d.title}</h2>
      {d.message && <p style={{ whiteSpace: 'pre-line' }}>{d.message}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={() => answer(false)}>
          ยกเลิก
        </button>
        <button ref={okRef} className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)} data-testid="dialog-ok">
          {d.ok}
        </button>
      </div>
    </Backdrop>
  );
}

type ShareStep = { at: 'ask' } | { at: 'busy' } | { at: 'done'; url: string } | { at: 'failed'; error: string };

function Share({ d }: { d: Extract<Open, { kind: 'share' }> }) {
  const [note, setNote] = useState('');
  const [sender, setSender] = useState(d.sender);
  const [step, setStep] = useState<ShareStep>({ at: 'ask' });
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const done = () => {
    close();
    d.resolve();
  };
  const make = async () => {
    setStep({ at: 'busy' });
    try {
      setStep({ at: 'done', url: await d.make(note.trim(), sender.trim()) });
    } catch (e) {
      setStep({ at: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No clipboard access (an http page, or denied): leave the link selected for Ctrl+C.
      urlRef.current?.select();
      return;
    }
    setCopied(true);
  };
  useEffect(() => {
    if (step.at === 'done') urlRef.current?.select();
  }, [step.at]);
  return (
    <Backdrop onDismiss={done}>
      <h2>{d.title}</h2>
      {step.at === 'done' ? (
        <>
          <p>ส่งลิงก์นี้ให้ผู้รับได้ทุกช่องทาง ผู้รับเปิดในเบราว์เซอร์ได้เลย ไม่ต้องติดตั้งอะไร</p>
          <input ref={urlRef} readOnly value={step.url} onFocus={(e) => e.target.select()} data-testid="share-url" />
          <div className="dialog-actions">
            {typeof navigator.share === 'function' && (
              <button type="button" className="btn" onClick={() => void navigator.share({ title: d.title, url: step.url }).catch(() => undefined)}>
                แชร์…
              </button>
            )}
            <button type="button" className="btn" onClick={done}>
              ปิด
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void copy(step.url)} data-testid="share-copy">
              {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอกลิงก์'}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step.at !== 'busy') void make();
          }}
        >
          <p>{d.message}</p>
          <label htmlFor="dialog-sender">ชื่อผู้ส่ง (ไม่บังคับ)</label>
          <input
            id="dialog-sender"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            disabled={step.at === 'busy'}
            placeholder="เช่น ชื่อคุณ หรือชื่อบริษัท"
            data-testid="share-sender"
          />
          <label htmlFor="dialog-note">ข้อความถึงผู้รับ (ไม่บังคับ)</label>
          <textarea id="dialog-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={step.at === 'busy'} data-testid="share-note" />
          {step.at === 'failed' && (
            <p className="dialog-error" role="alert">
              {step.error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={done}>
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary" disabled={step.at === 'busy'} data-testid="share-make">
              {step.at === 'busy' ? 'กำลังสร้างลิงก์…' : step.at === 'failed' ? 'ลองอีกครั้ง' : d.ok}
            </button>
          </div>
        </form>
      )}
    </Backdrop>
  );
}

function Prompt({ d }: { d: Extract<Open, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(d.value);
  const answer = (text: string | null) => {
    close();
    d.resolve(text?.trim() ? text.trim() : null);
  };
  return (
    <Backdrop onDismiss={() => answer(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          answer(value);
        }}
      >
        <h2>{d.title}</h2>
        {d.label && <label htmlFor="dialog-input">{d.label}</label>}
        <input id="dialog-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} data-testid="dialog-input" />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => answer(null)}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()} data-testid="dialog-ok">
            {d.ok}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
