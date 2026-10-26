import { describe, expect, it } from 'vitest';
import { checkClearance } from '../model/clearance';
import { migrate } from '../model/project';
import { sampleCondo } from './sample';
import { moodSummary } from './summary';

describe('sampleCondo', () => {
  const p = sampleCondo();
  const rooms = Object.values(p.plan.rooms);

  it('is an interior with its three rooms named, typed and finished', () => {
    expect(p.kind).toBe('interior');
    expect(rooms.map((r) => `${r.name}:${r.zone}`).sort()).toEqual(['ห้องนอน:bedroom', 'ห้องน้ำ:bath', 'นั่งเล่น / ครัว:living'].sort());
    for (const r of rooms) expect(r.finish && r.finish.floor && r.finish.wall && r.finish.ceiling).toBeTruthy();
  });

  it('has its doors, windows, built-ins and furniture', () => {
    const openings = Object.values(p.plan.openings);
    expect(openings.filter((o) => o.kind === 'door')).toHaveLength(4);
    expect(openings.filter((o) => o.kind === 'window')).toHaveLength(2);
    expect(openings.filter((o) => o.entrance)).toHaveLength(1);
    expect(p.objects.filter((o) => o.cabinet)).toHaveLength(5);
    expect(p.objects.length).toBeGreaterThan(12);
  });

  it('puts nothing on top of anything else or into a wall', () => {
    const issues = [...checkClearance(p).entries()].map(([id, list]) => [p.objects.find((o) => o.id === id)?.name ?? id, list.map((i) => i.kind)]);
    expect(issues).toEqual([]);
  });

  it('opens unchanged through migrate, so a saved copy reads back the same', () => {
    expect(migrate(structuredClone(p)).plan.rooms).toEqual(p.plan.rooms);
  });

  it('gives Mood & Tone a material for every surface it finished', () => {
    const ids = new Set(moodSummary(p).materials.map((m) => m.material.id));
    for (const id of ['oak', 'walnut', 'tile-grey-600', 'paint-cream', 'paint-sage', 'subway-white', 'gypsum-white']) expect(ids.has(id)).toBe(true);
  });
});
