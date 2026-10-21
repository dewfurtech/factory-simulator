// Lists the paths lying in a box on the page (layer, form, size), to see how a stretch of a drawing is drawn.
//   node scripts/ts-run.mjs scripts/pdfplan-probe.ts <plan.pdf> x0 y0 x1 y1 [minLen]
import { readFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';

const [file, ...nums] = process.argv.slice(2);
const [x0, y0, x1, y1, minLen = 10] = nums.map(Number);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const plan = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();
const rows = new Map<string, number>();
for (const p of plan.paths) {
  let len = 0;
  for (let i = 1; i < p.points.length; i++) len += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y);
  if (len < minLen) continue;
  if (!p.points.some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1)) continue;
  const xs = p.points.map((q) => q.x);
  const ys = p.points.map((q) => q.y);
  const key = `${p.layer.padEnd(14)} pts${String(p.points.length).padStart(4)} len${len.toFixed(0).padStart(5)} bbox ${Math.min(...xs).toFixed(0)},${Math.min(...ys).toFixed(0)}–${Math.max(...xs).toFixed(0)},${Math.max(...ys).toFixed(0)} w${p.width.toFixed(2)} ${p.closed ? 'closed' : 'open'}${p.filled ? ' fill' : ''}${p.dashed ? ' dash' : ''} ${p.color}`;
  rows.set(key, (rows.get(key) ?? 0) + 1);
}
for (const [k, n] of [...rows].sort()) console.log(`${n > 1 ? `×${n} ` : ''}${k}`);
