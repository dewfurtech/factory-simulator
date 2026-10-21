// Lists the places an import of a plan is unsure of, in page points, for a person to look at: loose wall ends, slivers
// of rooms, pieces of unknown kind, machines with no model, and rooms with no name. Writes them to .plans/spots.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyPdfImport, readPdfPlan } from '../src/model/pdfplan/apply';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readScale } from '../src/model/pdfplan/scale';
import { newProject } from '../src/model/project';
import { roomPolygon } from '../src/model/plan';
import { signedArea } from '../src/model/vec';

const [file] = process.argv.slice(2);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const drawing = await extractVectorPlan(doc, await doc.getPage(1));
const imp = readPdfPlan(drawing);
const k = readScale(drawing, imp.structure.openings)!.mmPerPt;
const p = newProject('x');
applyPdfImport(p, imp, (q) => ({ x: q.x * k, y: q.y * k }), k, 0);
const pt = (v: { x: number; y: number }) => ({ x: +(v.x / k).toFixed(1), y: +(v.y / k).toFixed(1) });
const spots: { kind: string; at: { x: number; y: number }; note: string }[] = [];

const degree = new Map<string, number>();
for (const w of Object.values(p.plan.walls)) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
for (const c of Object.values(p.plan.corners)) if (degree.get(c.id) === 1) spots.push({ kind: 'loose', at: pt(c), note: 'ปลายผนังค้าง' });
for (const r of Object.values(p.plan.rooms)) {
  const poly = roomPolygon(p.plan, r);
  const area = Math.abs(signedArea(poly)) / 1e6;
  const c = poly.reduce((s, v) => ({ x: s.x + v.x / poly.length, y: s.y + v.y / poly.length }), { x: 0, y: 0 });
  if (area < 1.5) spots.push({ kind: 'sliver', at: pt(c), note: `ห้องเล็กผิดปกติ ${area.toFixed(1)} ตร.ม.` });
  else if (/^โซน \d+$/.test(r.name)) spots.push({ kind: 'unnamed', at: pt(c), note: `ห้องไม่มีชื่อ ${area.toFixed(0)} ตร.ม.` });
}
for (const o of p.objects) {
  if (o.assetId === 'box') spots.push({ kind: o.name.startsWith('เครื่อง') ? 'machine' : 'unknown', at: pt(o), note: `${o.name} ${(o.size.w / 1000).toFixed(1)}×${(o.size.d / 1000).toFixed(1)} ม.` });
}
writeFileSync('.plans/spots.json', JSON.stringify({ mmPerPt: k, spots }, null, 1));
const count = new Map<string, number>();
for (const s of spots) count.set(s.kind, (count.get(s.kind) ?? 0) + 1);
console.log(Object.fromEntries(count));
for (const s of spots) console.log(s.kind.padEnd(8), `(${s.at.x},${s.at.y})`, s.note);
