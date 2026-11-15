import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @param {string} directory @returns {string[]} */
function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', '.sst', '.site', 'data', 'test-results', 'playwright-report'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findTests(path) : path.endsWith('.test.js') && !path.endsWith('.ui.test.js') ? [path] : [];
  });
}
const result = spawnSync(process.execPath, ['--test', ...findTests('.')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
