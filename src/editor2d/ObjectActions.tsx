import type { CSSProperties, ReactNode, Ref } from 'react';
import { Icon } from './Toolbar';
import { deleteSelection, rotateObject } from './tools';
import { useUi } from '../store/ui';
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
