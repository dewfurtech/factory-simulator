import { useEffect, useRef, useState } from 'react';
import type { CustomModel, ModelFile } from '../model/library';
import type { Size3 } from '../model/types';
import { useLibrary } from '../store/library';
import { applyEdit } from '../store/project';
import { confirmDialog } from '../ui/Dialog';
import { importModelFile, pickModelFile, SKP_MESSAGE, UNIT_TH, type LengthUnit } from './cabinet/importModel';
import { fmtMb, modelFiles, removeImportedModel, saveImportedModel, SHARE_WARN_BYTES } from './modelLibrary';

interface Props {
  /** An imported model being edited (its unit, name, removal); absent to import a new one. */
  model?: CustomModel;
  onClose(): void;
}

/** What reading the picked files gave: the real size, the unit it was read in and whether that was a guess. */
interface Read {
  size: Size3;
  unit: LengthUnit | null;
  unitSure: boolean;
  format: string;
  triangles: number;
  warnings: string[];
}

const UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'inch'];
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Bringing a model exported from SketchUp into the library: pick the .dae / .obj (+ .mtl and pictures) / .glb file,
 * see the real size it reads at, fix the unit if the guess was wrong, name it and keep it. A .skp is refused with how
 * to export it. Opened again on an imported model, it changes the unit or name, or removes it.
 */
