// Prints the openings the structure reader finds, with widths in points, to check what the scale is read from.
import { readFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readStructure } from '../src/model/pdfplan/structure';

const [file] = process.argv.slice(2);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const s = readStructure(await extractVectorPlan(doc, await doc.getPage(1)));
await doc.destroy();
console.log('wall thickness pt', s.wallThickness.toFixed(2));
for (const o of s.openings)
  console.log(
    o.kind.padEnd(8),
    o.width.toFixed(1).padStart(6),
    o.kind === 'door' ? (o.double ? 'double' : (o as { rolling?: boolean }).rolling ? 'rolling' : 'single') : '',
    `@${o.at.x.toFixed(0)},${o.at.y.toFixed(0)}`,
  );
const box = process.argv.slice(3).map(Number);
if (box.length === 4) {
  const [x0, y0, x1, y1] = box;
  const inBox = (p: { x: number; y: number }) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  for (const w of s.walls)
    if (inBox(w.a) || inBox(w.b)) console.log(`wall (${w.a.x.toFixed(1)},${w.a.y.toFixed(1)}) → (${w.b.x.toFixed(1)},${w.b.y.toFixed(1)}) t${w.thickness.toFixed(2)}`);
}
