import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Icon } from '../editor2d/Toolbar';
import { visibleBounds } from '../machines/bounds.js';
import { disposeTree } from './lowpoly';
import { optionKey } from '../model/catalog';
import { liveMachine } from './machines3d';

/**
 * One machine's full 3D model (the detailed one, with its moving parts running) in its own small
 * scene. Two views: straight from the front (drag to turn, scroll to zoom), or straight down from
 * the top like a plan, flat (orthographic) and without shadow (drag to move, scroll to zoom).
 */
type ViewKind = 'front' | 'top';

export default function ModelViewer({ assetId, name, options }: { assetId: string; name: string; options?: readonly string[] }) {
  const optKey = optionKey(assetId, options);
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset(): void; setRunning(on: boolean): void; setView(v: ViewKind): void } | null>(null);
  const [running, setRunning] = useState(true);
  const [view, setView] = useState<ViewKind>('front');
  const [big, setBig] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current!;
    const live = liveMachine(assetId, { zones: true, options });
    if (!live) {
      setFailed(true);
      return;
    }
    setFailed(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    scene.environment = env;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8b95a1', 0.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun, sun.target);

    const model = live.object;
    scene.add(model);
    const box = visibleBounds(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 + 0.05;

    // A soft floor that only catches the machine's shadow.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(radius * 2.2, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, box.min.y, center.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const s = sun.shadow.camera;
    s.left = s.bottom = -radius * 1.5;
    s.right = s.top = radius * 1.5;
    s.near = 0.1;
    s.far = radius * 8;
    sun.position.copy(center).add(new THREE.Vector3(radius * 1.2, radius * 2.5, radius * 1.8));
    sun.target.position.copy(center);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.02, radius * 40);
    // Top view: looking straight down, front (+z) at the bottom of the picture as on the plan.
    const topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 40);
    topCam.up.set(0, 0, -1);
    let mode: ViewKind = 'front';
    let controls = makeControls();
    function makeControls() {
      const top = mode === 'top';
      const c = new OrbitControls(top ? topCam : camera, renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      if (top) {
        c.enableRotate = false;
        c.screenSpacePanning = true;
        c.mouseButtons.LEFT = THREE.MOUSE.PAN;
        c.touches.ONE = THREE.TOUCH.PAN;
        c.minZoom = 0.5;
        c.maxZoom = 8;
      } else {
        c.minDistance = radius * 0.6;
        c.maxDistance = radius * 8;
        c.maxPolarAngle = Math.PI * 0.49;
      }
      return c;
    }

    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    /**
     * Looks straight at the machine's front (+z, the side the model project draws as "ด้านหน้า"),
     * a little from above, and moves in or out until the model's box fills about 85% of the view.
     */
    const frameFront = () => {
      const dir = new THREE.Vector3(0, 0.2, 1).normalize();
      let dist = radius * 4;
      for (let i = 0; i < 4; i++) {
        camera.position.copy(center).addScaledVector(dir, dist);
        camera.lookAt(center);
        camera.updateMatrixWorld();
        const reach = Math.max(...corners.map((c) => {
          const p = c.clone().project(camera);
          return Math.max(Math.abs(p.x), Math.abs(p.y));
        }));
        dist *= reach / 0.85;
      }
      camera.position.copy(center).addScaledVector(dir, dist);
      controls.target.copy(center);
      controls.update();
    };
    /** Fits the machine's footprint into about 85% of the view, seen from straight above. */
    const frameTop = () => {
      const aspect = Math.max(0.1, el.clientWidth / Math.max(1, el.clientHeight));
      const half = Math.max(size.x / 2, (size.z / 2) * aspect) / 0.85;
      Object.assign(topCam, { left: -half, right: half, top: half / aspect, bottom: -half / aspect, zoom: 1 });
      topCam.position.set(center.x, box.max.y + radius * 4, center.z);
      topCam.lookAt(center.x, box.min.y, center.z);
      topCam.updateProjectionMatrix();
      controls.target.set(center.x, box.min.y, center.z);
      controls.update();
    };
    const frame = () => (mode === 'top' ? frameTop() : frameFront());
    // No shadow from above: the floor that catches it is hidden and the sun stops casting.
    const setShadows = (on: boolean) => {
      floor.visible = on;
      sun.castShadow = on;
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (mode === 'top') frameTop();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    frame();

    let run = true;
    api.current = {
      reset: frame,
      setRunning: (on) => void (run = on),
      setView: (v) => {
        if (v === mode) return;
        mode = v;
        controls.dispose();
        controls = makeControls();
        setShadows(v === 'front');
        frame();
      },
    };
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (run) live.update(dt);
      controls.update();
      renderer.render(scene, mode === 'top' ? topCam : camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeTree(model);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [assetId, optKey]);

  useEffect(() => api.current?.setRunning(running), [running, assetId, optKey]);
  useEffect(() => api.current?.setView(view), [view, assetId, optKey]);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setBig(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [big]);

  if (failed) return null;
  return (
    <div className={`model-viewer${big ? ' big' : ''}`} data-testid="model-viewer">
      <div ref={host} className="mv-canvas" aria-label={`โมเดล 3D ของ ${name}`} />
      {big && <div className="mv-title">{name}</div>}
      <div className="seg sm mv-views" role="tablist" aria-label="มุมมองโมเดล">
        {(
          [
            ['front', 'ด้านหน้า'],
            ['top', 'มุมบน'],
          ] as [ViewKind, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)} data-testid={`mv-${id}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mv-tools">
        <button className={`ib sm${running ? ' on' : ''}`} onClick={() => setRunning(!running)} title={running ? 'หยุดการเคลื่อนไหวของเครื่อง' : 'เดินเครื่อง'} aria-pressed={running}>
          <Icon name={running ? 'pause' : 'play'} />
        </button>
        <button className="ib sm" onClick={() => api.current?.reset()} title={view === 'top' ? 'พอดีกรอบ' : 'กลับไปมองด้านหน้า'}>
          <Icon name="fit" />
        </button>
        <button className="ib sm" onClick={() => setBig(!big)} title={big ? 'ย่อ (Esc)' : 'ขยายเต็มจอ'}>
          <Icon name={big ? 'close' : 'expand'} />
        </button>
      </div>
      <span className="mv-hint">{view === 'top' ? 'ลากเพื่อเลื่อน' : 'ลากเพื่อหมุน'} · เลื่อนลูกกลิ้งเพื่อซูม</span>
    </div>
  );
}
