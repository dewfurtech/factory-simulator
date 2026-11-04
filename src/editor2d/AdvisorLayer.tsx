import { deliveryFor } from '../model/delivery';
import { obbCorners } from '../model/objects';
import { routeOf } from '../model/route';
import { stagingFor } from '../model/staging';
import { PIPE_MATERIAL } from '../model/utilities';
import { RUN_COLOR } from '../model/utilityRuns';
import { allRouted } from '../model/runRoute';
import { runSegments, type RunSegment } from '../model/utilityCalc';
import type { Project, UtilityKind, Vec2 } from '../model/types';
import { useMemo } from 'react';
import { useUi } from '../store/ui';
import { flowOf } from '../model/utilityFlow';

/** Gap between the dashes running along a pipe or cable, and how fast they go, in screen px. */
const FLOW_GAP = 16;
const FLOW_SPEED: Record<'air' | 'power', number> = { air: 30, power: 55 };

/** Light dashes running along the runs from the compressor and the main board out to the machines. */
function FlowDashes({ project, px }: { project: Project; px: number }) {
  const flows = useMemo(() => (['air', 'power'] as const).map((kind) => ({ kind, flow: flowOf(project, kind) })), [project]);
  const gap = FLOW_GAP * px;
  return (
    <g data-testid="run-flow-2d">
      {flows.map(({ kind, flow }) =>
        flow.edges.map((e, i) => {
          // In step with the stretch before it, so the dashes run on unbroken round a corner.
          const o = e.from % gap;
          return (
            <line key={`${kind}${i}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="#fff" strokeOpacity={0.95} strokeWidth={1.6 * px} strokeLinecap="round" strokeDasharray={`${4 * px} ${gap - 4 * px}`}>
              <animate attributeName="stroke-dashoffset" from={o} to={o - gap} dur={`${FLOW_GAP / FLOW_SPEED[kind]}s`} repeatCount="indefinite" />
            </line>
          );
        }),
      )}
    </g>
  );
}

/**
 * What the page open is about, drawn on the plan: the work's route with its order, trouble spots and the waiting spots
 * at each machine, or a machine's way in from the yard.
 */

export const ROUTE_COLOR = '#7c3aed';
const DELIVERY_COLOR = '#0891b2';
const pts = (p: readonly Vec2[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

/** What a stretch carries, short enough to sit along it. */
export function segmentTag(kind: UtilityKind, g: RunSegment): string {
  if (!g.serves.length) return kind === 'dust' ? `${g.metres.toFixed(1)} ม.` : 'ยังไม่ต่อ';
  if (kind === 'power') return `${g.amps.toFixed(0)} A · ${g.serves.length} วงจร`;
  return `${Math.round(g.lpm)} L/นาที · ${g.speed.toFixed(1)} ม./วิ`;
}

/**
 * The cable and pipe runs, as hung: round the columns they would pass through. The one picked is drawn bold with its
 * points to drag, and what each of its stretches carries written along it.
 */
export function RunLayer({ project, px }: { project: Project; px: number }) {
  const sel = useUi((s) => (s.selection?.kind === 'run' ? s.selection : null));
  const routed = useMemo(() => allRouted(project), [project]);
  const segs = useMemo(() => (sel ? runSegments(project, sel.id) : null), [project, sel?.id]);
  const picked = sel ? project.runs?.find((r) => r.id === sel.id) : undefined;
  const flowOn = useUi((s) => s.flowOn);
  const color = (kind: UtilityKind) => (kind === 'air' ? PIPE_MATERIAL[project.airPipe ?? 'aluminium'].color : RUN_COLOR[kind]);
  return (
    <g pointerEvents="none" data-testid="run-layer">
      {routed.map((r) => {
        const on = r.id === sel?.id;
        return (
          <g key={r.id}>
            {on && <polyline points={pts(r.points)} fill="none" stroke={color(r.kind)} strokeOpacity={0.18} strokeWidth={14 * px} strokeLinejoin="round" strokeLinecap="round" />}
            <polyline
              points={pts(r.points)}
              fill="none"
              stroke={color(r.kind)}
              strokeWidth={(on ? 4 : 3) * px}
              strokeDasharray={r.kind === 'power' ? undefined : `${9 * px} ${4 * px}`}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {flowOn && <FlowDashes project={project} px={px} />}
      {picked && (
        <g data-testid="run-picked">
          {segs?.map((g) => {
            const a = picked.points[g.seg];
            const b = picked.points[g.seg + 1];
            const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            const up = angle > 90 || angle < -90 ? angle + 180 : angle;
            const on = sel?.seg === g.seg;
            return (
              <text
                key={g.seg}
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2}
                dy={-9 * px}
                transform={`rotate(${up} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}
                textAnchor="middle"
                fontSize={(on ? 13 : 11.5) * px}
                fontWeight={on ? 700 : 600}
                fill={color(picked.kind)}
                stroke="var(--canvas)"
                strokeWidth={3 * px}
                paintOrder="stroke"
                data-testid="run-tag"
              >
                {segmentTag(picked.kind, g)}
              </text>
            );
          })}
          {picked.points.map((q, i) => (
            <circle
              key={i}
              cx={q.x}
              cy={q.y}
              r={(sel?.node === i ? 7 : 5.5) * px}
              fill={sel?.node === i ? color(picked.kind) : '#fff'}
              stroke={color(picked.kind)}
              strokeWidth={2 * px}
              data-testid="run-node"
            />
          ))}
        </g>
      )}
    </g>
  );
}

