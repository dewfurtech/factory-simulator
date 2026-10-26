import { expect, test, type Page } from '@playwright/test';
import { openSample } from './helpers';

/** What the 3D view draws now: its look, and how many meshes wear clay or cast shadows. */
const sceneLook = (page: Page) =>
  page.evaluate(() => {
    type Node = { isMesh?: boolean; castShadow: boolean; material: { userData: { clay?: boolean } } | { userData: { clay?: boolean } }[] };
    const s = (
      window as unknown as {
        __scene?: { look: { current: { clay: boolean; shadows: boolean } }; scene: { traverse(f: (o: Node) => void): void }; renderer: { shadowMap: { enabled: boolean } } };
      }
    ).__scene;
    if (!s) throw new Error('no 3D view');
    let meshes = 0;
    let dressed = 0;
    let casting = 0;
    s.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.userData.clay) dressed++;
      if (o.castShadow) casting++;
    });
    return { ...s.look.current, shadowMap: s.renderer.shadowMap.enabled, meshes, dressed, casting };
  });

/** Collects page errors and console errors from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  return errors;
}

async function open3d(page: Page) {
  await page.getByTestId('view-3d').click();
  // three.js loads lazily: on a busy machine the first 3D view takes longer than the default 5 s.
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sceneLook(page)).meshes).toBeGreaterThan(5);
}

async function openCondo(page: Page) {
  await page.goto('/?interior');
  await page.getByTestId('new-sample-condo').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
}

test('a factory opens in 3D as it always has, and turns to clay and shadows by the two buttons, remembered on reload', async ({ page }) => {
  const errors = watchErrors(page);
  await openSample(page);
  await open3d(page);
  const clay = page.getByTestId('clay-3d');
  const shadows = page.getByTestId('shadows-3d');
  await expect(clay).toHaveAttribute('aria-pressed', 'false');
  await expect(shadows).toHaveAttribute('aria-pressed', 'false');
  expect(await sceneLook(page)).toMatchObject({ clay: false, shadows: false, shadowMap: false, dressed: 0 });

  await clay.click();
  await expect(clay).toHaveAttribute('aria-pressed', 'true');
  // Every mesh wears clay.
  await expect
    .poll(async () => {
      const l = await sceneLook(page);
      return l.clay && l.dressed === l.meshes;
    })
    .toBe(true);

  await shadows.click();
  await expect(shadows).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sceneLook(page)).shadowMap).toBe(true);
  expect((await sceneLook(page)).casting).toBeGreaterThan(5);

  await page.reload();
  await open3d(page);
  await expect(page.getByTestId('clay-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('shadows-3d')).toHaveAttribute('aria-pressed', 'true');

  // Back to plain: every mesh has its own material again.
  await page.getByTestId('clay-3d').click();
  await page.getByTestId('shadows-3d').click();
  await expect
    .poll(async () => {
      const l = await sceneLook(page);
      return [l.clay, l.shadowMap, l.dressed];
    })
    .toEqual([false, false, 0]);
  expect(errors).toEqual([]);
});

test('an interior opens with shadows on and clay off, keeps its own switches apart from a factory’s, and takes a clay reference for the AI picture', async ({ page }) => {
  const errors = watchErrors(page);
  await openCondo(page);
  await open3d(page);
  const clay = page.getByTestId('clay-3d');
  const shadows = page.getByTestId('shadows-3d');
  await expect(clay).toHaveAttribute('aria-pressed', 'false');
  await expect(shadows).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sceneLook(page)).shadowMap).toBe(true);

  await clay.click();
  await expect(clay).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sceneLook(page)).clay).toBe(true);
  await clay.click();
  await shadows.click();
  await expect(shadows).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await sceneLook(page)).shadowMap).toBe(false);

  // The reference picture in clay: taken in clay with shadows, while the screen stays as it was.
  // Its buttons are switched off for now (AI_PICTURES): the dialog opens through the test hook.
  await page.evaluate(() => void (window as unknown as { __factory: { openFlow(): Promise<void> } }).__factory.openFlow());
  const dialog = page.getByTestId('flow-dialog');
  await expect(dialog.locator('.flow-ref img')).toBeVisible();
  const plain = await dialog.locator('.flow-ref img').getAttribute('src');
  await page.getByTestId('flow-clay').check();
  await expect.poll(() => dialog.locator('.flow-ref img').getAttribute('src')).not.toBe(plain);
  expect(await sceneLook(page)).toMatchObject({ clay: false, shadows: false, shadowMap: false, dressed: 0 });
  await page.keyboard.press('Escape');

  // A factory opened after it still has its own defaults.
  await openSample(page);
  await open3d(page);
  await expect(page.getByTestId('clay-3d')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('shadows-3d')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the 3D view buttons all fit on screen, none on top of another', async ({ page }) => {
    await openCondo(page);
    await open3d(page);
    await expect(page.getByTestId('clay-3d')).toBeVisible();
    const boxes = await page.locator('.view-tools button:visible, .view3d .view-help button:visible').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
    );
    expect(boxes.length).toBeGreaterThan(8);
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      expect(a.r).toBeLessThanOrEqual(390);
      expect(a.b).toBeLessThanOrEqual(844);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
        expect(overlap, `3D buttons ${i} and ${j} overlap`).toBe(false);
      }
    }
  });
});
