# เครื่องคิดปริมาณ BOQ (`src/interior/boq/`)

โมดูลล้วนสำหรับเฟส 3 ของ `docs/interior-plan.md` ไม่มี UI, ไม่มี React, ไม่ import three.js และไม่ import จากโมดูลของเฟส 1/2
ทุกอย่างเข้าทาง `index.ts`

**ไม่มีราคาหรือสเปกสมมติในโมดูล** ราคาทุกช่องมาจากผู้ใช้ (ว่างได้) ขนาดแผ่น/ม้วน/การครอบคลุมของสีเป็นพารามิเตอร์ของ `MaterialSpec`
ค่าเริ่มต้นที่มีให้คือขนาดมาตรฐานที่ใช้กันจริงใน `STANDARD` (ระบุที่มาใน `types.ts`) และ % เผื่อตามลายปูใน `PATTERN_WASTE_PCT` (ระบุที่มาใน `quantities.ts`) ผู้ใช้ตั้งทับได้ทุกค่า

## ข้อมูลเข้า (`types.ts`)

| ชนิด                 | ใช้ทำอะไร                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Surface`            | ผิวหนึ่งผิว: `room`, `kind` (`floor`/`wall`/`ceiling`), `areaMm2` สุทธิ, `perimeterMm?` (ใช้กับวัสดุเส้น), `boundsMm?` (กรอบสี่เหลี่ยมคลุม ใช้นับแผ่นจากการวางจริง), `materialId`                                                        |
| `MaterialSpec`       | `id`, `name` (ไทย), `unit`, `perBox?`, `wastePct?`                                                                                                                                                                                       |
| `MaterialUnit`       | `tile` (แผ่น w×h + ลาย `straight`/`brick`/`herringbone`/`diagonal`) · `sheet` (แผ่นใหญ่ w×h) · `roll` (กว้าง × ยาวต่อม้วน) · `area` (ตร.ม. ตรง ๆ) · `paint` (ตร.ม./หน่วย/ชั้น × จำนวนชั้น) · `linear` (เมตร หรือเส้นยาว `pieceLengthMm`) |
| `FurnitureItem`      | เฟอร์นิเจอร์จาก objects: `name`, `qty`, `sizeMm {w,d,h}`, `room?`                                                                                                                                                                        |
| `CabinetPartSummary` | จากเฟส 2: `material`, `areaM2`, `edgeBandM`, `label?`                                                                                                                                                                                    |

## API

```ts
import { takeOff, quote, boqCsv, quoteCsv, boqMarkdown, roomWallSurface, rectSurface, skirtingSurface } from './interior/boq';

