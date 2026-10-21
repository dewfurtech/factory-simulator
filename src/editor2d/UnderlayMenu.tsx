import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { applyTrace } from '../model/trace/apply';
import { WALL_STYLES, type WallStyle } from '../model/trace/scale';
import type { Underlay } from '../model/types';
import { activeUnderlay, placeUnderlay } from '../model/underlay';
import { NumberField } from '../panels/fields';
import { applyEdit, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { useImport } from '../store/importProgress';
import { buildFromVector, hasWallLayers, vectorPlanFor } from './pdfVector';
import { RailButton } from './Toolbar';
import { traceUnderlay } from './traceUnderlay';
import { closeLooseEnds } from '../model/trace/close';

/** Doors a scale read off a picture must agree on before it is taken without asking. */
const TRUSTED_DOORS = 4;
import { storeUnderlayFile, UNDERLAY_ACCEPT } from './underlayFile';

/** Where the upload-and-trace flow stands; `needScale` waits for a measured span, then traces by itself. */
type Status =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'tracing' }
  | { kind: 'traced'; walls: number; doors: number; windows: number; scaleDoors: number }
  | { kind: 'built'; walls: number; doors: number; windows: number; columns: number; zones: number; machines: number; scaleDoors: number; gridPitch?: number }
  | { kind: 'needScale' }
  | { kind: 'failed'; message: string };

const STYLE_LABEL: Record<WallStyle | 'auto', string> = { auto: 'อัตโนมัติ', solid: 'ทึบ / แรเงา', hollow: 'เส้นคู่', sketch: 'ร่างด้วยมือ' };

const editUnderlay = (recipe: (u: Underlay) => void) =>
  applyEdit((d) => {
    const u = d.underlay;
    if (u) recipe(u);
  });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Rail button for the active storey's plan image, and its panel along the bottom of the plan: upload the image and the
 * walls, doors and windows are built from it. The panel stays up while the plan is worked on, until it is closed.
 */
