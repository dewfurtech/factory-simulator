import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { storeUnderlayFile, UNDERLAY_ACCEPT } from '../editor2d/underlayFile';
import { SentLinks } from './SentLinks';
import { useImport } from '../store/importProgress';
import { newProject } from '../model/project';
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

const area = (mm2: number) => {
  const m2 = Math.round(mm2 / 1e6);
  return `${m2.toLocaleString('th-TH')} ม²`;
};

const isJson = (f: File) => f.type === 'application/json' || /\.json$/i.test(f.name);

/** The start screen: a way to begin a factory, and the factories already kept in this browser. */
export function ProjectList() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The plan file being read while a project is started from one: a large PDF takes a while. */
  const [reading, setReading] = useState<string | null>(null);
  /** A file is held over the page, about to be dropped. */
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
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

  const fromJson = (file: File) => {
    setError(null);
    // One project opens; a backup of several just joins the list.
    void importFile(file)
      .then((ps) => (ps.length === 1 ? open(ps[0].id) : refresh()))
      .catch((err: Error) => setError(err.message));
  };

  /** Any file dropped on the page: a saved project or backup is imported, anything else is tried as a plan. */
  const takeFile = (file: File) => (isJson(file) ? fromJson(file) : void fromPlan(file));

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && !reading) takeFile(f);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list?.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [list, query]);

  return (
    <div className={`home${dragging ? ' dragging' : ''}`} onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <nav className="home-nav">
        <div className="home-brand">
          <span className="brand">
            <Icon name="factory" />
          </span>
          <b>Factory Simulator</b>
        </div>
        <div className="home-nav-actions">
          <button className="btn btn-ghost" onClick={() => importRef.current?.click()} data-testid="import-file">
            <Icon name="upload" /> นำเข้าไฟล์
          </button>
          <button
            className="btn"
            disabled={!list?.length}
            title="ดาวน์โหลดโปรเจกต์ทั้งหมดเป็นไฟล์เดียว"
            onClick={() => void exportAll().then((b) => save(b, `factory-backup-${new Date().toISOString().slice(0, 10)}.json`))}
            data-testid="backup-all"
          >
            <Icon name="download" /> สำรองทั้งหมด
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-text">
          <h1>วางเครื่อง Mastrox ลงแปลนของลูกค้า</h1>
          <p>อัปโหลดแปลน วาดห้องทับ วางเครื่องตามขนาดจริง แล้วส่งลิงก์ให้ลูกค้าลองขยับเองและส่งกลับ</p>
        </div>

        <button className={`upload-card${reading ? ' busy' : ''}`} onClick={() => planRef.current?.click()} disabled={!!reading} data-testid="new-from-plan">
          <span className="upload-icon">
            <Icon name={reading ? 'clock' : 'upload'} />
          </span>
          <b>{reading ? `กำลังอ่านแปลน… (${reading})` : 'อัปโหลดแปลนของลูกค้า'}</b>
          <span>ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก · PDF จาก CAD อ่านสเกลให้เอง · PNG / JPG ก็ได้</span>
        </button>

        <div className="start-row">
          <button className="btn start-blank-btn" onClick={() => void create(newProject('โรงงานใหม่'))} data-testid="new-blank">
            <Icon name="plus" /> ผังเปล่า
          </button>
          <span className="start-templates">
            <span className="muted">หรือลองจากเทมเพลต</span>
            <button className="chip" onClick={() => void import('../model/sample').then((m) => create(m.sampleFactory()))} data-testid="new-sample">
              โรงงานตัวอย่าง
            </button>
            <button className="chip" onClick={() => void import('../model/sample').then((m) => create(m.mastroxLayout()))} data-testid="new-mastrox">
              Layout Mastrox
            </button>
          </span>
        </div>

        <input ref={planRef} type="file" accept={UNDERLAY_ACCEPT} hidden onChange={(e) => (e.target.files?.[0] && void fromPlan(e.target.files[0]), (e.target.value = ''))} />
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) fromJson(f);
          }}
        />
      </section>

      {error && (
        <div className="error-note" role="alert">
          <Icon name="info" /> {error}
        </div>
      )}

      <section className="home-list">
        <div className="list-head">
          <h2>
            โรงงานของฉัน
            {list && list.length > 0 && <span className="count">{list.length}</span>}
          </h2>
          {list && list.length > 3 && (
            <label className="search list-search">
              <Icon name="search" />
              <input type="search" placeholder="ค้นหาชื่อโรงงาน" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ค้นหาชื่อโรงงาน" />
            </label>
          )}
        </div>

        {list && !list.length && (
          <p className="empty-line" data-testid="empty-state">
            ยังไม่มีโรงงานในเครื่องนี้ · อัปโหลดแปลนด้านบน หรือลองเปิดโรงงานตัวอย่างดูก่อนก็ได้
          </p>
        )}
        {shown && list?.length ? (
          shown.length ? (
            <div className="cards">
              {shown.map((p) => (
                <article key={p.id} className="card" onClick={() => open(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(p.id)}>
                  <div className="card-pic">
                    <PlanThumb id={p.id} />
                    <span className="card-open" aria-hidden>
                      เปิด <Icon name="forward" />
                    </span>
                  </div>
                  <div className="card-body">
                    <b title={p.name}>{p.name}</b>
                    <div className="card-meta">
                      <span title="เครื่องจักร">
                        <Icon name="machine" /> {p.machines ?? 0}
                      </span>
                      <span title="ห้อง">
                        <Icon name="house" /> {p.rooms ?? 0}
                      </span>
                      <span title="พื้นที่ใช้สอย">
                        <Icon name="ruler" /> {area(p.area ?? 0)}
                      </span>
                    </div>
                    <span className="card-time">{ago(p.updatedAt)}</span>
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
          ) : (
            <p className="muted">ไม่พบโรงงานชื่อ “{query}”</p>
          )
        ) : null}
      </section>

      <SentLinks />

      <p className="store-note" data-testid="storage-notice">
        <Icon name="info" />
        <span>โปรเจกต์เก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ล้างข้อมูลเว็บหรือเปลี่ยนเครื่องแล้วหาย กด “สำรองทั้งหมด” เก็บเป็นไฟล์ไว้เป็นระยะ</span>
      </p>

      {dragging && (
        <div className="drop-veil" aria-hidden>
          <div className="drop-card glass">
            <Icon name="upload" />
            <b>วางไฟล์เพื่อเริ่มโปรเจกต์</b>
            <span>รูป / PDF ของแบบแปลน หรือไฟล์ .json ที่ส่งออกไว้</span>
          </div>
        </div>
      )}
    </div>
  );
}
