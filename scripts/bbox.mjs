// Measures each Mastrox model (its visible parts, without the moving workpiece or operator floor pads) for the catalog: footprint size and the offset of its centre.
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : (t[k] ?? (() => ctx))), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = {
  createElement: () => ({ getContext: () => ctx, width: 0, height: 0, dataset: {} }),
  // rakete-real.js adds a font link and waits for the font.
  querySelector: () => null,
  head: { appendChild: () => {} },
  fonts: { load: async () => [] },
};
const { MODELS } = await import('../src/machines/registry.js');
const { visibleBounds } = await import('../src/machines/bounds.js');
const out = {};
for (const [id, make] of Object.entries(MODELS)) {
  const m = make();
  if (m.workpiece) m.workpiece.removeFromParent();
  // The yellow operator floor pads are not part of the machine's footprint.
  for (const c of [...m.object.children]) if (c.userData.operatorZone) c.removeFromParent();
  const o = m.object;
  const b = visibleBounds(o);
  let meshes = 0,
    tris = 0;
  o.traverseVisible((x) => {
    if (x.isMesh) {
      meshes++;
      const g = x.geometry;
      tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (x.isInstancedMesh ? x.count : 1);
    }
  });
  out[id] = {
    size: [b.max.x - b.min.x, b.max.z - b.min.z, b.max.y].map((v) => Math.round(v * 1000)),
    center: [(b.max.x + b.min.x) / 2, (b.max.z + b.min.z) / 2].map((v) => Math.round(v * 1000)),
  };
  console.error(id, JSON.stringify(out[id]), 'meshes', meshes, 'tris', Math.round(tris));
}
console.log(JSON.stringify(out, null, 1));
