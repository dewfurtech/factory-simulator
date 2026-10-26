import { createRoot } from 'react-dom/client';
import { elevations, type Elevation } from '../src/drawings/elevation';
import type { LineStyle, LineWeight, Prim, Pt } from '../src/drawings/types';
import { sampleCondo } from '../src/interior/sample';

/**
 * A page to look at the elevation generator by eye: every interior elevation of the sample condo, drawn at 1:30 by a
 * minimal SVG renderer of its own (the real sheet renderer lives with the A3 sheet system). Served by the dev server
 * at /sandbox/elevation.html; not part of the app.
 */

const SCALE = 30;
/** Paper mm to screen px at 100 % zoom. */
const PX = 3.78;
const PEN: Record<LineWeight, number> = { thin: 0.13, medium: 0.25, thick: 0.35, cut: 0.5 };
const DASH: Record<LineStyle, string | undefined> = { solid: undefined, dashed: '1.6 0.9', hidden: '0.8 0.6', center: '4 1 0.8 1' };
const POCHE = '#8d8d8d';

/** Model mm (y up) to paper mm (y down). */
const P = (p: Pt): Pt => ({ x: p.x / SCALE, y: -p.y / SCALE });
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function grow(b: Box, p: Pt, pad = 0) {
  b.x0 = Math.min(b.x0, p.x - pad);
  b.y0 = Math.min(b.y0, p.y - pad);
  b.x1 = Math.max(b.x1, p.x + pad);
  b.y1 = Math.max(b.y1, p.y + pad);
}

/** A dimension in paper mm: extension lines, the dimension line with architectural ticks, the figure above it. */
function dimParts(a: Pt, b: Pt, offset: number, text: string | undefined) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  // Left of a→b in model space (y up).
  const n = { x: -u.y, y: u.x };
  const pa = P(a);
  const pb = P(b);
  const on = (p: Pt, k: number) => ({ x: p.x + n.x * k, y: p.y - n.y * k });
  const da = on(pa, offset);
  const db = on(pb, offset);
  const sign = Math.sign(offset) || 1;
  // Reading direction: left to right, or bottom to top.
  const r = u.x > 1e-9 || (Math.abs(u.x) <= 1e-9 && u.y > 0) ? u : { x: -u.x, y: -u.y };
  const up = { x: -r.y, y: r.x };
  const mid = { x: (da.x + db.x) / 2 + up.x * 1, y: (da.y + db.y) / 2 - up.y * 1 };
  const angle = (Math.atan2(-r.y, r.x) * 180) / Math.PI;
  const tick = (p: Pt) => {
    const t = { x: (u.x + n.x) * 0.9, y: -(u.y + n.y) * 0.9 };
    return [
      { x: p.x - t.x, y: p.y - t.y },
      { x: p.x + t.x, y: p.y + t.y },
    ] as const;
  };
  return {
    ext: [
      [on(pa, sign * 1), on(pa, offset + sign * 1.5)],
      [on(pb, sign * 1), on(pb, offset + sign * 1.5)],
    ] as const,
    line: [on(pa, offset - 0 * sign), on(pb, offset)] as const,
    ticks: [tick(da), tick(db)],
    text: text ?? fmt(len),
    mid,
    angle,
  };
}

