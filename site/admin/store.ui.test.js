import { test, expect, seed } from '../../test-support/ui.js';

test('save failure remains visible through rerenders and Retry save recovers', async ({ page, app }) => {
  let fail = true;
  await page.route('**/api/store', (route) => route.request().method() === 'PUT' && fail
    ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.continue());
  await page.goto('/#/trip/demo');
  await page.locator('[data-action="toggle-person"][data-id="adult"]').click();
  await expect(page.locator('#admin-error')).toBeVisible();
  await page.locator('.activity-filters').getByRole('button', { name: 'Museum', exact: true }).click();
  await expect(page.locator('#admin-error')).toBeVisible();
  expect((await app.read()).trips[0].peopleIds).toEqual(['adult', 'child']);
  fail = false;
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.locator('#admin-error')).toBeHidden();
  expect((await app.read()).trips[0].peopleIds).toEqual(['child']);
});

test('conflicting queued saves preserve edits and keep the conflict visible', async ({ page, app }) => {
  const initial = seed(); initial.trips[0].peopleIds = [];
  await app.write(initial);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const writes = [];
  await page.route('**/api/store', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) {
      firstStarted(); await held;
      return route.fulfill({ status: 409, json: { error: 'Stale', store: { ...initial, rev: 1 } } });
    }
    return route.fulfill({ status: 200, json: { rev: 2 } });
  });
  await page.goto('/#/trip/demo');
  await page.locator('[data-action="toggle-person"][data-id="adult"]').click();
  await started;
  await page.locator('[data-action="toggle-person"][data-id="child"]').click();
  release();
  await expect(page.locator('#admin-error')).toContainText('saving is paused');
  await expect(page.locator('#admin-error')).toBeVisible();
  for (const id of ['adult', 'child']) await expect(page.locator(`[data-action="toggle-person"][data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.activity-filters').getByRole('button', { name: 'Dining', exact: true }).click();
  await expect(page.locator('#admin-error')).toBeVisible();
  expect(writes).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('[data-action="toggle-person"][data-id="adult"]').click();
  await expect(page.locator('#admin-error')).toBeVisible();
  expect(writes).toHaveLength(1);
});
