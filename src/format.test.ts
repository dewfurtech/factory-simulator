import { expect, it } from 'vitest';
import { fmtArea, fmtLen, fmtSize } from './format';

it('prints every length in metres, short ones too', () => {
  expect(fmtLen(6000)).toBe('6.00 ม.');
  expect(fmtLen(1234)).toBe('1.23 ม.');
  expect(fmtLen(850)).toBe('0.85 ม.');
});

it('prints areas and sizes in metres', () => {
  expect(fmtArea(24e6)).toBe('24.00 ม²');
  expect(fmtSize(6000, 4000)).toBe('6.00 × 4.00 ม.');
});
