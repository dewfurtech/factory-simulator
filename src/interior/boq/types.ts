/**
 * ชนิดข้อมูลของเครื่องคิดปริมาณ BOQ (เฟส 3 ของ docs/interior-plan.md)
 *
 * โมดูลนี้เป็นโมดูลล้วน: ไม่มี UI, ไม่ import จากเฟส 1/2 — เฟสเหล่านั้นจะแปลงข้อมูลของตัวเองมาเป็น `Surface[]`,
 * `FurnitureItem[]`, `CabinetPartSummary[]` ตามรูปแบบที่นิยามไว้ที่นี่
 *
 * หลักสำคัญ: ไม่มีราคาหรือตัวเลขสมมติในโมดูล ค่าเริ่มต้นมีได้เฉพาะขนาดมาตรฐานที่ใช้กันจริง (ดู `STANDARD`) และผู้ใช้ตั้งทับได้ทุกค่า
 */

export type SurfaceKind = 'floor' | 'wall' | 'ceiling';

/** ผิวหนึ่งผิวของห้องที่จะปูวัสดุ หน่วยทุกค่าเป็นมิลลิเมตร */
export interface Surface {
  /** ชื่อห้อง (ใช้จัดกลุ่มในหมายเหตุ) */
  room: string;
  kind: SurfaceKind;
  /** พื้นที่สุทธิของผิว (ผนัง = หักช่องเปิดแล้ว ดู walls.ts) หน่วย มม.² */
  areaMm2: number;
  /**
   * ความยาวที่ใช้กับวัสดุชนิด `linear` เช่น บัวพื้นใช้เส้นรอบรูปห้องหักประตู (ดู `skirtingLengthMm`)
   * วัสดุชนิดอื่นไม่ใช้ค่านี้
   */
  perimeterMm?: number;
  /**
   * สี่เหลี่ยมคลุม (bounding box) ของผิว เมื่อให้มา tile/sheet/roll จะนับจากการวางจริงบนสี่เหลี่ยมนี้
   * พื้น/ฝ้า: กว้าง × ยาว ของห้อง · ผนัง: ความยาวผนัง × ความสูง
   * ห้องที่ไม่ใช่สี่เหลี่ยมจะได้ค่าเกินจริงเล็กน้อย (นับเต็มกรอบ) ซึ่งหมายเหตุของบรรทัดจะบอกไว้
   */
  boundsMm?: { w: number; h: number };
  materialId: string;
}

/** ลายปู มีผลต่อเศษตัดเมื่อคิดจากสูตรพื้นที่ (ดู PATTERN_WASTE_PCT ใน quantities.ts) */
export type LayPattern = 'straight' | 'brick' | 'herringbone' | 'diagonal';

/** วิธีคิดหน่วยของวัสดุ */
export type MaterialUnit =
  /** แผ่นเล็กขนาด w×h มม. (กระเบื้อง ไม้พื้น) นับแผ่นเต็ม/แผ่นตัดจากการวางจริงได้ */
  | { kind: 'tile'; tileMm: { w: number; h: number }; pattern?: LayPattern }
  /** แผ่นใหญ่ขนาด w×h มม. (ยิปซัม ไม้อัด ลามิเนต) */
  | { kind: 'sheet'; sheetMm: { w: number; h: number } }
  /** ม้วน กว้าง w ยาว l มม. (วอลเปเปอร์ พรม กระเบื้องยางม้วน) */
  | { kind: 'roll'; widthMm: number; lengthMm: number }
  /** คิดเป็น ตร.ม. ตรง ๆ (ขัดมัน อีพ็อกซี่) `stepM2` = ขั้นปัดขึ้นของหน่วยซื้อ ไม่ใส่ = 0.01 */
  | { kind: 'area'; stepM2?: number }
  /** สี: ครอบคลุม `coverageM2PerUnit` ตร.ม. ต่อหน่วยต่อชั้น × `coats` ชั้น หน่วยซื้อชื่อ `unitName` (ไม่ใส่ = แกลลอน) */
  | { kind: 'paint'; coverageM2PerUnit: number; coats: number; unitName?: string }
  /** ความยาว (บัวพื้น บัวฝ้า จมูกบันได) ถ้าให้ `pieceLengthMm` จะปัดเป็นจำนวนเส้น */
  | { kind: 'linear'; pieceLengthMm?: number };

export interface MaterialSpec {
  id: string;
  /** ชื่อไทยที่แสดงในตาราง */
  name: string;
  unit: MaterialUnit;
  /** จำนวนแผ่นต่อกล่อง (tile/sheet) ถ้าให้ หน่วยซื้อจะเป็นกล่อง */
  perBox?: number;
  /**
   * เปอร์เซ็นต์เผื่อตัด/แตก ที่ผู้ใช้ตั้งเอง
   * ไม่ตั้ง: tile/sheet ที่คิดจากสูตรพื้นที่ใช้ค่าตามลายปู (PATTERN_WASTE_PCT) · กรณีอื่นไม่เผื่อ (0)
   */
  wastePct?: number;
}

