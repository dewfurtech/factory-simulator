// Trims a downloaded character .glb for the scale figure in the catalog: keeps the meshes, skin and skeleton, the
// base colour texture and the standing (idle) animation; drops the other animations and the normal / roughness maps,
// then repacks the binary buffer so the dropped data leaves the file.
//   node scripts/person-glb.mjs <in.glb> public/models/person.glb
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/person-glb.mjs <in.glb> <out.glb>');
  process.exit(1);
}
const KEEP_ANIMS = ['Rig|idle'];

const src = readFileSync(input);
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen));

json.animations = (json.animations ?? []).filter((a) => KEEP_ANIMS.includes(a.name));

// Materials keep only their base colour.
for (const m of json.materials ?? []) {
  delete m.normalTexture;
  delete m.occlusionTexture;
  delete m.emissiveTexture;
  if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture;
}
const usedTextures = new Set();
for (const m of json.materials ?? []) {
  const t = m.pbrMetallicRoughness?.baseColorTexture;
  if (t) usedTextures.add(t.index);
}
const texMap = new Map([...usedTextures].sort((a, b) => a - b).map((i, k) => [i, k]));
json.textures = [...texMap.keys()].map((i) => json.textures[i]);
for (const m of json.materials ?? []) {
  const t = m.pbrMetallicRoughness?.baseColorTexture;
  if (t) t.index = texMap.get(t.index);
}
const imgMap = new Map([...new Set(json.textures.map((t) => t.source))].sort((a, b) => a - b).map((i, k) => [i, k]));
json.images = [...imgMap.keys()].map((i) => json.images[i]);
for (const t of json.textures) t.source = imgMap.get(t.source);
const smpMap = new Map([...new Set(json.textures.map((t) => t.sampler).filter((s) => s != null))].map((i, k) => [i, k]));
json.samplers = [...smpMap.keys()].map((i) => json.samplers[i]);
for (const t of json.textures) if (t.sampler != null) t.sampler = smpMap.get(t.sampler);

// Accessors still referenced.
const usedAcc = new Set();
for (const m of json.meshes ?? [])
  for (const p of m.primitives) {
    for (const a of Object.values(p.attributes)) usedAcc.add(a);
    if (p.indices != null) usedAcc.add(p.indices);
    for (const t of p.targets ?? []) for (const a of Object.values(t)) usedAcc.add(a);
  }
for (const s of json.skins ?? []) if (s.inverseBindMatrices != null) usedAcc.add(s.inverseBindMatrices);
for (const a of json.animations)
  for (const s of a.samplers) {
    usedAcc.add(s.input);
    usedAcc.add(s.output);
  }
const accMap = new Map([...usedAcc].sort((a, b) => a - b).map((i, k) => [i, k]));
json.accessors = [...accMap.keys()].map((i) => json.accessors[i]);
for (const m of json.meshes ?? [])
  for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices != null) p.indices = accMap.get(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = accMap.get(t[k]);
  }
for (const s of json.skins ?? []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
for (const a of json.animations)
  for (const s of a.samplers) {
    s.input = accMap.get(s.input);
    s.output = accMap.get(s.output);
  }

// The animation is kept as its first frame only: the figure stands still, so one key is the whole pose.
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const elemSize = (a) => SIZES[a.componentType] * COUNTS[a.type];
for (const a of json.animations)
  for (const s of a.samplers) {
    if (s.interpolation === 'CUBICSPLINE') throw new Error('cubic spline animation not handled');
    for (const i of [s.input, s.output]) json.accessors[i].count = 1;
    const t = json.accessors[s.input];
    if (t.min) t.max = [...t.min];
  }

// Each accessor gets a buffer view of just the bytes it reads, the images theirs; packed one after another, 4-byte aligned.
const chunks = [];
let offset = 0;
const views = [];
function push(data, extra = {}) {
  const pad = (4 - (data.length % 4)) % 4;
  chunks.push(data, Buffer.alloc(pad));
  views.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...extra });
  offset += data.length + pad;
  return views.length - 1;
}
for (const a of json.accessors) {
  if (a.bufferView == null) continue;
  const bv = json.bufferViews[a.bufferView];
  const size = elemSize(a);
  const stride = bv.byteStride ?? size;
  const from = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const data = bin.subarray(from, from + (a.count - 1) * stride + size);
  const extra = {};
  if (bv.byteStride && a.count > 1) extra.byteStride = bv.byteStride;
  if (bv.target) extra.target = bv.target;
  a.bufferView = push(data, extra);
  delete a.byteOffset;
}
for (const i of json.images) {
  if (i.bufferView == null) continue;
  const bv = json.bufferViews[i.bufferView];
  i.bufferView = push(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
}
json.bufferViews = views;
const newBin = Buffer.concat(chunks);
json.buffers = [{ byteLength: newBin.length }];

let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(jsonBuf.length, 0);
jsonHead.writeUInt32LE(0x4e4f534a, 4);
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(newBin.length, 0);
binHead.writeUInt32LE(0x004e4942, 4);
writeFileSync(output, Buffer.concat([header, jsonHead, jsonBuf, binHead, newBin]));
console.log(`${output}: ${src.length} -> ${12 + 16 + jsonBuf.length + newBin.length} bytes, ${json.animations.length} animation(s), ${json.images.length} image(s)`);
