import type { PDFFont, PDFPage } from 'pdf-lib';
import type { PrepSection } from './prepSheet';
import { loadFonts } from './quotePdf';
import type { Project } from './types';

/** The site preparation sheet as an A4 PDF: the plan first when there is a picture of it, then one block per trade. */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 44;
const WIDTH = A4.w - MARGIN * 2;
const ORANGE = { r: 1, g: 0.435, b: 0 };
const INK = { r: 0.1, g: 0.125, b: 0.17 };
const MUTED = { r: 0.44, g: 0.5, b: 0.59 };
const LINE = { r: 0.87, g: 0.89, b: 0.92 };
const WARN = { r: 0.8, g: 0.18, b: 0.15 };

export const prepNote = 'ตัวเลขเป็นค่าประมาณจากผังนี้ ต้องให้วิศวกรตรวจกับหน้างานจริงก่อนติดตั้ง';

export async function prepPdf(p: Project, sections: PrepSection[], planPng: Uint8Array | null, when = new Date()): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, { default: fontkit }, fonts] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), loadFonts()]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`เตรียมหน้างาน – ${p.name}`);
  doc.setCreator('Factory Simulator');
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const color = (c: typeof INK) => rgb(c.r, c.g, c.b);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const room = (h: number) => {
    if (y - h >= MARGIN) return;
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - MARGIN;
  };
  const text = (s: string, x: number, size: number, opts: { font?: PDFFont; color?: typeof INK } = {}) =>
    page.drawText(s, { x, y, size, font: opts.font ?? regular, color: color(opts.color ?? INK) });
  /** Cuts a value that would run past the width, so one long name cannot push a column off the page. */
  const fit = (s: string, width: number, size: number, font = regular) => {
    if (font.widthOfTextAtSize(s, size) <= width) return s;
    let cut = s;
    while (cut && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
    return `${cut}…`;
  };

  text('เตรียมหน้างาน', MARGIN, 22, { font: bold });
  const date = when.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const client = [p.client?.company, p.client?.contact].filter(Boolean).join(' · ');
  y -= 16;
  text([p.name, client, date].filter(Boolean).join(' · '), MARGIN, 10, { color: MUTED });
  y -= 18;

  if (planPng) {
    const img = await doc.embedPng(planPng);
    const scale = Math.min(WIDTH / img.width, 300 / img.height);
    const h = img.height * scale;
    page.drawImage(img, { x: MARGIN + (WIDTH - img.width * scale) / 2, y: y - h, width: img.width * scale, height: h });
    y -= h + 18;
  }

  for (const s of sections) {
    room(60);
    text(s.title, MARGIN, 14, { font: bold, color: ORANGE });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.8, color: color(LINE) });
    y -= 14;
    for (const r of s.rows) {
      room(14);
      text(fit(r.label, 118, 10), MARGIN, 10, { color: MUTED });
      text(fit(r.value, WIDTH - 124, 10, bold), MARGIN + 124, 10, { font: bold, color: r.warn ? WARN : INK });
      y -= 14;
    }
    y -= 2;
    for (const job of s.todo) {
      room(14);
      page.drawRectangle({ x: MARGIN, y: y - 1, width: 8, height: 8, borderColor: color(MUTED), borderWidth: 0.7 });
      text(fit(job, WIDTH - 16, 10), MARGIN + 14, 10);
      y -= 14;
    }
    if (s.table) {
      y -= 4;
      const { head, rows } = s.table;
      const rest = 62;
      const first = WIDTH - rest * (head.length - 1);
      const xOf = (i: number) => (i === 0 ? MARGIN : MARGIN + first + rest * (i - 1));
      room(14 * Math.min(rows.length + 1, 4));
      head.forEach((h, i) => text(h, xOf(i), 9, { font: bold, color: MUTED }));
      y -= 13;
      for (const row of rows) {
        room(13);
        row.forEach((c, i) => text(fit(c, (i === 0 ? first : rest) - 6, 9), xOf(i), 9));
        y -= 13;
      }
    }
    y -= 14;
  }
  room(16);
  text(prepNote, MARGIN, 9, { color: MUTED });
  return doc.save();
}
