import { useEffect, useRef, useState } from 'react';

export interface HelpSection {
  title: string;
  items: string[];
}

/**
 * A "?" button that opens the tips for what is in hand, instead of a line of hints always on screen. The panel opens
 * beside the button (to its left by default) and closes on a click elsewhere or Esc.
 */
export function HelpButton({ sections, className = '', side = 'left' }: { sections: HelpSection[]; className?: string; side?: 'left' | 'below' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className={`help ${className}`} ref={root}>
      <button className={`help-btn${open ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="วิธีใช้" title="วิธีใช้" data-testid="help">
        ?
      </button>
      {open && (
        <div className={`help-pop glass ${side}`} role="dialog" aria-label="วิธีใช้" data-testid="help-pop">
          {sections.map((s) => (
            <section key={s.title}>
              <h4>{s.title}</h4>
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
