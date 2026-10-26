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