/** เฟอร์นิเจอร์ลอยตัวจาก objects ของห้อง (เฟส 1 ส่งมา) */
export interface FurnitureItem {
  name: string;
  qty: number;
  /** กว้าง × ลึก × สูง มม. */
  sizeMm: { w: number; d: number; h: number };
  room?: string;
}

/** สรุปชิ้นส่วนตู้บิ้วอินต่อวัสดุ (รูปแบบที่เฟส 2 จะส่งมา) */
export interface CabinetPartSummary {
  /** id วัสดุแผ่น ถ้าตรงกับ MaterialSpec ชนิด sheet จะแปลงเป็นจำนวนแผ่น */
  material: string;
  /** พื้นที่แผ่นรวมทุกชิ้น ตร.ม. */
  areaM2: number;
  /** ความยาวปิดขอบรวม เมตร */
  edgeBandM: number;
  /** ชื่อตู้/ห้อง เพื่อหมายเหตุ */
  label?: string;
}

/** ผลนับแผ่นของ tile/sheet */
export interface PieceCount {
  /** แผ่นเต็ม (รู้เฉพาะเมื่อนับจากการวางจริง) */
  full: number | null;
  /** แผ่นที่ต้องตัด (รู้เฉพาะเมื่อนับจากการวางจริง) */
  cut: number | null;
  /** จำนวนแผ่นรวมเผื่อ ที่ต้องมี */
  total: number;
  /** 'layout' = วางจริงบน bounding box · 'formula' = พื้นที่ ÷ พื้นที่แผ่น + % เผื่อ · 'mixed' = บางผิวมีขนาด บางผิวไม่มี */
  method: 'layout' | 'formula' | 'mixed';
}

export type LineCategory = 'surface' | 'furniture' | 'cabinet';

/** หนึ่งบรรทัดใน BOQ */
export interface BoqLine {
  /** id วัสดุ หรือคีย์ของเฟอร์นิเจอร์/ขอบตู้ ใช้จับคู่กับ PriceBook */
  id: string;
  item: string;
  category: LineCategory;
  /** ห้องที่ใช้ (ไม่ซ้ำ เรียงตามที่พบ) */
  rooms: string[];
  /** หน่วยของ `net`/`gross`: 'ตร.ม.' | 'ม.' | 'ชิ้น' */
  qtyUnit: string;
  /** ปริมาณสุทธิจากเรขาคณิต */
  net: number;
  /** ปริมาณรวมเผื่อ (tile/sheet ที่นับจากการวางจริง = จำนวนแผ่น × พื้นที่แผ่น) */
  gross: number;
  /** % เผื่อที่ใช้จริงในบรรทัดนี้ */
  wastePct: number;
  /** หน่วยซื้อที่ปัดขึ้นแล้ว เช่น 16 กล่อง (4 แผ่น/กล่อง) */
  purchase: { unit: string; qty: number; perUnit?: number; perUnitLabel?: string };
  pieces?: PieceCount;
  /** หมายเหตุวิธีคิด ภาษาไทยสั้น ๆ ให้คนตรวจตามได้ */
  note: string;
}

export interface TakeOffOptions {
  /** % เผื่อทับค่าของวัสดุ ต่อ materialId */
  wastePct?: Record<string, number>;
  furniture?: FurnitureItem[];
  cabinetParts?: CabinetPartSummary[];
}

/**
 * ขนาดมาตรฐานที่ใช้กันทั่วไปจริง ให้ผู้ใช้เลือกเป็นค่าตั้งต้นได้ (ไม่ใช่ราคา ไม่ใช่สเปกสมมติ)
 * - กระเบื้อง 600×600 มม.: ขนาดกระเบื้องพื้นที่ขายทั่วไปที่สุดในไทย
 * - ยิปซัม 1200×2400 มม.: ขนาดแผ่นมาตรฐานของผู้ผลิตยิปซัมในไทย (ตราช้าง, ยิปรอค, ไทยยิปซัม)
 * - สี 35 ตร.ม./แกลลอน/ชั้น: เอกสารข้อมูลผลิตภัณฑ์ของผู้ผลิตสีไทย (TOA, Beger, Nippon) ระบุ ~35–40 ตร.ม./แกลลอน/ชั้น
 *   เลือกขอบล่าง 35 เพื่อให้ปริมาณไม่ขาด ผู้ใช้ตั้งตามกระป๋องจริงได้
 */
export const STANDARD = {
  tileMm: { w: 600, h: 600 },
  gypsumSheetMm: { w: 1200, h: 2400 },
  paintCoverageM2PerGallon: 35,
} as const;
