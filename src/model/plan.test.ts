import { describe, expect, it } from 'vitest';
import { addCorner, addPolygon, addWall, cornerFor, deleteWall, emptyPlan, moveCorner, roomAt, roomStats, splitWall, wallLength } from './plan';
import type { Id, Opening, Plan, Vec2 } from './types';
import { signedArea } from './vec';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const rooms = (plan: Plan) => Object.values(plan.rooms);
const walls = (plan: Plan) => Object.values(plan.walls);

describe('drawing a closed outline', () => {
  it('makes one room from four walls', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    expect(Object.keys(plan.corners)).toHaveLength(4);
    expect(walls(plan)).toHaveLength(4);
    expect(rooms(plan)).toHaveLength(1);
    const st = roomStats(plan, rooms(plan)[0]);
    expect(st.area).toBe(24e6);
    expect(st.width).toBe(6000);
    expect(st.depth).toBe(4000);
    expect(st.perimeter).toBe(20000);
  });

  it('reuses the corners and walls of a neighbouring outline', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    addPolygon(plan, rect(6000, 0, 10000, 4000));
    expect(Object.keys(plan.corners)).toHaveLength(6);
    expect(walls(plan)).toHaveLength(7);
    expect(rooms(plan)).toHaveLength(2);
  });

  it('finds the room under a point', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    expect(roomAt(plan, { x: 3000, y: 2000 })?.id).toBe(rooms(plan)[0].id);
    expect(roomAt(plan, { x: 9000, y: 2000 })).toBeNull();
  });
});

describe('walls that meet other walls', () => {
  it('splits a room in two with a wall across it, keeping the original room', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    const first = rooms(plan)[0];
    first.name = 'สำนักงาน';
    const a = cornerFor(plan, { x: 3000, y: 0 });
    const b = cornerFor(plan, { x: 3000, y: 4000 });
    addWall(plan, a, b);
    expect(walls(plan)).toHaveLength(7);
    expect(rooms(plan)).toHaveLength(2);
    expect(plan.rooms[first.id]?.name).toBe('สำนักงาน');
    for (const r of rooms(plan)) expect(roomStats(plan, r).area).toBe(12e6);
  });

  it('splits a wall it crosses so the graph stays planar', () => {
    const plan = emptyPlan();
    const a = addCorner(plan, { x: 0, y: 0 });
    const b = addCorner(plan, { x: 2000, y: 0 });
    addWall(plan, a, b);
    const c = addCorner(plan, { x: 1000, y: -500 });
    const d = addCorner(plan, { x: 1000, y: 500 });
    const made = addWall(plan, c, d);
    expect(made).toHaveLength(2);
    expect(walls(plan)).toHaveLength(4);
    expect(Object.keys(plan.corners)).toHaveLength(5);
  });

  it('moves an opening to the piece that holds it when a wall is split', () => {
    const plan = emptyPlan();
    const a = addCorner(plan, { x: 0, y: 0 });
    const b = addCorner(plan, { x: 4000, y: 0 });
    const [wallId] = addWall(plan, a, b);
    const door = 'o1' as Id;
    plan.openings[door] = { id: door, wallId, kind: 'door', offset: 3000, width: 900, height: 2100, sill: 0 } as Opening;
    const mid = splitWall(plan, wallId, { x: 1000, y: 0 });
    expect(plan.corners[mid]).toMatchObject({ x: 1000, y: 0 });
    const second = walls(plan).find((w) => w.id !== wallId)!;
    expect(plan.openings[door].wallId).toBe(second.id);
    expect(plan.openings[door].offset).toBe(2000);
    expect(wallLength(plan, plan.walls[wallId])).toBe(1000);
  });
});

describe('editing', () => {
  it('drops the room when a wall of it goes', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    deleteWall(plan, walls(plan)[0].id);
    expect(rooms(plan)).toHaveLength(0);
    expect(walls(plan)).toHaveLength(3);
  });

  it('keeps the room when a corner moves', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    const room = rooms(plan)[0];
    moveCorner(plan, room.cornerIds[2], { x: 8000, y: 4000 });
    expect(rooms(plan)).toHaveLength(1);
    expect(Math.abs(signedArea(room.cornerIds.map((id) => plan.corners[id])))).toBe(28e6);
  });
});
