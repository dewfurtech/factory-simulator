import * as THREE from 'three';

// Box around the parts of a model that are shown, in world space. The models keep switched-off
// options (a 3500A's conveyor and lift table) as hidden parts, which Box3.setFromObject would count.
export function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    if (o.isInstancedMesh) o.computeBoundingBox();
    else if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.isInstancedMesh ? o.boundingBox : o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    out.union(b);
  });
  return out;
}
