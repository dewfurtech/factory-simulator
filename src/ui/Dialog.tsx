import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

/**
 * The app's own ask-and-wait dialogs in place of the browser's prompt() and confirm(): one at a time, answered by a
 * button, Enter or Escape, and awaited by whoever asked. `DialogHost` draws the open one; mount it once.
 */

type Open =
  | { kind: 'confirm'; title: string; message?: string; ok: string; danger?: boolean; resolve: (yes: boolean) => void }
  | { kind: 'prompt'; title: string; label?: string; value: string; ok: string; resolve: (text: string | null) => void };

interface DialogState {
  open: Open | null;
}

const useDialog = create<DialogState>(() => ({ open: null }));

const close = () => useDialog.setState({ open: null });

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

export function DialogHost() {
  const open = useDialog((s) => s.open);
  if (!open) return null;
  return open.kind === 'confirm' ? <Confirm d={open} /> : <Prompt d={open} />;
}

function Backdrop({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
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
      <div className="dialog glass" role="dialog" aria-modal="true">
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
      {d.message && <p>{d.message}</p>}
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
