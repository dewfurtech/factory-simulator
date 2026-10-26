import { beforeEach, describe, expect, it } from 'vitest';
import { addPolygon } from '../model/plan';
import { migrate, newProject } from '../model/project';
import type { Project } from '../model/types';
import { useProject } from '../store/project';
import { newInteriorProject } from './project';

const square = (x: number) => [
  { x, y: 0 },
  { x: x + 4000, y: 0 },
  { x: x + 4000, y: 3000 },
  { x, y: 3000 },
];

const rooms = () => Object.values(useProject.getState().project!.plan.rooms).map((r) => ({ name: r.name, zone: r.zone }));

describe('rooms of an interior project', () => {
  beforeEach(() => useProject.setState({ project: null, past: [], future: [] }));

  it('a room drawn in an interior is "ห้อง N" of no particular use, not a factory production zone', () => {
    useProject.getState().open(newInteriorProject());
    useProject.getState().apply((d) => void addPolygon(d.plan, square(0)));
    useProject.getState().apply((d) => void addPolygon(d.plan, square(6000)));
    expect(rooms()).toEqual([
      { name: 'ห้อง 1', zone: 'other' },
      { name: 'ห้อง 2', zone: 'other' },
    ]);
  });

  it('a room the user has named and given a use keeps both through later edits', () => {
    useProject.getState().open(newInteriorProject());
    useProject.getState().apply((d) => void addPolygon(d.plan, square(0)));
    useProject.getState().apply((d) => {
      const r = Object.values(d.plan.rooms)[0];
      r.name = 'โซน 9';
      r.zone = 'bedroom';
    });
    useProject.getState().apply((d) => void addPolygon(d.plan, square(6000)));
    expect(rooms()[0]).toEqual({ name: 'โซน 9', zone: 'bedroom' });
  });

  it('a factory still names its rooms "โซน N" on the production zone', () => {
    useProject.getState().open(newProject('โรงงาน'));
    useProject.getState().apply((d) => void addPolygon(d.plan, square(0)));
    expect(rooms()).toEqual([{ name: 'โซน 1', zone: 'production' }]);
  });

  it('an interior saved with factory-named rooms opens with home rooms; a factory opens as saved', () => {
    const draw = (p: Project) => (addPolygon(p.plan, square(0)), p);
    const interior = migrate(draw(newInteriorProject()));
    expect(Object.values(interior.plan.rooms).map((r) => [r.name, r.zone])).toEqual([['ห้อง 1', 'other']]);
    const factory = migrate(draw(newProject('โรงงาน')));
    expect(Object.values(factory.plan.rooms).map((r) => [r.name, r.zone])).toEqual([['โซน 1', 'production']]);
  });
});
