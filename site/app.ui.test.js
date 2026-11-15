import { test, expect, save } from '../test-support/ui.js';

test('create a trip, add people and lodging, and retain them after reload', async ({ page, app }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByRole('textbox', { name: 'Trip name' }).fill('New adventure');
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('Las Vegas');
  await page.locator('[name="startDate"]').fill('2027-07-01');
  await page.locator('[name="endDate"]').fill('2027-07-05');
  await save(page, 'Create trip');
  await page.getByRole('button', { name: '+ Person', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Marge');
  await save(page, 'Add to trip');
  await page.getByRole('button', { name: '+ Lodging', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('A hotel');
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill('123 Main Street');
  await save(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New adventure', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A hotel', exact: true })).toBeVisible();
  const trip = (await app.read()).trips.find((trip) => trip.name === 'New adventure');
  expect(trip.peopleIds).toHaveLength(1);
  expect(trip.lodging[0]).toMatchObject({ name: 'A hotel', address: '123 Main Street' });
});

test('malformed import data is rejected without changing existing trips', async ({ page, app }) => {
  await page.goto('/');
  const before = await app.read();
  const invalid = structuredClone(before);
  invalid.trips[0].activities.push({ id: 'bad', title: 'Broken activity', date: '2027-06-12', time: 42, attendeeIds: [] });
  await page.locator('[data-import-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#toast')).toContainText('damaged');
  expect(await app.read()).toEqual(before);
  await expect(page.getByRole('link', { name: /Vegas test trip/ })).toBeVisible();
});
