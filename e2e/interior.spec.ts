import { expect, test, type Page } from '@playwright/test';
import { freshApp, planCentre, projectState } from './helpers';

/** The start page with the interior mode switched on, as `?interior` does on the live site. */
async function interiorApp(page: Page) {
  await page.goto('/?interior');
  await expect(page.getByTestId('new-interior')).toBeVisible();
}

test('the interior start button is hidden until ?interior turns it on, and ?interior=0 hides it again', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByTestId('new-interior')).toHaveCount(0);
  await interiorApp(page);
  await page.goto('/');
  await expect(page.getByTestId('new-interior')).toBeVisible();
  await page.goto('/?interior=0');
  await expect(page.getByTestId('new-sample')).toBeVisible();
  await expect(page.getByTestId('new-interior')).toHaveCount(0);
});

test('an interior project opens in its own editor, takes a floor material and sums it up', async ({ page }) => {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  // No columns or aisles on the rail; no Mastrox shelf in the library.
  await expect(page.getByTestId('group-column')).toHaveCount(0);
  await expect(page.getByTestId('group-aisle')).toHaveCount(0);
  await page.getByTestId('dock-catalog').click();
  await expect(page.getByTestId('shelf-mastrox')).toHaveCount(0);
  await page.getByTestId('dock-catalog').click();

  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 150, c.y - 100);
  await page.mouse.click(c.x + 150, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1, walls: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('zone-living')).toBeVisible();
  await page.getByTestId('surface-floor').click();
  await page.getByTestId('material-oak').click();

  await page.getByTestId('mood-tone').click();
  await expect(page.getByTestId('mood-materials')).toContainText('ไม้โอ๊คอ่อน');
  await expect(page.getByTestId('mood-palette')).toContainText('#C9A471');
});

test('the project list marks an interior project', async ({ page }) => {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByTestId('card-kind')).toHaveText('ตกแต่งภายใน');
});

test('the BOQ page counts a floor material and totals the price typed in', async ({ page }) => {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 150, c.y - 100);
  await page.mouse.click(c.x + 150, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1, walls: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.click(c.x, c.y);
  await page.getByTestId('surface-floor').click();
  await page.getByTestId('material-tile-grey-600').click();

  await page.getByTestId('boq-open').click();
  const line = page.getByTestId('boq-line-tile-grey-600');
  await expect(line).toContainText('กระเบื้องเทา 60×60');
  await expect(line).toContainText('แผ่น');

  await page.getByTestId('boq-tab-quote').click();
  await expect(page.getByTestId('quote-line-tile-grey-600')).toContainText('ยังไม่ใส่ราคา');
  await expect(page.getByTestId('boq-unpriced')).toContainText('1 รายการ');
  // The tiles to buy, from the line, times the price typed in.
  const tiles = Number((await page.getByTestId('quote-line-tile-grey-600').locator('td').nth(2).innerText()).replace(/[^\d.]/g, ''));
  expect(tiles).toBeGreaterThan(0);
  await page.getByTestId('boq-price-tile-grey-600').fill('100');
  const total = (tiles * 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await expect(page.getByTestId('boq-total')).toHaveText(total);
  await expect(page.getByTestId('boq-unpriced')).toHaveCount(0);
  await page.getByTestId('boq-vat').fill('7');
  await expect(page.getByTestId('boq-total')).toHaveText((tiles * 107).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
});
