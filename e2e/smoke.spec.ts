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
  await page.getByTestId('tool-drawRoomRect').click();
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
  // A second tape joins the first; Backspace takes the last away, and the chip clears the rest.
  await page.mouse.click(c.x - 100, c.y + 140);
  await page.mouse.click(c.x + 60, c.y + 140);
  await expect(page.getByTestId('measure-line')).toHaveCount(2);
  await expect(page.getByTestId('tapes-chip')).toContainText('2');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('measure-line')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('measure-line')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('measure-line')).toHaveCount(1);
  await page.getByTestId('tapes-clear').click();
  await expect(page.getByTestId('measure-line')).toHaveCount(0);
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
  // three.js loads lazily: on a busy machine the first 3D view takes longer than the default 5 s.
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible({ timeout: 20_000 });
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
  await page.getByTestId('share-banner-close').click();
  await expect(page.getByTestId('share-banner')).toHaveCount(0);
  await page.getByTestId('main-menu').click();
  await page.getByTestId('open-full-editor').click();
  await expect(page.getByTestId('group-wall')).toBeVisible();
  await expect(page.getByTestId('share-banner')).toHaveCount(0);
});

test('an aisle is drawn and ended with a double-click, leaving nothing behind for the next', async ({ page }) => {
  await openSample(page);
  const aisles = () =>
    page.evaluate(() => {
      const p = (
        window as unknown as { __factory?: { project: { getState(): { project: { plan: { aisles?: Record<string, { points: object[] }> } } } } } }
      ).__factory?.project.getState().project;
      return Object.values(p?.plan.aisles ?? {}).map((a) => a.points.length);
    });
  await page.getByTestId('group-aisle').click();
  await page.getByTestId('tool-aisle-walk').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 120, c.y + 40);
  await page.mouse.click(c.x + 120, c.y + 40);
  await page.mouse.dblclick(c.x + 120, c.y + 40);
  await expect.poll(aisles).toEqual([2]);
  await expect(page.getByTestId('aisle-legend')).toBeVisible();
  // The next aisle starts where it is clicked, not at the end of the last one.
  await page.mouse.click(c.x - 120, c.y + 140);
  await page.mouse.click(c.x + 120, c.y + 140);
  await page.keyboard.press('Enter');
  await expect.poll(aisles).toEqual([2, 2]);
});

test('a machine is dragged across the floor in the 3D view', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('view-3d').click();
  // three.js loads lazily: on a busy machine the first 3D view takes longer than the default 5 s.
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('move-3d').click();
  // Where the Nebula stands on screen, through the scene's own camera.
  const spot = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as {
          __scene: {
            camera: { position: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): void; x: number; y: number } } };
            renderer: { domElement: HTMLElement };
          };
        }
      ).__scene;
      const o = (
        window as unknown as { __factory: { project: { getState(): { project: { objects: { name: string; x: number; y: number; z: number; size: { h: number } }[] } } } } }
      ).__factory.project
        .getState()
        .project.objects.find((x) => x.name === 'Nebula')!;
      const v = new s.camera.position.constructor(o.x / 1000, (o.z + o.size.h / 2) / 1000, o.y / 1000);
      v.project(s.camera);
      const r = s.renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, ox: o.x, oy: o.y };
    });
  const camera = () => page.evaluate(() => JSON.stringify((window as unknown as { __scene: { camera: { position: unknown } } }).__scene.camera.position));
  const cam0 = await camera();
  const a = await spot();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + 60, { steps: 8 });
  await page.mouse.up();
  const b = await spot();
  expect(Math.hypot(b.ox - a.ox, b.oy - a.oy)).toBeGreaterThan(500);
  // The camera stays put while a machine is dragged, and does not keep turning afterwards.
  await page.mouse.move(a.x + 300, a.y + 200, { steps: 6 });
  expect(await camera()).toBe(cam0);
  // One undo step for the whole drag.
  await page.keyboard.press('Control+z');
  const c = await spot();
  expect(Math.round(c.ox)).toBe(Math.round(a.ox));
});

test('a link carries the sender and the tapes, is listed on the start page, and stops working once deleted', async ({ page, browser }) => {
  await openSample(page);
  // A tape laid before sharing goes with the link.
  await page.getByTestId('tool-measure').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 100, c.y + 60);
  await page.mouse.click(c.x + 100, c.y + 60);
  await expect(page.getByTestId('measure-line')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByTestId('share-link').click();
  await page.getByTestId('share-sender').fill('บริษัท ทดสอบ');
  await page.getByTestId('share-make').click();
  const url = await page.getByTestId('share-url').inputValue();
  const id = url.split('/s/')[1];

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(url);
  await expect(customer.getByTestId('share-banner')).toContainText('จาก บริษัท ทดสอบ');
  await expect(customer.getByTestId('measure-line')).toHaveCount(1);

  await page.goto('/#/');
  await expect(page.getByTestId(`sent-${id}`)).toContainText('บริษัท ทดสอบ');
  await page.getByTestId(`sent-${id}`).getByTestId('sent-delete').click();
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId(`sent-${id}`)).toHaveCount(0);

  const late = await (await browser.newContext()).newPage();
  await late.goto(url);
  await expect(late.getByTestId('route-problem')).toContainText('ไม่พบลิงก์นี้');
});

test('the project name and customer are edited from the top bar, shown on the card, and kept out of share links', async ({ page, browser }) => {
  await openSample(page);
  await page.getByTestId('project-title').click();
  await page.getByTestId('pi-name').fill('โรงงาน ABC เฟส 2');
  await page.getByTestId('pi-company').fill('บริษัท เอบีซี');
  await page.getByTestId('pi-phone').fill('081-234-5678');
  await page.getByTestId('pi-done').click();
  await expect(page.getByTestId('project-title')).toContainText('โรงงาน ABC เฟส 2');
  await expect(page.getByTestId('project-title')).toContainText('บริษัท เอบีซี');
  // One undo step takes the whole edit back.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('project-title')).not.toContainText('บริษัท เอบีซี');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('project-title')).toContainText('บริษัท เอบีซี');

  await page.getByTestId('share-link').click();
  await page.getByTestId('share-make').click();
  const url = await page.getByTestId('share-url').inputValue();
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(url);
  await expect(customer.getByTestId('share-banner')).toBeVisible();
  const client = await customer.evaluate(
    () => (window as unknown as { __factory: { project: { getState(): { project: { client?: unknown } } } } }).__factory.project.getState().project.client,
  );
  expect(client).toBeUndefined();

  await page.goto('/#/');
  await expect(page.getByTestId('card-client').first()).toContainText('บริษัท เอบีซี');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the top bar fits without buttons on top of each other, and the library comes up as a sheet', async ({ page }) => {
    await openSample(page);
    const boxes = await page.locator('header.topbar button:visible, header.topbar a:visible').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
        // Buttons inside one segmented group sit edge to edge; real overlap is what this catches.
        expect(overlap, `top bar buttons ${i} and ${j} overlap`).toBe(false);
      }
    for (const b of boxes) expect(b.r).toBeLessThanOrEqual(391);
    await page.getByTestId('dock-catalog').click();
    const sheet = await page.locator('.dock-col').boundingBox();
    expect(sheet!.width).toBeGreaterThan(300);
  });
});
