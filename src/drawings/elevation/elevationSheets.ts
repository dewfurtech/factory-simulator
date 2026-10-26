import { planOf } from '../../model/levels';
import type { SheetDef, SheetSpec } from '../sheets';
import { roomElevations } from './elevation';

/** How many wall faces share one sheet: two stacked fit a 3–6 m wall at 1:30 or 1:40 (see README). */
const PER_SHEET = 2;

/**
 * ID-09: the interior wall elevations, room by room, two faces to a sheet (A and B, then C and D), numbered on
 * through the set (ID-09-01, ID-09-02, …). The faces are labelled clockwise from the one seen looking north. Each view
 * is made at the sheet's own scale so its material notes stand clear of its dimensions.
 */
export const elevationSheets: SheetDef = {
  key: 'elevation',
  sheets(project) {
    const out: SheetSpec[] = [];
    for (const level of [0, 1]) {
      const plan = planOf(project, level);
      if (level && !Object.keys(plan.walls).length) continue;
      const rooms = Object.values(plan.rooms)
        .filter((r) => !r.outdoor && !r.hidden)
        .sort((a, b) => a.name.localeCompare(b.name, 'th'));
      for (const room of rooms) {
        const faces = roomElevations(project, level, room);
        for (let i = 0; i < faces.length; i += PER_SHEET) {
          const group = faces.slice(i, i + PER_SHEET);
          const labels = group.map((f) => f.label).join(', ');
          out.push({
            id: `ID-09-${String(out.length + 1).padStart(2, '0')}`,
            title: `ELEVATION ${labels} / รูปด้าน ${labels} · ${room.name}`,
            views: group.map((f) => (scale: number) => roomElevations(project, level, room, { scale }).find((e) => e.label === f.label)!.drawing),
            dxf: true,
          });
        }
      }
    }
    return out;
  },
};
