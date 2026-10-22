// Why a room does not form: builds the PDF import into a fresh project, walks the wall graph's faces the way
// faces.ts does, and prints the faces it would reject for passing a corner twice (a wall walked on both sides,
// which means the room it bounds is open to its neighbour there), with the corners repeated, in page points.
//
//   node scripts/ts-run.mjs scripts/pdfplan-structure-faces.ts <plan.pdf>
import { readFileSync } from 'node:fs';
import { applyPdfImport, readPdfPlan } from '../src/model/pdfplan/apply';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readScale } from '../src/model/pdfplan/scale';
import { newProject } from '../src/model/project';
import type { Id, Vec2 } from '../src/model/types';
import { angleOf, signedArea, sub } from '../src/model/vec';

const [file] = process.argv.slice(2);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const drawing = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();
const imp = readPdfPlan(drawing);
const k = readScale(drawing, imp.structure.openings)?.mmPerPt ?? 72;
const project = newProject('faces');
applyPdfImport(project, imp, (p) => ({ x: p.x * k, y: p.y * k }), k, 0);
const plan = project.plan;
const pt = (id: Id) => `${(plan.corners[id].x / k).toFixed(1)},${(plan.corners[id].y / k).toFixed(1)}`;

const adj = new Map<Id, Set<Id>>();
for (const w of Object.values(plan.walls)) {
  if (w.a === w.b) continue;
  for (const [a, b] of [
    [w.a, w.b],
    [w.b, w.a],
  ] as const)
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
}
const stack = [...adj.keys()].filter((id) => adj.get(id)!.size === 1);
while (stack.length) {
  const id = stack.pop()!;
  const ns = adj.get(id);
  if (!ns || ns.size !== 1) continue;
  const [n] = ns;
  adj.delete(id);
  const other = adj.get(n)!;
  other.delete(id);
  if (other.size === 0) adj.delete(n);
  else if (other.size === 1) stack.push(n);
}
const pos = (id: Id): Vec2 => plan.corners[id];
const sorted = new Map([...adj].map(([id, ns]) => [id, [...ns].sort((a, b) => angleOf(sub(pos(a), pos(id))) - angleOf(sub(pos(b), pos(id))))]));
const seen = new Set<string>();
for (const [u, ns] of sorted) {
  for (const v of ns) {
    if (seen.has(`${u}>${v}`)) continue;
    const cycle: Id[] = [];
    let [a, b] = [u, v];
    while (!seen.has(`${a}>${b}`)) {
      seen.add(`${a}>${b}`);
      cycle.push(a);
      const out = sorted.get(b)!;
      const next = out[(out.indexOf(a) - 1 + out.length) % out.length];
      [a, b] = [b, next];
    }
    const area = signedArea(cycle.map(pos)) / 1e6;
    const counts = new Map<Id, number>();
    for (const id of cycle) counts.set(id, (counts.get(id) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
    if (area > 0 && repeated.length) console.log(`rejected face ${area.toFixed(0)} m² · ${cycle.length} corners · repeated at ${repeated.map(pt).join('  ')}`);
    else if (area > 0) console.log(`room face ${area.toFixed(1)} m²`);
  }
}
