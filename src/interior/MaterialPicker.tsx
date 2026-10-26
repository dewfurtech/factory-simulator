import { useEffect, useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { Field } from '../panels/fields';
import { newId } from '../model/id';
import type { CustomMaterial, MaterialId, Project, Room, Wall } from '../model/types';
import { applyEdit, useProject } from '../store/project';
import { loadAsset, saveAsset } from '../store/persist';
import { GROUP_LABEL, materialOf, materialsFor, SURFACE_LABEL, SURFACES, type Material, type Surface } from './materials';

/** Longest side an uploaded material picture is kept at: enough to tile a wall, small enough for a share link. */
const MAX_PX = 512;

/** A material's picture or colour as a small square. */
export function Swatch({ material, size = 36 }: { material: Material | undefined; size?: number }) {
  const url = useAssetUrl(material?.imageId);
  const style = { width: size, height: size, background: material?.color ?? 'transparent' };
  if (!material) return <span className="swatch swatch-none" style={style} aria-hidden />;
  const src = material.imageId ? url : material.texture;
  return (
    <span className="swatch" style={style}>
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}

const urls = new Map<string, string>();

/** A blob: URL for a picture in the asset store, made once per picture. */
export function useAssetUrl(imageId: string | undefined): string | undefined {
  const [url, setUrl] = useState(() => (imageId ? urls.get(imageId) : undefined));
  useEffect(() => {
    if (!imageId) return setUrl(undefined);
    const have = urls.get(imageId);
    if (have) return setUrl(have);
    let live = true;
    void loadAsset(imageId as never).then((blob) => {
      if (!blob || !live) return;
      const u = urls.get(imageId) ?? URL.createObjectURL(blob);
      urls.set(imageId, u);
      setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [imageId]);
  return url;
}

/** Shrinks a picture to MAX_PX, reads its average colour, and keeps it in the asset store as a new material of the project. */
async function uploadMaterial(file: File, project: Project): Promise<CustomMaterial> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
  }
  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, '0');
  const color = `#${hex(r)}${hex(g)}${hex(b)}`;
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.85));
  const imageId = newId('u');
  await saveAsset(imageId, blob ?? file);
  const name = file.name.replace(/\.[^.]+$/, '') || `วัสดุ ${(project.materials?.length ?? 0) + 1}`;
  return { id: newId('m'), name, color, imageId, scale: 1000 };
}

/**
 * The grid of materials for one surface, with a button to upload a picture of the user's own. Picking one sets it;
 * picking the one already set takes it off.
 */
