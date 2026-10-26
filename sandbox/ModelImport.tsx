import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { importModelFile, ModelImportError, pickModelFile, UNIT_TH, type ImportedModel, type LengthUnit } from '../src/interior/cabinet/importModel';

/**
 * The test page's import box: drop (or pick) a model exported from SketchUp with its .mtl and textures, see the size
 * read from it and any warnings, and set the unit or the up axis when the guess is wrong.
 */
export function ModelImport({ onModel }: { onModel: (g: THREE.Group | null) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [unit, setUnit] = useState<LengthUnit | ''>('');
  const [zUp, setZUp] = useState(false);
  const [result, setResult] = useState<ImportedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!files.length) return;
    const { model, companions } = pickModelFile(files);
    if (!model) {
      setError('ไม่พบไฟล์โมเดลในที่เลือกมา รองรับ .dae, .obj, .glb และ .gltf');
      setResult(null);
      onModel(null);
      return;
    }
    let live = true;
    setBusy(true);
    importModelFile(model, { companions, unit: unit || undefined, zUp })
      .then((r) => {
        if (!live) return;
        setResult(r);
        setError(null);
        onModel(r.group);
      })
      .catch((e) => {
        if (!live) return;
        setResult(null);
        setError(e instanceof ModelImportError || e instanceof Error ? e.message : String(e));
        onModel(null);
      })
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [files, unit, zUp]);

  const take = (list: FileList | null) => list && list.length && setFiles([...list]);

  return (
    <>
      <div
        className={`cab-drop${over ? ' over' : ''}`}
        data-testid="model-drop"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <b>{busy ? 'กำลังอ่านโมเดล…' : 'ลากไฟล์โมเดลมาวาง หรือคลิกเลือก'}</b>
        <span>.dae (COLLADA) · .obj + .mtl · .glb / .gltf เลือกไฟล์ภาพพื้นผิวมาพร้อมกันได้</span>
        <input ref={input} type="file" multiple hidden accept=".dae,.obj,.mtl,.glb,.gltf,.skp,image/*" onChange={(e) => take(e.target.files)} />
      </div>
      <div className="two">
        <label className="field">
          <span>หน่วยของโมเดล</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit | '')}>
            <option value="">ตามไฟล์ / เดาให้</option>
            {(Object.keys(UNIT_TH) as LengthUnit[]).map((u) => (
              <option key={u} value={u}>
                {UNIT_TH[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="cab-check" title="สำหรับ OBJ / glTF ที่ส่งออกโดยไม่สลับแกน Y-Z">
          <input type="checkbox" checked={zUp} onChange={(e) => setZUp(e.target.checked)} />
          แกน Z ขึ้นบน
        </label>
      </div>
      {error && <div className="cab-msg error">{error}</div>}
      {result && (
        <div className="cab-totals">
          <span>ไฟล์</span>
          <b>{result.group.name}</b>
          <span>ขนาด ก × ล × ส</span>
          <b>
            {fmt(result.sizeMm.w)} × {fmt(result.sizeMm.d)} × {fmt(result.sizeMm.h)} มม.
          </b>
          <span>หน่วยที่อ่าน</span>
          <b>{result.unit ? `${UNIT_TH[result.unit]}${result.unitSure ? '' : ' (เดา)'}` : 'อื่น ๆ ตามไฟล์'}</b>
          <span>สามเหลี่ยม</span>
          <b>{result.triangles.toLocaleString('th-TH')}</b>
        </div>
      )}
      {result?.warnings.map((w, i) => (
        <div key={i} className="cab-msg warn">
          {w}
        </div>
      ))}
    </>
  );
}

const fmt = (v: number) => Math.round(v).toLocaleString('th-TH');
