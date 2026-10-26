/**
 * ถอดปริมาณ: ผิว + สเปกวัสดุ → บรรทัด BOQ (จำนวนแผ่น/กล่อง/ม้วน/แกลลอน/เมตร พร้อมหมายเหตุวิธีคิด)
 *
 * ไม่มีราคาในไฟล์นี้ ตัวเลขเดียวที่เป็นค่าเริ่มต้นคือ % เผื่อตัดตามลายปู (PATTERN_WASTE_PCT) ซึ่งผู้ใช้ตั้งทับได้
 */
import type { BoqLine, CabinetPartSummary, FurnitureItem, LayPattern, MaterialSpec, PieceCount, Surface, TakeOffOptions } from './types';

/**
 * % เผื่อตัดเริ่มต้นตามลายปู ใช้เฉพาะเมื่อคิดจากสูตรพื้นที่ (ไม่รู้ขนาดห้อง) และผู้ใช้ไม่ได้ตั้ง wastePct เอง
 *
 * ที่มา: ตัวเลขที่ผู้ผลิต/ผู้จำหน่ายกระเบื้องและไม้พื้นแนะนำกันทั่วไปในคู่มือคำนวณปริมาณ
 * (เช่น เครื่องคำนวณของร้านวัสดุและสมาคมกระเบื้อง TCNA): ปูตรง/ก่ออิฐ ≈ 10%, ปูทแยง ≈ 15%,
 * ก้างปลา ≈ 15% (บางแห่งแนะนำถึง 20% เพราะทุกแถวริมต้องตัดเฉียง) — ลายที่แผ่นริมถูกตัดเฉียงจึงเผื่อมากกว่าปูตรง
 */
export const PATTERN_WASTE_PCT: Record<LayPattern, number> = { straight: 10, brick: 10, diagonal: 15, herringbone: 15 };

const M2 = 1e6;
const fmt = (n: number, d = 2) => {
  const s = n.toFixed(d);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};
const ceilTo = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const uniq = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);

/** การนับแผ่นบนสี่เหลี่ยม W×H ด้วยแผ่น tw×th: แถวคี่เลื่อน `offsetMm` (0 = ปูตรง, tw/2 = ก่ออิฐ) */
export function countPiecesOnRect(W: number, H: number, tw: number, th: number, offsetMm = 0): { full: number; cut: number; total: number } {
  if (W <= 0 || H <= 0 || tw <= 0 || th <= 0) return { full: 0, cut: 0, total: 0 };
  const rows = Math.ceil(H / th - 1e-9);
  const fullRows = Math.floor(H / th + 1e-9);
  // แถวปกติ (ดัชนีคู่) และแถวเลื่อน (ดัชนีคี่)
  const rowsA = Math.ceil(rows / 2);
  const rowsB = Math.floor(rows / 2);
  const fullRowsA = Math.ceil(fullRows / 2);
  const fullRowsB = Math.floor(fullRows / 2);
  // แถวปกติเริ่มที่ x=0: แผ่นที่แตะ [0,W) = ceil(W/tw) แผ่นเต็ม = floor(W/tw)
  const totalA = Math.ceil(W / tw - 1e-9);
  const fullA = Math.floor(W / tw + 1e-9);
  // แถวเลื่อนเริ่มที่ x=-offset: แผ่นที่แตะ [0,W) = ceil((W+offset)/tw) แผ่นเต็มคือแผ่นที่ขอบซ้าย ≥ 0 และขอบขวา ≤ W
  const totalB = offsetMm > 0 ? Math.ceil((W + offsetMm) / tw - 1e-9) : totalA;
  const fullB = offsetMm > 0 ? Math.max(0, Math.floor((W - offsetMm) / tw + 1e-9)) : fullA;
  const full = fullRowsA * fullA + fullRowsB * fullB;
  const total = rowsA * totalA + rowsB * totalB;
  return { full, cut: total - full, total };
}

/** วางได้บนสี่เหลี่ยมคลุมเฉพาะปูตรง/ก่ออิฐ ลายทแยงและก้างปลาต้องกลับไปใช้สูตรพื้นที่ */
const layoutPattern = (p: LayPattern): boolean => p === 'straight' || p === 'brick';

interface PieceResult extends PieceCount {
  /** พื้นที่ที่ซื้อ (ม²) = จำนวนแผ่น × พื้นที่แผ่น */
  grossM2: number;
  notes: string[];
}

