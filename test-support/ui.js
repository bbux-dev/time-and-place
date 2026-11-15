import { test as base, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

export const SHARE_TOKEN = 'abcdefghijklmnopqrstuv';
export const seed = () => ({
  rev: 0,
  people: [{ id: 'adult', name: 'Homer', adult: true }, { id: 'child', name: 'Lisa', adult: false }],
  trips: [{ id: 'demo', name: 'Vegas test trip', destination: 'Las Vegas', startDate: '2027-06-12', endDate: '2027-06-18',
    peopleIds: ['adult', 'child'], lodging: [], activities: [], shareToken: SHARE_TOKEN }],
});

// Each test owns a loopback server and a temporary database. No production credentials,
// .env files, hosted data, fixed ports, or external Maps requests are used.
export const test = base.extend({
  app: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'time-and-place-ui-'));
    const dataFile = join(directory, 'store.json');
    await writeFile(dataFile, JSON.stringify(seed()));
    const server = createApp({ dataFile, user: 'ui-test', password: 'ui-test-password' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await use({
        url: `http://127.0.0.1:${server.address().port}`,
        read: async () => JSON.parse(await readFile(dataFile, 'utf8')),
        write: async (store) => writeFile(dataFile, JSON.stringify(store)),
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
  baseURL: async ({ app }, use) => { await use(app.url); },
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors, 'No uncaught browser errors').toEqual([]);
  },
});
export { expect };

export async function save(page, name = 'Save') {
  const response = page.waitForResponse((response) => response.url().endsWith('/api/store') && response.request().method() === 'PUT');
  await page.getByRole('button', { name, exact: true }).click();
  expect((await response).status()).toBe(200);
}
