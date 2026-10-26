import * as THREE from 'three';

/**
 * Bringing a model drawn elsewhere (mostly SketchUp) into the interior scene.
 *
 * SketchUp's own .skp is a closed format with no reader for the browser (its SDK is desktop C++ only), so a .skp is
 * refused with how to export it instead. What SketchUp can export, and what is read here:
 * - COLLADA .dae: every SketchUp edition, Free and Web included. The file carries its unit (`<unit meter=…>`) and up
 *   axis (`<up_axis>`); three's ColladaLoader already scales by the unit and turns a Z-up file to Y-up.
 * - OBJ .obj (+ .mtl and textures picked alongside): no unit in the file, so it is guessed from the size (below)
 *   and can be set by the caller. SketchUp's OBJ export swaps to Y-up by default; a Z-up file can be turned.
 * - glTF .glb / .gltf: metres and Y-up by the standard.
 *
 * The result is a group in scene metres, standing on y = 0 and centred in x and z, as every other piece of furniture.
 * The loaders are imported only when a file is read, so the helpers here load without WebGL or a DOM (for tests).
 */

export type ModelFormat = 'dae' | 'obj' | 'gltf' | 'glb';
export type FileKind = ModelFormat | 'skp' | 'mtl' | 'texture' | 'other';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'inch';

export const UNIT_TO_M: Record<LengthUnit, number> = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 };
export const UNIT_TH: Record<LengthUnit, string> = { mm: 'มิลลิเมตร', cm: 'เซนติเมตร', m: 'เมตร', inch: 'นิ้ว' };

/** Models with more triangles than this get a warning (they are not simplified). */
export const TRIANGLE_WARN = 200_000;

export const SKP_MESSAGE =
  'ไฟล์ .skp ของ SketchUp เปิดในเบราว์เซอร์ไม่ได้ (เป็นฟอร์แมตปิด) ให้เปิดโมเดลใน SketchUp แล้วไปที่ File → Export → 3D Model เลือกชนิดไฟล์ COLLADA (.dae) หรือ OBJ (.obj) แล้วนำไฟล์ที่ได้มาใส่แทน';

export class ModelImportError extends Error {
  constructor(
    message: string,
    readonly code: 'skp' | 'unsupported' | 'no-model' | 'empty' | 'parse',
  ) {
    super(message);
    this.name = 'ModelImportError';
  }
}

const TEXTURE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff']);

/** The lower-case extension of a file name, without the dot ('' when none). */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

/** What a picked file is to the importer. */
export function classifyFile(name: string): FileKind {
  const ext = extensionOf(name);
  if (ext === 'dae' || ext === 'obj' || ext === 'gltf' || ext === 'glb' || ext === 'skp' || ext === 'mtl') return ext;
  if (TEXTURE_EXT.has(ext)) return 'texture';
  return 'other';
}

/**
 * The unit of a file that names none (OBJ), from its largest extent in file units: over 100 is read as millimetres
 * (a piece of furniture in mm runs to hundreds or thousands); 1 to 100 as centimetres, though it may as well be
 * inches; under 1 as metres. Anything but millimetres comes with a warning, so the caller can set the unit.
 */
export function guessUnit(maxExtent: number): { unit: LengthUnit; sure: boolean; warning?: string } {
  if (maxExtent > 100) return { unit: 'mm', sure: true };
  if (maxExtent >= 1)
    return {
      unit: 'cm',
      sure: false,
      warning: `ไฟล์ไม่ระบุหน่วย ด้านยาวสุด ${round(maxExtent)} หน่วย จึงเดาว่าเป็นเซนติเมตร ถ้าโมเดลเป็นนิ้วหรือหน่วยอื่น ให้เลือกหน่วยเอง`,
    };
  return {
    unit: 'm',
    sure: false,
    warning: `ไฟล์ไม่ระบุหน่วย ด้านยาวสุด ${round(maxExtent)} หน่วย จึงเดาว่าเป็นเมตร ถ้าไม่ใช่ ให้เลือกหน่วยเอง`,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The `<unit meter>` and `<up_axis>` a COLLADA file declares, read from its text (null when missing). */
export function colladaAsset(text: string): { meter: number | null; unitName: string | null; upAxis: 'X_UP' | 'Y_UP' | 'Z_UP' | null } {
  const asset = /<asset[\s>][\s\S]*?<\/asset>/i.exec(text)?.[0] ?? '';
  const unitTag = /<unit\b[^>]*>/i.exec(asset)?.[0] ?? '';
  const meter = /\bmeter\s*=\s*["']([^"']+)["']/i.exec(unitTag)?.[1];
  const unitName = /\bname\s*=\s*["']([^"']+)["']/i.exec(unitTag)?.[1] ?? null;
  const up = /<up_axis>\s*([XYZ]_UP)\s*<\/up_axis>/i.exec(asset)?.[1]?.toUpperCase() as 'X_UP' | 'Y_UP' | 'Z_UP' | undefined;
  const m = meter !== undefined ? parseFloat(meter) : NaN;
  return { meter: Number.isFinite(m) && m > 0 ? m : null, unitName, upAxis: up ?? null };
}

/** Triangles drawn by the meshes under `o` (lines and points are not counted). */
export function countTriangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    n += Math.floor((g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3);
  });
  return n;
}

