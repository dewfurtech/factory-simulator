// Shrinks the real-machine photos from the Mastrox models project into public/photos/<id>.webp (keeping their cut-out
// backgrounds), at most 1200 px wide, through the Playwright browser's canvas: no image library needed.
import { chromium } from '@playwright/test';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = 'D:/Job Dew/Model/mastrox-models/photos';
const OUT = 'public/photos';
const MAX_W = 1200;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const id of readdirSync(SRC)) {
  const file = `${SRC}/${id}/${id}.png`;
  if (!existsSync(file)) continue;
  const data = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  const webp = await page.evaluate(
    async ([src, maxW]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', 0.86);
    },
    [data, MAX_W],
  );
  const buf = Buffer.from(webp.split(',')[1], 'base64');
  writeFileSync(`${OUT}/${id}.webp`, buf);
  console.log(id, Math.round(buf.length / 1024) + ' kB');
}
await browser.close();
