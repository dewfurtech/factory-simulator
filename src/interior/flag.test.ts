import { beforeEach, describe, expect, it } from 'vitest';
import { interiorEnabled } from './flag';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('interiorEnabled', () => {
  it('is off on the live site until asked for', () => {
    expect(interiorEnabled('', false)).toBe(false);
  });
  it('turns on with ?interior and stays on without it', () => {
    expect(interiorEnabled('?interior', false)).toBe(true);
    expect(interiorEnabled('', false)).toBe(true);
  });
  it('turns off again with ?interior=0', () => {
    interiorEnabled('?interior=1', false);
    expect(interiorEnabled('?interior=0', false)).toBe(false);
    expect(interiorEnabled('', false)).toBe(false);
  });
  it('is always on in the dev server', () => {
    expect(interiorEnabled('', true)).toBe(true);
  });
});
