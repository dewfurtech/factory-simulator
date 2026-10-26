import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import '../src/styles.css';
import './cabinet.css';
import { buildCabinet, disposeCabinet, isCabinet, setOpen } from '../src/interior/cabinet/cabinet3d';
import { FURNITURE_SHAPES } from '../src/interior/cabinet/furnitureShapes';
import { cabinetParts, MATERIAL_GROUP_TH } from '../src/interior/cabinet/parts';
import {
  BOARD_MATERIAL_TH,
  BOARD_MATERIALS,
  CABINET_KIND_TH,
  normalizeSpec,
  type Bay,
  type BayFront,
  type BoardMaterial,
  type BoardThickness,
  type CabinetKind,
  type CabinetSpec,
} from '../src/interior/cabinet/spec';

/**
 * A page to look at the cabinet engine by eye: the cabinet from the form at the front, the other cabinet kinds
 * beside it, every furniture shape in a row behind, all on one slider that opens the fronts.
 * Served by the dev server at /dev/cabinet.html; not part of the app. Styled with the app's own src/styles.css.
 */

const START: CabinetSpec = normalizeSpec({
  kind: 'base',
  width: 1200,
  height: 850,
  depth: 600,
  bays: [{ front: { kind: 'double' } }, { front: { kind: 'drawers', tiers: 3 } }],
  top: { thickness: 25 },
});

const SAMPLES: Array<{ spec: CabinetSpec; x: number; y: number }> = [
  { spec: normalizeSpec({ kind: 'wall', width: 800, bays: ['door', { front: { kind: 'door', hinge: 'right' } }] }), x: -1.6, y: 1.45 },
  { spec: normalizeSpec({ kind: 'tall', width: 600, bays: [{ front: { kind: 'door', hinge: 'right' }, shelves: 4 }] }), x: -2.6, y: 0 },
  { spec: normalizeSpec({ kind: 'open', width: 800, height: 1800, depth: 300 }), x: -3.8, y: 0 },
  { spec: normalizeSpec({ kind: 'base', width: 600, boardThickness: 25, carcassMaterial: 'teak', bays: ['drawers'] }), x: 1.4, y: 0 },
];

/** The 3D view's colours, as in src/view3d/scene.ts. */
const SKY = '#e9edf1';
const GROUND = '#d5dbd2';

function Scene({ spec, open }: { spec: CabinetSpec; open: number }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ scene: THREE.Scene; main: THREE.Group | null } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(2.6, 2.2, 4.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.6, 0.7, -0.6);
    controls.enableDamping = true;
    controls.update();

    scene.add(new THREE.HemisphereLight('#ffffff', '#b7c0c8', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 8, 5);
    scene.add(sun);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: GROUND })));
    const grid = new THREE.GridHelper(40, 40, '#c3cac0', '#c9d0c6');
    grid.position.y = 0.001;
    scene.add(grid);

    for (const s of SAMPLES) {
      const g = buildCabinet(s.spec);
      g.position.set(s.x, s.y, 0);
      scene.add(g);
    }
    let x = -5;
    for (const [id, shape] of Object.entries(FURNITURE_SHAPES)) {
      const g = shape.build(shape.defaultSize, shape.defaultColor);
      const w = shape.defaultSize.w / 1000;
      g.position.set(x + w / 2, 0, -3.2);
      g.name = id;
      scene.add(g);
      x += w + 0.5;
    }

    world.current = { scene, main: null };
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    (window as unknown as { __scene: THREE.Scene }).__scene = scene;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      world.current = null;
    };
  }, []);

  useEffect(() => {
    const w = world.current;
    if (!w) return;
    if (w.main) {
      w.scene.remove(w.main);
      disposeCabinet(w.main);
    }
    w.main = buildCabinet(spec, { open });
    w.main.name = 'main';
    w.scene.add(w.main);
  }, [spec]);

  useEffect(() => {
    world.current?.scene.traverse((o) => {
      if (isCabinet(o)) setOpen(o, open);
    });
  }, [open, spec]);

  return <div className="cab-view" ref={host} />;
}

function Num({
  label,
  value,
  onChange,
  unit = 'มม.',
  step = 10,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row">
        <input type="number" value={value} step={step} min={min} onChange={(e) => onChange(Number(e.target.value))} />
        {unit && <span className="muted">{unit}</span>}
      </div>
    </label>
  );
}

