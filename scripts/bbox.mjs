// Measures each Mastrox model (without its moving workpiece) for the catalog: footprint size and the offset of its centre.
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
const THREE = await import('three');
const { MODELS } = await import('../src/machines/registry.js');
const out = {};
for (const [id, make] of Object.entries(MODELS)) {
  const m = make();
  if (m.workpiece) m.workpiece.removeFromParent();
  const o = m.object;
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  let meshes = 0, tris = 0;
  o.traverse((x) => { if (x.isMesh) { meshes++; const g = x.geometry; tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (x.isInstancedMesh ? x.count : 1); } });
  out[id] = { size: [b.max.x - b.min.x, b.max.z - b.min.z, b.max.y].map((v) => Math.round(v * 1000)), center: [(b.max.x + b.min.x) / 2, (b.max.z + b.min.z) / 2].map((v) => Math.round(v * 1000)) };
  console.error(id, JSON.stringify(out[id]), 'meshes', meshes, 'tris', Math.round(tris));
}
console.log(JSON.stringify(out, null, 1));
