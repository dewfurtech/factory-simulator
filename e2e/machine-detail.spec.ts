import { expect, test, type Page } from '@playwright/test';
import { freshApp, planCentre, projectState } from './helpers';

/** How many triangles the 3D view draws in all: the one machine is most of them. */
const triangles = (page: Page) =>
  page.evaluate(() => {
    type G = { index: { count: number } | null; attributes: { position?: { count: number } } };
    const s = (window as unknown as { __scene?: { scene: { traverse(f: (o: { isMesh?: boolean; geometry?: G }) => void): void } } }).__scene;
    if (!s) throw new Error('no 3D view');
    let n = 0;
    s.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      n += (o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count ?? 0)) / 3;
    });
    return Math.round(n);
  });

// The picker is a dev-server tool; the e2e build shows it too so it can be tested. The live site never does.
test('the dev picker draws a machine from one box to the full model, and remembers the level', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  // One Nebula on a blank plan: the full model of a whole factory takes long to build on a busy machine.
  await freshApp(page);
  await page.getByTestId('new-blank').click();
  await page.getByTestId('tool-catalog').click();
  await page.getByTestId('cat-nebula').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await projectState(page)).objects.length).toBe(1);
  await page.keyboard.press('Escape');

  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible({ timeout: 20_000 });
  const picker = page.getByTestId('dev-machine-detail');
  await expect(picker).toHaveValue('chunky');
  await expect.poll(() => triangles(page)).toBeGreaterThan(50);
  const chunky = await triangles(page);

  await picker.selectOption('full');
  await expect.poll(() => triangles(page), { timeout: 20_000 }).toBeGreaterThan(chunky * 2);
  const full = await triangles(page);
  await picker.selectOption('lowpoly');
  await expect.poll(() => triangles(page), { timeout: 20_000 }).toBeLessThan(full);
  await picker.selectOption('box');
  await expect.poll(() => triangles(page)).toBeLessThan(chunky);

  await page.reload();
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('dev-machine-detail')).toHaveValue('box', { timeout: 20_000 });
  expect(errors).toEqual([]);
});
