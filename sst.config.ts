/// <reference path="./.sst/platform/config.d.ts" />

// Cloudflare only, modelled on ../gas-tracker: SST state in R2, one Worker on trips.bxtn.dev.
// The Worker answers every request (assets run_worker_first), so the admin login guards the
// admin page as well as the data. Trip data is one JSON object in a private R2 bucket.

export default $config({
  app(input) {
    if (input.stage !== 'prod') {
      throw new Error('Trip planner deploys only to the prod stage. Use pnpm deploy.');
    }
    if (!process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
      throw new Error('Set CLOUDFLARE_DEFAULT_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. See .env.example.');
    }
    return {
      name: 'trips',
      home: 'cloudflare',
      version: '4.17.2',
      protect: true,
      removal: 'retain',
      providers: {
        cloudflare: {
          version: '6.22.0',
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
        },
      },
    };
  },
  async run() {
    // Private bucket: no public URL. Only the Worker reads and writes store.json.
    const data = new sst.cloudflare.Bucket('Data');
    // Set once with: pnpm exec sst secret set AdminPassword --stage prod < password.txt
    const adminPassword = new sst.Secret('AdminPassword');

    const worker = new sst.cloudflare.Worker('Trips', {
      handler: 'infra/worker.js',
      link: [data, adminPassword],
      environment: { ADMIN_USER: process.env.ADMIN_USER || 'admin' },
      assets: {
        directory: 'site',
        htmlHandling: 'none',
        notFoundHandling: 'none',
        runWorkerFirst: true,
      },
      domain: 'trips.bxtn.dev',
      url: false,
    });
    return { url: 'https://trips.bxtn.dev', worker: worker.nodes.worker.scriptName };
  },
});
