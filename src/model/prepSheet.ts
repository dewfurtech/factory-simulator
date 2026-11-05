import { boardOf } from './board';
import { catalogItem, isMachine } from './catalog';
import { deliveryFor } from './delivery';
import { sitePrepOf } from './sitePrep';
import type { Project } from './types';
import { PIPE_MATERIAL, utilitiesFor } from './utilities';
import { airPlan, dustPlan } from './utilityCalc';

/**
 * Everything a customer has to have ready before the machines arrive, one section per trade, in words they can pass to
 * their electrician and builder. The figures come from the layout; the jobs are common practice for each trade
 * (see docs/utility-data.md), and an engineer checks them against the real site.
 */

export type PrepId = 'power' | 'air' | 'dust' | 'floor' | 'access';

export interface PrepRow {
  label: string;
  value: string;
  warn?: boolean;
}

export interface PrepTable {
  head: string[];
  rows: string[][];
}

export interface PrepSection {
  id: PrepId;
  title: string;
  rows: PrepRow[];
  /** The jobs to have done on site. */
  todo: string[];
  table?: PrepTable;
}

/** What goes with each compressor (B&D catalogue; the set confirmed by Mastrox). */
const AIR_SET: Record<string, { name: string; dryer: string; filter: string }> = {
  'vair-10': { name: 'VAir 10HP', dryer: 'DHF-10', filter: 'DHF-015' },
  'vair-20': { name: 'VAir 20HP', dryer: 'DHF-20', filter: 'DHF-035' },
};

