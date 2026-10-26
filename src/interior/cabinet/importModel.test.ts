import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { classifyFile, colladaAsset, countTriangles, extensionOf, guessUnit, importModelFile, ModelImportError, pickModelFile, placeOnFloor, SKP_MESSAGE } from './importModel';

describe('file names', () => {
  it('reads the extension in lower case, ignoring folders and dots in names', () => {
    expect(extensionOf('Kitchen.Cabinet.DAE')).toBe('dae');
    expect(extensionOf('C:\\models\\sofa.obj')).toBe('obj');
    expect(extensionOf('models/v1.2/README')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });

  it('sorts what a picked file is', () => {
    expect(classifyFile('a.skp')).toBe('skp');
    expect(classifyFile('a.dae')).toBe('dae');
    expect(classifyFile('a.OBJ')).toBe('obj');
    expect(classifyFile('a.mtl')).toBe('mtl');
    expect(classifyFile('a.glb')).toBe('glb');
    expect(classifyFile('a.gltf')).toBe('gltf');
    expect(classifyFile('wood.JPG')).toBe('texture');
    expect(classifyFile('notes.txt')).toBe('other');
  });

  it('picks the model out of several dropped files and keeps the rest as companions', () => {
    const files = [new File([''], 'oak.png'), new File([''], 'desk.mtl'), new File([''], 'desk.obj')];
    const { model, companions } = pickModelFile(files);
    expect(model?.name).toBe('desk.obj');
    expect(companions.map((f) => f.name)).toEqual(['oak.png', 'desk.mtl']);
  });
});

describe('guessUnit', () => {
  it('reads large numbers as millimetres, without a warning', () => {
    expect(guessUnit(2200)).toEqual({ unit: 'mm', sure: true });
    expect(guessUnit(100.5).unit).toBe('mm');
  });

  it('reads 1 to 100 as centimetres, with a warning that it may be inches', () => {
    const g = guessUnit(86.6);
    expect(g.unit).toBe('cm');
    expect(g.sure).toBe(false);
    expect(g.warning).toContain('เซนติเมตร');
    expect(g.warning).toContain('นิ้ว');
    expect(guessUnit(1).unit).toBe('cm');
    expect(guessUnit(100).unit).toBe('cm');
  });

  it('reads under 1 as metres, with a warning', () => {
    const g = guessUnit(0.85);
    expect(g.unit).toBe('m');
    expect(g.warning).toBeDefined();
  });
});

describe('colladaAsset', () => {
  it('reads the unit and up axis SketchUp writes', () => {
    const dae = `<?xml version="1.0"?><COLLADA><asset><contributor><authoring_tool>SketchUp 23.1</authoring_tool></contributor>
      <unit meter="0.0254" name="inch" /><up_axis>Z_UP</up_axis></asset><library_geometries/></COLLADA>`;
    expect(colladaAsset(dae)).toEqual({ meter: 0.0254, unitName: 'inch', upAxis: 'Z_UP' });
  });

  it('gives nulls when the asset leaves them out', () => {
    expect(colladaAsset('<COLLADA><asset></asset></COLLADA>')).toEqual({ meter: null, unitName: null, upAxis: null });
  });
});

describe('placeOnFloor', () => {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.position.set(x, y, z);
    return m;
  };

  it('stands the model on y = 0, centred in x and z, and reports its size in mm', () => {
    // A 600 × 850 × 400 box (file units, mm) floating off-centre.
    const model = box(600, 850, 400, 1000, 500, -300);
    const { group, sizeMm } = placeOnFloor(model, 0.001);
    expect(sizeMm).toEqual({ w: 600, d: 400, h: 850 });
    group.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(group, true);
    expect(b.min.y).toBeCloseTo(0, 9);
    expect(b.max.y).toBeCloseTo(0.85, 9);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 9);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 9);
  });

  it('turns a Z-up model upright', () => {
    // 2 wide, 1 deep and 3 tall along z, as SketchUp draws it.
    const { group, sizeMm } = placeOnFloor(box(2, 1, 3, 0, 0, 1.5), 1, true);
    expect(sizeMm).toEqual({ w: 2000, d: 1000, h: 3000 });
    group.updateWorldMatrix(true, true);
    expect(new THREE.Box3().setFromObject(group, true).min.y).toBeCloseTo(0, 9);
  });

  it('counts the triangles of meshes only', () => {
    const g = new THREE.Group();
    g.add(box(1, 1, 1, 0, 0, 0));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))));
    expect(countTriangles(g)).toBe(12);
  });
});

describe('importModelFile', () => {
  it('refuses a .skp with how to export from SketchUp', async () => {
    const err = await importModelFile(new File(['x'], 'ครัว.skp')).catch((e) => e);
    expect(err).toBeInstanceOf(ModelImportError);
    expect(err.code).toBe('skp');
    expect(err.message).toBe(SKP_MESSAGE);
    expect(err.message).toContain('File → Export → 3D Model');
    expect(err.message).toContain('COLLADA (.dae)');
  });

  it('refuses a file it cannot read, naming the formats it can', async () => {
    const err = await importModelFile(new File(['x'], 'plan.dwg')).catch((e) => e);
    expect(err.code).toBe('unsupported');
    expect(err.message).toContain('.dae');
  });

  // OBJ parses without a DOM, so the whole path runs here: a 600 × 850 × 400 mm box, its corner at the origin.
  const cubeObj = (s: [number, number, number]) => {
    const [x, y, z] = s;
    const v = [
      [0, 0, 0],
      [x, 0, 0],
      [x, y, 0],
      [0, y, 0],
      [0, 0, z],
      [x, 0, z],
      [x, y, z],
      [0, y, z],
    ];
    const f = [
      [1, 2, 3, 4],
      [5, 8, 7, 6],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 8, 4],
      [5, 1, 4, 8],
    ];
    return [...v.map((p) => `v ${p.join(' ')}`), ...f.map((q) => `f ${q.join(' ')}`)].join('\n');
  };

  it('reads an OBJ in mm, stands it on the floor and counts its triangles', async () => {
    const r = await importModelFile(new File([cubeObj([600, 850, 400])], 'box.obj'));
    expect(r.format).toBe('obj');
    expect(r.unit).toBe('mm');
    expect(r.sizeMm).toEqual({ w: 600, d: 400, h: 850 });
    expect(r.triangles).toBe(12);
    expect(r.warnings).toEqual([]);
    r.group.updateWorldMatrix(true, true);
    expect(new THREE.Box3().setFromObject(r.group, true).min.y).toBeCloseTo(0, 9);
  });

  it('guesses centimetres for a small OBJ with a warning, and takes the unit the caller sets', async () => {
    const text = cubeObj([60, 85, 40]);
    const guessed = await importModelFile(new File([text], 'box.obj'));
    expect(guessed.unit).toBe('cm');
    expect(guessed.unitSure).toBe(false);
    expect(guessed.sizeMm).toEqual({ w: 600, d: 400, h: 850 });
    expect(guessed.warnings).toHaveLength(1);
    const inches = await importModelFile(new File([text], 'box.obj'), { unit: 'inch' });
    expect(inches.sizeMm).toEqual({ w: 1524, d: 1016, h: 2159 });
    expect(inches.warnings).toEqual([]);
  });

  it('warns when an OBJ names a material file that was not picked', async () => {
    const r = await importModelFile(new File([`mtllib box.mtl\n${cubeObj([600, 850, 400])}`], 'box.obj'));
    expect(r.warnings.some((w) => w.includes('.mtl'))).toBe(true);
  });
});
