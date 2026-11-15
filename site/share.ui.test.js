import { test, expect, SHARE_TOKEN } from '../test-support/ui.js';

test('public sample has type filters and name highlighting without admin controls', async ({ page, app }) => {
  const response = await fetch(`${app.url}/sample`);
  expect(response.status).toBe(200);
  await page.goto('/sample');
  await expect(page.getByRole('heading', { name: 'The Simpsons in Middle-earth' })).toBeVisible();
  await page.locator('.activity-filters').getByRole('button', { name: 'Museum', exact: true }).click();
  await expect(page.locator('.act')).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'Museum', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lisa', exact: true }).click();
  await expect(page.locator('.act.dim')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'From Maps', exact: true })).toHaveCount(0);
  expect(await page.locator('#screen').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('shared trip is public, scoped to its attendees, and reacts to link revocation', async ({ page, app }) => {
  const store = await app.read();
  store.trips[0].activities = [{ id: 'museum', title: 'The Mob Museum', date: '', museum: true, attendeeIds: ['adult'] }];
  await app.write(store);
  expect((await fetch(`${app.url}/api/shared/${SHARE_TOKEN}`)).status).toBe(200);
  await page.goto(`/s/${SHARE_TOKEN}`);
  await page.getByRole('button', { name: 'Lisa', exact: true }).click();
  await expect(page.locator('.act.dim')).toHaveCount(1);
  await expect(page.locator('.act')).toContainText('Not you');
  store.trips[0].shareToken = null; await app.write(store);
  await page.reload();
  await expect(page.locator('#screen')).toContainText('This link is no longer active');
});
