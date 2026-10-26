import { expect, test, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { freshApp, planCentre, projectState } from './helpers';

/** The start page with the interior mode switched on, as `?interior` does on the live site. */
async function interiorApp(page: Page) {
  await page.goto('/?interior');
  await expect(page.getByTestId('new-interior')).toBeVisible();
}

test('the interior start button is hidden until ?interior turns it on, and ?interior=0 hides it again', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByTestId('new-interior')).toHaveCount(0);
  // With interiors off the list keeps its factory words; with them on it speaks of projects.
  await expect(page.locator('.list-head h2')).toHaveText(/^โรงงานของฉัน/);
  await interiorApp(page);
  await expect(page.locator('.list-head h2')).toHaveText(/^โปรเจกต์ของฉัน/);
  await page.goto('/');
  await expect(page.getByTestId('new-interior')).toBeVisible();
  await page.goto('/?interior=0');
  await expect(page.getByTestId('new-sample')).toBeVisible();
  await expect(page.getByTestId('new-interior')).toHaveCount(0);
  await expect(page.locator('.list-head h2')).toHaveText(/^โรงงานของฉัน/);
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

/** A new interior project with one room drawn, its library open on the given shelf; the room's middle on screen. */
async function roomWithLibrary(page: Page, shelf: 'general' | 'mine' = 'general') {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 150, c.y - 100);
  await page.mouse.click(c.x + 150, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1 });
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-catalog').click();
  await page.getByTestId(`shelf-${shelf}`).click();
  return c;
}

interface Seen {
  assetId: string;
  w: number;
  cabinet?: { width: number; bays: number };
}

/** The placed objects with their width and cabinet spec, read from the dev hook. */
const objects = (page: Page) =>
  page.evaluate((): Seen[] => {
    type O = { assetId: string; size: { w: number }; cabinet?: { width: number; bays: unknown[] } };
    const p = (window as unknown as { __factory: { project: { getState(): { project: { objects: O[] } } } } }).__factory.project.getState().project;
    return p.objects.map((o) => ({ assetId: o.assetId, w: o.size.w, ...(o.cabinet && { cabinet: { width: o.cabinet.width, bays: o.cabinet.bays.length } }) }));
  });

/** Walks the 3D scene the e2e build leaves on window, returning what `pick` makes of its objects. */
const inScene = <T>(page: Page, pick: 'door' | 'model') =>
  page.evaluate((what) => {
    type Node = { name: string; rotation: { y: number } };
    // The 3D view loads a moment after its tab is clicked: until then there is nothing to find.
    const scene = (window as unknown as { __scene?: { scene: { traverse(f: (o: Node) => void): void } } }).__scene?.scene;
    let out = 0;
    if (!scene) return out;
    scene.traverse((o) => {
      if (what === 'door' && o.name === 'door') out = Math.max(out, Math.abs(o.rotation.y));
      if (what === 'model' && o.name === 'cube.obj') out = 1;
    });
    return out;
  }, pick) as Promise<T>;

test('a base cabinet is placed, made wider and split in two; its parts list follows, Ctrl+Z takes it back, and it opens in 3D', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));

  const c = await roomWithLibrary(page);
  await page.getByTestId('cat-cab-base').click();
  await page.mouse.click(c.x, c.y);
  await expect.poll(() => objects(page)).toEqual([{ assetId: 'cab-base', w: 600, cabinet: { width: 600, bays: 1 } }]);
  await expect(page.getByTestId('cabinet-panel')).toBeVisible();
  await expect(page.getByTestId('cabinet-plan')).toHaveCount(1);

  await page.getByTestId('cab-parts').locator('summary').click();
  const table = page.getByTestId('cab-parts-table');
  await expect(table).not.toContainText('แผ่นกั้นช่อง');
  const areaBefore = await page.getByTestId('cab-parts-area').innerText();

  await page.getByTestId('cab-width').fill('120');
  await page.getByTestId('cab-width').blur();
  await expect.poll(() => objects(page)).toEqual([{ assetId: 'cab-base', w: 1200, cabinet: { width: 1200, bays: 1 } }]);
  await page.getByTestId('cab-bays').fill('2');
  await page.getByTestId('cab-bays').blur();
  await expect(page.getByTestId('cab-bay-1')).toBeVisible();
  await expect(table).toContainText('แผ่นกั้นช่อง');
  await expect(page.getByTestId('cab-parts-area')).not.toHaveText(areaBefore);
  await page.getByTestId('cab-front-1').selectOption('drawers');
  await expect(table).toContainText('หน้าลิ้นชัก');

  // Each change is one step back.
  const undo = page.getByRole('button', { name: 'เลิกทำ (Ctrl+Z)' });
  await undo.click();
  await expect(table).not.toContainText('หน้าลิ้นชัก');
  await undo.click();
  await expect.poll(() => objects(page)).toEqual([{ assetId: 'cab-base', w: 1200, cabinet: { width: 1200, bays: 1 } }]);
  await undo.click();
  await expect.poll(() => objects(page)).toEqual([{ assetId: 'cab-base', w: 600, cabinet: { width: 600, bays: 1 } }]);

  // The panel slides over the view's buttons: put it away first.
  await page.getByTestId('properties').getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  // The view opens from above with the ceilings off, so the room can be seen into.
  await expect(page.getByTestId('ceilings-hidden')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('cabinets-open').click();
  await expect(page.getByTestId('cabinets-open')).toHaveAttribute('aria-pressed', 'true');
  // The door has swung a quarter turn once the short animation is over.
  await expect.poll(() => inScene<number>(page, 'door')).toBeCloseTo(Math.PI / 2, 2);
  await page.getByTestId('cabinets-open').click();
  await expect.poll(() => inScene<number>(page, 'door')).toBe(0);
  expect(errors).toEqual([]);
});

