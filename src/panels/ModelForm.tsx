import { useEffect, useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { allTags, DEFAULT_COLOR, MODEL_FILE_ACCEPT, parseTags, type CustomModel } from '../model/library';
import type { Size3 } from '../model/types';
import { useLibrary } from '../store/library';
import { confirmDialog } from '../ui/Dialog';

/** Up to this much per 3D file: the browser keeps every project and model, and a plan should still open quickly. */
const MAX_FILE_MB = 40;

interface Props {
  /** The model being edited; absent for a new one. */
  model?: CustomModel;
  onClose(): void;
}

/** The form for a model of the user's own: name, size, colour, tags and an optional 3D file, with a save and delete. */
export function ModelForm({ model, onClose }: Props) {
  const models = useLibrary((s) => s.models);
  const [name, setName] = useState(model?.name ?? '');
  const [size, setSize] = useState<Size3>(model?.size ?? { w: 1000, d: 1000, h: 1000 });
  const [color, setColor] = useState(model?.color ?? DEFAULT_COLOR);
  const [shape, setShape] = useState<CustomModel['shape']>(model?.shape ?? 'box');
  const [tags, setTags] = useState((model?.tags ?? []).join(', '));
  const [note, setNote] = useState(model?.note ?? '');
  /** undefined: keep the file it has; null: drop it; a File: the new one. */
  const [file, setFile] = useState<File | null | undefined>(undefined);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const known = allTags(models).filter((t) => !parseTags(tags).some((x) => x.toLowerCase() === t.toLowerCase()));

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

  const pickFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) return setError(`ไฟล์ใหญ่เกิน ${MAX_FILE_MB} MB`);
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
    // The file's own extent fills the size in, which keeps its proportions; the numbers can still be changed.
    setMeasuring(true);
    const { measureFile } = await import('../view3d/customModel');
    const measured = await measureFile(f, color);
    setMeasuring(false);
    if (measured) setSize(measured);
    else setError('อ่านไฟล์นี้ไม่ได้ (รองรับ GLB, glTF ที่ฝังข้อมูลครบ, OBJ, STL)');
  };

  const fileName = file === undefined ? model?.modelFile : file?.name;

  const save = async () => {
    const n = name.trim();
    if (!n) return setError('ตั้งชื่อก่อน');
    if (!(size.w > 0 && size.d > 0 && size.h > 0)) return setError('ขนาดต้องมากกว่า 0');
    setSaving(true);
    try {
      const draft = { name: n, size, color, shape, tags: parseTags(tags), note: note.trim() || undefined };
      if (model) {
        await useLibrary.getState().update(model.id, draft, file);
        // Its picture in the library is taken again with the new look.
        void import('../view3d/thumbs').then(({ forgetThumbnail }) => forgetThumbnail(model.id));
      } else await useLibrary.getState().add(draft, file ?? null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!model) return;
    const yes = await confirmDialog({
      title: `ลบ “${model.name}” ออกจากคลัง?`,
      message: 'ชิ้นที่วางไว้ในผังจะยังอยู่ แต่กลายเป็นกล่องธรรมดาในขนาดเดิม',
      ok: 'ลบ',
      danger: true,
    });
    if (!yes) return;
    await useLibrary.getState().remove(model.id);
    onClose();
  };

  const num = (key: keyof Size3, v: string) => setSize({ ...size, [key]: Math.max(0, Math.round(parseFloat(v) * 10) || 0) });

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-testid="model-form">
      <form
        className="dialog glass model-form"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{model ? 'แก้ไขโมเดล' : 'เพิ่มโมเดลในคลังของฉัน'}</h2>
        <label className="mf-field">
          <span>ชื่อ</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เครื่องตัดแผ่น รุ่น A" data-testid="mf-name" />
        </label>
        <div className="mf-row">
          <label className="mf-field">
            <span>กว้าง (ซม.)</span>
            <input type="number" min={1} step={1} value={size.w / 10} onChange={(e) => num('w', e.target.value)} data-testid="mf-w" />
          </label>
          <label className="mf-field">
            <span>ลึก (ซม.)</span>
            <input type="number" min={1} step={1} value={size.d / 10} onChange={(e) => num('d', e.target.value)} data-testid="mf-d" />
          </label>
          <label className="mf-field">
            <span>สูง (ซม.)</span>
            <input type="number" min={1} step={1} value={size.h / 10} onChange={(e) => num('h', e.target.value)} data-testid="mf-h" />
          </label>
        </div>
        <div className="mf-row">
          <label className="mf-field">
            <span>รูปทรง (เมื่อไม่มีไฟล์ 3D)</span>
            <select value={shape} onChange={(e) => setShape(e.target.value as CustomModel['shape'])}>
              <option value="box">กล่อง</option>
              <option value="cylinder">ทรงกระบอก</option>
            </select>
          </label>
          <label className="mf-field">
            <span>สี</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        <label className="mf-field">
          <span>Tag (คั่นด้วยจุลภาค)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="เช่น ตัด, ไลน์ A, ลูกค้า X" data-testid="mf-tags" />
        </label>
        {known.length > 0 && (
          <div className="mf-tags">
            {known.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => setTags(tags.trim() ? `${tags.replace(/[,\s]+$/, '')}, ${t}` : t)}>
                + {t}
              </button>
            ))}
          </div>
        )}
        <div className="mf-field">
          <span>ไฟล์ 3D (ไม่บังคับ)</span>
          <div className="mf-file">
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={measuring}>
              <Icon name="upload" /> {fileName ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์ GLB / glTF / OBJ / STL'}
            </button>
            {fileName && (
              <>
                <span className="mf-filename" title={fileName}>
                  {measuring ? 'กำลังอ่านขนาด…' : fileName}
                </span>
                <button type="button" className="ib sm" title="เอาไฟล์ออก" onClick={() => setFile(null)}>
                  <Icon name="close" />
                </button>
              </>
            )}
            <input ref={fileRef} type="file" accept={MODEL_FILE_ACCEPT} hidden onChange={(e) => (void pickFile(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
          <small className="muted">โมเดลจะถูกย่อ/ขยายให้พอดีขนาดที่ตั้ง ด้านหน้าคือแกน +Z ของไฟล์ ไฟล์ glTF ต้องฝัง buffer และ texture ไว้ในไฟล์เดียว</small>
        </div>
        <label className="mf-field">
          <span>หมายเหตุ</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ผู้ผลิต รุ่น หรือข้อสังเกต" />
        </label>
        {error && <div className="error-note">{error}</div>}
        <div className="dialog-actions">
          {model && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()} data-testid="mf-delete">
              ลบออกจากคลัง
            </button>
          )}
          <span className="mf-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || measuring} data-testid="mf-save">
            {model ? 'บันทึก' : 'เพิ่มในคลัง'}
          </button>
        </div>
      </form>
    </div>
  );
}
