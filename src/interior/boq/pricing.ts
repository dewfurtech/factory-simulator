/**
 * ใบเสนอราคาจาก BOQ: ราคาทุกช่องมาจากผู้ใช้ (PriceBook) ว่างได้ทุกช่อง โมดูลไม่มีราคาใด ๆ ของตัวเอง
 */
import type { BoqLine } from './types';

/** ราคาที่ผู้ใช้ใส่ต่อ `BoqLine.id` — `unitPrice` ต่อหน่วยซื้อ (กล่อง/แผ่น/ม้วน/แกลลอน/ม./ชิ้น), `laborPerUnit` ค่าแรงต่อหน่วยปริมาณสุทธิ (ตร.ม./ม./ชิ้น) */
export type PriceBook = Record<string, { unitPrice?: number; laborPerUnit?: number }>;

export const UNPRICED_LABEL = 'ยังไม่ใส่ราคา';

export interface QuoteRow {
  line: BoqLine;
  unitPrice?: number;
  laborPerUnit?: number;
  /** ค่าวัสดุ = จำนวนหน่วยซื้อ × unitPrice (ไม่มีเมื่อไม่ใส่ unitPrice) */
  materialCost?: number;
  /** ค่าแรง = ปริมาณสุทธิ × laborPerUnit (ไม่มีเมื่อไม่ใส่ laborPerUnit) */
  laborCost?: number;
  /** ยอดรวมบรรทัด มีเมื่อใส่ราคาอย่างน้อยหนึ่งช่อง */
  total?: number;
  /** ข้อความสถานะ: ยอดรวมเป็นตัวเลข หรือ UNPRICED_LABEL */
  status: string;
}

export interface Quote {
  rows: QuoteRow[];
  /** ยอดรวมเฉพาะบรรทัดที่มีราคา ก่อน VAT */
  subtotal: number;
  vatPct: number;
  vat: number;
  total: number;
  pricedCount: number;
  unpricedCount: number;
  /** ชื่อรายการที่ยังไม่มีราคา */
  unpricedItems: string[];
}

export interface QuoteOptions {
  /** VAT % ที่ผู้ใช้ตั้ง ไม่ตั้ง = ไม่คิด */
  vatPct?: number;
}

const money = (x: number) => Math.round(x * 100) / 100;

export function quote(lines: BoqLine[], priceBook: PriceBook, options: QuoteOptions = {}): Quote {
  const vatPct = options.vatPct ?? 0;
  const rows: QuoteRow[] = lines.map((line) => {
    const p = priceBook[line.id] ?? {};
    const materialCost = p.unitPrice !== undefined ? money(line.purchase.qty * p.unitPrice) : undefined;
    const laborCost = p.laborPerUnit !== undefined ? money(line.net * p.laborPerUnit) : undefined;
    const priced = materialCost !== undefined || laborCost !== undefined;
    const total = priced ? money((materialCost ?? 0) + (laborCost ?? 0)) : undefined;
    return { line, unitPrice: p.unitPrice, laborPerUnit: p.laborPerUnit, materialCost, laborCost, total, status: priced ? String(total) : UNPRICED_LABEL };
  });
  const subtotal = money(rows.reduce((s, r) => s + (r.total ?? 0), 0));
  const vat = money((subtotal * vatPct) / 100);
  const unpriced = rows.filter((r) => r.total === undefined);
  return {
    rows,
    subtotal,
    vatPct,
    vat,
    total: money(subtotal + vat),
    pricedCount: rows.length - unpriced.length,
    unpricedCount: unpriced.length,
    unpricedItems: unpriced.map((r) => r.line.item),
  };
}

/** ข้อความสรุปยอด เช่น "รวม 12,345.00 บาท (ยังไม่ใส่ราคา 2 รายการ)" */
export function quoteSummary(q: Quote, currency = 'บาท'): string {
  const fmtMoney = (x: number) => x.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = [`รวม ${fmtMoney(q.subtotal)} ${currency}`];
  if (q.vatPct > 0) parts.push(`VAT ${q.vatPct}% ${fmtMoney(q.vat)} ${currency}`, `สุทธิ ${fmtMoney(q.total)} ${currency}`);
  if (q.unpricedCount > 0) parts.push(`(${UNPRICED_LABEL} ${q.unpricedCount} รายการ)`);
  return parts.join(' ');
}
