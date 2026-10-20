/** What someone is doing at a moment, grouped into a handful of colors for the plan, the 3D view and the timeline. */
export type Act =
  | 'walk'
  | 'clock'
  | 'work'
  | 'idle'
  | 'deliver'
  | 'inspect'
  | 'patrol'
  | 'clean'
  | 'break'
  | 'meal'
  | 'toilet'
  | 'meeting'
  | 'host'
  | 'visit'
  | 'repair'
  | 'waitRepair';

export type ActGroup = 'work' | 'move' | 'rest' | 'repair' | 'wait' | 'meet';

export const ACTS: Record<Act, { label: string; group: ActGroup }> = {
  walk: { label: 'เดิน', group: 'move' },
  clock: { label: 'เข้า-ออกงาน', group: 'move' },
  work: { label: 'ทำงาน', group: 'work' },
  idle: { label: 'ประจำจุด', group: 'work' },
  deliver: { label: 'ส่งของ', group: 'work' },
  inspect: { label: 'ตรวจเช็ก', group: 'work' },
  patrol: { label: 'เดินตรวจ', group: 'work' },
  clean: { label: 'ทำความสะอาด', group: 'work' },
  break: { label: 'พัก', group: 'rest' },
  meal: { label: 'พักทานข้าว', group: 'rest' },
  toilet: { label: 'เข้าห้องน้ำ', group: 'rest' },
  meeting: { label: 'ประชุม', group: 'meet' },
  host: { label: 'ดูแลลูกค้า', group: 'meet' },
  visit: { label: 'ลูกค้า', group: 'meet' },
  repair: { label: 'ซ่อมเครื่อง', group: 'repair' },
  waitRepair: { label: 'รอช่างซ่อม', group: 'wait' },
};

export const GROUPS: Record<ActGroup, { label: string; color: string }> = {
  work: { label: 'ทำงาน', color: '#16a34a' },
  move: { label: 'กำลังเดิน', color: '#64748b' },
  rest: { label: 'พัก', color: '#f59e0b' },
  meet: { label: 'ประชุม / ลูกค้า', color: '#8b5cf6' },
  repair: { label: 'ซ่อม', color: '#ea580c' },
  wait: { label: 'รอซ่อม', color: '#dc2626' },
};

export const GROUP_IDS = Object.keys(GROUPS) as ActGroup[];

export const actColor = (a: Act) => GROUPS[ACTS[a].group].color;

export type MachineState = 'off' | 'running' | 'idle' | 'broken' | 'repair';

export const MACHINE_STATES: Record<MachineState, { label: string; color: string }> = {
  off: { label: 'ปิด', color: '#94a3b8' },
  running: { label: 'กำลังทำงาน', color: '#16a34a' },
  idle: { label: 'ว่าง (ไม่มีคนคุม)', color: '#eab308' },
  broken: { label: 'เสีย รอช่าง', color: '#dc2626' },
  repair: { label: 'กำลังซ่อม', color: '#ea580c' },
};