export function UnderlayMenu() {
  const [open, setOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Element | null>(null);
  useEffect(() => setPane(railRef.current?.closest('.pane') ?? null), []);
  const u = useProject((s) => activeUnderlay(s.project!));
  const tool = useUi((s) => s.tool);
  const hasWalls = useProject((s) => Object.keys(s.project!.plan.walls).length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [style, setStyle] = useState<WallStyle | 'auto'>('auto');
  const busy = status.kind === 'reading' || status.kind === 'tracing';

  const measure = () => useUi.getState().setTool({ kind: 'calibrate', a: null, b: null });

  /** A vector PDF is built from its lines; anything else is traced as a picture. */
  const buildVector = async (from: Underlay) => {
    const drawing = await vectorPlanFor(from.imageId);
    if (!drawing || !hasWallLayers(drawing)) return false;
    setStatus({ kind: 'tracing' });
    // Let the busy note paint before the build takes the main thread for a moment.
    await new Promise((r) => setTimeout(r, 30));
    const result: { built: ReturnType<typeof buildFromVector> } = { built: null };
    applyEdit((d) => {
      const u = d.underlay;
      if (!u || u.imageId !== from.imageId) return;
      result.built = buildFromVector(d, u, drawing);
      if (result.built && !u.calibrated) Object.assign(u, { mmPerPx: result.built.underlayMmPerPx, calibrated: true });
    });
    const b = result.built;
    if (!b) {
      setStatus({ kind: 'needScale' });
      measure();
      return true;
    }
    useUi.getState().set({ selection: null });
    setStatus({ kind: 'built', ...b.counts, scaleDoors: b.doors, gridPitch: b.gridPitch });
    return true;
  };

  /** Builds the storey from the plan, under the import loading screen when an import is what asked for it. */
  const trace = async (from: Underlay) => {
    await useImport.getState().stage('build');
    try {
      await traceInner(from);
    } finally {
      useImport.getState().done();
    }
  };

  const traceInner = async (from: Underlay) => {
    try {
      if (await buildVector(from)) return;
    } catch (e) {
      return setStatus({ kind: 'failed', message: message(e) });
    }
    setStatus({ kind: 'tracing' });
    try {
      const result = await traceUnderlay(from, style === 'auto' ? WALL_STYLES : [style]);
      // The storey or its image may have changed while the trace ran; walls traced off another image don't belong.
      if (activeUnderlay(useProject.getState().project!)?.imageId !== from.imageId) return setStatus({ kind: 'idle' });
      // A scale read off a few doors is a guess (a tag or a cupboard read as a door doubles it): the user measures instead.
      if (!result || (!from.calibrated && result.doors < TRUSTED_DOORS)) {
        setStatus({ kind: 'needScale' });
        return measure();
      }
      let counts = { walls: 0, doors: 0, windows: 0 };
      applyEdit((d) => {
        const u = d.underlay;
        if (u && !u.calibrated) Object.assign(u, { mmPerPx: result.underlayMmPerPx, calibrated: true });
        counts = applyTrace(d.plan, result.traced, result.toPlan, result.mmPerPx);
        // A door the trace could not read leaves a gap a doorway wide: it is closed with an opening, so rooms close.
        closeLooseEnds(d.plan, { doorways: 'doorway', straight: true });
        counts.walls = Object.keys(d.plan.walls).length;
      });
      useUi.getState().set({ selection: null });
      setStatus({ kind: 'traced', ...counts, scaleDoors: result.doors });
    } catch (e) {
      setStatus({ kind: 'failed', message: message(e) });
    }
  };

  // Once the span asked for is measured, carry on with the trace.
  useEffect(() => {
    if (status.kind === 'needScale' && u?.calibrated) void trace(u);
  }, [u?.calibrated, u?.mmPerPx]);

  // A plan image put on an empty storey from elsewhere (a project started from one) is built once, as an upload here is.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    // A build already started for this image (the effect run again) keeps the loading screen; one with nothing to build
    // ends it here.
    if (u && tried.current.has(u.imageId)) return;
    if (!u || u.calibrated || hasWalls || status.kind !== 'idle') return useImport.getState().done();
    tried.current.add(u.imageId);
    setOpen(true);
    void trace(u);
  }, [u?.imageId]);

  const upload = async (file: File) => {
    setStatus({ kind: 'reading' });
    setOpen(true);
    useImport.getState().start(file.name);
    try {
      const image = await storeUnderlayFile(file, useImport.getState().stage);
      let placed: Underlay | undefined;
      applyEdit((d) => {
        placed = d.underlay = placeUnderlay(image, d.plan);
      });
      if (placed) tried.current.add(placed.imageId);
      // An empty storey is built straight away; one with walls waits to be asked, as building replaces them.
      if (!hasWalls && placed) await trace(placed);
      else setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'failed', message: message(e) });
    } finally {
      useImport.getState().done();
    }
  };

  // A result is worth a glance, not a permanent line on the plan.
  useEffect(() => {
    if (status.kind !== 'traced' && status.kind !== 'built') return;
    const t = setTimeout(() => setStatus({ kind: 'idle' }), status.kind === 'built' ? 10000 : 6000);
    return () => clearTimeout(t);
  }, [status]);

  const [more, setMore] = useState(false);
  const note = statusNote(status);

  const bar = (
    <div className="ul-dock">
      {note && (
        <div className={`ul-note glass${note.error ? ' error' : ''}`} title={note.tip} data-testid={note.testId}>
          {note.text}
        </div>
      )}
      {more && u && (
        <div className="ul-more glass" data-testid="underlay-more">
          <label className="ul-field">
            <span>ความเข้ม</span>
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => editUnderlay((d) => void (d.opacity = +e.target.value))} data-testid="underlay-opacity" />
          </label>
          <NumberField label="หมุนภาพ" value={u.rotation} step={0.5} suffix="°" onChange={(v) => editUnderlay((d) => void (d.rotation = v))} testId="underlay-rotation" />
          <div className="ul-field">
            <span>ผนังในแปลน</span>
            <div className="seg" role="radiogroup" data-testid="underlay-wall-style">
              {(['auto', ...WALL_STYLES] as const).map((v) => (
                <button key={v} role="radio" aria-checked={style === v} className={style === v ? 'on' : undefined} onClick={() => setStyle(v)}>
                  {STYLE_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              applyEdit((d) => void delete d.underlay);
              setStatus({ kind: 'idle' });
              setMore(false);
            }}
            data-testid="underlay-remove"
          >
            ลบภาพแปลน
          </button>
        </div>
      )}
      <div className="ul-bar glass" role="toolbar" aria-label="แปลนพื้นหลัง" data-testid="underlay-flyout">
        {!u ? (
          <button className="ul-btn ul-primary ul-wide" onClick={() => fileRef.current?.click()} disabled={busy} data-tip="รูปหรือ PDF · หาสเกลจากประตูแล้วสร้างผนังให้เอง" data-testid="underlay-upload">
            <Glyph name="upload" />
            <span>อัปโหลดแปลน</span>
          </button>
        ) : (
          <>
            <button className="ul-btn ul-primary" onClick={() => void trace(u)} disabled={busy} aria-label="สร้างผนังจากแปลน" data-tip={hasWalls ? 'สร้างผนังใหม่จากแปลน (แทนผนังเดิม)' : 'สร้างผนังจากแปลน'} data-testid="underlay-trace">
              <Glyph name={busy ? 'busy' : 'build'} />
            </button>
            <span className="ul-sep" />
            <button className={`ul-btn${tool.kind === 'calibrate' ? ' on' : ''}`} onClick={measure} aria-label="วัดสเกลเอง" data-tip="วัดสเกลเอง (คลิก 2 จุด)" data-testid="underlay-calibrate">
              <Glyph name="ruler" />
            </button>
            <button className={`ul-btn${tool.kind === 'moveUnderlay' ? ' on' : ''}`} onClick={() => useUi.getState().setTool({ kind: 'moveUnderlay', grab: null })} aria-label="ย้ายภาพ" data-tip="ย้ายภาพ" data-testid="underlay-move">
              <Glyph name="move" />
            </button>
            <button className="ul-btn" onClick={() => editUnderlay((d) => void (d.hidden = d.hidden ? undefined : true))} aria-label={u.hidden ? 'แสดงภาพ' : 'ซ่อนภาพ'} data-tip={u.hidden ? 'แสดงภาพ' : 'ซ่อนภาพ'} data-testid="underlay-visible">
              <Glyph name={u.hidden ? 'eyeOff' : 'eye'} />
            </button>
            <button className="ul-btn" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="เปลี่ยนไฟล์" data-tip={`เปลี่ยนไฟล์ (${u.name})`} data-testid="underlay-upload">
              <Glyph name="image" />
            </button>
            <button className={`ul-btn${more ? ' on' : ''}`} onClick={() => setMore(!more)} aria-label="ตั้งค่าเพิ่มเติม" data-tip="ตั้งค่าเพิ่มเติม" data-testid="underlay-more-toggle">
              <Glyph name="more" />
            </button>
          </>
        )}
        <span className="ul-sep" />
        <button
          className="ul-btn"
          onClick={() => {
            setOpen(false);
            setMore(false);
          }}
          aria-label="ปิด"
          data-tip="ปิด"
          data-testid="underlay-close"
        >
          <Glyph name="close" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="rail-group" ref={railRef}>
      <RailButton icon="underlay" text="ภาพแปลน" label="แปลนพื้นหลัง (รูป / PDF)" on={open} more={!!u} onClick={() => setOpen(!open)} testId="underlay-menu" />
      <input
        ref={fileRef}
        type="file"
        accept={UNDERLAY_ACCEPT}
        hidden
        data-testid="underlay-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {open && pane && createPortal(bar, pane)}
    </div>
  );
}

