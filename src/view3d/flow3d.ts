import * as THREE from 'three';
import type { FlowKind } from '../model/utilityFlow';

/** A way the air or current goes, as a line in the scene, starting `from` m out from the source. */
export interface FlowTrack {
  kind: FlowKind;
  pts: THREE.Vector3[];
  from: number;
}

/** How each kind looks moving: its colour, the gap between pulses and how fast they go, m and m/s. */
const LOOK: Record<FlowKind, { color: string; r: number; gap: number; speed: number }> = {
  air: { color: '#5fd4ff', r: 0.03, gap: 0.55, speed: 1.4 },
  power: { color: '#ffb31a', r: 0.024, gap: 0.45, speed: 2.6 },
};

interface Line {
  pts: THREE.Vector3[];
  /** Distance to each point from the line's start, m. */
  at: number[];
  from: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Pulses of light running along the pipes and cables from the compressor and the main board out to each machine, so
 * which way they go and where they reach is plain at a glance. One instanced mesh per kind, moved every frame.
 */
export class FlowFx {
  readonly group = new THREE.Group();
  private kinds: { mesh: THREE.InstancedMesh; lines: Line[]; look: (typeof LOOK)[FlowKind] }[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'flow';
  }

  get empty(): boolean {
    return !this.kinds.length;
  }

  build(tracks: FlowTrack[]): void {
    this.clear();
    for (const kind of ['air', 'power'] as const) {
      const look = LOOK[kind];
      const lines: Line[] = [];
      let count = 0;
      for (const t of tracks) {
        if (t.kind !== kind || t.pts.length < 2) continue;
        const at = [0];
        for (let i = 1; i < t.pts.length; i++) at.push(at[i - 1] + t.pts[i].distanceTo(t.pts[i - 1]));
        if (at[at.length - 1] < 0.01) continue;
        lines.push({ pts: t.pts, at, from: t.from });
        count += Math.ceil(at[at.length - 1] / look.gap) + 1;
      }
      if (!count) continue;
      const geo = new THREE.SphereGeometry(look.r, 10, 8);
      const mat = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.kinds.push({ mesh, lines, look });
    }
  }

  /** Moves every pulse to where it is `t` seconds in. */
  update(t: number): void {
    const d = this.dummy;
    for (const { mesh, lines, look } of this.kinds) {
      const shift = (t * look.speed) % look.gap;
      let n = 0;
      for (const line of lines) {
        const total = line.at[line.at.length - 1];
        // The first pulse on this line, in step with the pulses on the line before it.
        let s = (((shift - line.from) % look.gap) + look.gap) % look.gap;
        let i = 1;
        for (; s <= total && n < mesh.count; s += look.gap) {
          while (i < line.at.length - 1 && line.at[i] < s) i++;
          const a = line.pts[i - 1];
          const b = line.pts[i];
          const l = line.at[i] - line.at[i - 1] || 1;
          d.position.copy(a).lerp(b, (s - line.at[i - 1]) / l);
          d.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
          d.scale.set(1, 2.6, 1);
          d.updateMatrix();
          mesh.setMatrixAt(n++, d.matrix);
        }
      }
      d.scale.set(0, 0, 0);
      d.updateMatrix();
      for (let k = n; k < mesh.count; k++) mesh.setMatrixAt(k, d.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    for (const { mesh } of this.kinds) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.kinds = [];
    this.group.clear();
  }
}
