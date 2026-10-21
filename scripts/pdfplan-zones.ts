// Reads the zones and machine footprints out of a vector PDF plan and draws them for checking by eye.
//
//   node scripts/ts-run.mjs scripts/pdfplan-zones.ts <plan.pdf | plan.json>
//
// Prints each zone (name, kind, source, vertices, area) and each footprint (label, size, rotation), and writes
// .plans/zones-preview.svg (+ .png) with the raw green/furniture paths faint, zone polygons filled, footprints outlined.
import { readFileSync, writeFileSync } from 'node:fs';
import { extractVectorPlan } from '../src/model/pdfplan/extract';
import { readMachines } from '../src/model/pdfplan/machines';
import type { VectorPlan } from '../src/model/pdfplan/types';
import { isGreenish, polygonArea, readZones } from '../src/model/pdfplan/zones';
import { Raster } from './pdfplan-zones-raster';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: pdfplan-zones <plan.pdf | plan.json>');
  process.exit(2);
}
let plan: VectorPlan;
if (file.endsWith('.json')) plan = JSON.parse(readFileSync(file, 'utf8'));
else {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  plan = await extractVectorPlan(doc, await doc.getPage(1));
  await doc.destroy();
}

const zones = readZones(plan);
const machines = readMachines(plan);
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
console.log(`zones (${zones.length}):`);
for (const z of zones) console.log(`  ${JSON.stringify(z.name).padEnd(22)} ${z.zone.padEnd(12)} ${z.source.padEnd(12)} ${String(z.polygon.length).padStart(2)} vertices  area ${Math.abs(polygonArea(z.polygon)).toFixed(0).padStart(7)} pt²  label @ ${z.label.x.toFixed(0)},${z.label.y.toFixed(0)}`);
console.log(`footprints (${machines.length}):`);
for (const m of [...machines].sort((a, b) => a.kind.localeCompare(b.kind) || b.w * b.d - a.w * a.d)) console.log(`  ${m.kind.padEnd(13)} ${JSON.stringify(m.label).padEnd(6)} ${m.w.toFixed(1).padStart(6)} × ${m.d.toFixed(1).padStart(6)} pt  rot ${deg(m.rotation).padStart(6)}°  chairs ${m.chairs}  @ ${m.at.x.toFixed(0)},${m.at.y.toFixed(0)}  ${m.layer}${m.assetId ? '  → ' + m.assetId : ''}`);
const counts = new Map<string, number>();
for (const m of machines) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
console.log('per kind: ' + [...counts].sort().map(([k, n]) => `${k} ${n}`).join(', '));

// SVG for people, PNG for the Read tool.
const furnitureLayers = plan.layers.filter((l) => /FUR|B27|MACH|EQUIP|SECFLOOR/i.test(l) || l === '0');
const d = (pts: { x: number; y: number }[], close: boolean) => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('') + (close ? 'Z' : '');
const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.width} ${plan.height}" width="${plan.width * 2}" height="${plan.height * 2}">`, '<rect width="100%" height="100%" fill="white"/>'];
const S = 2;
const png = new Raster(Math.ceil(plan.width * S), Math.ceil(plan.height * S), S);
for (const p of plan.paths) {
  const green = isGreenish(p.color);
  if (!green && !furnitureLayers.includes(p.layer)) continue;
  svg.push(`<path d="${d(p.points, p.closed)}" fill="none" stroke="${green ? '#0ead00' : '#bbb'}" stroke-width="${green ? 1.2 : 0.4}"/>`);
  png.poly(p.points, green ? [0, 173, 0] : [200, 200, 200], green ? 2 : 1, 1, p.closed);
}
const hues = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#800000', '#808000', '#000075'];
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
zones.forEach((z, i) => {
  const c = hues[i % hues.length];
  svg.push(`<path d="${d(z.polygon, true)}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"${z.source === 'label' ? ' stroke-dasharray="4 3"' : ''}/>`);
  svg.push(`<text x="${z.label.x.toFixed(1)}" y="${z.label.y.toFixed(1)}" font-size="9" fill="${c}" text-anchor="middle">${z.name} · ${z.zone} · ${z.source}</text>`);
  png.fill(z.polygon, rgb(c), 0.18);
  png.poly(z.polygon, rgb(c), 3);
  png.mark(z.label, rgb(c), 4);
});
const kindColor: Record<string, string> = { machine: '#d00', desk: '#06c', chair: '#09c', table: '#c60', meetingTable: '#60c', canteenTable: '#c06', sofa: '#0a6', cabinet: '#660', toilet: '#088', sink: '#0aa', other: '#888' };
for (const m of machines) {
  const c = Math.cos(m.rotation), s = Math.sin(m.rotation);
  const corner = (u: number, v: number) => ({ x: m.at.x + u * c - v * s, y: m.at.y + u * s + v * c });
  const pts = [corner(-m.w / 2, -m.d / 2), corner(m.w / 2, -m.d / 2), corner(m.w / 2, m.d / 2), corner(-m.w / 2, m.d / 2)];
  const col = kindColor[m.kind] ?? '#888';
  const big = m.kind === 'machine';
  svg.push(`<path d="${d(pts, true)}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="${big ? 1.5 : 0.8}"/>`);
  // A desk's front (local +y) is marked with a tick.
  if (m.kind === 'desk') svg.push(`<path d="${d([corner(0, 0), corner(0, m.d / 2 + 3)], false)}" stroke="${col}" stroke-width="0.8"/>`);
  svg.push(`<text x="${m.at.x.toFixed(1)}" y="${m.at.y.toFixed(1)}" font-size="${big ? 8 : 3}" fill="${col}" text-anchor="middle">${m.label || m.kind}${m.assetId ? ' → ' + m.assetId : ''}</text>`);
  png.poly(pts, rgb(col), big ? 3 : 2);
  if (m.kind === 'desk') png.line(corner(0, 0), corner(0, m.d / 2 + 3), rgb(col), 2);
}
svg.push('</svg>');
writeFileSync('.plans/zones-preview.svg', svg.join('\n'));
png.save('.plans/zones-preview.png');
console.log('wrote .plans/zones-preview.svg and .png');
