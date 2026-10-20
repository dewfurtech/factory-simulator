import type { RoleId } from './types';
import type { UseKind } from './catalog';

export interface RoleInfo {
  label: string;
  /** Shirt color in 2D and 3D. */
  color: string;
  /** What kind of station this role is given when none is picked. */
  station: UseKind[];
  /** One line on what the simulation has them do. */
  does: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  manager: { label: 'ผู้จัดการโรงงาน', color: '#1f2937', station: ['desk'], does: 'ทำงานที่โต๊ะ เดินตรวจไลน์ผลิต เข้าประชุม และต้อนรับลูกค้าสำคัญ' },
  supervisor: { label: 'หัวหน้างาน', color: '#0f766e', station: ['desk', 'bench'], does: 'เดินตรวจเครื่องจักรทีละเครื่อง คุยกับช่างคุมเครื่อง' },
  operator: { label: 'ช่างคุมเครื่อง', color: '#2563eb', station: ['machine'], does: 'คุมเครื่องจักรที่ได้รับมอบหมาย รอช่างซ่อมเมื่อเครื่องเสีย' },
  technician: { label: 'ช่างซ่อมบำรุง', color: '#ea580c', station: ['bench'], does: 'รอที่โต๊ะช่าง หยิบเครื่องมือแล้วไปซ่อมเครื่องที่เสีย ตรวจเช็กเครื่องตามรอบ' },
  warehouse: { label: 'พนักงานคลัง', color: '#a16207', station: ['storage'], does: 'หยิบวัตถุดิบจากชั้นวาง ส่งให้เครื่องจักร แล้วกลับมาเก็บของ' },
  qc: { label: 'QC ตรวจคุณภาพ', color: '#7c3aed', station: ['qc', 'bench'], does: 'สุ่มชิ้นงานจากเครื่อง แล้วกลับมาตรวจที่โต๊ะ QC' },
  sales: { label: 'ฝ่ายขาย', color: '#db2777', station: ['desk'], does: 'ทำงานที่โต๊ะ รับลูกค้าที่จุดต้อนรับ พาชมเครื่องในโชว์รูม/ไลน์ผลิต' },
  admin: { label: 'ธุรการ / บัญชี', color: '#475569', station: ['desk'], does: 'ทำงานที่โต๊ะ เดินไปตู้เอกสาร และเข้าประชุมบ้าง' },
  reception: { label: 'พนักงานต้อนรับ', color: '#e11d48', station: ['reception', 'desk'], does: 'ประจำเคาน์เตอร์ต้อนรับ แจ้งฝ่ายขายเมื่อมีลูกค้า' },
  cleaner: { label: 'แม่บ้าน', color: '#65a30d', station: [], does: 'เดินทำความสะอาดแต่ละโซนวนไป' },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export const CUSTOMER_COLOR = '#f59e0b';
