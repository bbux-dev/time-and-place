import { test, expect, save } from '../../test-support/ui.js';

test('activity type pills, adult attendance, scheduling and filters survive reload', async ({ page, app }, testInfo) => {
  await page.goto('/#/trip/demo');
  await page.locator('[data-action="add-unscheduled"]').click();
  await page.getByRole('textbox', { name: 'Activity', exact: true }).fill('Museum supper');
  await page.getByRole('checkbox', { name: 'Dining', exact: true }).check();
  const museum = page.getByRole('checkbox', { name: 'Museum', exact: true });
  await museum.focus(); await page.keyboard.press('Space');
  await expect(museum).toBeChecked();
  await page.getByRole('checkbox', { name: /Adults only/ }).check();
  await expect(page.locator('[data-pid="child"]')).toBeDisabled();
  await page.getByRole('checkbox', { name: /Adults only/ }).uncheck();
  await expect(page.locator('[data-pid="child"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: /Adults only/ }).check();
  await page.screenshot({ path: testInfo.outputPath('activity-editor.png') });
  await save(page);
  await expect(page.getByRole('region', { name: 'Unscheduled activities' }).getByRole('img', { name: 'Museum', exact: true })).toBeVisible();
  const record = (await app.read()).trips[0].activities[0];
  expect(record.attendeeIds).toEqual(['adult']);
  expect(record.date).toBe('');
  await page.getByRole('button', { name: 'Schedule Museum supper', exact: true }).click();
  await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2027-06-14');
  await save(page, 'Schedule');
  await page.reload();
  await expect(page.locator('.act')).toHaveCount(1);
  for (const name of ['Dining', 'Museum']) {
    await page.locator('.activity-filters').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.act')).toHaveCount(1);
  }
  await page.locator('.activity-filters').getByRole('button', { name: 'Activities', exact: true }).click();
  await expect(page.locator('.act')).toHaveCount(0);
  await page.locator('.activity-filters').getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.act').click();
  await page.getByRole('checkbox', { name: /Date TBD/ }).check();
  await save(page);
  const unscheduled = (await app.read()).trips[0].activities[0];
  expect(unscheduled).toMatchObject({ date: '', time: '', endTime: '', dining: true, museum: true });
  expect(await page.locator('#screen').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('Maps fills editable suggestions, quiet partial results and visible failures without saving', async ({ page, app }) => {
  let mode = 'partial';
  await page.route('**/api/maps-preview', (route) => route.fulfill(mode === 'error'
    ? { status: 502, json: { error: "Google Maps couldn't load that place." } }
    : { status: 200, json: { title: 'The Mob Museum', location: mode === 'partial' ? 'The Mob Museum' : '300 Stewart Ave, Las Vegas, NV 89101', category: mode === 'partial' ? '' : 'Museum', dining: mode === 'partial' ? null : false, museum: mode === 'partial' ? null : true, mapUrl: 'https://maps.app.goo.gl/test', warning: 'Google blocked extra metadata' } }));
  await page.goto('/#/trip/demo');
  await page.getByRole('button', { name: 'From Maps', exact: true }).click();
  await page.getByRole('textbox', { name: 'Google Maps place link' }).fill('https://maps.app.goo.gl/test');
  await page.getByRole('button', { name: 'Fill details', exact: true }).click();
  await expect(page.locator('[data-lookup-status]')).toHaveText('Place name filled from Maps.');
  await expect(page.locator('#overlay .error-banner')).toBeHidden();
  expect((await app.read()).trips[0].activities).toEqual([]);
  mode = 'error';
  await page.getByRole('button', { name: 'Fill details', exact: true }).click();
  await expect(page.locator('#overlay').getByRole('alert')).toHaveText("Google Maps couldn't load that place.");
  mode = 'full';
  await page.getByRole('button', { name: 'Fill details', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Museum', exact: true })).toBeChecked();
  await expect(page.locator('#overlay .error-banner')).toBeHidden();
  await page.getByRole('textbox', { name: 'Activity', exact: true }).fill('Afternoon at the museum');
  await save(page);
  expect((await app.read()).trips[0].activities[0]).toMatchObject({ title: 'Afternoon at the museum', museum: true, dining: false, date: '' });
});