export function ImportModelDialog({ model, onClose }: Props) {
  const [files, setFiles] = useState<{ model: File; companions: File[] } | null>(null);
  const [name, setName] = useState(model?.name ?? '');
  const [unit, setUnit] = useState<LengthUnit | undefined>(model?.file?.unit);
  const [zUp, setZUp] = useState(!!model?.file?.zUp);
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // An imported model opened for editing reads its own files back from the store.
  useEffect(() => {
    if (!model?.file) return;
    let live = true;
    void modelFiles(model.file).then((f) => live && (f ? setFiles(f) : setError('ไม่พบไฟล์โมเดลในเครื่องนี้แล้ว')));
    return () => {
      live = false;
    };
  }, [model]);

  // Read (again) whenever the files, the unit or the axis change.
  useEffect(() => {
    if (!files) return;
    let live = true;
    setBusy(true);
    setError(null);
    importModelFile(files.model, { companions: files.companions, unit, zUp })
      .then((r) => {
        if (!live) return;
        setRead({
          size: { w: Math.round(r.sizeMm.w), d: Math.round(r.sizeMm.d), h: Math.round(r.sizeMm.h) },
          unit: r.unit,
          unitSure: r.unitSure,
          format: r.format,
          triangles: r.triangles,
          warnings: r.warnings,
        });
        r.group.traverse((x) => (x as { geometry?: { dispose(): void } }).geometry?.dispose());
      })
      .catch((e: unknown) => {
        if (!live) return;
        setRead(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [files, unit, zUp]);

  const pick = (list: FileList | null) => {
    const all = [...(list ?? [])];
    if (!all.length) return;
    const { model: m, companions } = pickModelFile(all);
    setRead(null);
    if (!m) {
      setFiles(null);
      return setError('ไม่พบไฟล์โมเดล เลือกไฟล์ .dae, .obj, .glb หรือ .gltf (ไฟล์ .mtl และภาพพื้นผิวเลือกมาพร้อมกันได้)');
    }
    if (m.name.toLowerCase().endsWith('.skp')) {
      setFiles(null);
      return setError(SKP_MESSAGE);
    }
    setUnit(undefined);
    setZUp(false);
    setFiles({ model: m, companions });
    if (!name.trim()) setName(baseName(m.name));
  };

  const bytes = files ? files.model.size + files.companions.reduce((n, f) => n + f.size, 0) : (model?.file?.bytes ?? 0);
  const canTurn = read && (read.format === 'obj' || read.format === 'gltf' || read.format === 'glb');

  const save = async () => {
    const n = name.trim();
    if (!n) return setError('ตั้งชื่อก่อน');
    if (!files || !read) return;
    setBusy(true);
    try {
      if (model) {
        const file: ModelFile = { ...model.file!, ...(unit ? { unit } : { unit: undefined }), zUp: zUp || undefined };
        await useLibrary.getState().update(model.id, { name: n, size: read.size, file });
        // Copies already placed in this project take the corrected size.
        applyEdit((d) => {
          for (const o of d.objects) if (o.assetId === model.id) o.size = { ...read.size };
        });
        void import('../view3d/thumbs').then(({ forgetThumbnail }) => forgetThumbnail(model.id));
      } else {
        await saveImportedModel({ name: n, model: files.model, companions: files.companions, size: read.size, unit: unit, zUp });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!model) return;
    const yes = await confirmDialog({
      title: `ลบ “${model.name}” ออกจากคลัง?`,
      message: 'ไฟล์โมเดลจะถูกลบออกจากเครื่องนี้ ชิ้นที่วางไว้ในผังจะยังอยู่ แต่กลายเป็นกล่องธรรมดาในขนาดเดิม',
      ok: 'ลบ',
      danger: true,
    });
    if (!yes) return;
    await removeImportedModel(model);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-testid="import-model-dialog">
      <form
        className="dialog glass model-form"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{model ? 'โมเดลที่นำเข้า' : 'นำเข้าโมเดล 3D'}</h2>
        {!model && (
          <>
            <p className="muted small">
              ใช้ไฟล์ที่ส่งออกจาก SketchUp: File → Export → 3D Model เลือก COLLADA (.dae) หรือ OBJ (.obj พร้อมไฟล์ .mtl และภาพพื้นผิว) หรือไฟล์ .glb / .gltf
              ระบบอ่านขนาดจริงจากไฟล์ให้
            </p>
            <input
              ref={input}
              type="file"
              multiple
              accept=".dae,.obj,.mtl,.glb,.gltf,.skp,image/*"
              onChange={(e) => pick(e.target.files)}
              style={{ display: 'none' }}
              data-testid="import-model-file"
            />
            <button type="button" className="btn" onClick={() => input.current?.click()}>
              เลือกไฟล์โมเดล…
            </button>
          </>
        )}
        {files && (
          <p className="small" data-testid="import-model-files">
            {files.model.name}
            {files.companions.length > 0 && ` + ${files.companions.map((f) => f.name).join(', ')}`} · {fmtMb(bytes)}
          </p>
        )}
        {busy && <p className="muted small">กำลังอ่านไฟล์…</p>}
        {read && (
          <>
            <p className="small" data-testid="import-model-size">
              ขนาดจริง กว้าง × ลึก × สูง: <b>{[read.size.w, read.size.d, read.size.h].map((v) => (v / 1000).toFixed(2)).join(' × ')} ม.</b>
            </p>
            <div className="mf-row">
              <label className="mf-field">
                <span>หน่วยในไฟล์{!read.unitSure && !unit ? ' (เดาจากขนาด)' : ''}</span>
                <select value={unit ?? read.unit ?? 'm'} onChange={(e) => setUnit(e.target.value as LengthUnit)} data-testid="import-model-unit">
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_TH[u]}
                    </option>
                  ))}
                </select>
              </label>
              {canTurn && (
                <label className="mf-field mf-check">
                  <span>แกน</span>
                  <span>
                    <input type="checkbox" checked={zUp} onChange={(e) => setZUp(e.target.checked)} /> โมเดลนอนอยู่ (แกน Z ขึ้น) ให้ตั้งขึ้น
                  </span>
                </label>
              )}
            </div>
            {read.warnings.length > 0 && (
              <ul className="issues">
                {read.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {bytes > SHARE_WARN_BYTES && (
          <div className="error-note" data-testid="import-model-heavy">
            ไฟล์รวม {fmtMb(bytes)} เกิน {fmtMb(SHARE_WARN_BYTES)}: ลิงก์แชร์และไฟล์ส่งออกของโปรเจกต์ที่วางโมเดลนี้จะหนักและเปิดช้า ลองลดรายละเอียดหรือขนาดภาพพื้นผิวใน SketchUp
            ก่อนส่งออก
          </div>
        )}
        <label className="mf-field">
          <span>ชื่อ</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น โซฟาของลูกค้า" data-testid="import-model-name" />
        </label>
        {error && (
          <div className="error-note" data-testid="import-model-error">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          {model && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()} data-testid="import-model-delete">
              ลบออกจากคลัง
            </button>
          )}
          <span className="mf-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !read} data-testid="import-model-save">
            {model ? 'บันทึก' : 'เพิ่มในคลัง'}
          </button>
        </div>
      </form>
    </div>
  );
}