test('a model exported from SketchUp comes in as OBJ at its real size, is placed and shown in 3D; a .skp is refused', async ({ page }) => {
  const c = await roomWithLibrary(page, 'mine');
  await page.getByTestId('import-model').click();
  const input = page.getByTestId('import-model-file');
  await input.setInputFiles({ name: 'kitchen.skp', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(page.getByTestId('import-model-error')).toContainText('File → Export → 3D Model');

  // A box 60 wide, 90 high and 45 deep in centimetres, as SketchUp writes an OBJ (Y up, no unit in the file).
  const v = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `v ${i & 1 ? 60 : 0} ${i & 2 ? 90 : 0} ${i & 4 ? 45 : 0}`);
  const f = ['1 2 4 3', '5 7 8 6', '1 5 6 2', '2 6 8 4', '4 8 7 3', '3 7 5 1'].map((q) => `f ${q}`);
  await input.setInputFiles({ name: 'cube.obj', mimeType: 'text/plain', buffer: Buffer.from([...v, ...f].join('\n')) });
  await expect(page.getByTestId('import-model-size')).toContainText('0.60 × 0.45 × 0.90');
  await expect(page.getByTestId('import-model-unit')).toHaveValue('cm');
  await expect(page.getByTestId('import-model-name')).toHaveValue('cube');
  await page.getByTestId('import-model-save').click();
  await expect(page.getByTestId('import-model-dialog')).toHaveCount(0);

  const card = page.locator('[data-testid^="cat-cm"]');
  await expect(card).toHaveCount(1);
  await card.click();
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await objects(page)).map((o) => o.w)).toEqual([600]);

  await page.getByTestId('view-3d').click();
  await expect.poll(() => inScene<number>(page, 'model')).toBe(1);
});

/** A new interior project with a room about 5 × 4 m drawn in the middle of the plan; the plan's middle on screen. */
async function smallRoom(page: Page) {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 100, c.y - 80);
  await page.mouse.click(c.x + 100, c.y + 80);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1, walls: 4 });
  await page.keyboard.press('Escape');
  return c;
}

test('a room drawn in an interior is a room of a home, not a factory zone', async ({ page }) => {
  const c = await smallRoom(page);
  await page.mouse.click(c.x, c.y);
  const panel = page.getByTestId('properties');
  await expect(panel).toContainText('ห้อง 1');
  await expect(panel).not.toContainText('พื้นที่ผลิต');
  await expect(panel).not.toContainText('โซน 1');
});

