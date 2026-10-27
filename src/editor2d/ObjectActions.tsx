import { useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Icon } from './Toolbar';
import { deleteSelection, rotateObject, setObjectRotation } from './tools';
import { useUi } from '../store/ui';
import { useProject } from '../store/project';
import type { Id } from '../model/types';

/**
 * Round buttons that pop up over a picked machine, on the plan and in 3D: move, turn a quarter either way and delete.
 * `children` goes in the middle (the plan puts the angle there). A customer on a share link gets no delete.
 */
export function ObjectActions({
  id,
  onMove,
  moving,
  children,
  className = '',
  style,
  testId,
  boxRef,
}: {
  id: Id;
  onMove: () => void;
  moving?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  boxRef?: Ref<HTMLDivElement>;
}) {
  const customer = useUi((s) => !!s.customer);
  return (
    <div className={`obj-actions ${className}`} style={style} data-testid={testId} ref={boxRef}>
      <button className={`oa-btn${moving ? ' on' : ''}`} onClick={onMove} title="ย้าย (M)" aria-label="ย้าย" data-testid="oa-move">
        <Icon name="move" />
      </button>
      <button className="oa-btn flip" onClick={() => rotateObject(id, -Math.PI / 2)} title="หมุนซ้าย 90° (Shift+R)" aria-label="หมุนซ้าย 90°" data-testid="oa-rotate-left">
        <Icon name="rotate" />
      </button>
      {children}
      <button className="oa-btn" onClick={() => rotateObject(id, Math.PI / 2)} title="หมุนขวา 90° (R)" aria-label="หมุนขวา 90°" data-testid="oa-rotate-right">
        <Icon name="rotate" />
      </button>
      {!customer && (
        <button
          className="oa-btn danger"
          onClick={() => {
            useUi.getState().set({ selection: { kind: 'object', id }, boxed: [] });
            deleteSelection();
          }}
          title="ลบ (Delete)"
          aria-label="ลบ"
          data-testid="oa-delete"
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

/**
 * The machine's angle between the turn buttons: drag it sideways to turn the machine, a degree per pixel, in 5° steps
 * (freely with Alt); double-click it to type the angle. One undo step per drag. `onTurning` says when a drag starts and ends.
 */
export function RotateScrub({ id, rotation, onTurning }: { id: Id; rotation: number; onTurning?: (on: boolean) => void }) {
  const drag = useRef<{ x: number; rotation: number; started: boolean } | null>(null);
  const [typing, setTyping] = useState(false);
  const deg = Math.round(((((rotation * 180) / Math.PI) % 360) + 360) % 360);
  const drop = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    onTurning?.(false);
    if (d.started) useProject.getState().endGesture();
  };
  if (typing) {
    const done = (input: HTMLInputElement, keep: boolean) => {
      // Enter or Escape closes the box, and its blur on the way out must not apply it a second time.
      if (input.dataset.closed) return;
      input.dataset.closed = '1';
      setTyping(false);
      const v = Number(input.value.replace(/[°\s]/g, ''));
      if (keep && input.value.trim() && Number.isFinite(v)) setObjectRotation(id, (v * Math.PI) / 180, true);
    };
    return (
      <span className="rot-deg typing">
        <input
          autoFocus
          defaultValue={deg}
          inputMode="decimal"
          aria-label="มุม (องศา)"
          data-testid="rotate-input"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') done(e.currentTarget, true);
            if (e.key === 'Escape') done(e.currentTarget, false);
          }}
          onBlur={(e) => done(e.currentTarget, true)}
        />
        °
      </span>
    );
  }
  return (
    <span
      className="rot-deg"
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, rotation, started: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // The undo step starts with the first real move, so a click or double-click leaves none behind.
        if (!d.started) {
          if (Math.abs(e.clientX - d.x) < 2) return;
          d.started = true;
          useProject.getState().beginGesture();
          onTurning?.(true);
        }
        setObjectRotation(id, d.rotation + ((e.clientX - d.x) * Math.PI) / 180, e.altKey);
      }}
      onPointerUp={drop}
      onPointerCancel={drop}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setTyping(true);
      }}
      title="ลากซ้าย-ขวาเพื่อหมุน ทีละ 5° (Alt = ไม่สแนป) · ดับเบิลคลิกเพื่อพิมพ์มุม"
      data-testid="rotate-scrub"
    >
      {deg}°
    </span>
  );
}
