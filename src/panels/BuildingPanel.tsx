import { AISLE_ITEMS, AREA_ITEMS, COLUMN_ITEMS, Icon, OPENING_ITEMS, ROOM_ITEMS, setTool, WALL_ITEMS, type Item } from '../editor2d/Toolbar';
import { useState } from 'react';
import { buildQuick, hasBuilding, QUICK_DEFAULT, type QuickSpec } from '../model/quickBuilding';
import { applyEdit, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { confirmDialog } from '../ui/Dialog';

const QUICK_FIELDS: { key: Exclude<keyof QuickSpec, 'rollingDoors'>; label: string; step: number }[] = [
  { key: 'width', label: 'กว้าง', step: 1 },
  { key: 'length', label: 'ยาว', step: 1 },
  { key: 'height', label: 'สูง', step: 0.5 },
  { key: 'columnSpan', label: 'เสาทุก', step: 1 },
];

/** The hall from its size in metres: the quickest way to a plan when the customer has no drawing to upload. */
function QuickBuild() {
  const built = useProject((s) => hasBuilding(s.project!));
  const [open, setOpen] = useState(!built);
  const [spec, setSpec] = useState<QuickSpec>(QUICK_DEFAULT);
  if (!open)
    return (
      <button className="btn wide" onClick={() => setOpen(true)} data-testid="quick-open">
        <Icon name="rect" />
        สร้างอาคารจากขนาด
      </button>
    );
  const make = async () => {
    if (built && !(await confirmDialog({ title: 'สร้างอาคารใหม่แทนของเดิม', message: 'ผนัง ประตู และเสาเดิมจะถูกแทนที่ เครื่องจักรยังอยู่ที่เดิม', ok: 'สร้างใหม่', danger: true }))) return;
    applyEdit((d) => buildQuick(d, spec));
    useUi.getState().set({ view: '2d', selection: null, fitN: useUi.getState().fitN + 1 });
    setOpen(false);
  };
  return (
    <div className="quick-build" data-testid="quick-build">
      <div className="qb-grid">
        {QUICK_FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input
              type="number"
              min={f.key === 'columnSpan' ? 0 : 3}
              step={f.step}
              value={spec[f.key]}
              onChange={(e) => setSpec({ ...spec, [f.key]: Math.max(0, parseFloat(e.target.value) || 0) })}
              data-testid={`quick-${f.key}`}
            />
            <em>ม.</em>
          </label>
        ))}
      </div>
      <div className="qb-doors">
        <span>ประตูม้วน</span>
        {[0, 1, 2].map((n) => (
          <button key={n} className={spec.rollingDoors === n ? 'on' : ''} onClick={() => setSpec({ ...spec, rollingDoors: n })}>
            {n}
          </button>
        ))}
      </div>
      <p className="qb-sum">
        {spec.width} × {spec.length} ม. · {Math.round(spec.width * spec.length).toLocaleString('en-US')} ตร.ม.{spec.columnSpan ? '' : ' · ไม่มีเสา'}
      </p>
      <div className="qb-actions">
        {built && (
          <button className="btn btn-sm" onClick={() => setOpen(false)}>
            ยกเลิก
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => void make()} data-testid="quick-make">
          สร้างอาคาร
        </button>
      </div>
    </div>
  );
}

function Tiles({ items }: { items: Item[] }) {
  const tool = useUi((s) => s.tool);
  return (
    <div className="tile-grid">
      {items.map((i) => (
        <button key={i.testId} className={`tile${i.isOn(tool) ? ' on' : ''}`} onClick={() => setTool(i.tool())} data-testid={i.testId}>
          <Icon name={i.id} />
          <span>{i.label}</span>
        </button>
      ))}
    </div>
  );
}

function Switch({ label, on, onClick, testId }: { label: string; on: boolean; onClick: () => void; testId: string }) {
  return (
    <button className={`switch-row${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={onClick} data-testid={testId}>
      <span>{label}</span>
      <i />
    </button>
  );
}

/** The customer's building: their plan as a picture, then the walls, doors and columns drawn or corrected over it. */
export function BuildingPanel() {
  const hasPlan = useProject((s) => !!s.project!.underlay);
  const open = useUi((s) => s.underlayOpen);
  const walkways = useUi((s) => !s.walkwaysHidden);
  const safety = useUi((s) => s.safetyAll);
  const areas = useUi((s) => !s.areasHidden);
  const set = useUi.getState().set;
  return (
    <div className="dock-body" data-testid="building">
      <h3 className="dock-title">อาคาร</h3>
      <div className="dock-scroll">
        <button className={`btn wide${hasPlan ? '' : ' btn-primary'}`} onClick={() => set({ underlayOpen: !open, view: '2d' })} aria-pressed={open} data-testid="underlay-menu">
          <Icon name="underlay" />
          {hasPlan ? 'แปลนลูกค้า' : 'อัปโหลดแปลนลูกค้า'}
        </button>
        <QuickBuild />
        <h5 className="adv-h">ห้องและผนัง</h5>
        <Tiles items={[...ROOM_ITEMS, ...WALL_ITEMS]} />
        <h5 className="adv-h">ประตู หน้าต่าง</h5>
        <Tiles items={OPENING_ITEMS} />
        <h5 className="adv-h">เสา</h5>
        <Tiles items={COLUMN_ITEMS} />
        <h5 className="adv-h">พื้นที่และทางเดิน</h5>
        <Tiles items={[...AREA_ITEMS, ...AISLE_ITEMS]} />
        <h5 className="adv-h">แสดงบนผัง</h5>
        <Switch label="ทางเดินอัตโนมัติ" on={walkways} onClick={() => set({ walkwaysHidden: walkways })} testId="walkways-auto" />
        <Switch label="ระยะปลอดภัยทุกเครื่อง" on={safety} onClick={() => set({ safetyAll: !safety })} testId="safety-dims-toggle" />
        <Switch label="พื้นที่" on={areas} onClick={() => set({ areasHidden: areas })} testId="areas-hidden" />
        <h5 className="adv-h">ข้อมูล</h5>
        <div className="link-rows">
          <button onClick={() => set({ selection: null, panelOpen: true })} data-testid="panel-toggle">
            <Icon name="props" />
            ตั้งค่าโรงงาน
          </button>
          <button onClick={() => set({ dock: 'layers' })} data-testid="dock-layers">
            <Icon name="layers" />
            รายการทั้งหมดในผัง
          </button>
        </div>
      </div>
    </div>
  );
}