function ElevationSvg({ e }: { e: Elevation }) {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const out: JSX.Element[] = [];
  e.drawing.prims.forEach((p: Prim, i) => {
    const key = String(i);
    switch (p.kind) {
      case 'line': {
        const [a, b] = [P(p.a), P(p.b)];
        grow(box, a);
        grow(box, b);
        out.push(<line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeWidth={PEN[p.weight]} strokeDasharray={DASH[p.style ?? 'solid']} />);
        break;
      }
      case 'poly': {
        const pts = p.pts.map(P);
        pts.forEach((q) => grow(box, q));
        const d = pts.map((q) => `${q.x},${q.y}`).join(' ');
        const fill = p.fill === 'poche' ? POCHE : p.fill && p.fill !== 'none' ? p.fill : 'none';
        const Tag = p.closed ? 'polygon' : 'polyline';
        out.push(<Tag key={key} points={d} fill={fill} stroke="#000" strokeWidth={PEN[p.weight]} strokeDasharray={DASH[p.style ?? 'solid']} strokeLinejoin="miter" />);
        break;
      }
      case 'arc': {
        const c = P(p.c);
        const r = p.r / SCALE;
        grow(box, c, r);
        if (p.a1 - p.a0 >= 2 * Math.PI - 1e-9) out.push(<circle key={key} cx={c.x} cy={c.y} r={r} fill="none" stroke="#000" strokeWidth={PEN[p.weight]} />);
        else {
          const at = (a: number) => ({ x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) });
          const [s, f] = [at(p.a0), at(p.a1)];
          const large = p.a1 - p.a0 > Math.PI ? 1 : 0;
          out.push(<path key={key} d={`M${s.x},${s.y} A${r},${r} 0 ${large} 0 ${f.x},${f.y}`} fill="none" stroke="#000" strokeWidth={PEN[p.weight]} />);
        }
        break;
      }
      case 'text': {
        const a = P(p.at);
        const w = p.text.length * p.size * 0.55;
        const x0 = p.anchor === 'middle' ? a.x - w / 2 : p.anchor === 'end' ? a.x - w : a.x;
        grow(box, { x: x0, y: a.y - p.size });
        grow(box, { x: x0 + w, y: a.y + p.size * 0.3 });
        out.push(
          <text
            key={key}
            x={a.x}
            y={a.y}
            fontSize={p.size}
            textAnchor={p.anchor ?? 'start'}
            transform={p.rotate ? `rotate(${(-p.rotate * 180) / Math.PI} ${a.x} ${a.y})` : undefined}
          >
            {p.text}
          </text>,
        );
        break;
      }
      case 'dim': {
        const d = dimParts(p.a, p.b, p.offset, p.text);
        const sw = PEN.thin;
        [...d.ext, d.line].forEach(([a, b]) => {
          grow(box, a);
          grow(box, b);
        });
        grow(box, d.mid, 3);
        out.push(
          <g key={key}>
            {d.ext.map(([a, b], k) => (
              <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeWidth={sw} />
            ))}
            <line x1={d.line[0].x} y1={d.line[0].y} x2={d.line[1].x} y2={d.line[1].y} stroke="#000" strokeWidth={sw} />
            {d.ticks.map(([a, b], k) => (
              <line key={`t${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeWidth={PEN.thick} />
            ))}
            <text x={d.mid.x} y={d.mid.y} fontSize={2} textAnchor="middle" transform={`rotate(${d.angle} ${d.mid.x} ${d.mid.y})`}>
              {d.text}
            </text>
          </g>,
        );
        break;
      }
    }
  });
  const pad = 4;
  const w = box.x1 - box.x0 + 2 * pad;
  const h = box.y1 - box.y0 + 2 * pad;
  return (
    <svg viewBox={`${box.x0 - pad} ${box.y0 - pad} ${w} ${h}`} width={w * PX} height={h * PX} data-label={e.label}>
      {out}
    </svg>
  );
}

function Page() {
  const project = sampleCondo();
  // ?room=ห้องนอน&label=C shows just the elevations asked for (for screenshots).
  const q = new URLSearchParams(location.search);
  const all = elevations(project, 0, { scale: SCALE }).filter((e) => (!q.get('room') || e.roomName === q.get('room')) && (!q.get('label') || e.label === q.get('label')));
  const rooms = [...new Set(all.map((e) => e.roomName))];
  return (
    <>
      <h1>รูปด้านผนังภายใน · {project.name}</h1>
      <p className="note">มาตราส่วน 1:30 (ขนาดกระดาษจริงที่ซูม 100%) · ทุกเส้นและตัวเลขจากโมเดล · ตัวเรนเดอร์ทดสอบเท่านั้น</p>
      {rooms.map((room) => (
        <section key={room} data-room={room}>
          <h2>{room}</h2>
          {all
            .filter((e) => e.roomName === room)
            .map((e) => (
              <div className="sheet" key={e.label}>
                <h3>
                  {e.drawing.title} · มองไปทาง {compass(e.looking)} · กว้าง {fmt(e.width)} สูง {fmt(e.height)}
                </h3>
                <ElevationSvg e={e} />
              </div>
            ))}
        </section>
      ))}
    </>
  );
}

const compass = (deg: number) =>
  ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'][Math.round(deg / 45) % 8];

createRoot(document.getElementById('root')!).render(<Page />);
