// Reads the structure (walls, columns, doors, windows) out of a vector PDF plan and draws it over the raw wall and
// door layers, to check the reading against the drawing.
//
//   node scripts/ts-run.mjs scripts/pdfplan-structure.ts <plan.pdf> [out.svg]
//
// Writes .plans/structure-preview.svg by default: walls grey, columns green squares, doors red, windows blue,
// doorways orange, over the faint raw A-WALL (black), hatch (blue) and A-DW (red) paths.
import { readFileSync, writeFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readStructure, structureLayers } from '../src/model/pdfplan/structure';
import type { Vec2 } from '../src/model/types';

const [file, outFile = '.plans/structure-preview.svg'] = process.argv.slice(2);
if (!file) {
  console.error('usage: pdfplan-structure <plan.pdf> [out.svg]');
  process.exit(2);
}
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const plan = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();

const t0 = Date.now();
const s = readStructure(plan);
const ms = Date.now() - t0;
const layers = structureLayers(plan);
console.log(`layers: wall ${JSON.stringify(layers.wall)} hatch ${JSON.stringify(layers.hatch)} column ${JSON.stringify(layers.column)} dw ${JSON.stringify(layers.dw)}`);
console.log(`wall thickness ${s.wallThickness.toFixed(2)} pt · ${s.walls.length} walls · ${s.columns.length} columns · ${s.openings.length} openings (${ms} ms)`);
const kinds = new Map<string, number>();
for (const op of s.openings) {
  const k = op.kind === 'door' ? (op.rolling ? 'rolling door' : op.double ? 'double door' : 'door') : op.kind;
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
console.log('openings:', [...kinds].map(([k, n]) => `${k} ${n}`).join(', '));
const lens = s.walls.map((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).sort((p, q) => q - p);
console.log(
  'wall lengths (pt):',
  lens
    .slice(0, 12)
    .map((l) => l.toFixed(0))
    .join(' '),
  '… shortest',
  lens
    .slice(-5)
    .map((l) => l.toFixed(1))
    .join(' '),
);
const angles = new Map<number, number>();
for (const w of s.walls) {
  const a = Math.round((((Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI + 180) % 180) / 5) * 5;
  angles.set(a, (angles.get(a) ?? 0) + 1);
}
console.log(
  'wall angles:',
  [...angles]
    .sort((p, q) => p[0] - q[0])
    .map(([a, n]) => `${a}°×${n}`)
    .join(' '),
);
console.log('columns:', s.columns.map((c) => `${c.shape[0]} ${c.w.toFixed(1)}×${c.d.toFixed(1)}${c.rotation ? ` @${((c.rotation * 180) / Math.PI).toFixed(0)}°` : ''}`).join(', '));
for (const op of s.openings)
  console.log(
    `  ${op.kind}${op.kind === 'door' ? (op.double ? ' double' : op.rolling ? ' rolling' : '') : ''} at ${op.at.x.toFixed(1)},${op.at.y.toFixed(1)} w ${op.width.toFixed(1)}`,
  );

const pt = (p: Vec2) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
const poly = (pts: Vec2[], closed: boolean, style: string) => `<polyline points="${pts.map(pt).join(' ')}${closed ? ' ' + pt(pts[0]) : ''}" fill="none" ${style}/>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.width} ${plan.height}" width="${plan.width * 2}" height="${plan.height * 2}"><rect width="100%" height="100%" fill="#fff"/>`;
const raw: Record<string, string> = {};
for (const l of layers.wall) raw[l] = 'stroke="#000" stroke-width="0.15"';
for (const l of layers.hatch) raw[l] = 'stroke="#99f" stroke-width="0.1"';
for (const l of layers.dw) raw[l] = 'stroke="#f66" stroke-width="0.15"';
for (const p of plan.paths) if (raw[p.layer] && p.points.length > 1) svg += poly(p.points, p.closed, raw[p.layer]);
for (const w of s.walls)
  svg += `<line x1="${w.a.x}" y1="${w.a.y}" x2="${w.b.x}" y2="${w.b.y}" stroke="${w.glass ? '#0bc' : '#555'}" stroke-opacity="0.6" stroke-width="${Math.max(w.thickness, s.wallThickness)}" stroke-linecap="butt"/>`;
// Wall ends that meet no other wall: where a room fails to close.
const near = (p: Vec2, w: (typeof s.walls)[number]) => {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const l2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / l2));
  return Math.hypot(p.x - w.a.x - k * dx, p.y - w.a.y - k * dy) <= w.thickness / 2 + s.wallThickness * 1.5;
};
let loose = 0;
for (const w of s.walls) {
  for (const p of [w.a, w.b]) {
    if (s.walls.some((o) => o !== w && near(p, o))) continue;
    loose++;
    svg += `<circle cx="${p.x}" cy="${p.y}" r="${s.wallThickness * 2.5}" fill="none" stroke="#f80" stroke-width="0.8"/>`;
    console.log(`  loose end ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
}
console.log(`loose wall ends: ${loose} · glass walls: ${s.walls.filter((w) => w.glass).length}`);
for (const c of s.columns) {
  const deg = (c.rotation * 180) / Math.PI;
  svg += `<rect x="${c.at.x - c.w / 2}" y="${c.at.y - c.d / 2}" width="${c.w}" height="${c.d}" transform="rotate(${deg} ${c.at.x} ${c.at.y})" fill="#0b0" fill-opacity="0.5" stroke="#070" stroke-width="0.2"/>`;
}
for (const op of s.openings) {
  const color = op.kind === 'door' ? '#d00' : op.kind === 'window' ? '#00c' : '#e80';
  svg += `<circle cx="${op.at.x}" cy="${op.at.y}" r="${Math.max(1.2, s.wallThickness)}" fill="${color}" fill-opacity="0.7"/>`;
  if (op.kind === 'door') {
    svg += `<line x1="${op.hinge.x}" y1="${op.hinge.y}" x2="${op.swing.x}" y2="${op.swing.y}" stroke="${color}" stroke-width="0.4" stroke-dasharray="1 0.5"/>`;
    svg += `<circle cx="${op.hinge.x}" cy="${op.hinge.y}" r="0.8" fill="none" stroke="${color}" stroke-width="0.3"/>`;
  }
  // The opening's width as a bar along its wall.
  const wall = s.walls.find(
    (w) =>
      Math.abs((w.b.x - w.a.x) * (op.at.y - w.a.y) - (w.b.y - w.a.y) * (op.at.x - w.a.x)) / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) <= s.wallThickness * 2 &&
      Math.min(Math.hypot(op.at.x - w.a.x, op.at.y - w.a.y), Math.hypot(op.at.x - w.b.x, op.at.y - w.b.y)) <= Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
  );
  if (wall) {
    const l = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    const u = { x: (wall.b.x - wall.a.x) / l, y: (wall.b.y - wall.a.y) / l };
    svg += `<line x1="${op.at.x - (u.x * op.width) / 2}" y1="${op.at.y - (u.y * op.width) / 2}" x2="${op.at.x + (u.x * op.width) / 2}" y2="${op.at.y + (u.y * op.width) / 2}" stroke="${color}" stroke-width="${s.wallThickness * 1.5}" stroke-opacity="0.7"/>`;
  }
}
svg += '</svg>';
writeFileSync(outFile, svg);
console.log(`wrote ${outFile}`);
