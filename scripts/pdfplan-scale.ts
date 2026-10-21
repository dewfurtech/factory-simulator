// Prints the column-grid pitch the scale reader finds, and the scale it settles on once the structure reader has doors.
import { readFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { gridPitch, readScale } from '../src/model/pdfplan/scale';

const [file] = process.argv.slice(2);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const plan = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();

const pitch = gridPitch(plan);
console.log('grid pitch (pt):', pitch?.toFixed(2) ?? 'none');
// Until structure.ts lands, a door width typed on the command line stands in for the doors it reads.
const doorPt = Number(process.argv[4] ?? 0);
if (doorPt) {
  const fake = [1, 2].map(() => ({ kind: 'door' as const, at: { x: 0, y: 0 }, width: doorPt, double: false, hinge: { x: 0, y: 0 }, swing: { x: 0, y: 0 } }));
  console.log('scale:', readScale(plan, fake));
}
