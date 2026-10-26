/**
 * ตัวช่วยคิดพื้นที่ผนังสุทธิและความยาวบัวพื้น (หน่วย มม.)
 */
import type { Surface } from './types';

/** ช่องเปิดบนผนัง ประตูหักออกจากบัวพื้นด้วย หน้าต่างไม่หัก */
export interface Opening {
  kind: 'door' | 'window';
  wMm: number;
  hMm: number;
  qty?: number;
}

/** พื้นที่ช่องเปิดรวม มม.² */
export const openingsAreaMm2 = (openings: Opening[]): number => openings.reduce((s, o) => s + o.wMm * o.hMm * (o.qty ?? 1), 0);

/**
 * พื้นที่ผนังสุทธิ = ความยาว × ความสูง − ช่องเปิดทั้งหมด (ไม่ต่ำกว่า 0)
 * ใช้ได้ทั้งผนังเดี่ยว (lengthMm = ความยาวผนัง) และผนังทุกด้านของห้องรวมกัน (lengthMm = เส้นรอบรูป)
 */
export function netWallAreaMm2(lengthMm: number, heightMm: number, openings: Opening[] = []): number {
  return Math.max(0, lengthMm * heightMm - openingsAreaMm2(openings));
}

/** ความยาวบัวพื้น = เส้นรอบรูป − ความกว้างประตูทุกบาน (ไม่ต่ำกว่า 0) */
export function skirtingLengthMm(perimeterMm: number, openings: Opening[] = []): number {
  const doors = openings.filter((o) => o.kind === 'door').reduce((s, o) => s + o.wMm * (o.qty ?? 1), 0);
  return Math.max(0, perimeterMm - doors);
}

/**
 * ผิวผนังของห้อง (ทุกด้านรวมเป็นผิวเดียว) พร้อม bounding box = เส้นรอบรูป × ความสูง
 * เพื่อให้ sheet/roll นับแผ่นจากการวางเรียงยาวตามผนังได้
 */
export function roomWallSurface(room: string, perimeterMm: number, heightMm: number, openings: Opening[], materialId: string): Surface {
  return {
    room,
    kind: 'wall',
    areaMm2: netWallAreaMm2(perimeterMm, heightMm, openings),
    perimeterMm,
    boundsMm: { w: perimeterMm, h: heightMm },
    materialId,
  };
}

/** ผิวบัวพื้นของห้อง: ใช้กับวัสดุชนิด `linear` ความยาว = เส้นรอบรูป − ประตู */
export function skirtingSurface(room: string, perimeterMm: number, openings: Opening[], materialId: string): Surface {
  return { room, kind: 'floor', areaMm2: 0, perimeterMm: skirtingLengthMm(perimeterMm, openings), materialId };
}

/** ผิวพื้นหรือฝ้าของห้องสี่เหลี่ยม กว้าง × ยาว */
export function rectSurface(room: string, kind: 'floor' | 'ceiling', wMm: number, dMm: number, materialId: string): Surface {
  return { room, kind, areaMm2: wMm * dMm, perimeterMm: 2 * (wMm + dMm), boundsMm: { w: wMm, h: dMm }, materialId };
}
