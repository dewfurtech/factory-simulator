import { expect, test, type Page } from '@playwright/test';
import { openSample, planCentre, projectState } from './helpers';

/** Errors the page throws or logs, gathered for the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  return errors;
}

/** How many frames the 3D view draws in `ms`, read from the renderer through the scene the app leaves on window. */
const framesIn = (page: Page, ms: number) =>
  page.evaluate(async (ms) => {
    const info = (window as unknown as { __scene: { renderer: { info: { render: { frame: number } } } } }).__scene.renderer.info.render;
    const f0 = info.frame;
    await new Promise((r) => setTimeout(r, ms));
    return info.frame - f0;
  }, ms);

/** Drops the selection, so the properties panel steps aside from the 3D buttons. */
const deselect = (page: Page) =>
  page.evaluate(() => (window as unknown as { __factory: { ui: { getState(): { set(p: object): void } } } }).__factory.ui.getState().set({ selection: null, panelOpen: false }));

/** The joints' angle of the first figure's head, which the idle pose turns. */
const headTurn = (page: Page) =>
  page.evaluate(() => {
    let turn: number | null = null;
    (
      window as unknown as { __scene: { scene: { traverse(f: (o: { name: string; userData: { joints?: { head: { rotation: { y: number } } } } }) => void): void } } }
    ).__scene.scene.traverse((o) => {
      // The code-built figures; the man is a model with no joints of ours.
      if (turn === null && o.name === 'figure' && o.userData.joints) turn = o.userData.joints.head.rotation.y;
    });
    return turn;
  });

test('the sample factory has hands at the machines: a person symbol on the plan, the people and idle switches in 3D', async ({ page }) => {
  const errors = watchErrors(page);
  await openSample(page);
  const s = await projectState(page);
  expect(s.objects.filter((o) => o.assetId === 'person-worker').length).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('figure-symbol')).toHaveCount(s.objects.filter((o) => o.assetId.startsWith('person-')).length);

  // A person put down on a machine is not a clash: no new red badge.
  const badges = await page.getByTestId('issue-badge').count();
  await page.getByTestId('dock-catalog').click();
  await page.getByTestId('shelf-general').click();
  await page.getByTestId('chip-people').click();
  for (const id of ['person-man', 'person-woman', 'person-child', 'person-worker']) await expect(page.getByTestId(`cat-${id}`)).toBeVisible();
  await page.getByTestId('cat-person-man').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await projectState(page)).objects.length).toBe(s.objects.length + 1);
  await page.keyboard.press('Escape');
  await deselect(page);
  await expect(page.getByTestId('issue-badge')).toHaveCount(badges);

  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  // A factory's view stands still by default: the idle pose is off and nothing redraws on its own.
  const idle = page.getByTestId('figures-idle');
  await expect(idle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(600);
  expect(await framesIn(page, 500)).toBe(0);
  await idle.click();
  await expect(idle).toHaveAttribute('aria-pressed', 'true');
  const a = await headTurn(page);
  expect(await framesIn(page, 500)).toBeGreaterThan(3);
  expect(await headTurn(page)).not.toBe(a);
  await idle.click();
  await page.waitForTimeout(200);
  expect(await framesIn(page, 500)).toBe(0);

  // Hidden in both views, and the idle switch goes with them.
  await page.getByTestId('figures-toggle').click();
  await expect(page.getByTestId('figures-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(idle).toHaveCount(0);
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('plan')).toBeVisible();
  await expect(page.getByTestId('figure-symbol')).toHaveCount(0);
  // Kept in this browser.
  await page.reload();
  await expect(page.getByTestId('plan')).toBeVisible();
  await expect(page.getByTestId('figure-symbol')).toHaveCount(0);
  await page.getByTestId('view-3d').click();
  await page.getByTestId('figures-toggle').click();
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('figure-symbol')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sample condo has a person in the living room, moving gently in 3D; the library has people but no factory hand', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?interior');
  await page.getByTestId('new-sample-condo').click();
  await expect(page.getByTestId('interior-editor')).toBeVisible();
  await expect(page.getByTestId('figure-symbol')).toHaveCount(1);
  await expect(page.locator('.issues-chip')).toHaveCount(0);

  await page.getByTestId('dock-catalog').click();
  await page.getByTestId('shelf-general').click();
  await expect(page.getByTestId('cat-person-woman')).toBeVisible();
  await expect(page.getByTestId('cat-person-worker')).toHaveCount(0);
  await page.getByTestId('cat-person-child').click();
  const c = await planCentre(page);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
  await deselect(page);
  await expect(page.getByTestId('figure-symbol')).toHaveCount(2);

  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  // The man is the business-man model once it has loaded, standing 1.75 m on the floor.
  await expect
    .poll(() =>
      page.evaluate(() => {
        type Box = { min: { y: number }; max: { y: number }; clone(): Box; applyMatrix4(m: unknown): Box };
        type Node = { isSkinnedMesh?: boolean; boundingBox: Box; matrixWorld: unknown; computeBoundingBox(): void; updateMatrixWorld(f: boolean): void };
        const scene = (window as unknown as { __scene: { scene: Node & { traverse(f: (o: Node) => void): void } } }).__scene.scene;
        scene.updateMatrixWorld(true);
        let lo = Infinity;
        let hi = -Infinity;
        scene.traverse((o) => {
          if (!o.isSkinnedMesh) return;
          o.computeBoundingBox();
          const b = o.boundingBox.clone().applyMatrix4(o.matrixWorld);
          lo = Math.min(lo, b.min.y);
          hi = Math.max(hi, b.max.y);
        });
        return hi > lo ? [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100] : null;
      }),
    )
    .toEqual([0, 1.75]);
  // An interior's people move by default.
  await expect(page.getByTestId('figures-idle')).toHaveAttribute('aria-pressed', 'true');
  expect(await framesIn(page, 500)).toBeGreaterThan(3);
  await page.getByTestId('figures-toggle').click();
  await expect(page.getByTestId('figures-idle')).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await framesIn(page, 500)).toBe(0);
  await page.getByTestId('figures-toggle').click();

  // Not furniture: the BOQ and Mood & Tone leave the people out.
  await page.getByTestId('boq-open').click();
  await expect(page.getByTestId('boq-line-oak')).toBeVisible();
  await expect(page.getByTestId('dialog').getByText(/ผู้ชาย|ผู้หญิง|เด็ก/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('people on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the 3D view buttons with the people switches fit on screen without overlapping', async ({ page }) => {
    for (const start of ['factory', 'condo'] as const) {
      if (start === 'factory') await openSample(page);
      else {
        await page.goto('/?interior');
        await page.getByTestId('new-sample-condo').click();
        await expect(page.getByTestId('interior-editor')).toBeVisible();
      }
      await page.getByTestId('view-3d').click();
      await expect(page.getByTestId('figures-idle')).toBeVisible();
      const boxes = await page.locator('.view-tools button:visible').evaluateAll((els) =>
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
          expect(overlap, `${start}: 3D buttons ${i} and ${j} overlap`).toBe(false);
        }
      for (const b of boxes) {
        expect(b.r).toBeLessThanOrEqual(391);
        expect(b.b).toBeLessThanOrEqual(845);
        expect(b.l).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
