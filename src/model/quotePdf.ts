import type { PDFFont, PDFPage } from 'pdf-lib';
import { fmtBaht, quoteOf, type Quote } from './quote';
import type { Project } from './types';

/**
 * The quotation as an A4 PDF file, drawn with pdf-lib and the app's own Thai font (IBM Plex Sans Thai, in
 * public/fonts) so it reads the same as the screen. The library and fonts load the first time a file is made.
 */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const ORANGE = { r: 0.918, g: 0.345, b: 0.047 };
const INK = { r: 0.07, g: 0.09, b: 0.15 };
const MUTED = { r: 0.4, g: 0.44, b: 0.52 };
const LINE = { r: 0.87, g: 0.89, b: 0.92 };

// Column x positions from the left margin, and the right edge of each numeric column.
const COLS = { no: 0, item: 28, qty: 330, unit: 410, amount: 500 };

let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;
const loadFonts = () =>
  (fontsPromise ??= Promise.all(
    ['IBMPlexSansThai-Regular.ttf', 'IBMPlexSansThai-Bold.ttf'].map((f) =>
      fetch(`${import.meta.env.BASE_URL}fonts/${f}`).then((r) => {
        if (!r.ok) throw new Error(`โหลดฟอนต์ ${f} ไม่ได้ (${r.status})`);
        return r.arrayBuffer();
      }),
    ),
  ).then(([regular, bold]) => ({ regular, bold })));

export async function quotationPdf(p: Project, q: Quote = quoteOf(p), when = new Date()): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, { default: fontkit }, fonts] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), loadFonts()]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`ใบเสนอราคา – ${p.name}`);
  doc.setCreator('Factory Simulator');
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const color = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = 0;
  const text = (s: string, x: number, size: number, opts: { font?: PDFFont; color?: typeof INK; right?: boolean } = {}) => {
    const font = opts.font ?? regular;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: opts.right ? x - w : x, y, size, font, color: color(opts.color ?? INK) });
    return w;
  };
  const rule = (yy: number, c = LINE, thick = 0.6) => page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: A4.w - MARGIN, y: yy }, thickness: thick, color: color(c) });
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
  };

  // Page 1: the title block, then the table.
  y = A4.h - MARGIN - 20;
  text('ใบเสนอราคา', MARGIN, 24, { font: bold });
  y -= 16;
  text('Quotation', MARGIN, 11, { color: MUTED });
  const date = when.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const client = p.client ?? {};
  const who = [client.company, client.contact, client.phone].filter(Boolean) as string[];
  y = A4.h - MARGIN - 20;
  text(p.name, A4.w - MARGIN, 13, { font: bold, right: true });
  if (who.length) {
    y -= 16;
    text(who.join(' · '), A4.w - MARGIN, 10, { right: true });
  }
  y -= 16;
  text(`วันที่ ${date}`, A4.w - MARGIN, 10, { color: MUTED, right: true });
  y -= 36;
  // The column headings, then rows; a row that would run off the page starts another page under the same headings.
  const head = () => {
    page.drawText('#', { x: MARGIN + COLS.no, y, size: 9, font: bold, color: color(MUTED) });
    page.drawText('รายการ', { x: MARGIN + COLS.item, y, size: 9, font: bold, color: color(MUTED) });
    for (const [label, right] of [
      ['จำนวน', COLS.qty],
      ['ราคา/เครื่อง', COLS.unit],
      ['รวม', COLS.amount],
    ] as const) {
      const w = bold.widthOfTextAtSize(label, 9);
      page.drawText(label, { x: MARGIN + right - w, y, size: 9, font: bold, color: color(MUTED) });
    }
    rule(y - 6, LINE, 0.8);
    y -= 24;
  };
  head();
  const bottom = MARGIN + 110;
  q.lines.forEach((l, i) => {
    const extra = (l.addons.length ? 1 : 0) + (l.note ? 1 : 0);
    const rowH = 20 + extra * 13;
    if (y - rowH < bottom) {
      newPage();
      y = A4.h - MARGIN - 4;
      head();
    }
    text(String(i + 1), MARGIN + COLS.no, 10, { color: MUTED });
    text(l.name, MARGIN + COLS.item, 11, { font: bold });
    text(String(l.qty), MARGIN + COLS.qty, 10, { right: true });
    text(l.unit === null ? 'สอบถาม' : fmtBaht(l.unit), MARGIN + COLS.unit, 10, { right: true, color: l.unit === null ? MUTED : INK });
    text(l.amount === null ? 'สอบถาม' : fmtBaht(l.amount), MARGIN + COLS.amount, 10, { font: bold, right: true, color: l.amount === null ? MUTED : INK });
    let yy = y;
    if (l.addons.length) {
      yy -= 13;
      page.drawText(`+ ${l.addons.join(', ')}`, { x: MARGIN + COLS.item, y: yy, size: 9, font: regular, color: color(INK) });
    }
    if (l.note) {
      yy -= 13;
      page.drawText(l.note, { x: MARGIN + COLS.item, y: yy, size: 9, font: regular, color: color(MUTED) });
    }
    y = yy - 8;
    rule(y + 2);
    y -= 12;
  });
  if (!q.lines.length) {
    text('ยังไม่มีเครื่องจักรในผัง', MARGIN + COLS.item, 10, { color: MUTED });
    y -= 20;
  }

  // The total, notes and signature lines go together: a new page if they no longer fit.
  if (y - 120 < MARGIN) {
    newPage();
    y = A4.h - MARGIN;
  }
  y -= 10;
  rule(y + 14, INK, 1);
  text('รวมทั้งสิ้น', MARGIN + COLS.unit, 12, { font: bold, right: true });
  text(fmtBaht(q.total), MARGIN + COLS.amount, 14, { font: bold, right: true, color: ORANGE });
  y -= 22;
  const notes: string[] = [];
  if (q.unpriced) notes.push('รายการที่ระบุ “สอบถาม” ยังไม่มีราคาในรายการราคา และไม่รวมอยู่ในยอดรวม');
  if (q.lines.some((l) => l.addonsUnpriced)) notes.push('อุปกรณ์เสริมที่ติ๊กไว้ยังไม่มีราคาในรายการราคา เสนอแยกต่างหาก');
  for (const n of notes) {
    text(`• ${n}`, MARGIN, 9, { color: MUTED });
    y -= 13;
  }
  y -= 48;
  const half = (A4.w - 2 * MARGIN) * 0.4;
  for (const [label, x] of [
    ['ผู้เสนอราคา', MARGIN],
    ['ผู้อนุมัติ', A4.w - MARGIN - half],
  ] as const) {
    page.drawLine({ start: { x, y: y + 14 }, end: { x: x + half, y: y + 14 }, thickness: 0.6, color: color(MUTED) });
    const w = regular.widthOfTextAtSize(label, 9);
    page.drawText(label, { x: x + (half - w) / 2, y, size: 9, font: regular, color: color(MUTED) });
  }

  return doc.save();
}

/** A safe file name for the quotation: the project's name with the characters a file name cannot hold swapped out. */
export const quotationFileName = (p: Project, when = new Date()): string => {
  const day = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  return `ใบเสนอราคา ${p.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()} ${day}.pdf`;
};
