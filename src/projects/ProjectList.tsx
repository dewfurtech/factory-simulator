import { useEffect, useRef, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { storeUnderlayFile, UNDERLAY_ACCEPT } from '../editor2d/underlayFile';
import { useImport } from '../store/importProgress';
import { newProject } from '../model/project';
import { mastroxLayout, sampleFactory } from '../model/sample';
import type { Id, Project } from '../model/types';
import { placeUnderlay } from '../model/underlay';
import { deleteProject, duplicateProject, exportAll, exportProject, importFile, listProjects, loadProject, saveProject, type ProjectSummary } from '../store/persist';
import { wallFootprints } from '../model/miter';
import { roomPolygon } from '../model/plan';
import { bounds } from '../model/vec';
import { zoneColor } from '../model/zones';

const open = (id: Id) => (location.hash = `#/p/${id}`);

function PlanThumb({ id }: { id: Id }) {
  const [p, setP] = useState<Project | null>(null);
  useEffect(() => {
    void loadProject(id).then((x) => x && setP(x));
  }, [id]);
  if (!p) return <div className="thumb" />;
  const corners = Object.values(p.plan.corners);
  if (corners.length < 2)
    return (
      <div className="thumb empty-thumb">
        <Icon name="factory" />
      </div>
    );
  const b = bounds(corners);
  const pad = 800;
  const vb = `${b.min.x - pad} ${b.min.y - pad} ${b.max.x - b.min.x + pad * 2} ${b.max.y - b.min.y + pad * 2}`;
  const pts = (ps: { x: number; y: number }[]) => ps.map((q) => `${q.x},${q.y}`).join(' ');
  return (
    <svg className="thumb" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      {Object.values(p.plan.rooms).map((r) => (
        <polygon key={r.id} points={pts(roomPolygon(p.plan, r))} fill={zoneColor(r)} />
      ))}
      {p.objects.map((o) => (
        <rect
          key={o.id}
          x={o.x - o.size.w / 2}
          y={o.y - o.size.d / 2}
          width={o.size.w}
          height={o.size.d}
          transform={`rotate(${(o.rotation * 180) / Math.PI} ${o.x} ${o.y})`}
          fill="#94a3b8"
          opacity={0.7}
        />
      ))}
      {wallFootprints(p.plan).map((f) => (
        <polygon key={f.wallId} points={pts(f.polygon)} fill="#334155" />
      ))}
    </svg>
  );
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ProjectList() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The plan file being read while a project is started from one: a large PDF takes a while. */
  const [reading, setReading] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<HTMLInputElement>(null);
  const refresh = () => void listProjects().then(setList);
  useEffect(refresh, []);

  const create = async (p: Project) => {
    await saveProject(p);
    open(p.id);
  };

  const fromPlan = async (file: File) => {
    setError(null);
    setReading(file.name);
    try {
      useImport.getState().start(file.name);
      const image = await storeUnderlayFile(file, useImport.getState().stage);
      await useImport.getState().stage('open');
      const p = newProject(file.name.replace(/\.[^.]+$/, ''));
      p.underlay = placeUnderlay(image, p.plan);
      await create(p);
    } catch (e) {
      useImport.getState().done();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(null);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand big">
          <Icon name="factory" />
        </div>
        <div>
          <h1>Factory Simulator</h1>
          <p>ออกแบบผังโรงงาน วางเครื่องจักร Mastrox แล้วดูรายละเอียดและขนาดของแต่ละเครื่อง</p>
        </div>
      </header>
      <section className="home-actions">
        <button className="action primary" onClick={() => void create(sampleFactory())} data-testid="new-sample">
          <Icon name="factory" />
          <b>โรงงานตัวอย่าง</b>
          <span>ผังพร้อมเครื่องจักร 10 เครื่อง</span>
        </button>
        <button className="action primary" onClick={() => void create(mastroxLayout())} data-testid="new-mastrox">
          <Icon name="factory" />
          <b>Layout Mastrox</b>
          <span>ผัง 42 × 48 ม. ตามแบบที่ส่งมา พร้อมเครื่องจักร</span>
        </button>
        <button className="action" onClick={() => planRef.current?.click()} disabled={!!reading} data-testid="new-from-plan">
          <Icon name="underlay" />
          <b>เริ่มจากแบบแปลน</b>
          <span>{reading ? `กำลังอ่านไฟล์แปลน… (${reading})` : 'อัปโหลดรูป / PDF ของ layout แล้ววาดห้องทับ (PDF จาก CAD สร้างผนังให้เอง)'}</span>
        </button>
        <button className="action" onClick={() => void create(newProject('โรงงานใหม่'))} data-testid="new-blank">
          <Icon name="plus" />
          <b>ผังเปล่า</b>
          <span>วาดผนัง โซน และเสาเอง</span>
        </button>
        <button className="action" onClick={() => importRef.current?.click()}>
          <Icon name="upload" />
          <b>นำเข้าไฟล์</b>
          <span>ไฟล์ .json ที่ส่งออกจากโปรแกรมนี้ หรือไฟล์สำรองทั้งหมด</span>
        </button>
        <input ref={planRef} type="file" accept={UNDERLAY_ACCEPT} hidden onChange={(e) => (e.target.files?.[0] && void fromPlan(e.target.files[0]), (e.target.value = ''))} />
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            // One project opens; a backup of several just joins the list.
            if (f)
              void importFile(f)
                .then((ps) => (ps.length === 1 ? open(ps[0].id) : refresh()))
                .catch((err) => setError(err.message));
          }}
        />
      </section>
      {error && <div className="error-note">{error}</div>}
      <section className="home-list">
        <h2>โรงงานของฉัน</h2>
        <div className="notice" data-testid="storage-notice">
          <Icon name="panel" />
          <span>
            โปรเจกต์ทั้งหมดเก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ถ้าล้างข้อมูลเว็บไซต์ เปลี่ยนเครื่อง หรือเปลี่ยนเบราว์เซอร์จะหาย ควรสำรองเป็นไฟล์เก็บไว้เป็นระยะ
            แล้วนำเข้ากลับได้จากปุ่ม "นำเข้าไฟล์"
          </span>
          <button
            className="btn btn-sm"
            disabled={!list?.length}
            onClick={() => void exportAll().then((b) => save(b, `factory-backup-${new Date().toISOString().slice(0, 10)}.json`))}
            data-testid="backup-all"
          >
            <Icon name="download" /> สำรองทั้งหมด
          </button>
        </div>
        {list && !list.length && <p className="muted">ยังไม่มีโปรเจกต์ เริ่มจากโรงงานตัวอย่างได้เลย</p>}
        <div className="cards">
          {list?.map((p) => (
            <article key={p.id} className="card" onClick={() => open(p.id)}>
              <PlanThumb id={p.id} />
              <div className="card-body">
                <b>{p.name}</b>
                <span className="muted small">
                  {p.machines ?? 0} เครื่อง · {Math.round((p.area ?? 0) / 1e6)} ม² · {ago(p.updatedAt)}
                </span>
              </div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="ib sm"
                  title="เปลี่ยนชื่อ"
                  onClick={async () => {
                    const name = await promptDialog({ title: 'เปลี่ยนชื่อโรงงาน', label: 'ชื่อโรงงาน', value: p.name, ok: 'บันทึก' });
                    const proj = name && (await loadProject(p.id));
                    if (proj) await saveProject({ ...proj, name, updatedAt: Date.now() });
                    refresh();
                  }}
                >
                  <Icon name="edit" />
                </button>
                <button className="ib sm" title="ทำสำเนา" onClick={() => void duplicateProject(p.id).then(refresh)}>
                  <Icon name="copy" />
                </button>
                <button className="ib sm" title="ส่งออก" onClick={() => void exportProject(p.id).then((b) => save(b, `${p.name}.factory.json`))}>
                  <Icon name="download" />
                </button>
                <button
                  className="ib sm danger"
                  title="ลบ"
                  onClick={async () => {
                    if (await confirmDialog({ title: `ลบ “${p.name}”?`, message: 'ลบแล้วเอากลับไม่ได้ ถ้ายังไม่แน่ใจให้ส่งออกเป็นไฟล์เก็บไว้ก่อน', ok: 'ลบ', danger: true }))
                      void deleteProject(p.id).then(refresh);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
