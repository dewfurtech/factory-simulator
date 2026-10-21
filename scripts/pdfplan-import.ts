// Runs the whole vector-PDF import the way the app does on upload (read, scale, build into a fresh project) and draws
// the result in plan millimetres next to the page it came from, to compare the two.
//
//   node scripts/ts-run.mjs scripts/pdfplan-import.ts <plan.pdf> [out.svg]
import { readFileSync, writeFileSync } from 'node:fs';
import { catalogItem } from '../src/model/catalog';
import { applyPdfImport, readPdfPlan } from '../src/model/pdfplan/apply';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readScale } from '../src/model/pdfplan/scale';
import { newProject } from '../src/model/project';
import { objectObb, obbCorners } from '../src/model/objects';
import { zoneColor } from '../src/model/zones';
import { roomPolygon } from '../src/model/plan';
import { signedArea } from '../src/model/vec';

const [file, out = '.plans/import-preview.svg'] = process.argv.slice(2);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const drawing = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();

const t0 = Date.now();
const imp = readPdfPlan(drawing);
const t1 = Date.now();
const scale = readScale(drawing, imp.structure.openings);
console.log(`read in ${t1 - t0} ms · walls ${imp.structure.walls.length} · openings ${imp.structure.openings.length} · columns ${imp.structure.columns.length} · zones ${imp.zones.length} · pieces ${imp.machines.length}`);
console.log('scale', scale);
const mmPerPt = scale?.mmPerPt ?? 72;
const project = newProject('import');
const counts = applyPdfImport(project, imp, (p) => ({ x: p.x * mmPerPt, y: p.y * mmPerPt }), mmPerPt, 0);
console.log('built', counts, 'rooms', Object.keys(project.plan.rooms).length);
const kinds = new Map<string, number>();
for (const o of project.objects) kinds.set(o.assetId, (kinds.get(o.assetId) ?? 0) + 1);
console.log('objects by asset', Object.fromEntries(kinds));
for (const r of Object.values(project.plan.rooms)) console.log(`  room ${r.name} (${r.zone}) ${(Math.abs(signedArea(roomPolygon(project.plan, r))) / 1e6).toFixed(1)} m²`);
// Corners with one wall: where the outline stays open.
const degree = new Map<string, number>();
for (const w of Object.values(project.plan.walls)) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
const loose = Object.values(project.plan.corners).filter((c) => degree.get(c.id) === 1);
console.log('loose ends', loose.length, loose.map((c) => `(${(c.x / mmPerPt).toFixed(0)},${(c.y / mmPerPt).toFixed(0)})pt`).join(' '));

// The page, faint, under the build, both in plan mm.
const k = mmPerPt;
const pts = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');
const parts: string[] = [];
for (const p of drawing.paths) {
  if (/HATCH|DIMENSION|TEXT|Arrow|GRID/i.test(p.layer)) continue;
  const col = /COLUMN/i.test(p.layer);
  parts.push(`<polyline points="${pts(p.points.map((q) => ({ x: q.x * k, y: q.y * k })))}" fill="none" stroke="${col ? "#2563eb" : "#bbb"}" stroke-width="${col ? 25 : 15}"/>`);
}
// Each room its own hue, so where one room runs into another shows.
Object.values(project.plan.rooms).forEach((r, i) => {
  parts.push(`<polygon points="${pts(roomPolygon(project.plan, r))}" fill="hsl(${(i * 67) % 360} 70% 70%)" fill-opacity="0.45" stroke="none"/>`);
});
void zoneColor;
for (const w of Object.values(project.plan.walls)) {
  const a = project.plan.corners[w.a];
  const b = project.plan.corners[w.b];
  parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#334" stroke-opacity="0.8" stroke-width="${w.thickness}"/>`);
}
for (const o of Object.values(project.plan.openings)) {
  const w = project.plan.walls[o.wallId];
  const a = project.plan.corners[w.a];
  const b = project.plan.corners[w.b];
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  const f0 = (o.offset - o.width / 2) / l;
  const f1 = (o.offset + o.width / 2) / l;
  const color = o.kind === 'door' ? '#e11d48' : o.kind === 'window' ? '#2563eb' : '#16a34a';
  parts.push(`<line x1="${a.x + (b.x - a.x) * f0}" y1="${a.y + (b.y - a.y) * f0}" x2="${a.x + (b.x - a.x) * f1}" y2="${a.y + (b.y - a.y) * f1}" stroke="${color}" stroke-width="${w.thickness + 120}"/>`);
}
for (const c of loose) parts.push(`<circle cx="${c.x}" cy="${c.y}" r="500" fill="none" stroke="#f00" stroke-width="120"/>`);
for (const c of Object.values(project.columns)) parts.push(`<rect x="${c.x - c.w / 2}" y="${c.y - c.d / 2}" width="${c.w}" height="${c.d}" fill="#e11d48" fill-opacity="0.7"/>`);
for (const o of project.objects) {
  const machine = catalogItem(o.assetId)?.use === 'machine' || o.assetId === 'box';
  const color = o.assetId === 'floor-mark' ? '#ca8a04' : machine ? '#ea580c' : '#7c3aed';
  parts.push(`<polygon points="${pts(obbCorners(objectObb(o)))}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="40"/>`);
  if (o.assetId === 'floor-mark' || machine) parts.push(`<text x="${o.x}" y="${o.y}" font-size="600" text-anchor="middle" fill="${color}">${o.name}</text>`);
}
for (const r of Object.values(project.plan.rooms)) {
  const poly = roomPolygon(project.plan, r);
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  parts.push(`<text x="${c.x}" y="${c.y}" font-size="700" text-anchor="middle" fill="#111">${r.name}</text>`);
}
const xs = Object.values(project.plan.corners).map((c) => c.x);
const ys = Object.values(project.plan.corners).map((c) => c.y);
// CROP="x0,y0,x1,y1" (page points) draws only that part of the page, to look closely.
const crop = process.env.CROP?.split(',').map((v) => Number(v) * k);
const [x0, y0, x1, y1] = crop ?? (xs.length ? [Math.min(...xs) - 3000, Math.min(...ys) - 3000, Math.max(...xs) + 3000, Math.max(...ys) + 3000] : [0, 0, drawing.width * k, drawing.height * k]);
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="1400" height="${Math.round((1400 * (y1 - y0)) / (x1 - x0))}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff"/>${parts.join('')}</svg>`);
console.log('wrote', out);
