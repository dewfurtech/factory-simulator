import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERIOR_FINISHES } from './interior3d';

describe('finished surfaces in 3D', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds a textured slab without warning in the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const square = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const g = INTERIOR_FINISHES.prism(square, -20, 0)!;
    expect(g.index).toBeNull();
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
    expect(warn).not.toHaveBeenCalled();
  });
});