/** The one line shown over the bar for where the flow stands; the detail is in its tooltip. */
function statusNote(status: Status): { text: string; tip?: string; error?: boolean; testId: string } | null {
  switch (status.kind) {
    case 'reading':
      return { text: 'กำลังอ่านไฟล์…', testId: 'underlay-busy' };
    case 'tracing':
      return { text: 'กำลังสร้างผนัง…', testId: 'underlay-busy' };
    case 'traced':
      return {
        text: `ผนัง ${status.walls} · ประตู ${status.doors} · หน้าต่าง ${status.windows}`,
        tip: `${status.scaleDoors ? `สเกลจากประตู ${status.scaleDoors} บาน` : 'สเกลจากที่วัดไว้'} · กดเลิกทำเพื่อย้อน`,
        testId: 'underlay-traced',
      };
    case 'built':
      return {
        text: `ผนัง ${status.walls} · ประตู ${status.doors} · หน้าต่าง ${status.windows} · เสา ${status.columns} · โซน ${status.zones} · เครื่อง/อุปกรณ์ ${status.machines}`,
        tip: `อ่านจากเส้นในไฟล์ PDF · ${status.scaleDoors ? `สเกลจากประตู ${status.scaleDoors} บาน${status.gridPitch ? ` ปรับตามระยะเสา ${status.gridPitch / 1000} ม.` : ''}` : 'สเกลจากที่วัดไว้'} · กดเลิกทำเพื่อย้อน`,
        testId: 'underlay-built',
      };
    case 'needScale':
      return { text: 'หาสเกลจากแบบไม่ชัด: คลิก 2 จุดที่รู้ระยะจริง (เช่น เส้นบอกระยะ) แล้วพิมพ์ระยะ', testId: 'underlay-need-scale' };
    case 'failed':
      return { text: status.message, error: true, testId: 'underlay-error' };
    case 'idle':
      return null;
  }
}

const GLYPHS: Record<string, string> = {
  upload: 'M12 15V4 M7 9l5-5 5 5 M4 15v5h16v-5',
  build: 'M4 20V9h9 M8 20v-7h5 M4 20h9 M18 3v6 M15 6h6',
  busy: 'M12 3a9 9 0 1 0 9 9',
  ruler: 'M3 16L16 3l5 5L8 21z M7 12l2 2 M10 9l2 2 M13 6l2 2',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  eyeOff: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M4 4l16 16',
  image: 'M4 5h16v14H4z M4 15l5-5 4 4 2-2 5 5 M15 9h.01',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  close: 'M6 6l12 12 M18 6L6 18',
};

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" className={name === 'busy' ? 'ul-spin' : undefined} aria-hidden>
      <path d={GLYPHS[name]} />
    </svg>
  );
}
