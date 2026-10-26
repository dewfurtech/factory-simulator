import type { BuiltSheet, CoverSheet, TitleInfo, ViewsSheet } from '../sheets';
import type { LineStyle, Prim, Pt } from '../types';
import { DASH, dimParts, PEN, POCHE, scaleLabel, textWidth, UNIT_TH, type LengthUnit } from './geometry';
import { DRAW_AREA, MARGIN, SHEET_H, SHEET_W, TITLE_W, toPaper, type PlacedView } from './layout';

/**
 * One A3 landscape sheet as SVG in paper mm: the frame, the title block down the right, and either the cover or
 * the placed views with their titles. Pens and dashes follow LineWeight and LineStyle; text is in the app's font.
 */

const FONT = "'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, sans-serif";
const INK = '#000';

const dash = (style?: LineStyle) => (style && DASH[style] ? DASH[style]!.join(' ') : undefined);
const pts = (ps: Pt[]) => ps.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
const round = (v: number) => Math.round(v * 1000) / 1000;

function PrimSvg({ p, view, scale, unit }: { p: Prim; view: PlacedView; scale: number; unit: LengthUnit }) {
  const P = (q: Pt) => toPaper(view, scale, q);
  switch (p.kind) {
    case 'line': {
      const [a, b] = [P(p.a), P(p.b)];
      return <line x1={round(a.x)} y1={round(a.y)} x2={round(b.x)} y2={round(b.y)} stroke={INK} strokeWidth={PEN[p.weight]} strokeDasharray={dash(p.style)} />;
    }
    case 'poly': {
      const fill = p.fill === 'poche' ? POCHE : !p.fill || p.fill === 'none' ? 'none' : p.fill;
      const common = { points: pts(p.pts.map(P)), fill, stroke: INK, strokeWidth: PEN[p.weight], strokeDasharray: dash(p.style), strokeLinejoin: 'round' as const };
      return p.closed ? <polygon {...common} /> : <polyline {...common} fill={fill === 'none' ? 'none' : fill} />;
    }
    case 'arc': {
      const c = P(p.c);
      const r = p.r / scale;
      let sweep = p.a1 - p.a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      if (sweep >= Math.PI * 2 - 1e-9)
        return <circle cx={round(c.x)} cy={round(c.y)} r={round(r)} fill="none" stroke={INK} strokeWidth={PEN[p.weight]} strokeDasharray={dash(p.style)} />;
      const a = P({ x: p.c.x + p.r * Math.cos(p.a0), y: p.c.y + p.r * Math.sin(p.a0) });
      const b = P({ x: p.c.x + p.r * Math.cos(p.a0 + sweep), y: p.c.y + p.r * Math.sin(p.a0 + sweep) });
      // Counter-clockwise in the model stays counter-clockwise on paper: SVG sweep flag 0 once y points down.
      const d = `M ${round(a.x)} ${round(a.y)} A ${round(r)} ${round(r)} 0 ${sweep > Math.PI ? 1 : 0} 0 ${round(b.x)} ${round(b.y)}`;
      return <path d={d} fill="none" stroke={INK} strokeWidth={PEN[p.weight]} strokeDasharray={dash(p.style)} />;
    }
    case 'text':
      return <Words at={P(p.at)} text={p.text} size={p.size} anchor={p.anchor} rotate={p.rotate} />;
    case 'dim': {
      const parts = dimParts(p, scale, unit);
      return (
        <g data-dim={parts.text.text}>
          {parts.lines.map(([a, b], i) => {
            const [pa, pb] = [P(a), P(b)];
            return <line key={i} x1={round(pa.x)} y1={round(pa.y)} x2={round(pb.x)} y2={round(pb.y)} stroke={INK} strokeWidth={PEN.thin} />;
          })}
          {parts.ticks.map(([a, b], i) => {
            const [pa, pb] = [P(a), P(b)];
            return <line key={`t${i}`} x1={round(pa.x)} y1={round(pa.y)} x2={round(pb.x)} y2={round(pb.y)} stroke={INK} strokeWidth={PEN.thick} />;
          })}
          <Words at={P(parts.text.at)} text={parts.text.text} size={parts.text.size} anchor="middle" rotate={parts.text.rotate} />
        </g>
      );
    }
  }
}

