import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtArea, fmtLen, fmtSize } from '../format';
import { areaStats, planAreas } from '../model/areas';
import { aisleLength, planAisles } from '../model/aisles';
import { isMachine } from '../model/catalog';
import { onLevel, viewLevel } from '../model/levels';
import { wallLength } from '../model/plan';
import type { Id, LayerFlags, OpeningKind, Project } from '../model/types';
import { applyEdit, useEditProject } from '../store/project';
import { useUi, type Selection } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';

type Flag = keyof LayerFlags;
type Group = 'room' | 'aisle' | 'area' | 'wall' | 'opening' | 'column' | 'machine' | 'equipment';

const GROUP_LABEL: Record<Group, string> = {
  room: 'ห้อง / โซน',
  aisle: 'ทางเดิน / ทางรถ',
  area: 'พื้นที่',
  wall: 'ผนัง',
  opening: 'ประตู / หน้าต่าง',
  column: 'เสา',
  machine: 'เครื่องจักร',
  equipment: 'อุปกรณ์',
};
const GROUP_ORDER: Group[] = ['room', 'aisle', 'area', 'wall', 'opening', 'column', 'machine', 'equipment'];
const OPENING_LABEL: Record<OpeningKind, string> = { door: 'ประตู', window: 'หน้าต่าง', opening: 'ช่องเปิด' };

interface Row {
  sel: Selection;
  name: string;
  note: string;
  flags: LayerFlags | null;
}

/** Everything on the edited floor, grouped the way the layers panel lists it. */
function rows(p: Project): Record<Group, Row[]> {
  const { plan } = p;
  const out: Record<Group, Row[]> = { room: [], aisle: [], area: [], wall: [], opening: [], column: [], machine: [], equipment: [] };
  for (const r of Object.values(plan.rooms)) out.room.push({ sel: { kind: 'room', id: r.id }, name: r.name || 'ห้อง', note: r.outdoor ? 'กลางแจ้ง' : '', flags: r });
  for (const a of planAisles(plan))
    out.aisle.push({ sel: { kind: 'aisle', id: a.id }, name: a.name || 'ทางเดิน', note: `${fmtLen(a.width)} × ${fmtLen(aisleLength(a))}`, flags: a });
  for (const a of planAreas(plan)) out.area.push({ sel: { kind: 'area', id: a.id }, name: a.name || 'พื้นที่', note: fmtArea(areaStats(a).area), flags: a });
  let n = 0;
  for (const w of Object.values(plan.walls))
    out.wall.push({ sel: { kind: 'wall', id: w.id }, name: `${w.glass ? 'ผนังกระจก' : 'ผนัง'} ${++n}`, note: fmtLen(wallLength(plan, w)), flags: w });
  const counts: Record<OpeningKind, number> = { door: 0, window: 0, opening: 0 };
  for (const o of Object.values(plan.openings)) {
    // An opening follows its wall's layer flags: it is hidden or locked along with the wall.
    if (!plan.walls[o.wallId]) continue;
    out.opening.push({ sel: { kind: 'opening', id: o.id }, name: `${OPENING_LABEL[o.kind]} ${++counts[o.kind]}`, note: fmtLen(o.width), flags: null });
  }
  let c = 0;
  for (const col of Object.values(p.columns))
    out.column.push({ sel: { kind: 'column', id: col.id }, name: `เสา ${++c}`, note: col.shape === 'round' ? `Ø ${fmtLen(col.w)}` : fmtSize(col.w, col.d), flags: col });
  const level = viewLevel(p);
  for (const o of p.objects) {
    if (!onLevel(o, level)) continue;
    out[isMachine(o) ? 'machine' : 'equipment'].push({ sel: { kind: 'object', id: o.id }, name: o.name, note: fmtSize(o.size.w, o.size.d), flags: o });
  }
  return out;
}

/** Flips a layer flag on one thing, or on every listed thing of a group when ids has several. */
function setFlag(sels: Selection[], flag: Flag, on: boolean) {
  const ui = useUi.getState();
  applyEdit((d) => {
    for (const sel of sels) {
      const x: LayerFlags | undefined =
        sel.kind === 'object'
          ? d.objects.find((o) => o.id === sel.id)
          : sel.kind === 'column'
            ? d.columns[sel.id]
            : sel.kind === 'wall'
              ? d.plan.walls[sel.id]
              : sel.kind === 'room'
                ? d.plan.rooms[sel.id]
                : sel.kind === 'area'
                  ? d.plan.areas?.[sel.id]
                  : sel.kind === 'aisle'
                    ? d.plan.aisles?.[sel.id]
                    : undefined;
      if (!x) continue;
      if (on) x[flag] = true;
      else delete x[flag];
    }
  });
  // Something that just went out of sight or got locked can't stay picked.
  if (on && ui.selection && sels.some((s) => s.kind === ui.selection!.kind && s.id === ui.selection!.id)) ui.set({ selection: null });
}

