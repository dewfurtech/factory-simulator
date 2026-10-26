import { useMemo, useState } from 'react';
import { levelOf, levelZ } from '../model/levels';
import type { PlacedObject, PieceColors } from '../model/types';
import { Field, gesture, NumberField, SelectField } from '../panels/fields';
import { applyEdit, useProject } from '../store/project';
import { cabinetParts, MATERIAL_GROUP_TH } from './cabinet/parts';
import { BOARD_MATERIAL_TH, BOARD_MATERIALS, CABINET_KIND_TH, type BoardMaterial, type BoardThickness, type CabinetKind, type CabinetSpecInput } from './cabinet/spec';
import { changeKind, editCabinet, FRONT_CHOICE_TH, frontChoice, withBay, withBayCount, withFront, type FrontChoice } from './cabinet/sync';
import { MaterialGrid, Swatch } from './MaterialPicker';
import { materialOf } from './materials';

/**
 * The right-hand panel of a built-in cabinet: its kind and size, its bays and what fills each, the boards it is cut
 * from, its plinth and top, what its doors and carcass look like, and the parts list worked out from all of that
 * (cabinet/parts.ts). No prices. Every change is one edit of the project, so Ctrl+Z takes it back.
 */
export function CabinetPanel({ o }: { o: PlacedObject }) {
  const spec = o.cabinet!;
  const project = useProject((s) => s.project!);
  const edit = (patch: CabinetSpecInput) =>
    applyEdit((d) => {
      const x = d.objects.find((y) => y.id === o.id);
      if (x) editCabinet(x, patch);
    });
  const floor = levelZ(project, levelOf(o));
  const kinds = (Object.keys(CABINET_KIND_TH) as CabinetKind[]).map((id) => ({ id, label: CABINET_KIND_TH[id] }));
  const boards = BOARD_MATERIALS.map((id) => ({ id, label: BOARD_MATERIAL_TH[id] }));
  const fronts = (Object.keys(FRONT_CHOICE_TH) as FrontChoice[]).map((id) => ({ id, label: FRONT_CHOICE_TH[id] }));

  return (
    <div className="cabinet-panel" data-testid="cabinet-panel">
      <h5>ตู้บิ้วอิน</h5>
      <SelectField
        label="ชนิดตู้"
        value={spec.kind}
        options={kinds}
        onChange={(kind) =>
          applyEdit((d) => {
            const x = d.objects.find((y) => y.id === o.id);
            if (x) changeKind(x, kind, floor);
          })
        }
        testId="cab-kind"
      />
      <div className="two">
        <NumberField label="กว้าง" value={spec.width} scale={10} suffix="ซม." min={20} onChange={(width) => edit({ width })} testId="cab-width" />
        <NumberField label="ลึก" value={spec.depth} scale={10} suffix="ซม." min={10} onChange={(depth) => edit({ depth })} testId="cab-depth" />
        <NumberField label="สูง" value={spec.height} scale={10} suffix="ซม." min={20} onChange={(height) => edit({ height })} testId="cab-height" />
        <NumberField
          label="สูงจากพื้น"
          value={o.z - floor}
          scale={10}
          suffix="ซม."
          min={0}
          onChange={(v) =>
            applyEdit((d) => {
              const x = d.objects.find((y) => y.id === o.id);
              if (x) x.z = floor + v;
            })
          }
          testId="cab-elevation"
        />
      </div>

      <h5>ช่องและบาน</h5>
      <NumberField label="จำนวนช่อง" value={spec.bays.length} min={1} onChange={(n) => edit({ bays: withBayCount(spec, n) })} testId="cab-bays" />
      {spec.bays.map((bay, i) => (
        <div className="cab-bay" key={i} data-testid={`cab-bay-${i}`}>
          <SelectField
            label={`ช่อง ${i + 1}`}
            value={frontChoice(bay.front)}
            options={fronts}
            onChange={(c) => edit({ bays: withBay(spec, i, withFront(bay, c)) })}
            testId={`cab-front-${i}`}
          />
          {bay.front.kind === 'drawers' ? (
            <NumberField
              label="ลิ้นชัก (ชั้น)"
              value={bay.front.tiers}
              min={1}
              onChange={(tiers) => edit({ bays: withBay(spec, i, { ...bay, front: { kind: 'drawers', tiers } }) })}
              testId={`cab-tiers-${i}`}
            />
          ) : (
            <NumberField label="ชั้นวาง" value={bay.shelves} min={0} onChange={(shelves) => edit({ bays: withBay(spec, i, { ...bay, shelves }) })} testId={`cab-shelves-${i}`} />
          )}
        </div>
      ))}

      <h5>แผ่นและโครง</h5>
      <div className="two">
        <SelectField label="แผ่นโครง" value={spec.carcassMaterial} options={boards} onChange={(carcassMaterial: BoardMaterial) => edit({ carcassMaterial })} testId="cab-carcass" />
        <SelectField
          label="แผ่นหน้าบาน"
          value={spec.frontMaterial}
          options={boards}
          onChange={(frontMaterial: BoardMaterial) => edit({ frontMaterial })}
          testId="cab-front-board"
        />
        <SelectField label="แผ่นหลัง" value={spec.backMaterial} options={boards} onChange={(backMaterial: BoardMaterial) => edit({ backMaterial })} />
        <SelectField
          label="ความหนาแผ่น"
          value={String(spec.boardThickness) as '16' | '18' | '25'}
          options={[16, 18, 25].map((t) => ({ id: String(t) as '16' | '18' | '25', label: `${t} มม.` }))}
          onChange={(t) => edit({ boardThickness: Number(t) as BoardThickness })}
          testId="cab-thickness"
        />
        <NumberField label="แผ่นหลังหนา" value={spec.backThickness} suffix="มม." min={1} onChange={(backThickness) => edit({ backThickness })} />
        <NumberField label="ฐานสูง (0 = ไม่มี)" value={spec.toeKick} scale={10} suffix="ซม." min={0} onChange={(toeKick) => edit({ toeKick })} testId="cab-toekick" />
      </div>
      <Field label="ท็อป">
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={!!spec.top} onChange={(e) => edit({ top: e.target.checked ? { thickness: 20 } : null })} data-testid="cab-top" /> มีท็อป
          </label>
        </div>
      </Field>
      {spec.top && (
        <div className="two">
          <NumberField label="ท็อปหนา" value={spec.top.thickness} suffix="มม." min={1} onChange={(thickness) => edit({ top: { ...spec.top, thickness } })} />
          <SelectField
            label="วัสดุท็อป"
            value={spec.top.material ?? spec.carcassMaterial}
            options={boards}
            onChange={(material: BoardMaterial) => edit({ top: { ...spec.top!, material } })}
          />
        </div>
      )}

      <h5>สีและวัสดุที่เห็น</h5>
      <LookRow o={o} part="front" label="หน้าบาน" />
      <LookRow o={o} part="carcass" label="โครงตู้" />

      <PartsList o={o} />
    </div>
  );
}