/** นับแผ่น tile/sheet ของผิวชุดหนึ่ง */
function piecesFor(surfaces: Surface[], tw: number, th: number, pattern: LayPattern, wastePct: number | undefined): PieceResult {
  const pieceM2 = (tw * th) / M2;
  let full = 0;
  let cut = 0;
  let layoutTotal = 0;
  let formulaAreaM2 = 0;
  let laidOut = 0;
  const notes: string[] = [];
  for (const s of surfaces) {
    if (s.boundsMm && layoutPattern(pattern)) {
      const offset = pattern === 'brick' ? tw / 2 : 0;
      const c = countPiecesOnRect(s.boundsMm.w, s.boundsMm.h, tw, th, offset);
      full += c.full;
      cut += c.cut;
      layoutTotal += c.total;
      laidOut++;
      const boxArea = (s.boundsMm.w * s.boundsMm.h) / M2;
      const extra = boxArea > s.areaMm2 / M2 + 1e-6 ? ` (กรอบ ${fmt(boxArea)} ม² ใหญ่กว่าผิว ${fmt(s.areaMm2 / M2)} ม² นับเต็มกรอบ)` : '';
      notes.push(
        `${s.room}: วาง${pattern === 'brick' ? 'ก่ออิฐ' : 'ตรง'}บน ${s.boundsMm.w}×${s.boundsMm.h} มม. ด้วยแผ่น ${tw}×${th} → ${Math.ceil(s.boundsMm.w / tw - 1e-9)}×${Math.ceil(s.boundsMm.h / th - 1e-9)} ตำแหน่ง เต็ม ${c.full} ตัด ${c.cut}${extra}`,
      );
    } else formulaAreaM2 += s.areaMm2 / M2;
  }
  const formulaUsed = formulaAreaM2 > 0 || laidOut === 0;
  // เผื่อ: นับจากการวางจริง → ไม่เผื่อเว้นแต่ผู้ใช้ตั้ง (เศษตัดถูกนับเป็นแผ่นแล้ว) · สูตรพื้นที่ → ค่าตามลายปู
  const layoutWaste = wastePct ?? 0;
  const waste = wastePct ?? (formulaUsed ? PATTERN_WASTE_PCT[pattern] : 0);
  let total = layoutTotal;
  if (layoutWaste > 0 && layoutTotal > 0) {
    total = Math.ceil(layoutTotal * (1 + layoutWaste / 100) - 1e-9);
    notes.push(`เผื่อ ${fmt(layoutWaste)}% จาก ${layoutTotal} แผ่น → ${total} แผ่น`);
  }
  if (formulaUsed && formulaAreaM2 > 0) {
    const netPieces = formulaAreaM2 / pieceM2;
    const grossPieces = Math.ceil(netPieces * (1 + waste / 100) - 1e-9);
    total += grossPieces;
    notes.push(
      `${laidOut ? 'ส่วนที่ไม่รู้ขนาด: ' : ''}${fmt(formulaAreaM2)} ม² ÷ (${tw}×${th} มม. = ${fmt(pieceM2, 4)} ม²/แผ่น) = ${fmt(netPieces)} แผ่น เผื่อ ${fmt(waste)}% (ลาย${patternName(pattern)}) → ${grossPieces} แผ่น`,
    );
  }
  const method: PieceCount['method'] = laidOut === 0 ? 'formula' : formulaAreaM2 > 0 ? 'mixed' : 'layout';
  return {
    full: method === 'layout' ? full : null,
    cut: method === 'layout' ? cut : null,
    total,
    method,
    grossM2: round(total * pieceM2),
    notes: [...notes, ...(method === 'mixed' ? [`แผ่นเต็ม/ตัดนับได้เฉพาะผิวที่รู้ขนาด: เต็ม ${full} ตัด ${cut}`] : [])],
  };
}

const PATTERN_NAME: Record<LayPattern, string> = { straight: 'ปูตรง', brick: 'ก่ออิฐ', herringbone: 'ก้างปลา', diagonal: 'ทแยง' };
const patternName = (p: LayPattern) => PATTERN_NAME[p];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function purchaseOfPieces(total: number, perBox: number | undefined, pieceWord: string) {
  if (perBox && perBox > 0) return { unit: 'กล่อง', qty: Math.ceil(total / perBox - 1e-9), perUnit: perBox, perUnitLabel: `${perBox} ${pieceWord}/กล่อง` };
  return { unit: pieceWord, qty: total };
}

