# Time and Place

Plan a group trip: who is coming, where you are staying, and who is going to which activity.
One admin edits behind a login; everyone else gets a read-only share link.

Plain HTML, CSS and JavaScript with no build step. Runs locally on Node, and on Cloudflare at
**https://trips.bxtn.dev** (a Worker plus one JSON object in R2).

## Run

```sh
pnpm dev        # or: node server.mjs
```

Open <http://127.0.0.1:4181> and log in with `admin` / `changeme`.
Copy `.env.example` to `.env` to set your own login, or to set `HOST=0.0.0.0` so phones on the same Wi-Fi can open a share link.

```sh
pnpm test       # rules, share-link privacy, login and save behavior
pnpm check      # syntax
```

## How it works

- **Admin** (`/`): HTTP basic auth. Create a trip, tap saved people onto it, add lodging and activities.
  A new activity starts with everyone on the trip; "Adults only (21+)" takes the under-21 people off.
  Toggle the **Dining** and **Museum** pills to show food or museum icons beside the activity title on
  admin and shared itineraries. The pills can be selected independently.
  The **All / Activities / Dining / Museum** filters beside Itinerary show everything, ordinary activities
  without either type, meals, or museum visits. The selection also filters Unscheduled items.
  **From Maps** opens an unscheduled activity with a place-link lookup. **Fill details** suggests the
  name, address, map link, and Dining/Museum settings; review and save normally. This prototype reads Google
  Maps page and place-preview metadata without an API key. Its format can change; if details are
  unavailable, the form stays editable for manual entry. No activity is saved by the lookup itself.
  If Google blocks the hosted preview, the importer uses the place name from the resolved link when
  available and shows a banner explaining which details need checking. Lookup and form errors appear
  at the top of the editor; failed saves show a persistent admin banner with **Retry save**.
  Choose **Date TBD** to keep an activity in **Unscheduled**, visible on both trip views. Use **Schedule**
  to choose a day and optional times, or edit a dated activity and choose **Date TBD** to move it back.
- **Share link** (`/s/<token>`): no login. Shows one trip and the first names on it. The token is random,
  made when you press **Create share link**; **New link** or **Stop sharing** kills the old one.
- **Public sample** (`/sample`): the Simpsons visit Middle-earth in a fictional, read-only itinerary.
  Try it locally at <http://127.0.0.1:4181/sample>. It uses `site/sample.json` and the shared itinerary view,
  without reading or changing real trips or linking to the admin login. The sample is an online preview;
  installation and offline support belong to real share links.
- **PWA**: both pages can be added to a phone's home screen. A shared itinerary installs as its own app and,
  once it has loaded, still opens without signal (showing the last copy). The admin page is never cached.
  Offline support needs HTTPS or `localhost`, so it starts working for phones once the site is hosted.
- **Export / import**: on the trips screen. Export downloads every trip, person and share link as one JSON file;
  import replaces everything with such a file. This is also how to move local data to the hosted site.
- **Data**: one JSON document, read and written whole. Locally it is `data/store.json` (git-ignored); hosted it is
  `store.json` in a private R2 bucket, with a daily backup copy. Each save carries a revision number, so a stale
  tab cannot overwrite newer changes.

## Hosting

```sh
pnpm deploy
```

Cloudflare only, through SST: one Worker on `trips.bxtn.dev` and one R2 bucket. See
[deployment and recovery](docs/DEPLOYMENT.md) for the token scopes, first-time setup and backups.

## Structure

- `infra/handler.js`: the backend (login, share links, saving), shared by both runtimes.
- `infra/worker.js`: Cloudflare Worker entry, storing to R2.
- `server.mjs`: local Node entry, storing to a file.
- `sst.config.ts`, `scripts/`: infrastructure, preflight, deploy and hosted checks.
- `site/domain.js`: trip rules and formatting, shared by both pages and the server.
- `site/activity-types.js`: shared type labels, icons, and filter options.
- `site/app.js` + `index.html`: the admin page.
- `site/share.js` + `share.html`: the shared itinerary.
- `site/sample.json`: fictional public sample data, separate from the trip database.
- `site/share-sw.js`: offline copy of shared itineraries (network first).
- `site/styles.css`: phone-sized layout, light and dark.