/** One surface's look: a colour of its own, or a material from the list (its texture shows in 3D). */
function LookRow({ o, part, label }: { o: PlacedObject; part: keyof PieceColors; label: string }) {
  const project = useProject((s) => s.project!);
  const [open, setOpen] = useState(false);
  const value = o.colors?.[part];
  const colour = value?.startsWith('#') ? value : undefined;
  const material = colour ? undefined : materialOf(value, project);
  const set = (v: string | undefined) =>
    applyEdit((d) => {
      const x = d.objects.find((y) => y.id === o.id);
      if (!x) return;
      const next = { ...x.colors };
      if (v) next[part] = v;
      else delete next[part];
      if (Object.keys(next).length) x.colors = next;
      else delete x.colors;
    });
  return (
    <div className="surface-row">
      <Field label={label}>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid={`cab-look-${part}`}>
            {material ? <Swatch material={material} size={18} /> : <span className="swatch" style={{ width: 18, height: 18, background: colour ?? 'transparent' }} />}{' '}
            {material?.name ?? (colour ? colour.toUpperCase() : 'ค่าเริ่มต้น')}
          </button>
          <input type="color" value={colour ?? '#c8a376'} {...gesture} onChange={(e) => set(e.target.value)} title="เลือกสีเอง" />
        </div>
      </Field>
      {open && (
        <MaterialGrid
          surface="wall"
          value={material?.id}
          onPick={(id) => {
            set(id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

const fmtM2 = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The parts list: every piece, its cut size and how many, the board area per material and the edge banding. */
function PartsList({ o }: { o: PlacedObject }) {
  const parts = useMemo(() => cabinetParts(o.cabinet!), [o.cabinet]);
  return (
    <details className="cab-parts" data-testid="cab-parts">
      <summary>
        รายการแผ่น <span className="muted">({parts.lines.reduce((n, l) => n + l.qty, 0)} ชิ้น)</span>
      </summary>
      <table className="cab-parts-table" data-testid="cab-parts-table">
        <thead>
          <tr>
            <th>ชิ้น</th>
            <th>ขนาด (มม.)</th>
            <th>จำนวน</th>
          </tr>
        </thead>
        <tbody>
          {parts.lines.map((l, i) => (
            <tr key={i} title={`${MATERIAL_GROUP_TH[l.group]} · ${BOARD_MATERIAL_TH[l.material]}`}>
              <td>
                {l.nameTh}
                <div className="muted small">{BOARD_MATERIAL_TH[l.material]}</div>
              </td>
              <td className="num">
                {Math.round(l.w)} × {Math.round(l.l)} × {l.t}
              </td>
              <td className="num">{l.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="cab-parts-table" data-testid="cab-parts-area">
        <tbody>
          {(Object.entries(parts.areaByMaterial) as [BoardMaterial, number][]).map(([m, a]) => (
            <tr key={m}>
              <td>{BOARD_MATERIAL_TH[m]}</td>
              <td className="num">{fmtM2(a)} ตร.ม.</td>
            </tr>
          ))}
          <tr>
            <td>ปิดขอบรวม</td>
            <td className="num" data-testid="cab-edge">
              {(parts.edgeBandTotal / 1000).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ม.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">คิดจากตู้แบบกล่อง บานปิดทับเต็ม ตามที่ระบุไว้ ไม่รวมเศษตัดและราคา</p>
    </details>
  );
}
