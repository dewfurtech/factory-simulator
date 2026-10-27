// Runs the app's auto wall trace (autoTrace, the same code the "auto กำแพง" button uses) over every image in test-plans/
// and writes an overlay PNG per plan plus a summary. Tries the app's own way first (scale read off the doors); when that
// fails, falls back to a scale estimated from the dimension strings on the drawing (see SCALE_HINT).
//
//   node scripts/ts-run.mjs scripts/trace-test-plans.ts [test-plans] [test-plans/out]
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoTrace, WALL_STYLES } from '../src/model/trace/scale';
import { dist } from '../src/model/vec';

const MAX_PX = 3000; // same as traceUnderlay
/** Estimated mm per ORIGINAL image pixel, read off dimension strings on each drawing. Only used when the door search fails. */
const SCALE_HINT: Record<string, number> = {
  '01': 140,
  '02': 60,
  '04': 36,
  '05': 12.8,
  '06': 19.5,
  '07': 30.7,
  '09': 7.7,
  '10': 37.8,
  '11': 15.3,
  '12': 52,
  '13': 78,
  '14': 28.5,
  '16': 32.2,
};

const dir = process.argv[2] ?? 'test-plans';
const out = process.argv[3] ?? join(dir, 'out');
mkdirSync(out, { recursive: true });
const files = readdirSync(dir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort();
const rows: string[] = ['| file | mode | style | mm/px | doorsRead | walls | wallLen(m) | doors | windows | openings | ms |', '|---|---|---|---|---|---|---|---|---|---|---|'];

for (const f of files) {
  const img = await loadImage(join(dir, f));
  const k = Math.min(1, MAX_PX / Math.max(img.width, img.height));
  const w = Math.ceil(img.width * k),
    h = Math.ceil(img.height * k);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;

  let t0 = Date.now();
  let mode = 'auto(doors)';
  const hint = SCALE_HINT[f.slice(0, 2)];
  // STYLES=all: every style at the hint scale, each to its own overlay, to see what each reads.
  if (process.env.STYLES === 'all' && hint) {
    for (const st of WALL_STYLES) {
      const r = autoTrace({ w, h, data: gray }, hint / k, [st]);
      if (!r) continue;
      const len = (r.traced.walls.reduce((s, x) => s + dist(x.a, x.b), 0) * r.mmPerPx) / 1000;
      console.log(f, st, 'walls', r.traced.walls.length, 'len', len.toFixed(0), 'm');
      const cc = createCanvas(w, h);
      const cx = cc.getContext('2d');
      cx.drawImage(c, 0, 0);
      cx.fillStyle = 'rgba(255,255,255,0.6)';
      cx.fillRect(0, 0, w, h);
      cx.strokeStyle = '#e00000';
      for (const wl of r.traced.walls) {
        cx.lineWidth = Math.max(2, wl.thickness * 0.8);
        cx.beginPath();
        cx.moveTo(wl.a.x, wl.a.y);
        cx.lineTo(wl.b.x, wl.b.y);
        cx.stroke();
      }
      cx.fillStyle = '#000';
      cx.font = '24px sans-serif';
      cx.fillText(`${f} ${st} walls ${r.traced.walls.length} len ${len.toFixed(0)} m`, 10, 30);
      writeFileSync(join(out, f.replace(/\.\w+$/, '') + '.' + st + '.png'), cc.toBuffer('image/png'));
    }
  }
  let res = autoTrace({ w, h, data: gray }, undefined, WALL_STYLES);
  if (!res) {
    if (hint) {
      mode = 'hint-scale';
      res = autoTrace({ w, h, data: gray }, hint / k, WALL_STYLES);
    }
  }
  const ms = Date.now() - t0;
  if (!res) {
    rows.push(`| ${f} | FAILED | | | | | | | | | ${ms} |`);
    console.log(f, 'FAILED');
    continue;
  }
  const { traced, mmPerPx, style, doors } = res;
  const len = (traced.walls.reduce((s, x) => s + dist(x.a, x.b), 0) * mmPerPx) / 1000;
  const nd = traced.openings.filter((o) => o.kind === 'door').length;
  const nw = traced.openings.filter((o) => o.kind === 'window').length;
  const no = traced.openings.filter((o) => o.kind === 'opening').length;
  rows.push(`| ${f} | ${mode} | ${style} | ${mmPerPx.toFixed(1)} | ${doors} | ${traced.walls.length} | ${len.toFixed(0)} | ${nd} | ${nw} | ${no} | ${ms} |`);
  console.log(f, mode, style, 'mm/px', mmPerPx.toFixed(1), 'walls', traced.walls.length, 'len', len.toFixed(0), 'm', 'doors', nd, 'win', nw, 'open', no, ms, 'ms');

  // Overlay: faded image, walls red (outer: orange, chord: dashed), doors blue, windows green, openings magenta.
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(0, 0, w, h);
  for (const wl of traced.walls) {
    ctx.strokeStyle = wl.chord ? '#ff8800' : wl.outer ? '#dd5500' : wl.glass ? '#00aa88' : '#e00000';
    ctx.lineWidth = Math.max(2, wl.thickness * 0.8);
    ctx.setLineDash(wl.chord ? [8, 6] : []);
    ctx.beginPath();
    ctx.moveTo(wl.a.x, wl.a.y);
    ctx.lineTo(wl.b.x, wl.b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const o of traced.openings) {
    const r = Math.max(4, o.width / 2);
    ctx.strokeStyle = o.kind === 'door' ? '#0044ff' : o.kind === 'window' ? '#00a000' : '#cc00cc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.at.x, o.at.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (o.kind === 'door') {
      ctx.beginPath();
      ctx.moveTo(o.hinge.x, o.hinge.y);
      ctx.lineTo(o.swing.x, o.swing.y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#000';
  ctx.font = '24px sans-serif';
  ctx.fillText(`${f}  ${mode}  ${style}  ${mmPerPx.toFixed(1)} mm/px  walls ${traced.walls.length}  doors ${nd}`, 10, 30);
  writeFileSync(join(out, f.replace(/\.\w+$/, '.png')), c.toBuffer('image/png'));
}
writeFileSync(join(out, 'summary.md'), rows.join('\n') + '\n');
console.log('\n' + rows.join('\n'));
