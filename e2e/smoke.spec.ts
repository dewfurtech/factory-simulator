import { expect, test } from '@playwright/test';
import { freshApp, openSample, planCentre, projectState } from './helpers';

test('the sample factory opens with its rooms and machines', async ({ page }) => {
  await openSample(page);
  const s = await projectState(page);
  expect(s.rooms).toBeGreaterThan(5);
  expect(s.objects.some((o) => o.assetId === 'nebula')).toBe(true);
});

test('a room is drawn from two corners on a blank plan', async ({ page }) => {
  await freshApp(page);
  await page.getByTestId('new-blank').click();
  await expect(page.getByTestId('plan')).toBeVisible();
  await page.getByTestId('group-room').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 150, c.y - 100);
  await page.mouse.click(c.x + 150, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1, walls: 4 });
});

test('a machine is placed from the library and undone', async ({ page }) => {
  await openSample(page);
  const before = (await projectState(page)).objects.length;
  await page.getByTestId('tool-catalog').click();
  await page.getByTestId('cat-nebula').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await projectState(page)).objects.length).toBe(before + 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await projectState(page)).objects.length).toBe(before);
});

test('the tape measure reads a distance between two points', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('tool-measure').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 100, c.y + 60);
  await page.mouse.click(c.x + 100, c.y + 60);
  const line = page.getByTestId('measure-line');
  await expect(line).toBeVisible();
  await expect(line).toContainText('ม.');
});

test('the plan is saved as a PNG from the main menu', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('main-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-png').click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test('the 3D view draws the factory', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('crash')).toHaveCount(0);
});

test('a model of the user’s own is added with tags and found by one', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('tool-catalog').click();
  await page.getByTestId('shelf-mine').click();
  await page.getByTestId('add-model').click();
  await page.getByTestId('mf-name').fill('เครื่องตัดแผ่น A');
  await page.getByTestId('mf-w').fill('320');
  await page.getByTestId('mf-tags').fill('ตัด, ไลน์ A');
  await page.getByTestId('mf-save').click();
  await expect(page.getByTestId('model-form')).toHaveCount(0);
  const card = page.locator('[data-testid^="cat-cm"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('เครื่องตัดแผ่น A');
  await expect(card).toContainText('ไลน์ A');
  // The second model has no such tag: the filter leaves only the first.
  await page.getByTestId('add-model').click();
  await page.getByTestId('mf-name').fill('ชั้นวาง B');
  await page.getByTestId('mf-save').click();
  await expect(page.locator('[data-testid^="cat-cm"]')).toHaveCount(2);
  await page.getByTestId('tag-ตัด').click();
  await expect(page.locator('[data-testid^="cat-cm"]')).toHaveCount(1);
});

test('a project is renamed through the app’s own dialog', async ({ page }) => {
  await openSample(page);
  await page.goto('/#/');
  await page.getByTitle('เปลี่ยนชื่อ').first().click();
  await page.getByTestId('dialog-input').fill('โรงงานทดสอบ');
  await page.getByTestId('dialog-ok').click();
  await expect(page.locator('.card').first()).toContainText('โรงงานทดสอบ');
});

test('a plan is shared by link, moved by the customer and sent back', async ({ page, browser }) => {
  await openSample(page);
  await page.getByTestId('share-link').click();
  await page.getByTestId('share-note').fill('ลองย้ายเครื่องดูครับ');
  await page.getByTestId('share-make').click();
  const url = await page.getByTestId('share-url').inputValue();
  expect(url).toMatch(/#\/s\/[A-Za-z0-9_-]+$/);

  // The customer: another browser with nothing stored, opening only the link.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(url);
  await expect(customer.getByTestId('share-banner')).toBeVisible();
  await expect(customer.getByTestId('share-note-shown')).toContainText('ลองย้ายเครื่องดูครับ');
  await expect(customer.getByTestId('toolbar')).toBeVisible();
  await expect(customer.getByTestId('group-wall')).toHaveCount(0);
  const theirs = await projectState(customer);
  expect(theirs.objects.some((o) => o.assetId === 'nebula')).toBe(true);
  expect(theirs.rooms).toBeGreaterThan(5);

  await customer.getByTestId('share-link').click();
  await customer.getByTestId('share-note').fill('ย้ายแล้วครับ');
  await customer.getByTestId('share-make').click();
  const back = await customer.getByTestId('share-url').inputValue();
  expect(back).not.toBe(url);

  await page.goto(back);
  await expect(page.getByTestId('share-banner')).toContainText('ลูกค้าส่งกลับ');
  await expect(page.getByTestId('share-note-shown')).toContainText('ย้ายแล้วครับ');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('open-full-editor').click();
  await expect(page.getByTestId('group-wall')).toBeVisible();
  await expect(page.getByTestId('share-banner')).toHaveCount(0);
});
