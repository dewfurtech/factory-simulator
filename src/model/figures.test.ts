import { describe, expect, it } from 'vitest';
import '../interior/catalog';
import { sampleCondo } from '../interior/sample';
import { moodSummary } from '../interior/summary';
import { projectBoq } from '../interior/boqSurfaces';
import { piecesAndCabinets } from '../interior/present/sheets';
import { buildInteriorPrompt } from '../interior/renderPrompt';
import { isFurniture } from '../interior/furniture';
import { catalogItem, CATALOG } from './catalog';
import { checkClearance } from './clearance';
import { FIGURE_IDS, FIGURE_ITEMS, isFigure } from './figures';
import { addPolygon } from './plan';
import { newProject } from './project';
import { buildRenderPrompt } from './renderPrompt';
import { sampleFactory } from './sample';
import type { PlacedObject, Project } from './types';

const person = (id: string, assetId: string, x: number, y: number): PlacedObject => ({
  id: id as PlacedObject['id'],
  assetId,
  name: catalogItem(assetId)!.label,
  x,
  y,
  z: 0,
  rotation: 0,
  size: { ...catalogItem(assetId)!.size },
});

const withPeople = (p: Project, at: { x: number; y: number }): Project => ({
  ...p,
  objects: [...p.objects, person('fig-a', FIGURE_IDS.man, at.x, at.y), person('fig-b', FIGURE_IDS.woman, at.x + 300, at.y), person('fig-c', FIGURE_IDS.child, at.x - 300, at.y)],
});

describe('scale figures', () => {
  it('are in the catalog under "คน" at their heights, the factory hand on the factory shelf only', () => {
    expect(FIGURE_ITEMS.map((i) => i.size.h)).toEqual([1750, 1620, 1200, 1750]);
    for (const i of FIGURE_ITEMS) expect(CATALOG).toContain(i);
    expect(FIGURE_ITEMS.filter(isFurniture).map((i) => i.id)).toEqual([FIGURE_IDS.man, FIGURE_IDS.woman, FIGURE_IDS.child]);
  });

  it('take up no floor in the placement check: not on a machine, not in its operator spot, not through a wall', () => {
    const p = newProject('t');
    addPolygon(p.plan, [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ]);
    for (const r of Object.values(p.plan.rooms)) r.ceilingHeight = 3000;
    const machine: PlacedObject = { ...person('m', 'nebula', 5000, 3000), size: { ...catalogItem('nebula')!.size } };
    const front = 3000 + machine.size.d / 2 + 450;
    p.objects = [machine, person('on', FIGURE_IDS.worker, 5000, 3000), person('spot', FIGURE_IDS.worker, 5000, front), person('wall', FIGURE_IDS.man, 50, 4000)];
    expect(checkClearance(p).size).toBe(0);
  });

  it('are left out of Mood & Tone, the BOQ, the presentation and the image prompts', () => {
    const condo = sampleCondo();
    const before = { mood: moodSummary(condo), boq: projectBoq(condo).lines.length, pieces: piecesAndCabinets(condo).pieces.length };
    const p = withPeople(condo, { x: 4300, y: 2000 });
    expect(moodSummary(p)).toEqual(before.mood);
    expect(moodSummary(p).furniture.some((f) => /ผู้|เด็ก|พนักงาน/.test(f.name))).toBe(false);
    expect(projectBoq(p).lines.length).toBe(before.boq);
    expect(projectBoq(p).lines.some((l) => /ผู้ชาย|ผู้หญิง|เด็ก/.test(JSON.stringify(l)))).toBe(false);
    expect(piecesAndCabinets(p).pieces.length).toBe(before.pieces);
    expect(buildInteriorPrompt(p)).toBe(buildInteriorPrompt({ ...p, objects: p.objects.filter((o) => !isFigure(o)) }));

    const factory = sampleFactory();
    expect(factory.objects.some((o) => o.assetId === FIGURE_IDS.worker)).toBe(true);
    expect(buildRenderPrompt(factory)).toBe(buildRenderPrompt({ ...factory, objects: factory.objects.filter((o) => !isFigure(o)) }));
  });

  it('stand in the sample projects without any placement issue of their own', () => {
    for (const p of [sampleCondo(), sampleFactory()]) {
      const figures = p.objects.filter(isFigure);
      expect(figures.length).toBeGreaterThan(0);
      const issues = checkClearance(p);
      for (const f of figures) expect(issues.has(f.id)).toBe(false);
    }
  });
});