function MaterialSelect({ label, value, onChange }: { label: string; value: BoardMaterial; onChange: (v: BoardMaterial) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as BoardMaterial)}>
        {BOARD_MATERIALS.map((m) => (
          <option key={m} value={m}>
            {BOARD_MATERIAL_TH[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Seg<T extends string | number>({ value, options, onChange, full }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg${full ? ' full' : ''}`}>
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)} aria-pressed={v === value}>
          {label}
        </button>
      ))}
    </div>
  );
}

const FRONT_TH: Array<[BayFront['kind'], string]> = [
  ['door', 'บานเปิด'],
  ['double', 'บานคู่'],
  ['drawers', 'ลิ้นชัก'],
  ['open', 'โล่ง'],
];

function BayEditor({ bay, index, canRemove, onChange, onRemove }: { bay: Bay; index: number; canRemove: boolean; onChange: (b: Bay) => void; onRemove: () => void }) {
  const f = bay.front;
  const setFront = (kind: BayFront['kind']) => {
    const front: BayFront = kind === 'door' ? { kind, hinge: 'left' } : kind === 'drawers' ? { kind, tiers: 3 } : { kind };
    onChange({ front, shelves: kind === 'drawers' ? 0 : bay.shelves || 1 });
  };
  return (
    <div className="cab-bay">
      <div className="cab-bay-head">
        <b>ช่องที่ {index + 1}</b>
        {canRemove && (
          <button className="btn btn-sm btn-ghost" onClick={onRemove}>
            ลบช่อง
          </button>
        )}
      </div>
      <Seg full value={f.kind} options={FRONT_TH} onChange={setFront} />
      <div className="two">
        {f.kind === 'door' && (
          <label className="field">
            <span>บานพับ</span>
            <Seg
              full
              value={f.hinge}
              options={[
                ['left', 'ซ้าย'],
                ['right', 'ขวา'],
              ]}
              onChange={(h) => onChange({ ...bay, front: { kind: 'door', hinge: h } })}
            />
          </label>
        )}
        {f.kind === 'drawers' ? (
          <Num label="จำนวนลิ้นชัก" unit="ชั้น" value={f.tiers} step={1} min={1} onChange={(v) => onChange({ ...bay, front: { kind: 'drawers', tiers: Math.max(1, v) } })} />
        ) : (
          <Num label="ชั้นวางในช่อง" unit="ชั้น" value={bay.shelves} step={1} onChange={(v) => onChange({ ...bay, shelves: Math.max(0, v) })} />
        )}
      </div>
    </div>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function App() {
  const [spec, setSpec] = useState<CabinetSpec>(START);
  const [open, setOpenFraction] = useState(0);
  const parts = useMemo(() => cabinetParts(spec), [spec]);
  const patch = (p: Partial<CabinetSpec>) => setSpec(normalizeSpec({ ...spec, ...p }));
  const setBay = (i: number, b: Bay) => patch({ bays: spec.bays.map((x, k) => (k === i ? b : x)) });
  const kinds = Object.entries(CABINET_KIND_TH) as Array<[CabinetKind, string]>;

  return (
    <div className="cab-app">
      <header className="topbar">
        <div className="tb-group tb-left">
          <span className="brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="1.5" />
              <path d="M12 3v18M9.5 11v2M14.5 11v2" />
            </svg>
          </span>
          <div className="cab-title">
            <b>ตู้บิ้วอินและเฟอร์นิเจอร์</b>
            <span>หน้าทดสอบเครื่องยนต์ตู้ (เฟส 2)</span>
          </div>
        </div>
        <div className="tb-center">
          <Seg value={spec.kind} options={kinds} onChange={(k) => setSpec(normalizeSpec({ kind: k, bays: spec.bays }))} />
        </div>
        <div className="tb-group tb-right">
          <button className="btn btn-sm" onClick={() => setOpenFraction(open > 0.5 ? 0 : 1)}>
            {open > 0.5 ? 'ปิดตู้' : 'เปิดตู้'}
          </button>
        </div>
      </header>

      <main className="cab-main">
        <Scene spec={spec} open={open} />
        <div className="cab-hint glass">ลากเพื่อหมุน · ล้อเมาส์ซูม · คลิกขวาเลื่อน</div>
        <div className="cab-open glass">
          <b>เปิดบาน</b>
          <input type="range" min={0} max={1} step={0.01} value={open} onChange={(e) => setOpenFraction(Number(e.target.value))} />
          <span className="pct">{Math.round(open * 100)}%</span>
        </div>

        <aside className="side-panel">
          <div className="panel-head">
            <span className="panel-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
                <path d="M12 5v14M3 12h9" />
              </svg>
            </span>
            <div className="grow">
              <div className="panel-title">{CABINET_KIND_TH[spec.kind]}</div>
              <div className="panel-sub">
                {spec.width} × {spec.depth} × {spec.height} มม. · {spec.bays.length} ช่อง
              </div>
            </div>
          </div>

          <div className="panel-body">
            <h5>ขนาด</h5>
            <div className="two">
              <Num label="กว้าง" value={spec.width} onChange={(v) => patch({ width: v })} />
              <Num label="ลึก" value={spec.depth} onChange={(v) => patch({ depth: v })} />
              <Num label="สูง" value={spec.height} onChange={(v) => patch({ height: v })} />
              <Num label="ช่องว่างรอบบาน" value={spec.gap} step={1} onChange={(v) => patch({ gap: v })} />
            </div>

            <h5>แผ่นและวัสดุ</h5>
            <label className="field">
              <span>ความหนาแผ่นโครง</span>
              <Seg full value={spec.boardThickness} options={[16, 18, 25].map((t) => [t as BoardThickness, `${t} มม.`])} onChange={(t) => patch({ boardThickness: t })} />
            </label>
            <div className="two">
              <MaterialSelect label="วัสดุโครง" value={spec.carcassMaterial} onChange={(v) => patch({ carcassMaterial: v })} />
              <MaterialSelect label="วัสดุหน้าบาน" value={spec.frontMaterial} onChange={(v) => patch({ frontMaterial: v })} />
              <MaterialSelect label="วัสดุแผ่นหลัง" value={spec.backMaterial} onChange={(v) => patch({ backMaterial: v })} />
              <Num label="แผ่นหลังหนา" value={spec.backThickness} step={1} onChange={(v) => patch({ backThickness: v })} />
            </div>

            <h5>ฐานและท็อป</h5>
            <div className="two">
              <Num label="ฐานปิดสูง (0 = ไม่มี)" value={spec.toeKick} onChange={(v) => patch({ toeKick: v })} />
              <Num label="ฐานร่นจากหน้า" value={spec.toeKickRecess} onChange={(v) => patch({ toeKickRecess: v })} />
              <label className="cab-check">
                <input type="checkbox" checked={!!spec.top} onChange={(e) => patch({ top: e.target.checked ? { thickness: 25 } : null })} />
                มีท็อป
              </label>
              {spec.top && <Num label="ท็อปหนา" value={spec.top.thickness} step={1} min={1} onChange={(v) => patch({ top: { ...spec.top!, thickness: v } })} />}
            </div>

            <h5>ช่องในตู้</h5>
            {spec.bays.map((b, i) => (
              <BayEditor
                key={i}
                bay={b}
                index={i}
                canRemove={spec.bays.length > 1}
                onChange={(nb) => setBay(i, nb)}
                onRemove={() => patch({ bays: spec.bays.filter((_, k) => k !== i) })}
              />
            ))}
            <button className="btn btn-sm" onClick={() => patch({ bays: [...spec.bays, { front: { kind: 'door', hinge: 'right' }, shelves: 1 }] })}>
              + เพิ่มช่อง
            </button>

            <h5>รายการชิ้นส่วน</h5>
            <table className="cab-table">
              <thead>
                <tr>
                  <th>ชิ้น</th>
                  <th className="n">ขนาด (มม.)</th>
                  <th className="n">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {parts.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.nameTh}
                      <small>
                        {MATERIAL_GROUP_TH[l.group]} · {BOARD_MATERIAL_TH[l.material]}
                      </small>
                    </td>
                    <td className="n">
                      {fmt(l.w)} × {fmt(l.l)} × {l.t}
                    </td>
                    <td className="n">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h5>รวม</h5>
            <div className="cab-totals">
              {Object.entries(parts.areaByMaterial).map(([mat, a]) => (
                <FragmentRow key={mat} label={BOARD_MATERIAL_TH[mat as BoardMaterial]} value={`${a.toFixed(2)} ตร.ม.`} />
              ))}
              <FragmentRow label="ปิดขอบ" value={`${(parts.edgeBandTotal / 1000).toFixed(2)} ม.`} />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span>{label}</span>
      <b>{value}</b>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
