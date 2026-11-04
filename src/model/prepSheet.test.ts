import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { prepSheet } from './prepSheet';
import { newProject } from './project';
import type { Id, PlacedObject } from './types';

const put = (id: string, assetId: string, x: number): PlacedObject => ({
  id: id as Id,
  assetId,
  name: id,
  x,
  y: 0,
  z: 0,
  rotation: 0,
  size: machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size,
});

const value = (p: ReturnType<typeof newProject>, section: string, label: string) =>
  prepSheet(p)
    .find((s) => s.id === section)
    ?.rows.find((r) => r.label === label);

describe('what the customer prepares', () => {
  it('has nothing to list before a machine is placed', () => {
    expect(prepSheet(newProject('t'))).toEqual([]);
  });

  it('covers power, air, dust, the floor and the way in', () => {
    const p = newProject('t');
    p.objects = [put('a', 'rakete-3500a', 0)];
    const ids = prepSheet(p).map((s) => s.id);
    expect(ids).toEqual(['power', 'air', 'dust', 'floor', 'access']);
    expect(value(p, 'power', 'สายเมน')?.value).toMatch(/3×\d+ \+ N \d+ \+ G \d+/);
    expect(value(p, 'dust', 'เครื่องดูดฝุ่น')?.value).toContain('m³/ชม.');
  });

  it('leaves air and dust out when no machine uses them', () => {
    const p = newProject('t');
    p.objects = [put('g', 'cold-presso', 0)];
    expect(prepSheet(p).map((s) => s.id)).toEqual(['power', 'floor', 'access']);
  });

  it('asks for a compressor with its dryer and three filters when the plan has none', () => {
    const p = newProject('t');
    p.objects = [put('a', 'rakete-3500a', 0)];
    expect(value(p, 'air', 'ปั๊มลม')).toMatchObject({ warn: true });
    expect(value(p, 'air', 'Filter')?.value).toContain('× 3');
    expect(value(p, 'air', 'Dryer')?.value).toContain('DHF');
  });

  it('counts the compressor already on the plan', () => {
    const p = newProject('t');
    p.objects = [put('a', 'rakete-3500a', 0), put('c', 'vair-20', 6000)];
    expect(value(p, 'air', 'ปั๊มลม')).toEqual({ label: 'ปั๊มลม', value: 'VAir 20HP × 1' });
  });

  it('says where the main board still has to go', () => {
    const p = newProject('t');
    p.objects = [put('a', 'rakete-3500a', 0)];
    expect(value(p, 'power', 'ตำแหน่งตู้')).toMatchObject({ warn: true });
    p.objects.push(put('m', 'mdb', 5000));
    expect(value(p, 'power', 'ตำแหน่งตู้')).toBeUndefined();
  });
});
