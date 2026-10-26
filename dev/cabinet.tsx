import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
 * Served by the dev server at /dev/cabinet.html; not part of the app.
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

function Scene({ spec, open }: { spec: CabinetSpec; open: number }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ scene: THREE.Scene; main: THREE.Group | null } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe4ea');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(3.2, 2.6, 5.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.7, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f98', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 8, 5);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#cfd4da' }));
    scene.add(ground);
    scene.add(new THREE.GridHelper(40, 40, '#b8bec6', '#c6ccd3'));

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
      camera.aspect = w / h;
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
    const w = world.current;
    if (!w) return;
    w.scene.traverse((o) => {
      if (isCabinet(o)) setOpen(o, open);
    });
  }, [open, spec]);

  return <div className="view" ref={host} />;
}

function Num({ label, value, onChange, step = 10, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <div className="row">
      <label>{label}</label>
      <input type="number" value={value} step={step} min={min} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function MaterialSelect({ label, value, onChange }: { label: string; value: BoardMaterial; onChange: (v: BoardMaterial) => void }) {
  return (
    <div className="row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as BoardMaterial)}>
        {BOARD_MATERIALS.map((m) => (
          <option key={m} value={m}>
            {BOARD_MATERIAL_TH[m]}
          </option>
        ))}
      </select>
    </div>
  );
}

const FRONT_TH: Record<BayFront['kind'], string> = { door: 'บานเปิด', double: 'บานคู่', drawers: 'ลิ้นชัก', open: 'ช่องโล่ง' };

function BayEditor({ bay, index, onChange, onRemove }: { bay: Bay; index: number; onChange: (b: Bay) => void; onRemove: () => void }) {
  const f = bay.front;
  const setFront = (kind: BayFront['kind']) => {
    const front: BayFront = kind === 'door' ? { kind, hinge: 'left' } : kind === 'drawers' ? { kind, tiers: 3 } : { kind };
    onChange({ front, shelves: kind === 'drawers' ? 0 : bay.shelves });
  };
  return (
    <div className="bay">
      <div className="row">
        <label>ช่อง {index + 1}</label>
        <select value={f.kind} onChange={(e) => setFront(e.target.value as BayFront['kind'])}>
          {(Object.keys(FRONT_TH) as BayFront['kind'][]).map((k) => (
            <option key={k} value={k}>
              {FRONT_TH[k]}
            </option>
          ))}
        </select>
        <button onClick={onRemove} title="ลบช่อง">
          ×
        </button>
      </div>
      {f.kind === 'door' && (
        <div className="row">
          <label>บานพับ</label>
          <select value={f.hinge} onChange={(e) => onChange({ ...bay, front: { kind: 'door', hinge: e.target.value as 'left' | 'right' } })}>
            <option value="left">ซ้าย</option>
            <option value="right">ขวา</option>
          </select>
        </div>
      )}
      {f.kind === 'drawers' ? (
        <Num label="จำนวนชั้นลิ้นชัก" value={f.tiers} step={1} min={1} onChange={(v) => onChange({ ...bay, front: { kind: 'drawers', tiers: Math.max(1, v) } })} />
      ) : (
        <Num label="ชั้นวางในช่อง" value={bay.shelves} step={1} onChange={(v) => onChange({ ...bay, shelves: Math.max(0, v) })} />
      )}
    </div>
  );
}

function App() {
  const [spec, setSpec] = useState<CabinetSpec>(START);
  const [open, setOpenFraction] = useState(0);
  const parts = useMemo(() => cabinetParts(spec), [spec]);
  const patch = (p: Partial<CabinetSpec>) => setSpec(normalizeSpec({ ...spec, ...p }));
  const setBay = (i: number, b: Bay) => patch({ bays: spec.bays.map((x, k) => (k === i ? b : x)) });

  return (
    <>
      <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
        <Scene spec={spec} open={open} />
        <div className="hint">ลากเพื่อหมุน · ล้อเมาส์ซูม · คลิกขวาเลื่อน</div>
        <div className="open">
          <span>เปิดบาน</span>
          <input type="range" min={0} max={1} step={0.01} value={open} onChange={(e) => setOpenFraction(Number(e.target.value))} />
          <span>{Math.round(open * 100)}%</span>
        </div>
      </div>
      <div className="panel">
        <h2>ตู้</h2>
        <div className="row">
          <label>ชนิด</label>
          <select value={spec.kind} onChange={(e) => setSpec(normalizeSpec({ kind: e.target.value as CabinetKind, bays: spec.bays }))}>
            {(Object.keys(CABINET_KIND_TH) as CabinetKind[]).map((k) => (
              <option key={k} value={k}>
                {CABINET_KIND_TH[k]}
              </option>
            ))}
          </select>
        </div>
        <Num label="กว้าง (มม.)" value={spec.width} onChange={(v) => patch({ width: v })} />
        <Num label="สูง (มม.)" value={spec.height} onChange={(v) => patch({ height: v })} />
        <Num label="ลึก (มม.)" value={spec.depth} onChange={(v) => patch({ depth: v })} />
        <div className="row">
          <label>แผ่นโครงหนา</label>
          <select value={spec.boardThickness} onChange={(e) => patch({ boardThickness: Number(e.target.value) as BoardThickness })}>
            {[16, 18, 25].map((t) => (
              <option key={t} value={t}>
                {t} มม.
              </option>
            ))}
          </select>
        </div>
        <Num label="แผ่นหลังหนา" value={spec.backThickness} step={1} onChange={(v) => patch({ backThickness: v })} />
        <Num label="ช่องว่างรอบบาน" value={spec.gap} step={1} onChange={(v) => patch({ gap: v })} />
        <MaterialSelect label="วัสดุโครง" value={spec.carcassMaterial} onChange={(v) => patch({ carcassMaterial: v })} />
        <MaterialSelect label="วัสดุหน้าบาน" value={spec.frontMaterial} onChange={(v) => patch({ frontMaterial: v })} />
        <MaterialSelect label="วัสดุแผ่นหลัง" value={spec.backMaterial} onChange={(v) => patch({ backMaterial: v })} />
        <Num label="ฐานปิดสูง (0 = ไม่มี)" value={spec.toeKick} onChange={(v) => patch({ toeKick: v })} />
        <Num label="ฐานร่นจากหน้า" value={spec.toeKickRecess} onChange={(v) => patch({ toeKickRecess: v })} />
        <div className="row">
          <label>ท็อป</label>
          <input type="checkbox" checked={!!spec.top} onChange={(e) => patch({ top: e.target.checked ? { thickness: 25 } : null })} />
          {spec.top && <input type="number" value={spec.top.thickness} step={1} min={1} onChange={(e) => patch({ top: { ...spec.top!, thickness: Number(e.target.value) } })} />}
        </div>

        <h2>ช่อง</h2>
        {spec.bays.map((b, i) => (
          <BayEditor key={i} bay={b} index={i} onChange={(nb) => setBay(i, nb)} onRemove={() => spec.bays.length > 1 && patch({ bays: spec.bays.filter((_, k) => k !== i) })} />
        ))}
        <button onClick={() => patch({ bays: [...spec.bays, { front: { kind: 'door', hinge: 'right' }, shelves: 1 }] })}>+ เพิ่มช่อง</button>

        <h2>รายการชิ้นส่วน</h2>
        <table>
          <thead>
            <tr>
              <th>ชิ้น</th>
              <th className="n">กว้าง</th>
              <th className="n">ยาว</th>
              <th className="n">หนา</th>
              <th className="n">จำนวน</th>
              <th>วัสดุ</th>
            </tr>
          </thead>
          <tbody>
            {parts.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.nameTh}</td>
                <td className="n">{fmt(l.w)}</td>
                <td className="n">{fmt(l.l)}</td>
                <td className="n">{l.t}</td>
                <td className="n">{l.qty}</td>
                <td>
                  {MATERIAL_GROUP_TH[l.group]} · {BOARD_MATERIAL_TH[l.material]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>รวม</h2>
        {Object.entries(parts.areaByMaterial).map(([mat, a]) => (
          <div className="row" key={mat}>
            <label>{BOARD_MATERIAL_TH[mat as BoardMaterial]}</label>
            <span>{a.toFixed(2)} ตร.ม.</span>
          </div>
        ))}
        <div className="row">
          <label>ปิดขอบ</label>
          <span>{(parts.edgeBandTotal / 1000).toFixed(2)} ม.</span>
        </div>
      </div>
    </>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

createRoot(document.getElementById('root')!).render(<App />);