test('3D opens on a small room from above: every corner on screen and its floor seen over the near wall', async ({ page }) => {
  await smallRoom(page);
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  const seen = async () =>
    page.evaluate(() => {
      type V = { x: number; y: number; z: number; project(c: unknown): V };
      const s = (window as unknown as { __scene?: { camera: { position: V } } }).__scene;
      const p = (
        window as unknown as { __factory: { project: { getState(): { project: { plan: { corners: Record<string, { x: number; y: number }> } } } } } }
      ).__factory.project.getState().project;
      if (!s) return null;
      const cam = s.camera;
      const corners = Object.values(p.plan.corners);
      const Vec = cam.position.constructor as new (x: number, y: number, z: number) => V;
      const onScreen = corners.every((c) =>
        [0, 3].every((h) => {
          const q = new Vec(c.x / 1000, h, c.y / 1000).project(cam);
          return Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1;
        }),
      );
      // Where the sight line to the middle of the floor crosses the near wall (the plan's bottom edge), and how high.
      const ys = corners.map((c) => c.y / 1000);
      const xs = corners.map((c) => c.x / 1000);
      const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const near = Math.max(...ys);
      const k = (cam.position.z - near) / (cam.position.z - mid.z);
      return { onScreen, overWall: cam.position.y * (1 - k) };
    });
  await expect.poll(seen).not.toBeNull();
  const r = (await seen())!;
  expect(r.onScreen).toBe(true);
  expect(r.overWall).toBeGreaterThan(3);
});

test('the AI picture dialog of an interior writes the prompt from its rooms, not a factory', async ({ page }) => {
  await smallRoom(page);
  await page.getByTestId('main-menu').click();
  await expect(page.getByTestId('menu-flow')).toHaveText(/สร้างภาพห้องด้วย Google Flow/);
  await page.keyboard.press('Escape');
  await page.getByTestId('flow-button').click();
  const dialog = page.getByTestId('flow-dialog');
  await expect(dialog).toContainText('สร้างภาพห้องด้วย Google Flow');
  const prompt = page.getByTestId('flow-prompt');
  await expect(prompt).toHaveValue(/^Photorealistic interior photograph of the rooms below/);
  await expect(prompt).toHaveValue(/Room 1, room: [0-9.]+ × [0-9.]+ m/);
  await expect(prompt).not.toHaveValue(/factory|machine/i);
});

test('an interior speaks of furniture when shared', async ({ page, browser }) => {
  await smallRoom(page);
  await page.getByTestId('main-menu').click();
  await expect(page.getByTestId('menu-share')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('share-link').click();
  await expect(page.getByRole('dialog')).toContainText('ย้ายเฟอร์นิเจอร์เองได้');
  await page.getByTestId('share-make').click();
  const url = await page.getByTestId('share-url').inputValue();
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(url);
  await expect(customer.getByTestId('share-banner')).toContainText('ลากเฟอร์นิเจอร์เพื่อย้าย');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('picking a piece puts the library away so the next tap places it; the menu opens over the library', async ({ page }) => {
    const c = await smallRoom(page);
    await page.getByTestId('dock-catalog').click();
    await page.getByTestId('cat-home-chair').click();
    await expect(page.getByTestId('catalog')).toHaveCount(0);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await projectState(page)).objects.map((o) => o.assetId)).toEqual(['home-chair']);

    await page.getByTestId('dock-catalog').click();
    await expect(page.getByTestId('catalog')).toBeVisible();
    await page.getByTestId('main-menu').click();
    // A trial click fails when something else lies over the item.
    await page.getByTestId('menu-share').click({ trial: true, timeout: 3000 });
  });
});

test('a wall between two rooms takes a material on one face only, and Ctrl+Z puts it back on both', async ({ page }) => {
  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 200, c.y - 100);
  await page.mouse.click(c.x, c.y + 100);
  await page.mouse.click(c.x, c.y - 100);
  await page.mouse.click(c.x + 200, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 2 });
  await page.keyboard.press('Escape');
  // The wall the two rooms share: the middle one of the walls running down the plan.
  await page.evaluate(() => {
    type W = { id: string; a: string; b: string };
    const f = (
      window as unknown as {
        __factory: {
          project: { getState(): { project: { plan: { walls: Record<string, W>; corners: Record<string, { x: number }> } } } };
          ui: { getState(): { set(p: object): void } };
        };
      }
    ).__factory;
    const { walls, corners } = f.project.getState().project.plan;
    const down = Object.values(walls)
      .filter((w) => Math.abs(corners[w.a].x - corners[w.b].x) < 1)
      .sort((p, q) => corners[p.a].x - corners[q.a].x);
    f.ui.getState().set({ selection: { kind: 'wall', id: down[1].id } });
  });
  await page.getByTestId('surface-wall').click();
  await page.getByTestId('material-paint-sage').click();
  const face = page.getByTestId('wall-face');
  await expect(face).toContainText('ทั้งสองหน้า');
  await expect(face).toContainText('ฝั่งห้อง 1');
  await expect(face).toContainText('ฝั่งห้อง 2');
  await expect(page.getByTestId('wall-face-both')).toHaveAttribute('aria-checked', 'true');
  const sideOfWall = () =>
    page.evaluate(() => {
      const p = (
        window as unknown as { __factory: { project: { getState(): { project: { plan: { walls: Record<string, { finish?: string; finishSide?: string }> } } } } } }
      ).__factory.project.getState().project;
      return Object.values(p.plan.walls)
        .filter((w) => w.finish)
        .map((w) => `${w.finish}:${w.finishSide ?? 'both'}`);
    });
  await page.getByTestId('wall-face-B').click();
  await expect(page.getByTestId('wall-face-B')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(sideOfWall).toEqual(['paint-sage:B']);
  await page.keyboard.press('Control+z');
  await expect.poll(sideOfWall).toEqual(['paint-sage:both']);
});