/** The box around everything under `o`, in the frame of `o`'s parent (its own transform included). */
function boxInParent(o: THREE.Object3D): THREE.Box3 {
  const parent = o.parent;
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(o, true);
  if (parent) box.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert());
  return box;
}

/**
 * Wraps a loaded model so it stands on y = 0, centred in x and z, `scale` times its own size, turned from Z-up to
 * Y-up when asked. Returns the wrapper and the size it ends up, in mm.
 */
export function placeOnFloor(model: THREE.Object3D, scale = 1, zUp = false): { group: THREE.Group; sizeMm: { w: number; d: number; h: number } } {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(scale);
  if (zUp) holder.rotation.x = -Math.PI / 2;
  holder.add(model);
  group.add(holder);
  const box = boxInParent(holder);
  if (box.isEmpty()) return { group, sizeMm: { w: 0, d: 0, h: 0 } };
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  const s = box.getSize(new THREE.Vector3());
  const mm = (v: number) => Math.round(v * 10000) / 10;
  return { group, sizeMm: { w: mm(s.x), d: mm(s.z), h: mm(s.y) } };
}

export interface ImportOptions {
  /** Files picked with the model: an OBJ's .mtl, and textures any format refers to (matched by file name). */
  companions?: File[];
  /** The model's unit, overriding the file's own (COLLADA) or the guess (OBJ). */
  unit?: LengthUnit;
  /** Turn a Z-up model to Y-up (OBJ and glTF; a COLLADA file says its own axis). */
  zUp?: boolean;
}

export interface ImportedModel {
  group: THREE.Group;
  sizeMm: { w: number; d: number; h: number };
  triangles: number;
  warnings: string[];
  format: ModelFormat;
  /** The unit the model was read in, and whether that came from the file or the caller rather than a guess. */
  unit: LengthUnit | null;
  unitSure: boolean;
}

/** Picks the model out of several dropped files: the first .dae/.obj/.glb/.gltf, or a .skp to refuse. */
export function pickModelFile(files: File[]): { model: File | null; companions: File[] } {
  const model = files.find((f) => ['dae', 'obj', 'gltf', 'glb', 'skp'].includes(classifyFile(f.name))) ?? null;
  return { model, companions: files.filter((f) => f !== model) };
}

/** Blob URLs for the companion files, by lower-case base name, for the loaders to find textures and materials in. */
function companionManager(companions: File[]): { manager: THREE.LoadingManager; revoke: () => void; missing: Set<string> } {
  const urls = new Map<string, string>();
  for (const f of companions) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const missing = new Set<string>();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop() ?? url).toLowerCase();
    const hit = urls.get(base);
    if (!hit) missing.add(base);
    return hit ?? url;
  });
  let pending = false;
  let parsed = false;
  const revokeNow = () => {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
  };
  manager.onStart = () => (pending = true);
  manager.onLoad = () => parsed && revokeNow();
  return {
    manager,
    missing,
    // After parsing: free the URLs now if nothing is loading, else once the textures are in.
    revoke: () => {
      parsed = true;
      if (!pending) revokeNow();
    },
  };
}