const ton = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} ตัน` : `${kg} กก.`);
const metres = (mm: number) => (mm / 1000).toFixed(1);

function powerSection(project: Project): PrepSection {
  const board = boardOf(project);
  const { plan } = board;
  const d = utilitiesFor(project).design;
  const [phase, , , neutral, earth] = board.mainWires;
  const rows: PrepRow[] = [
    { label: 'ไฟเข้า', value: `3 เฟส 4 สาย ${d.volts}/220V 50Hz` },
    { label: 'โหลดรวม', value: `${plan.connected.toFixed(1)} kW · ใช้จริง ${plan.demand.toFixed(1)} kW` },
    { label: 'หม้อแปลง', value: `≥ ${plan.kva} kVA` },
    { label: 'เบรกเกอร์เมน', value: `${plan.breaker}A 3P` },
    phase
      ? { label: 'สายเมน', value: `${board.cableType} 3×${phase.mm2} + N ${neutral.mm2} + G ${earth.mm2} ตร.มม.` }
      : { label: 'สายเมน', value: 'ต้องเดินสายขนาน', warn: true },
    { label: 'ตู้ MDB', value: `เมน 1 + ย่อย ${board.feeders.length} วงจร` },
  ];
  rows.push({ label: 'แรงดันตกเมน', value: `${plan.mainDrop.toFixed(1)}% (รวมไม่เกิน ${d.totalDropPct}%)` });
  rows.push({ label: 'สายป้อนวางรวม', value: `${board.feeders.length} วงจร ลดพิกัด × ${plan.group.toFixed(2)}` });
  if (!plan.hasBoard) rows.push({ label: 'ตำแหน่งตู้', value: 'ยังไม่ได้วางบนผัง', warn: true });
  for (const l of plan.lines)
    if (l.existing?.problems.length) rows.push({ label: `${l.name} สายเดิม ${l.existing.mm2}`, value: `เล็กไป ใช้ ${l.mm2 ?? 'สายขนาน'} ตร.มม.`, warn: true });
  for (const c of board.cable) rows.push({ label: `สาย ${c.mm2} ตร.มม.`, value: `${c.metres} ม.` });
  return {
    id: 'power',
    title: 'ไฟฟ้า',
    rows,
    todo: [
      'ต่อหลักดิน ความต้านทานไม่เกิน 5 โอห์ม',
      'แยกเบรกเกอร์ทุกเครื่อง',
      'สายป้อนห้ามเล็กกว่าตาราง คิดลดพิกัดแล้วทั้งความร้อนและสายวางรวม',
      'เผื่อไฟเครื่องดูดฝุ่นและแสงสว่าง ยังไม่รวมในตัวเลขนี้',
      'ตรวจแรงดันและลำดับเฟสก่อนเปิดเครื่อง',
      'ให้วิศวกรไฟฟ้าตรวจแบบก่อนติดตั้ง',
    ],
    table: {
      head: ['เครื่อง', 'A', 'เบรกเกอร์', 'เฟส/ดิน', '%ตก', 'ม.'],
      rows: board.feeders.map((f, i) => {
        const size = f.wires.length ? `${f.wires[0].mm2}/${f.wires[4].mm2}` : 'เกินตาราง';
        return [f.name, f.amps.toFixed(1), `${f.breaker}A`, size, plan.lines[i].drop.toFixed(1), String(Math.round(f.metres))];
      }),
    },
  };
}

function airSection(project: Project): PrepSection | null {
  const air = airPlan(project);
  if (air.used <= 0) return null;
  const prep = sitePrepOf(project);
  const d = utilitiesFor(project).design;
  const look = PIPE_MATERIAL[air.material];
  const pumps = project.objects.filter((o) => isMachine(o) && !o.hidden && AIR_SET[o.assetId]).map((o) => o.assetId);
  const want = prep.compressor;
  const sets = want ? [...pumps, ...Array<string>(want.count).fill(want.id)] : pumps;
  const count = (ids: string[]) => [...new Set(ids)].map((id) => `${id} × ${ids.filter((x) => x === id).length}`).join(', ');
  const rows: PrepRow[] = [
    { label: 'ลมที่ต้องใช้', value: `${(air.needed / 1000).toFixed(2)} m³/นาที` },
    want
      ? { label: 'ปั๊มลม', value: `ต้องเพิ่ม ${AIR_SET[want.id].name} × ${want.count}`, warn: true }
      : { label: 'ปั๊มลม', value: count(pumps.map((id) => AIR_SET[id].name)) },
    { label: 'ตั้งแรงดันปั๊ม', value: `${air.setPressure.toFixed(1)} บาร์`, warn: air.short },
    { label: 'ท่อเมน', value: `${look.label} ${air.main?.label ?? 'เกินตาราง'}`, warn: !air.main || air.tooSmall },
    { label: 'ความยาวถึงเครื่องไกลสุด', value: `${Math.round(air.mainLength)} ม.` },
    { label: 'ตก dryer + filter', value: `${air.treatment.toFixed(2)} บาร์` },
    { label: 'ตกในท่อเมน สูงสุด', value: `${air.mainDrop.toFixed(3)} บาร์` },
  ];
  if (air.tooSmall) rows.push({ label: 'ท่อเมนเดิมเล็กไป', value: `ควรใช้ ${air.suggested?.label ?? 'ใหญ่กว่าในตาราง'}`, warn: true });
  if (sets.length) {
    rows.splice(2, 0, { label: 'Dryer', value: count(sets.map((id) => AIR_SET[id].dryer)) });
    rows.splice(3, 0, { label: 'Filter', value: count(sets.flatMap((id) => Array<string>(d.filters).fill(AIR_SET[id].filter))) });
  }
  if (air.unreached.length) rows.push({ label: 'ท่อยังไม่ถึง', value: air.unreached.join(', '), warn: true });
  return {
    id: 'air',
    title: 'ลมอัด',
    rows,
    todo: [
      ...(d.pipeLayout === 'ring' ? ['เดินท่อเมนเป็นวงรอบพื้นที่ทำงาน'] : []),
      'วางท่อลาดเอียงประมาณ 1% ไปจุดระบายน้ำ',
      'แยกท่อลงเครื่องจากด้านบนของท่อเมน',
      'ติดวาล์วปิดก่อนเข้าเครื่อง และ drain ที่จุดต่ำ',
      'ตั้งปั๊มในที่อากาศถ่ายเท อุณหภูมิไม่เกิน 40 °C',
    ],
    table: {
      head: ['เครื่อง', 'L/นาที', 'ท่อแยก', 'ตก บาร์', 'ถึงเครื่อง'],
      rows: air.branches.map((b) => [b.name, String(b.lpm), b.pipe?.label ?? '–', (b.mainDrop + b.branchDrop).toFixed(2), b.at.toFixed(1)]),
    },
  };
}

function dustSection(project: Project): PrepSection | null {
  const dust = dustPlan(project);
  if (dust.total <= 0) return null;
  const hundred = (n: number) => (Math.round(n / 100) * 100).toLocaleString('en-US');
  const d = utilitiesFor(project).design;
  return {
    id: 'dust',
    title: 'ดูดฝุ่น',
    rows: [
      { label: 'รวมทุกเครื่อง', value: `${hundred(dust.total)} m³/ชม.` },
      { label: 'เครื่องดูดฝุ่น', value: `≥ ${hundred(dust.demand)} m³/ชม.` },
      { label: 'ท่อเมน', value: dust.main ? `Ø${dust.main} มม.` : 'เกินตาราง', warn: !dust.main },
      { label: 'ความเร็วลมในท่อ', value: `≥ ${d.ductVelocity} ม./วิ` },
    ],
    todo: ['ติด blast gate ทุกเครื่อง', 'ต่อดินท่อทั้งเส้น กันไฟฟ้าสถิต', 'ตั้งเครื่องดูดฝุ่นนอกอาคารถ้าทำได้', 'ต่อวงจรให้เครื่องดูดฝุ่นทำงานก่อนเครื่องจักร'],
    table: { head: ['เครื่อง', 'm³/ชม.', 'ช่องดูด', 'ท่อ'], rows: dust.lines.map((l) => [l.name, String(l.m3h), l.ports || '–', l.duct ? `Ø${l.duct}` : '–']) },
  };
}

function floorSection(project: Project): PrepSection {
  const { heaviest } = sitePrepOf(project);
  const cnc = project.objects.some((o) => {
    const group = catalogItem(o.assetId)?.group;
    return !o.hidden && (group === 'nesting' || group === 'drill');
  });
  return {
    id: 'floor',
    title: 'พื้นและหน้างาน',
    rows: [{ label: 'เครื่องหนักสุด', value: heaviest ? `${heaviest.name} ${ton(heaviest.weight)}` : 'ไม่มีข้อมูล' }],
    todo: [
      'พื้นคอนกรีตเรียบและได้ระดับ',
      'ให้วิศวกรโครงสร้างตรวจพื้นรับน้ำหนัก',
      ...(cnc ? ['LAN หรือ USB สำหรับส่งไฟล์เข้าเครื่อง CNC'] : []),
      'ถังดับเพลิงใกล้เครื่องจักร',
    ],
  };
}

function accessSection(project: Project): PrepSection {
  const list = deliveryFor(project);
  const bad = list.filter((d) => d.status !== 'ok');
  const longest = list.length ? list.reduce((a, b) => (b.crate.l > a.crate.l ? b : a)) : null;
  const rows: PrepRow[] = [{ label: 'ขนเข้าได้', value: `${list.length - bad.length} / ${list.length} เครื่อง`, warn: bad.length > 0 }];
  if (longest) rows.push({ label: 'ลังยาวสุด', value: `${longest.name} ${metres(longest.crate.w)}×${metres(longest.crate.l)}×${metres(longest.crate.h)} ม.` });
  for (const d of bad) rows.push({ label: d.name, value: d.text, warn: true });
  return { id: 'access', title: 'ทางขนเข้า', rows, todo: ['เตรียมโฟล์กลิฟต์หรือเครนวันส่งเครื่อง', 'เคลียร์ทางจากประตูถึงจุดวางเครื่อง'] };
}

/** Empty until the plan has a machine on it. */
export function prepSheet(project: Project): PrepSection[] {
  if (!project.objects.some((o) => isMachine(o) && !o.hidden)) return [];
  return [powerSection(project), airSection(project), dustSection(project), floorSection(project), accessSection(project)].filter((s): s is PrepSection => !!s);
}