/** The page size of each page in a PDF, in points, read off its MediaBox entries. */
const pdfPages = (pdf: Buffer) =>
  [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({
    w: Math.round(Number(m[3]) - Number(m[1])),
    h: Math.round(Number(m[4]) - Number(m[2])),
  }));

test('the client presentation puts cover, plan, Mood & Tone and furniture on A3 sheets, and prints them A3 while the BOQ still prints A4', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));

  await interiorApp(page);
  await page.getByTestId('new-interior').click();
  await page.getByTestId('tool-drawRoomRect').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x - 150, c.y - 100);
  await page.mouse.click(c.x + 150, c.y + 100);
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 1 });
  await page.keyboard.press('Escape');
  await page.mouse.click(c.x, c.y);
  await page.getByTestId('surface-floor').click();
  await page.getByTestId('material-oak').click();
  await page.getByTestId('properties').getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.getByTestId('dock-catalog').click();
  await page.getByTestId('shelf-general').click();
  await page.getByTestId('cat-home-sofa-l').click();
  await page.mouse.click(c.x - 60, c.y);
  await page.getByTestId('cat-cab-base').click();
  await page.mouse.click(c.x + 90, c.y - 60);
  await expect.poll(async () => (await objects(page)).map((o) => o.assetId).sort()).toEqual(['cab-base', 'home-sofa-l']);
  await page.getByTestId('present-open').click();
  await expect(page.getByTestId('present')).toBeVisible();
  for (const s of ['cover', 'plan', 'mood', 'furniture']) await expect(page.getByTestId(`sheet-${s}`)).toHaveCount(1);
  // No pictures yet: no picture sheet, and its tick is off.
  await expect(page.getByTestId('sheet-images')).toHaveCount(0);
  await expect(page.getByTestId('present-pick-images')).toBeDisabled();
  await expect(page.getByTestId('cover-title')).toHaveText('ห้องใหม่');
  await expect(page.getByTestId('cover-client')).toHaveCount(0);
  await expect(page.getByTestId('plan-picture')).toBeVisible();
  await expect(page.getByTestId('sheet-plan')).toContainText('ม²');
  await expect(page.getByTestId('sheet-mood')).toContainText('ไม้โอ๊คอ่อน');
  await expect(page.getByTestId('present-palette')).toContainText('#C9A471');
  await expect(page.getByTestId('sheet-furniture')).toContainText('โซฟาตัว L');
  await expect(page.getByTestId('sheet-furniture')).toContainText('ตู้ล่าง');
  await expect(page.getByTestId('sheet-furniture')).toContainText('18 มม.');
  await expect(page.getByTestId('sheet-cover')).toContainText('หน้า 1/4');
  await expect(page.getByTestId('present-print')).toBeEnabled();

  // A section ticked off leaves the count and the page numbers.
  await page.getByTestId('present-pick-mood').uncheck();
  await expect(page.getByTestId('sheet-mood')).toHaveCount(0);
  await expect(page.getByTestId('sheet-furniture')).toContainText('หน้า 3/3');
  await page.getByTestId('present-pick-mood').check();

  // Printed, each sheet is one A3 landscape page (842 × 1191 pt).
  await page.evaluate(() => document.documentElement.classList.add('present-printing'));
  const a3 = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(a3).toEqual(Array(4).fill({ w: 1191, h: 842 }));
  await page.evaluate(() => document.documentElement.classList.remove('present-printing'));

  await page.getByTestId('present-close').click();
  await expect(page.getByTestId('present')).toHaveCount(0);
  await page.getByTestId('boq-open').click();
  const a4 = pdfPages(await page.pdf({ preferCSSPageSize: true }));
  expect(a4.length).toBeGreaterThan(0);
  for (const p of a4) expect(p).toEqual({ w: 595, h: 842 });
  expect(errors).toEqual([]);
});