function FlagButton({ flag, on, onClick, all }: { flag: Flag; on: boolean; onClick: () => void; all?: boolean }) {
  const tip = flag === 'hidden' ? (on ? 'แสดง' : 'ซ่อน') : on ? 'ปลดล็อก' : 'ล็อก (เลือกและแก้ไม่ได้)';
  return (
    <button
      className={`lyr-flag${on ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={all ? `${tip}ทั้งกลุ่ม` : tip}
      aria-pressed={on}
      aria-label={all ? `${tip}ทั้งกลุ่ม` : tip}
    >
      <Icon name={flag === 'hidden' ? (on ? 'eyeOff' : 'eye') : on ? 'lock' : 'unlock'} />
    </button>
  );
}

const sameSel = (a: Selection | null, b: Selection) => !!a && a.kind === b.kind && a.id === b.id;

/** Everything on the edited floor by kind: click picks it, double-click brings the views to it, eye and lock set its layer flags. */
export function LayersPanel() {
  const project = useEditProject()!;
  const selection = useUi((s) => s.selection);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<Group>>(() => new Set());
  const groups = useMemo(() => rows(project), [project]);
  const needle = q.trim().toLowerCase();
  const toggleGroup = (g: Group) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  const total = GROUP_ORDER.reduce((n, g) => n + groups[g].length, 0);
  return (
    <div className="dock-body" data-testid="layers">
      <div className="lyr-head">
        <Icon name="layers" />
        <b>เลเยอร์</b>
        <span className="muted">{total} รายการ</span>
      </div>
      <div className="search">
        <Icon name="search" />
        <input placeholder="ค้นหาชื่อ" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="dock-scroll lyr-scroll">
        {total === 0 && <div className="cat-none muted">ยังไม่มีอะไรในแปลนชั้นนี้</div>}
        {GROUP_ORDER.map((g) => {
          const all = groups[g];
          const shown = needle ? all.filter((r) => r.name.toLowerCase().includes(needle) || r.note.toLowerCase().includes(needle)) : all;
          if (!shown.length) return null;
          const flagged = all.filter((r) => r.flags);
          const allHidden = flagged.length > 0 && flagged.every((r) => r.flags!.hidden);
          const allLocked = flagged.length > 0 && flagged.every((r) => r.flags!.locked);
          const open = needle ? true : !closed.has(g);
          return (
            <section key={g} className="lyr-group" data-testid={`layer-${g}`}>
              <div className="lyr-group-head" onClick={() => toggleGroup(g)}>
                <span className={`lyr-caret${open ? ' open' : ''}`}>
                  <Icon name="forward" />
                </span>
                <span className="lyr-group-name">{GROUP_LABEL[g]}</span>
                <span className="muted">{all.length}</span>
                {flagged.length > 0 && (
                  <span className="lyr-flags">
                    <FlagButton
                      flag="hidden"
                      on={allHidden}
                      all
                      onClick={() =>
                        setFlag(
                          flagged.map((r) => r.sel),
                          'hidden',
                          !allHidden,
                        )
                      }
                    />
                    <FlagButton
                      flag="locked"
                      on={allLocked}
                      all
                      onClick={() =>
                        setFlag(
                          flagged.map((r) => r.sel),
                          'locked',
                          !allLocked,
                        )
                      }
                    />
                  </span>
                )}
              </div>
              {open && shown.map((r) => <LayerRow key={r.sel.id} row={r} selected={sameSel(selection, r.sel)} />)}
            </section>
          );
        })}
      </div>
      <div className="dock-foot muted">คลิกเพื่อเลือก · ดับเบิลคลิกเพื่อไปดูในแปลน / 3D</div>
    </div>
  );
}

function LayerRow({ row, selected }: { row: Row; selected: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) el.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const f = row.flags;
  return (
    <div
      ref={el}
      className={`lyr-row${selected ? ' on' : ''}${f?.hidden ? ' hidden' : ''}`}
      onClick={() => useUi.getState().set({ selection: row.sel })}
      onDoubleClick={() => useUi.getState().goTo(row.sel)}
      title="คลิกเพื่อเลือก · ดับเบิลคลิกเพื่อไปดู"
      data-testid={`layer-row-${row.sel.id as Id}`}
    >
      <span className="lyr-name">{row.name}</span>
      <span className="lyr-note muted">{row.note}</span>
      {f && (
        <span className="lyr-flags">
          <FlagButton flag="hidden" on={!!f.hidden} onClick={() => setFlag([row.sel], 'hidden', !f.hidden)} />
          <FlagButton flag="locked" on={!!f.locked} onClick={() => setFlag([row.sel], 'locked', !f.locked)} />
        </span>
      )}
    </div>
  );
}
