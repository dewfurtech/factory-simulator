import { useState } from 'react';
import { catalogItem, needsOperator, useOf } from '../model/catalog';
import { newId } from '../model/id';
import { fmtClock } from '../model/project';
import { ROLE_IDS, ROLES } from '../model/roles';
import type { Project, RoleId, Staff } from '../model/types';
import { applyEdit, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { SelectField, TextField, TimeField } from './fields';

const NAMES = ['สมศักดิ์', 'วรรณา', 'ประยุทธ', 'กมล', 'สุดา', 'อนันต์', 'จิราพร', 'ชัยวัฒน์', 'นภา', 'ปิยะ', 'รัตนา', 'สมพงษ์', 'อำไพ', 'ธีระ', 'บุญมี', 'ลำดวน', 'เกศินี', 'ศักดิ์ชัย', 'ปรีชา', 'มณี'];

const editStaff = (id: string, recipe: (s: Staff) => void) =>
  applyEdit((d) => {
    const s = d.staff.find((x) => x.id === id);
    if (s) recipe(s);
  });

/** Objects someone in this role could work at, for the station picker. */
function stationsFor(p: Project, role: RoleId) {
  const uses = new Set(ROLES[role].station);
  return p.objects.filter((o) => {
    const u = useOf(o);
    return u && (uses.has(u) || (role === 'operator' && u === 'machine')) && (u !== 'machine' || needsOperator(o));
  });
}

/** A starting crew sized to the plan: one operator per machine, technicians, store, office, reception, cleaning. */
export function suggestStaff(p: Project): Staff[] {
  const machines = p.objects.filter(needsOperator);
  const desks = p.objects.filter((o) => useOf(o) === 'desk');
  const out: Staff[] = [];
  let n = 0;
  const add = (role: RoleId, stationId?: string) => out.push({ id: newId('s'), name: NAMES[n++ % NAMES.length] + (n > NAMES.length ? ` ${Math.ceil(n / NAMES.length)}` : ''), role, ...(stationId && { stationId: stationId as never }) });
  add('manager', desks[0]?.id);
  if (machines.length > 3) add('supervisor', desks[1]?.id);
  for (const m of machines) add('operator', m.id);
  for (let i = 0; i < Math.max(1, Math.round(machines.length / 5)); i++) add('technician');
  if (p.objects.some((o) => useOf(o) === 'storage')) for (let i = 0; i < Math.max(1, Math.round(machines.length / 6)); i++) add('warehouse');
  if (p.objects.some((o) => useOf(o) === 'qc')) add('qc');
  if (p.objects.some((o) => useOf(o) === 'reception')) add('reception');
  for (let i = 0; i < Math.min(2, Math.max(1, desks.length - 2)); i++) add('sales', desks[2 + i]?.id);
  if (desks.length > 4) add('admin', desks[4].id);
  add('cleaner');
  return out;
}

export function StaffPanel() {
  const project = useProject((s) => s.project!);
  const [open, setOpen] = useState<string | null>(null);
  const [role, setRole] = useState<RoleId>('operator');
  const counts = ROLE_IDS.map((r) => ({ r, n: project.staff.filter((s) => s.role === r).length })).filter((x) => x.n);

  return (
    <div className="dock-body" data-testid="staff">
      <div className="staff-head">
        <div className="staff-total">
          <b>{project.staff.length}</b> คน · เข้างาน {fmtClock(project.schedule.start)}–{fmtClock(project.schedule.end)}
        </div>
        <div className="chips">
          {counts.map(({ r, n }) => (
            <span key={r} className="chip" style={{ ['--c' as string]: ROLES[r].color }}>
              <i />
              {ROLES[r].label} {n}
            </span>
          ))}
        </div>
        <div className="row gap">
          <select value={role} onChange={(e) => setRole(e.target.value as RoleId)} aria-label="ตำแหน่ง">
            {ROLE_IDS.map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              const id = newId('s');
              applyEdit((d) => void d.staff.push({ id, name: NAMES[d.staff.length % NAMES.length], role }));
              setOpen(id);
            }}
            data-testid="staff-add"
          >
            <Icon name="plus" /> เพิ่มคน
          </button>
        </div>
        {project.staff.length === 0 && (
          <button className="btn btn-sm" onClick={() => applyEdit((d) => void (d.staff = suggestStaff(d)))} data-testid="staff-suggest">
            สร้างทีมงานอัตโนมัติตามผัง
          </button>
        )}
      </div>
      <div className="dock-scroll">
        {project.staff.map((s) => {
          const station = s.stationId ? project.objects.find((o) => o.id === s.stationId) : undefined;
          const expanded = open === s.id;
          return (
            <div key={s.id} className={`staff-row${expanded ? ' open' : ''}${s.absent ? ' absent' : ''}`}>
              <button className="staff-line" onClick={() => setOpen(expanded ? null : s.id)}>
                <span className="avatar" style={{ background: ROLES[s.role].color }}>
                  {s.name.slice(0, 1)}
                </span>
                <span className="grow">
                  <b>{s.name}</b>
                  <small>
                    {ROLES[s.role].label}
                    {station ? ` · ${station.name}` : ''}
                    {s.absent ? ' · ลา' : ''}
                  </small>
                </span>
                <Icon name={expanded ? 'back' : 'forward'} />
              </button>
              {expanded && (
                <div className="staff-edit">
                  <TextField label="ชื่อ" value={s.name} onChange={(v) => editStaff(s.id, (x) => void (x.name = v))} />
                  <SelectField label="ตำแหน่ง" value={s.role} options={ROLE_IDS.map((r) => ({ id: r, label: ROLES[r].label }))} onChange={(v) => editStaff(s.id, (x) => void ((x.role = v), (x.stationId = null)))} />
                  <p className="muted small">{ROLES[s.role].does}</p>
                  <SelectField
                    label="ประจำที่"
                    value={(s.stationId ?? '') as string}
                    options={[{ id: '', label: 'อัตโนมัติ' }, ...stationsFor(project, s.role).map((o) => ({ id: o.id as string, label: `${o.name}${project.staff.some((x) => x.id !== s.id && x.stationId === o.id) ? ' (มีคนแล้ว)' : ''}` }))]}
                    onChange={(v) => editStaff(s.id, (x) => void (x.stationId = (v || null) as never))}
                  />
                  <div className="two">
                    <TimeField label="เข้างาน" value={s.start ?? project.schedule.start} onChange={(v) => editStaff(s.id, (x) => void (x.start = v))} />
                    <TimeField label="เลิกงาน" value={s.end ?? project.schedule.end} onChange={(v) => editStaff(s.id, (x) => void (x.end = v))} />
                  </div>
                  <div className="row gap">
                    <label className="check">
                      <input type="checkbox" checked={!!s.absent} onChange={(e) => editStaff(s.id, (x) => void (x.absent = e.target.checked || undefined))} /> ลาวันนี้
                    </label>
                    <span className="grow" />
                    {station && (
                      <button className="btn btn-sm btn-ghost" onClick={() => useUi.getState().set({ selection: { kind: 'object', id: station.id } })}>
                        ดูที่ประจำ
                      </button>
                    )}
                    <button className="btn btn-sm btn-danger" onClick={() => applyEdit((d) => void (d.staff = d.staff.filter((x) => x.id !== s.id)))}>
                      ลบ
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {project.staff.length > 0 && (
          <div className="dock-foot">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (confirm('แทนที่ทีมงานทั้งหมดด้วยทีมที่สร้างตามผัง?')) applyEdit((d) => void (d.staff = suggestStaff(d)));
              }}
            >
              สร้างทีมงานใหม่ตามผัง
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const stationLabel = (p: Project, s: Staff) => {
  const o = s.stationId ? p.objects.find((x) => x.id === s.stationId) : undefined;
  return o ? `${o.name} (${catalogItem(o.assetId)?.label ?? ''})` : 'อัตโนมัติ';
};
