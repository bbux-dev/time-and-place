import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    if (['node_modules', '.git', '.sst', '.site', 'data', 'test-results', 'playwright-report'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(m?js)$/.test(path) ? [path] : [];
  }));
  return nested.flat();
}
for (const file of await files('.')) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
// Validate JSON configuration too, without executing it.
JSON.parse(await readFile('site/manifest.webmanifest', 'utf8'));
