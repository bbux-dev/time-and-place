import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { test } from 'node:test';
import { ADMIN_ASSETS, PUBLIC_ASSETS, SITE_ASSETS } from './assets.js';

test('production assets exclude colocated tests and include every browser module dependency', async () => {
  const allowed = new Set(SITE_ASSETS);
  assert.equal(allowed.size, SITE_ASSETS.length, 'asset manifest must not duplicate files');
  for (const file of allowed) {
    assert.ok(!/\.test\.js$/.test(file), 'tests must not be uploaded');
    const content = await readFile(new URL(`../site/${file}`, import.meta.url), 'utf8');
    if (!file.endsWith('.js')) continue;
    for (const match of content.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(file), match[1]));
      assert.ok(allowed.has(dependency), `${file} needs ${dependency} in deployment assets`);
      if (PUBLIC_ASSETS.includes(file)) assert.ok(PUBLIC_ASSETS.includes(dependency), `${file} needs public access to ${dependency}`);
    }
  }
  assert.ok(ADMIN_ASSETS.includes('admin/store.js'));
});
