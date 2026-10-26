/**
 * ส่งออก BOQ และใบเสนอราคาเป็น CSV (UTF-8 มี BOM ให้ Excel ไทยเปิดได้) และตาราง markdown สำหรับดูเร็ว
 */
import { UNPRICED_LABEL, type Quote } from './pricing';
import type { BoqLine } from './types';

export const CSV_BOM = '﻿';

type Cell = string | number | undefined | null;

const csvCell = (c: Cell): string => {
  if (c === undefined || c === null) return '';
  const s = typeof c === 'number' ? String(c) : c;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** แถว → CSV: BOM นำหน้า, คั่นด้วยจุลภาค, ขึ้นบรรทัดด้วย CRLF */
export const toCsv = (rows: Cell[][]): string => CSV_BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const purchaseText = (l: BoqLine) => `${l.purchase.qty} ${l.purchase.unit}${l.purchase.perUnitLabel ? ` (${l.purchase.perUnitLabel})` : ''}`;
const piecesText = (l: BoqLine) => (l.pieces && l.pieces.full !== null ? `เต็ม ${l.pieces.full} / ตัด ${l.pieces.cut}` : l.pieces ? `${l.pieces.total} แผ่น (จากสูตร)` : '');

export const BOQ_HEADERS = ['ลำดับ', 'รายการ', 'ห้อง', 'หน่วย', 'ปริมาณสุทธิ', 'เผื่อ %', 'ปริมาณรวมเผื่อ', 'จำนวนซื้อ', 'หน่วยซื้อ', 'แผ่นเต็ม/ตัด', 'วิธีคิด'];

export function boqRows(lines: BoqLine[]): Cell[][] {
  return lines.map((l, i) => [
    i + 1,
    l.item,
    l.rooms.join(', '),
    l.qtyUnit,
    l.net,
    l.wastePct,
    l.gross,
    l.purchase.qty,
    l.purchase.unit + (l.purchase.perUnitLabel ? ` (${l.purchase.perUnitLabel})` : ''),
    piecesText(l),
    l.note,
  ]);
}

export const boqCsv = (lines: BoqLine[]): string => toCsv([BOQ_HEADERS, ...boqRows(lines)]);

export const QUOTE_HEADERS = ['ลำดับ', 'รายการ', 'จำนวนซื้อ', 'ราคา/หน่วย', 'ค่าวัสดุ', 'ปริมาณสุทธิ', 'ค่าแรง/หน่วย', 'ค่าแรง', 'รวม'];

export function quoteRows(q: Quote): Cell[][] {
  const rows: Cell[][] = q.rows.map((r, i) => [
    i + 1,
    r.line.item,
    purchaseText(r.line),
    r.unitPrice,
    r.materialCost,
    `${r.line.net} ${r.line.qtyUnit}`,
    r.laborPerUnit,
    r.laborCost,
    r.total ?? UNPRICED_LABEL,
  ]);
  rows.push([], ['', 'รวมก่อน VAT', '', '', '', '', '', '', q.subtotal]);
  if (q.vatPct > 0) rows.push(['', `VAT ${q.vatPct}%`, '', '', '', '', '', '', q.vat], ['', 'รวมสุทธิ', '', '', '', '', '', '', q.total]);
  if (q.unpricedCount > 0) rows.push(['', `${UNPRICED_LABEL} ${q.unpricedCount} รายการ`, q.unpricedItems.join(', ')]);
  return rows;
}

export const quoteCsv = (q: Quote): string => toCsv([QUOTE_HEADERS, ...quoteRows(q)]);

const mdCell = (c: Cell) => (c === undefined || c === null ? '' : String(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));

/** ตาราง markdown จากหัวตารางและแถว */
export function markdownTable(headers: string[], rows: Cell[][]): string {
  const line = (cells: Cell[]) => `| ${headers.map((_, i) => mdCell(cells[i])).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

export const boqMarkdown = (lines: BoqLine[]): string => markdownTable(BOQ_HEADERS, boqRows(lines));
export const quoteMarkdown = (q: Quote): string =>
  markdownTable(
    QUOTE_HEADERS,
    quoteRows(q).filter((r) => r.length > 0),
  );
