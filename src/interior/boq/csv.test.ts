import { describe, expect, it } from 'vitest';
import { BOQ_HEADERS, CSV_BOM, QUOTE_HEADERS, boqCsv, boqMarkdown, markdownTable, quoteCsv, quoteMarkdown, toCsv } from './csv';
import { quote } from './pricing';
import type { BoqLine } from './types';

const tile: BoqLine = {
  id: 'tile600',
  item: 'กระเบื้อง 600×600',
  category: 'surface',
  rooms: ['นอน', 'ครัว'],
  qtyUnit: 'ตร.ม.',
  net: 20,
  gross: 22.68,
  wastePct: 0,
  purchase: { unit: 'กล่อง', qty: 16, perUnit: 4, perUnitLabel: '4 แผ่น/กล่อง' },
  pieces: { full: 48, cut: 15, total: 63, method: 'layout' },
  note: 'วางตรง, "ตามแบบ"',
};
const paint: BoqLine = {
  id: 'paint',
  item: 'สีทาภายใน',
  category: 'surface',
  rooms: ['นอน'],
  qtyUnit: 'ตร.ม.',
  net: 45,
  gross: 45,
  wastePct: 0,
  purchase: { unit: 'แกลลอน', qty: 3 },
  note: '45 × 2 ÷ 35',
};

describe('toCsv', () => {
  it('มี BOM, CRLF และครอบช่องที่มีจุลภาค/อัญประกาศ/ขึ้นบรรทัด', () => {
    const csv = toCsv([
      ['a', 'b,c', 'say "hi"', 'x\ny'],
      [1, 2.5, undefined, null],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('a,"b,c","say ""hi""","x\ny"\r\n1,2.5,,\r\n');
  });
});

describe('boqCsv / boqMarkdown', () => {
  it('หัวตารางและแถวครบ', () => {
    const csv = boqCsv([tile, paint]);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(BOQ_HEADERS.join(','));
    expect(rows[1]).toBe('1,กระเบื้อง 600×600,"นอน, ครัว",ตร.ม.,20,0,22.68,16,กล่อง (4 แผ่น/กล่อง),เต็ม 48 / ตัด 15,"วางตรง, ""ตามแบบ"""');
    expect(rows[2]).toBe('2,สีทาภายใน,นอน,ตร.ม.,45,0,45,3,แกลลอน,,45 × 2 ÷ 35');
  });

  it('markdown มีเส้นคั่นหัวตารางและหนีอักขระ |', () => {
    const md = boqMarkdown([{ ...paint, note: 'a|b' }]);
    const lines = md.split('\n');
    expect(lines[0]).toBe(`| ${BOQ_HEADERS.join(' | ')} |`);
    expect(lines[1]).toBe(`| ${BOQ_HEADERS.map(() => '---').join(' | ')} |`);
    expect(lines[2]).toContain('a\\|b');
    expect(markdownTable(['x'], [[1], ['y']])).toBe('| x |\n| --- |\n| 1 |\n| y |');
  });
});

describe('quoteCsv / quoteMarkdown', () => {
  it('บรรทัดไม่มีราคาเขียน "ยังไม่ใส่ราคา" และมีแถวรวม', () => {
    const q = quote([tile, paint], { tile600: { unitPrice: 100 } }, { vatPct: 7 });
    const rows = quoteCsv(q).slice(1).trimEnd().split('\r\n');
    expect(rows[0]).toBe(QUOTE_HEADERS.join(','));
    expect(rows[1]).toBe('1,กระเบื้อง 600×600,16 กล่อง (4 แผ่น/กล่อง),100,1600,20 ตร.ม.,,,1600');
    expect(rows[2]).toBe('2,สีทาภายใน,3 แกลลอน,,,45 ตร.ม.,,,ยังไม่ใส่ราคา');
    expect(rows[3]).toBe('');
    expect(rows[4]).toBe(',รวมก่อน VAT,,,,,,,1600');
    expect(rows[5]).toBe(',VAT 7%,,,,,,,112');
    expect(rows[6]).toBe(',รวมสุทธิ,,,,,,,1712');
    expect(rows[7]).toBe(',ยังไม่ใส่ราคา 1 รายการ,สีทาภายใน');
  });

  it('markdown ของใบเสนอราคาไม่มีแถวว่าง', () => {
    const q = quote([tile], {});
    const md = quoteMarkdown(q);
    expect(md.split('\n').every((l) => l.startsWith('|'))).toBe(true);
    expect(md).toContain('ยังไม่ใส่ราคา');
  });
});