export function MaterialGrid({ surface, value, onPick }: { surface: Surface; value: MaterialId | undefined; onPick: (id: MaterialId | undefined) => void }) {
  const project = useProject((s) => s.project!);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = materialsFor(surface, project);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const m = await uploadMaterial(file, useProject.getState().project!);
      applyEdit((d) => void (d.materials = [...(d.materials ?? []), m]));
      onPick(m.id);
    } catch {
      setError('อ่านรูปไม่ได้ ลองไฟล์ PNG หรือ JPG');
    } finally {
      setBusy(false);
    }
  };
  const groups: { group: Material['group']; items: Material[] }[] = [];
  for (const m of items) {
    const g = groups.find((x) => x.group === m.group);
    if (g) g.items.push(m);
    else groups.push({ group: m.group, items: [m] });
  }
  return (
    <div className="material-grid" data-testid={`materials-${surface}`}>
      <button type="button" className={`material-item${!value ? ' on' : ''}`} onClick={() => onPick(undefined)} title="ไม่กำหนดวัสดุ (สีโซนตามเดิม)">
        <Swatch material={undefined} />
        <span>ไม่กำหนด</span>
      </button>
      {groups.map(({ group, items: list }) => (
        <div key={group} className="material-group">
          <h5>{GROUP_LABEL[group]}</h5>
          <div className="material-row">
            {list.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`material-item${value === m.id ? ' on' : ''}`}
                onClick={() => onPick(value === m.id ? undefined : m.id)}
                title={`${m.name} · 1 ช่วงลาย = ${(m.scale / 1000).toFixed(1)} ม.`}
                aria-pressed={value === m.id}
                data-testid={`material-${m.id}`}
              >
                <Swatch material={m} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="material-upload">
        <Icon name="upload" /> {busy ? 'กำลังอ่านรูป…' : 'อัปโหลดรูปวัสดุ'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void upload(e.target.files[0]), (e.target.value = ''))} />
      {error && <p className="dialog-error">{error}</p>}
    </div>
  );
}

/** One row of the materials section: the surface's name, its current material, and the grid when opened. */
function SurfaceRow({
  surface,
  value,
  onPick,
  open,
  setOpen,
}: {
  surface: Surface;
  value: MaterialId | undefined;
  onPick: (id: MaterialId | undefined) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  const project = useProject((s) => s.project!);
  const m = materialOf(value, project);
  return (
    <div className="surface-row">
      <button type="button" className={`surface-head${open ? ' on' : ''}`} onClick={() => setOpen(!open)} data-testid={`surface-${surface}`}>
        <Swatch material={m} size={28} />
        <span className="surface-label">{SURFACE_LABEL[surface]}</span>
        <span className="surface-value muted">{m?.name ?? 'ไม่กำหนด'}</span>
        <Icon name={open ? 'close' : 'forward'} />
      </button>
      {open && <MaterialGrid surface={surface} value={value} onPick={onPick} />}
    </div>
  );
}

/** Edits the scale (mm per repeat) and name of the project's own materials, under the grids. */
function OwnMaterials() {
  const own = useProject((s) => s.project?.materials) ?? [];
  if (!own.length) return null;
  const set = (id: MaterialId, patch: Partial<CustomMaterial>) =>
    applyEdit((d) => {
      const m = d.materials?.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    });
  const remove = (id: MaterialId) =>
    applyEdit((d) => {
      d.materials = d.materials?.filter((x) => x.id !== id);
      // Surfaces finished with it go back to plain.
      for (const plan of [d.plan, d.upper?.plan]) {
        if (!plan) continue;
        for (const r of Object.values(plan.rooms)) for (const s of SURFACES) if (r.finish?.[s] === id) delete r.finish[s];
        for (const w of Object.values(plan.walls)) if (w.finish === id) delete w.finish;
      }
    });
  return (
    <Field label="วัสดุที่อัปโหลดเอง">
      <div className="list">
        {own.map((m) => (
          <div key={m.id} className="own-material">
            <Swatch material={materialOf(m.id, { materials: own })} size={28} />
            <input type="text" value={m.name} onChange={(e) => set(m.id, { name: e.target.value })} aria-label="ชื่อวัสดุ" />
            <input
              type="number"
              min={10}
              step={10}
              value={Math.round(m.scale / 10)}
              onChange={(e) => {
                const cm = parseFloat(e.target.value);
                if (Number.isFinite(cm) && cm >= 10) set(m.id, { scale: cm * 10 });
              }}
              title="ความกว้างจริงของรูป 1 ช่วง (ซม.)"
              aria-label="ความกว้างจริงของรูป (ซม.)"
            />
            <span className="muted small">ซม.</span>
            <button type="button" className="ib sm danger" onClick={() => remove(m.id)} title="ลบวัสดุนี้" aria-label="ลบวัสดุนี้">
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </Field>
  );
}

/** The materials section of a room: its floor, walls and ceiling. */
export function RoomMaterials({ room }: { room: Room }) {
  const [open, setOpen] = useState<Surface | null>(null);
  const pick = (surface: Surface, id: MaterialId | undefined) =>
    applyEdit((d) => {
      const r = d.plan.rooms[room.id];
      if (!r) return;
      if (id) r.finish = { ...r.finish, [surface]: id };
      else if (r.finish) {
        delete r.finish[surface];
        if (!Object.keys(r.finish).length) delete r.finish;
      }
    });
  return (
    <>
      <h5>วัสดุ</h5>
      {SURFACES.map((s) => (
        <SurfaceRow key={s} surface={s} value={room.finish?.[s]} onPick={(id) => pick(s, id)} open={open === s} setOpen={(o) => setOpen(o ? s : null)} />
      ))}
      <OwnMaterials />
      <p className="muted small">พื้นแสดงสีวัสดุบนแปลน 2D และลายจริงใน 3D · ผนังแต่ละด้านเลือกวัสดุต่างจากห้องได้ด้วยการคลิกที่ผนังนั้น</p>
    </>
  );
}

/** The materials section of a wall: its own material, over its rooms'. */
export function WallMaterial({ wall }: { wall: Wall }) {
  const [open, setOpen] = useState(false);
  const pick = (id: MaterialId | undefined) =>
    applyEdit((d) => {
      const w = d.plan.walls[wall.id];
      if (!w) return;
      if (id) w.finish = id;
      else delete w.finish;
    });
  return (
    <>
      <h5>วัสดุผนังนี้</h5>
      <SurfaceRow surface="wall" value={wall.finish} onPick={pick} open={open} setOpen={setOpen} />
      <p className="muted small">ไม่กำหนด = ใช้วัสดุผนังของห้องที่ผนังนี้ล้อมอยู่</p>
    </>
  );
}
