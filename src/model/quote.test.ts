import { describe, expect, it } from 'vitest';
import { newProject } from './project';
import { machineOptions } from './catalog';
import { quotationHtml, quoteOf } from './quote';
import type { PlacedObject } from './types';

const piece = (id: string, assetId: string, extra: Partial<PlacedObject> = {}): PlacedObject => ({
  id: id as PlacedObject['id'],
  assetId,
  name: id,
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  size: { w: 1000, d: 1000, h: 1000 },
  ...extra,
});

describe('quoteOf', () => {
  it('sums machines at their list price, grouping the same model', () => {
    const p = newProject('t');
    p.objects = [piece('a', 'booster-e6'), piece('b', 'booster-e6'), piece('c', 'nova-x2')];
    const q = quoteOf(p);
    expect(q.lines.map((l) => [l.name, l.qty, l.amount])).toEqual([
      ['Booster e6', 2, 598000],
      ['Nova X2', 1, 290000],
    ]);
    expect(q.total).toBe(888000);
    expect(q.unpriced).toBe(0);
  });

  it('leaves furniture off and takes a typed price over the list', () => {
    const p = newProject('t');
    p.objects = [piece('a', 'desk'), piece('b', 'desk', { price: 5000 }), piece('c', 'nova-x2', { price: 250000 })];
    const q = quoteOf(p);
    expect(q.lines.map((l) => [l.name, l.amount])).toEqual([
      ['Nova X2', 250000],
      ['โต๊ะทำงาน + เก้าอี้', 5000],
    ]);
    expect(q.total).toBe(255000);
  });

  it('keeps add-on sets on separate lines and skips unpriced machines in the total', () => {
    const p = newProject('t');
    p.objects = [piece('a', 'rakete-3500a'), piece('b', 'rakete-3500a', { options: ['infeed'] }), piece('c', 'stella')];
    const q = quoteOf(p);
    expect(q.lines).toHaveLength(3);
    expect(q.lines.find((l) => l.addons.length)?.addons).toEqual(['โต๊ะยกไม้ (ป้อนเข้า)']);
    expect(q.unpriced).toBe(1);
    expect(q.total).toBe(1560000);
    const html = quotationHtml(p, q, new Date(2026, 9, 27));
    expect(html).toContain('สอบถาม');
    expect(html).toContain('฿1,560,000');
  });

  it('adds a priced add-on to the machine and notes only the unpriced ones', () => {
    // The price list has no add-on prices yet: give one here for the test only.
    const infeed = machineOptions('rakete-3500a').find((a) => a.id === 'infeed')!;
    infeed.price = 120000;
    try {
      const p = newProject('t');
      p.objects = [piece('a', 'rakete-3500a', { options: ['infeed'] }), piece('b', 'rakete-3500a', { options: ['infeed', 'loader'] })];
      const q = quoteOf(p);
      expect(q.total).toBe(2 * 900000);
      const one = q.lines.find((l) => l.addons.length === 1)!;
      expect(one.addons).toEqual(['โต๊ะยกไม้ (ป้อนเข้า) (+฿120,000)']);
      expect(one.addonsUnpriced).toBeUndefined();
      expect(q.lines.find((l) => l.addons.length === 2)?.addonsUnpriced).toBe(true);
    } finally {
      delete infeed.price;
    }
  });
});
