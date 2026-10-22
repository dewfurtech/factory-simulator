import { useEffect, useState } from 'react';
import type { Id, Vec2 } from '../model/types';
import { activeUnderlay, calibrate, underlayRect } from '../model/underlay';
import { dist, lerp } from '../model/vec';
import { loadAsset } from '../store/persist';
import { applyEdit, useProject } from '../store/project';
import { SELECT, useUi } from '../store/ui';

function useBlobUrl(id: Id | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setUrl(null);
    let made: string | null = null;
    let live = true;
    void loadAsset(id).then((blob) => {
      if (!live || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}

/** The active storey's plan image under the drawing; outlined while it is being moved, shown in full while peeked at. */
export function UnderlayImage({ px, peek }: { px: number; peek?: boolean }) {
  const u = useProject((s) => activeUnderlay(s.project!));
  const moving = useUi((s) => s.tool.kind === 'moveUnderlay');
  const url = useBlobUrl(u?.imageId);
  if (!u || (u.hidden && !peek) || !url) return null;
  const r = underlayRect(u);
  return (
    <g transform={`rotate(${u.rotation} ${u.x} ${u.y})`} pointerEvents="none" data-testid="underlay">
      <image href={url} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" opacity={peek ? 1 : u.opacity} />
      {moving && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#2563eb" strokeWidth={2 * px} strokeDasharray={`${8 * px} ${5 * px}`} />}
    </g>
  );
}

/** The span being measured for calibration, from its first point to the second or the pointer. */
export function CalibrateOverlay({ px }: { px: number }) {
  const tool = useUi((s) => s.tool);
  const cursor = useUi((s) => s.cursor);
  if (tool.kind !== 'calibrate' || !tool.a) return null;
  const end = tool.b ?? cursor?.point;
  const dot = (p: Vec2) => <circle cx={p.x} cy={p.y} r={4 * px} fill="#fff" stroke="#dc2626" strokeWidth={2 * px} />;
  return (
    <g pointerEvents="none" data-testid="calibrate-line">
      {end && <line x1={tool.a.x} y1={tool.a.y} x2={end.x} y2={end.y} stroke="#dc2626" strokeWidth={2 * px} />}
      {dot(tool.a)}
      {end && dot(end)}
    </g>
  );
}

/** Asks how long the picked span really is, over its midpoint, and rescales the underlay to match. */
export function CalibrateInput({ toScreen }: { toScreen: (p: Vec2) => Vec2 }) {
  const tool = useUi((s) => s.tool);
  const [value, setValue] = useState('');
  const span = tool.kind === 'calibrate' && tool.a && tool.b ? { a: tool.a, b: tool.b } : null;
  useEffect(() => {
    if (span) setValue((dist(span.a, span.b) / 1000).toFixed(2));
    // Refilled only when a new span is picked, not on every pan.
  }, [span?.b]);
  if (!span) return null;
  const at = toScreen(lerp(span.a, span.b, 0.5));
  const commit = () => {
    const m = parseFloat(value);
    if (m > 0)
      applyEdit((d) => {
        const u = d.underlay;
        if (u) calibrate(u, span.a, span.b, m * 1000);
      });
    useUi.getState().setTool(SELECT);
  };
  return (
    <div className="calibrate-input glass" style={{ left: at.x, top: at.y }}>
      <span>ระยะจริง</span>
      <input
        autoFocus
        value={value}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') useUi.getState().setTool(SELECT);
        }}
        aria-label="ระยะจริงของเส้นที่วัด (ม.)"
        data-testid="calibrate-length"
      />
      <span>ม.</span>
      <button className="btn btn-sm btn-primary" onClick={commit} data-testid="calibrate-ok">
        ตั้งสเกล
      </button>
    </div>
  );
}
