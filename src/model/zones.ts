import type { ZoneKind } from './types';

export interface ZoneInfo {
  label: string;
  /** Floor color in 2D and 3D. */
  color: string;
}

export const ZONES: Record<ZoneKind, ZoneInfo> = {
  production: { label: 'พื้นที่ผลิต', color: '#d9dde3' },
  warehouse: { label: 'คลังสินค้า / วัตถุดิบ', color: '#e6dcc8' },
  office: { label: 'สำนักงาน', color: '#e9e2d6' },
  meeting: { label: 'ห้องประชุม', color: '#dfe6dc' },
  canteen: { label: 'โรงอาหาร', color: '#f1e3c6' },
  break: { label: 'มุมพัก', color: '#e8eedf' },
  toilet: { label: 'ห้องน้ำ', color: '#d6e6ee' },
  locker: { label: 'ห้องล็อกเกอร์', color: '#dde0ea' },
  reception: { label: 'ต้อนรับ', color: '#f0e6dc' },
  showroom: { label: 'โชว์รูม', color: '#ece4f0' },
  maintenance: { label: 'ซ่อมบำรุง', color: '#e9ddd2' },
  qc: { label: 'ตรวจคุณภาพ (QC)', color: '#dbe8e4' },
  loading: { label: 'รับ-ส่งสินค้า', color: '#e3e0d6' },
  corridor: { label: 'ทางเดิน', color: '#ecebe8' },
  other: { label: 'อื่น ๆ', color: '#e7e5e1' },
};

export const ZONE_IDS = Object.keys(ZONES) as ZoneKind[];

/** Ground outdoors: a yard or car park inside the fence. */
export const OUTDOOR_COLOR = '#dcd8cf';

export const zoneColor = (room: { zone: ZoneKind; color?: string; outdoor?: true }) =>
  room.color ?? (room.outdoor ? OUTDOOR_COLOR : (ZONES[room.zone]?.color ?? ZONES.other.color));
