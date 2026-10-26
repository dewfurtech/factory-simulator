import { describe, expect, it } from 'vitest';
import { UNPRICED_LABEL, quote, quoteSummary, type PriceBook } from './pricing';
import type { BoqLine } from './types';

const line = (id: string, purchaseQty: number, net: number, unit = 'กล่อง'): BoqLine => ({
  id,
  item: id,
  category: 'surface',
  rooms: [],
  qtyUnit: 'ตร.ม.',
  net,
  gross: net,
  wastePct: 0,
  purchase: { unit, qty: purchaseQty },
  note: '',
});

// ราคาในเทสต์เป็นตัวเลขสมมติที่ "ผู้ใช้" ใส่เอง เพื่อตรวจการคูณและรวมเท่านั้น
describe('quote', () => {
  it('ค่าวัสดุ = หน่วยซื้อ × ราคา, ค่าแรง = ปริมาณสุทธิ × ค่าแรงต่อหน่วย', () => {
    const book: PriceBook = { a: { unitPrice: 100, laborPerUnit: 10 } };
    const q = quote([line('a', 16, 20)], book);
    expect(q.rows[0]).toMatchObject({ materialCost: 1600, laborCost: 200, total: 1800, status: '1800' });
    expect(q).toMatchObject({ subtotal: 1800, vat: 0, total: 1800, pricedCount: 1, unpricedCount: 0, vatPct: 0 });
  });

  it('ใส่ราคาช่องเดียวก็นับว่ามีราคา', () => {
    const q = quote([line('a', 3, 45), line('b', 8, 17.1)], { a: { laborPerUnit: 20 }, b: { unitPrice: 50 } });
    expect(q.rows[0]).toMatchObject({ materialCost: undefined, laborCost: 900, total: 900 });
    expect(q.rows[1]).toMatchObject({ materialCost: 400, laborCost: undefined, total: 400 });
    expect(q.subtotal).toBe(1300);
  });

  it('บรรทัดไม่มีราคาแสดง "ยังไม่ใส่ราคา" และยอดรวมบอกจำนวน', () => {
    const q = quote([line('a', 16, 20), line('b', 3, 45), line('c', 8, 17.1)], { a: { unitPrice: 100 } });
    expect(q.rows[1].status).toBe(UNPRICED_LABEL);
    expect(q.rows[1].total).toBeUndefined();
    expect(q).toMatchObject({ subtotal: 1600, pricedCount: 1, unpricedCount: 2, unpricedItems: ['b', 'c'] });
    expect(quoteSummary(q)).toBe('รวม 1,600.00 บาท (ยังไม่ใส่ราคา 2 รายการ)');
  });

  it('ไม่มีราคาเลย: ยอดรวมศูนย์ ทุกบรรทัดยังไม่ใส่ราคา', () => {
    const q = quote([line('a', 1, 1)], {});
    expect(q).toMatchObject({ subtotal: 0, total: 0, pricedCount: 0, unpricedCount: 1 });
  });

  it('VAT ตามที่ผู้ใช้ตั้ง', () => {
    const q = quote([line('a', 10, 10)], { a: { unitPrice: 100 } }, { vatPct: 7 });
    expect(q).toMatchObject({ subtotal: 1000, vatPct: 7, vat: 70, total: 1070 });
    expect(quoteSummary(q)).toBe('รวม 1,000.00 บาท VAT 7% 70.00 บาท สุทธิ 1,070.00 บาท');
  });

  it('ปัดเงินเป็นสตางค์', () => {
    const q = quote([line('a', 3, 17.1)], { a: { unitPrice: 33.333, laborPerUnit: 1.005 } });
    expect(q.rows[0]).toMatchObject({ materialCost: 100, laborCost: 17.19, total: 117.19 });
  });
});