/** บรรทัดของวัสดุหนึ่งชนิดจากผิวทั้งหมดที่ใช้มัน */
export function materialLine(mat: MaterialSpec, surfaces: Surface[], wasteOverride?: number): BoqLine {
  const rooms = uniq(surfaces.map((s) => s.room));
  const netM2 = round(sum(surfaces.map((s) => s.areaMm2)) / M2);
  const waste = wasteOverride ?? mat.wastePct;
  const base = { id: mat.id, item: mat.name, category: 'surface' as const, rooms };
  const u = mat.unit;
  switch (u.kind) {
    case 'tile':
    case 'sheet': {
      const size = u.kind === 'tile' ? u.tileMm : u.sheetMm;
      const pattern: LayPattern = u.kind === 'tile' ? (u.pattern ?? 'straight') : 'straight';
      const p = piecesFor(surfaces, size.w, size.h, pattern, waste);
      const purchase = purchaseOfPieces(p.total, mat.perBox, 'แผ่น');
      const wasteUsed = waste ?? (p.method === 'layout' ? 0 : PATTERN_WASTE_PCT[pattern]);
      const buy = purchase.unit === 'กล่อง' ? ` → ${purchase.qty} กล่อง (${purchase.perUnitLabel})` : '';
      return {
        ...base,
        qtyUnit: 'ตร.ม.',
        net: netM2,
        gross: p.grossM2,
        wastePct: wasteUsed,
        purchase,
        pieces: { full: p.full, cut: p.cut, total: p.total, method: p.method },
        note: `${p.notes.join(' · ')} · รวม ${p.total} แผ่น${buy}`,
      };
    }
    case 'roll': {
      // แต่ละผิวที่รู้ขนาด: วางแถบตามด้านใดด้านหนึ่ง เลือกทางที่ใช้ความยาวน้อยกว่า · ไม่รู้ขนาด: พื้นที่ ÷ ความกว้างม้วน
      const notes: string[] = [];
      let lengthMm = 0;
      for (const s of surfaces) {
        if (s.boundsMm) {
          const { w, h } = s.boundsMm;
          const alongH = Math.ceil(w / u.widthMm - 1e-9) * h;
          const alongW = Math.ceil(h / u.widthMm - 1e-9) * w;
          const pick = Math.min(alongH, alongW);
          lengthMm += pick;
          const strips = pick === alongH ? Math.ceil(w / u.widthMm - 1e-9) : Math.ceil(h / u.widthMm - 1e-9);
          notes.push(`${s.room}: ${strips} แถบ กว้าง ${u.widthMm} มม. ยาว ${pick === alongH ? h : w} มม. = ${fmt(pick / 1000)} ม.`);
        } else {
          const len = s.areaMm2 / u.widthMm;
          lengthMm += len;
          notes.push(`${s.room}: ${fmt(s.areaMm2 / M2)} ม² ÷ กว้าง ${u.widthMm} มม. = ${fmt(len / 1000)} ม.`);
        }
      }
      const w = waste ?? 0;
      const grossLen = lengthMm * (1 + w / 100);
      const rolls = Math.ceil(grossLen / u.lengthMm - 1e-9);
      return {
        ...base,
        qtyUnit: 'ตร.ม.',
        net: netM2,
        gross: round((grossLen * u.widthMm) / M2),
        wastePct: w,
        purchase: { unit: 'ม้วน', qty: rolls, perUnit: u.lengthMm / 1000, perUnitLabel: `${fmt(u.lengthMm / 1000)} ม./ม้วน` },
        note: `${notes.join(' · ')} · รวม ${fmt(lengthMm / 1000)} ม.${w ? ` เผื่อ ${fmt(w)}% = ${fmt(grossLen / 1000)} ม.` : ''} ÷ ${fmt(u.lengthMm / 1000)} ม./ม้วน → ${rolls} ม้วน`,
      };
    }
    case 'area': {
      const w = waste ?? 0;
      const gross = round(netM2 * (1 + w / 100));
      const step = u.stepM2 ?? 0.01;
      const qty = round(ceilTo(gross, step));
      return {
        ...base,
        qtyUnit: 'ตร.ม.',
        net: netM2,
        gross,
        wastePct: w,
        purchase: { unit: 'ตร.ม.', qty },
        note: `พื้นที่ ${fmt(netM2)} ม²${w ? ` เผื่อ ${fmt(w)}% = ${fmt(gross)} ม²` : ''}${step !== 0.01 ? ` ปัดขึ้นทุก ${fmt(step)} ม² → ${fmt(qty)} ม²` : ''}`,
      };
    }
    case 'paint': {
      const w = waste ?? 0;
      const gross = round(netM2 * (1 + w / 100));
      const unitName = u.unitName ?? 'แกลลอน';
      const needed = (gross * u.coats) / u.coverageM2PerUnit;
      const qty = Math.ceil(needed - 1e-9);
      return {
        ...base,
        qtyUnit: 'ตร.ม.',
        net: netM2,
        gross,
        wastePct: w,
        purchase: { unit: unitName, qty, perUnit: u.coverageM2PerUnit, perUnitLabel: `${fmt(u.coverageM2PerUnit)} ม²/${unitName}/ชั้น` },
        note: `${fmt(netM2)} ม²${w ? ` เผื่อ ${fmt(w)}% = ${fmt(gross)} ม²` : ''} × ${u.coats} ชั้น ÷ ${fmt(u.coverageM2PerUnit)} ม²/${unitName} = ${fmt(needed)} → ${qty} ${unitName}`,
      };
    }
    case 'linear': {
      const netM = round(sum(surfaces.map((s) => s.perimeterMm ?? 0)) / 1000);
      const w = waste ?? 0;
      const gross = round(netM * (1 + w / 100));
      const wasteNote = w ? ` เผื่อ ${fmt(w)}% = ${fmt(gross)} ม.` : '';
      if (u.pieceLengthMm && u.pieceLengthMm > 0) {
        const pieces = Math.ceil((gross * 1000) / u.pieceLengthMm - 1e-9);
        return {
          ...base,
          qtyUnit: 'ม.',
          net: netM,
          gross,
          wastePct: w,
          purchase: { unit: 'เส้น', qty: pieces, perUnit: u.pieceLengthMm / 1000, perUnitLabel: `${fmt(u.pieceLengthMm / 1000)} ม./เส้น` },
          note: `ความยาว ${fmt(netM)} ม.${wasteNote} ÷ ${fmt(u.pieceLengthMm / 1000)} ม./เส้น → ${pieces} เส้น`,
        };
      }
      return {
        ...base,
        qtyUnit: 'ม.',
        net: netM,
        gross,
        wastePct: w,
        purchase: { unit: 'ม.', qty: round(ceilTo(gross, 0.1)) },
        note: `ความยาว ${fmt(netM)} ม.${wasteNote} ปัดขึ้นทุก 0.1 ม.`,
      };
    }
  }
}

