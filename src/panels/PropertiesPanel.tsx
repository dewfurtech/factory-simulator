import { deg, fmtArea, fmtLen, fmtSize, rad } from '../format';
import { CATALOG, catalogItem, GROUP_LABEL, GROUP_ORDER } from '../model/catalog';
import { DOOR_STYLE_LABEL, isHanded, isSliding } from '../model/openings';
import { checkClearance, issueText } from '../model/clearance';
import { moveCorner, roomStats, setWallAngle, setWallLength, wallDir, wallLength } from '../model/plan';
import { projectFacts } from '../model/project';
import type { Area, Column, DoorStyle, OpeningKind, PlacedObject, Project, ZoneKind } from '../model/types';
import { ZONE_IDS, ZONES, zoneColor } from '../model/zones';
import { AREA_COLORS, areaStats } from '../model/areas';
import { applyEdit, useEditProject } from '../store/project';
import { useUi, type Selection } from '../store/ui';
import { Icon } from '../editor2d/Toolbar';
import { addDoorAt, deleteSelection, duplicateSelection, flipOpeningHinge, flipOpeningSide, rotateObject } from '../editor2d/tools';
import { ColorField, Field, NumberField, SelectField, TextField } from './fields';
import { MachineSpec } from './MachineSpec';

const KIND_LABEL: Record<OpeningKind, string> = { door: 'ประตู', window: 'หน้าต่าง', opening: 'ช่องเปิด' };

/** Names a placed block or machine carries until someone names it: changing the model renames these. */
const PLACEHOLDER_NAMES = new Set(['เครื่องจักร', 'อุปกรณ์', 'เครื่องจักร / อุปกรณ์']);

/** How far a model's footprint is from a block's, either way round (a block's long side may be drawn along y). */
const footprintMiss = (a: { w: number; d: number }, b: { w: number; d: number }) =>
  Math.min(Math.abs(a.w - b.w) + Math.abs(a.d - b.d), Math.abs(a.w - b.d) + Math.abs(a.d - b.w));

/**
 * Which Mastrox machine a block or machine is: a block read off a plan (a footprint with no model) becomes a machine
 * the simulation runs, keeping its place and turn. The models nearest the block's size are offered first.
 */