export function AdvisorLayer({ project, px }: { project: Project; px: number }) {
  const flow = useUi((s) => s.dock === 'systems' && s.systemTab === 'route');
  const delivery = useUi((s) => s.dock === 'summary' && s.summaryTab === 'delivery');
  const focus = useUi((s) => s.deliveryFocus);
  const picking = useUi((s) => s.tool.kind === 'pickRoute');
  if (picking) return <RouteMarks project={project} px={px} />;
  if (delivery) return <DeliveryMarks project={project} px={px} focus={focus} />;
  if (!flow) return null;
  return (
    <>
      <StagingMarks project={project} px={px} />
      <RouteMarks project={project} px={px} />
    </>
  );
}

function Arrowhead({ from, to, px, color }: { from: Vec2; to: Vec2; px: number; color: string }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  const u = { x: dx / l, y: dy / l };
  const s = 9 * px;
  const back = { x: to.x - u.x * s * 1.6, y: to.y - u.y * s * 1.6 };
  return <polygon points={pts([to, { x: back.x - u.y * s, y: back.y + u.x * s }, { x: back.x + u.y * s, y: back.y - u.x * s }])} fill={color} />;
}

function RouteMarks({ project, px }: { project: Project; px: number }) {
  const route = routeOf(project);
  if (!route.ids.length) return null;
  const byId = new Map(project.objects.map((o) => [o.id, o]));
  const bad = new Set(route.warnings.flatMap((w) => w.legs));
  return (
    <g pointerEvents="none" data-testid="route-layer">
      {route.legs.map((l, i) => {
        const color = bad.has(i) ? 'var(--danger)' : ROUTE_COLOR;
        const n = l.points.length;
        return (
          <g key={i}>
            <polyline points={pts(l.points)} fill="none" stroke="var(--canvas)" strokeWidth={7 * px} strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
            <polyline
              points={pts(l.points)}
              fill="none"
              stroke={color}
              strokeWidth={3.5 * px}
              strokeDasharray={l.reached ? undefined : `${8 * px} ${6 * px}`}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Arrowhead from={l.points[n - 2]} to={l.points[n - 1]} px={px} color={color} />
          </g>
        );
      })}
      {route.ids.map((id, i) => {
        const o = byId.get(id);
        if (!o) return null;
        return (
          <g key={id}>
            <circle cx={o.x} cy={o.y} r={13 * px} fill={ROUTE_COLOR} stroke="#fff" strokeWidth={2 * px} />
            <text x={o.x} y={o.y} dy="0.35em" textAnchor="middle" fontSize={14 * px} fontWeight={700} fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}
      {route.warnings.map((w, i) => (
        <g key={i} data-testid="route-warning-mark">
          <circle cx={w.at.x} cy={w.at.y} r={11 * px} fill="var(--danger)" stroke="#fff" strokeWidth={2 * px} />
          <text x={w.at.x} y={w.at.y} dy="0.35em" textAnchor="middle" fontSize={14 * px} fontWeight={800} fill="#fff">
            !
          </text>
        </g>
      ))}
    </g>
  );
}

function StagingMarks({ project, px }: { project: Project; px: number }) {
  return (
    <g pointerEvents="none" data-testid="staging-layer">
      {stagingFor(project).map((s, i) => {
        const color = s.blockedBy ? 'var(--danger)' : 'var(--ok)';
        return <polygon key={i} points={pts(obbCorners(s.box))} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} />;
      })}
    </g>
  );
}

function DeliveryMarks({ project, px, focus }: { project: Project; px: number; focus: string | null }) {
  const list = deliveryFor(project);
  const shown = list.filter((d) => d.path && (focus ? d.id === focus : true));
  return (
    <g pointerEvents="none" data-testid="delivery-layer">
      {shown.map((d) => {
        const p = d.path!;
        const on = d.id === focus;
        return (
          <g key={d.id} opacity={on || !focus ? 1 : 0.3}>
            {/* The crate's width along the way, faint, with its centre line over it. */}
            <polyline points={pts(p)} fill="none" stroke={DELIVERY_COLOR} strokeOpacity={on ? 0.18 : 0.08} strokeWidth={d.crate.w} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={pts(p)} fill="none" stroke={DELIVERY_COLOR} strokeWidth={(on ? 3 : 1.5) * px} strokeDasharray={`${10 * px} ${6 * px}`} strokeLinejoin="round" />
            {p.length > 1 && <Arrowhead from={p[p.length - 2]} to={p[p.length - 1]} px={px} color={DELIVERY_COLOR} />}
          </g>
        );
      })}
      {list
        .filter((d) => d.status !== 'ok' && d.status !== 'noplan')
        .map((d) => {
          const o = project.objects.find((x) => x.id === d.id);
          if (!o) return null;
          return (
            <g key={d.id}>
              <circle cx={o.x} cy={o.y} r={12 * px} fill="var(--danger)" stroke="#fff" strokeWidth={2 * px} />
              <text x={o.x} y={o.y} dy="0.35em" textAnchor="middle" fontSize={13 * px} fontWeight={800} fill="#fff">
                ✕
              </text>
            </g>
          );
        })}
    </g>
  );
}
