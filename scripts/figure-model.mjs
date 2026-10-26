// Makes public/models/business-man.glb, the 3D body of the man scale figure, from the Sketchfab download:
// "Business Man - Low Polygon game character" by manoeldarochadeoliveira, CC-BY-4.0
// https://sketchfab.com/3d-models/business-man-low-polygon-game-character-b6f6740f883b4749abac47af0045a9dd
//
//   node scripts/figure-model.mjs [path/to/business_man_-_low_polygon_game_character.glb]
//
// Keeps the mesh, its skin and only the idle animation; leaves out the tangents and the second UV set the material
// never reads; and re-encodes the three textures as JPEG through the Playwright browser's canvas (as photos.mjs
// does), the colour at 1024 px and the normal and occlusion/roughness maps at 512. About 6 MB comes down to well
// under 1 MB. The author's credit stays in the file's asset.extras.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SRC = process.argv[2] ?? `${homedir()}/Downloads/business_man_-_low_polygon_game_character.glb`;
const OUT = 'public/models/business-man.glb';
const KEEP_ANIMATION = 'Rig|idle';
const DROP_ATTRIBUTES = new Set(['TANGENT', 'TEXCOORD_1']);
/** Longest side per image, by what the material uses it for. */
const IMAGE_SIZE = { baseColor: 1024, normal: 512, orm: 512 };

const glb = readFileSync(SRC);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${SRC} is not a GLB file`);
const jsonLen = glb.readUInt32LE(12);
const src = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));

const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// ---- The new file: accessors and images copied into tight buffer views, one after another.
const out = { ...src, accessors: [], bufferViews: [], buffers: [], images: [] };
const chunks = [];
let offset = 0;
const pushView = (bytes, target) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  offset += pad;
  out.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target && { target }) });
  chunks.push(bytes);
  offset += bytes.length;
  return out.bufferViews.length - 1;
};

const accessorMap = new Map();
/** Copies accessor `i` element by element (its view may be interleaved) and returns its new index. */
function keepAccessor(i, target) {
  if (accessorMap.has(i)) return accessorMap.get(i);
  const a = src.accessors[i];
  const view = src.bufferViews[a.bufferView];
  const size = COMPONENT[a.componentType] * COUNT[a.type];
  const stride = view.byteStride ?? size;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const bytes = Buffer.alloc(size * a.count);
  for (let k = 0; k < a.count; k++) bin.copy(bytes, k * size, start + k * stride, start + k * stride + size);
  const copy = { ...a, bufferView: pushView(bytes, target), byteOffset: 0 };
  out.accessors.push(copy);
  accessorMap.set(i, out.accessors.length - 1);
  return out.accessors.length - 1;
}

out.meshes = src.meshes.map((m) => ({
  ...m,
  primitives: m.primitives.map((p) => {
    const attributes = {};
    for (const [name, i] of Object.entries(p.attributes)) if (!DROP_ATTRIBUTES.has(name)) attributes[name] = keepAccessor(i, 34962);
    return { ...p, attributes, ...(p.indices !== undefined && { indices: keepAccessor(p.indices, 34963) }) };
  }),
}));
out.skins = src.skins.map((s) => ({ ...s, ...(s.inverseBindMatrices !== undefined && { inverseBindMatrices: keepAccessor(s.inverseBindMatrices) }) }));
const idle = src.animations.find((a) => a.name === KEEP_ANIMATION);
if (!idle) throw new Error(`no animation ${KEEP_ANIMATION}`);
out.animations = [{ ...idle, samplers: idle.samplers.map((s) => ({ ...s, input: keepAccessor(s.input), output: keepAccessor(s.output) })) }];
for (const a of out.accessors) if (a.bufferView === undefined) throw new Error('accessor without data');

// ---- Images: which map each one is, then smaller JPEGs.
const roleOf = new Map();
for (const mat of src.materials) {
  const role = (t, r) => t && roleOf.set(src.textures[t.index].source, r);
  role(mat.pbrMetallicRoughness?.baseColorTexture, 'baseColor');
  role(mat.normalTexture, 'normal');
  role(mat.pbrMetallicRoughness?.metallicRoughnessTexture, 'orm');
  role(mat.occlusionTexture, 'orm');
}
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [i, im] of src.images.entries()) {
  const v = src.bufferViews[im.bufferView];
  const data = `data:${im.mimeType};base64,` + bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength).toString('base64');
  const max = IMAGE_SIZE[roleOf.get(i) ?? 'baseColor'];
  const jpeg = await page.evaluate(
    async ([url, max]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    },
    [data, max],
  );
  out.images.push({ ...(im.name && { name: im.name }), mimeType: 'image/jpeg', bufferView: pushView(Buffer.from(jpeg.split(',')[1], 'base64')) });
}
await browser.close();

// ---- Write the GLB: header, JSON chunk (space padded), BIN chunk (zero padded).
const binOut = Buffer.concat(chunks);
const binPad = Buffer.concat([binOut, Buffer.alloc((4 - (binOut.length % 4)) % 4)]);
out.buffers = [{ byteLength: binPad.length }];
const json = Buffer.from(JSON.stringify(out), 'utf8');
const jsonPad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
const chunkHead = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
mkdirSync('public/models', { recursive: true });
writeFileSync(OUT, Buffer.concat([header, chunkHead(jsonPad.length, 0x4e4f534a), jsonPad, chunkHead(binPad.length, 0x004e4942), binPad]));
console.log(`${OUT}: ${(glb.length / 1e6).toFixed(1)} MB -> ${(header.readUInt32LE(8) / 1e6).toFixed(2)} MB`);
