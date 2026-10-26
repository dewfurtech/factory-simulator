import { useMemo, useState } from 'react';
import { fmtArea } from '../format';
import { Icon } from '../editor2d/Toolbar';
import { download } from '../editor2d/exportImage';
import type { Project } from '../model/types';
import { loadAsset } from '../store/persist';
import { useProject } from '../store/project';
import { customDialog } from '../ui/Dialog';
import { SURFACE_LABEL } from './materials';
import { Swatch } from './MaterialPicker';
import { moodSummary, type MoodSummary } from './summary';

const fmtSize3 = (s: { w: number; d: number; h: number }) => `${(s.w / 1000).toFixed(2)} × ${(s.d / 1000).toFixed(2)} × ${(s.h / 1000).toFixed(2)} ม.`;

/** Opens the Mood & Tone page for the open project. */
export const openMoodBoard = () => customDialog((close) => <MoodBoard close={close} />, { wide: true });

/**
 * Mood & Tone: the project's colours, the materials on its surfaces with the area each covers, and the furniture
 * placed, with counts and sizes. Everything is read from the project; there are no prices and nothing made up.
 */
function MoodBoard({ close }: { close: () => void }) {
  const project = useProject((s) => s.project!);
  const summary = useMemo(() => moodSummary(project), [project]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const blob = await moodBoardPng(project, summary);
      if (blob) download(blob, `${project.name} Mood & Tone.png`);
    } finally {
      setBusy(false);
    }
  };
  const empty = !summary.palette.length && !summary.furniture.length;
  return (
    <div className="mood" data-testid="mood-board">
      <div className="mood-head">
        <div>
          <h2>Mood &amp; Tone</h2>
          <p className="muted">{project.name}</p>
        </div>
        <div className="row gap">
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || empty} data-testid="mood-png">
            <Icon name="image" /> {busy ? 'กำลังสร้างรูป…' : 'บันทึกเป็น PNG'}
          </button>
          <button type="button" className="ib" onClick={close} title="ปิด (Esc)" aria-label="ปิด">
            <Icon name="close" />
          </button>
        </div>
      </div>
      {empty && <p className="muted">ยังไม่มีวัสดุหรือเฟอร์นิเจอร์ในโครงการ เลือกห้องบนแปลนแล้วกำหนดวัสดุพื้น ผนัง ฝ้า หรือวางเฟอร์นิเจอร์จากคลัง</p>}
      {summary.palette.length > 0 && (
        <section>
          <h3>ชุดสี</h3>
          <div className="mood-palette" data-testid="mood-palette">
            {summary.palette.map((c) => (
              <div key={c} className="mood-color">
                <i style={{ background: c }} />
                <span>{c.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {summary.materials.length > 0 && (
        <section>
          <h3>วัสดุที่ใช้</h3>
          <table className="mood-table" data-testid="mood-materials">
            <thead>
              <tr>
                <th></th>
                <th>วัสดุ</th>
                <th>ใช้กับ</th>
                <th className="num">พื้นที่รวม</th>
              </tr>
            </thead>
            <tbody>
              {summary.materials.map((l) => (
                <tr key={l.material.id}>
                  <td>
                    <Swatch material={l.material} size={40} />
                  </td>
                  <td>
                    <b>{l.material.name}</b>
                    <span className="muted small"> {l.material.color.toUpperCase()}</span>
                  </td>
                  <td>
                    {l.uses.map((u, i) => (
                      <div key={i} className="small">
                        {u.room} · {SURFACE_LABEL[u.surface]} · {fmtArea(u.area)}
                      </div>
                    ))}
                  </td>
                  <td className="num">{fmtArea(l.area)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {summary.furniture.length > 0 && (
        <section>
          <h3>เฟอร์นิเจอร์</h3>
          <table className="mood-table" data-testid="mood-furniture">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th className="num">จำนวน</th>
                <th>ขนาด ก × ล × ส</th>
              </tr>
            </thead>
            <tbody>
              {summary.furniture.map((f, i) => (
                <tr key={i}>
                  <td>{f.name}</td>
                  <td className="num">{f.count}</td>
                  <td>{fmtSize3(f.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="muted small">พื้นที่คิดจากเรขาคณิตของห้อง: พื้นและฝ้าตามพื้นที่ห้อง ผนังตามความยาว × ความสูงฝ้า หักช่องประตูและหน้าต่าง ไม่มีราคา</p>
    </div>
  );
}

/* ---------- PNG ---------- */

const W = 1240;
const PAD = 56;
const FONT = "'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', system-ui, sans-serif";

/** The picture of a material, from its URL or the asset store; null for a plain colour or when it cannot be read. */
async function pictureOf(m: MoodSummary['materials'][number]['material']): Promise<HTMLImageElement | ImageBitmap | null> {
  try {
    if (m.imageId) {
      const blob = await loadAsset(m.imageId as never);
      return blob ? await createImageBitmap(blob) : null;
    }
    if (!m.texture) return null;
    const img = new Image();
    img.src = m.texture;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Draws the page on a canvas: the same sections as the dialog, one picture tall enough for all of them. */
export async function moodBoardPng(project: Project, summary: MoodSummary): Promise<Blob | null> {
  const pictures = await Promise.all(summary.materials.map((l) => pictureOf(l.material)));
  // Drawn on a canvas taller than any page needs, then cut down to where the drawing ended.
  const useLines = summary.materials.reduce((s, l) => s + l.uses.length + 1, 0);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 600 + useLines * 30 + summary.materials.length * 40 + summary.furniture.length * 40;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'alphabetic';
  let y = PAD;
  const text = (s: string, x: number, size: number, opts: { weight?: number; color?: string; align?: CanvasTextAlign } = {}) => {
    ctx.font = `${opts.weight ?? 400} ${size}px ${FONT}`;
    ctx.fillStyle = opts.color ?? '#0f172a';
    ctx.textAlign = opts.align ?? 'left';
    ctx.fillText(s, x, y);
  };
  const heading = (s: string) => {
    y += 44;
    text(s, PAD, 22, { weight: 700 });
    y += 10;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(PAD, y, W - PAD * 2, 1);
    y += 28;
  };
  y += 36;
  text('Mood & Tone', PAD, 36, { weight: 700 });
  y += 30;
  text(project.name, PAD, 18, { color: '#64748b' });
  text(new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }), W - PAD, 16, { color: '#94a3b8', align: 'right' });

  if (summary.palette.length) {
    heading('ชุดสี');
    const size = 72;
    const gap = 18;
    summary.palette.forEach((col, i) => {
      const x = PAD + i * (size + gap);
      if (x + size > W - PAD) return;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,0.12)';
      ctx.stroke();
      y += size + 22;
      text(col.toUpperCase(), x + size / 2, 13, { color: '#334155', align: 'center' });
      y -= size + 22;
    });
    y += size + 30;
  }

  if (summary.materials.length) {
    heading('วัสดุที่ใช้');
    summary.materials.forEach((l, i) => {
      const top = y - 18;
      const pic = pictures[i];
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD, top, 48, 48, 8);
      ctx.clip();
      ctx.fillStyle = l.material.color;
      ctx.fillRect(PAD, top, 48, 48);
      if (pic) ctx.drawImage(pic, PAD, top, 48, 48);
      ctx.restore();
      text(l.material.name, PAD + 64, 17, { weight: 600 });
      text(l.material.color.toUpperCase(), PAD + 64 + ctx.measureText(l.material.name).width + 10, 13, { color: '#64748b' });
      text(fmtArea(l.area), W - PAD, 17, { weight: 600, align: 'right' });
      y += 24;
      for (const u of l.uses) {
        text(`${u.room} · ${SURFACE_LABEL[u.surface]} · ${fmtArea(u.area)}`, PAD + 64, 14, { color: '#475569' });
        y += 22;
      }
      // The next row starts below both the text and the picture.
      y = Math.max(y, top + 48 + 18) + 18;
    });
  }

  if (summary.furniture.length) {
    heading('เฟอร์นิเจอร์');
    text('ชื่อ', PAD, 13, { color: '#64748b' });
    text('จำนวน', PAD + 620, 13, { color: '#64748b', align: 'right' });
    text('ขนาด ก × ล × ส', PAD + 660, 13, { color: '#64748b' });
    y += 30;
    for (const f of summary.furniture) {
      text(f.name, PAD, 16);
      text(String(f.count), PAD + 620, 16, { align: 'right' });
      text(fmtSize3(f.size), PAD + 660, 16, { color: '#334155' });
      y += 34;
    }
  }
  y += 30;
  text('พื้นที่คิดจากเรขาคณิตของห้อง: พื้นและฝ้าตามพื้นที่ห้อง ผนังตามความยาว × ความสูงฝ้า หักช่องประตูและหน้าต่าง · ไม่มีราคา', PAD, 12, { color: '#94a3b8' });
  for (const p of pictures) if (p && 'close' in p) p.close();
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.min(c.height, Math.ceil(y + PAD));
  out.getContext('2d')!.drawImage(c, 0, 0);
  return new Promise((ok) => out.toBlob(ok, 'image/png'));
}