test('a 3D view kept with "add this view" makes a picture sheet, and can be taken out again', async ({ page }) => {
  await roomWithLibrary(page);
  await page.getByTestId('dock-catalog').click();
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  await page.getByTestId('present-open').click();
  await expect(page.getByTestId('sheet-images')).toHaveCount(0);
  await page.getByTestId('present-keep-view').click();
  await expect(page.getByTestId('present-image-shot')).toHaveCount(1);
  await expect(page.getByTestId('sheet-images')).toContainText('มุมมอง 3D');
  const shots = () =>
    page.evaluate(
      () => (window as unknown as { __factory: { project: { getState(): { project: { shots?: unknown[] } } } } }).__factory.project.getState().project.shots?.length ?? 0,
    );
  expect(await shots()).toBe(1);
  await page.getByTestId('present-image-shot').getByRole('button', { name: 'ลบมุมนี้' }).click();
  await expect(page.getByTestId('sheet-images')).toHaveCount(0);
  expect(await shots()).toBe(0);
});

test.describe('interior on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the interior top bar fits without buttons on top of each other; the presentation is in the main menu', async ({ page }) => {
    await interiorApp(page);
    await page.getByTestId('new-interior').click();
    await expect(page.getByTestId('interior-editor')).toBeVisible();
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
        expect(overlap, `top bar buttons ${i} and ${j} overlap`).toBe(false);
      }
    for (const b of boxes) expect(b.r).toBeLessThanOrEqual(391);
    await expect(page.getByTestId('present-open')).toBeHidden();
    await expect(page.getByTestId('flow-button')).toBeHidden();
    await page.getByTestId('main-menu').click();
    await page.getByTestId('menu-present').click();
    await expect(page.getByTestId('sheet-cover')).toBeVisible();
  });
});

test('the sample condo opens from the start page furnished, without placement problems, and fills the BOQ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('new-sample')).toBeVisible();
  // Hidden on the live site with the rest of the interior mode.
  await expect(page.getByTestId('new-sample-condo')).toHaveCount(0);
  await interiorApp(page);
  await page.getByTestId('new-sample-condo').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await expect.poll(() => projectState(page)).toMatchObject({ rooms: 3 });
  await expect(page.locator('.issues-chip')).toHaveCount(0);
  await page.getByTestId('boq-open').click();
  await expect(page.getByTestId('boq-line-oak')).toBeVisible();
  await expect(page.getByTestId('boq-line-tile-grey-600')).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * How wide, in points, each page of a printed drawing set draws the sheet frame (`10 10 400 277 re` in sheet mm):
 * the page's own scale times the scale set just before the frame, read off the inflated content streams.
 */
function pdfFrameWidths(pdf: Buffer): number[] {
  const text = pdf.toString('latin1');
  const widths: number[] = [];
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    let body: string;
    try {
      body = inflateSync(pdf.subarray(start, text.indexOf('endstream', start))).toString('latin1');
    } catch {
      continue;
    }
    const frame = body.indexOf('10 10 400 277 re');
    if (frame < 0) continue;
    const scales = [...body.slice(0, frame).matchAll(/([\d.]+) 0 0 -?[\d.]+ [-\d.]+ [-\d.]+ cm/g)].map((s) => Number(s[1]));
    widths.push(400 * scales[0] * scales[scales.length - 1]);
  }
  return widths;
}

