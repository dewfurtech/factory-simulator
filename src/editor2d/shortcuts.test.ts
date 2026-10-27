import { describe, expect, it } from 'vitest';
import { keyLetter } from './shortcuts';

describe('keyLetter', () => {
  it('reads the same letter whether the keyboard types Thai or English', () => {
    expect(keyLetter({ code: 'KeyR', key: 'r' })).toBe('r');
    expect(keyLetter({ code: 'KeyR', key: 'พ' })).toBe('r');
    expect(keyLetter({ code: 'KeyL', key: 'ส' })).toBe('l');
    expect(keyLetter({ code: 'KeyZ', key: 'Z' })).toBe('z');
  });

  it('falls back to the typed key for keys that are not letters', () => {
    expect(keyLetter({ code: 'Escape', key: 'Escape' })).toBe('Escape');
    expect(keyLetter({ code: '', key: 'R' })).toBe('r');
  });
});
