import { readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newProject } from './project';
import { quotationFileName, quotationPdf } from './quotePdf';
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

// The fonts come from public/fonts, as the dev server would serve them.
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = url.replace(/^.*\/fonts\//, 'public/fonts/');
    const buf = await readFile(file);
    return new Response(buf, { status: 200 });
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('quotationPdf', () => {
  it('makes a PDF with the Thai font embedded, and a file name the OS accepts', async () => {
    const p = newProject('โรงงาน ABC: เฟส 2');
    p.client = { company: 'บริษัท ตัวอย่าง จำกัด', contact: 'คุณสมชาย', phone: '081-234-5678' };
    p.objects = [
      piece('a', 'rakete-3500a'),
      piece('b', 'rakete-3500a', { options: ['infeed', 'outfeed'] }),
      piece('c', 'moon-40'),
      piece('d', 'moon-40'),
      piece('e', 'nova-xs'),
      piece('f', 'stella'),
      piece('g', 'desk', { price: 12000 }),
    ];
    const bytes = await quotationPdf(p, undefined, new Date(2026, 9, 27));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(quotationFileName(p, new Date(2026, 9, 27))).toBe('ใบเสนอราคา โรงงาน ABC เฟส 2 2026-10-27.pdf');
    if (process.env.QUOTE_PDF_OUT) await writeFile(process.env.QUOTE_PDF_OUT, bytes);
  }, 20_000);
});