test('the construction drawings of the sample condo: a cover and a dimensioned plan, printed A3 and saved as DXF', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  // Wide enough for the top bar button; narrower, it is only in the main menu.
  await page.setViewportSize({ width: 1600, height: 900 });
  await interiorApp(page);
  await page.getByTestId('new-sample-condo').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();

  await page.getByTestId('drawings-open').click();
  await expect(page.getByTestId('drawings')).toBeVisible();
  const sheet = page.getByTestId('drawing-sheet');
  // The cover first: the project's name and the index of every sheet.
  await expect(sheet).toHaveAttribute('data-sheet', 'ID-00-01');
  await expect(sheet.getByTestId('cover')).toContainText('ห้องตัวอย่าง: คอนโด 1 ห้องนอน');
  // The cover, the plan, and seven elevation sheets: two faces each for the bedroom, the bathroom and the L-shaped living room.
  await expect(sheet.getByTestId('cover-index-row')).toHaveCount(9);
  await expect(sheet.getByTestId('cover')).toContainText('ELEVATION A, B / รูปด้าน A, B · ห้องนอน');
  await expect(sheet.getByTestId('cover')).toContainText('FLOOR PLAN / แปลนพื้น');

  // The plan: overall dimensions over the outer faces, 7000 + 200 by 5500 + 200, its number in the title block.
  await page.getByTestId('drawings-item-ID-04-01').click();
  await expect(sheet).toHaveAttribute('data-sheet', 'ID-04-01');
  await expect(sheet.locator('[data-dim="7200"]')).toHaveCount(1);
  await expect(sheet.locator('[data-dim="5700"]')).toHaveCount(1);
  await expect(sheet.getByTestId('title-block')).toContainText('ID-04-01');
  await expect(sheet.getByTestId('title-block')).toContainText('หน่วย มม. · ตรวจระยะหน้างาน');
  await expect(sheet).toContainText('ห้องนอน');
  await expect(sheet).toContainText(/SCALE 1:\d+/);

  // An elevation sheet: two faces of the living room with its kitchen cabinets, the room name whole.
  await page.getByTestId('drawings-item-ID-09-01').click();
  await expect(sheet).toHaveAttribute('data-sheet', 'ID-09-01');
  await expect(sheet.getByTestId('sheet-view')).toHaveCount(2);
  await expect(sheet).toContainText('นั่งเล่น / ครัว');
  await page.getByTestId('drawings-item-ID-04-01').click();
  // The numbers in cm or m: the same plan, the title block says which unit.
  await expect(page.getByTestId('drawings-unit-cm')).toHaveCount(0);
  await page.getByTestId('drawings-settings').click();
  await page.getByTestId('drawings-unit-cm').click();
  await expect(sheet.locator('[data-dim="720"]')).toHaveCount(1);
  await expect(sheet.locator('[data-dim="7200"]')).toHaveCount(0);
  await expect(sheet.getByTestId('title-block')).toContainText('หน่วย ซม. · ตรวจระยะหน้างาน');
  await page.getByTestId('drawings-unit-m').click();
  await expect(sheet.locator('[data-dim="7.20"]')).toHaveCount(1);
  await expect(sheet.getByTestId('title-block')).toContainText('หน่วย ม.');
  await page.getByTestId('drawings-unit-mm').click();
  await expect(sheet.locator('[data-dim="7200"]')).toHaveCount(1);
  // Escape puts the gear menu away and leaves the drawings open.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawings-settings-menu')).toHaveCount(0);
  await expect(page.getByTestId('drawings')).toBeVisible();

  const zoom = await page.getByTestId('drawings-zoom').textContent();
  await page.getByTestId('drawings-zoom-in').click();
  await expect(page.getByTestId('drawings-zoom')).not.toHaveText(zoom!);

  // DXF of the plan, at full size in mm.
  const [dxf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('drawings-dxf').click()]);
  expect(dxf.suggestedFilename()).toMatch(/ID-04-01\.dxf$/);
  const { readFile } = await import('node:fs/promises');
  const text = await readFile((await dxf.path())!, 'utf8');
  expect(text).toContain('AC1009');
  expect(text).toMatch(/\r\n7200\r\n/);

  // Printed, one A3 landscape page a sheet.
  await page.evaluate(() => document.documentElement.classList.add('drawings-printing'));
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(pdf)).toEqual(Array(9).fill({ w: 1191, h: 842 }));
  // At full size, not shrunk to fit: the sheet's 400 mm frame is drawn 400 mm (1133.9 pt) wide.
  expect(pdfFrameWidths(pdf).map(Math.round)).toEqual(Array(9).fill(1134));
  await page.evaluate(() => document.documentElement.classList.remove('drawings-printing'));

  await page.getByTestId('drawings-close').click();
  await expect(page.getByTestId('drawings')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('construction drawings on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the drawings open from the main menu', async ({ page }) => {
    await interiorApp(page);
    await page.getByTestId('new-sample-condo').click();
    await expect(page.getByTestId('interior-editor')).toBeVisible();
    await expect(page.getByTestId('drawings-open')).toBeHidden();
    await page.getByTestId('main-menu').click();
    await page.getByTestId('menu-drawings').click();
    await expect(page.getByTestId('drawing-sheet')).toBeVisible();
    await page.getByTestId('drawings-item-ID-04-01').click();
    await expect(page.getByTestId('drawing-sheet').locator('[data-dim="7200"]')).toHaveCount(1);
  });
});
