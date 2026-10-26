import { describe, expect, it } from 'vitest';
import { PATTERN_WASTE_PCT, cabinetLines, countPiecesOnRect, furnitureLines, materialLine, takeOff } from './quantities';
import type { MaterialSpec, Surface } from './types';
import { rectSurface, roomWallSurface, skirtingSurface, type Opening } from './walls';

// ห้องทดสอบหลัก: 4000 × 5000 มม. (20 ม²) เส้นรอบรูป 18 ม. ผนังสูง 2600 ประตู 900×2000 หนึ่งบาน
const ROOM = { w: 4000, d: 5000, h: 2600 };
const DOOR: Opening = { kind: 'door', wMm: 900, hMm: 2000 };
const floor = (materialId: string): Surface => rectSurface('นอน', 'floor', ROOM.w, ROOM.d, materialId);
const walls = (materialId: string): Surface => roomWallSurface('นอน', 2 * (ROOM.w + ROOM.d), ROOM.h, [DOOR], materialId);

// สเปกวัสดุในเทสต์: ขนาดและจำนวนต่อกล่องเป็นค่าที่เทสต์กำหนดเอง ไม่มีราคา
const tile600: MaterialSpec = { id: 'tile600', name: 'กระเบื้อง 600×600', unit: { kind: 'tile', tileMm: { w: 600, h: 600 } }, perBox: 4 };
const plankHB: MaterialSpec = { id: 'plank', name: 'ไม้พื้น 100×400 ก้างปลา', unit: { kind: 'tile', tileMm: { w: 100, h: 400 }, pattern: 'herringbone' }, perBox: 20 };
const paint: MaterialSpec = { id: 'paint', name: 'สีทาภายใน', unit: { kind: 'paint', coverageM2PerUnit: 35, coats: 2 } };
const gypsum: MaterialSpec = { id: 'gyp', name: 'ยิปซัม 1200×2400', unit: { kind: 'sheet', sheetMm: { w: 1200, h: 2400 } } };
const skirting: MaterialSpec = { id: 'skirt', name: 'บัวพื้น', unit: { kind: 'linear', pieceLengthMm: 2400 } };

describe('countPiecesOnRect', () => {
  it('ปูตรง 600×600 บน 4000×5000: 7×9 ตำแหน่ง เต็ม 6×8', () => {
    expect(countPiecesOnRect(4000, 5000, 600, 600)).toEqual({ full: 48, cut: 15, total: 63 });
  });

  it('ขนาดลงตัวพอดีไม่มีแผ่นตัด', () => {
    expect(countPiecesOnRect(3000, 2400, 600, 600)).toEqual({ full: 20, cut: 0, total: 20 });
  });

  it('ก่ออิฐเลื่อนครึ่งแผ่น: แถวคี่ต้องการแผ่นมากขึ้นหนึ่งแผ่น', () => {
    // 9 แถว (8 เต็ม): แถวปกติ 5 แถว × 7 แผ่น + แถวเลื่อน 4 แถว × 8 แผ่น = 67; แผ่นเต็ม 4×6 + 4×6 = 48
    expect(countPiecesOnRect(4000, 5000, 600, 600, 300)).toEqual({ full: 48, cut: 19, total: 67 });
  });

  it('ขนาดศูนย์ให้ศูนย์', () => {
    expect(countPiecesOnRect(0, 5000, 600, 600)).toEqual({ full: 0, cut: 0, total: 0 });
  });
});

