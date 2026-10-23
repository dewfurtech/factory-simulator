// Measures each Mastrox model (its visible parts, without the moving workpiece or operator floor pads) for the catalog: footprint size and the offset of its centre.
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : (t[k] ?? (() => ctx))), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = {
  createElement: () => ({ getContext: () => ctx, width: 0, height: 0, dataset: {} }),
  // lib.js loads the logo artwork through Image and TextureLoader; neither arrives here, and the measurements don't need it.
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, src: '' }),
  // rakete-real.js adds a font link and waits for the font.
  querySelector: () => null,
  head: { appendChild: () => {} },
  fonts: { load: async () => [] },
};
globalThis.Image = class {
  constructor() {
    this.src = '';
  }
};
const { MODELS } = await import('../src/machines/registry.js');
const { visibleBounds } = await import('../src/machines/bounds.js');
const { MACHINES } = await import('../src/machines/data.js');
const out = {};

/** Footprint (mm) of a built model: its size and the offset of its centre from the origin. */
function measure(m) {
  if (m.workpiece) m.workpiece.removeFromParent();
  // The yellow operator floor pads are not part of the machine's footprint.
  for (const c of [...m.object.children]) if (c.userData.operatorZone) c.removeFromParent();
  const b = visibleBounds(m.object);
  return {
    size: [b.max.x - b.min.x, b.max.z - b.min.z, b.max.y].map((v) => Math.round(v * 1000)),
    center: [(b.max.x + b.min.x) / 2, (b.max.z + b.min.z) / 2].map((v) => Math.round(v * 1000)),
  };
}

for (const [id, make] of Object.entries(MODELS)) {
  const m = make();
  out[id] = measure(m);
  let meshes = 0,
    tris = 0;
  m.object.traverseVisible((x) => {
    if (x.isMesh) {
      meshes++;
      const g = x.geometry;
      tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (x.isInstancedMesh ? x.count : 1);
    }
  });
  // Machines with add-ons: the footprint with every combination ticked, keyed by the add-on ids in data order joined with '+'.
  const options = MACHINES.find((x) => x.id === id)?.options ?? [];
  if (options.length) {
    out[id].options = {};
    for (let mask = 1; mask < 1 << options.length; mask++) {
      const chosen = options.filter((_, i) => mask & (1 << i));
      const flags = Object.assign({}, ...chosen.map((o) => o.flags));
      out[id].options[chosen.map((o) => o.id).join('+')] = measure(make(flags));
    }
  }
  console.error(id, JSON.stringify(out[id]), 'meshes', meshes, 'tris', Math.round(tris));
}
console.log(JSON.stringify(out, null, 1));
