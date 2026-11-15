// Read-only check before deploying: right account, right zone, enough token scope,
// and trips.bxtn.dev is either free or already ours. Changes nothing.

import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const HOST = 'trips.bxtn.dev';
const OURS = 'trips-prod-';

export function loadLocalEnvironment() {
  if (!existsSync('.env')) return;
  const local = parseEnv(readFileSync('.env', 'utf8'));
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_DEFAULT_ACCOUNT_ID', 'ADMIN_USER']) {
    if (name in local) process.env[name] = local[name];
  }
}

async function request(path, token) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    const codes = (data.errors ?? []).map(error => error.code);
    if (codes.includes(10042)) throw new Error('Enable R2 in the selected Cloudflare account, then retry.');
    // Do not emit tokens, request headers, or provider response bodies.
    throw new Error(`Cloudflare preflight failed at ${path.split('?')[0].replace(/[0-9a-f]{32}/g, '…')}: HTTP ${response.status}${codes.length ? `, code ${codes.join(', ')}` : ''}. Check the token scopes in .env.example.`);
  }
  return data.result;
}

export async function preflight() {
  loadLocalEnvironment();
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID;
  if (!token || !account) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_DEFAULT_ACCOUNT_ID. See .env.example.');

  const verification = await request('/user/tokens/verify', token);
  if (verification.status !== 'active') throw new Error('The Cloudflare token is not active.');
  const zones = await request('/zones?name=bxtn.dev&status=active', token);
  const zone = zones.find(item => item.name === 'bxtn.dev' && item.account.id === account);
  if (!zone) throw new Error('bxtn.dev must be active in the selected Cloudflare account.');

  await request(`/accounts/${account}/workers/scripts`, token);
  await request(`/accounts/${account}/r2/buckets`, token);
  const domains = await request(`/accounts/${account}/workers/domains`, token);
  const domain = domains.find(item => item.hostname === HOST);
  if (domain && !domain.service.startsWith(OURS)) {
    throw new Error(`${HOST} belongs to a different Worker. Deployment stopped without changing it.`);
  }
  const records = await request(`/zones/${zone.id}/dns_records?name=${HOST}`, token);
  if (!domain && records.some(item => ['A', 'AAAA', 'CNAME'].includes(item.type))) {
    throw new Error(`${HOST} has an existing DNS destination. Deployment stopped without changing it.`);
  }
  console.log(`Cloudflare preflight passed: active token, intended zone/account, Workers, R2, and ${HOST} is ${domain ? 'already ours' : 'available'}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preflight().catch(error => { console.error(error.message); process.exitCode = 1; });
}