describe('materialLine: tile', () => {
  it('ห้อง 4000×5000 กระเบื้อง 600×600 ปูตรง 4 แผ่น/กล่อง → เต็ม 48 ตัด 15 ซื้อ 16 กล่อง', () => {
    const l = materialLine(tile600, [floor('tile600')]);
    expect(l.net).toBe(20);
    expect(l.pieces).toEqual({ full: 48, cut: 15, total: 63, method: 'layout' });
    expect(l.wastePct).toBe(0);
    expect(l.gross).toBeCloseTo(63 * 0.36, 6);
    expect(l.purchase).toEqual({ unit: 'กล่อง', qty: 16, perUnit: 4, perUnitLabel: '4 แผ่น/กล่อง' });
    expect(l.note).toContain('7×9 ตำแหน่ง เต็ม 48 ตัด 15');
    expect(l.note).toContain('16 กล่อง');
  });

  it('ตั้งเผื่อ 5% บนการวางจริง: 63 × 1.05 = 66.15 → 67 แผ่น → 17 กล่อง', () => {
    const l = materialLine(tile600, [floor('tile600')], 5);
    expect(l.pieces?.total).toBe(67);
    expect(l.purchase.qty).toBe(17);
    expect(l.wastePct).toBe(5);
  });

  it('ไม่รู้ขนาดห้อง: คิดจากพื้นที่ 20 ÷ 0.36 = 55.56 เผื่อ 10% → 62 แผ่น', () => {
    const s: Surface = { room: 'นอน', kind: 'floor', areaMm2: 20e6, materialId: 'tile600' };
    const l = materialLine(tile600, [s]);
    expect(l.pieces).toEqual({ full: null, cut: null, total: 62, method: 'formula' });
    expect(l.wastePct).toBe(PATTERN_WASTE_PCT.straight);
    expect(l.purchase.qty).toBe(16);
  });

  it('ไม้พื้น 100×400 ก้างปลา ห้องเดียวกัน: 20 ÷ 0.04 = 500 แผ่น เผื่อ 15% → 575 แผ่น 29 กล่อง', () => {
    const l = materialLine(plankHB, [floor('plank')]);
    expect(l.pieces).toEqual({ full: null, cut: null, total: 575, method: 'formula' });
    expect(l.wastePct).toBe(15);
    expect(l.gross).toBeCloseTo(23, 6);
    expect(l.purchase).toMatchObject({ unit: 'กล่อง', qty: 29 });
    expect(l.note).toContain('ก้างปลา');
  });

  it('ก้างปลาเผื่อมากกว่าปูตรง', () => {
    expect(PATTERN_WASTE_PCT.herringbone).toBeGreaterThan(PATTERN_WASTE_PCT.straight);
    expect(PATTERN_WASTE_PCT.diagonal).toBeGreaterThan(PATTERN_WASTE_PCT.straight);
  });

  it('ผิวผสม (บางผิวรู้ขนาด): นับทั้งสองทางแล้วรวม', () => {
    const noBounds: Surface = { room: 'ครัว', kind: 'floor', areaMm2: 3.6e6, materialId: 'tile600' };
    const l = materialLine(tile600, [floor('tile600'), noBounds]);
    // 63 จากการวาง + ceil(10 × 1.1) = 11 จากสูตร
    expect(l.pieces).toEqual({ full: null, cut: null, total: 74, method: 'mixed' });
    expect(l.rooms).toEqual(['นอน', 'ครัว']);
    expect(l.note).toContain('เต็ม 48 ตัด 15');
  });

  it('ห้องไม่ใช่สี่เหลี่ยม: หมายเหตุบอกว่านับเต็มกรอบ', () => {
    const l = materialLine(tile600, [{ ...floor('tile600'), areaMm2: 18e6 }]);
    expect(l.note).toContain('ใหญ่กว่าผิว');
    expect(l.pieces?.total).toBe(63);
  });
});