const lines = takeOff(surfaces, materials, { wastePct: { tile600: 5 }, furniture, cabinetParts });
const q = quote(lines, priceBook, { vatPct: 7 }); // vatPct ไม่ตั้ง = ไม่คิด VAT
download(boqCsv(lines));
download(quoteCsv(q)); // UTF-8 มี BOM, CRLF
```

- `takeOff(surfaces, materials, options)` → `BoqLine[]` รวมผิวตาม `materialId` (เรียงตามลำดับที่พบ) แล้วต่อด้วยเฟอร์นิเจอร์และตู้บิ้วอิน
  ทุกบรรทัดมี `item`, `qtyUnit`, `net` (สุทธิ), `wastePct`, `gross` (รวมเผื่อ), `purchase` (หน่วยซื้อที่ปัดขึ้นแล้ว), `pieces?` (แผ่นเต็ม/ตัด/รวม) และ `note` (วิธีคิดภาษาไทย ตรวจตามได้)
- **tile/sheet**
  - มี `boundsMm` และลายปูตรงหรือก่ออิฐ: วางแผ่นจริงจากมุมห้องบนกรอบ นับแผ่นเต็มกับแผ่นตัด ไม่เผื่อเพิ่มเว้นแต่ผู้ใช้ตั้ง `wastePct` (เศษตัดถูกนับเป็นแผ่นอยู่แล้ว) ห้องไม่ใช่สี่เหลี่ยมนับเต็มกรอบและหมายเหตุบอกไว้
  - ไม่มี `boundsMm` หรือลายก้างปลา/ทแยง: พื้นที่ ÷ พื้นที่แผ่น × (1 + % เผื่อ) ปัดขึ้น แผ่นเต็ม/ตัดเป็น `null`
  - `perBox` ให้มา → ซื้อเป็นกล่อง
- **roll**: มีกรอบ → จำนวนแถบ × ความยาวแถบ (เลือกแนวที่สั้นกว่า) · ไม่มี → พื้นที่ ÷ ความกว้าง แล้ว ÷ ความยาวม้วน ปัดขึ้น
- **paint**: พื้นที่ × จำนวนชั้น ÷ ครอบคลุมต่อหน่วย ปัดขึ้น
- **linear**: ใช้ `perimeterMm` ของผิว (บัวพื้นใช้ `skirtingSurface` ที่หักประตูแล้ว)
- **ตู้บิ้วอิน**: วัสดุที่เป็น `sheet` → พื้นที่ ÷ พื้นที่แผ่น + % เผื่อ (ไม่ได้ทำ nesting) และบรรทัด `<material>:edge` สำหรับปิดขอบ
- `walls.ts`: `netWallAreaMm2(length, height, openings)`, `skirtingLengthMm(perimeter, openings)` (หักเฉพาะประตู), `roomWallSurface`, `rectSurface`, `skirtingSurface`
- `quote(lines, priceBook, { vatPct })`: `PriceBook = Record<lineId, { unitPrice?, laborPerUnit? }>`
  ค่าวัสดุ = จำนวนหน่วยซื้อ × `unitPrice`, ค่าแรง = ปริมาณสุทธิ × `laborPerUnit` บรรทัดที่ไม่ใส่ทั้งสองช่องเป็น "ยังไม่ใส่ราคา" และไม่นับในยอด
  `Quote` บอก `pricedCount`, `unpricedCount`, `unpricedItems`; `quoteSummary(q)` ให้ข้อความสรุป
- `csv.ts`: `boqCsv`, `quoteCsv`, `toCsv`, `markdownTable`, `boqMarkdown`, `quoteMarkdown`

## เฟส 1 จะแปลง `Room.finish` + เรขาคณิตห้องเป็น `Surface[]` อย่างไร (ยังไม่ได้ทำ)

ต่อห้องที่มี `finish`:

1. **พื้น** (`finish.floor`): `areaMm2` = พื้นที่รูปหลายเหลี่ยมของห้อง (ตัวคิดพื้นที่ใน `src/model/areas.ts`) และ `boundsMm` = กว้าง × ยาว ของกรอบสี่เหลี่ยมคลุมรูปห้อง ถ้าห้องหมุนเอียง ให้ใช้กรอบในแกนของห้องเอง
2. **ฝ้า** (`finish.ceiling`): เหมือนพื้น `kind: 'ceiling'`
3. **ผนัง** (`finish.wall` หรือ `Wall.finish` ที่ทับค่าของห้อง): ต่อผนังหนึ่งด้านที่ล้อมห้อง ทำ `Surface` หนึ่งผิว
   `areaMm2 = netWallAreaMm2(ความยาวด้านในห้อง, ความสูงห้อง, ประตู/หน้าต่างบนผนังนั้น)` และ `boundsMm = { w: ความยาว, h: ความสูง }`
   ถ้าทุกด้านใช้วัสดุเดียวกันและไม่ต้องแยกด้าน ใช้ `roomWallSurface(room, เส้นรอบรูป, ความสูง, ช่องเปิดทั้งหมด, materialId)` ได้เลย
4. **บัวพื้น** (ถ้าเฟส 1 มีช่องให้เลือก): `skirtingSurface(room, เส้นรอบรูป, ประตูของห้อง, materialId)`
5. `MaterialSpec[]` มาจากคลังวัสดุ `src/interior/materials.ts` ของเฟส 1: เพิ่มฟิลด์ `unit`/`perBox` ที่ผู้ใช้แก้ได้ หรือสร้าง `MaterialSpec` จากข้อมูลนั้นตอนเรียก `takeOff`
   วัสดุที่ไม่มีสเปกยังขึ้นใน BOQ เป็น ตร.ม. พร้อมหมายเหตุ "ไม่พบสเปกวัสดุ"
6. เฟอร์นิเจอร์: แปลง objects ในห้องเป็น `FurnitureItem` (ชื่อ, 1 ชิ้น, ขนาดจาก catalog) แล้วส่งใน `options.furniture` ตู้บิ้วอินจากเฟส 2 ส่งใน `options.cabinetParts`

## ตัวอย่างตรวจด้วยมือ (อยู่ในเทสต์)

ห้อง 4000×5000 มม. (20 ม²) เส้นรอบรูป 18 ม. สูง 2600 ประตู 900×2000

| กรณี                                 | วิธีคิด                                                   | ผล                        |
| ------------------------------------ | --------------------------------------------------------- | ------------------------- |
| กระเบื้อง 600×600 ปูตรง 4 แผ่น/กล่อง | ⌈4000/600⌉ × ⌈5000/600⌉ = 7×9 = 63 ตำแหน่ง, เต็ม 6×8 = 48 | เต็ม 48 ตัด 15 → 16 กล่อง |
| ไม้ 100×400 ก้างปลา 20 แผ่น/กล่อง    | 20 ÷ 0.04 = 500 × 1.15                                    | 575 แผ่น → 29 กล่อง       |
| สีผนัง 2 ชั้น 35 ม²/แกลลอน           | (46.8 − 1.8) = 45 × 2 ÷ 35 = 2.57                         | 3 แกลลอน                  |
| บัวพื้นเส้น 2.4 ม.                   | 18 − 0.9 = 17.1 ÷ 2.4 = 7.1                               | 8 เส้น                    |
