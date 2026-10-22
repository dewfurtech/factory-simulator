import { describe, expect, it } from 'vitest';
import { addAisle } from './aisles';
import { aisleMarkings, aisleNet, clipOutside, setApart, zebraStripes } from './aisleJoins';
import { emptyPlan } from './plan';

/** A main aisle along y = 0 and a walkway coming down to it, stopping `gap` short of its edge. */
function tee(gap: number) {
  const plan = emptyPlan();
  const main = addAisle(
    plan,
    [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
    ],
    { kind: 'mixed', width: 2700 },
  );
  const walk = addAisle(
    plan,
    [
      { x: 5000, y: 6000 },
      { x: 5000, y: 1350 + gap },
    ],
    { kind: 'walk', width: 1000 },
  );
  return { plan, main, walk };
}

const lengthOf = (pieces: { x: number; y: number }[][]) => pieces.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0), 0);

describe('aisle joints', () => {
  it('carries a walkway ending near a main aisle on to its centre line', () => {
    const { plan, main, walk } = tee(300);
    const net = aisleNet(plan);
    expect(net.lines.get(walk)!.at(-1)).toEqual({ x: 5000, y: 0 });
    expect(net.joined.get(main)!.has(walk)).toBe(true);
    expect(net.joints).toHaveLength(1);
  });

  it('opens the main aisle edge line where the walkway comes in', () => {
    const { plan, main } = tee(0);
    const net = aisleNet(plan);
    const { edges } = aisleMarkings(net, plan, plan.aisles![main]);
    // Two full edges are 20 m; the walkway (1 m less its two lines) cuts one of them.
    expect(lengthOf(edges)).toBeCloseTo(20000 - (1000 - 150), 0);
    expect(edges).toHaveLength(3);
  });

  it('leaves aisles farther apart than the gap alone', () => {
    const { plan } = tee(800);
    expect(aisleNet(plan).joints).toHaveLength(0);
  });

  it('keeps a pair apart when asked, and joins them again', () => {
    const { plan, main, walk } = tee(300);
    setApart(plan, main, walk, true);
    let net = aisleNet(plan);
    expect(net.joints[0].apart).toBe(true);
    expect(net.lines.get(walk)!.at(-1)).toEqual({ x: 5000, y: 1650 });
    expect(lengthOf(aisleMarkings(net, plan, plan.aisles![main]).edges)).toBeCloseTo(20000, 0);
    setApart(plan, main, walk, false);
    net = aisleNet(plan);
    expect(net.joints[0].apart).toBe(false);
    expect(plan.aisles![main].apart).toBeUndefined();
  });

  it('joins aisles that cross', () => {
    const plan = emptyPlan();
    addAisle(
      plan,
      [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
      ],
      { kind: 'walk' },
    );
    addAisle(
      plan,
      [
        { x: 5000, y: -5000 },
        { x: 5000, y: 5000 },
      ],
      { kind: 'walk' },
    );
    const net = aisleNet(plan);
    expect(net.joints.map((j) => j.at)).toEqual([{ x: 5000, y: 0 }]);
  });

  it('puts a zebra crossing where a walkway meets a truck lane, as wide as the walkway', () => {
    const { plan, main, walk } = tee(0);
    const net = aisleNet(plan);
    expect(net.crossings).toHaveLength(1);
    const c = net.crossings[0];
    expect([c.lane, c.walk]).toEqual([main, walk]);
    expect(c.center).toEqual({ x: 5000, y: 0 });
    expect(c.length).toBe(1000);
    expect(c.span).toBe(2700 - 150);
    // Stripes 30 cm wide every 60 cm across the lane, running with the traffic.
    expect(zebraStripes(c)).toHaveLength(4);
    expect(net.mirrors).toHaveLength(0);
  });

  it('puts a mirror across the lane a truck lane runs into, and outside a sharp bend', () => {
    const plan = emptyPlan();
    addAisle(
      plan,
      [
        { x: 0, y: 0 },
        { x: 20000, y: 0 },
      ],
      { kind: 'forklift', width: 2200 },
    );
    addAisle(
      plan,
      [
        { x: 8000, y: 9000 },
        { x: 8000, y: 1100 },
      ],
      { kind: 'forklift', width: 2200 },
    );
    addAisle(
      plan,
      [
        { x: 30000, y: 0 },
        { x: 30000, y: 10000 },
        { x: 40000, y: 10000 },
      ],
      { kind: 'forklift2', width: 3800 },
    );
    const net = aisleNet(plan);
    expect(net.crossings).toHaveLength(0);
    const junction = net.mirrors.find((m) => m.kind === 'junction')!;
    // Coming down from y = 9000: the mirror stands on the far side of the lane, past its edge.
    expect(junction.at).toEqual({ x: 8000, y: -1100 - 400 });
    const bend = net.mirrors.find((m) => m.kind === 'bend')!;
    expect(bend.at.x).toBeLessThan(30000);
    expect(bend.at.y).toBeGreaterThan(10000);
  });

  it('puts neither between two walkways, nor across a pair kept apart', () => {
    const { plan, main, walk } = tee(0);
    setApart(plan, main, walk, true);
    expect(aisleNet(plan).crossings).toHaveLength(0);
  });

  it('clips a line outside a box', () => {
    const box = [
      { x: 4, y: -1 },
      { x: 6, y: -1 },
      { x: 6, y: 1 },
      { x: 4, y: 1 },
    ];
    expect(
      clipOutside(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        [box],
      ),
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      [
        { x: 6, y: 0 },
        { x: 10, y: 0 },
      ],
    ]);
  });
});