describe('materialLine: sheet / roll / area / paint / linear', () => {
  it('ยิปซัม 1200×2400 บนผนัง 18000×2600: 15 แผ่นเต็ม 15 แผ่นตัด', () => {
    const l = materialLine(gypsum, [walls('gyp')]);
    expect(l.pieces).toEqual({ full: 15, cut: 15, total: 30, method: 'layout' });
    expect(l.purchase).toEqual({ unit: 'แผ่น', qty: 30 });
    expect(l.net).toBe(45);
  });

  it('วอลเปเปอร์ม้วน 530×10000 บนผนัง 18000×2600: 34 แถบ × 2.6 ม. = 88.4 ม. → 9 ม้วน', () => {
    const wp: MaterialSpec = { id: 'wp', name: 'วอลเปเปอร์', unit: { kind: 'roll', widthMm: 530, lengthMm: 10000 } };
    const l = materialLine(wp, [walls('wp')]);
    expect(l.purchase).toMatchObject({ unit: 'ม้วน', qty: 9, perUnit: 10 });
    expect(l.note).toContain('34 แถบ');
    expect(l.note).toContain('88.4 ม.');
  });

  it('ม้วนไม่รู้ขนาด: พื้นที่ ÷ ความกว้าง', () => {
    const wp: MaterialSpec = { id: 'wp', name: 'วอลเปเปอร์', unit: { kind: 'roll', widthMm: 500, lengthMm: 10000 } };
    const l = materialLine(wp, [{ room: 'นอน', kind: 'wall', areaMm2: 45e6, materialId: 'wp' }]);
    // 45 ม² ÷ 0.5 ม. = 90 ม. → 9 ม้วน
    expect(l.purchase.qty).toBe(9);
  });

  it('คิดเป็น ตร.ม.: ปัดขึ้นตามขั้นที่ตั้ง', () => {
    const epoxy: MaterialSpec = { id: 'ep', name: 'อีพ็อกซี่', unit: { kind: 'area', stepM2: 1 } };
    expect(materialLine(epoxy, [floor('ep')]).purchase).toEqual({ unit: 'ตร.ม.', qty: 20 });
    expect(materialLine(epoxy, [floor('ep')], 5).purchase).toEqual({ unit: 'ตร.ม.', qty: 21 });
  });

  it('สี 2 ชั้น ผนังสูง 2600 มีประตู 900×2000: 45 ม² × 2 ÷ 35 = 2.57 → 3 แกลลอน', () => {
    const l = materialLine(paint, [walls('paint')]);
    expect(l.net).toBe(45);
    expect(l.purchase).toMatchObject({ unit: 'แกลลอน', qty: 3 });
    expect(l.note).toBe('45 ม² × 2 ชั้น ÷ 35 ม²/แกลลอน = 2.57 → 3 แกลลอน');
  });

  it('สีหน่วยอื่น (ถัง) และเผื่อ', () => {
    const p: MaterialSpec = { id: 'p', name: 'สี', unit: { kind: 'paint', coverageM2PerUnit: 100, coats: 1, unitName: 'ถัง' }, wastePct: 10 };
    const l = materialLine(p, [floor('p')]);
    // 20 × 1.1 = 22 ÷ 100 = 0.22 → 1 ถัง
    expect(l.gross).toBe(22);
    expect(l.purchase).toMatchObject({ unit: 'ถัง', qty: 1 });
  });

  it('บัวพื้นเส้น 2.4 ม.: 18 − 0.9 = 17.1 ม. → 8 เส้น', () => {
    const l = materialLine(skirting, [skirtingSurface('นอน', 18000, [DOOR], 'skirt')]);
    expect(l.qtyUnit).toBe('ม.');
    expect(l.net).toBe(17.1);
    expect(l.purchase).toMatchObject({ unit: 'เส้น', qty: 8, perUnit: 2.4 });
  });

  it('บัวพื้นไม่ระบุความยาวเส้น: ขายเป็นเมตร ปัดขึ้น 0.1', () => {
    const m: MaterialSpec = { id: 'skirt', name: 'บัวพื้น', unit: { kind: 'linear' } };
    const l = materialLine(m, [{ room: 'นอน', kind: 'floor', areaMm2: 0, perimeterMm: 17123, materialId: 'skirt' }]);
    expect(l.purchase).toEqual({ unit: 'ม.', qty: 17.2 });
  });
});

