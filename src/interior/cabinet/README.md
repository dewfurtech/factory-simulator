# เครื่องยนต์ตู้บิ้วอินและเฟอร์นิเจอร์ (เฟส 2)

โมดูลแยกสำหรับโหมดตกแต่งภายใน (`docs/interior-plan.md` เฟส 2) ยังไม่ถูกต่อเข้าแอป ไม่แตะไฟล์อื่นของโปรเจกต์
หน้าทดสอบด้วยตา: `npm run dev` แล้วเปิด `http://localhost:<พอร์ต>/dev/cabinet.html`

## ไฟล์

| ไฟล์                 | หน้าที่                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `spec.ts`            | `CabinetSpec` ตู้หนึ่งใบ (มม.) และ `normalizeSpec(partial)` เติมค่าเริ่มต้นตามชนิดตู้                                               |
| `parts.ts`           | ฟังก์ชันล้วน: `cabinetPieces(spec)` แผ่นทุกชิ้นพร้อมตำแหน่ง, `cabinetParts(spec)` รายการตัด พื้นที่ ตร.ม. ต่อวัสดุ และความยาวปิดขอบ |
| `cabinet3d.ts`       | `buildCabinet(spec, opts)` สร้าง `THREE.Group` จากชิ้นใน parts.ts, `setOpen(group, 0..1)` เปิดบาน/ดึงลิ้นชัก                        |
| `furnitureShapes.ts` | รูปทรงเฟอร์นิเจอร์ `(size, color) => THREE.Group` และ `FURNITURE_SHAPES` (ชื่อไทย ขนาดเริ่มต้น สี)                                  |

## Spec

```ts
const spec = normalizeSpec({
  kind: 'base', // 'base' ตู้ล่าง | 'wall' ตู้แขวน | 'tall' ตู้สูง | 'open' ชั้นเปิด
  width: 1200,
  height: 850,
  depth: 600,
  bays: [{ front: { kind: 'double' } }, { front: { kind: 'drawers', tiers: 3 } }], // หรือย่อ: ['double', 'drawers']
  boardThickness: 18, // 16 | 18 | 25
  carcassMaterial: 'particle',
  frontMaterial: 'mdf',
  backMaterial: 'plywood', // particle | mdf | hmr | plywood | teak | neem
  toeKick: 100, // ฐานปิดสูง 0 = ไม่มี
  top: { thickness: 25 }, // null = ไม่มีท็อป
});
```

ช่องแต่ละช่องเป็น `door` (บานพับ `left`/`right`), `double` (บานคู่), `drawers` (จำนวนชั้น) หรือ `open` พร้อม `shelves` จำนวนชั้นวาง

## วิธีประกอบที่โค้ดสมมติ

ตู้แบบกล่อง (frameless): แผ่นข้างสูงเต็ม แผ่นบน-ล่างอยู่ระหว่างแผ่นข้าง แผ่นหลังฝังในกล่องชิดหลัง
หน้าบานและหน้าลิ้นชักปิดทับเต็ม (full overlay) หนาเท่าแผ่นโครง กล่องจึงลึกเท่า ลึกรวม − หนาบาน
เว้นช่องรอบบาน `gap` (เริ่มต้น 3 มม.) ฐานเป็นกรอบ 4 แผ่นร่นจากหน้า `toeKickRecess`
กล่องลิ้นชักเว้นข้างละ `drawerSideClearance` สำหรับรางลิ้นชัก ค่าเหล่านี้แก้ได้ใน spec ทุกตัว ไม่มีราคาหรือสเปกสินค้าที่แต่งขึ้น

ปิดขอบนับเฉพาะขอบที่มองเห็น: ขอบหน้าของแผ่นข้าง บน ล่าง กั้นช่อง ชั้นวาง, ขอบทั้ง 4 ด้านของหน้าบาน/หน้าลิ้นชัก, ขอบบนของผนังกล่องลิ้นชัก, ขอบหน้าและสองข้างของท็อป

## หน่วยและพิกัด

spec และ parts ใช้ มม. 3D ใช้เมตร (มม. × 0.001 เหมือน `src/view3d/building3d.ts`) ทุกชิ้นวางกลาง x/z ยืนบน y = 0 ด้านหน้าหัน +z
เหมือน `builtinGeometry` ใน `src/view3d/furniture3d.ts` จึงวางลงฉากได้แบบเดียวกับเฟอร์นิเจอร์เดิม (ตั้ง position และ rotation.y ของ group)
วัสดุใช้ `FLAT` ที่แชร์จาก `src/view3d/lowpoly.ts` ทิ้งด้วย `disposeCabinet(group)` (ไม่ลบ material ที่แชร์)

## ต่อเข้า InteriorEditor (เฟส 1) ทีหลัง

1. เก็บตู้ในโปรเจกต์เป็นวัตถุชนิดใหม่ที่มี `spec: CabinetSpec` (บันทึกแค่ spec ส่วนอื่นคำนวณใหม่ได้เสมอ) ขนาดในแปลน 2D คือ `spec.width × spec.depth`
2. ในฉาก 3D ของ interior: `buildCabinet(spec, { colors: { front: สีจาก Mood & Tone } })` แทนเรขาคณิตของวัตถุนั้น ปุ่ม "เปิดตู้" เรียก `setOpen(group, 1)` / `setOpen(group, 0)` บนทุก group ที่ `isCabinet(o)`
3. แผงแก้ไขใช้ฟอร์มแบบเดียวกับ `dev/cabinet.tsx` แล้ว `normalizeSpec({ ...spec, ...แก้ไข })`
4. BOQ (เฟส 3) อ่าน `cabinetParts(spec).areaByMaterial` และ `edgeBandTotal` รวมทุกตู้ แล้วแปลงเป็นจำนวนแผ่นตามขนาดแผ่นและเปอร์เซ็นต์เผื่อตัดที่ผู้ใช้ตั้งเอง
5. เฟอร์นิเจอร์รูปทรงอื่น: `FURNITURE_SHAPES[id].build(size, color)` ใช้กับแท็บ "ของฉัน" ได้ตรง ๆ
