import { describe, expect, it } from 'vitest';
import { advance, BATCH, lineStats, pointOnLeg, startSim, type Line, type Station } from './simulation';
import type { Id } from './types';

const st = (id: string, sec: number, stage: number): Station => ({ id: id as Id, name: id, sec, stage, inAt: { x: 0, y: 0 }, at: { x: 0, y: 0 }, top: 2000, rotation: 0 });
const leg = (metres: number) => ({
  points: [
    { x: 0, y: 0 },
    { x: metres * 1000, y: 0 },
  ],
  metres,
});

const line = (sec: number[], metres = 10): Line => ({ stations: sec.map((s, i) => st(`m${i}`, s, i + 1)), legs: sec.slice(1).map(() => leg(metres)) });

describe('line figures', () => {
  it('runs at the pace of the slowest machine and names it', () => {
    const s = lineStats(line([600, 300, 450]));
    expect(s.perHour).toBeCloseTo(6);
    expect(s.perDay).toBeCloseTo(48);
    expect(s.bottleneck).toBe('m0');
    expect(s.load[1].share).toBeCloseTo(0.5);
  });

  it('counts two machines at one stage as double, moving the bottleneck on', () => {
    const l: Line = { stations: [st('a', 600, 1), st('b', 600, 1), st('c', 400, 2)], legs: [leg(5), leg(5)] };
    const s = lineStats(l);
    expect(s.perHour).toBeCloseTo(9);
    expect(s.bottleneck).toBe('c');
  });

  it('charges a long route as walking', () => {
    const near = lineStats(line([300, 300], 10));
    const far = lineStats(line([300, 300], 40));
    expect(far.metresPerDay).toBeCloseTo(near.metresPerDay * 4);
    expect(far.leadMinutes).toBeGreaterThan(near.leadMinutes);
  });
});

describe('running the line', () => {
  it('turns out sheets at about the worked-out rate', () => {
    const l = line([300, 200], 10);
    const sim = startSim(l);
    advance(l, sim, 8 * 3600);
    const { perDay } = lineStats(l);
    expect(sim.done).toBeGreaterThan(perDay * 0.9);
    expect(sim.done).toBeLessThanOrEqual(perDay);
  });

  it('builds the queue in front of the slow machine, and stops the one before it when full', () => {
    const l = line([100, 900], 5);
    const sim = startSim(l);
    advance(l, sim, 4 * 3600);
    expect(sim.stations[1].queue).toBeGreaterThanOrEqual(BATCH);
    expect(sim.stations[0].state).toBe('blocked');
  });

  it('gives the same result however the time is chopped up', () => {
    const l = line([120, 80]);
    const a = startSim(l);
    const b = startSim(l);
    advance(l, a, 3600);
    for (let i = 0; i < 360; i++) advance(l, b, 10);
    expect(b.done).toBe(a.done);
  });
});

describe('pointOnLeg', () => {
  it('walks along the bends', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 2000 },
    ];
    expect(pointOnLeg(pts, 0.5).at).toEqual({ x: 500, y: 0 });
    const round = pointOnLeg(pts, 2);
    expect(round.at).toEqual({ x: 1000, y: 1000 });
    expect(round.heading).toBeCloseTo(Math.PI / 2);
  });
});
