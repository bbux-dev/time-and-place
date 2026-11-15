import { mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SITE_ASSETS } from '../infra/assets.js';

await rm('.site', { recursive: true, force: true });
for (const file of SITE_ASSETS) {
  const target = `.site/${file}`;
  await mkdir(dirname(target), { recursive: true });
  await copyFile(`site/${file}`, target);
}
console.log(`Prepared ${SITE_ASSETS.length} application assets; tests and test helpers are excluded.`);
