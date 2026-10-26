import { describe, expect, it } from 'vitest';
import { STANDARD, type MaterialSpec, type Surface } from './types';

describe('types', () => {
  it('ขนาดมาตรฐานเป็นค่าที่ใช้กันจริง: กระเบื้อง 600×600, ยิปซัม 1200×2400, สี 35 ม²/แกลลอน/ชั้น', () => {
    expect(STANDARD.tileMm).toEqual({ w: 600, h: 600 });
    expect(STANDARD.gypsumSheetMm).toEqual({ w: 1200, h: 2400 });
    expect(STANDARD.paintCoverageM2PerGallon).toBe(35);
  });

  it('สเปกวัสดุทุกชนิดประกอบจาก STANDARD ได้โดยไม่ต้องใส่ราคา', () => {
    const specs: MaterialSpec[] = [
      { id: 't', name: 'กระเบื้อง', unit: { kind: 'tile', tileMm: STANDARD.tileMm, pattern: 'brick' }, perBox: 4 },
      { id: 'g', name: 'ยิปซัม', unit: { kind: 'sheet', sheetMm: STANDARD.gypsumSheetMm } },
      { id: 'p', name: 'สี', unit: { kind: 'paint', coverageM2PerUnit: STANDARD.paintCoverageM2PerGallon, coats: 2 } },
      { id: 'r', name: 'วอลเปเปอร์', unit: { kind: 'roll', widthMm: 530, lengthMm: 10000 } },
      { id: 'a', name: 'ขัดมัน', unit: { kind: 'area' } },
      { id: 'l', name: 'บัว', unit: { kind: 'linear', pieceLengthMm: 2400 } },
    ];
    const surface: Surface = { room: 'นอน', kind: 'floor', areaMm2: 20e6, materialId: 't' };
    expect(specs.map((s) => s.unit.kind)).toEqual(['tile', 'sheet', 'paint', 'roll', 'area', 'linear']);
    expect(JSON.stringify(specs)).not.toMatch(/price|ราคา/);
    expect(surface.materialId).toBe('t');
  });
});