function MachineModelPicker({ o }: { o: PlacedObject }) {
  const models = CATALOG.filter((c) => c.use === 'machine');
  const nearest = o.assetId === 'box' ? [...models].sort((a, b) => footprintMiss(a.size, o.size) - footprintMiss(b.size, o.size)).slice(0, 3) : [];
  const groups = GROUP_ORDER.map((g) => ({ g, items: models.filter((m) => m.group === g) })).filter((x) => x.items.length);
  const pick = (assetId: string) =>
    applyEdit((d) => {
      const x = d.objects.find((y) => y.id === o.id);
      const next = catalogItem(assetId);
      if (!x || !next) return;
      const was = catalogItem(x.assetId);
      // A block drawn with its long side across: the model is turned to lie the way the block did.
      const across = x.assetId === 'box' && x.size.d > x.size.w && next.size.w > next.size.d;
      if (PLACEHOLDER_NAMES.has(x.name) || x.name === was?.label) x.name = next.label;
      else if (/^เครื่อง \d+$/.test(x.name)) x.name = `${x.name} · ${next.label}`;
      x.assetId = next.id;
      x.size = { ...next.size };
      if (across) x.rotation += Math.PI / 2;
    });
  return (
    <Field label="รุ่นเครื่องจักร">
      <select value={o.assetId === 'box' ? '' : o.assetId} onChange={(e) => e.target.value && pick(e.target.value)} data-testid="machine-model">
        {o.assetId === 'box' && <option value="">— ยังไม่ระบุรุ่น ({fmtSize(o.size.w, o.size.d)}) —</option>}
        {nearest.length > 0 && (
          <optgroup label="ขนาดใกล้เคียงกับในแบบ">
            {nearest.map((m) => (
              <option key={`near-${m.id}`} value={m.id}>
                {m.label} · {fmtSize(m.size.w, m.size.d)}
              </option>
            ))}
          </optgroup>
        )}
        {groups.map(({ g, items }) => (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {fmtSize(m.size.w, m.size.d)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

export function PropertiesPanel() {
  const selection = useUi((s) => s.selection);
  const boxed = useUi((s) => s.boxed);
  const project = useEditProject()!;
  return (
    <aside className="side-panel" data-testid="properties">
      {boxed.length > 0 ? <Multi count={boxed.length} /> : selection ? <SelectionProps sel={selection} project={project} /> : <ProjectProps project={project} />}
    </aside>
  );
}

const closePanel = () => useUi.getState().set({ selection: null, panelOpen: false });

function Header({ icon, title, sub, actions }: { icon: string; title: string; sub?: string; actions?: boolean }) {
  return (
    <div className="panel-head">
      <div className="panel-icon">
        <Icon name={icon} />
      </div>
      <div className="grow">
        <div className="panel-title">{title}</div>
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      {actions && (
        <button className="ib" onClick={deleteSelection} title="ลบ (Delete)" aria-label="ลบ">
          <Icon name="trash" />
        </button>
      )}
      <button className="ib" onClick={closePanel} title="ปิด (Esc)" aria-label="ปิด">
        <Icon name="close" />
      </button>
    </div>
  );
}

function Multi({ count }: { count: number }) {
  return (
    <>
      <Header icon="select" title={`เลือกไว้ ${count} รายการ`} />
      <div className="panel-body">
        <div className="row gap">
          <button className="btn" onClick={duplicateSelection}>
            <Icon name="copy" /> ทำสำเนา
          </button>
          <button className="btn btn-danger" onClick={deleteSelection}>
            <Icon name="trash" /> ลบทั้งหมด
          </button>
        </div>
      </div>
    </>
  );
}

function SelectionProps({ sel, project }: { sel: Selection; project: Project }) {
  const { plan } = project;
  switch (sel.kind) {
    case 'corner': {
      const c = plan.corners[sel.id];
      if (!c) return null;
      return (
        <>
          <Header icon="drawWall" title="มุมผนัง" actions />
          <div className="panel-body two">
            <NumberField label="X" value={c.x} scale={10} suffix="ซม." onChange={(v) => applyEdit((d) => moveCorner(d.plan, sel.id, { x: v, y: c.y }))} />
            <NumberField label="Y" value={c.y} scale={10} suffix="ซม." onChange={(v) => applyEdit((d) => moveCorner(d.plan, sel.id, { x: c.x, y: v }))} />
          </div>
        </>
      );
    }
    case 'wall': {
      const w = plan.walls[sel.id];
      if (!w) return null;
      const dir = wallDir(plan, w);
      const ops = Object.values(plan.openings).filter((o) => o.wallId === w.id);
      const set = (recipe: (x: typeof w) => void) => applyEdit((d) => recipe(d.plan.walls[sel.id]));
      return (
        <>
          <Header icon={w.glass ? 'glassWall' : 'drawWall'} title={w.glass ? 'ผนังกระจก' : 'ผนัง'} sub={fmtLen(wallLength(plan, w))} actions />
          <div className="panel-body">
            <div className="two">
              <NumberField label="ความยาว" value={wallLength(plan, w)} scale={10} suffix="ซม." min={1} onChange={(v) => applyEdit((d) => setWallLength(d.plan, sel.id, v))} />
              <NumberField label="มุม" value={Math.round(deg(Math.atan2(dir.y, dir.x)))} suffix="°" onChange={(v) => applyEdit((d) => setWallAngle(d.plan, sel.id, rad(v)))} />
              <NumberField label="ความหนา" value={w.thickness} scale={10} suffix="ซม." min={1} onChange={(v) => set((x) => void (x.thickness = v))} />
              <NumberField label="ความสูง" value={w.height} scale={10} suffix="ซม." min={10} onChange={(v) => set((x) => void (x.height = v))} />
            </div>
            <label className="check">
              <input type="checkbox" checked={!!w.glass} onChange={(e) => set((x) => void (x.glass = e.target.checked || undefined))} /> ผนังกระจก
            </label>
            <ColorField label="สีผนัง" value={w.color ?? '#eceae5'} onChange={(v) => set((x) => void (x.color = v))} onReset={w.color ? () => set((x) => void delete x.color) : undefined} />
            <button className="btn btn-sm" onClick={() => addDoorAt(null, 0, w.id)} data-testid="wall-add-door">
              + ใส่ประตูกลางผนัง
            </button>
            {ops.length > 0 && (
              <Field label="ช่องเปิดบนผนัง">
                <div className="list">
                  {ops.map((o) => (
                    <button key={o.id} className="list-item" onClick={() => useUi.getState().set({ selection: { kind: 'opening', id: o.id } })}>
                      {KIND_LABEL[o.kind]} {fmtLen(o.width)}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </>
      );
    }
    case 'room': {
      const r = plan.rooms[sel.id];
      if (!r) return null;
      const st = roomStats(plan, r);
      const set = (recipe: (x: typeof r) => void) => applyEdit((d) => recipe(d.plan.rooms[sel.id]));
      const inside = project.objects.filter((o) => {
        const poly = r.cornerIds.map((id) => plan.corners[id]);
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > o.y !== poly[j].y > o.y && o.x < ((poly[j].x - poly[i].x) * (o.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
        return c;
      });
      return (
        <>
          <Header icon="drawRoomRect" title={r.name} sub={`${ZONES[r.zone]?.label ?? ''} · ${fmtArea(st.area)}`} actions />
          <div className="panel-body">
            <TextField label="ชื่อโซน" value={r.name} onChange={(v) => set((x) => void (x.name = v))} />
            <Field label="ประเภทโซน">
              <div className="zone-grid">
                {ZONE_IDS.map((z: ZoneKind) => (
                  <button key={z} className={`zone-chip${r.zone === z ? ' on' : ''}`} onClick={() => set((x) => void ((x.zone = z), delete x.color))} data-testid={`zone-${z}`}>
                    <i style={{ background: ZONES[z].color }} />
                    {ZONES[z].label}
                  </button>
                ))}
              </div>
            </Field>
            <label className="row gap" data-testid="room-outdoor">
              <input type="checkbox" checked={!!r.outdoor} onChange={(e) => set((x) => void (e.target.checked ? (x.outdoor = true) : delete x.outdoor))} />
              <span>ลานนอกอาคาร (ไม่นับเป็นห้องและพื้นที่)</span>
            </label>
            <ColorField label="สีพื้น" value={zoneColor(r)} onChange={(v) => set((x) => void (x.color = v))} onReset={r.color ? () => set((x) => void delete x.color) : undefined} />
            <div className="stats">
              <div>
                <b>{fmtArea(st.area)}</b>
                <span>พื้นที่</span>
              </div>
              <div>
                <b>{fmtSize(st.width, st.depth)}</b>
                <span>ขนาดรวม</span>
              </div>
              <div>
                <b>{inside.length}</b>
                <span>ชิ้นในโซน</span>
              </div>
            </div>
          </div>
        </>
      );
    }
    case 'area': {
      const a = plan.areas?.[sel.id];
      if (!a) return null;
      const st = areaStats(a);
      const set = (recipe: (x: Area) => void) =>
        applyEdit((d) => {
          const x = d.plan.areas?.[sel.id];
          if (x) recipe(x);
        });
      return (
        <>
          <Header icon="areaBox" title={a.name} sub={`พื้นที่ · ${fmtArea(st.area)}`} actions />
          <div className="panel-body">
            <TextField label="ชื่อพื้นที่" value={a.name} onChange={(v) => set((x) => void (x.name = v))} />
            <Field label="สี">
              <div className="color-chips" data-testid="area-colors">
                {AREA_COLORS.map((c) => (
                  <button key={c} type="button" className={`color-chip${a.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set((x) => void (x.color = c))} aria-label={c} aria-pressed={a.color === c} />
                ))}
                <input type="color" value={a.color} onChange={(e) => set((x) => void (x.color = e.target.value))} aria-label="สีอื่น" />
              </div>
            </Field>
            <div className="two">
              <NumberField label="สูง (กล่องใน 3D)" value={a.height} scale={10} suffix="ซม." min={10} onChange={(v) => set((x) => void (x.height = v))} />
            </div>
            <div className="stats">
              <div>
                <b>{fmtArea(st.area)}</b>
                <span>พื้นที่</span>
              </div>
              <div>
                <b>{fmtSize(st.width, st.depth)}</b>
                <span>ขนาดรวม</span>
              </div>
              <div>
                <b>{a.points.length}</b>
                <span>มุม</span>
              </div>
            </div>
            <button className="btn btn-sm" onClick={duplicateSelection} title="Ctrl+D">
              <Icon name="copy" /> ทำสำเนา
            </button>
            <p className="muted small">ลากพื้นที่บนแปลนเพื่อย้าย · ซ่อน/ล็อกได้ที่แผงเลเยอร์ · ปุ่ม "พื้นที่" บนแถบเครื่องมือซ่อนพื้นที่ทั้งหมดได้</p>
          </div>
        </>
      );
    }
    case 'opening': {
      const o = plan.openings[sel.id];
      if (!o) return null;
      const set = (recipe: (x: typeof o) => void) => applyEdit((d) => recipe(d.plan.openings[sel.id]));
      return (
        <>
          <Header icon={o.kind === 'window' ? 'window' : o.kind === 'opening' ? 'opening' : 'door'} title={KIND_LABEL[o.kind]} sub={fmtLen(o.width)} actions />
          <div className="panel-body">
            <SelectField label="ชนิด" value={o.kind} options={(['door', 'window', 'opening'] as OpeningKind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))} onChange={(v) => set((x) => void ((x.kind = v), (x.sill = v === 'window' ? 900 : 0)))} />
            {o.kind === 'door' && (
              <SelectField label="แบบประตู" value={o.doorStyle ?? 'swing'} options={(Object.keys(DOOR_STYLE_LABEL) as DoorStyle[]).map((k) => ({ id: k, label: DOOR_STYLE_LABEL[k] }))} onChange={(v) => set((x) => void (x.doorStyle = v))} />
            )}
            <div className="two">
              <NumberField label="กว้าง" value={o.width} scale={10} suffix="ซม." min={30} onChange={(v) => set((x) => void (x.width = v))} />
              <NumberField label="สูง" value={o.height} scale={10} suffix="ซม." min={30} onChange={(v) => set((x) => void (x.height = v))} />
              {o.kind === 'window' && <NumberField label="สูงจากพื้น" value={o.sill} scale={10} suffix="ซม." min={0} onChange={(v) => set((x) => void (x.sill = v))} />}
              <NumberField label="ระยะจากปลายผนัง" value={o.offset} scale={10} suffix="ซม." onChange={(v) => set((x) => void (x.offset = v))} />
            </div>
            {o.kind === 'door' && (
              <Field label="ทิศการเปิด">
                <div className="row gap">
                  <button className="btn btn-sm" onClick={() => flipOpeningSide(o.id)} title="G" data-testid="door-flip-side">
                    สลับฝั่งเปิด (เข้า/ออก)
                  </button>
                  {isHanded(o.doorStyle) && (
                    <button className="btn btn-sm" onClick={() => flipOpeningHinge(o.id)} title="F" data-testid="door-flip-hinge">
                      {isSliding(o.doorStyle) ? 'สลับทางเลื่อน' : 'สลับด้านบานพับ'}
                    </button>
                  )}
                </div>
              </Field>
            )}
            {o.kind !== 'window' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!o.entrance}
                  onChange={(e) =>
                    applyEdit((d) => {
                      for (const x of Object.values(d.plan.openings)) delete x.entrance;
                      if (e.target.checked) d.plan.openings[sel.id].entrance = true;
                    })
                  }
                  data-testid="entrance-toggle"
                />{' '}
                ทางเข้า-ออกหลัก
              </label>
            )}
          </div>
        </>
      );
    }
    case 'column': {
      const c = project.columns[sel.id];
      if (!c) return null;
      const set = (recipe: (x: Column) => void) => applyEdit((d) => recipe(d.columns[sel.id]));
      return (
        <>
          <Header icon={c.shape === 'round' ? 'columnRound' : 'column'} title="เสา" sub={c.shape === 'round' ? `Ø${c.w / 10} ซม.` : `${c.w / 10}×${c.d / 10} ซม.`} actions />
          <div className="panel-body">
            <SelectField label="รูปทรง" value={c.shape} options={[{ id: 'rect', label: 'เหลี่ยม' }, { id: 'round', label: 'กลม' }]} onChange={(v) => set((x) => void ((x.shape = v), v === 'round' && (x.d = x.w)))} />
            <div className="two">
              <NumberField label={c.shape === 'round' ? 'เส้นผ่านศูนย์กลาง' : 'กว้าง'} value={c.w} scale={10} suffix="ซม." min={5} onChange={(v) => set((x) => void ((x.w = v), x.shape === 'round' && (x.d = v)))} />
              {c.shape === 'rect' && <NumberField label="ลึก" value={c.d} scale={10} suffix="ซม." min={5} onChange={(v) => set((x) => void (x.d = v))} />}
              <NumberField label="สูง" value={c.h} scale={10} suffix="ซม." min={10} onChange={(v) => set((x) => void (x.h = v))} />
              <NumberField label="หมุน" value={Math.round(deg(c.rotation))} suffix="°" onChange={(v) => set((x) => void (x.rotation = rad(v)))} />
              <NumberField label="X" value={c.x} scale={10} suffix="ซม." onChange={(v) => set((x) => void (x.x = v))} />
              <NumberField label="Y" value={c.y} scale={10} suffix="ซม." onChange={(v) => set((x) => void (x.y = v))} />
            </div>
            <button className="btn btn-sm" onClick={duplicateSelection}>
              <Icon name="copy" /> ทำสำเนา (Ctrl+D)
            </button>
          </div>
        </>
      );
    }
    case 'object': {
      const o = project.objects.find((x) => x.id === sel.id);
      if (!o) return null;
      const item = catalogItem(o.assetId);
      const set = (recipe: (x: PlacedObject) => void) =>
        applyEdit((d) => {
          const x = d.objects.find((y) => y.id === sel.id);
          if (x) recipe(x);
        });
      const machine = item?.use === 'machine';
      const issues = checkClearance(project).get(o.id) ?? [];
      return (
        <>
          <Header icon={machine ? 'machine' : 'box'} title={o.name} sub={item?.label} actions />
          <div className="panel-body">
            {issues.length > 0 && (
              <ul className="issues" data-testid="object-issues">
                {issues.map((i, k) => (
                  <li key={k}>{issueText(i)}</li>
                ))}
              </ul>
            )}
            {machine ? <MachineSpec assetId={o.assetId} placed={o.size} /> : item?.summary && <p className="muted small">{item.summary}</p>}
            {(machine || o.assetId === 'box') && <MachineModelPicker o={o} />}
            <h5>บนผัง</h5>
            <TextField label="ชื่อ" value={o.name} onChange={(v) => set((x) => void (x.name = v))} />
            <div className="two">
              <NumberField label="X" value={o.x} scale={10} suffix="ซม." onChange={(v) => set((x) => void (x.x = v))} />
              <NumberField label="Y" value={o.y} scale={10} suffix="ซม." onChange={(v) => set((x) => void (x.y = v))} />
              <NumberField label="หมุน" value={Math.round(deg(o.rotation))} suffix="°" onChange={(v) => set((x) => void (x.rotation = rad(v)))} />
            </div>
            <div className="row gap">
              <button className="btn btn-sm" onClick={() => rotateObject(o.id, Math.PI / 2)} title="R">
                <Icon name="rotate" /> หมุน 90°
              </button>
              <button className="btn btn-sm" onClick={duplicateSelection} title="Ctrl+D">
                <Icon name="copy" /> ทำสำเนา
              </button>
            </div>
            {!machine && (
              <div className="two">
                <NumberField label="กว้าง" value={o.size.w} scale={10} suffix="ซม." min={10} onChange={(v) => set((x) => void (x.size.w = v))} />
                <NumberField label="ลึก" value={o.size.d} scale={10} suffix="ซม." min={10} onChange={(v) => set((x) => void (x.size.d = v))} />
                <NumberField label="สูง" value={o.size.h} scale={10} suffix="ซม." min={1} onChange={(v) => set((x) => void (x.size.h = v))} />
              </div>
            )}
          </div>
        </>
      );
    }
  }
}

/** With nothing selected: the factory's own name and totals. */
function ProjectProps({ project }: { project: Project }) {
  const facts = projectFacts(project);
  const tool = useUi((s) => s.tool);
  const issues = checkClearance(project);
  const troubled = project.objects.filter((o) => issues.has(o.id));
  return (
    <>
      <div className="panel-head">
        <div className="panel-icon">
          <Icon name="factory" />
        </div>
        <div className="grow">
          <div className="panel-title">{project.name}</div>
          <div className="panel-sub">ตั้งค่าโรงงาน</div>
        </div>
        <button className="ib" onClick={closePanel} title="ปิด (Esc)" aria-label="ปิด">
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">
        <div className="stats">
          <div>
            <b>{(facts.area / 1e6).toFixed(0)} ม²</b>
            <span>พื้นที่</span>
          </div>
          <div>
            <b>{facts.rooms}</b>
            <span>โซน</span>
          </div>
          <div>
            <b>{facts.machines}</b>
            <span>เครื่องจักร</span>
          </div>
        </div>
        <TextField label="ชื่อโครงการ" value={project.name} onChange={(v) => applyEdit((d) => void (d.name = v))} />
        {tool.kind === 'columnGrid' && (
          <NumberField label="ระยะห่างเสา (ตาราง)" value={tool.spacing} scale={1000} step={0.5} suffix="ม." min={1} onChange={(v) => useUi.getState().set({ tool: { ...tool, spacing: v } })} />
        )}
        <Field label={troubled.length ? `ตรวจผัง: ${troubled.length} ชิ้นวางไม่ได้` : 'ตรวจผัง'}>
          {troubled.length ? (
            <div className="list" data-testid="project-issues">
              {troubled.map((o) => (
                <button key={o.id} className="list-item issue" onClick={() => useUi.getState().goTo({ kind: 'object', id: o.id })} title={issues.get(o.id)!.map(issueText).join(' · ')}>
                  {o.name} · {issueText(issues.get(o.id)![0])}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">ไม่พบของซ้อนทับ ทับผนัง สูงเกินเพดาน หรือเครื่องที่ไม่มีที่ยืนทำงาน</p>
          )}
        </Field>
        <p className="muted small">คลิกเครื่องจักร โซน ผนัง ประตู หรือเสาบนแปลน เพื่อดูรายละเอียดและแก้ไข</p>
      </div>
    </>
  );
}
