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
  // Home rooms (interior projects): offered by src/interior/zones.ts, never by the factory's picker.
  living: { label: 'นั่งเล่น', color: '#efe6d8' },
  dining: { label: 'ทานอาหาร', color: '#f1e5cf' },
  bedroom: { label: 'นอน', color: '#e6e0ee' },
  kitchen: { label: 'ครัว', color: '#e9e4d4' },
  bath: { label: 'น้ำ', color: '#d8e7ee' },
  study: { label: 'ทำงาน', color: '#dfe6dc' },
  dressing: { label: 'แต่งตัว', color: '#eee0e4' },
  laundry: { label: 'ซักล้าง', color: '#dde7e6' },
  balcony: { label: 'ระเบียง', color: '#e3e8d8' },
  hall: { label: 'โถง / ทางเดิน', color: '#ecebe8' },
  storeroom: { label: 'เก็บของ', color: '#e5e1d8' },
};

/** The factory's zones, in the order its picker shows them. Home rooms are listed by the interior module instead. */
export const ZONE_IDS: ZoneKind[] = [
  'production',
  'warehouse',
  'office',
  'meeting',
  'canteen',
  'break',
  'toilet',
  'locker',
  'reception',
  'showroom',
  'maintenance',
  'qc',
  'loading',
  'corridor',
  'other',
];

/** Ground outdoors: a yard or car park inside the fence. */
export const OUTDOOR_COLOR = '#dcd8cf';

export const zoneColor = (room: { zone: ZoneKind; color?: string; outdoor?: true }) =>
  room.color ?? (room.outdoor ? OUTDOOR_COLOR : (ZONES[room.zone]?.color ?? ZONES.other.color));
