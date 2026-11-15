// Checks the live site without logging in: what must be locked is locked, what must be
// public is public, and the deployed files are the ones in this checkout.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://trips.bxtn.dev';
const get = (path, options = {}) => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000), redirect: 'manual', ...options });

async function verify() {
  for (const path of ['/', '/index.html', '/app.js', '/api/store']) {
    const response = await get(path);
    assert.equal(response.status, 401, `${path} needs the admin login`);
    assert.match(response.headers.get('www-authenticate') || '', /^Basic/);
  }
  const home = await get('/');
  assert.match(home.headers.get('server') || '', /cloudflare/i, 'Cloudflare hosting');
  assert.match(home.headers.get('strict-transport-security') || '', /max-age/);

  const write = await get('/api/store', { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'trip-planner' } });
  assert.equal(write.status, 401, 'Saving needs the admin login');

  for (const path of ['/styles.css', '/share.js', '/domain.js', '/sample.json', '/share-sw.js', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('cache-control') || '', /no-transform/, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const local = await readFile(new URL(`../site${path}`, import.meta.url));
    assert.ok(local.equals(Buffer.from(await response.arrayBuffer())), `${path} matches this checkout`);
  }

  assert.equal((await get('/api/shared/zzzzzzzzzzzzzzzzzzzzzz')).status, 404, 'Unknown share link');
  const sharePage = await get('/s/zzzzzzzzzzzzzzzzzzzzzz');
  assert.equal(sharePage.status, 200, 'Share page shell');
  assert.match(sharePage.headers.get('x-robots-tag') || '', /noindex/);

  const samplePage = await get('/sample');
  assert.equal(samplePage.status, 200, 'Public sample needs no login');
  assert.equal(samplePage.headers.get('www-authenticate'), null);
  assert.equal(await samplePage.text(), await readFile(new URL('../site/share.html', import.meta.url), 'utf8'));

  const http = await fetch('http://trips.bxtn.dev/', { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  assert.ok([301, 308].includes(http.status), 'HTTP redirects');
  assert.equal(http.headers.get('location'), 'https://trips.bxtn.dev/');
}

// A new custom domain can take a minute to get DNS and a certificate.
let lastError;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    await verify();
    console.log(`Verified ${origin}`);
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 12) await setTimeout(10_000);
  }
}
if (lastError) {
  console.error(`Hosted verification failed: ${lastError.message}`);
  process.exitCode = 1;
}
