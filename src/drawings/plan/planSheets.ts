import { planOf } from '../../model/levels';
import type { SheetDef } from '../sheets';
import { planDrawing } from './planDrawing';

/** ID-04: the floor plans with dimensions, one sheet per floor that has walls (ID-04-01 ground, ID-04-02 upper). */
export const planSheets: SheetDef = {
  key: 'plan',
  sheets(project) {
    const levels = [0, 1].filter((l) => l === 0 || Object.keys(planOf(project, l).walls).length > 0);
    return levels.map((level) => ({
      id: `ID-04-${String(level + 1).padStart(2, '0')}`,
      title: level ? 'UPPER FLOOR PLAN / แปลนชั้นบน' : 'FLOOR PLAN / แปลนพื้น',
      views: [(scale: number) => planDrawing(project, level, { scale })],
      dxf: true,
    }));
  },
};