/** Text on paper at its baseline; `rotate` is radians counter-clockwise, as in the drawing. */
function Words({ at, text, size, anchor, rotate, weight }: { at: Pt; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number; weight?: number }) {
  const deg = rotate ? (-rotate * 180) / Math.PI : 0;
  return (
    <text
      x={round(at.x)}
      y={round(at.y)}
      fontSize={size}
      fontFamily={FONT}
      fontWeight={weight}
      textAnchor={anchor ?? 'start'}
      fill={INK}
      transform={deg ? `rotate(${round(deg)} ${round(at.x)} ${round(at.y)})` : undefined}
    >
      {text}
    </text>
  );
}

/** Splits text into lines that fit a width at a size: at spaces where it can, anywhere when a word is too long. */
export function wrap(text: string, width: number, size: number, maxLines = 3): string[] {
  const max = Math.max(1, Math.floor(width / (size * 0.6)));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/(\s+)/)) {
    if (textWidth(line + word, size) <= width) {
      line += word;
      continue;
    }
    if (line.trim()) lines.push(line.trim());
    line = word.trimStart();
    while (line.length > max) {
      lines.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > maxLines)
    return [
      ...lines.slice(0, maxLines - 1),
      lines
        .slice(maxLines - 1)
        .join(' ')
        .slice(0, max - 1) + '…',
    ];
  return lines;
}

const TB_X = SHEET_W - MARGIN - TITLE_W;
const TB_Y = MARGIN;
const TB_H = SHEET_H - 2 * MARGIN;
const PAD = 2;

/** A title block box: its label (Thai / English) at the top, its value below. */
function Field({
  y,
  h,
  label,
  value,
  size = 3,
  bold,
  x = TB_X,
  w = TITLE_W,
  lines = 2,
}: {
  y: number;
  h: number;
  label: string;
  value: string;
  size?: number;
  bold?: boolean;
  x?: number;
  w?: number;
  lines?: number;
}) {
  const rows = value ? wrap(value, w - 2 * PAD, size, lines) : [];
  return (
    <g>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={INK} strokeWidth={PEN.medium} />
      <Words at={{ x: x + PAD, y: y + 3.4 }} text={label} size={1.9} />
      {rows.map((r, i) => (
        <Words key={i} at={{ x: x + PAD, y: y + 4.6 + size * 1.25 * (i + 1) }} text={r} size={size} weight={bold ? 700 : undefined} />
      ))}
    </g>
  );
}

