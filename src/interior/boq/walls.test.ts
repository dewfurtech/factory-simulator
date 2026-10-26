import { describe, expect, it } from 'vitest';
import { netWallAreaMm2, openingsAreaMm2, rectSurface, roomWallSurface, skirtingLengthMm, skirtingSurface, type Opening } from './walls';

const door: Opening = { kind: 'door', wMm: 900, hMm: 2000 };
const window: Opening = { kind: 'window', wMm: 1200, hMm: 1100, qty: 2 };

describe('walls', () => {
  it('พื้นที่ช่องเปิดรวม นับจำนวนบาน', () => {
    expect(openingsAreaMm2([door, window])).toBe(900 * 2000 + 2 * 1200 * 1100);
  });

  it('ผนังสูง 2600 เส้นรอบรูป 18 ม. มีประตู 900×2000: 46.8 − 1.8 = 45 ม²', () => {
    expect(netWallAreaMm2(18000, 2600, [door])).toBe(45e6);
  });

  it('ช่องเปิดใหญ่กว่าผนังไม่ติดลบ', () => {
    expect(netWallAreaMm2(800, 2000, [door])).toBe(0);
  });

  it('บัวพื้น = เส้นรอบรูป − ประตู (หน้าต่างไม่หัก)', () => {
    expect(skirtingLengthMm(18000, [door, window])).toBe(17100);
    expect(skirtingLengthMm(18000)).toBe(18000);
    expect(skirtingLengthMm(500, [door])).toBe(0);
  });

  it('roomWallSurface ให้ผิวผนังพร้อมกรอบ เส้นรอบรูป × สูง', () => {
    expect(roomWallSurface('นอน', 18000, 2600, [door], 'paint')).toEqual({
      room: 'นอน',
      kind: 'wall',
      areaMm2: 45e6,
      perimeterMm: 18000,
      boundsMm: { w: 18000, h: 2600 },
      materialId: 'paint',
    });
  });

  it('skirtingSurface และ rectSurface', () => {
    expect(skirtingSurface('นอน', 18000, [door], 'skirt')).toEqual({ room: 'นอน', kind: 'floor', areaMm2: 0, perimeterMm: 17100, materialId: 'skirt' });
    expect(rectSurface('นอน', 'ceiling', 4000, 5000, 'gyp')).toEqual({
      room: 'นอน',
      kind: 'ceiling',
      areaMm2: 20e6,
      perimeterMm: 18000,
      boundsMm: { w: 4000, h: 5000 },
      materialId: 'gyp',
    });
  });
});
