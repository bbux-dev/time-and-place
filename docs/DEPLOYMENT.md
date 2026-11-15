# Time and Place deployment

## What gets created

SST app **trips**, protected stage **prod**, in the existing Cloudflare account and `bxtn.dev` zone:

- **Worker** `Trips` on the custom domain **trips.bxtn.dev** (DNS and TLS provisioned by Cloudflare). No `workers.dev` URL.
  It answers every request, including static files, so the admin login guards the admin page as well as the data.
  Plain HTTP is redirected to HTTPS before any login prompt.
- **R2 bucket** `Data`, private, bound to the Worker. `store.json` is the whole database. Every save also writes
  `backups/YYYY-MM-DD.json` (the last save of that day).
- **Secret** `AdminPassword`, held in SST's encrypted state and bound to the Worker.

Time and Place uses the existing `trips` infrastructure names and `trips.bxtn.dev` domain.
The public showcase at `/sample` serves a fictional itinerary from `site/sample.json`. Both are static
assets served without login; they never read or write R2 trip data. Deploy this app before publishing
the showcase link on `bxtn.dev`.

The only provider is Cloudflare. `home: 'cloudflare'` keeps SST state in R2, like `../gas-tracker`, `../settle-up`
and `../bxtn-dev`. Sibling Workers and domains are outside this stack.

## Credentials

No special token is needed. The token the Cloudflare-only siblings use has every scope this stack needs:

- Account: Workers Scripts — Edit (the Worker, its assets, bindings and custom domain).
- Account: Workers R2 Storage — Edit (the data bucket and SST state).
- Zone `bxtn.dev`: DNS — Edit, Zone — Read, Workers Routes — Edit.

Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_DEFAULT_ACCOUNT_ID` in `.env` (see `.env.example`). With direnv, `.envrc` loads
`.env` into your shell automatically; run `direnv allow` once after cloning. The Worker itself
gets no API token; it reaches the bucket through its binding.

## First deploy

```sh
pnpm install
pnpm exec playwright install chromium                   # browser tests used by pnpm deploy
pnpm preflight                                         # read-only check of token, zone and domain
pnpm exec sst secret set AdminPassword --stage prod < password.txt   # then delete password.txt
pnpm deploy
```

The secret command reads the password from a file so it stays out of your shell history; the file should hold
only the password (surrounding spaces and newlines are ignored). Passing it as an argument after `AdminPassword`
also works.

`pnpm deploy` runs the preflight, syntax checks and tests, `sst deploy --stage prod`, then checks the live site:
the admin page and data refuse anonymous requests, public files match this checkout, and HTTP redirects to HTTPS.

Checks include strict JSDoc type checking and the colocated Node and Playwright suites. Browser tests
use local temporary databases and mocked Maps responses. Before SST uploads assets, `pnpm prepare:site`
copies the allowlisted application files to `.site/`; tests and test helpers stay out of the deployment.
Use the deployment script rather than invoking SST directly so this asset preparation is not skipped.

Then open <https://trips.bxtn.dev> and log in with `ADMIN_USER` (default `admin`) and the password you set.
The hosted site starts empty; it does not copy `data/store.json` from your machine.

To change the password later, run the `sst secret set` command again and `pnpm deploy`.

## Recovery

- **Undo a bad edit:** in the Cloudflare dashboard, open the `Data` bucket, download the `backups/` file for the day
  you want and upload it as `store.json`. Bump nothing; the app picks it up on the next load.
- **Roll back code:** check out the earlier commit and run `pnpm deploy`. Data is untouched.
- Keep `sst.config.ts`, the app and stage names, and the R2 state intact. Removal is protected and resources are
  retained; do not use `sst remove`.
