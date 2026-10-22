import { addAisle, AISLE_KINDS, standardWidth } from '../model/aisles';
import { autoAisles } from '../model/autoAisles';
import { aisleNet } from '../model/aisleJoins';
import type { AisleKind } from '../model/types';
import { fmtLen } from '../format';
import { editProject, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { confirmDialog } from '../ui/Dialog';

/** Drops every aisle the planner laid on the edited floor; hand-drawn ones stay. */
export function clearAutoAisles(): number {
  const ids = Object.values(editProject().plan.aisles ?? {})
    .filter((a) => a.auto)
    .map((a) => a.id);
  if (!ids.length) return 0;
  useProject.getState().apply((d) => {
    for (const id of ids) delete d.plan.aisles?.[id];
  });
  const sel = useUi.getState().selection;
  if (sel?.kind === 'aisle' && ids.includes(sel.id)) useUi.getState().set({ selection: null });
  return ids.length;
}

/**
 * Lays the aisles out for the edited floor, replacing the ones laid last time, then says what it did: keeping
 * them is one click, and backing out puts the floor back as it was.
 */
export async function runAutoAisles(trunk: AisleKind): Promise<void> {
  const res = autoAisles(editProject(), { trunk });
  if (!res.rooms) {
    await confirmDialog({
      title: 'ยังจัดทางเดินอัตโนมัติไม่ได้',
      message: 'ต้องมีห้องหรือโซนประเภทพื้นที่ผลิต คลัง รับ-ส่งสินค้า ซ่อมบำรุง QC หรืออื่น ๆ ที่มีเครื่องจักร ชั้นวาง หรือโต๊ะงานอยู่ข้างใน',
      ok: 'เข้าใจแล้ว',
    });
    return;
  }
  // One edit, so one undo step takes it all back.
  useProject.getState().apply((d) => {
    for (const a of Object.values(d.plan.aisles ?? {})) if (a.auto) delete d.plan.aisles![a.id];
    for (const a of res.aisles) addAisle(d.plan, a.points, { ...a, auto: true });
  });
  useUi.getState().set({ selection: null, boxed: [] });

  const lines = [
    `วางทางเดิน ${res.aisles.length} เส้น ใน ${res.rooms} ห้อง · ทางหลัก ${res.mains} เส้น (${AISLE_KINDS[trunk].label} กว้าง ${fmtLen(trunk === 'walk' ? 1200 : standardWidth(trunk))}) · ทางเข้าเครื่อง ${res.reached} จุด (กว้าง ${fmtLen(standardWidth('walk'))})`,
  ];
  if (res.narrowed) lines.push(`ทางหลัก ${res.narrowed} เส้นแคบลงเป็นทางเดินคน เพราะที่ไม่พอ`);
  lines.push('ประตูที่แคบกว่ารถ ได้ทางเดินคนแทน');
  if (res.unreached.length)
    lines.push(
      `เข้าไม่ถึง ${res.unreached.length} ชิ้น (ไม่มีช่องว่างพอ): ${res.unreached
        .slice(0, 6)
        .map((u) => u.name)
        .join(', ')}${res.unreached.length > 6 ? ' …' : ''}`,
    );
  const net = aisleNet(editProject().plan);
  if (net.crossings.length || net.mirrors.length)
    lines.push(`ทางม้าลายจุดคนข้ามทางรถ ${net.crossings.length} จุด · กระจกนูนที่ทางแยก/โค้งรถยก ${net.mirrors.length} จุด (กฎกระทรวงฯ 2564 ข้อ 38)`);
  lines.push('ความกว้างตาม ASR A1.8 (เยอรมนี) · ทุกเส้นปรับเองได้ที่แผงขวา');
  const keep = await confirmDialog({ title: 'จัดทางเดินอัตโนมัติแล้ว', message: lines.join('\n'), ok: 'เก็บไว้' });
  if (!keep) useProject.getState().undo();
  else if (res.unreached.length) useUi.getState().set({ selection: { kind: 'object', id: res.unreached[0].id } });
}