describe('furnitureLines / cabinetLines', () => {
  it('รวมเฟอร์นิเจอร์ชื่อและขนาดเดียวกัน', () => {
    const lines = furnitureLines([
      { name: 'เก้าอี้', qty: 2, sizeMm: { w: 450, d: 450, h: 850 }, room: 'กินข้าว' },
      { name: 'เก้าอี้', qty: 4, sizeMm: { w: 450, d: 450, h: 850 }, room: 'ครัว' },
      { name: 'เก้าอี้', qty: 1, sizeMm: { w: 600, d: 600, h: 800 } },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ item: 'เก้าอี้', net: 6, purchase: { unit: 'ชิ้น', qty: 6 }, rooms: ['กินข้าว', 'ครัว'] });
    expect(lines[0].note).toContain('450×450×850');
  });

  it('ตู้บิ้วอิน: พื้นที่ → แผ่น (ถ้ารู้ขนาดแผ่น) และปิดขอบ', () => {
    const hmr: MaterialSpec = { id: 'hmr', name: 'HMR 1220×2440', unit: { kind: 'sheet', sheetMm: { w: 1220, h: 2440 } } };
    const lines = cabinetLines(
      [
        { material: 'hmr', areaM2: 3, edgeBandM: 7.5, label: 'ตู้เสื้อผ้า' },
        { material: 'hmr', areaM2: 2, edgeBandM: 4.5 },
      ],
      [hmr],
    );
    // 5 ÷ 2.9768 = 1.68 แผ่น เผื่อ 10% = 1.85 → 2 แผ่น
    expect(lines[0]).toMatchObject({ id: 'hmr', category: 'cabinet', net: 5, purchase: { unit: 'แผ่น', qty: 2 }, rooms: ['ตู้เสื้อผ้า'] });
    expect(lines[1]).toMatchObject({ id: 'hmr:edge', qtyUnit: 'ม.', net: 12, purchase: { unit: 'ม.', qty: 12 } });
  });

  it('ตู้ที่วัสดุไม่มีสเปก: ลงเป็น ตร.ม.', () => {
    const lines = cabinetLines([{ material: 'x', areaM2: 1.5, edgeBandM: 0 }], []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ purchase: { unit: 'ตร.ม.', qty: 1.5 } });
    expect(lines[0].note).toContain('ไม่พบสเปกวัสดุ');
  });
});

describe('takeOff', () => {
  it('จัดกลุ่มผิวตามวัสดุ ตามลำดับที่พบ ต่อด้วยเฟอร์นิเจอร์และตู้', () => {
    const lines = takeOff(
      [floor('tile600'), walls('paint'), rectSurface('ครัว', 'floor', 3000, 2400, 'tile600'), skirtingSurface('นอน', 18000, [DOOR], 'skirt')],
      [tile600, paint, skirting],
      { furniture: [{ name: 'เตียง', qty: 1, sizeMm: { w: 1800, d: 2000, h: 450 } }], cabinetParts: [{ material: 'x', areaM2: 1, edgeBandM: 2 }] },
    );
    expect(lines.map((l) => l.id)).toEqual(['tile600', 'paint', 'skirt', 'furniture:เตียง|1800x2000x450', 'x', 'x:edge']);
    // นอน 63 + ครัว 20 แผ่น = 83 → 21 กล่อง
    expect(lines[0].pieces).toEqual({ full: 68, cut: 15, total: 83, method: 'layout' });
    expect(lines[0].purchase.qty).toBe(21);
    expect(lines[0].rooms).toEqual(['นอน', 'ครัว']);
  });

  it('วัสดุที่ไม่มีสเปก: บรรทัดพื้นที่พร้อมหมายเหตุ', () => {
    const [l] = takeOff([floor('mystery')], []);
    expect(l).toMatchObject({ id: 'mystery', net: 20, purchase: { unit: 'ตร.ม.', qty: 20 } });
    expect(l.note).toContain('ไม่พบสเปกวัสดุ');
  });

  it('options.wastePct ทับค่าของวัสดุ', () => {
    const [l] = takeOff([floor('tile600')], [{ ...tile600, wastePct: 3 }], { wastePct: { tile600: 10 } });
    expect(l.wastePct).toBe(10);
    expect(l.pieces?.total).toBe(70); // ceil(63 × 1.1 = 69.3)
  });
});