/** ผิวที่อ้าง materialId ซึ่งไม่มีสเปก: ลงพื้นที่ไว้ให้เห็น ไม่แปลงหน่วย */
function unknownMaterialLine(id: string, surfaces: Surface[]): BoqLine {
  const netM2 = round(sum(surfaces.map((s) => s.areaMm2)) / M2);
  return {
    id,
    item: id,
    category: 'surface',
    rooms: uniq(surfaces.map((s) => s.room)),
    qtyUnit: 'ตร.ม.',
    net: netM2,
    gross: netM2,
    wastePct: 0,
    purchase: { unit: 'ตร.ม.', qty: netM2 },
    note: 'ไม่พบสเปกวัสดุ ลงพื้นที่สุทธิไว้เท่านั้น',
  };
}

/** เฟอร์นิเจอร์: รวมจำนวนตามชื่อ+ขนาด */
export function furnitureLines(items: FurnitureItem[]): BoqLine[] {
  const groups = new Map<string, FurnitureItem[]>();
  for (const it of items) {
    const key = `${it.name}|${it.sizeMm.w}x${it.sizeMm.d}x${it.sizeMm.h}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return [...groups.entries()].map(([key, its]) => {
    const qty = sum(its.map((i) => i.qty));
    const { sizeMm: s, name } = its[0];
    return {
      id: `furniture:${key}`,
      item: name,
      category: 'furniture',
      rooms: uniq(its.map((i) => i.room ?? '').filter(Boolean)),
      qtyUnit: 'ชิ้น',
      net: qty,
      gross: qty,
      wastePct: 0,
      purchase: { unit: 'ชิ้น', qty },
      note: `ขนาด ${s.w}×${s.d}×${s.h} มม. นับจากชิ้นที่วางในห้อง`,
    };
  });
}

/** ตู้บิ้วอิน: พื้นที่แผ่นต่อวัสดุ → จำนวนแผ่น (ถ้ารู้ขนาดแผ่น) และความยาวปิดขอบ */
export function cabinetLines(parts: CabinetPartSummary[], materials: MaterialSpec[], wasteOverride: Record<string, number> = {}): BoqLine[] {
  const byMat = new Map<string, CabinetPartSummary[]>();
  for (const p of parts) byMat.set(p.material, [...(byMat.get(p.material) ?? []), p]);
  const lines: BoqLine[] = [];
  for (const [matId, ps] of byMat) {
    const mat = materials.find((m) => m.id === matId);
    const areaM2 = round(sum(ps.map((p) => p.areaM2)));
    const labels = uniq(ps.map((p) => p.label ?? '').filter(Boolean));
    const name = mat?.name ?? matId;
    if (mat && mat.unit.kind === 'sheet') {
      // แผ่นชิ้นส่วนตู้ตัดจากแผ่นใหญ่ ไม่รู้แพตเทิร์นการตัด (nesting) จึงคิดจากพื้นที่ + % เผื่อเหมือนปูตรง
      const w = wasteOverride[matId] ?? mat.wastePct ?? PATTERN_WASTE_PCT.straight;
      const sheetM2 = (mat.unit.sheetMm.w * mat.unit.sheetMm.h) / M2;
      const netSheets = areaM2 / sheetM2;
      const total = Math.ceil(netSheets * (1 + w / 100) - 1e-9);
      const purchase = purchaseOfPieces(total, mat.perBox, 'แผ่น');
      lines.push({
        id: matId,
        item: name,
        category: 'cabinet',
        rooms: labels,
        qtyUnit: 'ตร.ม.',
        net: areaM2,
        gross: round(total * sheetM2),
        wastePct: w,
        purchase,
        pieces: { full: null, cut: null, total, method: 'formula' },
        note: `ชิ้นส่วนตู้ ${fmt(areaM2)} ม² ÷ แผ่น ${mat.unit.sheetMm.w}×${mat.unit.sheetMm.h} มม. (${fmt(sheetM2, 3)} ม²) = ${fmt(netSheets)} แผ่น เผื่อตัด ${fmt(w)}% → ${total} แผ่น`,
      });
    } else {
      const w = wasteOverride[matId] ?? mat?.wastePct ?? 0;
      const gross = round(areaM2 * (1 + w / 100));
      lines.push({
        id: matId,
        item: name,
        category: 'cabinet',
        rooms: labels,
        qtyUnit: 'ตร.ม.',
        net: areaM2,
        gross,
        wastePct: w,
        purchase: { unit: 'ตร.ม.', qty: gross },
        note: `ชิ้นส่วนตู้ ${fmt(areaM2)} ม²${w ? ` เผื่อ ${fmt(w)}%` : ''}${mat ? '' : ' (ไม่พบสเปกวัสดุ)'}`,
      });
    }
    const edgeM = round(sum(ps.map((p) => p.edgeBandM)));
    if (edgeM > 0)
      lines.push({
        id: `${matId}:edge`,
        item: `ปิดขอบ ${name}`,
        category: 'cabinet',
        rooms: labels,
        qtyUnit: 'ม.',
        net: edgeM,
        gross: edgeM,
        wastePct: 0,
        purchase: { unit: 'ม.', qty: round(ceilTo(edgeM, 0.1)) },
        note: `ความยาวขอบที่ต้องปิดจากชิ้นส่วนตู้ ${fmt(edgeM)} ม. ปัดขึ้นทุก 0.1 ม.`,
      });
  }
  return lines;
}

/**
 * ถอดปริมาณทั้งหมด: ผิวจัดกลุ่มตาม materialId (เรียงตามลำดับที่พบ) ตามด้วยเฟอร์นิเจอร์และตู้บิ้วอินใน options
 */
export function takeOff(surfaces: Surface[], materials: MaterialSpec[], options: TakeOffOptions = {}): BoqLine[] {
  const byMat = new Map<string, Surface[]>();
  for (const s of surfaces) byMat.set(s.materialId, [...(byMat.get(s.materialId) ?? []), s]);
  const lines: BoqLine[] = [];
  for (const [id, ss] of byMat) {
    const mat = materials.find((m) => m.id === id);
    lines.push(mat ? materialLine(mat, ss, options.wastePct?.[id]) : unknownMaterialLine(id, ss));
  }
  if (options.furniture?.length) lines.push(...furnitureLines(options.furniture));
  if (options.cabinetParts?.length) lines.push(...cabinetLines(options.cabinetParts, materials, options.wastePct));
  return lines;
}
