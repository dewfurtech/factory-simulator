import { expect, type Page } from '@playwright/test';

/** The project list. Each test runs in its own browser context, so its storage starts empty. */
export async function freshApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('new-sample')).toBeVisible();
}

/** Opens a project from the sample factory and waits for the plan to draw. */
export async function openSample(page: Page) {
  await freshApp(page);
  await page.getByTestId('new-sample').click();
  await expect(page.getByTestId('plan')).toBeVisible();
  await expect(page.getByTestId('toolbar')).toBeVisible();
}

/** The plan's visible middle, in page coordinates, for clicks on open floor. */
export async function planCentre(page: Page) {
  const box = await page.getByTestId('plan').boundingBox();
  if (!box) throw new Error('no plan on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** What the open project holds, read from the dev hook the app leaves on window. */
export const projectState = (page: Page) =>
  page.evaluate(() => {
    const p = (
      window as unknown as { __factory?: { project: { getState(): { project: { objects: { assetId: string; name: string }[]; plan: { rooms: object; walls: object } } } } } }
    ).__factory?.project.getState().project;
    if (!p) throw new Error('no project open');
    return { objects: p.objects.map((o) => ({ assetId: o.assetId, name: o.name })), rooms: Object.keys(p.plan.rooms).length, walls: Object.keys(p.plan.walls).length };
  });