/** Reads one model file (with its companions) into a group ready to place in the scene. */
export async function importModelFile(file: File, opts: ImportOptions = {}): Promise<ImportedModel> {
  const kind = classifyFile(file.name);
  if (kind === 'skp') throw new ModelImportError(SKP_MESSAGE, 'skp');
  if (kind !== 'dae' && kind !== 'obj' && kind !== 'gltf' && kind !== 'glb')
    throw new ModelImportError(`เปิดไฟล์ "${file.name}" ไม่ได้ รองรับเฉพาะ .dae (COLLADA), .obj, .glb และ .gltf`, 'unsupported');

  const warnings: string[] = [];
  const companions = opts.companions ?? [];
  const { manager, revoke, missing } = companionManager(companions);
  let model: THREE.Object3D;
  let scale = 1;
  let unit: LengthUnit | null = opts.unit ?? null;
  let unitSure = !!opts.unit;
  let zUp = !!opts.zUp;

  try {
    if (kind === 'dae') {
      const text = await file.text();
      const asset = colladaAsset(text);
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const result = new ColladaLoader(manager).parse(text, '');
      if (!result?.scene) throw new ModelImportError(`อ่านไฟล์ COLLADA "${file.name}" ไม่สำเร็จ`, 'parse');
      model = result.scene;
      // The loader has applied the file's unit (1 m when none is declared) and turned a Z-up file.
      if (asset.meter === null) warnings.push('ไฟล์ COLLADA ไม่ระบุหน่วย อ่านเป็นเมตรตามมาตรฐาน ถ้าขนาดผิด ให้เลือกหน่วยเอง');
      if (opts.unit) scale = UNIT_TO_M[opts.unit] / (asset.meter ?? 1);
      else {
        unit = unitFromMeter(asset.meter ?? 1);
        unitSure = asset.meter !== null;
      }
      if (asset.upAxis === 'X_UP') warnings.push('ไฟล์ใช้แกน X ขึ้นด้านบน ซึ่งไม่ได้แปลงให้ โมเดลอาจนอนตะแคง');
      zUp = false;
    } else if (kind === 'obj') {
      const text = await file.text();
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const loader = new OBJLoader(manager);
      const mtlFile = companions.find((f) => classifyFile(f.name) === 'mtl');
      if (mtlFile) {
        const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
        const materials = new MTLLoader(manager).parse(await mtlFile.text(), '');
        materials.preload();
        loader.setMaterials(materials);
      } else if (/^\s*mtllib\s/m.test(text)) warnings.push('โมเดลอ้างถึงไฟล์วัสดุ .mtl ที่ไม่ได้เลือกมาด้วย จึงแสดงเป็นสีเทา');
      model = loader.parse(text);
      if (!opts.unit) {
        const raw = boxInParent(model).getSize(new THREE.Vector3());
        const g = guessUnit(Math.max(raw.x, raw.y, raw.z));
        unit = g.unit;
        unitSure = false;
        if (g.warning) warnings.push(g.warning);
      }
      scale = UNIT_TO_M[unit!];
    } else {
      const data = await file.arrayBuffer();
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader(manager).parseAsync(kind === 'glb' ? data : new TextDecoder().decode(data), '');
      model = gltf.scene;
      unit = opts.unit ?? 'm';
      unitSure = true;
      scale = UNIT_TO_M[unit];
    }
  } catch (e) {
    revoke();
    if (e instanceof ModelImportError) throw e;
    throw new ModelImportError(`อ่านไฟล์ "${file.name}" ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`, 'parse');
  }
  revoke();

  const triangles = countTriangles(model);
  if (triangles === 0) throw new ModelImportError(`ไม่พบพื้นผิวในไฟล์ "${file.name}"`, 'empty');
  if (triangles > TRIANGLE_WARN)
    warnings.push(`โมเดลมี ${triangles.toLocaleString('th-TH')} สามเหลี่ยม เกิน ${TRIANGLE_WARN.toLocaleString('th-TH')} อาจทำให้ฉากช้า ลองลดรายละเอียดใน SketchUp ก่อนส่งออก`);
  if (missing.size) warnings.push(`ไม่พบไฟล์ภาพพื้นผิว: ${[...missing].join(', ')} (เลือกไฟล์ภาพมาพร้อมโมเดลเพื่อให้แสดงลาย)`);

  prepareMeshes(model);
  const { group, sizeMm } = placeOnFloor(model, scale, zUp);
  group.name = file.name;
  group.userData.importedModel = true;
  return { group, sizeMm, triangles, warnings, format: kind, unit, unitSure };
}

/**
 * Readies loaded meshes for the scene: normals where the file has none (else lit faces draw black), both sides of
 * every face drawn (SketchUp models often have faces turned inside out), and shadows on.
 */
export function prepareMeshes(model: THREE.Object3D): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.side = THREE.DoubleSide;
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

function unitFromMeter(meter: number): LengthUnit | null {
  for (const [u, m] of Object.entries(UNIT_TO_M) as Array<[LengthUnit, number]>) if (Math.abs(m - meter) < 1e-9) return u;
  return null;
}
