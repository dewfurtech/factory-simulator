// Reads a vector PDF plan the way the importer does and prints what it found, to see what a drawing holds before
// teaching the builders to read it.
//
//   node scripts/ts-run.mjs scripts/pdfplan-dump.ts <plan.pdf>            summary per layer
//   node scripts/ts-run.mjs scripts/pdfplan-dump.ts <plan.pdf> --json     the whole VectorPlan as JSON on stdout
import { readFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: pdfplan-dump <plan.pdf> [--json]');
  process.exit(2);
}
// The legacy build runs under Node; the main build wants a DOM.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const plan = await extractVectorPlan(doc, await doc.getPage(1));
await doc.destroy();

if (flag === '--json') {
  process.stdout.write(JSON.stringify(plan));
} else {
  console.log(`page ${plan.width.toFixed(0)}×${plan.height.toFixed(0)} pt · ${plan.paths.length} paths · ${plan.texts.length} texts`);
  const per = new Map<string, { n: number; closed: number; dashed: number; colors: Set<string> }>();
  for (const p of plan.paths) {
    const e = per.get(p.layer) ?? { n: 0, closed: 0, dashed: 0, colors: new Set<string>() };
    e.n++;
    if (p.closed) e.closed++;
    if (p.dashed) e.dashed++;
    e.colors.add(p.color);
    per.set(p.layer, e);
  }
  for (const [layer, e] of [...per].sort((a, b) => b[1].n - a[1].n))
    console.log(`${String(e.n).padStart(6)}  ${layer || '(none)'}  closed ${e.closed}  dashed ${e.dashed}  ${[...e.colors].slice(0, 4).join(' ')}`);
  console.log('\ntexts:');
  for (const t of plan.texts)
    console.log(`  [${t.x.toFixed(0)},${t.y.toFixed(0)}] h${t.height.toFixed(1)} ${((t.rotation * 180) / Math.PI).toFixed(0)}° ${JSON.stringify(t.text)}`);
}