function TitleBlock({ sheet, info, page, pages }: { sheet: BuiltSheet; info: TitleInfo; page: number; pages: number }) {
  const [en, th] = splitTitle(sheet.title);
  const rev = { y: TB_Y + 94, h: 50 };
  const revRows = 5;
  const revRow = (rev.h - 9) / revRows;
  const cols = [TB_X, TB_X + 11, TB_X + 34, TB_X + TITLE_W];
  return (
    <g data-testid="title-block">
      <rect x={TB_X} y={TB_Y} width={TITLE_W} height={TB_H} fill="none" stroke={INK} strokeWidth={PEN.thick} />
      <Field y={TB_Y} h={26} label="โครงการ / PROJECT" value={info.project} size={3.6} bold lines={3} />
      <Field y={TB_Y + 26} h={14} label="ที่ตั้ง / LOCATION" value={info.location} />
      <Field y={TB_Y + 40} h={18} label="เจ้าของ / ลูกค้า / CLIENT" value={info.client} />
      <Field y={TB_Y + 58} h={18} label="ผู้ออกแบบ / DESIGNED BY" value={info.designer} />
      <Field y={TB_Y + 76} h={18} label="ผู้ตรวจ / CHECKED BY" value={info.checker} />
      {/* Revisions: REV 00 is the draft this app prints; the rest stay for the designer to fill in. */}
      <g>
        <Words at={{ x: TB_X + PAD, y: rev.y + 3.4 }} text="ตารางแก้ไข / REVISIONS" size={1.9} />
        {[0, 1].map((k) => (
          <line key={k} x1={cols[k + 1]} y1={rev.y + 5} x2={cols[k + 1]} y2={rev.y + rev.h} stroke={INK} strokeWidth={PEN.thin} />
        ))}
        {Array.from({ length: revRows + 1 }, (_, i) => (
          <line key={i} x1={TB_X} y1={rev.y + 9 + i * revRow} x2={TB_X + TITLE_W} y2={rev.y + 9 + i * revRow} stroke={INK} strokeWidth={PEN.thin} />
        ))}
        <line x1={TB_X} y1={rev.y + 5} x2={TB_X + TITLE_W} y2={rev.y + 5} stroke={INK} strokeWidth={PEN.thin} />
        {['REV', 'วันที่ / DATE', 'รายการ / DESCRIPTION'].map((t, i) => (
          <Words key={t} at={{ x: cols[i] + 1.2, y: rev.y + 8 }} text={t} size={1.7} />
        ))}
        <Words at={{ x: cols[0] + 1.2, y: rev.y + 9 + revRow - 1.6 }} text="00" size={2.4} />
        <Words at={{ x: cols[1] + 1.2, y: rev.y + 9 + revRow - 1.6 }} text={info.date} size={1.9} />
        <Words at={{ x: cols[2] + 1.2, y: rev.y + 9 + revRow - 1.6 }} text="DRAFT" size={2.4} />
        <line x1={TB_X} y1={rev.y + rev.h} x2={TB_X + TITLE_W} y2={rev.y + rev.h} stroke={INK} strokeWidth={PEN.medium} />
      </g>
      <Field y={TB_Y + 144} h={22} label="หมายเหตุ / NOTES" value={`หน่วย ${UNIT_TH[info.unit]} · ตรวจระยะหน้างาน`} size={2.6} />
      <g>
        <line x1={TB_X} y1={TB_Y + 196} x2={TB_X + TITLE_W} y2={TB_Y + 196} stroke={INK} strokeWidth={PEN.medium} />
        <Words at={{ x: TB_X + PAD, y: TB_Y + 169.4 }} text="ชื่อแผ่น / SHEET TITLE" size={1.9} />
        <Words at={{ x: TB_X + PAD, y: TB_Y + 179 }} text={en} size={4} weight={700} />
        {th && <Words at={{ x: TB_X + PAD, y: TB_Y + 187 }} text={th} size={3.6} />}
      </g>
      <Field y={TB_Y + 196} h={16} label="มาตราส่วน / SCALE" value={sheet.scale ? `${scaleLabel(sheet.scale)} (A3)` : ''} w={TITLE_W / 2} />
      <Field y={TB_Y + 196} h={16} label="วันที่ / DATE" value={info.date} x={TB_X + TITLE_W / 2} w={TITLE_W / 2} size={2.4} />
      <line x1={TB_X + TITLE_W / 2} y1={TB_Y + 196} x2={TB_X + TITLE_W / 2} y2={TB_Y + 212} stroke={INK} strokeWidth={PEN.thin} />
      <g>
        <Words at={{ x: TB_X + PAD, y: TB_Y + 215.4 }} text="เลขแผ่น / SHEET NO." size={1.9} />
        <Words at={{ x: TB_X + TITLE_W / 2, y: TB_Y + 240 }} text={sheet.id} size={9} weight={700} anchor="middle" />
        <Words at={{ x: TB_X + TITLE_W / 2, y: TB_Y + 252 }} text={`แผ่นที่ ${page} / ${pages}`} size={2.6} anchor="middle" />
      </g>
    </g>
  );
}

function Views({ sheet, unit }: { sheet: ViewsSheet; unit: LengthUnit }) {
  return (
    <g>
      {sheet.views.map((v, i) => {
        const [en, th] = splitTitle(v.drawing.title);
        const head = th ? `${en} / ${th}` : en;
        const w = textWidth(head, 4) * 0.92;
        return (
          <g key={i} data-testid="sheet-view">
            {v.drawing.prims.map((p, j) => (
              <PrimSvg key={j} p={p} view={v} scale={sheet.scale} unit={unit} />
            ))}
            <Words at={v.label} text={head} size={4} weight={700} anchor="middle" />
            <line x1={v.label.x - w / 2} y1={v.label.y + 1.4} x2={v.label.x + w / 2} y2={v.label.y + 1.4} stroke={INK} strokeWidth={PEN.thick} />
            <Words at={{ x: v.label.x, y: v.label.y + 5.6 }} text={`SCALE ${scaleLabel(sheet.scale)}`} size={2.6} anchor="middle" />
          </g>
        );
      })}
    </g>
  );
}

function Cover({ sheet, info }: { sheet: CoverSheet; info: TitleInfo }) {
  const x = DRAW_AREA.x + 10;
  const w = DRAW_AREA.w - 20;
  const title = wrap(info.project, w, 11, 2);
  const tableY = 150;
  const row = 8;
  const cols = [x, x + 40, x + w - 34, x + w];
  return (
    <g data-testid="cover">
      {title.map((t, i) => (
        <Words key={i} at={{ x, y: 52 + i * 14 }} text={t} size={11} weight={700} />
      ))}
      <Words at={{ x, y: 52 + title.length * 14 + 2 }} text="CONSTRUCTION DRAWINGS / แบบก่อสร้างงานตกแต่งภายใน" size={5} />
      {info.client && <Words at={{ x, y: 52 + title.length * 14 + 14 }} text={info.client} size={4.2} />}
      <Words at={{ x, y: 52 + title.length * 14 + (info.client ? 23 : 14) }} text={info.date} size={3.6} />

      <Words at={{ x, y: tableY - 4 }} text="สารบัญแบบ / DRAWING INDEX" size={4} weight={700} />
      <line x1={x} y1={tableY} x2={x + w} y2={tableY} stroke={INK} strokeWidth={PEN.thick} />
      {['เลขแผ่น / SHEET NO.', 'ชื่อแผ่น / TITLE', 'มาตราส่วน / SCALE'].map((t, i) => (
        <Words key={t} at={{ x: cols[i] + 1.5, y: tableY + 5.5 }} text={t} size={2.6} />
      ))}
      <line x1={x} y1={tableY + row} x2={x + w} y2={tableY + row} stroke={INK} strokeWidth={PEN.medium} />
      {sheet.index.map((s, i) => {
        const y = tableY + row * (i + 1);
        return (
          <g key={s.id} data-testid="cover-index-row">
            <Words at={{ x: cols[0] + 1.5, y: y + 5.6 }} text={s.id} size={3.2} weight={700} />
            <Words at={{ x: cols[1] + 1.5, y: y + 5.6 }} text={s.title} size={3.2} />
            <Words at={{ x: cols[2] + 1.5, y: y + 5.6 }} text={s.scale ? scaleLabel(s.scale) : '–'} size={3.2} />
            <line x1={x} y1={y + row} x2={x + w} y2={y + row} stroke={INK} strokeWidth={PEN.thin} />
          </g>
        );
      })}
    </g>
  );
}

/** The whole sheet; `className` lets the screen and print copies be styled apart. */
export function SheetSvg({ sheet, info, page, pages, className }: { sheet: BuiltSheet; info: TitleInfo; page: number; pages: number; className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      width={`${SHEET_W}mm`}
      height={`${SHEET_H}mm`}
      data-sheet={sheet.id}
      strokeLinecap="butt"
    >
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#fff" />
      <rect x={MARGIN} y={MARGIN} width={SHEET_W - 2 * MARGIN} height={SHEET_H - 2 * MARGIN} fill="none" stroke={INK} strokeWidth={PEN.cut} />
      {sheet.kind === 'cover' ? <Cover sheet={sheet} info={info} /> : <Views sheet={sheet} unit={info.unit} />}
      <TitleBlock sheet={sheet} info={info} page={page} pages={pages} />
    </svg>
  );
}

/** A bilingual title `ENGLISH / ไทย` split at its first separator only, so a room named `นั่งเล่น / ครัว` keeps its whole name. */
export function splitTitle(title: string): [string, string | undefined] {
  const i = title.indexOf(' / ');
  return i < 0 ? [title, undefined] : [title.slice(0, i), title.slice(i + 3)];
}
